// Ders programı görünümlerinin ortak parçaları: gün kutuları (haftalık/günlük) ve dönem
// gezinmesi. Yönetici ekranı ve rol programları (öğretmen, öğrenci, veli) aynı parçaları kullanır.
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { Icon } from '@/components/Icon.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { noon, type ScheduleLesson } from './schedule-model.ts'

type DaysProps = {
  days: readonly string[]
  byDay: ReadonlyMap<string, readonly ScheduleLesson[]>
  onOpen: (lessonId: string) => void
  label: string
  /** Haftalık görünümde boş hafta sonu günleri gizlenir. */
  hideEmptyWeekend?: boolean
}

/** Gün kutuları; her ders paneli açan bir düğmedir (saat, ad, alt metin, yedek, iptal). */
export function ScheduleDays({ days, byDay, onOpen, label, hideEmptyWeekend = true }: DaysProps) {
  const shown = days.filter(
    (key, index) => !hideEmptyWeekend || index < 5 || (byDay.get(key)?.length ?? 0) > 0,
  )
  return (
    <ol
      aria-label={label}
      className={cn(
        'grid grid-cols-1 gap-3 p-4',
        shown.length > 1 && 'min-[761px]:grid-cols-2 min-[1281px]:grid-cols-5',
      )}
    >
      {shown.map((key) => {
        const list = byDay.get(key) ?? []
        return (
          <li key={key} className="min-w-0 rounded-card border bg-surface-soft p-3">
            <h3 className="mb-2 text-sm font-semibold">
              {dateLabel(noon(key), { weekday: 'long', day: 'numeric', month: 'long' })}
            </h3>
            {list.length ? (
              <ul className="grid gap-2">
                {list.map((lesson) => (
                  <li key={lesson.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(lesson.id)}
                      className={cn(
                        'lesson-card grid min-h-11 w-full gap-0.5 rounded-xl border bg-surface px-3 py-2 text-left hover:bg-secondary',
                        lesson.cancelled && 'text-muted-foreground',
                      )}
                    >
                      <span className="flex flex-wrap items-center justify-between gap-1 text-xs text-muted-foreground">
                        {lesson.time} · {lesson.duration} dk
                        {lesson.cancelled ? <StatusBadge text="İptal edildi" tone="red" /> : null}
                      </span>
                      <strong
                        className={cn(
                          'text-sm font-medium [overflow-wrap:anywhere]',
                          lesson.cancelled && 'line-through',
                        )}
                      >
                        {lesson.title}
                      </strong>
                      <small className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        {lesson.subtitle}
                      </small>
                      {lesson.substitute ? (
                        <small className="text-xs font-medium [overflow-wrap:anywhere]">
                          {lesson.substitute}
                        </small>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Ders yok.</p>
            )}
          </li>
        )
      })}
    </ol>
  )
}

type PeriodNavProps = {
  unit: 'hafta' | 'gun'
  onPrevious: () => void
  onCurrent: () => void
  onNext: () => void
  atCurrent: boolean
}

/** Önceki / bu / sonraki hafta (ya da gün). */
export function PeriodNav({ unit, onPrevious, onCurrent, onNext, atCurrent }: PeriodNavProps) {
  const week = unit === 'hafta'
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={onPrevious}>
        <Icon name="ChevronLeft" size={16} aria-hidden="true" />
        {week ? 'Önceki hafta' : 'Önceki gün'}
      </Button>
      <Button variant="secondary" onClick={onCurrent} disabled={atCurrent}>
        {week ? 'Bu hafta' : 'Bugün'}
      </Button>
      <Button variant="secondary" onClick={onNext}>
        {week ? 'Sonraki hafta' : 'Sonraki gün'}
        <Icon name="ChevronRight" size={16} aria-hidden="true" />
      </Button>
    </div>
  )
}
