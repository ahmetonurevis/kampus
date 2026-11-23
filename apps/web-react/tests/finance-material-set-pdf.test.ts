import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  MaterialDeliveryDetail,
  MaterialSetDetail,
  MaterialStudentRow,
} from '@kampus/react-shared/use-finance-material-sets.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import {
  DELIVERY_CANCELLED_MARK,
  FEE_CHARGED_TEXT,
  FEE_NOT_CHARGED_TEXT,
  MATERIAL_DELIVERY_LIST_TITLE,
  MATERIAL_DELIVERY_TITLE,
  materialDeliveryDocument,
  materialDeliveryFilename,
  materialDeliveryListDocument,
  materialDeliveryListFilename,
} from '../src/lib/pdf/templates/finance-material-set-delivery.ts'
import { allTexts, measurer, texts } from './support/pdf-measurer.ts'

// Materyal seti teslim tutanağı ve toplu teslim listesi (DOM-FIN-080; ON-338). Veri API yanıtından
// gelir; şablon yalnız yerleşimi ve hangi alanın belgeye girdiğini belirler.

const OPTIONS = {
  institution: 'Akademi Özel Okulları',
  generatedAt: new Date('2026-10-06T15:00:00.000Z'),
}
const DAY = dateLabel('2026-10-06T09:00:00.000Z', { year: 'numeric' })

const delivery = (overrides: Partial<MaterialDeliveryDetail> = {}): MaterialDeliveryDetail => ({
  id: '3f2a9c1d-0000-4000-8000-000000000001',
  setId: 'set-1',
  setName: '7. Sınıf Seti',
  academicYear: 2026,
  studentId: 's1',
  studentName: 'Deniz Yılmaz',
  studentNumber: '1001',
  className: '7-A',
  hasMaterialFee: true,
  warehouseId: 'w1',
  warehouseName: 'Ana depo',
  deliveryDate: '2026-10-06',
  recipientKind: 'guardian',
  recipientName: 'Ayşe Yılmaz',
  signatureReceived: true,
  signatureRecordedAt: '2026-10-06T10:00:00.000Z',
  note: 'Kitap kapağı yırtık değiştirildi',
  items: [
    { stockItemId: 'i1', code: 'KIT-7', name: '7. sınıf kitabı', unit: 'piece', quantity: 1 },
    { stockItemId: 'i2', code: 'DFT', name: 'Defter', unit: 'piece', quantity: 3 },
  ],
  createdAt: '2026-10-06T10:00:00.000Z',
  createdByName: 'Selin Kaya',
  cancelledAt: null,
  cancelledByName: null,
  cancelReason: null,
  actions: { cancel: true, sign: false },
  version: 1,
  ...overrides,
})

test('DOM-FIN-080, K-218: tutanak kurum, set, kalemler, öğrenci, sınıf, teslim alan, teslim eden, gün ve iki imza alanını yazar', () => {
  const document = materialDeliveryDocument(measurer, delivery(), OPTIONS)
  const all = allTexts(document)
  for (const text of [
    'MATERYAL TESLİM TUTANAĞI',
    'TESLİM',
    MATERIAL_DELIVERY_TITLE,
    'MT-3F2A9C1D',
    'Akademi Özel Okulları',
    '7. Sınıf Seti · 2026–2027',
    'Deniz Yılmaz',
    '1001',
    'Sınıf / grup',
    '7-A',
    DAY,
    'Ayşe Yılmaz (kayıtlı veli)',
    'Selin Kaya',
    'Ana depo',
    'Materyal ücreti',
    FEE_CHARGED_TEXT,
    'KIT-7',
    '7. sınıf kitabı',
    '1 adet',
    '3 adet',
    'Teslim eden · Selin Kaya',
    'Teslim alan · Ayşe Yılmaz (kayıtlı veli)',
  ])
    assert.ok(all.includes(text), text)
  // Tutar, ödeme durumu ve teslim notu belgeye girmez (K-207, K-218).
  const joined = all.join(' ')
  assert.ok(!joined.includes('₺'), 'tutar')
  assert.ok(!joined.includes(money(150_000)))
  assert.ok(!/ödendi|ödenmedi|borç/i.test(joined), 'ödeme durumu')
  assert.ok(!joined.includes('Kitap kapağı'), 'not')
  assert.ok(!all.includes(DELIVERY_CANCELLED_MARK))
  // İki imza çizgisi: tutanak tek sayfadır.
  assert.equal(document.pages.length, 1)
  assert.equal(
    document.pages[0]?.ops.filter((op) => op.kind === 'line' && op.y > 200 && op.y < 276).length,
    2,
  )
  assert.equal(document.metadata.title, 'MATERYAL TESLİM TUTANAĞI')
  assert.equal(materialDeliveryFilename(delivery()), 'materyal-teslim-tutanagi-MT-3F2A9C1D.pdf')
})

test('DOM-FIN-080, K-218: ücret kalemi yoksa "tahakkuk edilmedi"; öğrencinin kendisi teslim aldıysa adı yazılır; dil okulunda kursiyer', () => {
  const all = allTexts(
    materialDeliveryDocument(
      measurer,
      delivery({
        hasMaterialFee: false,
        recipientKind: 'student',
        recipientName: null,
        className: 'B1 Akşam',
        studentNumber: null,
      }),
      { ...OPTIONS, institutionType: 'language_school' },
    ),
  )
  assert.ok(all.includes(FEE_NOT_CHARGED_TEXT))
  assert.ok(!all.includes(FEE_CHARGED_TEXT))
  assert.ok(all.includes('Deniz Yılmaz (öğrencinin kendisi)'))
  assert.ok(all.includes('Kursiyer'))
  assert.ok(all.includes('Kursiyer numarası'))
  assert.ok(all.includes('B1 Akşam'))
})

test('DOM-FIN-080, K-209: iptal edilmiş teslimin tutanağı İPTAL rozeti, işaret bandı ve gerekçeyle üretilir', () => {
  const document = materialDeliveryDocument(
    measurer,
    delivery({
      cancelledAt: '2026-10-07T08:00:00.000Z',
      cancelledByName: 'Okul Yöneticisi',
      cancelReason: 'Yanlış öğrenciye yazıldı',
      actions: { cancel: false, sign: false },
    }),
    OPTIONS,
  )
  const first = texts(document.pages[0] ?? { ops: [] })
  assert.ok(first.includes('İPTAL'))
  assert.ok(first.includes(DELIVERY_CANCELLED_MARK))
  assert.ok(first.some((text) => text.includes('tutanak geçerli değildir')))
  assert.ok(allTexts(document).some((text) => text.includes('Yanlış öğrenciye yazıldı')))
})

test('DOM-FIN-080: çok kalemli tutanakta tablo başlığı her sayfada tekrarlanır, sayfa ve belge numarası yazılır', () => {
  const items = Array.from({ length: 40 }, (_, index) => ({
    stockItemId: `i${String(index)}`,
    code: `K-${String(index + 1)}`,
    name: `Kalem ${String(index + 1)}`,
    unit: 'piece' as const,
    quantity: 1,
  }))
  const document = materialDeliveryDocument(measurer, delivery({ items }), OPTIONS)
  assert.ok(document.pages.length > 1)
  document.pages.forEach((page, index) => {
    const pageTexts = texts(page)
    assert.ok(pageTexts.includes(`${String(index + 1)} / ${String(document.pages.length)}`))
    assert.ok(pageTexts.includes('Belge no: MT-3F2A9C1D'))
    if (pageTexts.some((text) => /^Kalem \d+$/.test(text)))
      assert.ok(pageTexts.includes('Ürün'), `sayfa ${String(index + 1)} tablo başlığı`)
  })
  assert.ok(allTexts(document).includes('Kalem 40'))
})

const set = (overrides: Partial<MaterialSetDetail> = {}): MaterialSetDetail => ({
  id: 'a1b2c3d4-0000-4000-8000-000000000002',
  name: '7. Sınıf Seti',
  academicYear: 2026,
  gradeLevel: 7,
  courseId: null,
  courseName: null,
  isActive: true,
  itemCount: 2,
  studentCount: 2,
  deliveredCount: 1,
  hasDeliveries: true,
  items: [
    {
      stockItemId: 'i1',
      code: 'KIT-7',
      name: '7. sınıf kitabı',
      unit: 'piece',
      isActive: true,
      quantity: 1,
    },
    { stockItemId: 'i2', code: 'DFT', name: 'Defter', unit: 'piece', isActive: true, quantity: 3 },
  ],
  version: 1,
  ...overrides,
})

const student = (overrides: Partial<MaterialStudentRow> = {}): MaterialStudentRow => ({
  studentId: 's1',
  studentName: 'Deniz Yılmaz',
  studentNumber: '1001',
  className: '7-A',
  hasMaterialFee: true,
  delivery: {
    id: 'd1',
    deliveryDate: '2026-10-06',
    recipientKind: 'student',
    recipientName: null,
    signatureReceived: true,
    warehouseName: 'Ana depo',
    version: 1,
  },
  cancelledDelivery: null,
  actions: { deliver: false, sign: false, cancel: true },
  ...overrides,
})

test('DOM-FIN-080, K-219: toplu liste öğrenci, sınıf, teslim günü ve boş imza sütununu yazar; ücret yazılmaz', () => {
  const rows = [
    student(),
    student({
      studentId: 's25',
      studentName: 'Mert Can',
      studentNumber: null,
      hasMaterialFee: false,
      delivery: null,
      actions: { deliver: true, sign: false, cancel: false },
    }),
  ]
  const document = materialDeliveryListDocument(
    measurer,
    { set: set(), rows, filter: 'Bütün öğrenciler' },
    OPTIONS,
  )
  const all = allTexts(document)
  for (const text of [
    'MATERYAL TESLİM LİSTESİ',
    MATERIAL_DELIVERY_LIST_TITLE,
    'Akademi Özel Okulları',
    '7. Sınıf Seti · 2026–2027',
    '7. sınıf',
    'Bütün öğrenciler',
    'Deniz Yılmaz',
    'Mert Can',
    '7-A',
    DAY,
    'İmza',
    'Teslim günü',
    'Sınıf / grup',
    'TESLİM EDİLEN',
    'BEKLEYEN',
    'Dağıtımı yapan personel',
  ])
    assert.ok(all.includes(text), text)
  assert.ok(all.join(' ').includes('7. sınıf kitabı × 1 adet; Defter × 3 adet'))
  assert.ok(!all.some((text) => /Ücretli|Ücret kalemi|Tahakkuk/.test(text)), 'ücret')
  assert.equal(
    materialDeliveryListFilename(set(), OPTIONS.generatedAt),
    'materyal-teslim-listesi-ML-A1B2C3D4-2026-10-06.pdf',
  )
})

test('DOM-FIN-080, K-219: uzun listede tablo başlığı her sayfada tekrarlanır, sayfa ve liste numarası yazılır', () => {
  const rows = Array.from({ length: 60 }, (_, index) =>
    student({ studentId: `s${String(index)}`, studentName: `Öğrenci ${String(index + 1)}` }),
  )
  const document = materialDeliveryListDocument(
    measurer,
    { set: set(), rows, filter: 'Durum: Teslim edildi' },
    OPTIONS,
  )
  assert.ok(document.pages.length > 2)
  document.pages.forEach((page, index) => {
    const pageTexts = texts(page)
    assert.ok(pageTexts.includes(`${String(index + 1)} / ${String(document.pages.length)}`))
    assert.ok(pageTexts.includes('Belge no: ML-A1B2C3D4'))
    if (pageTexts.some((text) => /^Öğrenci \d+$/.test(text)))
      assert.ok(pageTexts.includes('İmza'), `sayfa ${String(index + 1)} tablo başlığı`)
  })
  assert.ok(allTexts(document).includes('Öğrenci 60'))
})
