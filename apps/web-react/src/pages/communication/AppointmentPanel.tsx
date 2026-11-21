import { useAuth } from '@/auth/use-auth.ts'
import { NOT_FOUND_MESSAGE, QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { useCoreItem } from '@/hooks/use-core-collection.ts'
import { useMinuteClock } from '@/hooks/use-minute-clock.ts'
import {
  SummaryHeader,
  SummaryIcon,
  SummaryLoading,
  SummaryMetrics,
  SummarySection,
} from '../management/SummaryParts.tsx'
import { AppointmentActions } from './AppointmentActions.tsx'
import {
  STATUS_TONES,
  appointmentRow,
  outsideChildScope,
  type AppointmentAudience,
  type AppointmentLookups,
  type AppointmentRow,
} from './appointment-rows.ts'

type Props = {
  appointmentId: string
  onClose: () => void
  audience: AppointmentAudience
  /** Öğretmen adları; hazır olana kadar `undefined`. */
  lookups: AppointmentLookups | undefined
  /** Öğretmen adları okunamadıysa hata; panel yüklemede kalmaz. */
  lookupsError?: unknown
  onRetryLookups?: () => void
  /** Veli için seçili çocuk; başka çocuğun randevusu bu panelde açılmaz. Diğer rollerde boş. */
  childId?: string
}

/**
 * Randevu ayrıntısı: tek kayıt ucundan okunur; kapsam dışı randevu (başka velinin görüşmesi,
 * başka öğretmenin randevusu) olmayan kayıtla aynı 404 ile "bulunamadı" olur (DOM-ILT-103).
 * Konu, durum geçmişi (kim, ne zaman, gerekçe) ve geçerli işlemler görünür (DOM-ILT-102).
 */
export function AppointmentPanel({
  appointmentId,
  onClose,
  audience,
  lookups,
  lookupsError,
  onRetryLookups,
  childId,
}: Props) {
  return (
    <SidePanel
      open={appointmentId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Randevu ayrıntısı"
    >
      {appointmentId ? (
        <AppointmentDetail
          appointmentId={appointmentId}
          audience={audience}
          lookups={lookups}
          lookupsError={lookupsError}
          onRetryLookups={onRetryLookups}
          childId={childId}
        />
      ) : null}
    </SidePanel>
  )
}

function AppointmentDetail({
  appointmentId,
  audience,
  lookups,
  lookupsError,
  onRetryLookups,
  childId,
}: Omit<Props, 'onClose'>) {
  const { session } = useAuth()
  const item = useCoreItem('appointments', appointmentId)
  const now = useMinuteClock()
  const viewerId = session?.user.id ?? ''
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  if (lookupsError && !lookups) return <QueryError error={lookupsError} onRetry={onRetryLookups} />
  if (!item.data || !lookups) return <SummaryLoading />
  const row = appointmentRow(item.data, lookups, audience, viewerId, now)
  // Adres başka çocuğun randevusunu gösterebilir (`?cocuk=s2&randevu=<Deniz'in kimliği>`): seçili
  // çocuğun olmayan randevu bu panelde açılmaz, olmayan kayıtla aynı "bulunamadı" görünür.
  if (outsideChildScope(row, audience, childId)) return <NotFound />
  return (
    <>
      <SummaryHeader
        icon={<SummaryIcon name="CalendarCheck2" />}
        title={row.type}
        subtitle={[row.counterpart, row.when].join(' · ')}
        status={row.status}
        tone={statusTone(row)}
      />
      <SummaryMetrics
        items={[
          audience === 'teacher'
            ? { label: 'Öğrenci', value: row.student || '—' }
            : { label: 'Öğretmen', value: row.teacher },
          { label: 'Tarih ve saat', value: row.when },
          { label: 'Süre', value: row.duration === null ? '—' : `${row.duration} dk` },
          { label: 'Tür', value: row.type },
        ]}
      />
      <SummarySection title="Görüşme konusu">
        <p className="text-sm [overflow-wrap:anywhere] whitespace-pre-wrap">{row.note}</p>
      </SummarySection>
      <SummarySection title="Geçmiş">
        {row.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Bu randevunun geçmiş kaydı yok.</p>
        ) : (
          <ol className="grid gap-3">
            {row.history.map((entry) => (
              <li key={entry.key} className="rounded-card border bg-surface-soft px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  {entry.label} · {entry.by} · {entry.stamp}
                </p>
                {entry.reason ? (
                  <p className="mt-1 text-sm [overflow-wrap:anywhere] whitespace-pre-wrap">
                    <span className="text-muted-foreground">Gerekçe: </span>
                    {entry.reason}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </SummarySection>
      <AppointmentActions
        key={row.id}
        row={row}
        audience={audience}
        now={now}
        reload={async () => {
          const fresh = (await item.refetch()).data
          return fresh
            ? appointmentRow(fresh, lookups, audience, viewerId, new Date().toISOString())
            : null
        }}
      />
    </>
  )
}

function NotFound() {
  return (
    <p role="status" className="text-center text-base text-muted-foreground">
      {NOT_FOUND_MESSAGE}
    </p>
  )
}

const statusTone = (row: AppointmentRow) =>
  STATUS_TONES[row.status as keyof typeof STATUS_TONES] ?? 'gray'
