import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { coordinatorDuties } from '../src/db/schema/coordinator-duties.ts'
import { learningOutcomes } from '../src/db/schema/learning-outcomes.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'
import { seedResource } from './support/resources-sample.ts'

/**
 * Kazanım kataloğu uçları ve kaynak yazımında kazanım seçimi (ADR 0004 karar 9; DOM-KYN-011;
 * IST-030, 031). Platform kataloğu test veritabanında örnek kodlarla yüklüdür (`support/app.ts`).
 */

type Json = ReturnType<typeof JSON.parse>

const own = (code: string) => ({ outcomeId: code, outcomeSource: 'institution' as const })
const platform = (code: string) => ({ outcomeId: code, outcomeSource: 'platform' as const })
const text = <T>(outcomes: T[], title = 'Kesirlerle okuma') => ({
  title,
  content: { type: 'text' as const, body: 'Kesirler bütünün parçalarıdır.' },
  license: { kind: 'institution_original' as const },
  tags: { subjectId: 'math', gradeLevels: [7], outcomes },
})

describe('kazanım kataloğu uçları', () => {
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

  async function tenant() {
    const institution = await createInstitution(app)
    const teacher = await createMember(app, institution.id, 'ogretmen')
    const head = await createMember(app, institution.id, 'ogretmen')
    // Matematik zümre başkanı (DOM-YTK-027); görev ucu ayrı testte, satır doğrudan yazılır.
    await db.insert(coordinatorDuties).values({
      institutionId: institution.id,
      id: randomUUID(),
      membershipId: head.membershipId,
      kind: 'subject_head',
      scopeId: 'math',
      assignedByUserId: institution.admin.id,
    })
    const student = await createMember(app, institution.id, 'ogrenci')
    const parent = await createMember(app, institution.id, 'veli')
    const frontDesk = await createMember(app, institution.id, 'onburo')
    const cookies = {
      admin: await signInAs(app, institution.admin),
      teacher: await signInAs(app, teacher),
      head: await signInAs(app, head),
      student: await signInAs(app, student),
      parent: await signInAs(app, parent),
      frontDesk: await signInAs(app, frontDesk),
    }
    return { institution, cookies }
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
  type Headers = Record<string, string>
  const key = (): Headers => ({ 'idempotency-key': randomUUID() })
  const create = (cookie: string | undefined, payload: unknown, headers: Headers = key()) =>
    call('POST', '/learning-outcomes', cookie, payload, headers)
  const archive = (
    cookie: string | undefined,
    code: string,
    version?: number,
    headers: Headers = key(),
  ) =>
    call(
      'POST',
      `/learning-outcomes/${encodeURIComponent(code)}/archive`,
      cookie,
      {},
      {
        ...headers,
        ...(version === undefined ? {} : { 'if-match': `"${version}"` }),
      },
    )
  const list = (cookie: string | undefined, query = '') =>
    call('GET', `/learning-outcomes${query}`, cookie)

  async function ok(response: Awaited<ReturnType<typeof call>>, status = 200) {
    assert.equal(response.statusCode, status, response.body)
    return response.json() as Json
  }
  function fails(response: Awaited<ReturnType<typeof call>>, status: number, code: string) {
    assert.equal(response.statusCode, status, response.body)
    assert.equal(response.json().code, code, response.body)
  }
  const outcome = (code: string, subjectId = 'math', gradeLevel = 7) => ({
    code,
    name: `${code} kazanımı`,
    subjectId,
    gradeLevel,
  })

  async function snapshot(institutionId: string) {
    const rows = await db
      .select()
      .from(learningOutcomes)
      .where(eq(learningOutcomes.institutionId, institutionId))
      .orderBy(learningOutcomes.code)
    const audits = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(eq(auditLog.institutionId, institutionId))
    return { rows, audits: audits.length }
  }

  test('DOM-KYN-011: 401 oturumsuz; öğrenci, veli ve ön büro 403; modül kapalı 403', async () => {
    const t = await tenant()
    await ok(await create(t.cookies.admin, outcome('K.7.1')), 201)
    const before = await snapshot(t.institution.id)
    const requests = [
      (cookie?: string) => list(cookie),
      (cookie?: string) => create(cookie, outcome('K.7.2')),
      (cookie?: string) => archive(cookie, 'K.7.1', 1),
    ]
    for (const request of requests) {
      fails(await request(), 401, 'unauthenticated')
      for (const cookie of [t.cookies.student, t.cookies.parent, t.cookies.frontDesk])
        fails(await request(cookie), 403, 'forbidden')
    }
    assert.deepEqual(await snapshot(t.institution.id), before)

    const closed = await createInstitution(app, { enabledModules: { learning: false } })
    const admin = await signInAs(app, closed.admin)
    for (const response of [
      await list(admin),
      await create(admin, outcome('K.7.1')),
      await archive(admin, 'K.7.1', 1),
    ])
      fails(response, 403, 'module_disabled')
    assert.deepEqual((await snapshot(closed.id)).rows, [])
  })

  test('DOM-KYN-011: liste platform ve kurum kataloğunu birleşik, süzgeçli ve sayfalı verir; başka kurum yok, arşivli kod yalnız codes ile', async () => {
    const t = await tenant()
    const other = await tenant()
    await ok(await create(t.cookies.admin, outcome('KUR.7.1')), 201)
    const archived = (await ok(await create(t.cookies.admin, outcome('KUR.7.2')), 201)).data
    await ok(await archive(t.cookies.admin, 'KUR.7.2', archived.rowVersion))
    await ok(await create(other.cookies.admin, outcome('BASKA.7.1')), 201)

    const math7 = await ok(await list(t.cookies.teacher, '?subject=math&level=7&pageSize=100'))
    assert.deepEqual(
      math7.data.map((row: Json) => [row.source, row.code]),
      [
        ['platform', 'MAT.7.1.1'],
        ['platform', 'MAT.7.2.1'],
        ['platform', 'MAT.7.3.1'],
        ['platform', 'MAT.7.4.1'],
        ['institution', 'KUR.7.1'],
      ],
    )
    assert.equal(math7.meta.total, 5)
    assert.deepEqual(math7.data[0], {
      source: 'platform',
      code: 'MAT.7.1.1',
      name: 'Sayılar ve işlemler',
      subjectId: 'math',
      gradeLevel: 7,
      programVersion: 'ornek-2025',
      archivedAt: null,
      rowVersion: 1,
    })
    assert.equal(math7.data[4].programVersion, null)

    // Arama kodda ve adda, Türkçe harf duyarsız; kaynak süzgeci ve sayfa.
    const search = await ok(await list(t.cookies.teacher, '?subject=math&level=7&q=SAYILAR'))
    assert.deepEqual(
      search.data.map((row: Json) => row.code),
      ['MAT.7.1.1'],
    )
    const byCode = await ok(await list(t.cookies.admin, '?q=kur.7'))
    assert.deepEqual(
      byCode.data.map((row: Json) => row.code),
      ['KUR.7.1'],
    )
    const own = await ok(await list(t.cookies.admin, '?source=institution'))
    assert.deepEqual(
      own.data.map((row: Json) => row.code),
      ['KUR.7.1'],
    )
    const paged = await ok(await list(t.cookies.admin, '?subject=math&level=7&pageSize=2&page=3'))
    assert.deepEqual(
      paged.data.map((row: Json) => row.code),
      ['KUR.7.1'],
    )
    assert.deepEqual(paged.meta, { page: 3, pageSize: 2, total: 5 })

    // `codes`: mevcut içeriğin kazanımları arşivliler dahil çözülür; başka kurumun kodu yok.
    const resolved = await ok(
      await list(t.cookies.teacher, '?codes=kur.7.2,MAT.7.1.1,BASKA.7.1,YOK.1'),
    )
    assert.deepEqual(
      resolved.data.map((row: Json) => [row.source, row.code, row.archivedAt !== null]),
      [
        ['platform', 'MAT.7.1.1', false],
        ['institution', 'KUR.7.2', true],
      ],
    )
    fails(
      await list(
        t.cookies.admin,
        `?codes=${Array.from({ length: 51 }, (_, i) => `K${i}`).join(',')}`,
      ),
      400,
      'validation_failed',
    )

    fails(await list(t.cookies.admin, '?institutionId=x'), 400, 'validation_failed')
    fails(await list(t.cookies.admin, '?level=13'), 400, 'validation_failed')
  })

  test('DOM-KYN-011: yönetici kurum kazanımı ekler; kod büyük harfe çevrilir, Location ve denetim kaydı yazılır; aynı anahtar aynı yanıtı verir', async () => {
    const t = await tenant()
    const headers = key()
    const payload = { ...outcome('oku.7.1'), name: ' Ana fikri bulur ' }
    const first = await create(t.cookies.admin, payload, headers)
    const body = await ok(first, 201)
    assert.equal(first.headers.location, '/api/v1/learning-outcomes/OKU.7.1')
    assert.deepEqual(body.data, {
      source: 'institution',
      code: 'OKU.7.1',
      name: 'Ana fikri bulur',
      subjectId: 'math',
      gradeLevel: 7,
      programVersion: null,
      archivedAt: null,
      rowVersion: 1,
    })
    const replay = await create(t.cookies.admin, payload, headers)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.deepEqual(replay.json(), body)
    const after = await snapshot(t.institution.id)
    assert.equal(after.rows.length, 1)
    assert.equal(after.rows[0]?.createdByUserId, t.institution.admin.id)
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, t.institution.id),
          eq(auditLog.action, 'learning_outcome.create'),
        ),
      )
    assert.deepEqual(audit?.changes, { fields: ['code', 'name', 'subjectId', 'gradeLevel'] })
  })

  test('DOM-KYN-011: kod kurumda (arşivli dahil) ve öğretim programında tekildir; başka kurumda serbest; geçersiz gövde 400 ve kayıt değişmez', async () => {
    const t = await tenant()
    const other = await tenant()
    const created = (await ok(await create(t.cookies.admin, outcome('K.7.1')), 201)).data
    await ok(await archive(t.cookies.admin, 'K.7.1', created.rowVersion))
    const before = await snapshot(t.institution.id)
    fails(await create(t.cookies.admin, outcome('k.7.1')), 409, 'learning_outcome_code_taken')
    fails(await create(t.cookies.admin, outcome('MAT.7.1.1')), 409, 'learning_outcome_code_taken')
    fails(
      await create(t.cookies.admin, { ...outcome('K.7.9'), institutionId: other.institution.id }),
      400,
      'validation_failed',
    )
    fails(await create(t.cookies.admin, outcome('K 7')), 400, 'validation_failed')
    fails(await create(t.cookies.admin, outcome('K.7.9'), {}), 400, 'idempotency_key_required')
    fails(
      await create(t.cookies.admin, outcome('K.7.9'), { ...key(), 'if-match': '"1"' }),
      400,
      'if_match_not_supported',
    )
    assert.deepEqual(await snapshot(t.institution.id), before)
    assert.deepEqual((await snapshot(other.institution.id)).rows, [])
    await ok(await create(other.cookies.admin, outcome('K.7.1')), 201)
  })

  test('DOM-KYN-011, DOM-YTK-027: zümre başkanı yalnız kendi dersinde ekler ve arşivler; görevsiz öğretmen 403', async () => {
    const t = await tenant()
    const math = (await ok(await create(t.cookies.head, outcome('ZB.7.1')), 201)).data
    fails(await create(t.cookies.head, outcome('ZB.7.2', 'science')), 403, 'forbidden')
    fails(await create(t.cookies.teacher, outcome('OG.7.1')), 403, 'forbidden')
    const science = (await ok(await create(t.cookies.admin, outcome('FN.7.1', 'science')), 201))
      .data
    fails(await archive(t.cookies.head, 'FN.7.1', science.rowVersion), 403, 'forbidden')
    fails(await archive(t.cookies.teacher, 'ZB.7.1', math.rowVersion), 403, 'forbidden')
    await ok(await archive(t.cookies.head, 'ZB.7.1', math.rowVersion))
  })

  test('DOM-KYN-011: arşiv If-Match ister; yanlış sürüm 409, başka kurumun ve platformun kodu 404, ikinci arşiv 409', async () => {
    const t = await tenant()
    const other = await tenant()
    const created = (await ok(await create(t.cookies.admin, outcome('AR.7.1')), 201)).data
    await ok(await create(other.cookies.admin, outcome('B.7.1')), 201)
    const before = await snapshot(t.institution.id)
    const otherBefore = await snapshot(other.institution.id)
    fails(await archive(t.cookies.admin, 'AR.7.1'), 400, 'if_match_required')
    fails(await archive(t.cookies.admin, 'AR.7.1', 1, {}), 400, 'idempotency_key_required')
    fails(await archive(t.cookies.admin, 'AR.7.1', 7), 409, 'version_conflict')
    fails(await archive(t.cookies.admin, 'B.7.1', 1), 404, 'not_found')
    fails(await archive(t.cookies.admin, 'MAT.7.1.1', 1), 404, 'not_found')
    assert.deepEqual(await snapshot(t.institution.id), before)
    assert.deepEqual(await snapshot(other.institution.id), otherBefore)

    const archived = (await ok(await archive(t.cookies.admin, 'ar.7.1', created.rowVersion))).data
    assert.equal(archived.code, 'AR.7.1')
    assert.equal(archived.rowVersion, 2)
    assert.ok(archived.archivedAt)
    fails(await archive(t.cookies.admin, 'AR.7.1', 2), 409, 'learning_outcome_archived')
  })

  test('DOM-KYN-011: kaynakta kazanım katalogdan seçilir; olmayan, başka kurumun ve arşivli kod 422 alan yoluyla reddedilir', async () => {
    const t = await tenant()
    const other = await tenant()
    await ok(await create(other.cookies.admin, outcome('BASKA.7.1')), 201)
    const archived = (await ok(await create(t.cookies.admin, outcome('ESKI.7.1')), 201)).data
    await ok(await archive(t.cookies.admin, 'ESKI.7.1', archived.rowVersion))
    await ok(await create(t.cookies.admin, outcome('YENI.7.1')), 201)

    const cases = [
      [[platform('MAT.7.1.1'), own('YOK.7.1')], 'outcome_not_found', 1],
      [[own('BASKA.7.1')], 'outcome_not_found', 0],
      [[platform('YENI.7.1')], 'outcome_not_found', 0],
      [[own('ESKI.7.1')], 'outcome_archived', 0],
    ] as const
    for (const [outcomes, code, index] of cases) {
      const response = await call('POST', '/resources', t.cookies.admin, text([...outcomes]))
      fails(response, 422, code)
      assert.deepEqual(
        response.json().issues.map((issue: Json) => issue.path.join('.')),
        [`tags.outcomes.${index}.outcomeId`],
      )
    }
    const created = await ok(
      await call(
        'POST',
        '/resources',
        t.cookies.admin,
        text([platform('MAT.7.1.1'), own('YENI.7.1')]),
      ),
      201,
    )
    assert.deepEqual(created.data.version.tags.outcomes, [platform('MAT.7.1.1'), own('YENI.7.1')])
  })

  test('DOM-KYN-011: arşivlenen kod eski içerikte korunur; taslakta kalır ve yeni sürüme taşınır ama yeniden eklenemez', async () => {
    const t = await tenant()
    const code = (await ok(await create(t.cookies.admin, outcome('KOR.7.1')), 201)).data
    const second = (await ok(await create(t.cookies.admin, outcome('KOR.7.2')), 201)).data
    const draft = await ok(
      await call('POST', '/resources', t.cookies.admin, text([own('KOR.7.1')])),
      201,
    )
    await ok(await archive(t.cookies.admin, 'KOR.7.1', code.rowVersion))
    await ok(await archive(t.cookies.admin, 'KOR.7.2', second.rowVersion))
    const versionUrl = `/resources/${draft.data.resource.id}/versions/${draft.data.version.id}`

    // Aynı etiketlerle düzenleme: sürümde zaten bulunan arşivli kod korunur.
    const kept = await ok(
      await call(
        'PATCH',
        versionUrl,
        t.cookies.admin,
        { title: 'Yeni başlık', tags: text([own('KOR.7.1')]).tags },
        { 'if-match': `"${draft.data.version.rowVersion}"` },
      ),
    )
    assert.deepEqual(kept.data.version.tags.outcomes, [own('KOR.7.1')])
    // Başka bir arşivli kodu eklemek reddedilir; kayıt değişmez.
    const added = await call(
      'PATCH',
      versionUrl,
      t.cookies.admin,
      { tags: text([own('KOR.7.1'), own('KOR.7.2')]).tags },
      { 'if-match': `"${kept.data.version.rowVersion}"` },
    )
    fails(added, 422, 'outcome_archived')
    const detail = await ok(
      await call('GET', `/resources/${draft.data.resource.id}`, t.cookies.admin),
    )
    assert.deepEqual(detail.data.head.tags.outcomes, [own('KOR.7.1')])
    assert.equal(detail.data.head.title, 'Yeni başlık')

    // Yayındaki eski sürümden açılan yeni taslak arşivli kodu taşır.
    const { resource } = await seedResource(db, t.institution.id, {
      ownerUserId: t.institution.admin.id,
      versions: [{ status: 'published', input: text([own('KOR.7.2')]) }],
    })
    const opened = await ok(
      await call('POST', `/resources/${resource.id}/versions`, t.cookies.admin, {}),
      201,
    )
    assert.deepEqual(opened.data.version.tags.outcomes, [own('KOR.7.2')])
  })
})
