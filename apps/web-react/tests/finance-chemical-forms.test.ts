import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChemicalInventoryRow } from '@kampus/react-shared/use-finance-chemicals.ts'
import {
  chemicalProfileBody,
  chemicalProfileDefaults,
  chemicalProfileFormField,
  chemicalProfileFormSchema,
  expiryText,
  lotText,
  pictogramNames,
  signalWordText,
} from '../src/pages/finance/finance-chemical-forms.ts'
import {
  stockMovementBody,
  stockMovementDefaults,
  stockMovementFormField,
  stockMovementFormSchema,
} from '../src/pages/finance/finance-inventory-forms.ts'
import {
  CHEMICAL_INVENTORY_TITLE,
  chemicalInventoryDocument,
  chemicalInventoryFilename,
} from '../src/lib/pdf/templates/finance-chemical-inventory.ts'
import { allTexts, measurer } from './support/pdf-measurer.ts'

// ON-234 (DOM-FIN-090; K-240…K-243): kimyasal bilgisi formu, kimyasal girişinde parti alanları,
// son kullanma gösterimi ve kimyasal envanter PDF'i.

const ITEM = '00000000-0000-4000-8000-0000000000a1'
const LAB = '00000000-0000-4000-8000-0000000000c1'

test('DOM-FIN-090, K-240: kimyasal bilgisi formu CAS sağlama basamağını ve https bağlantısını denetler; gövdede boş metin null', () => {
  const values = {
    ...chemicalProfileDefaults(null),
    hazardPictograms: ['GHS07', 'GHS05'] as ('GHS05' | 'GHS07')[],
    signalWord: 'warning' as const,
    casNumber: '64-17-5',
    sdsUrl: 'https://tedarikci.example/gbf.pdf',
  }
  assert.equal(chemicalProfileFormSchema.safeParse(values).success, true)
  assert.deepEqual(chemicalProfileBody(values), {
    hazardPictograms: ['GHS05', 'GHS07'],
    signalWord: 'warning',
    casNumber: '64-17-5',
    storageClass: null,
    incompatibilityNote: null,
    sdsUrl: 'https://tedarikci.example/gbf.pdf',
    sdsDocumentNumber: null,
    sdsRevisionDate: null,
  })
  const message = (input: object) =>
    chemicalProfileFormSchema.safeParse({ ...values, ...input }).error?.issues[0]?.message ?? ''
  assert.match(message({ casNumber: '64-17-6' }), /sağlama basamağı/)
  assert.match(message({ casNumber: '6417' }), /biçiminde/)
  assert.match(message({ sdsUrl: 'http://example.com' }), /https/)
  assert.match(message({ sdsUrl: 'gbf' }), /https/)
  assert.equal(chemicalProfileFormField('hazardPictograms.0'), 'hazardPictograms')
  assert.equal(chemicalProfileFormField('casNumber'), 'casNumber')
  assert.equal(chemicalProfileFormField('institutionId'), undefined)
  const profile = {
    hazardPictograms: ['GHS02' as const],
    signalWord: 'danger' as const,
    casNumber: '64-17-5',
    storageClass: 'Yanıcı dolabı',
    incompatibilityNote: null,
    sdsUrl: null,
    sdsDocumentNumber: 'GBF-1',
    sdsRevisionDate: '2026-01-15',
    version: 3,
  }
  assert.equal(chemicalProfileDefaults(profile).storageClass, 'Yanıcı dolabı')
  assert.equal(chemicalProfileDefaults(profile).incompatibilityNote, '')
  assert.equal(pictogramNames(['GHS02', 'GHS07']), 'GHS02 Alevlenir · GHS07 Zararlı, tahriş edici')
  assert.equal(pictogramNames([]), '—')
  assert.equal(signalWordText('danger'), 'Tehlike')
  assert.equal(signalWordText(null), '—')
})

test('DOM-FIN-090, K-241: kimyasal girişinde parti gövdeye gider; kimyasal olmayan kartta gizli değer gitmez', () => {
  const values = {
    ...stockMovementDefaults('entry', '2026-10-06', ITEM),
    warehouseId: LAB,
    quantity: '5',
    lotNumber: ' L-1 ',
    expiryDate: '2027-01-31',
  }
  assert.equal(stockMovementFormSchema.safeParse(values).success, true)
  const chemical = stockMovementBody(values, { chemical: true })
  assert.equal(chemical.kind, 'entry')
  assert.equal(chemical.kind === 'entry' ? chemical.body.lotNumber : '', 'L-1')
  const plain = stockMovementBody(values)
  assert.equal(plain.kind === 'entry' ? plain.body.lotNumber : '', null)
  assert.equal(plain.kind === 'entry' ? plain.body.expiryDate : '', null)
  const issues = (input: object) =>
    stockMovementFormSchema.safeParse({ ...values, ...input }).error?.issues.map((i) => i.path[0])
  assert.deepEqual(issues({ expiryDate: '' }), ['expiryDate'])
  assert.deepEqual(issues({ lotNumber: '' }), ['lotNumber'])
  assert.equal(stockMovementFormField('lotNumber'), 'lotNumber')
  assert.equal(stockMovementFormField('expiryDate'), 'expiryDate')
})

test('DOM-FIN-090, K-243: son kullanma metni kalan ve geçen günü yazar; partisiz miktar ayrı', () => {
  assert.equal(
    expiryText({ expiryDate: '2026-10-20', status: 'expiring', daysLeft: 14 }),
    '20 Eki 2026 · 14 gün kaldı',
  )
  assert.equal(
    expiryText({ expiryDate: '2026-10-06', status: 'expiring', daysLeft: 0 }),
    '6 Eki 2026 · bugün son gün',
  )
  assert.equal(
    expiryText({ expiryDate: '2026-10-01', status: 'expired', daysLeft: -5 }),
    '1 Eki 2026 · 5 gün geçti',
  )
  assert.equal(expiryText({ expiryDate: '2027-06-30', status: 'ok', daysLeft: 267 }), '30 Haz 2027')
  assert.equal(
    expiryText({ expiryDate: null, status: 'unknown', daysLeft: null }),
    'Parti bilgisi yok',
  )
  assert.equal(lotText({ lotNumber: null }), 'Parti bilgisi yok')
  assert.equal(lotText({ lotNumber: 'L-1' }), 'L-1')
})

const row = (overrides: Partial<ChemicalInventoryRow> = {}): ChemicalInventoryRow => ({
  key: `${LAB}|${ITEM}`,
  warehouseId: LAB,
  warehouseName: 'Laboratuvar',
  campusName: 'Kadıköy Kampüsü',
  itemId: ITEM,
  code: 'HCL',
  name: 'Hidroklorik asit',
  unit: 'liter',
  casNumber: '7647-01-0',
  hazardPictograms: ['GHS05', 'GHS07'],
  signalWord: 'danger',
  storageClass: 'Asit dolabı',
  hasSds: false,
  quantity: 5,
  nearestExpiryDate: '2026-10-01',
  expiredQuantity: 2,
  expiringQuantity: 0,
  lots: [
    { lotNumber: 'L-1', expiryDate: '2026-10-01', quantity: 2, status: 'expired', daysLeft: -5 },
    { lotNumber: null, expiryDate: null, quantity: 3, status: 'unknown', daysLeft: null },
  ],
  ...overrides,
})

test("DOM-FIN-090: kimyasal envanter PDF'i depo başına partileri, piktogram kodlarını ve özeti yazar", () => {
  const options = {
    institution: 'Akademi Özel Okulları',
    generatedAt: new Date('2026-10-06T09:00:00.000Z'),
    scope: 'Bütün depolar',
  }
  const doc = chemicalInventoryDocument(measurer, [row()], options)
  const words = allTexts(doc).join(' ')
  assert.equal(
    doc.metadata.title.includes('KİMYASAL') || words.includes(CHEMICAL_INVENTORY_TITLE),
    true,
  )
  for (const expected of [
    'Laboratuvar · Kadıköy Kampüsü',
    'GHS05, GHS07',
    '7647-01-0',
    'Tehlike',
    'L-1',
    'süresi geçti',
    'Parti bilgisi yok',
    '3 litre',
    'GBF eksik',
  ])
    assert.ok(words.includes(expected), expected)
  const empty = allTexts(chemicalInventoryDocument(measurer, [], options)).join(' ')
  assert.ok(empty.includes('Stokta kimyasal yok.'))
  assert.equal(
    chemicalInventoryFilename(options.generatedAt, false),
    'kimyasal-envanter-2026-10-06.pdf',
  )
  assert.equal(
    chemicalInventoryFilename(options.generatedAt, true),
    'kimyasal-envanter-2026-10-06-depo.pdf',
  )
})
