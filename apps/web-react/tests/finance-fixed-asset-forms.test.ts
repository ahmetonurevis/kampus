import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FixedAssetDetail } from '@kampus/react-shared/use-finance-fixed-assets.ts'
import {
  depreciationRateLabel,
  fixedAssetBody,
  fixedAssetChanges,
  fixedAssetDefaults,
  fixedAssetFormField,
  fixedAssetFormSchema,
  parseUsefulLife,
  reportYears,
  suggestedLife,
} from '../src/pages/finance/finance-fixed-asset-forms.ts'

// ON-235 (DOM-FIN-085): demirbaş form modeli.

const FORM = {
  ...fixedAssetDefaults(undefined, '2026-10-06'),
  name: 'Akıllı tahta',
  category: 'audiovisual' as const,
  location: '2. kat 5-A sınıfı',
  value: '45.000,00',
}

const ASSET: FixedAssetDetail = {
  id: 'fa-1',
  tagNumber: 'DB-2026-0001',
  name: 'Akıllı tahta',
  category: 'audiovisual',
  campusId: null,
  campusName: null,
  location: '2. kat 5-A sınıfı',
  acquisitionValueCents: 4_500_000,
  acquisitionDate: '2026-10-06',
  supplierId: null,
  supplierName: null,
  receiptItemId: null,
  status: 'in_use',
  usefulLifeYears: 5,
  depreciationMethod: 'normal',
  scrapDate: null,
  assignment: null,
  version: 1,
  receipt: null,
  scrappedAt: null,
  scrapReason: null,
  lastCount: null,
  createdAt: '2026-10-06T09:00:00.000Z',
  depreciation: { rateBasisPoints: 2_000, rows: [] },
}

test('DOM-FIN-085: boş etiket, kampüs ve bağlar null olur; değer kuruşa çevrilir (K-185)', () => {
  assert.equal(fixedAssetFormSchema.safeParse(FORM).success, true)
  const body = fixedAssetBody(FORM)
  assert.equal(body.tagNumber, null)
  assert.equal(body.campusId, null)
  assert.equal(body.supplierId, null)
  assert.equal(body.receiptItemId, null)
  assert.equal(body.acquisitionValueCents, 4_500_000)
  assert.equal(body.acquisitionDate, '2026-10-06')
  assert.equal(body.status, 'in_use')
})

test('DOM-FIN-085: geçersiz etiket ve değer formda yakalanır; sunucu alanı form alanına çevrilir', () => {
  assert.equal(fixedAssetFormSchema.safeParse({ ...FORM, tagNumber: 'DB-2026-Ş' }).success, false)
  assert.equal(fixedAssetFormSchema.safeParse({ ...FORM, tagNumber: 'lab 7' }).success, true)
  assert.equal(fixedAssetFormSchema.safeParse({ ...FORM, value: '0' }).success, false)
  assert.equal(fixedAssetFormSchema.safeParse({ ...FORM, value: '12,345' }).success, false)
  assert.equal(fixedAssetFormField('acquisitionValueCents'), 'value')
  assert.equal(fixedAssetFormField('tagNumber'), 'tagNumber')
  assert.equal(fixedAssetFormField('institutionId'), undefined)
})

test('DOM-FIN-085: düzeltme yalnız değişen alanları gönderir; boş etiket korunur', () => {
  const defaults = fixedAssetDefaults(ASSET, '2026-10-07')
  assert.equal(defaults.value, '45000,00')
  assert.equal(defaults.tagNumber, 'DB-2026-0001')
  assert.equal(fixedAssetChanges(defaults, ASSET), null)
  assert.deepEqual(fixedAssetChanges({ ...defaults, status: 'broken', tagNumber: '' }, ASSET), {
    status: 'broken',
  })
  assert.deepEqual(
    fixedAssetChanges({ ...defaults, tagNumber: 'lab-1', value: '40.000,00' }, ASSET),
    { tagNumber: 'lab-1', acquisitionValueCents: 4_000_000 },
  )
  // Hurdaya ayrılmış kaydın formu kullanımda durumuyla açılır (durum seçeneği yok).
  assert.equal(fixedAssetDefaults({ ...ASSET, status: 'scrapped' }, '2026-10-07').status, 'in_use')
})

test('DOM-FIN-088: ömür kategorinin önerisiyle açılır, gövdeye sayı olarak gider; geçersiz ömür formda yakalanır (K-224)', () => {
  assert.equal(FORM.usefulLifeYears, '5')
  assert.equal(FORM.depreciationMethod, 'normal')
  assert.equal(suggestedLife('it'), '4')
  const body = fixedAssetBody({ ...FORM, usefulLifeYears: ' 7 ', depreciationMethod: 'declining' })
  assert.equal(body.usefulLifeYears, 7)
  assert.equal(body.depreciationMethod, 'declining')
  for (const text of ['0', '51', '2,5', '', 'beş', '100'])
    assert.equal(fixedAssetFormSchema.safeParse({ ...FORM, usefulLifeYears: text }).success, false)
  assert.equal(parseUsefulLife('50'), 50)
  assert.equal(parseUsefulLife('1'), 1)
  assert.equal(parseUsefulLife('-3'), null)
})

test('DOM-FIN-088: düzeltme yalnız değişen ömür ve yöntemi gönderir', () => {
  const defaults = fixedAssetDefaults(ASSET, '2026-10-07')
  assert.equal(defaults.usefulLifeYears, '5')
  assert.deepEqual(
    fixedAssetChanges(
      { ...defaults, usefulLifeYears: '10', depreciationMethod: 'declining' },
      ASSET,
    ),
    { usefulLifeYears: 10, depreciationMethod: 'declining' },
  )
})

test('DOM-FIN-088: oran etiketi ve rapor yılları', () => {
  assert.equal(depreciationRateLabel(2_000), '%20')
  assert.equal(depreciationRateLabel(3_333), '%33,33')
  assert.deepEqual(reportYears(2024, 2026, 2026), [2031, 2030, 2029, 2028, 2027, 2026, 2025, 2024])
  assert.deepEqual(reportYears(null, 2026, 2026).at(-1), 2026)
  assert.deepEqual(reportYears(null, 2026, 2020).at(-1), 2020)
  assert.deepEqual(reportYears(2030, 2026, 2026).at(-1), 2026)
})
