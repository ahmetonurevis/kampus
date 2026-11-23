import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  FixedAssetCount,
  FixedAssetCountItem,
  FixedAssetScan,
} from '@kampus/react-shared/use-finance-fixed-asset-counts.ts'
import {
  countBody,
  countFormSchema,
  itemFilterOptions,
  itemOutcome,
  scanBody,
  scanFeedback,
  scanFormField,
  scanFormSchema,
} from '../src/pages/finance/finance-fixed-asset-count-forms.ts'
import {
  FIXED_ASSET_COUNT_TITLE,
  fixedAssetCountDocument,
  fixedAssetCountFilename,
} from '../src/lib/pdf/templates/finance-fixed-asset-count.ts'
import {
  fixedAssetLabelsDocument,
  fixedAssetLabelsFilename,
  LABEL_GRID,
  LABELS_PER_PAGE,
} from '../src/lib/pdf/templates/finance-fixed-asset-labels.ts'
import { qrMatrix } from '../src/lib/pdf/qr.ts'
import { allTexts, measurer, texts } from './support/pdf-measurer.ts'

// ON-237 (DOM-FIN-087): karekodlu etiket sayfası, sayım tutanağı PDF'i ve sayım form modeli.

const OPTIONS = {
  institution: 'Akademi Özel Okulları',
  generatedAt: new Date('2026-10-06T15:00:00.000Z'),
}
const LAB = '2. kat fen laboratuvarı'
const count = (overrides: Partial<FixedAssetCount> = {}): FixedAssetCount => ({
  id: 'fc-1',
  scopeType: 'location',
  campusId: 'b1',
  campusName: 'Kadıköy Kampüsü',
  location: LAB,
  note: 'Yıl sonu',
  status: 'completed',
  startedAt: '2026-10-06T08:00:00.000Z',
  completedAt: '2026-10-06T12:00:00.000Z',
  cancelledAt: null,
  version: 2,
  summary: { expected: 2, found: 1, misplaced: 1, pending: 1, extra: 1 },
  ...overrides,
})
const item = (overrides: Partial<FixedAssetCountItem> = {}): FixedAssetCountItem => ({
  id: 'fi-1',
  assetId: 'fa-1',
  inScope: true,
  tagNumber: 'DB-2026-0001',
  assetName: 'Akıllı tahta',
  recordedCampusId: 'b1',
  recordedCampusName: 'Kadıköy Kampüsü',
  recordedLocation: LAB,
  result: 'found',
  observedCampusId: 'b1',
  observedCampusName: 'Kadıköy Kampüsü',
  observedLocation: LAB,
  scannedAt: '2026-10-06T09:00:00.000Z',
  relocatedAt: null,
  version: 2,
  ...overrides,
})
const ITEMS = [
  item(),
  item({
    id: 'fi-2',
    tagNumber: 'DB-2026-0002',
    assetName: 'Mikroskop',
    result: 'pending',
    observedCampusId: null,
    observedCampusName: null,
    observedLocation: null,
    scannedAt: null,
  }),
  item({
    id: 'fi-3',
    tagNumber: 'DB-2026-0003',
    assetName: 'Kitaplık',
    inScope: false,
    recordedCampusName: 'Beşiktaş Kampüsü',
    recordedLocation: 'Kütüphane',
    result: 'misplaced',
    relocatedAt: '2026-10-06T13:00:00.000Z',
  }),
]

test('DOM-FIN-087: etiket sayfası 3 × 8 ızgarada karekod, etiket, ad ve kurum yazar; 24 sonrası yeni sayfa', () => {
  const label = (index: number) => ({
    tagNumber: `DB-2026-${String(index).padStart(4, '0')}`,
    name: 'Projektör tavan askı aparatı, uzaktan kumanda, HDMI kablosu ve duvar montaj takımı, sınıf seti',
    qr: qrMatrix(`DB-2026-${String(index).padStart(4, '0')}`),
  })
  const labels = Array.from({ length: LABELS_PER_PAGE + 1 }, (_, index) => label(index + 1))
  const document = fixedAssetLabelsDocument(measurer, labels, OPTIONS)
  assert.equal(document.pages.length, 2)
  assert.equal(document.metadata.title, 'DEMİRBAŞ ETİKETLERİ')
  const first = texts(document.pages[0] ?? { ops: [] })
  assert.equal(first.filter((text) => text.startsWith('DB-2026-')).length, LABELS_PER_PAGE)
  assert.ok(first.includes('Akademi Özel Okulları'))
  assert.ok(
    first.some((text) => text.endsWith('…')),
    'uzun ad kısaltılır',
  )
  const second = texts(document.pages[1] ?? { ops: [] })
  assert.ok(second.includes('DB-2026-0025'))
  // Karekod modülleri etiket kutusunun içinde kalır.
  for (const op of document.pages[0]?.ops ?? [])
    if (op.kind === 'rect') {
      assert.ok(op.x >= 0 && op.x + op.width <= LABEL_GRID.width * LABEL_GRID.columns + 0.01)
      assert.ok(op.y >= 0 && op.y + op.height <= LABEL_GRID.height * LABEL_GRID.rows + 0.01)
    }
  assert.throws(() => fixedAssetLabelsDocument(measurer, [], OPTIONS))
})

test('DOM-FIN-087: karekod yalnız etiket numarasını taşır; dosya adında kişi verisi yok', () => {
  const matrix = qrMatrix('DB-2026-0001')
  assert.equal(matrix.size, 21, 'kısa etiket en küçük karekod sürümüne sığar')
  assert.equal(
    fixedAssetLabelsFilename([{ tagNumber: 'LAB/01' }], OPTIONS.generatedAt),
    'demirbas-etiketi-LAB-01.pdf',
  )
  assert.equal(
    fixedAssetLabelsFilename([{ tagNumber: 'A1' }, { tagNumber: 'A2' }], OPTIONS.generatedAt),
    'demirbas-etiketleri-2-2026-10-06.pdf',
  )
})

test('DOM-FIN-087: sayım tutanağı kapsam, özet, bulunamayan, yanlış konumda ve imza alanlarını yazar', () => {
  const text = allTexts(fixedAssetCountDocument(measurer, count(), ITEMS, OPTIONS)).join(' ')
  for (const part of [
    'DEMİRBAŞ SAYIM TUTANAĞI',
    FIXED_ASSET_COUNT_TITLE,
    'Akademi Özel Okulları',
    `Kadıköy Kampüsü · ${LAB}`,
    'Tamamlandı',
    'Yıl sonu',
    'Bulunamayanlar (1)',
    'DB-2026-0002',
    'Yanlış konumda bulunanlar (1)',
    'DB-2026-0003 (listede yoktu)',
    'kayıt düzeltildi',
    'Bulundu (1)',
    'Sayımı yapan',
    'Onaylayan',
  ])
    assert.ok(text.includes(part), part)
  assert.equal(fixedAssetCountFilename(count()), 'demirbas-sayimi-2026-10-06-completed.pdf')
  const open = allTexts(
    fixedAssetCountDocument(measurer, count({ status: 'open', completedAt: null }), ITEMS, OPTIONS),
  ).join('\n')
  assert.ok(open.includes('Okunmayanlar (1)'))
  const fresh = allTexts(
    fixedAssetCountDocument(
      measurer,
      count({ status: 'cancelled', completedAt: null, cancelledAt: '2026-10-06T10:00:00.000Z' }),
      [ITEMS[1] ?? item()],
      OPTIONS,
    ),
  ).join('\n')
  assert.ok(fresh.includes('İptal'))
  assert.ok(fresh.includes('Bu sayımda henüz demirbaş okutulmadı.'))
})

test('DOM-FIN-087: başlatma formu kapsamın istediği alanı denetler ve gövdeyi kapsamına göre kurar', () => {
  const parse = (values: object) =>
    countFormSchema.safeParse({
      scopeType: 'location',
      campusId: '',
      location: '',
      note: '',
      ...values,
    })
  assert.equal(parse({ location: 'A' }).success, false)
  assert.equal(parse({ scopeType: 'campus' }).success, false)
  assert.equal(parse({ scopeType: 'institution' }).success, true)
  assert.deepEqual(
    countBody({ scopeType: 'location', campusId: '', location: ` ${LAB} `, note: ' ' }),
    { scopeType: 'location', campusId: null, location: LAB, note: null },
  )
  assert.deepEqual(countBody({ scopeType: 'campus', campusId: 'b1', location: 'x', note: 'Not' }), {
    scopeType: 'campus',
    campusId: 'b1',
    note: 'Not',
  })
  assert.deepEqual(
    countBody({ scopeType: 'institution', campusId: 'b1', location: 'x', note: '' }),
    {
      scopeType: 'institution',
      note: null,
    },
  )
})

test('DOM-FIN-087: okutma formu kurum ve kampüs sayımında oda ister; gövde kapsamına göre', () => {
  const values = { code: 'db-2026-0001', campusId: 'b2', location: ` ${LAB} ` }
  assert.equal(scanFormSchema('location').safeParse({ ...values, location: '' }).success, true)
  assert.equal(scanFormSchema('campus').safeParse({ ...values, location: '' }).success, false)
  assert.equal(scanFormSchema('institution').safeParse({ ...values, code: '  ' }).success, false)
  assert.deepEqual(scanBody('location', values), { code: 'db-2026-0001' })
  assert.deepEqual(scanBody('campus', values), { code: 'db-2026-0001', location: LAB })
  assert.deepEqual(scanBody('institution', values), {
    code: 'db-2026-0001',
    campusId: 'b2',
    location: LAB,
  })
  assert.deepEqual(scanBody('institution', { ...values, campusId: '' }), {
    code: 'db-2026-0001',
    location: LAB,
  })
  assert.equal(scanFormField('location'), 'location')
  assert.equal(scanFormField('campusId'), 'campusId')
  assert.equal(scanFormField(undefined), 'code')
})

test('DOM-FIN-087: okutma geri bildirimi sonucu, kayıtlı yeri ve listede olmadığını söyler', () => {
  const scan = (overrides: Partial<FixedAssetScan>): FixedAssetScan => ({
    outcome: 'found',
    item: item(),
    summary: count().summary,
    ...overrides,
  })
  assert.deepEqual(scanFeedback(scan({})), {
    text: 'DB-2026-0001 · Akıllı tahta: bulundu.',
    tone: 'green',
  })
  const moved = scanFeedback(scan({ outcome: 'misplaced', item: ITEMS[2] ?? item() }))
  assert.equal(moved.tone, 'amber')
  assert.match(moved.text, /yanlış konumda\. Kayıtlı yer: Beşiktaş Kampüsü · Kütüphane\./)
  assert.match(moved.text, /listesinde yoktu/)
  assert.equal(scanFeedback(scan({ outcome: 'already_counted' })).tone, 'gray')
  assert.equal(itemFilterOptions('completed')[1].label, 'Bulunamadı')
  assert.equal(itemFilterOptions('open')[1].label, 'Okunmadı')
  assert.equal(itemOutcome({ result: 'pending' }, { status: 'completed' }), 'missing')
})
