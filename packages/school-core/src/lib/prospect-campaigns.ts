import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import type { ProspectSource } from './prospects.ts'

/**
 * Kampanya kodu ve kaynak izleme (docs/domain/kayit-ve-crm.md DOM-KAY-041; IST-117, ON-134).
 * Kurum, tanıtım çalışmasına (sosyal medya ilanı, el ilanı, fuar…) bir kod verir; aday açılırken kod
 * girilirse aday o kampanyaya bağlanır ve kayıt hunisi kampanya başına kırılır. Fonksiyonlar saftır:
 * kampanya satırlarını servis yükler, tarih `today` (Europe/Istanbul günü) ile dışarıdan gelir.
 *
 * - Kod kurumda tekildir (arşivliler dahil), büyük harfle saklanır; A–Z, 0–9 ve tire, 3–20 karakter
 *   (K-288). Kod sonradan değişmez; ad, kanal, tarihler, maliyet ve etkinlik düzeltilir.
 * - Aday yalnız etkin, arşivlenmemiş ve bugünü tarih aralığında olan kampanyaya bağlanır; bağ aday
 *   açılırken kurulur ve kaynak gibi değişmez (DOM-KAY-007). Kaynak kanaldan önerilir, zorlanmaz
 *   (K-289).
 * - Huni kırılımı `enrollment-campaign-funnel.ts`'tedir (K-290, K-291). Bu dosya aday işlemlerinin
 *   (`prospects.ts`) içe aktardığı tanımları taşır; huniyi içe aktarmaz (döngü olmasın).
 */

/** Kampanya kodlarını yöneten ve kırılımı okuyan roller (kayıt/ön büro ve yönetici; K-291). */
export const CAMPAIGN_ROLES = ['yonetici', 'onburo'] as const satisfies readonly Role[]

export const CAMPAIGN_CHANNELS = [
  'social_media',
  'flyer',
  'fair',
  'referral',
  'website',
  'other',
] as const
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number]
export const CAMPAIGN_CHANNEL_LABELS = {
  social_media: 'Sosyal medya',
  flyer: 'El ilanı',
  fair: 'Fuar',
  referral: 'Referans',
  website: 'Web sitesi',
  other: 'Diğer',
} as const satisfies Record<CampaignChannel, string>

/**
 * Kanalın önerdiği aday kaynağı (DOM-KAY-007; K-289). El ilanı, fuar ve diğer kanalların kaynak
 * listesinde karşılığı yoktur; kaynağı ön büro seçer.
 */
const CHANNEL_SOURCES = {
  social_media: 'Sosyal medya',
  flyer: null,
  fair: null,
  referral: 'Veli referansı',
  website: 'Web sitesi',
  other: null,
} as const satisfies Record<CampaignChannel, ProspectSource | null>

export function campaignSourceSuggestion(channel: CampaignChannel): ProspectSource | null {
  return CHANNEL_SOURCES[channel]
}

export const CAMPAIGN_CODE_MIN = 3
export const CAMPAIGN_CODE_MAX = 20
export const CAMPAIGN_NAME_MAX = 120
/** Maliyet üst sınırı: 100 milyon TL (kuruş); yazım hatasını yakalar. */
export const CAMPAIGN_COST_MAX_CENTS = 10_000_000_000
/** SQL `check` ile aynı desen: büyük harf, rakam, tire; tire ile başlamaz. */
export const CAMPAIGN_CODE_PATTERN = '^[A-Z0-9][A-Z0-9-]{2,19}$'
const CODE = new RegExp(CAMPAIGN_CODE_PATTERN)

/**
 * Kodu saklanan biçime getirir: kenar boşluğu atılır, büyük harfe çevrilir (dil bağımsız; `i` → `I`).
 * Türkçe harf desene uymaz ve reddedilir; kod adres çubuğunda (`?kampanya=`) bozulmadan taşınır.
 */
export const normalizeCampaignCode = (value: string) => value.trim().toUpperCase()

export const campaignCodeSchema = z
  .string('Kampanya kodunu yazın.')
  .transform(normalizeCampaignCode)
  .pipe(
    z
      .string()
      .min(CAMPAIGN_CODE_MIN, `Kod en az ${CAMPAIGN_CODE_MIN} karakter olmalıdır.`)
      .max(CAMPAIGN_CODE_MAX, `Kod en fazla ${CAMPAIGN_CODE_MAX} karakter olabilir.`)
      .regex(CODE, 'Kodda yalnız İngilizce büyük harf, rakam ve tire kullanın; tire ile başlamaz.'),
  )

const nameSchema = z
  .string('Kampanya adını yazın.')
  .trim()
  .min(2, 'Kampanya adı en az 2 karakter olmalıdır.')
  .max(CAMPAIGN_NAME_MAX, `En fazla ${CAMPAIGN_NAME_MAX} karakter girebilirsiniz.`)
const costSchema = z
  .number('Maliyeti kuruş olarak girin.')
  .int('Maliyet kuruş cinsinden tam sayı olmalıdır.')
  .min(0, 'Maliyet eksi olamaz.')
  .max(CAMPAIGN_COST_MAX_CENTS, 'Maliyet çok büyük; tutarı kontrol edin.')
  .nullable()

const datesOrdered = (data: { startDate?: string | undefined; endDate?: string | undefined }) =>
  data.startDate === undefined || data.endDate === undefined || data.startDate <= data.endDate
const DATES_MESSAGE = 'Bitiş günü başlangıç gününden önce olamaz.'

/** Yeni kampanya kodu. Maliyet isteğe bağlıdır (kuruş, KDV dahil toplam harcama). */
export const createCampaignSchema = z
  .strictObject({
    code: campaignCodeSchema,
    name: nameSchema,
    channel: z.enum(CAMPAIGN_CHANNELS, 'Kanalı seçin.'),
    startDate: daySchema,
    endDate: daySchema,
    costCents: costSchema.optional(),
    isActive: z.boolean().default(true),
  })
  .refine(datesOrdered, { message: DATES_MESSAGE, path: ['endDate'] })
export type CreateCampaignInput = z.input<typeof createCampaignSchema>

/** Düzeltme: kod değişmez (gövdede `code` 400). `costCents: null` maliyeti siler. */
export const updateCampaignSchema = z
  .strictObject({
    name: nameSchema.optional(),
    channel: z.enum(CAMPAIGN_CHANNELS, 'Kanalı seçin.').optional(),
    startDate: daySchema.optional(),
    endDate: daySchema.optional(),
    costCents: costSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Düzeltilecek en az bir bilgi gönderin.',
  })
  .refine(datesOrdered, { message: DATES_MESSAGE, path: ['endDate'] })
export type UpdateCampaignInput = z.input<typeof updateCampaignSchema>

/** Düzeltmede gövdedeki ve kayıttaki tarihlerin birleşimi sıralı olmalıdır (422). */
export function assertCampaignDates(startDate: string, endDate: string): void {
  if (startDate > endDate)
    throw new DomainError('campaign_dates_invalid', DATES_MESSAGE, { path: ['endDate'] })
}

/** Kodu başka kampanya (arşivli dahil) kullanıyorsa 409 (K-288). */
export function assertCampaignCodeFree(taken: boolean): void {
  if (taken)
    throw new DomainError('campaign_code_exists', 'Bu kampanya kodu kurumda kullanılıyor.', {
      kind: 'conflict',
      path: ['code'],
    })
}

/** Adayın bağlandığı kampanyanın işlemde okunan alanları. */
export type CampaignRef = {
  id: string
  code: string
  isActive: boolean
  startDate: string
  endDate: string
}

export const CAMPAIGN_STATUSES = ['usable', 'inactive', 'not_started', 'ended'] as const
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number]
export const CAMPAIGN_STATUS_LABELS = {
  usable: 'Geçerli',
  inactive: 'Pasif',
  not_started: 'Başlamadı',
  ended: 'Sona erdi',
} as const satisfies Record<CampaignStatus, string>

/** Kampanyanın bugünkü durumu; `today` Europe/Istanbul günüdür, iki uç dahil. */
export function campaignStatus(
  campaign: Pick<CampaignRef, 'isActive' | 'startDate' | 'endDate'>,
  today: string,
): CampaignStatus {
  if (!campaign.isActive) return 'inactive'
  if (today < campaign.startDate) return 'not_started'
  if (today > campaign.endDate) return 'ended'
  return 'usable'
}

/**
 * Adaya girilen kodun kampanyası (DOM-KAY-041): kurumda bulunmayan ya da arşivlenmiş kod, pasif ya
 * da tarih aralığı dışındaki kampanya 422; ileti alanın altında gösterilir.
 */
export function requireUsableCampaign(campaign: CampaignRef | null, today: string): CampaignRef {
  const path = ['campaignCode']
  if (campaign === null)
    throw new DomainError('campaign_code_not_found', 'Bu kampanya kodu bulunamadı.', { path })
  const status = campaignStatus(campaign, today)
  if (status === 'inactive')
    throw new DomainError('campaign_code_inactive', 'Bu kampanya kodu pasif.', { path })
  if (status === 'not_started')
    throw new DomainError('campaign_code_not_started', 'Bu kampanya henüz başlamadı.', { path })
  if (status === 'ended')
    throw new DomainError('campaign_code_ended', 'Bu kampanyanın süresi doldu.', { path })
  return campaign
}
