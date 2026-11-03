import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { rubrics, rubricVersions } from '../src/db/schema/skills.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'
import { sampleRubricData, seedSkillChain } from './support/skills-sample.ts'

/**
 * Rubrik kütüphanesi uçları: liste, ayrıntı, oluşturma, yeni sürüm, taslak düzenleme, yayım ve
 * arşiv (ADR 0004 karar 7; DOM-BEC-020, 022; IST-048). Kural core `skills/rubric.ts`'tedir;
 * burada rol ve kurum sınırı, sıra (kapsam → yetki → sürüm) ve başarısızlıkta kaydın değişmediği
 * denetlenir.
 */

/** Yanıt gövdesi `inject().json()` gibi gevşek erişilir; alanları assert doğrular. */
type Json = ReturnType<typeof JSON.parse>

const body = (title = 'Yazma rubriği') => ({ ...sampleRubricData(), title })

/** Bantları kazanıma bağlı rubrik (yalnız `school`'da geçerli). */
const outcomeAligned = () => {
  const rubric = sampleRubricData()
  return {
    ...rubric,
    criteria: rubric.criteria.map((criterion) => ({
      ...criterion,
      bands: criterion.bands.map((band) => ({
        ...band,
        alignment: { kind: 'outcome', outcomeId: 'E.9.1.W1', outcomeSource: 'platform' },
      })),
    })),
  }
}

describe('rubrik uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function tenant(type: 'school' | 'language_school' = 'school') {
    const institution = await createInstitution(app, { type })
    const teacher = await createMember(app, institution.id, 'ogretmen')
    const otherTeacher = await createMember(app, institution.id, 'ogretmen')
    const student = await createMember(app, institution.id, 'ogrenci')
    const parent = await createMember(app, institution.id, 'veli')
    const frontDesk = await createMember(app, institution.id, 'onburo')
    const cookies = {
      admin: await signInAs(app, institution.admin),
      teacher: await signInAs(app, teacher),
      otherTeacher: await signInAs(app, otherTeacher),
      student: await signInAs(app, student),
      parent: await signInAs(app, parent),
      frontDesk: await signInAs(app, frontDesk),
    }
    return { institution, teacher, otherTeacher, cookies }
  }

  function call(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    cookie?: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url: `/api/v1${url}`,
      headers: {
        origin: TEST_ORIGIN,
        ...(cookie ? { cookie } : {}),
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
  }
  const ifMatch = (version: number | undefined): Record<string, string> =>
    version === undefined ? {} : { 'if-match': `"${version}"` }
  const post = (url: string, cookie: string | undefined, payload: unknown = {}, headers = {}) =>
    call('POST', url, cookie, payload, headers)
  const patch = (url: string, cookie: string | undefined, payload: unknown, version?: number) =>
    call('PATCH', url, cookie, payload, ifMatch(version))
  const command = (url: string, cookie: string | undefined, version?: number) =>
    call('POST', url, cookie, {}, ifMatch(version))

  async function ok(response: Awaited<ReturnType<typeof call>>, status = 200) {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function fails(response: Awaited<ReturnType<typeof call>>, status: number, code: string) {
    assert.equal(response.statusCode, status, response.body)
    assert.equal(response.json().code, code, response.body)
  }
  async function create(cookie: string, payload: unknown = body()) {
    return ok(await post('/rubrics', cookie, payload), 201)
  }
  const versionUrl = (data: Json) => `/rubrics/${data.rubric.id}/versions/${data.version.id}`

  /** Kurumun rubrik ve sürüm satırları ile denetim kaydı sayısı (değişmezlik denetimi). */
  async function snapshot(institutionId: string) {
    const versions = await db
      .select()
      .from(rubricVersions)
      .where(eq(rubricVersions.institutionId, institutionId))
      .orderBy(rubricVersions.id)
    const owners = await db
      .select()
      .from(rubrics)
      .where(eq(rubrics.institutionId, institutionId))
      .orderBy(rubrics.id)
    const audits = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(eq(auditLog.institutionId, institutionId))
    return { versions, owners, audits: audits.length }
  }

  test('DOM-BEC-022: 401 oturumsuz; öğrenci, veli ve ön büro 403; modül kapalı 403', async () => {
    const t = await tenant()
    const data = await create(t.cookies.teacher)
    const version = versionUrl(data)
    const requests = [
      (cookie?: string) => call('GET', '/rubrics', cookie),
      (cookie?: string) => call('GET', `/rubrics/${data.rubric.id}`, cookie),
      (cookie?: string) => call('GET', `/rubric-versions/${data.version.id}`, cookie),
      (cookie?: string) => post('/rubrics', cookie, body()),
      (cookie?: string) => post(`/rubrics/${data.rubric.id}/versions`, cookie, body()),
      (cookie?: string) => patch(version, cookie, { title: 'Değişti' }, 1),
      (cookie?: string) => command(`${version}/publish`, cookie, 1),
      (cookie?: string) => command(`${version}/archive`, cookie, 1),
    ]
    const before = await snapshot(t.institution.id)
    for (const request of requests) {
      fails(await request(), 401, 'unauthenticated')
      for (const cookie of [t.cookies.student, t.cookies.parent, t.cookies.frontDesk])
        fails(await request(cookie), 403, 'forbidden')
    }
    assert.deepEqual(await snapshot(t.institution.id), before)
    const closed = await createInstitution(app, { enabledModules: { learning: false } })
    const admin = await signInAs(app, closed.admin)
    // Kapalı kurumun rubriği: modül kapısı kayıt aramadan önce çalışır, ayrıntı da yazma da 403.
    const id = '00000000-0000-4000-8000-000000000001'
    const closedVersion = `/rubrics/${id}/versions/${id}`
    const closedRequests = [
      post('/rubrics', admin, body()),
      call('GET', '/rubrics', admin),
      call('GET', `/rubrics/${id}`, admin),
      call('GET', `/rubric-versions/${id}`, admin),
      post(`/rubrics/${id}/versions`, admin, body()),
      patch(closedVersion, admin, { title: 'Değişti' }, 1),
      command(`${closedVersion}/publish`, admin, 1),
      command(`${closedVersion}/archive`, admin, 1),
    ]
    for (const response of await Promise.all(closedRequests))
      fails(response, 403, 'module_disabled')
  })

  test('DOM-BEC-020: oluşturma 201 + Location, ilk taslak sürüm, denetim kaydı yalnız alan adları; gövdedeki institutionId etkisiz', async () => {
    const t = await tenant()
    const response = await post('/rubrics', t.cookies.teacher, {
      ...body(),
      institutionId: 'baska-kurum',
    })
    const data = await ok(response, 201)
    assert.equal(response.headers.location, `/api/v1/rubrics/${data.rubric.id}`)
    assert.equal(data.rubric.ownerUserId, t.teacher.id)
    assert.equal(data.rubric.canManage, true)
    assert.equal(data.version.status, 'draft')
    assert.equal(data.version.versionNumber, 1)
    assert.equal(data.version.rowVersion, 1)
    assert.equal(data.version.publishedAt, null)
    assert.deepEqual(data.version.usage, { assignmentCount: 0, scoreCount: 0 })
    assert.deepEqual(data.version.criteria, sampleRubricData().criteria)
    const [stored] = await db
      .select({ institutionId: rubrics.institutionId })
      .from(rubrics)
      .where(eq(rubrics.id, data.rubric.id))
    assert.equal(stored?.institutionId, t.institution.id)

    const [audit] = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.institutionId, t.institution.id), eq(auditLog.action, 'rubric.create')),
      )
    assert.equal(audit?.entityType, 'rubric')
    assert.equal(audit?.entityId, data.rubric.id)
    assert.equal(audit?.actorUserId, t.teacher.id)
    // Başlık ve bant tanımı serbest metindir; denetim kaydına yalnız alan adı yazılır.
    assert.deepEqual(audit?.changes, { fields: ['title', 'kind', 'skill', 'criteria'] })
    assert.ok(!JSON.stringify(audit).includes('Yazma rubriği'))

    const detail = await ok(await call('GET', `/rubrics/${data.rubric.id}`, t.cookies.admin))
    assert.deepEqual(detail.rubric, { ...data.rubric, canManage: true })
    assert.deepEqual(detail.versions, [data.version])
  })

  test('DOM-BEC-020: 400 ve 422 hiçbir kayıt yazmaz; oluşturmada If-Match 400; dil okulunda kazanım eşlemesi 422', async () => {
    const t = await tenant()
    const before = await snapshot(t.institution.id)
    const invalid = [
      { ...body(), title: 'x' },
      { ...body(), criteria: body().criteria.slice(0, 1) },
      { ...body(), skill: 'speaking' },
      { ...body(), kind: 'holistic' },
      { title: 'Eksik rubrik' },
    ]
    for (const payload of invalid)
      fails(await post('/rubrics', t.cookies.teacher, payload), 400, 'validation_failed')
    fails(
      await post('/rubrics', t.cookies.teacher, body(), { 'if-match': '"1"' }),
      400,
      'if_match_not_supported',
    )
    assert.deepEqual(await snapshot(t.institution.id), before)
    // Okulda bant kazanıma bağlanabilir.
    await create(t.cookies.teacher, outcomeAligned())

    const lang = await tenant('language_school')
    const langBefore = await snapshot(lang.institution.id)
    const rejected = await post('/rubrics', lang.cookies.teacher, outcomeAligned())
    fails(rejected, 422, 'rubric_alignment_invalid')
    assert.deepEqual(rejected.json().issues[0].path, ['criteria', '0', 'bands', '0', 'alignment'])
    assert.deepEqual(await snapshot(lang.institution.id), langBefore)
    await create(lang.cookies.teacher)
  })

  test('Idempotency-Key: aynı istek ilk yanıtı tekrarlar ve tek rubrik yazar; farklı gövde 422', async () => {
    const t = await tenant()
    const key = { 'idempotency-key': randomUUID() }
    const first = await post('/rubrics', t.cookies.teacher, body(), key)
    const second = await post('/rubrics', t.cookies.teacher, body(), key)
    assert.equal(first.statusCode, 201)
    assert.equal(second.statusCode, 201)
    assert.equal(second.headers['idempotent-replayed'], 'true')
    assert.deepEqual(second.json(), first.json())
    assert.equal((await snapshot(t.institution.id)).owners.length, 1)
    fails(
      await post('/rubrics', t.cookies.teacher, body('Başka rubrik'), key),
      422,
      'idempotency_key_reused',
    )
    // Yayım da anahtarla bir kez uygulanır; anahtarsız tekrar 409.
    const data = first.json().data
    const publishKey = { 'idempotency-key': randomUUID(), 'if-match': '"1"' }
    await ok(await post(`${versionUrl(data)}/publish`, t.cookies.teacher, {}, publishKey))
    const again = await post(`${versionUrl(data)}/publish`, t.cookies.teacher, {}, publishKey)
    assert.equal(again.statusCode, 200)
    assert.equal(again.headers['idempotent-replayed'], 'true')
    assert.equal(
      (await command(`${versionUrl(data)}/publish`, t.cookies.teacher, 1)).statusCode,
      409,
    )
  })

  test('DOM-BEC-022: başka kurumun rubriği okuma ve yazmada 404, yanlış sürümde de; listede yok; kayıt değişmez', async () => {
    const a = await tenant()
    const b = await tenant()
    const foreign = await create(b.cookies.teacher)
    const own = await create(a.cookies.teacher)
    const before = await snapshot(b.institution.id)
    for (const cookie of [a.cookies.admin, a.cookies.teacher]) {
      const base = `/rubrics/${foreign.rubric.id}`
      const version = versionUrl(foreign)
      for (const response of [
        await call('GET', base, cookie),
        await post(`${base}/versions`, cookie, body()),
        await patch(version, cookie, { title: 'Ele geçirildi' }, 1),
        await patch(version, cookie, { title: 'Ele geçirildi' }, 9),
        await command(`${version}/publish`, cookie, 1),
        await command(`${version}/publish`, cookie, 9),
        await command(`${version}/archive`, cookie, 9),
        await command(`${version}/archive`, cookie, 1),
        // Kendi rubriğinin yolunda başka kurumun sürümü de 404.
        await command(
          `/rubrics/${own.rubric.id}/versions/${foreign.version.id}/publish`,
          cookie,
          1,
        ),
      ])
        fails(response, 404, 'not_found')
    }
    assert.deepEqual(await snapshot(b.institution.id), before)
    const list = await ok(await call('GET', '/rubrics', a.cookies.admin))
    assert.deepEqual(
      list.map((item: Json) => item.rubric.id),
      [own.rubric.id],
    )
  })

  test('DOM-BEC-022: taslak düzenleme If-Match ister; önce yetki sonra sürüm; birleşmiş içerik doğrulanır; hata kaydı değiştirmez', async () => {
    const t = await tenant()
    const data = await create(t.cookies.teacher)
    const url = versionUrl(data)
    const before = await snapshot(t.institution.id)
    fails(await patch(url, t.cookies.teacher, { title: 'Yeni başlık' }), 400, 'if_match_required')
    fails(await patch(url, t.cookies.teacher, { title: 'Yeni başlık' }, 2), 409, 'version_conflict')
    // Görünür ama yetkisiz öğretmen yanlış sürümle de 403 alır.
    for (const version of [1, 9])
      fails(
        await patch(url, t.cookies.otherTeacher, { title: 'Başkası' }, version),
        403,
        'forbidden',
      )
    // Birleşmiş içerik core şemasıyla doğrulanır: analitik rubrik konuşma becerisine geçemez.
    fails(await patch(url, t.cookies.teacher, { skill: 'speaking' }, 1), 400, 'validation_failed')
    fails(await patch(url, t.cookies.teacher, {}, 1), 400, 'validation_failed')
    fails(await patch(url, t.cookies.teacher, { status: 'published' }, 1), 400, 'validation_failed')
    assert.deepEqual(await snapshot(t.institution.id), before)

    const updated = await ok(await patch(url, t.cookies.teacher, { title: 'Yazma (B1)' }, 1))
    assert.equal(updated.version.title, 'Yazma (B1)')
    assert.equal(updated.version.rowVersion, 2)
    assert.deepEqual(updated.version.criteria, sampleRubricData().criteria)
    const [audit] = await db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, t.institution.id),
          eq(auditLog.action, 'rubric.draft_update'),
        ),
      )
    assert.deepEqual(audit?.changes, { fields: ['title'] })
    // Yönetici başkasının rubriğini düzenler; diğer öğretmen göremez değil, yalnız düzenleyemez.
    const byAdmin = await ok(await patch(url, t.cookies.admin, { title: 'Yazma (B1+)' }, 2))
    assert.equal(byAdmin.version.rowVersion, 3)
    assert.equal(byAdmin.rubric.canManage, true)
    const seen = await ok(await call('GET', `/rubrics/${data.rubric.id}`, t.cookies.otherTeacher))
    assert.equal(seen.rubric.canManage, false)
  })

  test('DOM-BEC-022: yayım önceki yayındaki sürümü arşivler; yayımlanmış sürüm değişmez; açık taslak tektir; arşiv yalnız yayındakini', async () => {
    const t = await tenant()
    const first = await create(t.cookies.teacher)
    const base = `/rubrics/${first.rubric.id}`
    fails(
      await command(`${versionUrl(first)}/publish`, t.cookies.teacher),
      400,
      'if_match_required',
    )
    fails(
      await command(`${versionUrl(first)}/archive`, t.cookies.teacher, 1),
      409,
      'rubric_version_not_published',
    )
    fails(
      await command(`${versionUrl(first)}/publish`, t.cookies.otherTeacher, 1),
      403,
      'forbidden',
    )
    const v1 = await ok(await command(`${versionUrl(first)}/publish`, t.cookies.teacher, 1))
    assert.equal(v1.version.status, 'published')
    assert.equal(v1.version.rowVersion, 2)
    assert.ok(v1.version.publishedAt)

    // Yayımlanmış sürüm düzenlenmez ve yeniden yayımlanmaz.
    const before = await snapshot(t.institution.id)
    fails(
      await patch(versionUrl(first), t.cookies.teacher, { title: 'Değişti' }, 2),
      409,
      'rubric_version_immutable',
    )
    fails(
      await command(`${versionUrl(first)}/publish`, t.cookies.teacher, 2),
      409,
      'rubric_version_immutable',
    )
    // Bayat sürümle iş kuralı hatası değil sürüm çakışması döner.
    fails(
      await command(`${versionUrl(first)}/publish`, t.cookies.teacher, 1),
      409,
      'version_conflict',
    )
    fails(await post(`${base}/versions`, t.cookies.otherTeacher, body()), 403, 'forbidden')
    fails(
      await post(`${base}/versions`, t.cookies.teacher, body(), { 'if-match': '"2"' }),
      400,
      'if_match_not_supported',
    )
    assert.deepEqual(await snapshot(t.institution.id), before)

    const secondResponse = await post(`${base}/versions`, t.cookies.teacher, body('Yazma v2'))
    const second = await ok(secondResponse, 201)
    assert.equal(secondResponse.headers.location, `/api/v1${base}`)
    assert.equal(second.version.versionNumber, 2)
    assert.equal(second.version.status, 'draft')
    fails(
      await post(`${base}/versions`, t.cookies.teacher, body('Yazma v3')),
      409,
      'open_rubric_version_exists',
    )
    // Yönetici başkasının taslağını yayımlar.
    const v2 = await ok(await command(`${versionUrl(second)}/publish`, t.cookies.admin, 1))
    assert.equal(v2.version.status, 'published')
    const detail = await ok(await call('GET', base, t.cookies.teacher))
    assert.deepEqual(
      detail.versions.map((v: Json) => [v.versionNumber, v.status, v.rowVersion]),
      [
        [1, 'archived', 3],
        [2, 'published', 2],
      ],
    )
    assert.equal(detail.versions[0].archivedAt, v2.version.publishedAt)
    const list = await ok(await call('GET', '/rubrics', t.cookies.teacher))
    assert.equal(list[0].publishedVersionId, second.version.id)

    // Arşiv yalnız yayındaki sürümde; arşivli sürüm yeniden arşivlenmez.
    fails(
      await command(`${versionUrl(first)}/archive`, t.cookies.teacher, 3),
      409,
      'rubric_version_not_published',
    )
    const archived = await ok(await command(`${versionUrl(second)}/archive`, t.cookies.teacher, 2))
    assert.equal(archived.version.status, 'archived')
    assert.equal(archived.version.rowVersion, 3)
    // Saat sabit olduğundan sıra değil eylem kümesi denetlenir.
    const actions = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.institutionId, t.institution.id))
    assert.deepEqual(
      actions
        .map((row) => row.action)
        .filter((action) => action.startsWith('rubric.'))
        .sort(),
      [
        'rubric.archive',
        'rubric.create',
        'rubric.publish',
        'rubric.publish',
        'rubric.version_create',
      ],
    )
  })

  test('DOM-BEC-022: kullanılmış (atamaya bağlı) yayımlanmış sürüm değişmez; arşivlenir ve atama sürüme bağlı kalır', async () => {
    const t = await tenant()
    const chain = await seedSkillChain(db, t.institution.id, t.teacher.id)
    const url = `/rubrics/${chain.rubricId}/versions/${chain.rubricVersionId}`
    const detail = await ok(await call('GET', `/rubrics/${chain.rubricId}`, t.cookies.teacher))
    assert.deepEqual(detail.versions[0].usage, { assignmentCount: 1, scoreCount: 0 })
    const before = await snapshot(t.institution.id)
    fails(
      await patch(url, t.cookies.teacher, { title: 'Değişti' }, 1),
      409,
      'rubric_version_immutable',
    )
    assert.deepEqual(await snapshot(t.institution.id), before)
    const archived = await ok(await command(`${url}/archive`, t.cookies.teacher, 1))
    assert.equal(archived.version.status, 'archived')
    assert.deepEqual(archived.version.usage, { assignmentCount: 1, scoreCount: 0 })
  })

  test('DOM-BEC-022: rubrik sürümü kimlikle okunur (atamanın sabitlediği sürüm); yönetici ve öğretmen okur, arşivlenen sürüm okunmaya devam eder; başka kurumun ve olmayan sürüm 404; geçersiz kimlik 400', async () => {
    const t = await tenant()
    const chain = await seedSkillChain(db, t.institution.id, t.teacher.id)
    const url = `/rubric-versions/${chain.rubricVersionId}`
    const library = await ok(await call('GET', `/rubrics/${chain.rubricId}`, t.cookies.teacher))
    for (const cookie of [t.cookies.teacher, t.cookies.otherTeacher, t.cookies.admin])
      assert.deepEqual(await ok(await call('GET', url, cookie)), library.versions[0])
    await ok(
      await command(
        `/rubrics/${chain.rubricId}/versions/${chain.rubricVersionId}/archive`,
        t.cookies.teacher,
        1,
      ),
    )
    const archived = await ok(await call('GET', url, t.cookies.teacher))
    assert.equal(archived.status, 'archived')
    assert.deepEqual(archived.usage, { assignmentCount: 1, scoreCount: 0 })

    const other = await tenant()
    fails(await call('GET', url, other.cookies.admin), 404, 'not_found')
    fails(
      await call('GET', '/rubric-versions/00000000-0000-4000-8000-000000000009', t.cookies.admin),
      404,
      'not_found',
    )
    fails(await call('GET', '/rubric-versions/yok', t.cookies.admin), 400, 'validation_failed')
  })

  test('IST-048: liste sayfalı ve baş sürüme göre süzülür; başlık araması ve sahip süzgeci; bilinmeyen parametre 400', async () => {
    const t = await tenant()
    const mine = await create(t.cookies.teacher, body('Benim yazma rubriğim'))
    await ok(await command(`${versionUrl(mine)}/publish`, t.cookies.teacher, 1))
    const theirs = await create(t.cookies.admin, {
      ...body('Konuşma rubriği'),
      skill: 'speaking',
      criteria: [
        { ...sampleRubricData().criteria[0], id: 'range', aspect: 'range' },
        { ...sampleRubricData().criteria[1], id: 'fluency', aspect: 'fluency' },
      ],
    })
    const all = await call('GET', '/rubrics?pageSize=1', t.cookies.otherTeacher)
    assert.equal(all.statusCode, 200, all.body)
    assert.deepEqual(all.json().meta, { page: 1, pageSize: 1, total: 2 })
    // Son güncellenen önce; eşitlikte rubrik kimliği.
    const ids = (await ok(await call('GET', '/rubrics', t.cookies.otherTeacher))).map(
      (item: Json) => item.rubric.id,
    )
    assert.deepEqual(new Set(ids), new Set([mine.rubric.id, theirs.rubric.id]))

    const published = await ok(await call('GET', '/rubrics?status=published', t.cookies.teacher))
    assert.deepEqual(
      published.map((item: Json) => [item.rubric.id, item.head.status, item.publishedVersionId]),
      [[mine.rubric.id, 'published', mine.version.id]],
    )
    assert.equal(published[0].rubric.canManage, true)
    assert.equal(published[0].head.title, 'Benim yazma rubriğim')
    assert.equal(published[0].head.criteria, undefined)
    const speaking = await ok(await call('GET', '/rubrics?skill=speaking', t.cookies.teacher))
    assert.deepEqual(
      speaking.map((item: Json) => [
        item.rubric.id,
        item.publishedVersionId,
        item.rubric.canManage,
      ]),
      [[theirs.rubric.id, null, false]],
    )
    const owned = await ok(
      await call('GET', `/rubrics?ownerUserId=${t.teacher.id}&kind=analytic`, t.cookies.admin),
    )
    assert.deepEqual(
      owned.map((item: Json) => item.rubric.id),
      [mine.rubric.id],
    )
    // Başlık araması Türkçe harf ve büyük/küçük harf duyarsızdır; tek harf 400.
    const searched = await ok(await call('GET', '/rubrics?q=YAZMA%20RUBRI', t.cookies.teacher))
    assert.deepEqual(
      searched.map((item: Json) => item.rubric.id),
      [mine.rubric.id],
    )
    const folded = await ok(await call('GET', '/rubrics?q=konusma', t.cookies.teacher))
    assert.deepEqual(
      folded.map((item: Json) => item.rubric.id),
      [theirs.rubric.id],
    )
    fails(await call('GET', '/rubrics?q=y', t.cookies.teacher), 400, 'validation_failed')
    fails(await call('GET', '/rubrics?sort=title', t.cookies.teacher), 400, 'validation_failed')
    fails(await call('GET', '/rubrics?pageSize=101', t.cookies.teacher), 400, 'validation_failed')
    fails(await call('GET', '/rubrics/yok', t.cookies.teacher), 400, 'validation_failed')
    fails(await call('GET', `/rubrics/${randomUUID()}`, t.cookies.teacher), 404, 'not_found')
  })
})
