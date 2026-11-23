import { useGroupWaitlist } from '@kampus/react-shared/use-language-groups.ts'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { SummarySection } from '../management/SummaryParts.tsx'
import { suggestionSummary, waitlistRows, waitlistStatusTone } from './waitlist-rows.ts'

/**
 * Grup panelinin "Bekleme sırası" sekmesi (DOM-DIL-043; yönetici ve ön büro): grubun ve kurun
 * grupsuz bekleyenleri sırayla, ardından gruba yapılmış açık teklifler. Core teklif önerisi
 * yalnız bilgi olarak görünür; sıraya alma, teklif ve kabul kayıt akışındadır (ON-058).
 */
export function GroupWaitlist({
  groupId,
  studentNames,
}: {
  groupId: string
  studentNames: ReadonlyMap<string, string>
}) {
  const waitlist = useGroupWaitlist(groupId)
  if (waitlist.error)
    return <QueryError error={waitlist.error} onRetry={() => void waitlist.refetch()} />
  const data = waitlist.data?.data
  if (!data)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Bekleme sırası yükleniyor…
      </p>
    )
  const rows = waitlistRows(data, studentNames)
  const summary = suggestionSummary(data)
  return (
    <SummarySection title="Bekleme sırası">
      {summary ? (
        <p role="note" className="mb-3 text-sm text-muted-foreground">
          {summary}. Teklif kayıt işlemlerinden yapılır.
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Bu grup için bekleyen yok.</p>
      ) : (
        <ol aria-label="Bekleme sırası" className="grid gap-2">
          {rows.map((row) => (
            <li key={row.id} className="grid gap-1 rounded-xl border px-3.5 py-2.5 text-sm">
              <span className="flex items-center justify-between gap-3">
                <strong className="font-medium">
                  {row.position} {row.person}
                </strong>
                <StatusBadge text={row.status} tone={waitlistStatusTone(row.statusKey)} />
              </span>
              <span className="text-muted-foreground">
                {row.scope} · İstek: {row.requested}
              </span>
              {row.note ? <span className="text-muted-foreground">{row.note}</span> : null}
            </li>
          ))}
        </ol>
      )}
    </SummarySection>
  )
}
