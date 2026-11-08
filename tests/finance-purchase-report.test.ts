import assert from 'node:assert/strict'
import test from 'node:test'

import {
  inPurchaseReportScope,
  PURCHASE_REPORT_ROLES,
  PURCHASE_REPORT_TOP,
  purchaseLeadDays,
  purchaseReport,
  purchaseReportCsv,
  purchaseReportQuerySchema,
  purchaseReportRangeIssue,
  purchaseReportScope,
  type PurchaseReportInput,
  type PurchaseReportOrder,
  type PurchaseReportSupplier,
} from '../packages/school-core/src/lib/finance-purchase-report.ts'

import { isDomainError } from './support/domain-error.ts'

// Satın alma raporu (DOM-FIN-075; ON-227, K-155…K-158).

const PERIOD = '00000000-0000-4000-8000-0000000000a1'
const OTHER_PERIOD = '00000000-0000-4000-8000-0000000000a2'

const SUPPLIERS: PurchaseReportSupplier[] = [
  { id: 's-alfa', name: 'Alfa Bilişim A.Ş.', type: 'company', categories: ['it'], isActive: true },
  {
    id: 's-beta',
    name: 'Beta Kırtasiye Ltd.',
    type: 'company',
    categories: ['stationery', 'it'],
    isActive: true,
  },
  {
    id: 's-ayla',
    name: 'Ayla Örnek',
    type: 'individual',
    categories: ['services'],
    isActive: false,
  },
]
const CENTERS = [
  { id: 'c-bt', code: 'BT', name: 'Bilgi İşlem', isActive: true },
  { id: 'c-idari', code: 'IDARI', name: 'İdari İşler', isActive: true },
]
const ITEMS = [
  { id: 'i-malzeme', code: 'G-200', name: 'Malzeme', isActive: true },
  { id: 'i-hizmet', code: 'G-300', name: 'Hizmet alımı', isActive: false },
]

let counter = 0
function order(overrides: Partial<PurchaseReportOrder> = {}): PurchaseReportOrder {
  counter += 1
  return {
    id: `o-${String(counter)}`,
    status: 'sent',
    createdAt: '2026-10-06T09:00:00.000Z',
    supplierId: 's-alfa',
    periodId: PERIOD,
    costCenterId: 'c-bt',
    budgetItemId: 'i-malzeme',
    requestSubmittedAt: '2026-10-01T09:00:00.000Z',
    requestCreatedAt: '2026-09-30T09:00:00.000Z',
    // 10 × 100,00 TL, %20 KDV: net 1.000,00, KDV 200,00, brüt 1.200,00.
    lines: [{ requestItemId: 'r-1', quantity: 10, unitPriceCents: 10_000, vatRate: 20 }],
    ...overrides,
  }
}

const input = (
  orders: PurchaseReportOrder[],
  scope: PurchaseReportInput['scope'] = { kind: 'range', from: '2026-10-01', to: '2026-10-31' },
): PurchaseReportInput => ({
  scope,
  orders,
  suppliers: SUPPLIERS,
  costCenters: CENTERS,
  budgetItems: ITEMS,
})

test('DOM-FIN-075: raporu bütçeyi gören rol okur, ön büro okumaz (K-155)', () => {
  assert.deepEqual([...PURCHASE_REPORT_ROLES], ['yonetici'])
})

test('DOM-FIN-075: sorgu ya bütçe dönemi ya tarih aralığıdır; aralık en çok 366 gün (K-156)', () => {
  assert.deepEqual(purchaseReportQuerySchema.parse({ periodId: PERIOD }), { periodId: PERIOD })
  assert.deepEqual(purchaseReportQuerySchema.parse({ from: '2026-01-01', to: '2026-12-31' }), {
    from: '2026-01-01',
    to: '2026-12-31',
  })
  const issues = (value: unknown) => {
    const result = purchaseReportQuerySchema.safeParse(value)
    assert.equal(result.success, false)
    return result.error?.issues.map((issue) => [issue.path.join('.'), issue.message])
  }
  assert.deepEqual(issues({ periodId: PERIOD, from: '2026-01-01' }), [
    ['periodId', 'Bütçe dönemi ya da tarih aralığından yalnız birini seçin.'],
  ])
  assert.deepEqual(issues({}), [['from', 'Bütçe dönemini ya da başlangıç ve bitiş gününü seçin.']])
  assert.deepEqual(issues({ from: '2026-01-01' }), [
    ['to', 'Bütçe dönemini ya da başlangıç ve bitiş gününü seçin.'],
  ])
  assert.deepEqual(issues({ from: '2026-02-01', to: '2026-01-31' }), [
    ['from', 'Başlangıç günü bitiş gününden sonra olamaz.'],
  ])
  // 2024 artık yıl: 1 Ocak – 31 Aralık 366 gündür, bir gün fazlası reddedilir.
  assert.equal(purchaseReportRangeIssue('2024-01-01', '2024-12-31'), null)
  assert.deepEqual(issues({ from: '2024-01-01', to: '2025-01-01' }), [
    ['to', 'Tarih aralığı en çok 366 gün olabilir.'],
  ])
  assert.equal(
    purchaseReportQuerySchema.safeParse({ from: '2026-02-30', to: '2026-03-01' }).success,
    false,
  )
  assert.equal(purchaseReportQuerySchema.safeParse({ periodId: 'x' }).success, false)
  assert.equal(purchaseReportQuerySchema.safeParse({ periodId: PERIOD, top: 3 }).success, false)
})

test('DOM-FIN-075: kapsam sorgudan çıkar; doğrulanmamış sorgu kural hatasıdır', () => {
  assert.deepEqual(purchaseReportScope({ periodId: PERIOD }), { kind: 'period', periodId: PERIOD })
  assert.deepEqual(purchaseReportScope({ from: '2026-10-01', to: '2026-10-31' }), {
    kind: 'range',
    from: '2026-10-01',
    to: '2026-10-31',
  })
  assert.throws(
    () => purchaseReportScope({ from: '2026-10-01' }),
    isDomainError('purchase_report_scope_required'),
  )
})

test('DOM-FIN-075: aralıkta siparişin açılış günü Europe/Istanbul gününe göre sayılır (K-156)', () => {
  const scope = { kind: 'range', from: '2026-10-01', to: '2026-10-31' } as const
  // 30 Eylül 21.30 UTC İstanbul'da 1 Ekim 00.30'dur; 31 Ekim 21.00 UTC (UTC+3) 1 Kasım'dır.
  assert.equal(
    inPurchaseReportScope({ createdAt: '2026-09-30T21:30:00.000Z', periodId: PERIOD }, scope),
    true,
  )
  assert.equal(
    inPurchaseReportScope({ createdAt: '2026-09-30T20:59:00.000Z', periodId: PERIOD }, scope),
    false,
  )
  assert.equal(
    inPurchaseReportScope({ createdAt: '2026-10-31T20:59:00.000Z', periodId: PERIOD }, scope),
    true,
  )
  assert.equal(
    inPurchaseReportScope({ createdAt: '2026-10-31T21:00:00.000Z', periodId: PERIOD }, scope),
    false,
  )
  // Bütçe döneminde açılış günü değil talebin dönemi belirler.
  const period = { kind: 'period', periodId: PERIOD } as const
  assert.equal(
    inPurchaseReportScope({ createdAt: '2020-01-01T00:00:00.000Z', periodId: PERIOD }, period),
    true,
  )
  assert.equal(
    inPurchaseReportScope(
      { createdAt: '2026-10-06T09:00:00.000Z', periodId: OTHER_PERIOD },
      period,
    ),
    false,
  )
})

test('DOM-FIN-075: talepten siparişe süre İstanbul takvim günüyle; gönderim yoksa açılış (K-158)', () => {
  // Gönderim 1 Ekim 23.30 İstanbul (20.30 UTC), sipariş 2 Ekim 00.10 İstanbul: bir gün.
  assert.equal(
    purchaseLeadDays({
      requestSubmittedAt: '2026-10-01T20:30:00.000Z',
      requestCreatedAt: '2026-09-01T09:00:00.000Z',
      createdAt: '2026-10-01T21:10:00.000Z',
    }),
    1,
  )
  assert.equal(
    purchaseLeadDays({
      requestSubmittedAt: null,
      requestCreatedAt: '2026-09-26T09:00:00.000Z',
      createdAt: '2026-10-06T09:00:00.000Z',
    }),
    10,
  )
  assert.equal(
    purchaseLeadDays({
      requestSubmittedAt: '2026-10-06T10:00:00.000Z',
      requestCreatedAt: '2026-10-06T08:00:00.000Z',
      createdAt: '2026-10-06T09:00:00.000Z',
    }),
    0,
  )
})

test('DOM-FIN-075: kategori, tedarikçi, merkez ve kalem bazında net, KDV ve brüt; iptal hariç (K-156, K-157)', () => {
  const report = purchaseReport(
    input([
      order(),
      // Beta iki kategorili: 5 × 30,05 TL %10 → net 150,25, KDV 15,03 (kalemde yarım yukarı).
      order({
        supplierId: 's-beta',
        costCenterId: 'c-idari',
        requestSubmittedAt: '2026-10-04T09:00:00.000Z',
        lines: [{ requestItemId: 'r-2', quantity: 5, unitPriceCents: 3_005, vatRate: 10 }],
      }),
      order({
        supplierId: 's-ayla',
        status: 'draft',
        budgetItemId: 'i-hizmet',
        lines: [{ requestItemId: 'r-3', quantity: 1, unitPriceCents: 50_000, vatRate: 0 }],
      }),
      order({
        status: 'cancelled',
        lines: [{ requestItemId: 'r-4', quantity: 1, unitPriceCents: 99_900, vatRate: 20 }],
      }),
      // Kapsam dışı gün ve öteki ay.
      order({ createdAt: '2026-11-01T09:00:00.000Z' }),
    ]),
  )
  assert.deepEqual(report.totals, {
    orderCount: 3,
    netCents: 100_000 + 15_025 + 50_000,
    vatCents: 20_000 + 1_503,
    grossCents: 120_000 + 16_528 + 50_000,
    supplierCount: 3,
  })
  assert.deepEqual(report.cancelled, { orderCount: 1, grossCents: 119_880 })
  // Kategori: Bilişim Alfa + Beta, Kırtasiye yalnız Beta; toplamı genel toplamı aşar (K-157).
  assert.deepEqual(
    report.categories.map((row) => [
      row.category,
      row.orderCount,
      row.supplierCount,
      row.grossCents,
    ]),
    [
      ['it', 2, 2, 136_528],
      ['services', 1, 1, 50_000],
      ['stationery', 1, 1, 16_528],
    ],
  )
  assert.deepEqual(
    report.suppliers.map((row) => [
      row.rank,
      row.name,
      row.type,
      row.grossCents,
      row.shareBasisPoints,
    ]),
    [
      [1, 'Alfa Bilişim A.Ş.', 'company', 120_000, 6_433],
      [2, 'Ayla Örnek', 'individual', 50_000, 2_681],
      [3, 'Beta Kırtasiye Ltd.', 'company', 16_528, 886],
    ],
  )
  assert.equal(report.suppliers[1]?.isActive, false)
  assert.deepEqual(report.suppliers[2]?.categories, ['stationery', 'it'])
  assert.ok(!('taxNumber' in (report.suppliers[0] ?? {})))
  assert.deepEqual(
    report.costCenters.map((row) => [
      row.code,
      row.orderCount,
      row.netCents,
      row.vatCents,
      row.grossCents,
    ]),
    [
      ['BT', 2, 150_000, 20_000, 170_000],
      ['IDARI', 1, 15_025, 1_503, 16_528],
    ],
  )
  assert.deepEqual(
    report.budgetItems.map((row) => [row.code, row.name, row.isActive, row.grossCents]),
    [
      ['G-200', 'Malzeme', true, 136_528],
      ['G-300', 'Hizmet alımı', false, 50_000],
    ],
  )
  // Süreler 5, 2 ve 5 gün.
  assert.deepEqual(report.leadTime, { orderCount: 3, averageDays: 4, minDays: 2, maxDays: 5 })
  assert.equal(report.suppliers[2]?.averageLeadDays, 2)
})

test('DOM-FIN-075: bütçe döneminde talebin dönemi süzer; ortalama süre bir ondalık (K-156, K-158)', () => {
  const report = purchaseReport(
    input(
      [
        order({
          createdAt: '2027-03-01T09:00:00.000Z',
          requestSubmittedAt: '2027-02-28T09:00:00.000Z',
        }),
        order({
          createdAt: '2026-10-06T09:00:00.000Z',
          requestSubmittedAt: '2026-10-05T09:00:00.000Z',
        }),
        order({
          createdAt: '2026-10-06T09:00:00.000Z',
          requestSubmittedAt: '2026-10-05T09:00:00.000Z',
        }),
        order({ periodId: OTHER_PERIOD }),
      ],
      { kind: 'period', periodId: PERIOD },
    ),
  )
  assert.equal(report.totals.orderCount, 3)
  assert.equal(report.leadTime.averageDays, 1)
  const uneven = purchaseReport(
    input([
      order({ requestSubmittedAt: '2026-10-05T09:00:00.000Z' }),
      order({ requestSubmittedAt: '2026-10-05T09:00:00.000Z' }),
      order({ requestSubmittedAt: '2026-10-04T09:00:00.000Z' }),
    ]),
  )
  // (1 + 1 + 2) / 3 = 1,33… → 1,3.
  assert.equal(uneven.leadTime.averageDays, 1.3)
  assert.equal(uneven.suppliers[0]?.averageLeadDays, 1.3)
})

test('DOM-FIN-075: en çok harcama yapılan ilk beş tedarikçi, eşitlikte ada göre (K-158)', () => {
  const suppliers: PurchaseReportSupplier[] = ['Fe', 'Ce', 'Ae', 'De', 'Be', 'Ee', 'Ğe'].map(
    (name) => ({ id: `s-${name}`, name, type: 'company', categories: ['other'], isActive: true }),
  )
  const orders = suppliers.map((supplier, index) =>
    order({
      supplierId: supplier.id,
      lines: [
        {
          requestItemId: 'r',
          quantity: 1,
          unitPriceCents: index < 2 ? 50_000 : 10_000,
          vatRate: 0,
        },
      ],
    }),
  )
  const report = purchaseReport({ ...input(orders), suppliers })
  assert.equal(report.topSuppliers.length, PURCHASE_REPORT_TOP)
  assert.deepEqual(
    report.topSuppliers.map((row) => [row.rank, row.name]),
    [
      [1, 'Ce'],
      [2, 'Fe'],
      [3, 'Ae'],
      [4, 'Be'],
      [5, 'De'],
    ],
  )
  assert.equal(report.suppliers.length, 7)
  assert.equal(report.suppliers.at(-1)?.name, 'Ğe')
})

test('DOM-FIN-075: boş raporda oran ve süre boş; bilinmeyen kayıt adı açıklanır', () => {
  const empty = purchaseReport(input([]))
  assert.deepEqual(empty.totals, {
    orderCount: 0,
    netCents: 0,
    vatCents: 0,
    grossCents: 0,
    supplierCount: 0,
  })
  assert.deepEqual(empty.leadTime, {
    orderCount: 0,
    averageDays: null,
    minDays: null,
    maxDays: null,
  })
  assert.deepEqual(empty.categories, [])
  assert.deepEqual(empty.topSuppliers, [])
  const unknown = purchaseReport(
    input([order({ supplierId: 's-yok', costCenterId: 'c-yok', budgetItemId: 'i-yok' })]),
  )
  assert.equal(unknown.suppliers[0]?.name, 'Kaydı bulunamayan tedarikçi')
  assert.deepEqual(unknown.categories, [])
  assert.equal(unknown.costCenters[0]?.name, 'Kaydı bulunamayan merkez')
  assert.equal(unknown.budgetItems[0]?.name, 'Kaydı bulunamayan kalem')
  assert.equal(unknown.suppliers[0]?.shareBasisPoints, 10_000)
  const free = purchaseReport(
    input([order({ lines: [{ requestItemId: 'r', quantity: 1, unitPriceCents: 1, vatRate: 0 }] })]),
  )
  assert.equal(free.suppliers[0]?.shareBasisPoints, 10_000)
})

test('DOM-FIN-075: CSV tek tablo, formül kaçışlı, vergi numarası yok (K-155)', () => {
  const report = purchaseReport(
    input([
      order(),
      order({
        supplierId: 's-kotu',
        lines: [{ requestItemId: 'r', quantity: 1, unitPriceCents: 5_000, vatRate: 1 }],
      }),
    ]),
  )
  const csv = purchaseReportCsv({
    ...report,
    suppliers: report.suppliers.map((row) =>
      row.supplierId === 's-kotu' ? { ...row, name: '=HYPERLINK("x")' } : row,
    ),
  })
  const lines = csv.split('\r\n')
  assert.equal(
    lines[0],
    '"Kırılım";"Ad";"Kod";"Tür";"Kategoriler";"Sipariş";"Net";"KDV";"Brüt";"Pay (%)"',
  )
  assert.equal(lines[1], '"Toplam";"";"";"";"";2;1050,00;200,50;1250,50;""')
  assert.equal(lines[2], '"Tedarikçi kategorisi";"Bilişim";"";"";"";1;1000,00;200,00;1200,00;95,96')
  assert.ok(
    lines.includes(
      '"Tedarikçi";"Alfa Bilişim A.Ş.";"";"Şirket";"Bilişim";1;1000,00;200,00;1200,00;95,96',
    ),
  )
  assert.ok(
    lines.includes('"Tedarikçi";"\'=HYPERLINK(""x"")";"";"Şirket";"";1;50,00;0,50;50,50;4,04'),
  )
  assert.ok(
    lines.includes('"Maliyet merkezi";"Bilgi İşlem";"BT";"";"";2;1050,00;200,50;1250,50;100,00'),
  )
  assert.ok(
    lines.includes('"Gider kalemi";"Malzeme";"G-200";"";"";2;1050,00;200,50;1250,50;100,00'),
  )
  assert.equal(lines.length, 7)
})
