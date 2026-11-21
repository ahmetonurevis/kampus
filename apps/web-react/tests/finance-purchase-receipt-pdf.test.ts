import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  PurchaseReceipt,
  PurchaseReceiptBoard,
} from '@kampus/react-shared/use-finance-purchase-receipts.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import {
  PURCHASE_RECEIPT_TITLE,
  purchaseReceiptDocument,
  purchaseReceiptFilename,
  RECEIPT_CANCELLED_MARK,
} from '../src/lib/pdf/templates/finance-purchase-receipt.ts'
import { allTexts, measurer, texts } from './support/pdf-measurer.ts'

// Mal kabul tutanağı şablonu (DOM-FIN-074; ON-337). Rakamlar API yanıtından gelir; şablon yalnız
// yerleşimi ve hangi alanın belgeye girdiğini belirler.

const OPTIONS = {
  institution: 'Akademi Özel Okulları',
  generatedAt: new Date('2026-10-06T15:00:00.000Z'),
}

const order = (
  supplier: Partial<PurchaseReceiptBoard['order']['supplier']> = {},
): PurchaseReceiptBoard['order'] => ({
  id: 'o1',
  number: 'SA-2026-0007',
  status: 'partially_received',
  supplier: {
    name: 'Beta Teknoloji Ltd.',
    type: 'company',
    taxOffice: 'Kadıköy',
    taxNumber: '1111111114',
    ...supplier,
  },
  version: 3,
})

type Line = PurchaseReceipt['lines'][number]
const line = (overrides: Partial<Line> = {}): Line => ({
  orderItemId: 'i1',
  name: 'Klavye',
  unit: 'piece',
  orderedQuantity: 10,
  unitPriceCents: 19_000,
  acceptedQuantity: 6,
  rejectedQuantity: 2,
  rejectReason: 'Tuşları kırık',
  netCents: 114_000,
  stockItemId: null,
  stockItemName: null,
  ...overrides,
})

const receipt = (overrides: Partial<PurchaseReceipt> = {}): PurchaseReceipt => ({
  id: 'r1',
  sequence: 2,
  receiptDate: '2026-10-06',
  warehouseId: null,
  warehouseName: null,
  receivedBy: 'Hasan Usta',
  inspectionNote: 'Kutular hasarlı geldi',
  netCents: 150_000,
  lines: [
    line(),
    line({
      orderItemId: 'i2',
      name: 'Fare',
      orderedQuantity: 3,
      unitPriceCents: 12_000,
      acceptedQuantity: 3,
      rejectedQuantity: 0,
      rejectReason: null,
      netCents: 36_000,
    }),
  ],
  createdAt: '2026-10-06T10:00:00.000Z',
  createdByName: 'Selin Kaya',
  cancelledAt: null,
  cancelledByName: null,
  cancelReason: null,
  actions: { cancel: true },
  version: 1,
  ...overrides,
})

test('DOM-FIN-074: tutanak kurum, sipariş, tedarikçi, kabul günü, teslim alan, kalemler ve toplamı yazar', () => {
  const document = purchaseReceiptDocument(measurer, order(), receipt(), OPTIONS)
  const all = allTexts(document)
  for (const text of [
    'MAL KABUL TUTANAĞI',
    'MAL KABUL',
    PURCHASE_RECEIPT_TITLE,
    'SA-2026-0007-MK2',
    'Akademi Özel Okulları',
    'SA-2026-0007',
    'Beta Teknoloji Ltd. (Şirket)',
    'Kadıköy / 1111111114',
    'Hasan Usta',
    'Kutular hasarlı geldi',
    'Klavye',
    '10 adet',
    '6 adet',
    '2',
    'Tuşları kırık',
    money(19_000),
    money(114_000),
    money(36_000),
    money(150_000),
    'Toplam',
    'Ret nedeni',
    'Birim fiyat',
    'Teslim eden (tedarikçi adına)',
    'Teslim alan · Hasan Usta',
  ])
    assert.ok(all.includes(text), text)
  assert.ok(all.some((text) => text.includes('KDV hariç')))
  assert.ok(
    all.some((text) => text.startsWith('Selin Kaya ·')),
    'kaydeden',
  )
  assert.ok(all.includes(dateLabel('2026-10-06T09:00:00.000Z', { year: 'numeric' })), 'kabul günü')
  assert.ok(!all.includes(RECEIPT_CANCELLED_MARK))
  assert.ok(!all.includes('Stok deposu'))
  // Kısa tutanak imza alanlarıyla birlikte tek sayfadır.
  assert.equal(document.pages.length, 1)
  assert.equal(document.metadata.title, 'MAL KABUL TUTANAĞI')
  assert.equal(
    purchaseReceiptFilename(order(), receipt()),
    'mal-kabul-tutanagi-SA-2026-0007-MK2.pdf',
  )
})

test('DOM-FIN-074, K-215: şahıs tedarikçide vergi dairesi ve vergi numarası alanı yoktur', () => {
  const all = allTexts(
    purchaseReceiptDocument(
      measurer,
      order({ name: 'Ayla Örnek', type: 'individual', taxOffice: null, taxNumber: null }),
      receipt(),
      OPTIONS,
    ),
  )
  assert.ok(all.includes('Ayla Örnek (Şahıs)'))
  assert.ok(!all.includes('Vergi dairesi / numarası'))
})

test('DOM-FIN-074, DOM-FIN-078: stok kartı bağlı kabulde depo adı ve stok kartı yazılır', () => {
  const all = allTexts(
    purchaseReceiptDocument(
      measurer,
      order(),
      receipt({
        warehouseId: 'w1',
        warehouseName: 'Merkez depo',
        lines: [line({ stockItemId: 's1', stockItemName: 'KLV-01 Klavye' })],
      }),
      OPTIONS,
    ),
  )
  assert.ok(all.includes('Stok deposu'))
  assert.ok(all.includes('Merkez depo'))
  // Hücre metni sütun genişliğinde satırlara bölünür.
  assert.ok(all.join(' ').includes('Klavye · stok: KLV-01 Klavye'))
})

test('DOM-FIN-074: iptal edilmiş kabulün tutanağı İPTAL rozeti, işaret bandı ve gerekçeyle üretilir', () => {
  const document = purchaseReceiptDocument(
    measurer,
    order(),
    receipt({
      cancelledAt: '2026-10-07T08:00:00.000Z',
      cancelledByName: 'Okul Yöneticisi',
      cancelReason: 'Yanlış siparişe girildi',
      actions: { cancel: false },
    }),
    OPTIONS,
  )
  const first = texts(document.pages[0] ?? { ops: [] })
  assert.ok(first.includes('İPTAL'))
  assert.ok(first.includes(RECEIPT_CANCELLED_MARK))
  assert.ok(first.some((text) => text.includes('tutanak geçerli değildir')))
  assert.ok(allTexts(document).some((text) => text.includes('Yanlış siparişe girildi')))
})

test('DOM-FIN-074: çok kalemli tutanakta tablo başlığı her sayfada tekrarlanır, sayfa ve belge numarası yazılır', () => {
  const lines = Array.from({ length: 40 }, (_, index) =>
    line({ orderItemId: `i${String(index)}`, name: `Kalem ${String(index + 1)}` }),
  )
  const document = purchaseReceiptDocument(measurer, order(), receipt({ lines }), OPTIONS)
  assert.ok(document.pages.length > 1)
  document.pages.forEach((page, index) => {
    const pageTexts = texts(page)
    assert.ok(pageTexts.includes(`${String(index + 1)} / ${String(document.pages.length)}`))
    assert.ok(pageTexts.includes('Belge no: SA-2026-0007-MK2'))
    if (pageTexts.some((text) => /^Kalem \d+$/.test(text)))
      assert.ok(pageTexts.includes('Ret nedeni'), `sayfa ${String(index + 1)} tablo başlığı`)
  })
  assert.ok(allTexts(document).includes('Kalem 40'))
})
