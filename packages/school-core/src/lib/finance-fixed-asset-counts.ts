import { z } from 'zod'

import { csvCell } from './csv.ts'
import { DomainError } from './errors.ts'
import {
  FIXED_ASSET_LOCATION_MAX,
  FIXED_ASSET_TAG_MAX,
  normalizeFixedAssetTag,
  type FixedAssetStatus,
} from './finance-fixed-assets.ts'
import { dayKey, timeLabel } from './format.ts'

/**
 * Demirbaş sayımı (docs/domain/finans.md DOM-FIN-087; ON-237). Yönetici bir kapsam (bütün kurum,
 * bir kampüs ya da bir oda/konum) için sayım başlatır; başlangıçta kapsamdaki hurdaya ayrılmamış
 * demirbaşlar beklenen liste olarak dondurulur (K-232). Etiketteki karekod yalnız etiket numarasını
 * taşır; okuyucu klavye gibi yazar, kod Enter'la işaretlenir. Okunan demirbaş sayılan yerle kayıtlı
 * yeri aynıysa "bulundu", değilse "yanlış konumda" olur; kurumda olmayan kod (başka kurumun
 * demirbaşı dahil) ve hurdaya ayrılmış demirbaş reddedilir (K-233). Aynı kapsamda tek açık sayım
 * olur; sayım `open` → `completed` ya da `cancelled` (K-234). Tamamlama demirbaş kaydını
 * değiştirmez: okunmayan demirbaş "bulunamadı" raporlanır, hurdaya ayrılmaz; yanlış konumdaki
 * demirbaşın kaydı yalnız yöneticinin tek tıkla onayıyla sayılan yere taşınır (K-235). Fonksiyonlar
 * saftır.
 */

export const FIXED_ASSET_COUNT_SCOPE_TYPES = ['institution', 'campus', 'location'] as const
export type FixedAssetCountScopeType = (typeof FIXED_ASSET_COUNT_SCOPE_TYPES)[number]
export const FIXED_ASSET_COUNT_SCOPE_TYPE_LABELS = {
  institution: 'Bütün kurum',
  campus: 'Kampüs',
  location: 'Oda / konum',
} as const satisfies Record<FixedAssetCountScopeType, string>

export const FIXED_ASSET_COUNT_STATUSES = ['open', 'completed', 'cancelled'] as const
export type FixedAssetCountStatus = (typeof FIXED_ASSET_COUNT_STATUSES)[number]
export const FIXED_ASSET_COUNT_STATUS_LABELS = {
  open: 'Sürüyor',
  completed: 'Tamamlandı',
  cancelled: 'İptal edildi',
} as const satisfies Record<FixedAssetCountStatus, string>

/** Sayım satırının saklanan sonucu; `pending` henüz okunmamış beklenen demirbaştır. */
export const FIXED_ASSET_COUNT_ITEM_RESULTS = ['pending', 'found', 'misplaced'] as const
export type FixedAssetCountItemResult = (typeof FIXED_ASSET_COUNT_ITEM_RESULTS)[number]

/** Rapordaki sonuç: tamamlanmış sayımda okunmayan beklenen demirbaş `missing` olur. */
export const FIXED_ASSET_COUNT_OUTCOMES = ['found', 'misplaced', 'missing', 'pending'] as const
export type FixedAssetCountOutcome = (typeof FIXED_ASSET_COUNT_OUTCOMES)[number]
export const FIXED_ASSET_COUNT_OUTCOME_LABELS = {
  found: 'Bulundu',
  misplaced: 'Yanlış konumda',
  missing: 'Bulunamadı',
  pending: 'Okunmadı',
} as const satisfies Record<FixedAssetCountOutcome, string>

/** Okutma yanıtı: yeni işaretlenen `found`/`misplaced` ya da daha önce okunmuş `already_counted`. */
export const FIXED_ASSET_SCAN_OUTCOMES = ['found', 'misplaced', 'already_counted'] as const
export type FixedAssetScanOutcome = (typeof FIXED_ASSET_SCAN_OUTCOMES)[number]

export const FIXED_ASSET_COUNT_NOTE_MAX = 200
/** Bir sayımın beklenen listesi en çok bu kadar demirbaştır; büyük kurum kampüs ya da odaya böler. */
export const FIXED_ASSET_COUNT_MAX_ITEMS = 5000
export const FIXED_ASSET_COUNT_CODE_MAX = FIXED_ASSET_TAG_MAX + 40

// --- Konum karşılaştırması ----------------------------------------------------------------------

const FOLD = new Map([...'ıİğĞüÜşŞöÖçÇ'].map((char, index) => [char, 'iigguussoocc'[index]]))

/** Konum metni Türkçe harf, büyük/küçük harf ve boşluk farkı gözetmeden karşılaştırılır. */
export const foldFixedAssetLocation = (value: string) =>
  [...value.trim()]
    .map((char) => FOLD.get(char) ?? char)
    .join('')
    .toLowerCase()
    .replace(/\s+/g, ' ')

export interface FixedAssetPlace {
  campusId: string | null
  location: string
}

/** İki yer aynı mı: kampüs birebir, konum harf ve boşluk farkı gözetmeden (K-233). */
export const sameFixedAssetPlace = (a: FixedAssetPlace, b: FixedAssetPlace) =>
  a.campusId === b.campusId &&
  foldFixedAssetLocation(a.location) === foldFixedAssetLocation(b.location)

/**
 * Okuyucunun yazdığı kod etiket biçimine çevrilir. Karekod okuyucu ABD klavyesi gibi yazar; Türkçe
 * Q düzeninde `-` tuşu `*`, `.` tuşu `ç` olarak gelir. Bu karakterler etikette geçmediği için geri
 * çevrilir (K-233); sonra etiket kuralı (boşluk atılır, büyük harf) uygulanır.
 */
export function normalizeFixedAssetCountCode(raw: string): string {
  const mapped = [...raw]
    .map((char) => (char === '*' ? '-' : char === 'ç' || char === 'Ç' ? '.' : char))
    .join('')
  return normalizeFixedAssetTag(mapped).replaceAll('İ', 'I')
}

// --- Şemalar -------------------------------------------------------------------------------------

const noteSchema = z
  .string()
  .trim()
  .max(
    FIXED_ASSET_COUNT_NOTE_MAX,
    `En fazla ${String(FIXED_ASSET_COUNT_NOTE_MAX)} karakter girebilirsiniz.`,
  )
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .default(null)
const campusSchema = z.string('Kampüs seçin.').trim().min(1, 'Kampüs seçin.').max(100)
const locationSchema = z
  .string('Konumu yazın.')
  .trim()
  .min(2, 'Konumu en az 2 karakterle yazın (ör. 2. kat fen laboratuvarı).')
  .max(
    FIXED_ASSET_LOCATION_MAX,
    `En fazla ${String(FIXED_ASSET_LOCATION_MAX)} karakter girebilirsiniz.`,
  )

/** Sayım başlatma (K-232): bütün kurum, bir kampüs ya da bir oda/konum. */
export const fixedAssetCountSchema = z.discriminatedUnion(
  'scopeType',
  [
    z.strictObject({
      scopeType: z.literal('institution'),
      note: noteSchema.describe('İsteğe bağlı açıklama (ör. 2026 yıl sonu sayımı)'),
    }),
    z.strictObject({
      scopeType: z.literal('campus'),
      campusId: campusSchema.describe('Sayılan kampüs (branches kaydı)'),
      note: noteSchema.describe('İsteğe bağlı açıklama'),
    }),
    z.strictObject({
      scopeType: z.literal('location'),
      campusId: campusSchema
        .nullable()
        .default(null)
        .describe('Odanın kampüsü; tek kampüslü kurumda boş'),
      location: locationSchema.describe('Sayılan oda ya da yer'),
      note: noteSchema.describe('İsteğe bağlı açıklama'),
    }),
  ],
  'Sayım kapsamını seçin.',
)
export type FixedAssetCountInput = z.input<typeof fixedAssetCountSchema>
export type FixedAssetCountFields = z.output<typeof fixedAssetCountSchema>

/**
 * Okutma (K-233). Kod etiket numarasıdır. Kurum ya da kampüs sayımında sayılan yer (konum, kurum
 * sayımında isteğe bağlı kampüs) her okutmada gelir; oda sayımında yer sayımın kendisidir.
 */
export const fixedAssetCountScanSchema = z.strictObject({
  code: z
    .string('Demirbaş kodunu okutun ya da yazın.')
    .transform(normalizeFixedAssetCountCode)
    .pipe(
      z
        .string()
        .min(1, 'Demirbaş kodunu okutun ya da yazın.')
        .max(FIXED_ASSET_COUNT_CODE_MAX, 'Kod çok uzun; etiketi yeniden okutun.'),
    )
    .describe('Etiket numarası (karekod içeriği)'),
  campusId: campusSchema
    .nullable()
    .default(null)
    .describe('Kurum sayımında sayılan kampüs; kampüs ve oda sayımında yok sayılır'),
  location: locationSchema
    .nullable()
    .default(null)
    .describe(
      'Kurum ve kampüs sayımında sayılan oda ya da yer (zorunlu); oda sayımında yok sayılır',
    ),
})
export type FixedAssetCountScanInput = z.input<typeof fixedAssetCountScanSchema>
export type FixedAssetCountScanFields = z.output<typeof fixedAssetCountScanSchema>

// --- Kapsam --------------------------------------------------------------------------------------

export interface FixedAssetCountScope {
  scopeType: FixedAssetCountScopeType
  /** Kampüs sayımında zorunlu, oda sayımında isteğe bağlı, kurum sayımında boş. */
  campusId: string | null
  /** Yalnız oda sayımında dolu. */
  location: string | null
}

export const fixedAssetCountScopeOf = (input: FixedAssetCountFields): FixedAssetCountScope =>
  input.scopeType === 'institution'
    ? { scopeType: 'institution', campusId: null, location: null }
    : input.scopeType === 'campus'
      ? { scopeType: 'campus', campusId: input.campusId, location: null }
      : { scopeType: 'location', campusId: input.campusId, location: input.location }

/**
 * Kapsamın anahtarı: aynı kapsamda tek açık sayım bu anahtarla güvencededir (K-234). Oda konumu
 * harf ve boşluk farkı gözetmeden yazılır; "Fen Lab" ile "fen  lab" aynı kapsamdır.
 */
export function fixedAssetCountScopeKey(scope: FixedAssetCountScope): string {
  if (scope.scopeType === 'institution') return 'institution'
  if (scope.scopeType === 'campus') return `campus:${scope.campusId ?? ''}`
  return `location:${scope.campusId ?? '-'}:${foldFixedAssetLocation(scope.location ?? '')}`
}

/** Sayılabilir demirbaş: kapsam süzgecinin ve okutmanın gördüğü alanlar. */
export interface CountableFixedAsset {
  id: string
  tagNumber: string
  name: string
  campusId: string | null
  location: string
  status: FixedAssetStatus
}

/** Demirbaş kapsamda mı: hurdaya ayrılmamış ve kampüsü/konumu kapsamla uyuşuyor (K-232). */
export function fixedAssetCountScopeIncludes(
  scope: FixedAssetCountScope,
  asset: Pick<CountableFixedAsset, 'campusId' | 'location' | 'status'>,
): boolean {
  if (asset.status === 'scrapped') return false
  if (scope.scopeType === 'institution') return true
  if (scope.scopeType === 'campus') return asset.campusId === scope.campusId
  return sameFixedAssetPlace(asset, { campusId: scope.campusId, location: scope.location ?? '' })
}

/** Kapsamın tek satırlık adı: "Bütün kurum", kampüs adı ya da "kampüs · oda". */
export function fixedAssetCountScopeLabel(
  scope: FixedAssetCountScope & { campusName: string | null },
): string {
  if (scope.scopeType === 'institution') return FIXED_ASSET_COUNT_SCOPE_TYPE_LABELS.institution
  const campus = scope.campusName ?? (scope.campusId === null ? null : 'Kampüs')
  if (scope.scopeType === 'campus') return campus ?? 'Kampüs'
  const location = scope.location ?? ''
  return campus ? `${campus} · ${location}` : location
}

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path?: string) =>
  new DomainError(code, message, { kind: 'rule', ...(path ? { path: [path] } : {}) })

export interface FixedAssetCountStartChecks {
  /** Kampüs ya da oda sayımında seçilen kampüs kurumda etkin mi (kampüs boşsa denetlenmez). */
  campusFound?: boolean
  /** Aynı kapsam anahtarıyla açık sayım var mı. */
  openSameScope: boolean
  /** Kapsam adayı demirbaşlar (servis kampüse göre daraltabilir; süzgeç burada uygulanır). */
  assets: readonly CountableFixedAsset[]
}

export interface FixedAssetCountStartPlan {
  scope: FixedAssetCountScope
  scopeKey: string
  note: string | null
  /** Beklenen liste: kapsamdaki hurdaya ayrılmamış demirbaşlar, etiket sırasıyla (K-232). */
  items: CountableFixedAsset[]
}

/**
 * Sayım başlatma (K-232, K-234). Kampüs kurumda yoksa 422; aynı kapsamda açık sayım varsa 409;
 * kapsamda sayılacak demirbaş yoksa ya da sınır aşılırsa 422. Beklenen liste başlangıçta dondurulur;
 * sonradan kaydedilen ya da taşınan demirbaş listeye girmez, okutulursa "listede yoktu" işaretlenir.
 */
export function planFixedAssetCountStart(
  input: FixedAssetCountFields,
  checks: FixedAssetCountStartChecks,
): FixedAssetCountStartPlan {
  const scope = fixedAssetCountScopeOf(input)
  if (scope.campusId !== null && checks.campusFound === false)
    throw ruleError('fixed_asset_campus_not_found', 'Kampüs bulunamadı.', 'campusId')
  if (checks.openSameScope)
    throw new DomainError(
      'fixed_asset_count_open_exists',
      'Bu kapsamda süren bir sayım var. Önce onu tamamlayın ya da iptal edin.',
      { kind: 'conflict', path: ['scopeType'] },
    )
  const items = checks.assets
    .filter((asset) => fixedAssetCountScopeIncludes(scope, asset))
    .sort((a, b) => (a.tagNumber < b.tagNumber ? -1 : a.tagNumber > b.tagNumber ? 1 : 0))
  if (items.length === 0)
    throw ruleError(
      'fixed_asset_count_empty',
      'Bu kapsamda sayılacak demirbaş yok (hurdaya ayrılanlar sayılmaz).',
      'scopeType',
    )
  if (items.length > FIXED_ASSET_COUNT_MAX_ITEMS)
    throw ruleError(
      'fixed_asset_count_too_large',
      `Bu kapsamda ${String(FIXED_ASSET_COUNT_MAX_ITEMS)} demirbaştan fazlası var; sayımı kampüs ya da odaya bölün.`,
      'scopeType',
    )
  return { scope, scopeKey: fixedAssetCountScopeKey(scope), note: input.note, items }
}

/** Sayım satırının okutmada gereken hali. */
export interface FixedAssetCountItemState {
  result: FixedAssetCountItemResult
  inScope: boolean
  recordedCampusId: string | null
  recordedLocation: string
}

export interface FixedAssetCountScanChecks {
  count: FixedAssetCountScope & { status: FixedAssetCountStatus }
  /** Kodun kurumdaki demirbaşı; yoksa (başka kurumun demirbaşı dahil) `null`. */
  asset: CountableFixedAsset | null
  /** Demirbaşın bu sayımdaki satırı; beklenen listede değilse ve okunmadıysa `null`. */
  item: FixedAssetCountItemState | null
  /** Kurum sayımında gönderilen kampüs kurumda etkin mi (kampüs boşsa denetlenmez). */
  campusFound?: boolean
}

export type FixedAssetCountScanPlan =
  | { outcome: 'already_counted' }
  | {
      outcome: 'found' | 'misplaced'
      inScope: boolean
      observed: FixedAssetPlace
      recorded: FixedAssetPlace
    }

/** Sayılan yer: oda sayımında sayımın kendisi, kampüs sayımında kampüs + gelen konum. */
export function fixedAssetCountObservedPlace(
  count: FixedAssetCountScope,
  input: Pick<FixedAssetCountScanFields, 'campusId' | 'location'>,
): FixedAssetPlace | null {
  if (count.scopeType === 'location')
    return { campusId: count.campusId, location: count.location ?? '' }
  if (input.location === null) return null
  return {
    campusId: count.scopeType === 'campus' ? count.campusId : input.campusId,
    location: input.location,
  }
}

/**
 * Okutma (K-233). Sayım açık olmalıdır; kurum ve kampüs sayımında sayılan konum zorunludur. Kodun
 * kurumda demirbaşı yoksa (başka kurumun demirbaşı da aynı yanıtı alır) ve demirbaş hurdaya
 * ayrılmışsa reddedilir, hiçbir şey yazılmaz. Daha önce okunan demirbaş yeniden işaretlenmez
 * (`already_counted`, ilk okutmanın yeri korunur). Sayılan yer kayıtlı yerle aynıysa `found`,
 * değilse `misplaced`; beklenen listede olmayan demirbaş `inScope: false` ile eklenir.
 */
export function planFixedAssetCountScan(
  input: FixedAssetCountScanFields,
  checks: FixedAssetCountScanChecks,
): FixedAssetCountScanPlan {
  if (checks.count.status !== 'open')
    throw ruleError('fixed_asset_count_closed', 'Sayım kapandı; okutma yapılamaz.')
  const observed = fixedAssetCountObservedPlace(checks.count, input)
  if (observed === null)
    throw ruleError(
      'fixed_asset_count_location_required',
      'Sayım yaptığınız odayı ya da yeri yazın.',
      'location',
    )
  if (checks.count.scopeType === 'institution' && input.campusId !== null && !checks.campusFound)
    throw ruleError('fixed_asset_campus_not_found', 'Kampüs bulunamadı.', 'campusId')
  const asset = checks.asset
  if (asset === null)
    throw ruleError(
      'fixed_asset_count_code_unknown',
      'Bu kod kurumun demirbaşlarında yok. Etiketi kontrol edin.',
      'code',
    )
  if (asset.status === 'scrapped')
    throw ruleError(
      'fixed_asset_count_asset_scrapped',
      `${asset.tagNumber} hurdaya ayrılmış; sayıma eklenmez.`,
      'code',
    )
  const item = checks.item
  if (item !== null && item.result !== 'pending') return { outcome: 'already_counted' }
  const recorded: FixedAssetPlace =
    item === null
      ? { campusId: asset.campusId, location: asset.location }
      : { campusId: item.recordedCampusId, location: item.recordedLocation }
  return {
    outcome: sameFixedAssetPlace(observed, recorded) ? 'found' : 'misplaced',
    inScope: item?.inScope ?? false,
    observed,
    recorded,
  }
}

/** Tamamlama ve iptal (K-234): yalnız açık sayım kapanır; kapanan sayım yeniden açılmaz. */
export function planFixedAssetCountClose(count: { status: FixedAssetCountStatus }): void {
  if (count.status !== 'open')
    throw ruleError(
      'fixed_asset_count_closed',
      count.status === 'completed' ? 'Sayım zaten tamamlandı.' : 'Sayım iptal edildi.',
    )
}

export interface FixedAssetCountRelocateChecks {
  count: { status: FixedAssetCountStatus }
  item: {
    result: FixedAssetCountItemResult
    relocatedAt: string | null
    observedCampusId: string | null
    observedLocation: string | null
  }
  asset: { status: FixedAssetStatus }
  /** Sayılan kampüs bugün kurumda etkin mi (kampüs boşsa denetlenmez). */
  campusFound?: boolean
}

/**
 * Konum düzeltmesi (K-235): yalnız tamamlanmış sayımda, yanlış konumda bulunan ve henüz
 * düzeltilmemiş demirbaşın kampüsü ve konumu sayıldığı yere yazılır. Hurdaya ayrılmış demirbaş
 * düzeltilmez. Demirbaşın durumu ve zimmeti değişmez.
 */
export function planFixedAssetCountRelocate(
  checks: FixedAssetCountRelocateChecks,
): FixedAssetPlace {
  if (checks.count.status !== 'completed')
    throw ruleError(
      'fixed_asset_count_not_completed',
      'Konum düzeltmesi sayım tamamlandıktan sonra yapılır.',
    )
  const { item } = checks
  if (item.result !== 'misplaced' || item.observedLocation === null)
    throw ruleError(
      'fixed_asset_count_item_not_misplaced',
      'Yalnız yanlış konumda bulunan demirbaşın konumu düzeltilir.',
    )
  if (item.relocatedAt !== null)
    throw ruleError('fixed_asset_count_item_relocated', 'Bu demirbaşın konumu zaten düzeltildi.')
  if (checks.asset.status === 'scrapped')
    throw ruleError('fixed_asset_scrapped', 'Hurdaya ayrılmış demirbaş düzeltilemez.')
  if (item.observedCampusId !== null && checks.campusFound === false)
    throw ruleError('fixed_asset_campus_not_found', 'Sayılan kampüs artık kurumda yok.')
  return { campusId: item.observedCampusId, location: item.observedLocation }
}

/** Satırın rapordaki sonucu: tamamlanmış sayımda okunmayan beklenen demirbaş bulunamadı sayılır. */
export function fixedAssetCountOutcome(
  result: FixedAssetCountItemResult,
  status: FixedAssetCountStatus,
): FixedAssetCountOutcome {
  if (result !== 'pending') return result
  return status === 'completed' ? 'missing' : 'pending'
}

// --- Rapor ---------------------------------------------------------------------------------------

/** Rapor satırı (API `items` yanıtı): kayıtlı ve sayılan yer kampüs adlarıyla. */
export interface FixedAssetCountReportItem {
  tagNumber: string
  assetName: string
  result: FixedAssetCountItemResult
  inScope: boolean
  recordedCampusName: string | null
  recordedLocation: string
  observedCampusName: string | null
  observedLocation: string | null
  scannedAt: string | null
  relocatedAt: string | null
}

const placeText = (campusName: string | null, location: string | null) =>
  location === null ? '' : campusName ? `${campusName} · ${location}` : location

/** Okutma zamanı Europe/Istanbul günü ve saatiyle (`2026-10-06 14:05`). */
export const fixedAssetCountScanTime = (iso: string | null) =>
  iso === null ? '' : `${dayKey(iso)} ${timeLabel(iso)}`

/**
 * Sayım sonucu CSV'si (`;`, formül kaçışlı). Kişi verisi yoktur: demirbaş, sonuç, kayıtlı ve
 * sayılan yer, okutma zamanı, listede olup olmadığı ve konumun düzeltilip düzeltilmediği.
 */
export function fixedAssetCountCsv(
  status: FixedAssetCountStatus,
  items: readonly FixedAssetCountReportItem[],
): string {
  const header = [
    'Etiket',
    'Demirbaş',
    'Sonuç',
    'Kayıtlı yer',
    'Sayılan yer',
    'Beklenen listede',
    'Okutma zamanı',
    'Konum düzeltildi',
  ]
  const lines = [header.map(csvCell).join(';')]
  for (const item of items)
    lines.push(
      [
        item.tagNumber,
        item.assetName,
        FIXED_ASSET_COUNT_OUTCOME_LABELS[fixedAssetCountOutcome(item.result, status)],
        placeText(item.recordedCampusName, item.recordedLocation),
        placeText(item.observedCampusName, item.observedLocation),
        item.inScope ? 'Evet' : 'Hayır',
        fixedAssetCountScanTime(item.scannedAt),
        item.relocatedAt === null ? '' : 'Evet',
      ]
        .map(csvCell)
        .join(';'),
    )
  return `${lines.join('\r\n')}\r\n`
}
