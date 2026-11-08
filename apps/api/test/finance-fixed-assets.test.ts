import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
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
 * Demirbaş uçları (DOM-FIN-085; ON-235). Her test kendi kurumunu kurar; kurumda seed kampüsleri
 * vardır. Mal kabul bağı gereken testler sipariş zincirini API'den kurar: 3 projektör sipariş
 * edilir, 2'si kabul edilir. FIXED_NOW 2026-10-06.
 */

const SEED = createSeed(FIXED_NOW)
const CAMPUS = SEED.branches[0]?.id ?? ''
const CAMPUS_NAME = SEED.branches[0]?.name ?? ''
const FINANCE = '/api/v1/finance'
const ASSETS = `${FINANCE}/fixed-assets`
const RECEIPT_ITEMS = `${ASSETS}/receipt-items`
const BOARD = {
  name: 'Akıllı tahta',
  category: 'audiovisual',
  campusId: CAMPUS,
  location: '2. kat 5-A sınıfı',
  acquisitionValueCents: 4_500_000,
  acquisitionDate: '2026-09-01',
}
const DESK = {
  name: 'Öğretmen masası',
  category: 'furniture',
  location: 'Öğretmenler odası',
  acquisitionValueCents: 650_000,
  acquisitionDate: '2026-08-15',
  status: 'in_storage',
}

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-085: demirbaş uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.85.0.1'

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
  const key = () => ({ 'idempotency-key': randomUUID() })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.85.${String((tenantCount += 1))}.1`
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
  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))
  const create = async (t: Tenant, body: Json) => ok(await call('POST', ASSETS, t.admin, body), 201)
  const update = (cookie: string, asset: Json, body: Json) =>
    call('PATCH', `${ASSETS}/${String(asset.id)}`, cookie, body, ifMatch(asset.version))
  const scrap = (cookie: string, asset: Json, body: Json) =>
    call('POST', `${ASSETS}/${String(asset.id)}/scrap`, cookie, body, ifMatch(asset.version))
  const rowsOf = (institutionId: string) =>
    db.select().from(fixedAssets).where(eq(fixedAssets.institutionId, institutionId))
  const listOf = async (cookie: string, query = '') => {
    const response = await get(`${ASSETS}${query}`, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Json[]; meta: { total: number } }
  }
  /** Bütçe, tedarikçi, onaylı talep, seçili teklif, gönderilmiş sipariş ve 2 adetlik kabul. */
  async function withReceipt(t: Tenant) {
    const post = async (url: string, body: Json) =>
      ok(await call('POST', `${FINANCE}${url}`, t.admin, body), 201)
    const center = await post('/cost-centers', { code: 'BT', name: 'Bilgi İşlem', type: 'unit' })
    const expense = await post('/budget-items', { code: 'G-200', name: 'Donanım', kind: 'expense' })
    const period = await post('/budget-periods', { name: '2026–2027', academicYear: 2026 })
    ok(
      await call(
        'POST',
        `${FINANCE}/budget-periods/${String(period.id)}/open`,
        t.admin,
        undefined,
        ifMatch(period.version),
      ),
    )
    await post(`/budget-periods/${String(period.id)}/lines`, {
      costCenterId: center.id,
      itemId: expense.id,
      amountCents: 10_000_000,
    })
    const vendor = await post('/suppliers', {
      name: 'Beta Teknoloji Ltd.',
      type: 'company',
      taxNumber: '1111111114',
      taxOffice: 'Kadıköy',
      categories: ['it'],
    })
    const request = await post('/purchase-requests', {
      costCenterId: center.id,
      periodId: period.id,
      budgetItemId: expense.id,
      justification: 'Sınıflar için projektör alımı',
      items: [
        { name: 'Projektör', quantity: 3, unit: 'piece', estimatedUnitPriceCents: 1_500_000 },
      ],
    })
    const submitted = ok(
      await call(
        'POST',
        `${FINANCE}/purchase-requests/${String(request.id)}/submit`,
        t.admin,
        undefined,
        ifMatch(request.version),
      ),
    )
    const approved = ok(
      await call(
        'POST',
        `${FINANCE}/purchase-requests/${String(request.id)}/approve`,
        t.admin,
        {},
        ifMatch(submitted.version),
      ),
    )
    const requestItem = (approved.items as Json[])[0]?.id
    const board = await post(`/purchase-requests/${String(request.id)}/quotes`, {
      supplierId: vendor.id,
      deliveryDays: 7,
      validUntil: '2026-10-20',
      items: [{ requestItemId: requestItem, unitPriceCents: 1_200_000, vatRate: 20 }],
    })
    const quote = (board.quotes as Json[])[0] as Json
    ok(
      await call(
        'POST',
        `${FINANCE}/purchase-requests/${String(request.id)}/quotes/${String(quote.id)}/select`,
        t.admin,
        {},
        ifMatch(quote.version),
      ),
    )
    const order = ok(
      await call('POST', `${FINANCE}/purchase-orders`, t.admin, { quoteId: quote.id }, key()),
      201,
    )
    const sent = ok(
      await call(
        'POST',
        `${FINANCE}/purchase-orders/${String(order.id)}/send`,
        t.admin,
        undefined,
        ifMatch(order.version),
      ),
    )
    const orderItem = (sent.items as Json[])[0]?.id
    const receipts = ok(
      await call(
        'POST',
        `${FINANCE}/purchase-orders/${String(order.id)}/receipts`,
        t.admin,
        {
          receiptDate: '2026-10-06',
          receivedBy: 'Hasan Usta',
          lines: [{ orderItemId: orderItem, acceptedQuantity: 2 }],
        },
        key(),
      ),
      201,
    )
    const receipt = (receipts.receipts as Json[])[0] as Json
    const linkable = (await get(RECEIPT_ITEMS, t.admin)).json() as { data: Json[] }
    const receiptItemId = String(linkable.data[0]?.receiptItemId)
    return { vendor, order: sent, receipt, receiptItemId }
  }

  test('kimliksiz istek 401', async () => {
    const url = `${ASSETS}/${randomUUID()}`
    assertError(await get(ASSETS, null), 401)
    assertError(await get(RECEIPT_ITEMS, null), 401)
    assertError(await call('POST', ASSETS, null, BOARD), 401)
    assertError(await get(url, null), 401)
    assertError(await call('PATCH', url, null, { name: 'Yeni' }, ifMatch(1)), 401)
    assertError(await call('POST', `${url}/scrap`, null, { reason: 'Kırık' }, ifMatch(1)), 401)
  })

  test('DOM-FIN-085: ön büro, öğretmen, veli ve öğrenci 403; kayıt değişmez (K-189)', async () => {
    const t = await institution()
    const saved = await create(t, BOARD)
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(ASSETS, cookie), 403)
      assertError(await get(RECEIPT_ITEMS, cookie), 403)
      assertError(await get(`${ASSETS}/${String(saved.id)}`, cookie), 403)
      assertError(await call('POST', ASSETS, cookie, DESK), 403)
      assertError(await update(cookie, saved, { status: 'broken' }), 403)
      assertError(
        await scrap(cookie, saved, { reason: 'Kırık ekran', scrapDate: '2026-10-06' }),
        403,
      )
    }
    const rows = await rowsOf(t.id)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.status, 'in_use')
    assert.equal(rows[0]?.version, 1)
  })

  test('DOM-FIN-085: finance modülü kapalıyken demirbaş uçları 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(ASSETS, closed.admin), 403, 'module_disabled')
    assertError(await get(RECEIPT_ITEMS, closed.admin), 403, 'module_disabled')
    assertError(await call('POST', ASSETS, closed.admin, BOARD), 403, 'module_disabled')
    assert.equal((await rowsOf(closed.id)).length, 0)
  })

  test('DOM-FIN-085: etiket boşsa DB-<yıl>-<sıra> verilir, elle girilen büyük harfe çevrilir; kampüs adı ve denetim kaydı (K-185)', async () => {
    const t = await institution()
    const response = await call('POST', ASSETS, t.admin, BOARD)
    const first = ok(response, 201)
    assert.equal(response.headers.location, `${ASSETS}/${String(first.id)}`)
    assert.equal(first.tagNumber, 'DB-2026-0001')
    assert.equal(first.campusName, CAMPUS_NAME)
    assert.equal(first.status, 'in_use')
    assert.equal(first.receipt, null)
    const manual = await create(t, { ...DESK, tagNumber: 'db-2026-0007' })
    assert.equal(manual.tagNumber, 'DB-2026-0007')
    assert.equal(manual.status, 'in_storage')
    assert.equal(manual.campusId, null)
    const next = await create(t, { ...DESK, name: 'Sıra' })
    assert.equal(next.tagNumber, 'DB-2026-0008')
    const lab = await create(t, { ...DESK, name: 'Mikroskop', tagNumber: 'LAB-01' })
    assert.equal(lab.tagNumber, 'LAB-01')

    const detail = ok(await get(`${ASSETS}/${String(first.id)}`, t.admin))
    assert.equal(detail.acquisitionValueCents, BOARD.acquisitionValueCents)
    assert.equal(detail.location, BOARD.location)
    const list = await listOf(t.admin)
    assert.equal(list.meta.total, 4)
    assert.deepEqual(
      list.data.map((row) => row.tagNumber),
      ['DB-2026-0001', 'DB-2026-0007', 'DB-2026-0008', 'LAB-01'],
    )
    const audits = await db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'fixed_asset.create')))
    assert.equal(audits.length, 4)
    assert.equal(JSON.stringify(audits).includes(BOARD.location), false)
  })

  test('DOM-FIN-085: geçersiz gövde 400, gelecek gün, olmayan kampüs ve tedarikçi 422, yinelenen etiket 409; kayıt yazılmaz', async () => {
    const t = await institution()
    await create(t, { ...BOARD, tagNumber: 'DB-2026-0001' })
    for (const body of [
      { ...BOARD, acquisitionValueCents: 0 },
      { ...BOARD, category: 'weapons' },
      { ...BOARD, tagNumber: 'DB-2026-Ş1' },
      { ...BOARD, status: 'scrapped' },
      { ...BOARD, location: '' },
    ])
      assertError(await call('POST', ASSETS, t.admin, body), 400, 'validation_failed')
    assertError(
      await call('POST', ASSETS, t.admin, { ...BOARD, acquisitionDate: '2026-10-07' }),
      422,
      'fixed_asset_date_in_future',
    )
    assertError(
      await call('POST', ASSETS, t.admin, { ...BOARD, campusId: 'yok-kampus' }),
      422,
      'fixed_asset_campus_not_found',
    )
    assertError(
      await call('POST', ASSETS, t.admin, { ...BOARD, supplierId: randomUUID() }),
      422,
      'fixed_asset_supplier_not_found',
    )
    assertError(
      await call('POST', ASSETS, t.admin, { ...BOARD, receiptItemId: randomUUID() }),
      422,
      'fixed_asset_receipt_item_not_found',
    )
    assertError(
      await call('POST', ASSETS, t.admin, { ...BOARD, tagNumber: 'db-2026-0001' }),
      409,
      'fixed_asset_tag_exists',
    )
    assert.equal((await rowsOf(t.id)).length, 1)
  })

  test('DOM-FIN-085: mal kabul bağı tedarikçiyi siparişten alır; kabul edilen adetten fazla demirbaş bağlanmaz (K-187)', async () => {
    const t = await institution()
    const { vendor, order, receipt, receiptItemId } = await withReceipt(t)
    const items = (await get(RECEIPT_ITEMS, t.admin)).json() as { data: Json[] }
    assert.equal(items.data.length, 1)
    assert.equal(items.data[0]?.orderNumber, order.number)
    assert.equal(items.data[0]?.itemName, 'Projektör')
    assert.equal(items.data[0]?.acceptedQuantity, 2)
    assert.equal(items.data[0]?.linkedAssetCount, 0)
    assert.equal(items.data[0]?.unitPriceCents, 1_200_000)

    const projector = {
      ...BOARD,
      name: 'Projektör',
      acquisitionValueCents: 1_200_000,
      acquisitionDate: '2026-10-06',
      receiptItemId,
    }
    const other = await call('POST', `${FINANCE}/suppliers`, t.admin, {
      name: 'Gama Ltd.',
      type: 'company',
      taxNumber: '0000000001',
      taxOffice: 'Üsküdar',
      categories: ['it'],
    })
    const otherId = ok(other, 201).id
    assertError(
      await call('POST', ASSETS, t.admin, { ...projector, supplierId: otherId }),
      422,
      'fixed_asset_supplier_mismatch',
    )
    assertError(
      await call('POST', ASSETS, t.admin, { ...projector, acquisitionDate: '2026-10-05' }),
      422,
      'fixed_asset_date_before_receipt',
    )
    const first = await create(t, projector)
    assert.equal(first.supplierId, vendor.id)
    assert.equal(first.supplierName, 'Beta Teknoloji Ltd.')
    assert.equal((first.receipt as Json).orderNumber, order.number)
    assert.equal((first.receipt as Json).receiptId, receipt.id)
    await create(t, { ...projector, supplierId: vendor.id })
    assertError(
      await call('POST', ASSETS, t.admin, projector),
      422,
      'fixed_asset_receipt_quantity_exceeded',
    )
    assert.equal(((await get(RECEIPT_ITEMS, t.admin)).json() as { data: Json[] }).data.length, 0)
    assert.equal((await listOf(t.admin, `?supplierId=${String(vendor.id)}`)).meta.total, 2)

    // Düzeltmede kendi bağı sayılmaz; iptal edilen kabule yeni demirbaş bağlanmaz.
    ok(await update(t.admin, first, { location: 'Konferans salonu' }))
    ok(
      await call(
        'POST',
        `${FINANCE}/purchase-orders/${String(order.id)}/receipts/${String(receipt.id)}/cancel`,
        t.admin,
        { reason: 'Hatalı kayıt' },
        ifMatch(receipt.version),
      ),
    )
    const lone = await create(t, { ...DESK, name: 'Yedek projektör' })
    assertError(
      await update(t.admin, lone, { receiptItemId }),
      422,
      'fixed_asset_receipt_cancelled',
    )
    const detail = ok(await get(`${ASSETS}/${String(first.id)}`, t.admin))
    assert.equal((detail.receipt as Json).receiptCancelled, true)
    assert.equal((await rowsOf(t.id)).length, 3)
  })

  test('DOM-FIN-085: düzeltme If-Match ister; durum değişir, süzgeçler ve arama çalışır', async () => {
    const t = await institution()
    const saved = await create(t, BOARD)
    await create(t, DESK)
    const url = `${ASSETS}/${String(saved.id)}`
    assertError(await call('PATCH', url, t.admin, { name: 'Yeni' }), 400, 'if_match_required')
    assertError(
      await call('PATCH', url, t.admin, { name: 'Yeni' }, ifMatch(Number(saved.version) + 5)),
      409,
      'version_conflict',
    )
    assertError(await update(t.admin, saved, { status: 'scrapped' }), 400)
    assertError(await update(t.admin, saved, {}), 400)
    const updated = ok(
      await update(t.admin, saved, { status: 'broken', location: 'Bilgi işlem deposu' }),
    )
    assert.equal(updated.status, 'broken')
    assert.equal(updated.location, 'Bilgi işlem deposu')
    assert.equal(updated.version, Number(saved.version) + 1)
    assertError(
      await update(t.admin, updated, { campusId: 'yok-kampus' }),
      422,
      'fixed_asset_campus_not_found',
    )
    assert.equal((await listOf(t.admin, '?status=broken')).meta.total, 1)
    assert.equal((await listOf(t.admin, '?category=furniture')).data[0]?.name, DESK.name)
    assert.equal((await listOf(t.admin, `?campusId=${CAMPUS}`)).meta.total, 1)
    assert.equal((await listOf(t.admin, '?q=ogretmen')).meta.total, 1)
    assert.equal((await listOf(t.admin, '?q=db-2026-0001')).data[0]?.name, BOARD.name)
    assert.equal((await listOf(t.admin, '?q=depo')).meta.total, 1)
    assertError(await get(`${ASSETS}?sort=name`, t.admin), 400)
  })

  test('DOM-FIN-085: hurdaya ayırma gerekçe ister, kaydı silmez ve geri alınmaz (K-188)', async () => {
    const t = await institution()
    const saved = await create(t, BOARD)
    await create(t, DESK)
    assertError(await scrap(t.admin, saved, { reason: 'Kır', scrapDate: '2026-10-06' }), 400)
    assertError(
      await scrap(t.admin, saved, { reason: 'Ekran kırık', scrapDate: '2026-08-31' }),
      422,
      'fixed_asset_scrap_before_acquisition',
    )
    assertError(
      await scrap(t.admin, saved, { reason: 'Ekran kırık', scrapDate: '2026-10-07' }),
      422,
      'fixed_asset_date_in_future',
    )
    const scrapped = ok(
      await scrap(t.admin, saved, { reason: 'Ekran kırık, onarılamaz', scrapDate: '2026-10-06' }),
    )
    assert.equal(scrapped.status, 'scrapped')
    assert.equal(scrapped.scrapDate, '2026-10-06')
    assert.equal(scrapped.scrapReason, 'Ekran kırık, onarılamaz')
    assert.equal(scrapped.scrappedAt, FIXED_NOW.toISOString())
    assertError(await update(t.admin, scrapped, { status: 'in_use' }), 422, 'fixed_asset_scrapped')
    assertError(
      await scrap(t.admin, scrapped, { reason: 'Yeniden', scrapDate: '2026-10-06' }),
      422,
      'fixed_asset_scrapped',
    )
    const list = await listOf(t.admin)
    assert.equal(list.meta.total, 2)
    assert.equal(list.data.at(-1)?.status, 'scrapped')
    assert.equal((await listOf(t.admin, '?status=scrapped')).meta.total, 1)
    const [row] = (await rowsOf(t.id)).filter((item) => item.id === saved.id)
    assert.equal(row?.archivedAt, null)
    const audits = await db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'fixed_asset.scrap')))
    assert.equal(audits.length, 1)
    assert.equal(JSON.stringify(audits).includes('onarılamaz'), false)
  })

  test('DOM-FIN-085: başka kurumun demirbaşı 404 ve B değişmez; listede yok; gövdedeki B kaydı ve institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bAsset = await create(b, BOARD)
    const bUrl = `${ASSETS}/${String(bAsset.id)}`
    const bSupplier = ok(
      await call('POST', `${FINANCE}/suppliers`, b.admin, {
        name: 'Beta Teknoloji Ltd.',
        type: 'company',
        taxNumber: '1111111114',
        taxOffice: 'Kadıköy',
        categories: ['it'],
      }),
      201,
    )
    assertError(await get(bUrl, a.admin), 404)
    assertError(await call('PATCH', bUrl, a.admin, { name: 'Sızma' }, ifMatch(bAsset.version)), 404)
    assertError(
      await call(
        'POST',
        `${bUrl}/scrap`,
        a.admin,
        { reason: 'Sızma denemesi', scrapDate: '2026-10-06' },
        ifMatch(bAsset.version),
      ),
      404,
    )
    assert.equal((await listOf(a.admin)).meta.total, 0)
    assert.equal(((await get(RECEIPT_ITEMS, a.admin)).json() as { data: Json[] }).data.length, 0)
    assertError(await call('POST', ASSETS, a.admin, { ...BOARD, institutionId: b.id }), 400)
    assertError(
      await call('POST', ASSETS, a.admin, { ...BOARD, supplierId: bSupplier.id }),
      422,
      'fixed_asset_supplier_not_found',
    )
    // Aynı etiket başka kurumda serbesttir.
    assert.equal((await create(a, BOARD)).tagNumber, 'DB-2026-0001')
    const [bRow] = await rowsOf(b.id)
    assert.equal(bRow?.name, BOARD.name)
    assert.equal(bRow?.status, 'in_use')
    assert.equal(bRow?.version, 1)
  })

  test('DOM-FIN-085: Idempotency-Key ile yinelenen kayıt aynı yanıtı döner, tek satır yazılır', async () => {
    const t = await institution()
    const idempotency = key()
    const first = await call('POST', ASSETS, t.admin, BOARD, idempotency)
    const second = await call('POST', ASSETS, t.admin, BOARD, idempotency)
    assert.equal(first.statusCode, 201)
    assert.equal(second.statusCode, 201)
    assert.equal(second.headers['idempotent-replayed'], 'true')
    assert.equal(second.json().data.id, first.json().data.id)
    assert.equal((await rowsOf(t.id)).length, 1)
  })
})
