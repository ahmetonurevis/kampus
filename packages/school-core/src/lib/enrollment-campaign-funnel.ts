import type { InstitutionType } from '../modules/collection-modules.ts'
import { CSV_SEPARATOR, csvAmount, csvCell } from './csv.ts'
import { funnelRate, funnelReach, type FunnelProspect } from './enrollment-funnel.ts'
import { CAMPAIGN_CHANNEL_LABELS, type CampaignChannel } from './prospect-campaigns.ts'

/**
 * Kayıt hunisinin kampanya kırılımı (docs/domain/kayit-ve-crm.md DOM-KAY-041; IST-117, ON-134).
 * Saf hesap: girdi servisin rapor aralığına (adayın açılış günü) göre yüklediği adaylar ve kurumun
 * kampanyalarıdır; çıktı kişi adı, iletişim bilgisi ve aday kimliği taşımaz.
 *
 * - Adımlar aday → görüşme → teklif → kesin kayıt; birikimlidir (DOM-KAY-040 ilkesi): ileri adıma
 *   ulaşan aday önceki adımları geçmiş sayılır. Görüşme hunideki görüşme ya da deneme dersidir;
 *   teklif `Teklif verildi` aşaması ya da o aşamaya geçiş izidir (`offeredAt`, K-290).
 * - Maliyet girilmişse aday başı ve kayıt başı maliyet kuruşa yuvarlanır; rapor aralığı kampanyanın
 *   bütün günlerini kapsamıyorsa birim maliyet hesaplanmaz (K-290).
 * - Satır yalnız sayı taşır; küçük grup bastırılmaz (K-291, DOM-KAY-040 kaynak kırılımıyla aynı).
 */

/** Kırılımda okunan aday alanları: hunininkiler, teklif izi ve kampanya bağı. */
export type CampaignFunnelProspect = FunnelProspect & {
  campaignId?: string | null | undefined
  /** `Teklif verildi` aşamasına ilk geçiş anı; yeni kayıtlarda yazılır (K-290). */
  offeredAt?: string | null | undefined
}

/** Kırılımdaki kampanya: tanım ve kayıt durumu (arşivli kampanya adaylarıyla raporda kalır). */
export type CampaignFunnelCampaign = {
  id: string
  code: string
  name: string
  channel: CampaignChannel
  startDate: string
  endDate: string
  costCents: number | null
  isActive: boolean
  archived: boolean
}

export type CampaignFunnelCounts = {
  prospects: number
  /** Görüşmeye (dil okulunda seviye tespiti ya da deneme dersine) ulaşan aday, birikimli. */
  meetings: number
  /** Teklif aşamasına ulaşan aday, birikimli. */
  offers: number
  enrolled: number
  /** Kesin kaydın aday sayısına oranı, yüzde (bir ondalık); aday yoksa `null`. */
  conversionRate: number | null
}

export type CampaignFunnelRow = CampaignFunnelCounts & {
  campaign: CampaignFunnelCampaign
  /** Aday başı maliyet (kuruş); maliyet yoksa, aday yoksa ya da aralık kısmiyse `null`. */
  costPerProspectCents: number | null
  /** Kesin kayıt başı maliyet (kuruş); aynı koşullarla `null`. */
  costPerEnrollmentCents: number | null
  /** Rapor aralığı kampanya günlerinin tamamını kapsamıyor; birim maliyet hesaplanmaz. */
  costPartial: boolean
}

export type CampaignFunnel = {
  total: CampaignFunnelCounts
  rows: CampaignFunnelRow[]
  /** Kampanya koduyla açılmamış adaylar. */
  uncoded: CampaignFunnelCounts
}

export type CampaignFunnelRange = { dateFrom?: string | undefined; dateTo?: string | undefined }

const LEVELS = { prospect: 0, meeting: 1, offer: 2, enrolled: 3 } as const

/** Adayın kırılımda ulaştığı en ileri adım (birikimli; DOM-KAY-040 ile aynı ilke). */
function campaignLevel(prospect: CampaignFunnelProspect, institutionType: InstitutionType): number {
  const reach = funnelReach(prospect, institutionType)
  if (reach === 'enrolled') return LEVELS.enrolled
  const offered =
    prospect.stage === 'Teklif verildi' ||
    (typeof prospect.offeredAt === 'string' && prospect.offeredAt !== '')
  if (offered) return LEVELS.offer
  return reach === 'prospect' ? LEVELS.prospect : LEVELS.meeting
}

type Tally = [number, number, number, number]
const emptyTally = (): Tally => [0, 0, 0, 0]
function add(tally: Tally, level: number) {
  for (let index = 0; index <= level; index += 1) tally[index] = (tally[index] ?? 0) + 1
}
const countsOf = ([prospects, meetings, offers, enrolled]: Tally): CampaignFunnelCounts => ({
  prospects,
  meetings,
  offers,
  enrolled,
  conversionRate: funnelRate(enrolled, prospects),
})

/** Aralık kampanyanın bütün günlerini kapsıyor mu; açık uç kapsar. */
function coversCampaign(range: CampaignFunnelRange, campaign: CampaignFunnelCampaign) {
  return (
    (range.dateFrom === undefined || range.dateFrom <= campaign.startDate) &&
    (range.dateTo === undefined || range.dateTo >= campaign.endDate)
  )
}

/** Aralık kampanya günleriyle kesişiyor mu. */
function overlaps(range: CampaignFunnelRange, campaign: CampaignFunnelCampaign) {
  return (
    (range.dateFrom === undefined || range.dateFrom <= campaign.endDate) &&
    (range.dateTo === undefined || range.dateTo >= campaign.startDate)
  )
}

const perUnit = (cost: number | null, count: number, partial: boolean) =>
  cost === null || partial || count === 0 ? null : Math.round(cost / count)

/**
 * Kampanya kırılımı (DOM-KAY-041). Girdi rapor aralığında açılmış adaylardır. Satırlar: aralıkla
 * kesişen etkin ya da pasif (arşivlenmemiş) kampanyalar ve aralıkta adayı olan her kampanya (arşivli
 * dahil); aday sayısına göre çoktan aza, eşitlikte koda göre. Bilinmeyen kampanyaya bağlı aday
 * (silinmiş tanım) kodsuz sayılmaz, toplamda kalır.
 */
export function campaignFunnel(
  prospects: readonly CampaignFunnelProspect[],
  campaigns: readonly CampaignFunnelCampaign[],
  institutionType: InstitutionType,
  range: CampaignFunnelRange = {},
): CampaignFunnel {
  const total = emptyTally()
  const uncoded = emptyTally()
  const byCampaign = new Map<string, Tally>()
  for (const prospect of prospects) {
    const level = campaignLevel(prospect, institutionType)
    add(total, level)
    const campaignId =
      typeof prospect.campaignId === 'string' && prospect.campaignId !== ''
        ? prospect.campaignId
        : null
    if (campaignId === null) {
      add(uncoded, level)
      continue
    }
    let tally = byCampaign.get(campaignId)
    if (tally === undefined) {
      tally = emptyTally()
      byCampaign.set(campaignId, tally)
    }
    add(tally, level)
  }
  const rows = campaigns
    .filter(
      (campaign) =>
        byCampaign.has(campaign.id) || (!campaign.archived && overlaps(range, campaign)),
    )
    .map((campaign): CampaignFunnelRow => {
      const counts = countsOf(byCampaign.get(campaign.id) ?? emptyTally())
      const costPartial = !coversCampaign(range, campaign)
      return {
        campaign,
        ...counts,
        costPerProspectCents: perUnit(campaign.costCents, counts.prospects, costPartial),
        costPerEnrollmentCents: perUnit(campaign.costCents, counts.enrolled, costPartial),
        costPartial,
      }
    })
    .sort(
      (a, b) =>
        b.prospects - a.prospects ||
        (a.campaign.code < b.campaign.code ? -1 : a.campaign.code > b.campaign.code ? 1 : 0),
    )
  return { total: countsOf(total), rows, uncoded: countsOf(uncoded) }
}

const rateText = (rate: number | null) => (rate === null ? '' : String(rate).replace('.', ','))
const amountText = (cents: number | null) => (cents === null ? '' : csvAmount(cents))

/**
 * Kırılımın CSV'si: `;` ayırıcı, metin hücreleri formül kaçışlı, tutar ondalık virgüllü TL, oran
 * yüzde. Kodsuz adaylar ve toplam son iki satırdır. Kişi verisi yoktur.
 */
export function campaignFunnelCsv(funnel: CampaignFunnel): string {
  const header = [
    'Kampanya kodu',
    'Kampanya adı',
    'Kanal',
    'Başlangıç',
    'Bitiş',
    'Aday',
    'Görüşme',
    'Teklif',
    'Kesin kayıt',
    'Dönüşüm oranı (%)',
    'Maliyet (TL)',
    'Aday başı maliyet (TL)',
    'Kayıt başı maliyet (TL)',
  ]
  const counts = (row: CampaignFunnelCounts) => [
    String(row.prospects),
    String(row.meetings),
    String(row.offers),
    String(row.enrolled),
    rateText(row.conversionRate),
  ]
  const lines = [
    header.map(csvCell).join(CSV_SEPARATOR),
    ...funnel.rows.map((row) =>
      [
        csvCell(row.campaign.code),
        csvCell(row.campaign.name),
        csvCell(CAMPAIGN_CHANNEL_LABELS[row.campaign.channel]),
        csvCell(row.campaign.startDate),
        csvCell(row.campaign.endDate),
        ...counts(row),
        amountText(row.campaign.costCents),
        amountText(row.costPerProspectCents),
        amountText(row.costPerEnrollmentCents),
      ].join(CSV_SEPARATOR),
    ),
    [csvCell('Kodsuz'), csvCell(''), csvCell(''), csvCell(''), csvCell('')]
      .concat(counts(funnel.uncoded), ['', '', ''])
      .join(CSV_SEPARATOR),
    [csvCell('Toplam'), csvCell(''), csvCell(''), csvCell(''), csvCell('')]
      .concat(counts(funnel.total), ['', '', ''])
      .join(CSV_SEPARATOR),
  ]
  return `${lines.join('\r\n')}\r\n`
}
