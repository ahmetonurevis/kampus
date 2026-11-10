import { z } from 'zod'

import { CSV_SEPARATOR, csvAmount, csvCell } from './csv.ts'
import {
  DEPRECIATION_METHOD_LABELS,
  FIXED_ASSET_CATEGORIES,
  FIXED_ASSET_CATEGORY_LABELS,
  FIXED_ASSET_ROLES,
  FIXED_ASSET_STATUS_LABELS,
  type DepreciationMethod,
  type FixedAssetCategory,
  type FixedAssetStatus,
} from './finance-fixed-assets.ts'

/**
 * Amortisman ön hesabı (docs/domain/finans.md DOM-FIN-088; ON-238, IST-142). Demirbaşın KDV hariç
 * alım değeri (kuruş), alım günü, faydalı ömrü ve yöntemi (DOM-FIN-085) üzerinden yıllık tablo ve
 * yıl seçimli kurum raporu üretir. **Yönetim raporudur:** yevmiye ya da defter kaydı üretmez,
 * resmî defter yerine geçmez (IST-142); oranlar ve kurallar mali müşavir doğrulaması bekler (M-31).
 *
 * - Hesap yılı takvim yılıdır; alım yılı tam yıl sayılır, kıst amortisman yoktur (K-225).
 * - Normal (doğrusal): yıllık pay alım değeri ÷ ömürdür, kuruşa aşağı yuvarlanır; kalan kuruşlar
 *   son yılda ayrılır (K-225).
 * - Azalan bakiyeler: oran normalin iki katıdır, en çok %50; her yıl dönem başı net değer × oran,
 *   kuruşa aşağı yuvarlanır; ömrün son yılında kalan net değerin tamamı ayrılır (VUK md. 316).
 * - Hurdaya ayrılan demirbaşta ayrılma yılının amortismanı ayrılır, o yıl kalan net değer
 *   "hurdaya ayrılan" olarak kayıttan düşer; sonraki yıllarda satır yoktur (K-226).
 *
 * Fonksiyonlar saftır; değer saklanmaz, her okumada hesaplanır.
 */

/** Raporu okuyan rol: demirbaşı okuyan rolle aynı (K-189; ön büro görmez). */
export const DEPRECIATION_REPORT_ROLES = FIXED_ASSET_ROLES

/** Ekranda ve CSV'de raporun niteliğini söyleyen not (IST-142). */
export const DEPRECIATION_REPORT_NOTE =
  'Yönetim raporu (ön hesap); resmî defter yerine geçmez, muhasebe kaydı üretmez. Oranlar mali müşavirce doğrulanmalıdır.'

export const DEPRECIATION_YEAR_MIN = 1900
export const DEPRECIATION_YEAR_MAX = 2100

/** Hesabın girdisi: demirbaş kaydının ilgili alanları. */
export interface DepreciableAsset {
  acquisitionValueCents: number
  /** `YYYY-MM-DD` (Europe/Istanbul). */
  acquisitionDate: string
  usefulLifeYears: number
  depreciationMethod: DepreciationMethod
  /** Hurdaya ayırma günü; ayrılmadıysa `null`. */
  scrapDate: string | null
}

/** Tablonun bir yılı. Tutarlar kuruş. */
export interface DepreciationRow {
  year: number
  /** Dönem başı net değer (alım yılında alım değeri). */
  openingCents: number
  /** Yılın amortismanı (ayrılan). */
  depreciationCents: number
  /** Yıl sonunda birikmiş amortisman. */
  accumulatedCents: number
  /** Yıl sonunda net değer: alım değeri − birikmiş amortisman. */
  netCents: number
  /** Hurdaya ayırma yılında kayıttan düşen net değer; öteki yıllarda 0. */
  disposedCents: number
}

const yearOf = (day: string) => Number(day.slice(0, 4))

/**
 * Yıllık oran, baz puan (1 = %0,01). Normal 1 ÷ ömür; azalan bakiyeler bunun iki katı, en çok %50.
 * Gösterim içindir; tutarlar tam sayı kuruşla hesaplanır.
 */
export function depreciationRateBasisPoints(
  method: DepreciationMethod,
  usefulLifeYears: number,
): number {
  const normal = 10_000 / usefulLifeYears
  return Math.round(method === 'declining' ? Math.min(normal * 2, 5_000) : normal)
}

/** Yılın payı: son yıl kalanın tamamı; öncesinde yöntem payı, kuruşa aşağı yuvarlanır. */
function yearShare(asset: DepreciableAsset, opening: number, isLastYear: boolean): number {
  if (isLastYear) return opening
  const life = asset.usefulLifeYears
  if (asset.depreciationMethod === 'normal')
    return Math.min(opening, Math.floor(asset.acquisitionValueCents / life))
  // Azalan bakiyeler: oran 2 ÷ ömür, ömür 4 yıldan kısaysa %50 (VUK md. 316).
  return life >= 4 ? Math.floor((opening * 2) / life) : Math.floor(opening / 2)
}

/**
 * Yıllık amortisman tablosu (DOM-FIN-088): alım yılından ömrün son yılına (hurdaya ayrıldıysa
 * ayrılma yılına) kadar her yıl bir satır. Ömür sonunda birikmiş amortisman alım değerine eşittir.
 */
export function depreciationSchedule(asset: DepreciableAsset): DepreciationRow[] {
  const cost = asset.acquisitionValueCents
  const first = yearOf(asset.acquisitionDate)
  const lastYear = first + asset.usefulLifeYears - 1
  const scrapYear = asset.scrapDate === null ? null : yearOf(asset.scrapDate)
  const end = scrapYear === null ? lastYear : Math.min(lastYear, scrapYear)
  const rows: DepreciationRow[] = []
  let accumulated = 0
  for (let year = first; year <= end; year += 1) {
    const opening = cost - accumulated
    const depreciation = yearShare(asset, opening, year === lastYear)
    accumulated += depreciation
    const net = cost - accumulated
    rows.push({
      year,
      openingCents: opening,
      depreciationCents: depreciation,
      accumulatedCents: accumulated,
      netCents: net,
      disposedCents: year === scrapYear ? net : 0,
    })
  }
  return rows
}

/** Demirbaşın seçilen yıldaki durumu (rapor satırı); o yıl kayıtta değilse `null`. */
export interface DepreciationYearState {
  /** Alım değeri. */
  costCents: number
  /** Yıl başında kayıtta olan demirbaşın dönem başı net değeri; alım yılında 0. */
  openingNetCents: number
  /** Alım yılında alım değeri (yıl içi giriş); öteki yıllarda 0. */
  additionsCents: number
  depreciationCents: number
  /** Ayrılma yılında kayıttan düşen net değer. */
  disposedCents: number
  /** Yıl sonunda birikmiş amortisman (yıl içinde hurdaya ayrılan için ayrılma anındaki). */
  accumulatedCents: number
  /** Yıl sonunda net değer; yıl içinde hurdaya ayrılanda 0. */
  closingNetCents: number
  acquiredThisYear: boolean
  scrappedThisYear: boolean
}

/**
 * Seçilen yılın durumu. Alım yılından önce ya da ayrılma yılından sonra `null`. Ömrünü doldurmuş,
 * kayıtta duran demirbaş amortismansız, net değeri 0 olarak döner.
 */
export function depreciationForYear(
  asset: DepreciableAsset,
  year: number,
): DepreciationYearState | null {
  const first = yearOf(asset.acquisitionDate)
  const scrapYear = asset.scrapDate === null ? null : yearOf(asset.scrapDate)
  if (year < first || (scrapYear !== null && year > scrapYear)) return null
  const cost = asset.acquisitionValueCents
  const row = depreciationSchedule(asset).find((item) => item.year === year)
  const acquiredThisYear = year === first
  const scrappedThisYear = year === scrapYear
  const opening = row?.openingCents ?? 0
  const accumulated = row?.accumulatedCents ?? cost
  return {
    costCents: cost,
    openingNetCents: acquiredThisYear ? 0 : opening,
    additionsCents: acquiredThisYear ? cost : 0,
    depreciationCents: row?.depreciationCents ?? 0,
    disposedCents: scrappedThisYear ? cost - accumulated : 0,
    accumulatedCents: accumulated,
    closingNetCents: scrappedThisYear ? 0 : cost - accumulated,
    acquiredThisYear,
    scrappedThisYear,
  }
}

// --- Kurum raporu --------------------------------------------------------------------------------

/** Rapor sorgusu: yıl boşsa sunucu bugünün yılını (Europe/Istanbul) kullanır. */
export const depreciationReportQuerySchema = z.strictObject({
  year: z.coerce
    .number('Yılı seçin.')
    .int('Yıl tam sayı olmalıdır.')
    .min(DEPRECIATION_YEAR_MIN, 'Yıl geçersiz.')
    .max(DEPRECIATION_YEAR_MAX, 'Yıl geçersiz.')
    .optional()
    .describe('Hesap yılı (takvim yılı); boşsa bu yıl'),
})
export type DepreciationReportQuery = z.output<typeof depreciationReportQuerySchema>

/** Raporun girdisi: kurumun demirbaşı. */
export interface DepreciationReportAsset extends DepreciableAsset {
  id: string
  tagNumber: string
  name: string
  category: FixedAssetCategory
  status: FixedAssetStatus
}

/**
 * Rapor tutarları. Mutabakat: `openingNetCents + additionsCents − depreciationCents −
 * disposedCents = closingNetCents`; yıl sonu `costCents − accumulatedCents = closingNetCents`.
 */
export interface DepreciationTotals {
  /** Yıl içinde kayıtta olan demirbaş (yıl içinde alınan ve ayrılan dahil). */
  assetCount: number
  /** Yıl sonunda kayıtta kalan demirbaş. */
  heldCount: number
  /** Yıl içinde hurdaya ayrılan demirbaş. */
  disposedCount: number
  /** Yıl sonunda kayıtta kalanların alım değeri. */
  costCents: number
  openingNetCents: number
  additionsCents: number
  depreciationCents: number
  disposedCents: number
  /** Yıl sonunda kayıtta kalanların birikmiş amortismanı. */
  accumulatedCents: number
  closingNetCents: number
}

export interface DepreciationAssetLine extends DepreciationYearState {
  id: string
  tagNumber: string
  name: string
  category: FixedAssetCategory
  status: FixedAssetStatus
  acquisitionDate: string
  scrapDate: string | null
  usefulLifeYears: number
  depreciationMethod: DepreciationMethod
  rateBasisPoints: number
}

export interface DepreciationReport {
  year: number
  totals: DepreciationTotals
  /** Sabit kategori sırasıyla; yıl içinde demirbaşı olmayan kategori yok. */
  categories: (DepreciationTotals & { category: FixedAssetCategory })[]
  /** Demirbaş satırları (CSV); kategori sırası, sonra etiket. */
  assets: DepreciationAssetLine[]
}

const emptyTotals = (): DepreciationTotals => ({
  assetCount: 0,
  heldCount: 0,
  disposedCount: 0,
  costCents: 0,
  openingNetCents: 0,
  additionsCents: 0,
  depreciationCents: 0,
  disposedCents: 0,
  accumulatedCents: 0,
  closingNetCents: 0,
})

function addTo(totals: DepreciationTotals, line: DepreciationYearState): void {
  totals.assetCount += 1
  totals.openingNetCents += line.openingNetCents
  totals.additionsCents += line.additionsCents
  totals.depreciationCents += line.depreciationCents
  totals.disposedCents += line.disposedCents
  totals.closingNetCents += line.closingNetCents
  if (line.scrappedThisYear) {
    totals.disposedCount += 1
    return
  }
  totals.heldCount += 1
  totals.costCents += line.costCents
  totals.accumulatedCents += line.accumulatedCents
}

/** Yıl seçimli kurum raporu (DOM-FIN-088): toplam, kategori kırılımı ve demirbaş satırları. */
export function depreciationReport(
  assets: readonly DepreciationReportAsset[],
  year: number,
): DepreciationReport {
  const totals = emptyTotals()
  const byCategory = new Map<FixedAssetCategory, DepreciationTotals>()
  const lines: DepreciationAssetLine[] = []
  for (const asset of assets) {
    const state = depreciationForYear(asset, year)
    if (state === null) continue
    addTo(totals, state)
    const bucket = byCategory.get(asset.category) ?? emptyTotals()
    addTo(bucket, state)
    byCategory.set(asset.category, bucket)
    lines.push({
      ...state,
      id: asset.id,
      tagNumber: asset.tagNumber,
      name: asset.name,
      category: asset.category,
      status: asset.status,
      acquisitionDate: asset.acquisitionDate,
      scrapDate: asset.scrapDate,
      usefulLifeYears: asset.usefulLifeYears,
      depreciationMethod: asset.depreciationMethod,
      rateBasisPoints: depreciationRateBasisPoints(asset.depreciationMethod, asset.usefulLifeYears),
    })
  }
  const order = (category: FixedAssetCategory) => FIXED_ASSET_CATEGORIES.indexOf(category)
  lines.sort(
    (a, b) => order(a.category) - order(b.category) || a.tagNumber.localeCompare(b.tagNumber, 'tr'),
  )
  return {
    year,
    totals,
    categories: FIXED_ASSET_CATEGORIES.flatMap((category) => {
      const bucket = byCategory.get(category)
      return bucket === undefined ? [] : [{ category, ...bucket }]
    }),
    assets: lines,
  }
}

// --- CSV -----------------------------------------------------------------------------------------

const CSV_HEADER = [
  'Satır',
  'Etiket',
  'Ad',
  'Kategori',
  'Alım günü',
  'Yöntem',
  'Faydalı ömür (yıl)',
  'Yıllık oran (%)',
  'Bugünkü durum',
  'Alım değeri (KDV hariç)',
  'Dönem başı net değer',
  'Yıl içi giriş',
  'Yıl amortismanı',
  'Hurdaya ayrılan net değer',
  'Birikmiş amortisman',
  'Yıl sonu net değer',
] as const

const rateCell = (basisPoints: number) => csvAmount(basisPoints)

const amountCells = (row: {
  costCents: number
  openingNetCents: number
  additionsCents: number
  depreciationCents: number
  disposedCents: number
  accumulatedCents: number
  closingNetCents: number
}) => [
  csvAmount(row.costCents),
  csvAmount(row.openingNetCents),
  csvAmount(row.additionsCents),
  csvAmount(row.depreciationCents),
  csvAmount(row.disposedCents),
  csvAmount(row.accumulatedCents),
  csvAmount(row.closingNetCents),
]

/**
 * Raporun CSV'si: ilk satır yönetim raporu notu (IST-142), sonra başlık, demirbaş satırları,
 * kategori toplamları ve kurum toplamı. Toplam satırlarında alım değeri ve birikmiş amortisman yıl
 * sonunda kayıtta kalanlarındır; satırda hurdaya ayrılan demirbaşın değerleri ayrılma anındakidir.
 */
export function depreciationReportCsv(report: DepreciationReport): string {
  const blank = csvCell('')
  const rows: string[][] = [
    [csvCell(`Amortisman ön hesabı ${String(report.year)}`), csvCell(DEPRECIATION_REPORT_NOTE)],
    CSV_HEADER.map(csvCell),
    ...report.assets.map((line) => [
      csvCell('Demirbaş'),
      csvCell(line.tagNumber),
      csvCell(line.name),
      csvCell(FIXED_ASSET_CATEGORY_LABELS[line.category]),
      csvCell(line.acquisitionDate),
      csvCell(DEPRECIATION_METHOD_LABELS[line.depreciationMethod]),
      String(line.usefulLifeYears),
      rateCell(line.rateBasisPoints),
      csvCell(
        line.scrapDate === null
          ? FIXED_ASSET_STATUS_LABELS[line.status]
          : `${FIXED_ASSET_STATUS_LABELS.scrapped} (${line.scrapDate})`,
      ),
      ...amountCells(line),
    ]),
    ...report.categories.map((row) => [
      csvCell('Kategori toplamı'),
      blank,
      csvCell(`${String(row.assetCount)} demirbaş`),
      csvCell(FIXED_ASSET_CATEGORY_LABELS[row.category]),
      ...Array<string>(5).fill(blank),
      ...amountCells(row),
    ]),
    [
      csvCell('Toplam'),
      blank,
      csvCell(`${String(report.totals.assetCount)} demirbaş`),
      ...Array<string>(6).fill(blank),
      ...amountCells(report.totals),
    ],
  ]
  return rows.map((row) => row.join(CSV_SEPARATOR)).join('\r\n')
}
