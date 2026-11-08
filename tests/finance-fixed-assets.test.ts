import assert from 'node:assert/strict'
import test from 'node:test'

import {
  fixedAssetSchema,
  fixedAssetTagNumber,
  nextFixedAssetTag,
  planFixedAsset,
  planFixedAssetScrap,
  scrapFixedAssetSchema,
  updateFixedAssetSchema,
  type FixedAssetDraft,
  type FixedAssetReceiptRef,
} from '../packages/school-core/src/lib/finance-fixed-assets.ts'

import { isDomainError } from './support/domain-error.ts'

// Demirbaş kaydı (DOM-FIN-085; ON-235). Bugün 2026-10-06.

const TODAY = '2026-10-06'
const SUPPLIER = '6f1d1c1e-0000-4000-8000-000000000001'
const OTHER_SUPPLIER = '6f1d1c1e-0000-4000-8000-000000000002'
const ITEM = '6f1d1c1e-0000-4000-8000-0000000000aa'
const BASE = {
  name: 'Akıllı tahta',
  category: 'audiovisual',
  location: '2. kat 5-A sınıfı',
  acquisitionValueCents: 4_500_000,
  acquisitionDate: '2026-09-01',
}
const draft = (overrides: Partial<FixedAssetDraft> = {}): FixedAssetDraft => ({
  ...fixedAssetSchema.parse(BASE),
  tagNumber: 'DB-2026-0001',
  status: 'in_use',
  ...overrides,
})
const receipt = (overrides: Partial<FixedAssetReceiptRef> = {}): FixedAssetReceiptRef => ({
  receiptItemId: ITEM,
  receiptDate: '2026-09-01',
  cancelled: false,
  acceptedQuantity: 2,
  linkedAssetCount: 1,
  supplierId: SUPPLIER,
  ...overrides,
})

test('DOM-FIN-085: önerilen etiket DB-<yıl>-<sıra>; yılın en büyük sırasından devam eder (K-185)', () => {
  assert.equal(fixedAssetTagNumber(2026, 7), 'DB-2026-0007')
  assert.equal(fixedAssetTagNumber(2026, 12_345), 'DB-2026-12345')
  assert.equal(nextFixedAssetTag(2026, []), 'DB-2026-0001')
  assert.equal(
    nextFixedAssetTag(2026, ['DB-2026-0002', 'DB-2026-0010', 'DB-2025-0099', 'LAB-7', 'DB-2026-X']),
    'DB-2026-0011',
  )
})

test('DOM-FIN-085: yeni kayıt şeması varsayılanları doldurur; etiket büyük harfe çevrilir', () => {
  const parsed = fixedAssetSchema.parse({ ...BASE, tagNumber: ' lab 07 ' })
  assert.equal(parsed.tagNumber, 'LAB07')
  assert.equal(parsed.status, 'in_use')
  assert.equal(parsed.campusId, null)
  assert.equal(parsed.supplierId, null)
  assert.equal(parsed.receiptItemId, null)
  assert.equal(fixedAssetSchema.parse(BASE).tagNumber, null)
})

test('DOM-FIN-085: geçersiz alanlar reddedilir; hurdaya ayırma durum olarak seçilemez', () => {
  for (const body of [
    { ...BASE, tagNumber: 'DB-2026-ŞŞ' },
    { ...BASE, tagNumber: '-A1' },
    { ...BASE, name: 'A' },
    { ...BASE, category: 'weapons' },
    { ...BASE, location: '' },
    { ...BASE, acquisitionValueCents: 0 },
    { ...BASE, acquisitionValueCents: 12.5 },
    { ...BASE, acquisitionDate: '2026-02-30' },
    { ...BASE, supplierId: 'x' },
    { ...BASE, status: 'scrapped' },
    { ...BASE, institutionId: 'b' },
  ])
    assert.equal(fixedAssetSchema.safeParse(body).success, false, JSON.stringify(body))
  assert.equal(updateFixedAssetSchema.safeParse({}).success, false)
  assert.equal(updateFixedAssetSchema.safeParse({ status: 'scrapped' }).success, false)
  assert.equal(updateFixedAssetSchema.safeParse({ status: 'broken' }).success, true)
  assert.equal(scrapFixedAssetSchema.safeParse({ reason: 'kır', scrapDate: TODAY }).success, false)
})

test('DOM-FIN-085: geçerli kayıt değişmeden döner; tekil etiket, gelecek gün, kampüs ve tedarikçi denetlenir', () => {
  assert.deepEqual(planFixedAsset(draft(), { today: TODAY, tagTaken: false }), draft())
  assert.throws(
    () => planFixedAsset(draft(), { today: TODAY, tagTaken: true }),
    isDomainError('fixed_asset_tag_exists', 'conflict'),
  )
  assert.throws(
    () =>
      planFixedAsset(draft({ acquisitionDate: '2026-10-07' }), { today: TODAY, tagTaken: false }),
    isDomainError('fixed_asset_date_in_future'),
  )
  assert.throws(
    () => planFixedAsset(draft(), { today: TODAY, tagTaken: false, campusFound: false }),
    isDomainError('fixed_asset_campus_not_found'),
  )
  assert.throws(
    () => planFixedAsset(draft(), { today: TODAY, tagTaken: false, supplierFound: false }),
    isDomainError('fixed_asset_supplier_not_found'),
  )
  assert.throws(
    () => planFixedAsset(draft({ status: 'scrapped' }), { today: TODAY, tagTaken: false }),
    isDomainError('fixed_asset_scrapped'),
  )
})

test('DOM-FIN-085: mal kabul bağı tedarikçiyi siparişten alır; kabul edilen miktarı aşamaz (K-187)', () => {
  const linked = draft({ receiptItemId: ITEM })
  const checks = { today: TODAY, tagTaken: false }
  assert.equal(
    planFixedAsset(linked, { ...checks, receipt: { ref: receipt(), link: true } }).supplierId,
    SUPPLIER,
  )
  assert.throws(
    () => planFixedAsset(linked, { ...checks, receipt: { ref: null, link: true } }),
    isDomainError('fixed_asset_receipt_item_not_found'),
  )
  assert.throws(
    () =>
      planFixedAsset(linked, {
        ...checks,
        receipt: { ref: receipt({ cancelled: true }), link: true },
      }),
    isDomainError('fixed_asset_receipt_cancelled'),
  )
  assert.throws(
    () =>
      planFixedAsset(linked, {
        ...checks,
        receipt: { ref: receipt({ linkedAssetCount: 2 }), link: true },
      }),
    isDomainError('fixed_asset_receipt_quantity_exceeded'),
  )
  assert.throws(
    () =>
      planFixedAsset(
        { ...linked, supplierId: OTHER_SUPPLIER },
        { ...checks, receipt: { ref: receipt(), link: true } },
      ),
    isDomainError('fixed_asset_supplier_mismatch'),
  )
  assert.throws(
    () =>
      planFixedAsset(
        { ...linked, acquisitionDate: '2026-08-31' },
        { ...checks, receipt: { ref: receipt(), link: true } },
      ),
    isDomainError('fixed_asset_date_before_receipt'),
  )
  // Bağ yeni değilse iptal ve miktar yeniden denetlenmez; tedarikçi uyumu denetlenir.
  assert.equal(
    planFixedAsset(
      { ...linked, supplierId: SUPPLIER },
      {
        ...checks,
        receipt: { ref: receipt({ cancelled: true, linkedAssetCount: 5 }), link: false },
      },
    ).supplierId,
    SUPPLIER,
  )
  // Bağsız kayıtta kabul denetimi yapılmaz.
  assert.equal(
    planFixedAsset(draft(), { ...checks, receipt: { ref: null, link: true } }).supplierId,
    null,
  )
})

test('DOM-FIN-085: hurdaya ayırma geri alınmaz; gün alım gününden önce ve bugünden sonra olamaz (K-188)', () => {
  const asset = { status: 'broken' as const, acquisitionDate: '2026-09-01' }
  assert.doesNotThrow(() => planFixedAssetScrap(asset, { scrapDate: TODAY }, TODAY))
  assert.doesNotThrow(() => planFixedAssetScrap(asset, { scrapDate: '2026-09-01' }, TODAY))
  assert.throws(
    () => planFixedAssetScrap({ ...asset, status: 'scrapped' }, { scrapDate: TODAY }, TODAY),
    isDomainError('fixed_asset_scrapped'),
  )
  assert.throws(
    () => planFixedAssetScrap(asset, { scrapDate: '2026-10-07' }, TODAY),
    isDomainError('fixed_asset_date_in_future'),
  )
  assert.throws(
    () => planFixedAssetScrap(asset, { scrapDate: '2026-08-31' }, TODAY),
    isDomainError('fixed_asset_scrap_before_acquisition'),
  )
  const parsed = scrapFixedAssetSchema.parse({
    reason: '  Ekran kırık, onarılamaz  ',
    scrapDate: TODAY,
  })
  assert.equal(parsed.reason, 'Ekran kırık, onarılamaz')
})
