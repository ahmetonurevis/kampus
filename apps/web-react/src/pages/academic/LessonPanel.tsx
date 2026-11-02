import { dateLabel, timeLabel } from '@kampus/school-core/lib/format.ts'
import { useLesson } from '@kampus/react-shared/use-lessons.ts'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Button } from '@/components/ui/button'
import { useMinuteClock } from '@/hooks/use-minute-clock.ts'
import {
  SummaryHeader,
  SummaryIcon,
  SummaryList,
  SummaryLoading,
  SummaryMetrics,
  SummarySection,
} from '../management/SummaryParts.tsx'
import type { AcademicLookups } from './academic-rows.ts'
import { LESSON_STATUS_LABELS, lessonActions, substituteText } from './schedule-model.ts'

export type LessonCommand = 'edit' | 'substitute' | 'cancel'

type Props = {
  lessonId: string
  lookups: AcademicLookups
  onClose: () => void
  /** Yönetici: düzenle, yedek ata, iptal et (yalnız başlamamış ve iptal edilmemiş derste). */
  canManage?: boolean
  onCommand?: (command: LessonCommand, lessonId: string) => void
}

/**
 * Ders ayrıntısı (`GET /lessons/:id`). İptal ve görevlendirme gerekçesi yalnız yöneticiye döner;
 * diğer roller dersin iptal edildiğini ya da yedek atandığını görür, gerekçeyi görmez
 * (DOM-YTK-068). Öğrenci, veli ve öğretmen için iptal edilen ders programda yer almaz.
 */
export function LessonPanel({ lessonId, lookups, onClose, canManage = false, onCommand }: Props) {
  return (
    <SidePanel
      open={lessonId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Ders ayrıntısı"
    >
      {lessonId ? (
        <LessonDetail
          lessonId={lessonId}
          lookups={lookups}
          canManage={canManage}
          {...(onCommand ? { onCommand } : {})}
        />
      ) : null}
    </SidePanel>
  )
}

function LessonDetail({
  lessonId,
  lookups,
  canManage,
  onCommand,
}: Omit<Props, 'onClose'> & { canManage: boolean }) {
  const item = useLesson(lessonId)
  const now = useMinuteClock()
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  if (!item.data) return <SummaryLoading />
  const lesson = item.data.data
  if (lesson.status === 'cancelled' && !canManage)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Bu ders iptal edildi; programda yer almıyor.
      </p>
    )
  const schoolClass = lookups.classes.get(lesson.classId)
  const teacherName = (id: string) => lookups.teachers.get(id)?.name ?? '—'
  const actions = lessonActions(lesson, canManage, now)
  const substitute = substituteText(lesson, lookups)
  return (
    <>
      <SummaryHeader
        icon={<SummaryIcon name="CalendarDays" />}
        title={lesson.title ?? lookups.subjects.get(lesson.subjectId)?.name ?? 'Ders'}
        subtitle={dateLabel(lesson.date, { weekday: 'long', year: 'numeric' })}
        status={LESSON_STATUS_LABELS[lesson.status]}
        tone={lesson.status === 'cancelled' ? 'red' : lesson.originalTeacherId ? 'amber' : 'purple'}
      />
      <SummaryMetrics
        items={[
          { label: 'Saat', value: `${timeLabel(lesson.date)} · ${lesson.duration} dakika` },
          { label: 'Sınıf', value: schoolClass?.name ?? '—' },
          { label: 'Derslik', value: lesson.room },
          { label: 'Öğretmen', value: teacherName(lesson.teacherId) },
          {
            label: 'Kampüs',
            value: lookups.branches.get(schoolClass?.branchId ?? '')?.name ?? '—',
          },
        ]}
      />
      {substitute ? (
        <SummarySection title="Görevlendirme">
          <p className="text-sm">{substitute}</p>
          {lesson.originalTeacherId && lookups.teachers.has(lesson.originalTeacherId) ? (
            <p className="text-sm text-muted-foreground">
              Asıl öğretmen: {teacherName(lesson.originalTeacherId)}
            </p>
          ) : null}
        </SummarySection>
      ) : null}
      {lesson.substitutions && lesson.substitutions.length > 0 ? (
        <SummarySection title="Görevlendirme geçmişi">
          <SummaryList
            empty="Görevlendirme yok."
            items={lesson.substitutions.map((entry, index) => ({
              key: `${entry.date}-${index}`,
              label: `${teacherName(entry.fromTeacherId)} → ${teacherName(entry.toTeacherId)}`,
              value: entry.reason,
            }))}
          />
        </SummarySection>
      ) : null}
      {lesson.status === 'cancelled' ? (
        <SummarySection title="İptal">
          <p className="text-sm">
            {lesson.cancelledAt
              ? `${dateLabel(lesson.cancelledAt, { year: 'numeric' })} tarihinde iptal edildi.`
              : 'Ders iptal edildi.'}
          </p>
          {lesson.cancelReason ? (
            <p className="text-sm [overflow-wrap:anywhere]">
              İptal gerekçesi: {lesson.cancelReason}
            </p>
          ) : null}
        </SummarySection>
      ) : null}
      {canManage && onCommand ? (
        actions.edit ? (
          <div className="mt-6 flex flex-wrap justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={() => onCommand('cancel', lesson.id)}>
              <Icon name="X" size={16} aria-hidden="true" />
              Dersi iptal et
            </Button>
            <Button variant="secondary" onClick={() => onCommand('substitute', lesson.id)}>
              <Icon name="UsersRound" size={16} aria-hidden="true" />
              Yedek öğretmen ata
            </Button>
            <Button onClick={() => onCommand('edit', lesson.id)}>
              <Icon name="Pencil" size={16} aria-hidden="true" />
              Dersi düzenle
            </Button>
          </div>
        ) : lesson.status !== 'cancelled' ? (
          <p role="status" className="mt-6 text-sm text-muted-foreground">
            Başlamış ya da geçmiş ders değiştirilemez.
          </p>
        ) : null
      ) : null}
    </>
  )
}
