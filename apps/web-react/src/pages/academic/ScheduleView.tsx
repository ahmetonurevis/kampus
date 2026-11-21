import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { isUnreadableCollectionError } from '@kampus/react-shared/collections.ts'
import { useLessonsInRange } from '@kampus/react-shared/use-lessons.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { QueryError } from '@/components/QueryError.tsx'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { LookupError } from './AcademicParts.tsx'
import { addDays, isDayKey, weekStart } from './academic-rows.ts'
import { LessonPanel } from './LessonPanel.tsx'
import { ScheduleTutorPanel } from './ScheduleTutorPanel.tsx'
import { PeriodNav, ScheduleDays } from './ScheduleParts.tsx'
import {
  rangeTitle,
  scheduleByDay,
  scheduleLesson,
  scheduleRange,
  viewDays,
} from './schedule-model.ts'
import { scheduleTutorings } from './schedule-tutoring.ts'
import { useAcademicLookups } from './use-academic-lookups.ts'

const WEEK_PARAM = 'hafta'
const TUTORING_MODULE = 'tutoring'
const NO_RECORDS: readonly never[] = []

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
 *
 * Kazanım etütleri (IST-096; Vue `tutoringCalendarEntries`) aynı haftada "Etüt" etiketli kart olarak
 * görünür: `GET /collections/tutorSessions` haftanın günleriyle (`dateFrom`/`dateTo`, Europe/Istanbul)
 * okunur; kapsamı sunucu daraltır (öğretmen kendi etütleri, öğrenci/veli yalnız kendi öğrencileri),
 * velide seçili çocuk istemcide ayrıca uygulanır. İptal edilen etüt görünmez. Öğrenci adları
 * yalnız öğretmen panelinde vardır. Etüt modülü kapalıysa (ya da okunamıyorsa) program yalnız ders
 * gösterir; etüt okuma hatası dersleri engellemez, uyarı çıkar.
 */
export function ScheduleView({ audience, studentId }: ScheduleViewProps) {
  const data = useAcademicLookups()
  const { lookups } = data
  const { session } = useAuth()
  const tutoringOn = session?.modules[TUTORING_MODULE] === true
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
  const tutorSessions = useCoreAll(
    'tutorSessions',
    { filters: { dateFrom: range.dateFrom ?? start, dateTo: range.dateTo ?? addDays(start, 6) } },
    { enabled: tutoringOn },
  )
  // Etüt okunamıyorsa (modül/yetki 403, 404) sessizce yalnız ders gösterilir.
  const tutoringError =
    tutorSessions.error && !isUnreadableCollectionError(tutorSessions.error)
      ? tutorSessions.error
      : null
  const tutorings = useMemo(
    () =>
      tutoringOn
        ? scheduleTutorings(
            (tutorSessions.data ?? NO_RECORDS).map((row) => row.record),
            lookups,
            audience,
            studentId,
          )
        : [],
    [tutoringOn, tutorSessions.data, lookups, audience, studentId],
  )
  const days = viewDays('hafta', start)
  const byDay = useMemo(
    () =>
      scheduleByDay(
        [
          ...(lessons.data ?? []).map((lesson) => scheduleLesson(lesson, lookups, audience)),
          ...tutorings,
        ],
        viewDays('hafta', start),
      ),
    [lessons.data, lookups, audience, start, tutorings],
  )
  const panel = useDetailPanel('ders')
  const tutorPanel = useDetailPanel('etut')

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

  const loading =
    lessons.isPending || data.pending || (tutoringOn && tutorSessions.isPending && !tutoringError)
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
            onOpen={(id, kind) => (kind === 'tutoring' ? tutorPanel.open(id) : panel.open(id))}
            label="Haftalık ders programı"
          />
        )}
        {tutoringError ? (
          <div role="alert" className="border-t p-4">
            <QueryError error={tutoringError} onRetry={() => void tutorSessions.refetch()} />
          </div>
        ) : null}
      </section>
      <LessonPanel lessonId={panel.selectedId} lookups={lookups} onClose={panel.close} />
      <ScheduleTutorPanel
        selectedId={tutorPanel.selectedId}
        entries={tutorings}
        onClose={tutorPanel.close}
      />
    </>
  )
}
