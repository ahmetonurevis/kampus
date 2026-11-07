import { useSetProspectMarketingConsent } from '@kampus/react-shared/use-prospect-commands.ts'
import type { MarketingChannel, ProspectFields } from '@kampus/school-core/lib/prospects.ts'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify.ts'
import {
  CHANNEL_LABELS,
  consentEventLabel,
  consentRows,
  recentConsentEvents,
} from './prospect-consent.ts'
import { dateTimeLabel } from './prospect-rows.ts'

/**
 * Ticari ileti onayı (DOM-KAY-004): kanal başına onay durumu; ön büro ve yönetici adayın talebiyle
 * onayı verir ya da tek tıkla geri alır (ret hakkı geciktirilemez). Her değişiklik geçmişe eklenir.
 * Randevu teyidi gibi hizmet iletileri onaya bağlı değildir. `If-Match` kartın okunan sürümüdür.
 */
export function ProspectConsentPanel({
  prospectId,
  version,
  prospect,
}: {
  prospectId: string
  version: number
  prospect: {
    email?: string | undefined
    marketingConsent?: ProspectFields['marketingConsent']
    marketingConsentHistory?: ProspectFields['marketingConsentHistory']
  }
}) {
  const consent = useSetProspectMarketingConsent()
  const rows = consentRows(prospect)
  const history = recentConsentEvents(prospect.marketingConsentHistory)

  async function change(channel: MarketingChannel, granted: boolean) {
    const outcome = await consent.submit({ prospectId, version, body: { channel, granted } })
    if (outcome.status === 'success')
      notify.success(`${CHANNEL_LABELS[channel]} onayı ${granted ? 'kaydedildi' : 'geri alındı'}.`)
  }

  return (
    <section aria-labelledby="aday-ticari-ileti" className="grid gap-3 border-t pt-4">
      <h3 id="aday-ticari-ileti" className="text-sm font-semibold">
        Ticari ileti onayı
      </h3>
      <p className="text-xs text-muted-foreground">
        Kampanya ve tanıtım iletileri yalnız onay varsa gönderilir; randevu ve sözleşme
        bilgilendirmesi onaya bağlı değildir.
      </p>
      <ul className="grid gap-2">
        {rows.map((row) => (
          <li key={row.channel} className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex flex-wrap items-center gap-2 text-sm">
              <span>{row.label}</span>
              <StatusBadge
                text={row.granted ? 'Onay var' : 'Onay yok'}
                tone={row.granted ? 'green' : 'gray'}
              />
              {row.at ? (
                <span className="text-xs text-muted-foreground">{dateTimeLabel(row.at)}</span>
              ) : null}
            </span>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={consent.isPending || row.blocked !== null}
              title={row.blocked ?? undefined}
              aria-label={`${row.label} onayını ${row.granted ? 'geri al' : 'kaydet'}`}
              onClick={() => void change(row.channel, !row.granted)}
            >
              {row.granted ? 'Onayı geri al' : 'Onay kaydet'}
            </Button>
          </li>
        ))}
      </ul>
      {history.length > 0 ? (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground">Son değişiklikler</h4>
          <ul className="mt-1 grid gap-1 text-xs text-muted-foreground">
            {history.map((event) => (
              <li key={`${event.channel}:${event.at}:${String(event.granted)}`}>
                {consentEventLabel(event)} · {dateTimeLabel(event.at)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
