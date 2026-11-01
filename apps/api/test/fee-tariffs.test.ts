import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
  type InstitutionOverrides,
} from './support/app.ts'

/** Ücret tarifesi uçları (ADR 0006 karar 8; DOM-FIN-002, -004, -006; IST-104). */

const TUITION = {
  kind: 'tuition',
  level: '7',
  amountCents: 30_000_000,
  unit: 'year',
  vatBasisPoints: 1000,
  vatEffectiveDate: '2026-01-01',
  announcedAmountCents: 30_000_000,
}
const DRAFT = { academicYear: 2026, items: [TUITION] }
const PUBLISH = { announcedDate: '2026-05-01', mebbisRecordedDate: '2026-05-02' }

describe('ücret tarifesi uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    const created = await createInstitution(app, overrides)
    return { ...created, cookie: await signInAs(app, created.admin) }
  }
  async function member(institutionId: string, role: Role) {
    return signInAs(app, await createMember(app, institutionId, role, []))
  }
  function send(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    cookie: string | null,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url,
      headers: {
        origin: TEST_ORIGIN,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(cookie === null ? {} : { cookie }),
        ...headers,
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    })
  }
  const ifMatch = (version: number) => ({ 'if-match': `"${String(version)}"` })
  const create = (cookie: string | null, body: unknown = DRAFT) =>
    send('POST', '/api/v1/fee-tariffs', cookie, body)
  const publish = (cookie: string, id: string, version: number, body: unknown = PUBLISH) =>
    send('POST', `/api/v1/fee-tariffs/${id}/publish`, cookie, body, ifMatch(version))
  const update = (cookie: string, id: string, version: number, body: unknown) =>
    send('PATCH', `/api/v1/fee-tariffs/${id}`, cookie, body, ifMatch(version))
  function assertError(
    response: Awaited<ReturnType<typeof send>>,
    statusCode: number,
    code?: string,
  ) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  test('DOM-FIN-052: oturumsuz 401; yazma yalnız yönetici, okuma yönetici ve ön büro; modül kapalı 403', async () => {
    assertError(await create(null), 401)
    assertError(await send('GET', '/api/v1/fee-tariffs', null), 401)
    const a = await institution()
    const created = await create(a.cookie)
    assert.equal(created.statusCode, 201, created.body)
    const desk = await member(a.id, 'onburo')
    assertError(await create(desk, { ...DRAFT, academicYear: 2027 }), 403, 'forbidden')
    const list = await send('GET', '/api/v1/fee-tariffs', desk)
    assert.equal(list.json().meta.total, 1)
    for (const role of ['ogretmen', 'ogrenci', 'veli'] as const)
      assertError(
        await send('GET', '/api/v1/fee-tariffs', await member(a.id, role)),
        403,
        'forbidden',
      )
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await create(closed.cookie), 403, 'module_disabled')
  })

  test('DOM-FIN-002: taslak açılır, düzenlenir, yayımlanır; yayımlanan değişmez; denetim kaydı yazılır', async () => {
    const a = await institution()
    const created = await create(a.cookie)
    assert.equal(created.statusCode, 201, created.body)
    const draft = created.json().data
    assert.equal(created.headers.location, `/api/v1/fee-tariffs/${String(draft.id)}`)
    assert.equal(draft.status, 'draft')
    assert.equal(draft.versionNumber, 1)
    assertError(await create(a.cookie), 409, 'open_tariff_draft')

    const meal = { ...TUITION, kind: 'meal', level: null, announcedAmountCents: null }
    assertError(
      await update(a.cookie, draft.id, draft.version + 1, { items: [TUITION] }),
      409,
      'version_conflict',
    )
    const edited = await update(a.cookie, draft.id, draft.version, { items: [TUITION, meal] })
    assert.equal(edited.statusCode, 200, edited.body)
    assert.equal(edited.json().data.items.length, 2)

    assertError(await publish(a.cookie, draft.id, draft.version), 409, 'version_conflict')
    const published = await publish(a.cookie, draft.id, edited.json().data.version)
    assert.equal(published.statusCode, 200, published.body)
    assert.equal(published.json().data.status, 'published')
    assert.equal(published.json().data.announcedDate, PUBLISH.announcedDate)
    assert.equal(published.json().data.mebbisRecordedDate, PUBLISH.mebbisRecordedDate)

    assertError(
      await update(a.cookie, draft.id, published.json().data.version, { items: [TUITION] }),
      409,
      'tariff_not_draft',
    )
    const rows = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.entityId, draft.id)))
    assert.deepEqual(rows.map((row) => row.action).sort(), [
      'tariff.create',
      'tariff.publish',
      'tariff.update',
    ])
  })

  test('DOM-FIN-002: yeni sürüm yayımlanınca önceki sürüm aynı işlemde kalkar', async () => {
    const a = await institution()
    const first = (await create(a.cookie)).json().data
    const firstPublished = await publish(a.cookie, first.id, first.version)
    assert.equal(firstPublished.statusCode, 200, firstPublished.body)
    const second = (await create(a.cookie)).json().data
    assert.equal(second.versionNumber, 2)
    assert.equal((await publish(a.cookie, second.id, second.version)).statusCode, 200)
    const old = await send('GET', `/api/v1/fee-tariffs/${String(first.id)}`, a.cookie)
    assert.equal(old.json().data.status, 'superseded')
    assert.deepEqual(old.json().data.items, [TUITION])
    const year = await send('GET', '/api/v1/fee-tariffs?academicYear=2026', a.cookie)
    assert.deepEqual(
      year.json().data.map((row: { versionNumber: number }) => row.versionNumber),
      [2, 1],
    )
    const none = await send('GET', '/api/v1/fee-tariffs?academicYear=2030', a.cookie)
    assert.equal(none.json().meta.total, 0)
  })

  test('DOM-FIN-006: birim kurum türüne uyar; dil okulunda ders saati kabul edilir', async () => {
    const school = await institution()
    const wrong = (
      await create(school.cookie, { ...DRAFT, items: [{ ...TUITION, unit: 'lesson_hour' }] })
    ).json().data
    assertError(await publish(school.cookie, wrong.id, wrong.version), 422, 'tariff_unit_mismatch')

    const language = await institution({ type: 'language_school' })
    const hourly = (
      await create(language.cookie, {
        ...DRAFT,
        items: [{ ...TUITION, unit: 'lesson_hour', announcedAmountCents: null }],
      })
    ).json().data
    assert.equal((await publish(language.cookie, hourly.id, hourly.version)).statusCode, 200)
  })

  test('DOM-FIN-004: gövde katıdır; serbest kalem adı ve institutionId 400, kayıt yazılmaz', async () => {
    const a = await institution()
    assertError(
      await create(a.cookie, { ...DRAFT, items: [{ ...TUITION, kind: 'bagis' }] }),
      400,
      'validation_failed',
    )
    assertError(await create(a.cookie, { ...DRAFT, institutionId: a.id }), 400, 'validation_failed')
    assertError(await create(a.cookie, { academicYear: 2026, items: [] }), 400, 'validation_failed')
    assertError(await send('GET', '/api/v1/fee-tariffs?x=1', a.cookie), 400)
    assert.equal((await send('GET', '/api/v1/fee-tariffs', a.cookie)).json().meta.total, 0)
    assertError(
      await send('POST', '/api/v1/fee-tariffs', a.cookie, DRAFT, ifMatch(1)),
      400,
      'if_match_not_supported',
    )
  })

  test('DOM-YTK-001: başka kurumun tarifesi 404; öteki kurum değişmez', async () => {
    const a = await institution()
    const b = await institution()
    const foreign = (await create(b.cookie)).json().data
    assertError(await send('GET', `/api/v1/fee-tariffs/${String(foreign.id)}`, a.cookie), 404)
    assertError(await update(a.cookie, foreign.id, foreign.version, { items: [TUITION] }), 404)
    assertError(await publish(a.cookie, foreign.id, foreign.version), 404)
    const after = await send('GET', `/api/v1/fee-tariffs/${String(foreign.id)}`, b.cookie)
    assert.equal(after.json().data.status, 'draft')
    assert.equal(after.json().data.version, foreign.version)
    assert.equal((await send('GET', '/api/v1/fee-tariffs', a.cookie)).json().meta.total, 0)
  })

  test('aynı Idempotency-Key ikinci taslak açmaz, ilk yanıtı döner', async () => {
    const a = await institution()
    const headers = { 'idempotency-key': 'test-tariff-00001' }
    const first = await send('POST', '/api/v1/fee-tariffs', a.cookie, DRAFT, headers)
    assert.equal(first.statusCode, 201, first.body)
    const second = await send('POST', '/api/v1/fee-tariffs', a.cookie, DRAFT, headers)
    assert.equal(second.statusCode, 201, second.body)
    assert.deepEqual(second.json(), first.json())
    assert.equal(second.headers['idempotent-replayed'], 'true')
  })
})
