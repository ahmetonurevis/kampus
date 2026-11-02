import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { useLessonsInRange } from '@kampus/react-shared/use-lessons.ts'
import { QueryError } from '@/components/QueryError.tsx'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { LookupError } from './AcademicParts.tsx'
import { addDays, isDayKey, weekStart } from './academic-rows.ts'
import { LessonPanel } from './LessonPanel.tsx'
import { PeriodNav, ScheduleDays } from './ScheduleParts.tsx'
import {
  rangeTitle,
  scheduleByDay,
  scheduleLesson,
  scheduleRange,
  viewDays,
} from './schedule-model.ts'
import { useAcademicLookups } from './use-academic-lookups.ts'

const WEEK_PARAM = 'hafta'

type ScheduleViewProps = {
  /** `teacher`: ders başına sınıf adı; `student`: öğretmen adı. */
  audience: 'teacher' | 'student'
  /** Veli: seçili çocuk; program çocuğun sınıfına daraltılır. Öğrencide boştur (sunucu daraltır). */
  studentId?: string
}

/**
 * Haftalık ders programı (Vue `WeekCalendar`), salt okunur: `GET /lessons` haftanın günleriyle
 * (Europe/Istanbul) okunur; kapsam sunucudadır (öğretmen kendi asıl ya da yedek olduğu dersleri,
 * öğrenci ve veli sınıfın programı). İptal edilen ders hiçbir günde görünmez (sunucu varsayılanı
 * `cancelled=false`). Yedek atanmışsa "Yedek: …" yazar, gerekçe gösterilmez (DOM-YTK-068). Hafta
 * adreste (`?hafta=<pazartesi>`) tutulur; ders sağ panelde açılır.
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
  const range = scheduleRange('hafta', start, '', '')
  const lessons = useLessonsInRange(
    { ...range, ...(classId ? { classId } : {}) },
    { enabled: !waiting },
  )
  const days = viewDays('hafta', start)
  const byDay = useMemo(
    () =>
      scheduleByDay(
        (lessons.data ?? []).map((lesson) => scheduleLesson(lesson, lookups, audience)),
        viewDays('hafta', start),
      ),
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

  const loading = lessons.isPending || data.pending
  return (
    <>
      {data.error ? <LookupError error={data.error} onRetry={data.retry} /> : null}
      <section aria-labelledby="program-baslik" className="panel rounded-card border bg-surface">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4 max-[650px]:px-4">
          <h2 id="program-baslik" className="text-lg font-semibold">
            {rangeTitle('hafta', start)}
          </h2>
          <PeriodNav
            unit="hafta"
            onPrevious={() => goTo(addDays(start, -7))}
            onCurrent={() => goTo(thisWeek)}
            onNext={() => goTo(addDays(start, 7))}
            atCurrent={start === thisWeek}
          />
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
          <ScheduleDays
            days={days}
            byDay={byDay}
            onOpen={panel.open}
            label="Haftalık ders programı"
          />
        )}
      </section>
      <LessonPanel lessonId={panel.selectedId} lookups={lookups} onClose={panel.close} />
    </>
  )
}
