import { z } from 'zod'

import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'

/**
 * Demirbaş kaydı (docs/domain/finans.md DOM-FIN-085; ON-235). Kurumun kalıcı kullanımdaki her varlığı
 * tek kayıttır: kurum içinde tekil etiket numarası (boş bırakılırsa `DB-<yıl>-<sıra>` verilir, elle
 * de girilir; K-185), ad, sabit kategori, kampüs ve serbest metin konum, KDV hariç alım değeri
 * (kuruş), alım günü, isteğe bağlı tedarikçi (DOM-FIN-070) ve mal kabul kalemi (DOM-FIN-074) bağı,
 * durum. Kayıt silinmez; hurdaya ayırma gerekçe ve gün ister, geri alınmaz (K-188). Zimmet (ON-236),
 * sayım (ON-237) ve amortisman (ON-238) bu kuralın dışındadır. Fonksiyonlar saftır; bugün `today`
 * (Europe/Istanbul günü) parametresiyle gelir.
 */

/** Demirbaşı okuyan ve yazan rol (K-189); muhasebe rolü açılınca listeye girer. */
export const FIXED_ASSET_ROLES = ['yonetici'] as const

/** Sabit kategori kümesi (K-186). */
export const FIXED_ASSET_CATEGORIES = [
  'furniture',
  'it',
  'audiovisual',
  'office',
  'laboratory',
  'sports',
  'kitchen',
  'appliance',
  'vehicle',
  'other',
] as const
export type FixedAssetCategory = (typeof FIXED_ASSET_CATEGORIES)[number]
export const FIXED_ASSET_CATEGORY_LABELS = {
  furniture: 'Mobilya',
  it: 'Bilgisayar ve bilişim',
  audiovisual: 'Görsel-işitsel cihaz',
  office: 'Büro makinesi',
  laboratory: 'Laboratuvar ve eğitim donanımı',
  sports: 'Spor malzemesi',
  kitchen: 'Mutfak ve yemekhane',
  appliance: 'Klima ve elektrikli cihaz',
  vehicle: 'Taşıt',
  other: 'Diğer',
} as const satisfies Record<FixedAssetCategory, string>

export const FIXED_ASSET_STATUSES = ['in_use', 'in_storage', 'broken', 'scrapped'] as const
export type FixedAssetStatus = (typeof FIXED_ASSET_STATUSES)[number]
/** Elle seçilen durumlar; hurdaya ayırma ayrı komuttur ve gerekçe ister. */
export const FIXED_ASSET_OPEN_STATUSES = ['in_use', 'in_storage', 'broken'] as const
export type FixedAssetOpenStatus = (typeof FIXED_ASSET_OPEN_STATUSES)[number]
export const FIXED_ASSET_STATUS_LABELS = {
  in_use: 'Kullanımda',
  in_storage: 'Depoda',
  broken: 'Arızalı',
  scrapped: 'Hurdaya ayrıldı',
} as const satisfies Record<FixedAssetStatus, string>

export const FIXED_ASSET_TAG_MAX = 40
export const FIXED_ASSET_NAME_MAX = 200
export const FIXED_ASSET_LOCATION_MAX = 120
export const FIXED_ASSET_SCRAP_REASON_MIN = 5
export const FIXED_ASSET_SCRAP_REASON_MAX = 500
/** Tek demirbaşın alım değeri üst sınırı: 100 milyon TL (kuruş). */
export const FIXED_ASSET_VALUE_MAX_CENTS = 10_000_000_000
/** Etiket: büyük harf, rakam, nokta, tire ve eğik çizgi; harf ya da rakamla başlar (K-185). */
export const FIXED_ASSET_TAG_PATTERN = /^[A-Z0-9][A-Z0-9./-]{1,39}$/
const SUGGESTED_TAG = /^DB-(\d{4})-(\d+)$/

/** Önerilen etiket biçimi: `DB-2026-0001` (dört haneye kadar sıfırla doldurulur). */
export function fixedAssetTagNumber(year: number, sequence: number): string {
  return `DB-${String(year)}-${String(sequence).padStart(4, '0')}`
}

/**
 * Yılın sıradaki önerilen etiketi: o yılın `DB-<yıl>-<sıra>` biçimindeki etiketlerinin (elle
 * girilenler dahil) en büyük sırasının bir fazlası. Biçime uymayan etiket sırayı etkilemez.
 */
export function nextFixedAssetTag(year: number, tags: readonly string[]): string {
  let last = 0
  for (const tag of tags) {
    const match = SUGGESTED_TAG.exec(tag)
    if (match && Number(match[1]) === year) last = Math.max(last, Number(match[2]))
  }
  return fixedAssetTagNumber(year, last + 1)
}

/** Etiket büyük harfe çevrilir ve boşlukları atılır; aramada ve tekillikte aynı biçim kullanılır. */
export const normalizeFixedAssetTag = (value: string) => value.replace(/\s/g, '').toUpperCase()

// --- Şemalar -------------------------------------------------------------------------------------

const tagSchema = z
  .string('Etiket numarasını yazın.')
  .transform(normalizeFixedAssetTag)
  .pipe(
    z
      .string()
      .min(2, 'Etiket numarası en az 2 karakter olmalıdır.')
      .max(FIXED_ASSET_TAG_MAX, `En fazla ${String(FIXED_ASSET_TAG_MAX)} karakter girebilirsiniz.`)
      .regex(
        FIXED_ASSET_TAG_PATTERN,
        'Etikette yalnız harf (Türkçe karakter olmadan), rakam, nokta, tire ve eğik çizgi kullanın.',
      ),
  )
const nameSchema = z
  .string('Demirbaşın adını yazın.')
  .trim()
  .min(2, 'En az 2 karakter girin.')
  .max(FIXED_ASSET_NAME_MAX, `En fazla ${String(FIXED_ASSET_NAME_MAX)} karakter girebilirsiniz.`)
const categorySchema = z.enum(FIXED_ASSET_CATEGORIES, 'Kategori seçin.')
const campusSchema = z.string().trim().min(1, 'Kampüs seçin.').max(100).nullable()
const locationSchema = z
  .string('Konumu yazın.')
  .trim()
  .min(2, 'Konumu en az 2 karakterle yazın (ör. 2. kat fen laboratuvarı).')
  .max(
    FIXED_ASSET_LOCATION_MAX,
    `En fazla ${String(FIXED_ASSET_LOCATION_MAX)} karakter girebilirsiniz.`,
  )
const valueSchema = z
  .number('Alım değerini girin.')
  .int('Alım değeri kuruş cinsinden tam sayı olmalıdır.')
  .min(1, 'Alım değeri sıfırdan büyük olmalıdır.')
  .max(FIXED_ASSET_VALUE_MAX_CENTS, 'Alım değeri çok büyük.')
const supplierSchema = z.uuid('Tedarikçi geçersiz.').nullable()
const receiptItemSchema = z.uuid('Mal kabul kalemi geçersiz.').nullable()
const openStatusSchema = z.enum(
  FIXED_ASSET_OPEN_STATUSES,
  'Durum kullanımda, depoda ya da arızalı olmalıdır; hurdaya ayırma ayrı işlemdir.',
)

/** Yeni demirbaş (DOM-FIN-085). Etiket boşsa sunucu `DB-<yıl>-<sıra>` verir (K-185). */
export const fixedAssetSchema = z.strictObject({
  tagNumber: tagSchema
    .nullable()
    .default(null)
    .describe('Kurumda tekil etiket; boşsa `DB-<yıl>-<sıra>` verilir'),
  name: nameSchema,
  category: categorySchema,
  campusId: campusSchema
    .default(null)
    .describe('Kampüs (branches kaydı); tek kampüslü kurumda boş'),
  location: locationSchema.describe('Oda ya da yer, serbest metin'),
  acquisitionValueCents: valueSchema.describe('KDV hariç alım değeri, kuruş (M-30)'),
  acquisitionDate: daySchema.describe('Alım günü; bugünden sonra olamaz'),
  supplierId: supplierSchema.default(null),
  receiptItemId: receiptItemSchema.default(null).describe('Mal kabul kalemi (DOM-FIN-074)'),
  status: openStatusSchema.default('in_use'),
})
export type FixedAssetInput = z.input<typeof fixedAssetSchema>
export type FixedAssetFields = z.output<typeof fixedAssetSchema>

/** Kısmi düzeltme; hurdaya ayrılmış demirbaş düzeltilmez. */
export const updateFixedAssetSchema = z
  .strictObject({
    tagNumber: tagSchema.optional(),
    name: nameSchema.optional(),
    category: categorySchema.optional(),
    campusId: campusSchema.optional(),
    location: locationSchema.optional(),
    acquisitionValueCents: valueSchema.optional(),
    acquisitionDate: daySchema.optional(),
    supplierId: supplierSchema.optional(),
    receiptItemId: receiptItemSchema.optional(),
    status: openStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Değiştirilecek bir alan girin.')
export type UpdateFixedAssetInput = z.input<typeof updateFixedAssetSchema>
export type FixedAssetChanges = z.output<typeof updateFixedAssetSchema>

/** Hurdaya ayırma: gerekçe ve gün (K-188). */
export const scrapFixedAssetSchema = z.strictObject({
  reason: z
    .string('Hurdaya ayırma gerekçesini yazın.')
    .trim()
    .min(FIXED_ASSET_SCRAP_REASON_MIN, 'Gerekçeyi en az 5 karakterle yazın.')
    .max(
      FIXED_ASSET_SCRAP_REASON_MAX,
      `En fazla ${String(FIXED_ASSET_SCRAP_REASON_MAX)} karakter girebilirsiniz.`,
    ),
  scrapDate: daySchema.describe('Hurdaya ayırma günü; alım gününden önce, bugünden sonra olamaz'),
})
export type ScrapFixedAssetInput = z.input<typeof scrapFixedAssetSchema>

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path: string) =>
  new DomainError(code, message, { kind: 'rule', path: [path] })

/** Bağlanmak istenen mal kabul kaleminin durumu (servis kurum kilidi altında yükler). */
export interface FixedAssetReceiptRef {
  receiptItemId: string
  receiptDate: string
  cancelled: boolean
  acceptedQuantity: number
  /** Bu kaleme bağlı öteki demirbaşlar (hurdaya ayrılanlar dahil, bu kayıt hariç). */
  linkedAssetCount: number
  /** Siparişin tedarikçisi. */
  supplierId: string
}

/** Kaydın son hali (yeni kayıt ya da düzeltmeyle birleşmiş). */
export type FixedAssetDraft = Omit<FixedAssetFields, 'tagNumber' | 'status'> & {
  tagNumber: string
  status: FixedAssetStatus
}

/**
 * Denetim girdileri. `undefined` alan denetlenmez (düzeltmede değişmeyen bağ yeniden sınanmaz):
 * arşivlenen kampüs ya da iptal edilen kabul, ilgisiz bir alanın düzeltilmesini engellemez.
 */
export interface FixedAssetChecks {
  today: string
  tagTaken: boolean
  /** Düzeltmede kaydın şimdiki durumu; hurdaya ayrılmışsa gövdedeki durum bunu değiştiremez. */
  currentStatus?: FixedAssetStatus
  campusFound?: boolean
  supplierFound?: boolean
  /** `null`: kalem kurumda yok. `link`: kalem yeni bağlanıyor (iptal ve miktar denetlenir). */
  receipt?: { ref: FixedAssetReceiptRef | null; link: boolean }
}

/**
 * Yeni kaydın ya da düzeltmenin kuralları (DOM-FIN-085). Mal kabul bağı varken tedarikçi boşsa
 * siparişin tedarikçisi yazılır; doluysa siparişinkiyle aynı olmalıdır. Kaleme bağlanan demirbaş
 * sayısı kabul edilen miktarı aşamaz: her demirbaş bir adettir (K-187).
 */
export function planFixedAsset(draft: FixedAssetDraft, checks: FixedAssetChecks): FixedAssetDraft {
  if (draft.status === 'scrapped' || checks.currentStatus === 'scrapped')
    throw ruleError('fixed_asset_scrapped', 'Hurdaya ayrılmış demirbaş düzeltilemez.', 'status')
  if (checks.tagTaken)
    throw new DomainError('fixed_asset_tag_exists', 'Bu etiket numarasıyla bir demirbaş var.', {
      kind: 'conflict',
      path: ['tagNumber'],
    })
  if (draft.acquisitionDate > checks.today)
    throw ruleError(
      'fixed_asset_date_in_future',
      'Alım günü bugünden sonra olamaz.',
      'acquisitionDate',
    )
  if (checks.campusFound === false)
    throw ruleError('fixed_asset_campus_not_found', 'Kampüs bulunamadı.', 'campusId')
  if (checks.supplierFound === false)
    throw ruleError('fixed_asset_supplier_not_found', 'Tedarikçi bulunamadı.', 'supplierId')
  if (checks.receipt === undefined || draft.receiptItemId === null) return draft
  const { ref, link } = checks.receipt
  if (ref === null)
    throw ruleError(
      'fixed_asset_receipt_item_not_found',
      'Mal kabul kalemi bulunamadı.',
      'receiptItemId',
    )
  if (link && ref.cancelled)
    throw ruleError(
      'fixed_asset_receipt_cancelled',
      'İptal edilmiş mal kabule demirbaş bağlanamaz.',
      'receiptItemId',
    )
  if (link && ref.linkedAssetCount >= ref.acceptedQuantity)
    throw ruleError(
      'fixed_asset_receipt_quantity_exceeded',
      `Bu kabul kaleminde ${String(ref.acceptedQuantity)} adet kabul edildi; hepsine demirbaş bağlı.`,
      'receiptItemId',
    )
  if (draft.supplierId !== null && draft.supplierId !== ref.supplierId)
    throw ruleError(
      'fixed_asset_supplier_mismatch',
      'Tedarikçi, mal kabulün siparişindeki tedarikçiyle aynı olmalıdır.',
      'supplierId',
    )
  if (draft.acquisitionDate < ref.receiptDate)
    throw ruleError(
      'fixed_asset_date_before_receipt',
      'Mal kabule bağlı demirbaşın alım günü kabul gününden önce olamaz.',
      'acquisitionDate',
    )
  return { ...draft, supplierId: ref.supplierId }
}

/** Hurdaya ayırma (K-188): geri alınmaz; gün alım gününden önce ve bugünden sonra olamaz. */
export function planFixedAssetScrap(
  asset: { status: FixedAssetStatus; acquisitionDate: string },
  input: { scrapDate: string },
  today: string,
): void {
  if (asset.status === 'scrapped')
    throw ruleError('fixed_asset_scrapped', 'Demirbaş zaten hurdaya ayrılmış.', 'status')
  if (input.scrapDate > today)
    throw ruleError(
      'fixed_asset_date_in_future',
      'Hurdaya ayırma günü bugünden sonra olamaz.',
      'scrapDate',
    )
  if (input.scrapDate < asset.acquisitionDate)
    throw ruleError(
      'fixed_asset_scrap_before_acquisition',
      'Hurdaya ayırma günü alım gününden önce olamaz.',
      'scrapDate',
    )
}
