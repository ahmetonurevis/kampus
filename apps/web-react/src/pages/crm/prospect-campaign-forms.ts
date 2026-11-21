// Kampanya kodu formunun ve huni kırılımının saf mantığı (DOM-KAY-041; ON-134). Kurallar core
// `lib/prospect-campaigns.ts`'tedir; burada yalnız form değerleri, API gövdesi ve ekran satırları
// kurulur. Tutar formda `1.234,56` metnidir, gövdede kuruş.
import { z } from 'zod'
import type {
  CampaignFunnel,
  CampaignRow,
  CreateCampaignBody,
  UpdateCampaignBody,
} from '@kampus/react-shared/use-prospect-campaigns.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { amountInputValue, parseAmountInput } from '@kampus/school-core/lib/payments.ts'
import {
  CAMPAIGN_CHANNEL_LABELS,
  CAMPAIGN_CHANNELS,
  CAMPAIGN_COST_MAX_CENTS,
  campaignCodeSchema,
  campaignSourceSuggestion,
  CAMPAIGN_STATUS_LABELS,
  createCampaignSchema,
  normalizeCampaignCode,
  type CampaignStatus,
} from '@kampus/school-core/lib/prospect-campaigns.ts'
import type { ProspectSource } from '@kampus/school-core/lib/prospects.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

const COST_MESSAGE = 'Maliyeti 1.234,56 biçiminde girin ya da boş bırakın.'
export const parseCampaignCost = (text: string) =>
  parseAmountInput(text, { allowZero: true, maxCents: CAMPAIGN_COST_MAX_CENTS })

/** Kampanya formu: kod yalnız eklemede sorulur; maliyet isteğe bağlıdır. */
export const campaignFormSchema = z
  .object({
    code: z.string(),
    name: createCampaignSchema.shape.name,
    channel: z.enum(CAMPAIGN_CHANNELS, 'Kanalı seçin.'),
    startDate: z.string().min(1, 'Başlangıç gününü seçin.'),
    endDate: z.string().min(1, 'Bitiş gününü seçin.'),
    cost: z.string().refine((value) => value.trim() === '' || parseCampaignCost(value) !== null, {
      message: COST_MESSAGE,
    }),
    isActive: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.startDate && value.endDate && value.endDate < value.startDate)
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'Bitiş günü başlangıç gününden önce olamaz.',
      })
  })
export type CampaignFormValues = z.input<typeof campaignFormSchema>

/** Eklemede kod da denetlenir (düzeltmede kod alanı salt okunurdur). */
export const newCampaignFormSchema = campaignFormSchema.superRefine((value, context) => {
  const parsed = campaignCodeSchema.safeParse(value.code)
  if (!parsed.success)
    context.addIssue({
      code: 'custom',
      path: ['code'],
      message: parsed.error.issues[0]?.message ?? 'Kampanya kodunu yazın.',
    })
})

export function campaignDefaults(campaign?: CampaignRow, today = ''): CampaignFormValues {
  return {
    code: campaign?.code ?? '',
    name: campaign?.name ?? '',
    channel: campaign?.channel ?? 'social_media',
    startDate: campaign?.startDate ?? today,
    endDate: campaign?.endDate ?? '',
    cost: campaign?.costCents == null ? '' : amountInputValue(campaign.costCents),
    isActive: campaign?.isActive ?? true,
  }
}

const costOf = (text: string) => (text.trim() === '' ? null : parseCampaignCost(text))

export function createCampaignBody(values: CampaignFormValues): CreateCampaignBody {
  const costCents = costOf(values.cost)
  return {
    code: normalizeCampaignCode(values.code),
    name: values.name.trim(),
    channel: values.channel,
    startDate: values.startDate,
    endDate: values.endDate,
    ...(costCents === null ? {} : { costCents }),
    isActive: values.isActive,
  }
}

/** Düzeltme gövdesi: yalnız değişen alanlar; boşaltılan maliyet `null` gider. */
export function updateCampaignBody(
  values: CampaignFormValues,
  campaign: CampaignRow,
): UpdateCampaignBody {
  const costCents = costOf(values.cost)
  const name = values.name.trim()
  return {
    ...(name !== campaign.name ? { name } : {}),
    ...(values.channel !== campaign.channel ? { channel: values.channel } : {}),
    ...(values.startDate !== campaign.startDate ? { startDate: values.startDate } : {}),
    ...(values.endDate !== campaign.endDate ? { endDate: values.endDate } : {}),
    ...(costCents !== campaign.costCents ? { costCents } : {}),
    ...(values.isActive !== campaign.isActive ? { isActive: values.isActive } : {}),
  }
}

const FORM_FIELDS = ['code', 'name', 'channel', 'startDate', 'endDate', 'isActive'] as const
export type CampaignFormField = (typeof FORM_FIELDS)[number] | 'cost'
/** Sunucu alan yolu → form alanı; bilinmeyen yol `null` (formun genel hatası). */
export function campaignFormField(path: string): CampaignFormField | null {
  if (path === 'costCents') return 'cost'
  return (FORM_FIELDS as readonly string[]).includes(path) ? (path as CampaignFormField) : null
}

export const CAMPAIGN_STATUS_TONES = {
  usable: 'green',
  inactive: 'gray',
  not_started: 'purple',
  ended: 'amber',
} as const satisfies Record<CampaignStatus, BadgeTone>

const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
export const campaignPeriodLabel = (campaign: { startDate: string; endDate: string }) =>
  `${dayText(campaign.startDate)} – ${dayText(campaign.endDate)}`

export type CampaignListRow = {
  id: string
  code: string
  name: string
  channel: string
  period: string
  cost: string
  status: CampaignStatus
  statusLabel: string
}

export const campaignListRow = (campaign: CampaignRow): CampaignListRow => ({
  id: campaign.id,
  code: campaign.code,
  name: campaign.name,
  channel: CAMPAIGN_CHANNEL_LABELS[campaign.channel],
  period: campaignPeriodLabel(campaign),
  cost: campaign.costCents === null ? '—' : money(campaign.costCents),
  status: campaign.status,
  statusLabel: CAMPAIGN_STATUS_LABELS[campaign.status],
})

// --- Huni kırılımı -------------------------------------------------------------------------

export type CampaignFunnelTableRow = {
  id: string
  campaign: string
  channel: string
  prospects: number
  meetings: number
  offers: number
  enrolled: number
  conversion: string
  cost: string
  perProspect: string
  perEnrollment: string
}

const rateText = (rate: number | null) =>
  rate === null ? '—' : `%${String(rate).replace('.', ',')}`
const costText = (cents: number | null, partial: boolean) =>
  cents === null ? (partial ? 'Aralık kısmi' : '—') : money(cents)

/** Kırılım satırları; kodsuz adaylar ve toplam en sonda. Sayılar sunucudan gelir. */
export function campaignFunnelRows(funnel: CampaignFunnel): CampaignFunnelTableRow[] {
  const summary = (id: string, label: string, row: CampaignFunnel['total']) => ({
    id,
    campaign: label,
    channel: '—',
    prospects: row.prospects,
    meetings: row.meetings,
    offers: row.offers,
    enrolled: row.enrolled,
    conversion: rateText(row.conversionRate),
    cost: '—',
    perProspect: '—',
    perEnrollment: '—',
  })
  return [
    ...funnel.rows.map((row) => ({
      id: row.campaign.id,
      campaign: `${row.campaign.code} · ${row.campaign.name}${row.campaign.archived ? ' (arşivli)' : ''}`,
      channel: CAMPAIGN_CHANNEL_LABELS[row.campaign.channel],
      prospects: row.prospects,
      meetings: row.meetings,
      offers: row.offers,
      enrolled: row.enrolled,
      conversion: rateText(row.conversionRate),
      cost: row.campaign.costCents === null ? '—' : money(row.campaign.costCents),
      perProspect:
        row.campaign.costCents === null ? '—' : costText(row.costPerProspectCents, row.costPartial),
      perEnrollment:
        row.campaign.costCents === null
          ? '—'
          : costText(row.costPerEnrollmentCents, row.costPartial),
    })),
    summary('kodsuz', 'Kampanya kodu yok', funnel.uncoded),
    summary('toplam', 'Toplam', funnel.total),
  ]
}

// --- Aday formu ----------------------------------------------------------------------------

/** Adres parametresindeki kod (`?kampanya=`); biçimsizse boş (formda kullanıcı düzeltir). */
export function campaignCodeFromParam(value: string | null): string {
  if (value === null) return ''
  const parsed = campaignCodeSchema.safeParse(value)
  return parsed.success ? parsed.data : ''
}

/**
 * Seçilen kodun kampanyasından önerilen kaynak (K-289); kod listede yoksa ya da kanalın kaynak
 * karşılığı yoksa `null` (kaynak olduğu gibi kalır).
 */
export function suggestedSource(
  code: string,
  campaigns: readonly Pick<CampaignRow, 'code' | 'channel'>[],
): ProspectSource | null {
  const normalized = normalizeCampaignCode(code)
  const campaign = campaigns.find((item) => item.code === normalized)
  return campaign === undefined ? null : campaignSourceSuggestion(campaign.channel)
}
