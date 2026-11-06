// Aday kartındaki ticari ileti onayı gösterimi (DOM-KAY-004): kanal satırları ve olay metinleri.
// Karar sunucudadır (`setProspectMarketingConsent`); burada yalnız mevcut durumu satıra çeviririz.
import {
  hasMarketingConsent,
  hasUnverifiedMarketingConsent,
  MARKETING_CHANNELS,
  type MarketingChannel,
  type MarketingConsentEvent,
  type ProspectFields,
} from '@kampus/school-core/lib/prospects.ts'

/** Kanalın kullanıcıya gösterilen adı. */
export const CHANNEL_LABELS = {
  sms: 'SMS',
  email: 'E-posta',
  call: 'Arama',
} as const satisfies Record<MarketingChannel, string>

/** Web formundan gelen, kişiyle doğrulanmamış seçimin kartta gösterilen durumu (ON-133). */
export const UNVERIFIED_CONSENT_LABEL = 'Formdan geldi, doğrulanmadı'

export type ConsentRow = {
  channel: MarketingChannel
  label: string
  /** Geçerli onay; doğrulanmamış form seçimi burada yoktur, `unverified` ayrı söyler. */
  granted: boolean
  /** Formda işaretlendi, kişiyle doğrulanmadı: doğrulanabilir ya da geri alınabilir. */
  unverified: boolean
  /** Güncel kararın verildiği an; hiç kaydı olmayan eski adayda `null`. */
  at: string | null
  /** Onay verilemiyor: e-posta onayı için adayın e-postası olmalıdır. */
  blocked: string | null
}

export function consentRows(prospect: {
  email?: string | undefined
  marketingConsent?: ProspectFields['marketingConsent']
}): ConsentRow[] {
  return MARKETING_CHANNELS.map((channel) => {
    const granted = hasMarketingConsent(prospect, channel)
    return {
      channel,
      label: CHANNEL_LABELS[channel],
      granted,
      unverified: hasUnverifiedMarketingConsent(prospect, channel),
      at: prospect.marketingConsent?.[channel]?.at ?? null,
      blocked:
        channel === 'email' && !granted && !prospect.email?.trim()
          ? 'E-posta onayı için adayın e-posta adresi gerekir.'
          : null,
    }
  })
}

/** Geçmiş satırı: en yeni olay üstte, en fazla `limit` olay. */
export function recentConsentEvents(
  events: readonly MarketingConsentEvent[] | undefined,
  limit = 5,
): MarketingConsentEvent[] {
  return [...(events ?? [])].reverse().slice(0, limit)
}

export const consentEventLabel = (
  event: Pick<MarketingConsentEvent, 'channel' | 'granted' | 'verified'>,
) =>
  `${CHANNEL_LABELS[event.channel]} onayı ${
    event.verified === true ? 'doğrulandı' : event.granted ? 'verildi' : 'geri alındı'
  }`
