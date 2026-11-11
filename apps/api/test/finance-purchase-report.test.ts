import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { purchaseOrders } from '../src/db/schema/finance-purchase-orders.ts'
import { purchaseRequests } from '../src/db/schema/finance-purchase-requests.ts'
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
 * Satın alma raporu ucu (DOM-FIN-075; ON-227). Her test kendi kurumunu kurar: iki birim, iki gider
 * kalemi, açık dönem ve bütün merkez × kalem satırları, iki şirket ve bir şahıs tedarikçi. Sipariş
 * talep → onay → teklif → seçim → sipariş akışıyla API'den açılır; açılış ve gönderim anları rapor
 * günlerini sınamak için doğrudan satırda değiştirilir. FIXED_NOW 2026-10-06.
 */

const FINANCE = '/api/v1/finance'
const REQUESTS = `${FINANCE}/purchase-requests`
const ORDERS = `${FINANCE}/purchase-orders`
const REPORT = `${FINANCE}/purchase-report`
const TCKN = '10000000146'
const OCTOBER = `${REPORT}?from=2026-10-01&to=2026-10-31`
const NO_SETTLEMENT = { receivedNetCents: 0, invoicedGrossCents: 0, paidCents: 0, openCents: 0 }
const NO_CANCELLED_INVOICES = { invoicedGrossCents: 0, paidCents: 0 }
const NO_UNLINKED = { invoiceCount: 0, invoicedGrossCents: 0, paidCents: 0, openCents: 0 }

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-075: satın alma raporu ucu', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.75.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(
    method: 'GET' | 'POST',
    url: string,
    cookie: string | null,
    payload?: unknown,
    headers: Record<string, string> = {},
    target: App = app,
  ) {
    return target.inject({
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
    clientIp = `10.75.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    const admin = await signInAs(app, created.admin)
    if (overrides.enabledModules?.finance === false) return { id: created.id, admin } as Tenant
    const post = async (url: string, body: Json) =>
      ok(await call('POST', `${FINANCE}${url}`, admin, body), 201)
    const it = await post('/cost-centers', { code: 'BT', name: 'Bilgi İşlem', type: 'unit' })
    const office = await post('/cost-centers', { code: 'IDARI', name: 'İdari İşler', type: 'unit' })
    const supplies = await post('/budget-items', {
      code: 'G-200',
      name: 'Malzeme',
      kind: 'expense',
    })
    const services = await post('/budget-items', { code: 'G-300', name: 'Hizmet', kind: 'expense' })
    const period = await post('/budget-periods', { name: '2026–2027', academicYear: 2026 })
    ok(
      await call(
        'POST',
        `${FINANCE}/budget-periods/${String(period.id)}/open`,
        admin,
        undefined,
        ifMatch(period.version),
      ),
    )
    for (const center of [it, office])
      for (const item of [supplies, services])
        await post(`/budget-periods/${String(period.id)}/lines`, {
          costCenterId: center.id,
          itemId: item.id,
          amountCents: 10_000_000,
        })
    const supplier = (name: string, taxNumber: string, extra: Json = {}) =>
      post('/suppliers', {
        name,
        type: 'company',
        taxNumber,
        taxOffice: 'Kadıköy',
        categories: ['it'],
        ...extra,
      })
    const alpha = await supplier('Alfa Bilişim A.Ş.', '1234567890')
    const beta = await supplier('Beta Kırtasiye Ltd.', '1111111114', {
      categories: ['stationery', 'it'],
    })
    const person = await supplier('Ayla Örnek', TCKN, {
      type: 'individual',
      taxOffice: 'Üsküdar',
      categories: ['services'],
    })
    return { id: created.id, admin, it, office, supplies, services, period, alpha, beta, person }
  }
  type Tenant = {
    id: string
    admin: string
    it: Json
    office: Json
    supplies: Json
    services: Json
    period: Json
    alpha: Json
    beta: Json
    person: Json
  }

  interface OrderSpec {
    supplier: Json
    center: Json
    item: Json
    quantity: number
    unitPriceCents: number
    vatRate: 0 | 1 | 10 | 20
    createdAt: string
    submittedAt: string
  }

  /** Onaylı talepten seçili teklifle sipariş açar; açılış ve gönderim anını satırda ayarlar. */
  async function placeOrder(t: Tenant, spec: OrderSpec): Promise<Json> {
    const request = ok(
      await call('POST', REQUESTS, t.admin, {
        costCenterId: spec.center.id,
        periodId: t.period.id,
        budgetItemId: spec.item.id,
        justification: 'Rapor sınaması için satın alma',
        items: [
          {
            name: 'Kalem',
            quantity: spec.quantity,
            unit: 'piece',
            estimatedUnitPriceCents: spec.unitPriceCents,
          },
        ],
      }),
      201,
    )
    const url = `${REQUESTS}/${String(request.id)}`
    const submitted = ok(
      await call('POST', `${url}/submit`, t.admin, undefined, ifMatch(request.version)),
    )
    ok(await call('POST', `${url}/approve`, t.admin, {}, ifMatch(submitted.version)))
    const [line] = request.items as Json[]
    const board = ok(
      await call('POST', `${url}/quotes`, t.admin, {
        supplierId: spec.supplier.id,
        deliveryDays: 5,
        validUntil: '2026-10-20',
        items: [
          { requestItemId: line?.id, unitPriceCents: spec.unitPriceCents, vatRate: spec.vatRate },
        ],
      }),
      201,
    )
    const [quote] = board.quotes as Json[]
    ok(
      await call(
        'POST',
        `${url}/quotes/${String(quote?.id)}/select`,
        t.admin,
        {},
        ifMatch(quote?.version),
      ),
    )
    const order = ok(
      await call(
        'POST',
        ORDERS,
        t.admin,
        { quoteId: quote?.id },
        { 'idempotency-key': randomUUID() },
      ),
      201,
    )
    await db
      .update(purchaseOrders)
      .set({ createdAt: new Date(spec.createdAt) })
      .where(and(eq(purchaseOrders.institutionId, t.id), eq(purchaseOrders.id, String(order.id))))
    await db
      .update(purchaseRequests)
      .set({ submittedAt: new Date(spec.submittedAt) })
      .where(
        and(eq(purchaseRequests.institutionId, t.id), eq(purchaseRequests.id, String(request.id))),
      )
    return order
  }

  /**
   * Dört sipariş: Alfa 1.200,00 (5 gün), Beta 165,28 (İstanbul 1 Ekim, 2 gün), şahıs Ayla 500,00
   * (İstanbul 30 Eylül), iptal edilen Alfa 1.198,80.
   */
  async function reportTenant() {
    const t = await institution()
    const alfaOrder = await placeOrder(t, {
      supplier: t.alpha,
      center: t.it,
      item: t.supplies,
      quantity: 10,
      unitPriceCents: 10_000,
      vatRate: 20,
      createdAt: '2026-10-06T09:00:00.000Z',
      submittedAt: '2026-10-01T09:00:00.000Z',
    })
    await placeOrder(t, {
      supplier: t.beta,
      center: t.office,
      item: t.supplies,
      quantity: 5,
      unitPriceCents: 3_005,
      vatRate: 10,
      // İstanbul'da 1 Ekim 00.30.
      createdAt: '2026-09-30T21:30:00.000Z',
      submittedAt: '2026-09-29T09:00:00.000Z',
    })
    await placeOrder(t, {
      supplier: t.person,
      center: t.it,
      item: t.services,
      quantity: 1,
      unitPriceCents: 50_000,
      vatRate: 0,
      // İstanbul'da 30 Eylül 23.59.
      createdAt: '2026-09-30T20:59:00.000Z',
      submittedAt: '2026-09-28T09:00:00.000Z',
    })
    const cancelled = await placeOrder(t, {
      supplier: t.alpha,
      center: t.it,
      item: t.supplies,
      quantity: 1,
      unitPriceCents: 99_900,
      vatRate: 20,
      createdAt: '2026-10-06T09:00:00.000Z',
      submittedAt: '2026-10-01T09:00:00.000Z',
    })
    ok(
      await call(
        'POST',
        `${ORDERS}/${String(cancelled.id)}/cancel`,
        t.admin,
        { reason: 'Tedarikçi stokta yok' },
        ifMatch(cancelled.version),
      ),
    )
    return { ...t, alfaOrder }
  }

  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))
  const audits = (institutionId: string) =>
    db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, institutionId),
          eq(auditLog.action, 'finance.purchase_report_export'),
        ),
      )

  test('kimliksiz istek 401', async () => {
    assertError(await get(OCTOBER, null), 401)
  })

  test('DOM-FIN-075: ön büro, öğretmen, veli ve öğrenci 403; modül kapalıyken 403 (K-155)', async () => {
    const t = await institution()
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const)
      assertError(await get(OCTOBER, await member(t.id, role)), 403)
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(OCTOBER, closed.admin), 403, 'module_disabled')
  })

  test('DOM-FIN-075: kapsamsız, çift kapsamlı, ters, 366 günü aşan ve bilinmeyen sorgu 400; dosya denetime düşmez (K-156)', async () => {
    const t = await institution()
    for (const query of [
      '',
      '?from=2026-10-01',
      `?periodId=${String(t.period.id)}&from=2026-10-01&to=2026-10-31`,
      '?from=2026-11-01&to=2026-10-01',
      '?from=2024-01-01&to=2025-01-01',
      '?from=2026-02-30&to=2026-03-01',
      '?periodId=x',
      `${OCTOBER.slice(REPORT.length)}&page=1`,
    ])
      assertError(
        await call('GET', `${REPORT}${query}`, t.admin, undefined, { accept: 'text/csv' }),
        400,
      )
    assert.equal((await audits(t.id)).length, 0)
    assertError(await get(`${REPORT}?periodId=${randomUUID()}`, t.admin), 404)
  })

  test('DOM-FIN-075: aralıkta İstanbul açılış günü; kategori, tedarikçi, merkez ve kalem bazında net, KDV, brüt; iptal hariç (K-156…K-158)', async () => {
    const t = await reportTenant()
    const report = ok(await get(OCTOBER, t.admin))
    assert.equal(report.scope, 'range')
    assert.equal(report.from, '2026-10-01')
    assert.equal(report.to, '2026-10-31')
    assert.equal(report.period, null)
    assert.deepEqual(report.totals, {
      orderCount: 2,
      netCents: 115_025,
      vatCents: 21_503,
      grossCents: 136_528,
      ...NO_SETTLEMENT,
      supplierCount: 2,
    })
    assert.deepEqual(report.cancelled, {
      orderCount: 1,
      grossCents: 119_880,
      ...NO_CANCELLED_INVOICES,
    })
    assert.deepEqual(report.unlinkedInvoices, NO_UNLINKED)
    assert.deepEqual(report.leadTime, { orderCount: 2, averageDays: 3.5, minDays: 2, maxDays: 5 })
    assert.deepEqual(
      (report.categories as Json[]).map((row) => [
        row.category,
        row.orderCount,
        row.supplierCount,
        row.grossCents,
        row.shareBasisPoints,
      ]),
      [
        ['it', 2, 2, 136_528, 10_000],
        ['stationery', 1, 1, 16_528, 1_211],
      ],
    )
    assert.deepEqual(
      (report.suppliers as Json[]).map((row) => [
        row.rank,
        row.name,
        row.type,
        row.netCents,
        row.vatCents,
        row.grossCents,
        row.shareBasisPoints,
        row.averageLeadDays,
      ]),
      [
        [1, 'Alfa Bilişim A.Ş.', 'company', 100_000, 20_000, 120_000, 8_789, 5],
        [2, 'Beta Kırtasiye Ltd.', 'company', 15_025, 1_503, 16_528, 1_211, 2],
      ],
    )
    assert.deepEqual(
      (report.topSuppliers as Json[]).map((row) => row.supplierId),
      [t.alpha.id, t.beta.id],
    )
    assert.deepEqual(
      (report.costCenters as Json[]).map((row) => [row.id, row.code, row.grossCents]),
      [
        [t.it.id, 'BT', 120_000],
        [t.office.id, 'IDARI', 16_528],
      ],
    )
    assert.deepEqual(
      (report.budgetItems as Json[]).map((row) => [row.code, row.orderCount, row.grossCents]),
      [['G-200', 2, 136_528]],
    )
    // 30 Eylül İstanbul günü raporun ilk gününden önce: şahıs tedarikçi yok.
    const september = ok(await get(`${REPORT}?from=2026-09-30&to=2026-09-30`, t.admin))
    assert.deepEqual(
      (september.suppliers as Json[]).map((row) => row.name),
      ['Ayla Örnek'],
    )
  })

  test('DOM-FIN-075: bütçe döneminde talebin dönemi süzer; şahıs adı yöneticiye döner, vergi numarası dönmez (K-155)', async () => {
    const t = await reportTenant()
    const response = await get(`${REPORT}?periodId=${String(t.period.id)}`, t.admin)
    const report = ok(response)
    assert.equal(report.scope, 'period')
    assert.deepEqual(report.period, {
      id: t.period.id,
      name: '2026–2027',
      status: 'open',
      startDate: report.from,
      endDate: report.to,
    })
    assert.deepEqual(report.totals, {
      orderCount: 3,
      netCents: 165_025,
      vatCents: 21_503,
      grossCents: 186_528,
      ...NO_SETTLEMENT,
      supplierCount: 3,
    })
    const person = (report.suppliers as Json[]).find((row) => row.supplierId === t.person.id)
    assert.deepEqual(
      [person?.name, person?.type, person?.categories, person?.rank],
      ['Ayla Örnek', 'individual', ['services'], 2],
    )
    assert.ok(!response.body.includes(TCKN))
    assert.ok(!response.body.includes('1234567890'))
    assert.ok(!response.body.includes('taxNumber'))
    assert.deepEqual(
      (report.budgetItems as Json[]).map((row) => [row.code, row.grossCents]),
      [
        ['G-200', 136_528],
        ['G-300', 50_000],
      ],
    )
    assert.equal((await audits(t.id)).length, 0)
  })

  test('DOM-FIN-075: başka kurumun dönemi 404; başka kurumun siparişi raporda yok', async () => {
    const a = await institution()
    const b = await reportTenant()
    assertError(await get(`${REPORT}?periodId=${String(b.period.id)}`, a.admin), 404)
    const report = ok(await get(OCTOBER, a.admin))
    assert.deepEqual(report.totals, {
      orderCount: 0,
      netCents: 0,
      vatCents: 0,
      grossCents: 0,
      ...NO_SETTLEMENT,
      supplierCount: 0,
    })
    assert.deepEqual(report.suppliers, [])
    assert.deepEqual(report.cancelled, { orderCount: 0, grossCents: 0, ...NO_CANCELLED_INVOICES })
    assert.deepEqual(report.unlinkedInvoices, NO_UNLINKED)
    // Sorgudaki institutionId bilinmeyen parametredir, kapsamı değiştirmez.
    assertError(await get(`${OCTOBER}&institutionId=${b.id}`, a.admin), 400)
  })

  test('DOM-FIN-075: CSV taze oturum ister, denetime yazılır, formül kaçışlıdır (K-155)', async () => {
    const t = await reportTenant()
    await placeOrder(t, {
      supplier: ok(
        await call('POST', `${FINANCE}/suppliers`, t.admin, {
          name: '=HYPERLINK("x")',
          type: 'company',
          taxNumber: '2000000002',
          taxOffice: 'Kadıköy',
          categories: ['other'],
        }),
        201,
      ),
      center: t.it,
      item: t.supplies,
      quantity: 1,
      unitPriceCents: 1_000,
      vatRate: 1,
      createdAt: '2026-10-07T09:00:00.000Z',
      submittedAt: '2026-10-07T08:00:00.000Z',
    })
    const file = await call('GET', OCTOBER, t.admin, undefined, { accept: 'text/csv' })
    assert.equal(file.statusCode, 200, file.body)
    assert.match(String(file.headers['content-type']), /text\/csv/)
    assert.match(
      String(file.headers['content-disposition']),
      /satin-alma-raporu-2026-10-01-2026-10-31\.csv/,
    )
    assert.ok(file.body.startsWith('\uFEFF'))
    const lines = file.body.replace('\uFEFF', '').split('\r\n')
    assert.equal(lines[1], '"Toplam";"";"";"";"";3;1160,25;215,13;1375,38;"";0,00;0,00;0,00;0,00')
    assert.equal(
      lines[2],
      '"Siparişsiz fatura";"0 fatura";"";"";"";"";"";"";"";"";"";0,00;0,00;0,00',
    )
    assert.ok(lines.some((line) => line.startsWith('"Tedarikçi";"\'=HYPERLINK(""x"")"')))
    assert.ok(!file.body.includes(TCKN))
    assert.deepEqual(
      (await audits(t.id)).map((row) => [row.entityId, row.actorRole]),
      [['purchase-report:2026-10-01:2026-10-31', 'yonetici']],
    )
    const later = await buildTestApp(db, { clock: () => new Date(Date.now() + 16 * 60 * 1000) })
    try {
      assertError(
        await call('GET', OCTOBER, t.admin, undefined, { accept: 'text/csv' }, later),
        403,
        'reauthentication_required',
      )
    } finally {
      await later.close()
    }
    assert.equal((await audits(t.id)).length, 1)
  })

  const key = () => ({ 'idempotency-key': randomUUID() })
  const createInvoice = (t: Tenant, body: Json) =>
    call(
      'POST',
      `${FINANCE}/supplier-invoices`,
      t.admin,
      {
        invoiceDate: '2026-10-05',
        dueDate: '2026-10-31',
        amountIncludesVat: true,
        ...body,
      },
      key(),
    )
  const pay = (t: Tenant, invoice: Json, amountCents: number) =>
    call(
      'POST',
      `${FINANCE}/supplier-payments`,
      t.admin,
      {
        installmentId: (invoice.installments as Json[])[0]?.id,
        paidDate: '2026-10-06',
        amountCents,
        method: 'cash',
        bankAccountId: null,
      },
      key(),
    )

  test('DOM-FIN-075: teslim alınan KDV hariç, faturalanan, ödenen ve açık KDV dahil; siparişsiz fatura ayrı satırda; iptaller sayılmaz (K-195…K-199)', async () => {
    const t = await reportTenant()
    // Alfa'nın 10 × 100,00 %20 siparişi: gönder, 6 kabul et; 3'lük ikinci kabul iptal edilir.
    const { alfaOrder } = t
    const sent = ok(
      await call(
        'POST',
        `${ORDERS}/${String(alfaOrder.id)}/send`,
        t.admin,
        undefined,
        ifMatch(alfaOrder.version),
      ),
    )
    const orderItem = String((sent.items as Json[])[0]?.id)
    const receiptsUrl = `${ORDERS}/${String(alfaOrder.id)}/receipts`
    const receive = (acceptedQuantity: number) =>
      call(
        'POST',
        receiptsUrl,
        t.admin,
        {
          receiptDate: '2026-10-06',
          receivedBy: 'Hasan Usta',
          lines: [{ orderItemId: orderItem, acceptedQuantity }],
        },
        key(),
      )
    ok(await receive(6), 201)
    const second = ok(await receive(3), 201)
    const cancelledReceipt = (second.receipts as Json[]).find((row) =>
      (row.lines as Json[]).some((line) => line.acceptedQuantity === 3),
    ) as Json
    ok(
      await call(
        'POST',
        `${receiptsUrl}/${String(cancelledReceipt.id)}/cancel`,
        t.admin,
        { reason: 'Yanlış kalem sayıldı' },
        ifMatch(cancelledReceipt.version),
      ),
    )
    // Bağlı iki fatura (720,00 + 120,00), ödemeler 300,00 + 120,00; 100,00'lık ödeme iptal edilir.
    const first = ok(
      await createInvoice(t, {
        supplierId: t.alpha.id,
        invoiceNumber: 'ALF-1',
        purchaseOrderId: alfaOrder.id,
        amountCents: 72_000,
        vatCents: 12_000,
      }),
      201,
    )
    const extra = ok(
      await createInvoice(t, {
        supplierId: t.alpha.id,
        invoiceNumber: 'ALF-2',
        purchaseOrderId: alfaOrder.id,
        amountCents: 12_000,
        vatCents: 2_000,
      }),
      201,
    )
    ok(await pay(t, first, 30_000), 201)
    ok(await pay(t, extra, 12_000), 201)
    const wrong = ok(await pay(t, first, 10_000), 201)
    ok(
      await call(
        'POST',
        `${FINANCE}/supplier-payments/${String(wrong.id)}/cancel`,
        t.admin,
        { reason: 'Hatalı tutar girildi' },
        ifMatch(wrong.version),
      ),
    )
    // Siparişsiz faturalar: Ekim'de 50,00 (20,00 ödendi), Eylül'de 80,00 (aralıkta yok, dönemde var).
    const loose = ok(
      await createInvoice(t, {
        supplierId: t.beta.id,
        invoiceNumber: 'BET-9',
        invoiceDate: '2026-10-02',
        amountCents: 5_000,
        vatCents: 0,
      }),
      201,
    )
    ok(await pay(t, loose, 2_000), 201)
    ok(
      await createInvoice(t, {
        supplierId: t.beta.id,
        invoiceNumber: 'BET-8',
        invoiceDate: '2026-09-15',
        dueDate: '2026-09-30',
        amountCents: 8_000,
        vatCents: 0,
      }),
      201,
    )

    const report = ok(await get(OCTOBER, t.admin))
    const alfaSettlement = {
      receivedNetCents: 60_000,
      invoicedGrossCents: 84_000,
      paidCents: 42_000,
      openCents: 42_000,
    }
    assert.deepEqual(report.totals, {
      orderCount: 2,
      netCents: 115_025,
      vatCents: 21_503,
      grossCents: 136_528,
      ...alfaSettlement,
      supplierCount: 2,
    })
    const settlementOf = (row: Json | undefined) => [
      row?.receivedNetCents,
      row?.invoicedGrossCents,
      row?.paidCents,
      row?.openCents,
    ]
    const alfaRow = (report.suppliers as Json[]).find((row) => row.supplierId === t.alpha.id)
    assert.deepEqual(settlementOf(alfaRow), Object.values(alfaSettlement))
    assert.equal(alfaRow?.grossCents, 120_000)
    assert.equal(alfaRow?.shareBasisPoints, 8_789)
    assert.deepEqual(
      settlementOf((report.costCenters as Json[]).find((row) => row.id === t.it.id)),
      Object.values(alfaSettlement),
    )
    assert.deepEqual(
      settlementOf((report.costCenters as Json[]).find((row) => row.id === t.office.id)),
      [0, 0, 0, 0],
    )
    assert.deepEqual(report.unlinkedInvoices, {
      invoiceCount: 1,
      invoicedGrossCents: 5_000,
      paidCents: 2_000,
      openCents: 3_000,
    })
    // Bütçe döneminde siparişsiz fatura dönemin günleriyle süzülür: Eylül faturası da girer.
    const period = ok(await get(`${REPORT}?periodId=${String(t.period.id)}`, t.admin))
    assert.ok(String(period.from) <= '2026-09-15')
    assert.deepEqual(period.unlinkedInvoices, {
      invoiceCount: 2,
      invoicedGrossCents: 13_000,
      paidCents: 2_000,
      openCents: 11_000,
    })
    assert.equal((period.totals as Json).invoicedGrossCents, 84_000)

    const file = await call('GET', OCTOBER, t.admin, undefined, { accept: 'text/csv' })
    assert.equal(file.statusCode, 200, file.body)
    const lines = file.body.replace('﻿', '').split('\r\n')
    assert.match(String(lines[0]), /"Teslim alınan \(KDV hariç\)";"Faturalanan \(KDV dahil\)"/)
    assert.equal(
      lines[1],
      '"Toplam";"";"";"";"";2;1150,25;215,03;1365,28;"";600,00;840,00;420,00;420,00',
    )
    assert.equal(
      lines[2],
      '"Siparişsiz fatura";"1 fatura";"";"";"";"";"";"";"";"";"";50,00;20,00;30,00',
    )
    assert.equal((await audits(t.id)).length, 1)
  })
})
