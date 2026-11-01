import { useMemo } from 'react'
import { dateLabel, dayKey } from '@kampus/school-core/lib/format.ts'
import { meetingSummary, upcomingMeetings } from '@kampus/school-core/lib/prospect-form.ts'
import { EmptyState } from '@/components/EmptyState.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { ProspectPanel } from './ProspectPanel.tsx'

const TIME = { weekday: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' } as const

/**
 * Tanışma Görüşmeleri (ön büro `/deneme-dersi-takvimi`; DOM-KAY-006, -033): bugünden itibaren
 * planlı görüşmeler zaman sırasıyla. Planlama ve değiştirme aday kartındadır.
 */
export function MeetingsPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const prospects = useCoreAll('prospects')
  const detail = useDetailPanel('detay')
  const today = dayKey()
  const meetings = useMemo(
    () =>
      upcomingMeetings(
        (prospects.data ?? []).map((row) => ({
          ...row.record,
          id: row.id,
        })),
        today,
      ),
    [prospects.data, today],
  )

  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      {prospects.error ? (
        <QueryError error={prospects.error} onRetry={() => void prospects.refetch()} />
      ) : !prospects.data ? (
        <SummaryLoading />
      ) : meetings.length === 0 ? (
        <EmptyState title="Planlı görüşme yok" description="Görüşmeyi aday kartından planlayın." />
      ) : (
        <section aria-labelledby="gorusme-listesi" className="panel rounded-card border bg-surface">
          <h2 id="gorusme-listesi" className="px-6 pt-6 pb-3 text-lg font-semibold">
            Yaklaşan görüşmeler
          </h2>
          <ul className="divide-y">
            {meetings.map((meeting) => {
              const summary = meetingSummary(meeting)
              return (
                <li
                  key={meeting.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 max-[650px]:px-4"
                >
                  <div className="min-w-0">
                    <p className="font-semibold">{meeting.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {dateLabel(meeting.date, TIME)}
                      {summary ? ` · ${summary}` : ''}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={`${meeting.name} kartını aç`}
                    onClick={() => detail.open(meeting.id)}
                  >
                    Kartı aç
                  </Button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      <ProspectPanel prospectId={detail.selectedId} onClose={detail.close} />
    </>
  )
}
