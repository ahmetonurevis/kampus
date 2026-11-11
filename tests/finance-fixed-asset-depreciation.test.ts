import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEPRECIATION_REPORT_NOTE,
  DEPRECIATION_REPORT_ROLES,
  depreciationForYear,
  depreciationRateBasisPoints,
  depreciationReport,
  depreciationReportCsv,
  depreciationReportQuerySchema,
  depreciationSchedule,
  type DepreciableAsset,
  type DepreciationReportAsset,
  type DepreciationRow,
} from '../packages/school-core/src/lib/finance-fixed-asset-depreciation.ts'
import {
  DEFAULT_USEFUL_LIFE,
  FIXED_ASSET_CATEGORIES,
  fixedAssetDraft,
  fixedAssetSchema,
  updateFixedAssetSchema,
} from '../packages/school-core/src/lib/finance-fixed-assets.ts'

// Amortisman ön hesabı (DOM-FIN-088; ON-238, IST-142). Yönetim raporudur; defter kaydı yok.

const asset = (overrides: Partial<DepreciableAsset> = {}): DepreciableAsset => ({
  acquisitionValueCents: 1_000_000,
  acquisitionDate: '2024-11-20',
  usefulLifeYears: 5,
  depreciationMethod: 'normal',
  scrapDate: null,
  ...overrides,
})

/** Her satırda mutabakat: dönem başı − ayrılan = net, birikmiş + net = alım değeri. */
function assertConsistent(rows: readonly DepreciationRow[], cost: number) {
  let accumulated = 0
  for (const row of rows) {
    assert.equal(row.openingCents, cost - accumulated)
    accumulated += row.depreciationCents
    assert.equal(row.accumulatedCents, accumulated)
    assert.equal(row.netCents, cost - accumulated)
    assert.ok(row.depreciationCents >= 0)
    assert.ok(Number.isInteger(row.depreciationCents))
  }
}

test('DOM-FIN-088: normal yöntemde alım yılı tam yıldır, eşit pay ve ömür sonunda net değer sıfır (K-225)', () => {
  const rows = depreciationSchedule(asset())
  assert.deepEqual(
    rows.map((row) => [row.year, row.openingCents, row.depreciationCents, row.netCents]),
    [
      [2024, 1_000_000, 200_000, 800_000],
      [2025, 800_000, 200_000, 600_000],
      [2026, 600_000, 200_000, 400_000],
      [2027, 400_000, 200_000, 200_000],
      [2028, 200_000, 200_000, 0],
    ],
  )
  assert.equal(rows.at(-1)?.accumulatedCents, 1_000_000)
  assert.ok(rows.every((row) => row.disposedCents === 0))
})

test('DOM-FIN-088: kuruş küsuratı aşağı yuvarlanır, fark son yılda kapanır (K-225)', () => {
  const rows = depreciationSchedule(asset({ acquisitionValueCents: 100_000, usefulLifeYears: 3 }))
  assert.deepEqual(
    rows.map((row) => row.depreciationCents),
    [33_333, 33_333, 33_334],
  )
  assertConsistent(rows, 100_000)
  // Ömürden küçük değer: ilk yıllar 0, tamamı son yılda.
  const tiny = depreciationSchedule(asset({ acquisitionValueCents: 3, usefulLifeYears: 5 }))
  assert.deepEqual(
    tiny.map((row) => row.depreciationCents),
    [0, 0, 0, 0, 3],
  )
  assertConsistent(tiny, 3)
})

test('DOM-FIN-088: azalan bakiyelerde oran normalin iki katı, son yılda kalan değer ayrılır (VUK md. 316)', () => {
  const rows = depreciationSchedule(asset({ depreciationMethod: 'declining' }))
  assert.deepEqual(
    rows.map((row) => row.depreciationCents),
    [400_000, 240_000, 144_000, 86_400, 129_600],
  )
  assertConsistent(rows, 1_000_000)
  assert.equal(rows.at(-1)?.netCents, 0)
  // Ömür 3: iki kat oran %66,67, üst sınır %50.
  const short = depreciationSchedule(
    asset({ depreciationMethod: 'declining', usefulLifeYears: 3, acquisitionValueCents: 99_999 }),
  )
  assert.deepEqual(
    short.map((row) => row.depreciationCents),
    [49_999, 25_000, 25_000],
  )
  assertConsistent(short, 99_999)
  // Ömür 7: oran 2/7, kuruşa aşağı.
  const seven = depreciationSchedule(asset({ depreciationMethod: 'declining', usefulLifeYears: 7 }))
  assert.equal(seven[0]?.depreciationCents, 285_714)
  assert.equal(seven.length, 7)
  assertConsistent(seven, 1_000_000)
  assert.equal(seven.at(-1)?.netCents, 0)
})

test('DOM-FIN-088: bir yıllık ömürde iki yöntem de alım yılında tamamını ayırır', () => {
  for (const method of ['normal', 'declining'] as const) {
    const rows = depreciationSchedule(asset({ usefulLifeYears: 1, depreciationMethod: method }))
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.depreciationCents, 1_000_000)
    assert.equal(rows[0]?.netCents, 0)
  }
})

test('DOM-FIN-088: elli yıllık ömür ve en büyük değer tam sayı kalır', () => {
  const cost = 10_000_000_000
  for (const method of ['normal', 'declining'] as const) {
    const rows = depreciationSchedule(
      asset({ acquisitionValueCents: cost, usefulLifeYears: 50, depreciationMethod: method }),
    )
    assert.equal(rows.length, 50)
    assertConsistent(rows, cost)
    assert.equal(rows.at(-1)?.accumulatedCents, cost)
  }
})

test('DOM-FIN-088: hurdaya ayrılan demirbaşta ayrılma yılından sonra satır yok, kalan değer düşer (K-226)', () => {
  const rows = depreciationSchedule(asset({ scrapDate: '2026-03-01' }))
  assert.deepEqual(
    rows.map((row) => row.year),
    [2024, 2025, 2026],
  )
  assert.deepEqual(rows.at(-1), {
    year: 2026,
    openingCents: 600_000,
    depreciationCents: 200_000,
    accumulatedCents: 600_000,
    netCents: 400_000,
    disposedCents: 400_000,
  })
  // Alım yılında ayrılan: tek satır.
  const same = depreciationSchedule(asset({ scrapDate: '2024-12-31' }))
  assert.equal(same.length, 1)
  assert.equal(same[0]?.disposedCents, 800_000)
  // Ömür bittikten sonra ayrılan: tablo ömürle biter, düşecek değer yok.
  const late = depreciationSchedule(asset({ scrapDate: '2031-01-10' }))
  assert.equal(late.length, 5)
  assert.ok(late.every((row) => row.disposedCents === 0))
})

test('DOM-FIN-088: yıllık oran baz puan; azalan bakiyelerde en çok %50', () => {
  assert.equal(depreciationRateBasisPoints('normal', 5), 2_000)
  assert.equal(depreciationRateBasisPoints('normal', 3), 3_333)
  assert.equal(depreciationRateBasisPoints('declining', 5), 4_000)
  assert.equal(depreciationRateBasisPoints('declining', 3), 5_000)
  assert.equal(depreciationRateBasisPoints('declining', 1), 5_000)
  assert.equal(depreciationRateBasisPoints('declining', 7), 2_857)
})

test('DOM-FIN-088: yılın durumu alımdan önce ve ayrılmadan sonra yok; ömrünü dolduran net 0 kalır', () => {
  const base = asset({ scrapDate: '2026-05-01' })
  assert.equal(depreciationForYear(base, 2023), null)
  assert.equal(depreciationForYear(base, 2027), null)
  assert.deepEqual(depreciationForYear(base, 2024), {
    costCents: 1_000_000,
    openingNetCents: 0,
    additionsCents: 1_000_000,
    depreciationCents: 200_000,
    disposedCents: 0,
    accumulatedCents: 200_000,
    closingNetCents: 800_000,
    acquiredThisYear: true,
    scrappedThisYear: false,
  })
  assert.deepEqual(depreciationForYear(base, 2026), {
    costCents: 1_000_000,
    openingNetCents: 600_000,
    additionsCents: 0,
    depreciationCents: 200_000,
    disposedCents: 400_000,
    accumulatedCents: 600_000,
    closingNetCents: 0,
    acquiredThisYear: false,
    scrappedThisYear: true,
  })
  const held = depreciationForYear(asset(), 2035)
  assert.equal(held?.depreciationCents, 0)
  assert.equal(held?.openingNetCents, 0)
  assert.equal(held?.accumulatedCents, 1_000_000)
  assert.equal(held?.closingNetCents, 0)
  // Ömrü bitmiş demirbaş geç hurdaya ayrılırsa düşecek değer yok.
  const lateScrap = depreciationForYear(asset({ scrapDate: '2033-02-01' }), 2033)
  assert.equal(lateScrap?.disposedCents, 0)
  assert.equal(lateScrap?.scrappedThisYear, true)
})

const reportAsset = (
  id: string,
  overrides: Partial<DepreciationReportAsset> = {},
): DepreciationReportAsset => ({
  ...asset(),
  id,
  tagNumber: `DB-2024-${id}`,
  name: `Demirbaş ${id}`,
  category: 'it',
  status: 'in_use',
  ...overrides,
})

const ASSETS: DepreciationReportAsset[] = [
  reportAsset('0002', { usefulLifeYears: 4, acquisitionValueCents: 400_000 }),
  reportAsset('0001', { category: 'furniture', acquisitionDate: '2026-02-01' }),
  reportAsset('0003', { category: 'it', scrapDate: '2026-06-01', status: 'scrapped' }),
  reportAsset('0004', { category: 'vehicle', acquisitionDate: '2027-01-05' }),
  reportAsset('0005', { category: 'furniture', scrapDate: '2025-06-01', status: 'scrapped' }),
  reportAsset('0006', {
    category: 'furniture',
    depreciationMethod: 'declining',
    acquisitionDate: '2025-03-01',
  }),
]

test('DOM-FIN-088: yıl raporu kurum toplamı, kategori kırılımı ve mutabakat verir', () => {
  const report = depreciationReport(ASSETS, 2026)
  assert.equal(report.year, 2026)
  // 0004 sonraki yıl alındı, 0005 önceki yıl ayrıldı: yok.
  assert.deepEqual(
    report.assets.map((line) => line.tagNumber),
    ['DB-2024-0001', 'DB-2024-0006', 'DB-2024-0002', 'DB-2024-0003'],
  )
  const { totals } = report
  assert.equal(totals.assetCount, 4)
  assert.equal(totals.heldCount, 3)
  assert.equal(totals.disposedCount, 1)
  // 0002: 100.000/yıl, 2026 üçüncü yıl; 0001: alım yılı 200.000; 0006: azalan 2. yıl 240.000;
  // 0003: 200.000 ayrılır, kalan 400.000 düşer.
  assert.equal(totals.depreciationCents, 100_000 + 200_000 + 240_000 + 200_000)
  assert.equal(totals.additionsCents, 1_000_000)
  assert.equal(totals.disposedCents, 400_000)
  assert.equal(totals.openingNetCents, 200_000 + 600_000 + 600_000)
  assert.equal(
    totals.openingNetCents +
      totals.additionsCents -
      totals.depreciationCents -
      totals.disposedCents,
    totals.closingNetCents,
  )
  assert.equal(totals.costCents - totals.accumulatedCents, totals.closingNetCents)
  assert.equal(totals.costCents, 400_000 + 1_000_000 + 1_000_000)
  assert.deepEqual(
    report.categories.map((row) => [row.category, row.assetCount, row.closingNetCents]),
    [
      ['furniture', 2, 800_000 + 360_000],
      ['it', 2, 100_000],
    ],
  )
  for (const row of report.categories)
    assert.equal(
      row.openingNetCents + row.additionsCents - row.depreciationCents - row.disposedCents,
      row.closingNetCents,
    )
  const line = report.assets.find((item) => item.tagNumber === 'DB-2024-0006')
  assert.equal(line?.rateBasisPoints, 4_000)
  assert.equal(line?.depreciationMethod, 'declining')
})

test('DOM-FIN-088: demirbaşı olmayan yılda rapor boş, toplamlar sıfır', () => {
  const report = depreciationReport(ASSETS, 2010)
  assert.equal(report.assets.length, 0)
  assert.equal(report.categories.length, 0)
  assert.equal(report.totals.assetCount, 0)
  assert.equal(report.totals.closingNetCents, 0)
  assert.equal(depreciationReport([], 2026).totals.depreciationCents, 0)
})

test('DOM-FIN-088: CSV önce yönetim raporu notunu, sonra satırları ve toplamları yazar (IST-142)', () => {
  const csv = depreciationReportCsv(depreciationReport(ASSETS, 2026))
  const lines = csv.split('\r\n')
  assert.equal(lines[0], `"Amortisman ön hesabı 2026";"${DEPRECIATION_REPORT_NOTE}"`)
  assert.match(lines[0] ?? '', /resmî defter yerine geçmez/)
  assert.match(lines[1] ?? '', /^"Satır";"Etiket";"Ad";"Kategori"/)
  assert.equal(lines.length, 2 + 4 + 2 + 1)
  assert.equal(
    lines[2],
    '"Demirbaş";"DB-2024-0001";"Demirbaş 0001";"Mobilya";"2026-02-01";"Normal (doğrusal)";5;20,00;"Kullanımda";10000,00;0,00;10000,00;2000,00;0,00;2000,00;8000,00',
  )
  assert.match(
    lines[5] ?? '',
    /"Hurdaya ayrıldı \(2026-06-01\)";10000,00;6000,00;0,00;2000,00;4000,00/,
  )
  assert.match(lines[6] ?? '', /^"Kategori toplamı";"";"2 demirbaş";"Mobilya"/)
  assert.match(lines.at(-1) ?? '', /^"Toplam";"";"4 demirbaş"/)
  assert.ok((lines.at(-1) ?? '').endsWith(';4000,00;11400,00;12600,00'))
  // Formül kaçışı: "=" ile başlayan ad.
  const tricky = depreciationReportCsv(
    depreciationReport([reportAsset('0009', { name: '=HYPERLINK("x")' })], 2024),
  )
  assert.match(tricky, /"'=HYPERLINK\(""x""\)"/)
})

test('DOM-FIN-088: rapor sorgusu yılı sayıya çevirir, aralık dışını reddeder; rol yalnız yönetici', () => {
  assert.deepEqual(depreciationReportQuerySchema.parse({ year: '2026' }), { year: 2026 })
  assert.deepEqual(depreciationReportQuerySchema.parse({}), {})
  for (const year of ['1899', '2101', '2026.5', 'abc'])
    assert.equal(depreciationReportQuerySchema.safeParse({ year }).success, false)
  assert.equal(depreciationReportQuerySchema.safeParse({ year: '2026', other: 1 }).success, false)
  assert.deepEqual([...DEPRECIATION_REPORT_ROLES], ['yonetici'])
})

test('DOM-FIN-088: demirbaş kaydı ömrü ve yöntemi alır; ömür boşsa kategori önerisi yazılır (K-224)', () => {
  const base = {
    name: 'Dizüstü bilgisayar',
    category: 'it',
    location: 'Öğretmenler odası',
    acquisitionValueCents: 3_500_000,
    acquisitionDate: '2026-01-10',
  }
  const parsed = fixedAssetSchema.parse(base)
  assert.equal(parsed.usefulLifeYears, null)
  assert.equal(parsed.depreciationMethod, 'normal')
  assert.equal(fixedAssetDraft(parsed, 'DB-2026-0001').usefulLifeYears, 4)
  const chosen = fixedAssetSchema.parse({
    ...base,
    usefulLifeYears: 3,
    depreciationMethod: 'declining',
  })
  assert.equal(fixedAssetDraft(chosen, 'DB-2026-0001').usefulLifeYears, 3)
  for (const usefulLifeYears of [0, 51, 2.5]) {
    const result = fixedAssetSchema.safeParse({ ...base, usefulLifeYears })
    assert.equal(result.success, false)
    assert.deepEqual(result.error?.issues[0]?.path, ['usefulLifeYears'])
  }
  assert.equal(fixedAssetSchema.safeParse({ ...base, depreciationMethod: 'sum' }).success, false)
  assert.equal(updateFixedAssetSchema.safeParse({ usefulLifeYears: 10 }).success, true)
  assert.equal(updateFixedAssetSchema.safeParse({ usefulLifeYears: null }).success, false)
  assert.equal(updateFixedAssetSchema.safeParse({ depreciationMethod: 'declining' }).success, true)
  // Her kategorinin önerisi var ve sınırlar içinde.
  for (const category of FIXED_ASSET_CATEGORIES) {
    assert.ok(DEFAULT_USEFUL_LIFE[category] >= 1 && DEFAULT_USEFUL_LIFE[category] <= 50)
  }
  assert.equal(DEFAULT_USEFUL_LIFE.it, 4)
  assert.equal(DEFAULT_USEFUL_LIFE.vehicle, 5)
})
