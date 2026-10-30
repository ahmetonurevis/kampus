import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { dateLabel, dayKey } from '@kampus/school-core/lib/format.ts'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { LookupError } from './AcademicParts.tsx'
import { addDays, isDayKey, lessonsByDay, weekDays, weekStart } from './academic-rows.ts'
import { LessonPanel } from './LessonPanel.tsx'
import { useAcademicLookups } from './use-academic-lookups.ts'

const WEEK_PARAM = 'hafta'
const noon = (key: string) => `${key}T12:00:00.000Z`

type ScheduleViewProps = {
  /** `teacher`: ders başına sınıf adı; `student`: öğretmen adı. */
  audience: 'teacher' | 'student'
  /** Veli: seçili çocuk; program çocuğun sınıfına daraltılır. Öğrencide boştur (sunucu daraltır). */
  studentId?: string
}

/**
 * Haftalık ders programı (Vue `WeekCalendar`): kapsamdaki dersler okunur, iptal edilenler
 * (`cancelledAt`) hiçbir günde görünmez. Hafta adreste (`?hafta=<pazartesi>`) tutulur; ders
 * sağ panelde açılır. Yalnız okuma.
 * TODO(tutor-calendar): Vue'daki kazanım etütleri (`tutoringCalendarEntries`) programa
 * eklenince etüt oturumları da gösterilir.
 */
export function ScheduleView({ audience, studentId }: ScheduleViewProps) {
  const data = useAcademicLookups()
  const { lookups } = data
  const [params, setParams] = useSearchParams()
  const requested = params.get(WEEK_PARAM)
  const start = weekStart(isDayKey(requested) ? requested : dayKey())
  const thisWeek = weekStart(dayKey())

  // Velide program çocuğun sınıfına daraltılır; çocuğun sınıfı bilinmeden istek atılmaz.
  const classId = studentId ? lookups.students.get(studentId)?.classId : undefined
  const waiting = studentId !== undefined && classId === undefined
  const lessons = useCoreAll('schedule', classId ? { filters: { classId } } : {}, {
    enabled: !waiting,
  })
  const days = useMemo(
    () => lessonsByDay(lessons.data ?? [], lookups, audience, start),
    [lessons.data, lookups, audience, start],
  )
  const panel = useDetailPanel('ders')

  const goTo = (key: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (key === thisWeek) next.delete(WEEK_PARAM)
        else next.set(WEEK_PARAM, key)
        return next
      },
      { preventScrollReset: true },
    )

  const keys = weekDays(start)
  const shown = keys.filter((key, index) => index < 5 || (days.get(key)?.length ?? 0) > 0)
  const loading = lessons.isPending || data.pending
  return (
    <>
      {data.error ? <LookupError error={data.error} onRetry={data.retry} /> : null}
      <section aria-labelledby="program-baslik" className="panel rounded-card border bg-surface">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4 max-[650px]:px-4">
          <h2 id="program-baslik" className="text-lg font-semibold">
            {dateLabel(noon(start), { day: 'numeric', month: 'long' })} –{' '}
            {dateLabel(noon(addDays(start, 6)), { day: 'numeric', month: 'long', year: 'numeric' })}
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => goTo(addDays(start, -7))}>
              <Icon name="ChevronLeft" size={16} aria-hidden="true" />
              Önceki hafta
            </Button>
            <Button
              variant="secondary"
              onClick={() => goTo(thisWeek)}
              disabled={start === thisWeek}
            >
              Bu hafta
            </Button>
            <Button variant="secondary" onClick={() => goTo(addDays(start, 7))}>
              Sonraki hafta
              <Icon name="ChevronRight" size={16} aria-hidden="true" />
            </Button>
          </div>
        </header>
        {lessons.error ? (
          <div role="alert" className="p-8">
            <QueryError error={lessons.error} onRetry={() => void lessons.refetch()} />
          </div>
        ) : loading ? (
          <p role="status" className="p-8 text-center text-base text-muted-foreground">
            Program yükleniyor…
          </p>
        ) : (
          <ol
            aria-label="Haftalık ders programı"
            className="grid grid-cols-1 gap-3 p-4 min-[761px]:grid-cols-2 min-[1281px]:grid-cols-5"
          >
            {shown.map((key) => {
              const list = days.get(key) ?? []
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
                            onClick={() => panel.open(lesson.id)}
                            className="lesson-card grid min-h-11 w-full gap-0.5 rounded-xl border bg-surface px-3 py-2 text-left hover:bg-secondary"
                          >
                            <span className="text-xs text-muted-foreground">
                              {lesson.time} · {lesson.duration} dk
                            </span>
                            <strong className="text-sm font-medium [overflow-wrap:anywhere]">
                              {lesson.title}
                            </strong>
                            <small className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                              {lesson.subtitle}
                            </small>
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
        )}
      </section>
      <LessonPanel lessonId={panel.selectedId} lookups={lookups} onClose={panel.close} />
    </>
  )
}
