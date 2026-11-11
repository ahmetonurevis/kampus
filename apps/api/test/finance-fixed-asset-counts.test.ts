import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  fixedAssetCountItems,
  fixedAssetCounts,
} from '../src/db/schema/finance-fixed-asset-counts.ts'
import { fixedAssets } from '../src/db/schema/finance-fixed-assets.ts'
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

/**
 * Demirbaş sayımı uçları (DOM-FIN-087; ON-237). Her test kendi kurumunu kurar; kurumda seed
 * kampüsleri vardır (b1 Kadıköy, b2 Beşiktaş). FIXED_NOW 2026-10-06.
 */

const SEED = createSeed(FIXED_NOW)
const KADIKOY = SEED.branches[0]?.id ?? ''
const KADIKOY_NAME = SEED.branches[0]?.name ?? ''
const BESIKTAS = SEED.branches[1]?.id ?? ''
const FINANCE = '/api/v1/finance'
const ASSETS = `${FINANCE}/fixed-assets`
const COUNTS = `${FINANCE}/fixed-asset-counts`
const PLACES = `${FINANCE}/fixed-asset-places`
const LAB = '2. kat fen laboratuvarı'

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-087: demirbaş sayımı uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.87.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    cookie: string | null,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url,
      remoteAddress: clientIp,
      headers: {
        origin: TEST_ORIGIN,
        ...(cookie === null ? {} : { cookie }),
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
  }
  const get = (url: string, cookie: string | null) => call('GET', url, cookie)
  const ifMatch = (version: unknown) => ({ 'if-match': `"${String(version)}"` })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.87.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(
      db,
      created.id,
      SEED.branches.map((data) => ({ collection: 'branches' as const, id: data.id, data })),
      FIXED_NOW,
    )
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  const createAsset = async (t: Tenant, body: Json) =>
    ok(
      await call('POST', ASSETS, t.admin, {
        category: 'it',
        acquisitionValueCents: 1_500_000,
        acquisitionDate: '2026-09-01',
        ...body,
      }),
      201,
    )
  /** Kadıköy'de iki laboratuvar demirbaşı, bir müdür odası, Beşiktaş'ta bir kütüphane demirbaşı. */
  async function stocked(t: Tenant) {
    const board = await createAsset(t, { name: 'Akıllı tahta', campusId: KADIKOY, location: LAB })
    const microscope = await createAsset(t, {
      name: 'Mikroskop',
      campusId: KADIKOY,
      location: '2. KAT Fen Laboratuvarı',
    })
    const desk = await createAsset(t, {
      name: 'Çalışma masası',
      campusId: KADIKOY,
      location: 'Müdür odası',
    })
    const shelf = await createAsset(t, {
      name: 'Kitaplık',
      campusId: BESIKTAS,
      location: 'Kütüphane',
    })
    return { board, microscope, desk, shelf }
  }
  const start = (cookie: string, body: Json, headers: Record<string, string> = {}) =>
    call('POST', COUNTS, cookie, body, headers)
  const ROOM = { scopeType: 'location', campusId: KADIKOY, location: LAB }
  const scanUrl = (count: Json) => `${COUNTS}/${String(count.id)}/scans`
  const scan = (cookie: string, count: Json, body: Json, headers: Record<string, string> = {}) =>
    call('POST', scanUrl(count), cookie, body, headers)
  const finish = (
    cookie: string,
    count: Json,
    verb: 'complete' | 'cancel',
    version = count.version,
  ) => call('POST', `${COUNTS}/${String(count.id)}/${verb}`, cookie, {}, ifMatch(version))
  const relocate = (cookie: string, count: Json, item: Json) =>
    call(
      'POST',
      `${COUNTS}/${String(count.id)}/items/${String(item.id)}/relocate`,
      cookie,
      {},
      ifMatch(item.version),
    )
  const itemsOf = async (cookie: string, count: Json, query = '') => {
    const response = await get(`${COUNTS}/${String(count.id)}/items${query}`, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Json[]; meta: { total: number } }
  }
  const listOf = async (cookie: string, query = '') => {
    const response = await get(`${COUNTS}${query}`, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Json[]; meta: { total: number } }
  }
  const countRows = (institutionId: string) =>
    db.select().from(fixedAssetCounts).where(eq(fixedAssetCounts.institutionId, institutionId))
  const itemRows = (institutionId: string) =>
    db
      .select()
      .from(fixedAssetCountItems)
      .where(eq(fixedAssetCountItems.institutionId, institutionId))
  const member = async (institutionId: string, role: Parameters<typeof createMember>[2]) =>
    signInAs(app, await createMember(app, institutionId, role))

  test('kimliksiz istek 401', async () => {
    const url = `${COUNTS}/${randomUUID()}`
    assertError(await get(COUNTS, null), 401)
    assertError(await get(PLACES, null), 401)
    assertError(await get(url, null), 401)
    assertError(await get(`${url}/items`, null), 401)
    assertError(await call('POST', COUNTS, null, { scopeType: 'institution' }), 401)
    assertError(await call('POST', `${url}/scans`, null, { code: 'DB-2026-0001' }), 401)
    assertError(await call('POST', `${url}/complete`, null, {}, ifMatch(1)), 401)
    assertError(await call('POST', `${url}/cancel`, null, {}, ifMatch(1)), 401)
    assertError(
      await call('POST', `${url}/items/${randomUUID()}/relocate`, null, {}, ifMatch(1)),
      401,
    )
  })

  test('DOM-FIN-087: ön büro, öğretmen, veli ve öğrenci 403; sayım değişmez (K-189)', async () => {
    const t = await institution()
    await stocked(t)
    const count = ok(await start(t.admin, ROOM), 201)
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(COUNTS, cookie), 403)
      assertError(await get(PLACES, cookie), 403)
      assertError(await get(`${COUNTS}/${String(count.id)}`, cookie), 403)
      assertError(await get(`${COUNTS}/${String(count.id)}/items`, cookie), 403)
      assertError(await start(cookie, { scopeType: 'institution' }), 403)
      assertError(await scan(cookie, count, { code: 'DB-2026-0001' }), 403)
      assertError(await finish(cookie, count, 'complete'), 403)
      assertError(await finish(cookie, count, 'cancel'), 403)
    }
    const [row] = await countRows(t.id)
    assert.equal(row?.status, 'open')
    assert.equal(row?.version, 1)
    assert.equal(
      (await itemRows(t.id)).every((item) => item.result === 'pending'),
      true,
    )
  })

  test('DOM-FIN-087: finance modülü kapalıyken sayım uçları 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(COUNTS, closed.admin), 403, 'module_disabled')
    assertError(await get(PLACES, closed.admin), 403, 'module_disabled')
    assertError(await start(closed.admin, { scopeType: 'institution' }), 403, 'module_disabled')
    assert.equal((await countRows(closed.id)).length, 0)
  })

  test('DOM-FIN-087: oda sayımı beklenen listeyi harf farkı gözetmeden dondurur; denetimde yalnız alan adları (K-232)', async () => {
    const t = await institution()
    const { board, microscope } = await stocked(t)
    const response = await start(t.admin, {
      ...ROOM,
      location: '2. Kat FEN laboratuvarı',
      note: 'Yıl sonu',
    })
    const count = ok(response, 201)
    assert.equal(response.headers.location, `${COUNTS}/${String(count.id)}`)
    assert.equal(count.scopeType, 'location')
    assert.equal(count.campusName, KADIKOY_NAME)
    assert.equal(count.status, 'open')
    assert.equal(count.startedAt, FIXED_NOW.toISOString())
    assert.deepEqual(count.summary, { expected: 2, found: 0, misplaced: 0, pending: 2, extra: 0 })
    const items = await itemsOf(t.admin, count)
    assert.deepEqual(
      items.data.map((item) => [item.tagNumber, item.result, item.inScope]),
      [
        [board.tagNumber, 'pending', true],
        [microscope.tagNumber, 'pending', true],
      ],
    )
    assert.equal(items.data[0]?.recordedCampusName, KADIKOY_NAME)
    assert.deepEqual(ok(await get(`${COUNTS}/${String(count.id)}`, t.admin)), count)

    // Sonradan değişen demirbaş beklenen listeyi değiştirmez (dondurulmuş kopya).
    ok(
      await call(
        'PATCH',
        `${ASSETS}/${String(board.id)}`,
        t.admin,
        { name: 'Yeni ad' },
        ifMatch(board.version),
      ),
    )
    assert.equal((await itemsOf(t.admin, count)).data[0]?.assetName, 'Akıllı tahta')

    const audits = await db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'fixed_asset_count.start')))
    assert.equal(audits.length, 1)
    assert.deepEqual(audits[0]?.changes, { fields: ['scopeType', 'campusId', 'location', 'note'] })
  })

  test('DOM-FIN-087: kurum ve kampüs kapsamı; hurdaya ayrılan sayılmaz; boş kapsam ve olmayan kampüs 422; gövde hatası 400', async () => {
    const t = await institution()
    const { desk } = await stocked(t)
    ok(
      await call(
        'POST',
        `${ASSETS}/${String(desk.id)}/scrap`,
        t.admin,
        { reason: 'Kırık masa', scrapDate: '2026-10-01' },
        ifMatch(desk.version),
      ),
    )
    const whole = ok(await start(t.admin, { scopeType: 'institution' }), 201)
    assert.equal((whole.summary as Json).expected, 3)
    const campus = ok(await start(t.admin, { scopeType: 'campus', campusId: BESIKTAS }), 201)
    assert.equal((campus.summary as Json).expected, 1)
    const cases: [Json, number, string?][] = [
      [{ scopeType: 'campus', campusId: 'yok-kampus' }, 422, 'fixed_asset_campus_not_found'],
      [{ scopeType: 'location', location: 'Depo' }, 422, 'fixed_asset_count_empty'],
      [{ scopeType: 'campus' }, 400],
      [{ scopeType: 'room' }, 400],
      [{ scopeType: 'institution', location: 'Oda' }, 400],
    ]
    for (const [body, status, code] of cases) assertError(await start(t.admin, body), status, code)
    assert.equal((await countRows(t.id)).length, 2)
  })

  test('DOM-FIN-087: aynı kapsamda tek açık sayım 409; kapanınca yenisi açılır; başka kapsam serbest (K-234)', async () => {
    const t = await institution()
    await stocked(t)
    const first = ok(await start(t.admin, ROOM), 201)
    assertError(
      await start(t.admin, { ...ROOM, location: ' 2. KAT fen   laboratuvarı ' }),
      409,
      'fixed_asset_count_open_exists',
    )
    ok(await start(t.admin, { scopeType: 'institution' }), 201)
    assert.equal((await countRows(t.id)).length, 2)
    ok(await finish(t.admin, first, 'cancel'))
    ok(await start(t.admin, ROOM), 201)
  })

  test('DOM-FIN-087: okutma bulundu, yanlış konumda, listede olmayan ve tekrarı işaretler; özet güncellenir (K-233)', async () => {
    const t = await institution()
    const { board, microscope, desk, shelf } = await stocked(t)
    const count = ok(await start(t.admin, { scopeType: 'campus', campusId: KADIKOY }), 201)

    const found = ok(
      await scan(t.admin, count, {
        code: ` ${String(board.tagNumber).toLowerCase()} `,
        location: LAB,
      }),
    )
    assert.equal(found.outcome, 'found')
    assert.equal((found.item as Json).observedCampusName, KADIKOY_NAME)
    assert.equal((found.item as Json).scannedAt, FIXED_NOW.toISOString())

    const moved = ok(
      await scan(t.admin, count, {
        code: String(desk.tagNumber).replaceAll('-', '*'),
        campusId: BESIKTAS,
        location: LAB,
      }),
    )
    assert.equal(moved.outcome, 'misplaced', 'kampüs sayımında kampüs gövdeden alınmaz')
    assert.equal((moved.item as Json).observedCampusId, KADIKOY)

    const extra = ok(await scan(t.admin, count, { code: shelf.tagNumber, location: LAB }))
    assert.equal(extra.outcome, 'misplaced')
    assert.equal((extra.item as Json).inScope, false)
    assert.equal((extra.item as Json).recordedLocation, 'Kütüphane')

    const again = ok(await scan(t.admin, count, { code: board.tagNumber, location: 'Depo' }))
    assert.equal(again.outcome, 'already_counted')
    assert.equal((again.item as Json).observedLocation, LAB)
    assert.deepEqual(again.summary, { expected: 3, found: 1, misplaced: 2, pending: 1, extra: 1 })

    const pending = await itemsOf(t.admin, count, '?result=pending')
    assert.deepEqual(
      pending.data.map((item) => item.tagNumber),
      [microscope.tagNumber],
    )
    assert.equal((await itemsOf(t.admin, count, '?inScope=false')).meta.total, 1)
    assert.equal((await itemsOf(t.admin, count, '?q=mikro')).meta.total, 1)
    const [stored] = await countRows(t.id)
    assert.equal(stored?.version, 1, 'okutma sayım sürümünü artırmaz')
  })

  test('DOM-FIN-087: okutma reddi: bilinmeyen kod, başka kurumun etiketi, hurda, eksik konum, kapalı sayım; satır değişmez (K-233)', async () => {
    const a = await institution()
    const b = await institution()
    const { board, desk } = await stocked(a)
    const bAsset = await createAsset(b, {
      name: 'Beta tahta',
      location: 'Beta oda',
      tagNumber: 'BETA-1',
    })
    const count = ok(await start(a.admin, { scopeType: 'institution' }), 201)
    ok(
      await call(
        'POST',
        `${ASSETS}/${String(desk.id)}/scrap`,
        a.admin,
        { reason: 'Kırık masa', scrapDate: '2026-10-01' },
        ifMatch(desk.version),
      ),
    )
    const before = await itemRows(a.id)
    const cases: [Json, number, string?][] = [
      [{ code: 'YOK-0001', location: LAB }, 422, 'fixed_asset_count_code_unknown'],
      [{ code: bAsset.tagNumber, location: LAB }, 422, 'fixed_asset_count_code_unknown'],
      [{ code: desk.tagNumber, location: LAB }, 422, 'fixed_asset_count_asset_scrapped'],
      [{ code: board.tagNumber }, 422, 'fixed_asset_count_location_required'],
      [
        { code: board.tagNumber, campusId: 'yok', location: LAB },
        422,
        'fixed_asset_campus_not_found',
      ],
      [{ code: '   ', location: LAB }, 400],
      [{ code: board.tagNumber, location: 'A' }, 400],
      [{ code: board.tagNumber, location: LAB, institutionId: b.id }, 400],
    ]
    for (const [body, status, code] of cases)
      assertError(await scan(a.admin, count, body), status, code)
    assert.deepEqual(await itemRows(a.id), before)

    ok(await finish(a.admin, count, 'complete'))
    assertError(
      await scan(a.admin, count, { code: board.tagNumber, location: LAB }),
      422,
      'fixed_asset_count_closed',
    )
    assert.equal(
      (await itemRows(a.id)).every((item) => item.result === 'pending'),
      true,
    )
    const [bRow] = await db.select().from(fixedAssets).where(eq(fixedAssets.institutionId, b.id))
    assert.equal(bRow?.version, 1)
  })

  test('DOM-FIN-087: tamamlama demirbaşı değiştirmez; okunmayan bulunamadı; son sayım ayrıntıda (K-234, K-235)', async () => {
    const t = await institution()
    const { board, microscope } = await stocked(t)
    const count = ok(await start(t.admin, ROOM), 201)
    ok(await scan(t.admin, count, { code: board.tagNumber }))
    const assetsBefore = await db
      .select()
      .from(fixedAssets)
      .where(eq(fixedAssets.institutionId, t.id))

    assertError(await finish(t.admin, count, 'complete', 7), 409, 'version_conflict')
    assertError(
      await call('POST', `${COUNTS}/${String(count.id)}/complete`, t.admin, {}),
      400,
      'if_match_required',
    )
    const done = ok(await finish(t.admin, count, 'complete'))
    assert.equal(done.status, 'completed')
    assert.equal(done.completedAt, FIXED_NOW.toISOString())
    assert.equal(done.version, 2)
    assert.deepEqual(done.summary, { expected: 2, found: 1, misplaced: 0, pending: 1, extra: 0 })
    assertError(await finish(t.admin, done, 'complete'), 422, 'fixed_asset_count_closed')
    assertError(await finish(t.admin, done, 'cancel'), 422, 'fixed_asset_count_closed')

    assert.deepEqual(
      await db.select().from(fixedAssets).where(eq(fixedAssets.institutionId, t.id)),
      assetsBefore,
      'demirbaş kayıtları değişmez; bulunamayan hurdaya ayrılmaz',
    )
    const missing = ok(await get(`${ASSETS}/${String(microscope.id)}`, t.admin))
    assert.deepEqual(missing.lastCount, {
      countId: count.id,
      completedAt: FIXED_NOW.toISOString(),
      outcome: 'missing',
    })
    assert.equal(missing.status, 'in_use')
    const seen = ok(await get(`${ASSETS}/${String(board.id)}`, t.admin))
    assert.equal((seen.lastCount as Json).outcome, 'found')
    const never = await createAsset(t, { name: 'Yeni', location: 'Depo' })
    assert.equal(never.lastCount, null)

    const listed = await listOf(t.admin, '?status=completed')
    assert.deepEqual(
      listed.data.map((item) => item.id),
      [count.id],
    )
    assert.equal((await listOf(t.admin, '?status=open')).meta.total, 0)
  })

  test('DOM-FIN-087: iptal edilen sayımda okutmalar saklanır; iptal sayım son sayım sayılmaz (K-234)', async () => {
    const t = await institution()
    const { board } = await stocked(t)
    const count = ok(await start(t.admin, ROOM), 201)
    ok(await scan(t.admin, count, { code: board.tagNumber }))
    const cancelled = ok(await finish(t.admin, count, 'cancel'))
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(cancelled.cancelledAt, FIXED_NOW.toISOString())
    assert.equal((cancelled.summary as Json).found, 1)
    assert.equal(ok(await get(`${ASSETS}/${String(board.id)}`, t.admin)).lastCount, null)
    const [item] = (await itemsOf(t.admin, count, '?result=found')).data
    assertError(await relocate(t.admin, count, item ?? {}), 422, 'fixed_asset_count_not_completed')
  })

  test('DOM-FIN-087: konum düzeltmesi demirbaşı sayılan yere taşır, bir kez yapılır (K-235)', async () => {
    const t = await institution()
    const { board, desk } = await stocked(t)
    const count = ok(await start(t.admin, { scopeType: 'institution' }), 201)
    const moved = ok(
      await scan(t.admin, count, {
        code: desk.tagNumber,
        campusId: BESIKTAS,
        location: 'Kütüphane',
      }),
    )
    const found = ok(
      await scan(t.admin, count, { code: board.tagNumber, campusId: KADIKOY, location: LAB }),
    )
    const item = moved.item as Json
    assertError(await relocate(t.admin, count, item), 422, 'fixed_asset_count_not_completed')
    ok(await finish(t.admin, count, 'complete'))
    assertError(
      await relocate(t.admin, count, found.item as Json),
      422,
      'fixed_asset_count_item_not_misplaced',
    )
    assertError(await relocate(t.admin, count, { ...item, version: 9 }), 409, 'version_conflict')

    const relocated = ok(await relocate(t.admin, count, item))
    assert.equal(relocated.relocatedAt, FIXED_NOW.toISOString())
    assert.equal(relocated.version, (item.version as number) + 1)
    const asset = ok(await get(`${ASSETS}/${String(desk.id)}`, t.admin))
    assert.equal(asset.campusId, BESIKTAS)
    assert.equal(asset.location, 'Kütüphane')
    assert.equal(asset.version, (desk.version as number) + 1)
    assert.equal(asset.status, 'in_use')
    assertError(await relocate(t.admin, count, relocated), 422, 'fixed_asset_count_item_relocated')
    const actions = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.entityId, String(desk.id))))
    assert.equal(
      actions.some((row) => row.action === 'fixed_asset.update'),
      true,
    )
  })

  test('DOM-FIN-087: yer listesi hurdasız demirbaşların kampüs ve konumlarını sayıyla verir', async () => {
    const t = await institution()
    await stocked(t)
    const response = await get(PLACES, t.admin)
    assert.equal(response.statusCode, 200, response.body)
    const places = response.json() as { data: Json[]; meta: { total: number } }
    assert.equal(places.meta.total, 4)
    assert.equal(places.data.find((place) => place.location === LAB)?.campusName, KADIKOY_NAME)
    const filtered = await get(`${PLACES}?q=kutup&campusId=${BESIKTAS}`, t.admin)
    assert.deepEqual(
      (filtered.json() as { data: Json[] }).data.map((place) => [place.location, place.assetCount]),
      [['Kütüphane', 1]],
    )
  })

  test('DOM-FIN-087: başka kurumun sayımı ve satırı 404 ve B değişmez; listede yok; gövdedeki institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bAssets = await stocked(b)
    const bCount = ok(await start(b.admin, { scopeType: 'institution' }), 201)
    const bScan = ok(
      await scan(b.admin, bCount, { code: bAssets.desk.tagNumber, location: 'Depo' }),
    )
    const bItem = bScan.item as Json
    const bUrl = `${COUNTS}/${String(bCount.id)}`
    await stocked(a)

    assertError(await get(bUrl, a.admin), 404)
    assertError(await get(`${bUrl}/items`, a.admin), 404)
    assertError(await scan(a.admin, bCount, { code: bAssets.board.tagNumber, location: LAB }), 404)
    assertError(await finish(a.admin, bCount, 'complete'), 404)
    assertError(await finish(a.admin, bCount, 'cancel'), 404)
    assertError(await relocate(a.admin, bCount, bItem), 404)
    assert.equal((await listOf(a.admin)).meta.total, 0)
    const places = (await get(PLACES, a.admin)).json() as { meta: { total: number } }
    assert.equal(places.meta.total, 4)
    assertError(await start(a.admin, { scopeType: 'institution', institutionId: b.id }), 400)
    assert.equal((await countRows(a.id)).length, 0)
    const [bRow] = await countRows(b.id)
    assert.equal(bRow?.status, 'open')
    assert.equal(bRow?.version, 1)
    assert.equal((await itemRows(b.id)).filter((item) => item.result !== 'pending').length, 1)
  })

  test('DOM-FIN-087: Idempotency-Key ile yinelenen başlatma ve okutma aynı yanıtı döner', async () => {
    const t = await institution()
    const { board } = await stocked(t)
    const headers = { 'idempotency-key': randomUUID() }
    const first = await start(t.admin, ROOM, headers)
    const second = await start(t.admin, ROOM, headers)
    assert.equal(second.statusCode, 201)
    assert.equal(second.headers['idempotent-replayed'], 'true')
    assert.equal(second.json().data.id, first.json().data.id)
    assert.equal((await countRows(t.id)).length, 1)
    const count = first.json().data as Json
    const scanKey = { 'idempotency-key': randomUUID() }
    const once = await scan(t.admin, count, { code: board.tagNumber }, scanKey)
    const twice = await scan(t.admin, count, { code: board.tagNumber }, scanKey)
    assert.equal(once.json().data.outcome, 'found')
    assert.equal(twice.json().data.outcome, 'found')
    assert.equal(twice.headers['idempotent-replayed'], 'true')
  })
})
