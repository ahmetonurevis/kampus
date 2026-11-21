import { SidePanel } from '@/components/SidePanel.tsx'
import {
  SummaryHeader,
  SummaryIcon,
  SummaryList,
  SummaryMetrics,
  SummarySection,
} from '../management/SummaryParts.tsx'
import { TUTORING_LABEL, type ScheduleTutoring } from './schedule-tutoring.ts'

type Props = {
  /** URL'deki etüt kimliği (`?etut=`); boşsa panel kapalı. */
  selectedId: string
  /** Haftanın etütleri; seçili kayıt buradan bulunur (ayrı istek yok). */
  entries: readonly ScheduleTutoring[]
  onClose: () => void
}

/**
 * Programdaki etüt ayrıntısı, salt okunur: ders, konu, saat, derslik, öğretmen ve öğrenci sayısı.
 * Öğrenci adları yalnız öğretmende ve yöneticide gelir (`students`); öğrenci ve veli listeyi
 * görmez. Yoklama ve iptal Otomatik Etüt sayfasındadır.
 */
export function ScheduleTutorPanel({ selectedId, entries, onClose }: Props) {
  const entry = entries.find((item) => item.id === selectedId)
  return (
    <SidePanel
      open={selectedId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Etüt ayrıntısı"
    >
      {entry ? (
        <>
          <SummaryHeader
            icon={<SummaryIcon name="CalendarDays" />}
            title={entry.title}
            subtitle={entry.dayLabel}
            status={TUTORING_LABEL}
            tone="purple"
          />
          <SummaryMetrics
            items={[
              { label: 'Ders', value: entry.subject },
              { label: 'Konu', value: entry.topic },
              { label: 'Saat', value: `${entry.time} · ${entry.duration} dakika` },
              { label: 'Derslik', value: entry.room },
              { label: 'Öğretmen', value: entry.teacher || '—' },
              { label: 'Öğrenci sayısı', value: String(entry.studentCount) },
            ]}
          />
          {entry.students ? (
            <SummarySection title="Öğrenciler">
              <SummaryList
                empty="Öğrenci yok."
                items={entry.students.map((student) => ({
                  key: student.id,
                  label: student.name,
                  value: '',
                }))}
              />
            </SummarySection>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Etüt bu haftanın programında bulunamadı; iptal edilmiş ya da kapsamınız dışında olabilir.
        </p>
      )}
    </SidePanel>
  )
}
