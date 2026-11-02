import { useMemo } from 'react'
import { Link } from 'react-router'
import { useLessonsInRange } from '@kampus/react-shared/use-lessons.ts'
import { useAllQuizzes } from '@kampus/react-shared/use-quizzes.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { noon } from '../academic/schedule-model.ts'
import { useAcademicLookups } from '../academic/use-academic-lookups.ts'
import { CardList, ListCard } from './DashboardParts.tsx'
import { defineCard } from './dashboard-cards-model.ts'
import { latestQuizResult, todayLessons } from './dashboard-learner-model.ts'
import { dashboardHref } from './dashboard-model.ts'
import { linkFor, type StudentContext } from './StudentCards.tsx'

const NONE: readonly never[] = []

/**
 * Bugünkü ders programı (Vue `Dashboard.vue` "Bugünkü ders programı"): haftalık programın
 * kaynağıyla aynı uç (`GET /lessons`, tek gün; kapsamı sunucu uygular) ve aynı satır görünümü.
 * Öğrencide sunucu sınıfı kendisi daraltır; velide seçili çocuğun sınıfı istek süzgecidir (çocuk
 * `?cocuk=` ile seçilir, özet de ona göredir). "Bugün" sunucunun Europe/Istanbul günüdür
 * (`today`); iptal ders görünmez.
 */
function TodayScheduleCard({ ctx }: { ctx: StudentContext }) {
  const { data } = ctx
  const parent = data?.role === 'veli'
  const studentId = data?.student.id ?? ''
  const today = data?.today ?? ''
  const academic = useAcademicLookups()
  const classId = parent ? academic.lookups.students.get(studentId)?.classId : undefined
  // Velide çocuğun sınıfı bilinmeden istek atılmaz; sınıfı olmayan çocuğun programı yoktur.
  const ready = data !== null && !academic.pending && (!parent || classId !== undefined)
  const lessons = useLessonsInRange(
    { dateFrom: today, dateTo: today, ...(classId ? { classId } : {}) },
    { enabled: ready },
  )
  const rows = useMemo(
    () => todayLessons(lessons.data ?? NONE, academic.lookups, today),
    [lessons.data, academic.lookups, today],
  )
  if (!data) return null
  const state = {
    isPending: academic.pending || (ready && lessons.isPending),
    error: academic.error ?? lessons.error,
    retry: () => {
      academic.retry()
      if (lessons.error) void lessons.refetch()
    },
  }
  return (
    <ListCard
      title="Bugünkü ders programı"
      description={
        dateLabel(noon(today), { weekday: 'long', day: 'numeric', month: 'long' }) +
        (state.isPending || state.error ? '' : ` · ${rows.length} ders`)
      }
      action={{ label: 'Programı aç', href: linkFor(ctx, data)('ders-programi', 'program') }}
      state={state}
      isEmpty={rows.length === 0}
      emptyText="Bugün dersin yok."
    >
      <CardList label="Bugünkü ders programı">
        {rows.map((lesson) => (
          <li key={lesson.id} className="flex items-center gap-4 py-2.5 first:pt-0 last:pb-0">
            <time
              dateTime={lesson.date}
              className="w-12 shrink-0 text-md font-semibold tabular-nums"
            >
              {lesson.time}
            </time>
            <span className="grid min-w-0">
              <strong className="font-medium [overflow-wrap:anywhere]">{lesson.title}</strong>
              <small className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                {lesson.detail} · {lesson.duration} dk
              </small>
            </span>
          </li>
        ))}
      </CardList>
    </ListCard>
  )
}

/**
 * Son quiz sonucu (Vue `Dashboard.vue`): seçili öğrencinin en son tamamlanan denemesi. Quiz listesi
 * Quiz & Testler ekranıyla aynı uçtan (`GET /quizzes`, sınıf süzgeciyle) okunur; puan sunucunun
 * cevaplardan hesapladığı sonuçtur, istemci puan hesaplamaz. Bağlantı sonuç panelini açar
 * (`?quiz=`): öğrencide Quiz & Testler, velide Akademik Takip "Quiz sonuçları" sekmesi.
 */
function LastQuizCard({ ctx }: { ctx: StudentContext }) {
  const { data } = ctx
  const studentId = data?.student.id ?? ''
  const students = useCoreAll('students')
  const classId = students.data?.find((row) => row.record.id === studentId)?.record.classId
  const ready = data !== null && !students.isPending && classId !== undefined
  const quizzes = useAllQuizzes({ ...(classId ? { classId } : {}) }, { enabled: ready })
  const latest = useMemo(
    () => latestQuizResult(quizzes.data ?? NONE, studentId),
    [quizzes.data, studentId],
  )
  if (!data) return null
  const state = {
    isPending: students.isPending || (ready && quizzes.isPending),
    error: students.error ?? quizzes.error,
    retry: () => {
      if (students.error) void students.refetch()
      if (quizzes.error) void quizzes.refetch()
    },
  }
  const quizHref = (quizId = '') =>
    data.role === 'veli'
      ? dashboardHref(ctx.role, 'akademik-takip', { sekme: 'quizler', quiz: quizId }, studentId)
      : dashboardHref(ctx.role, 'soru-coz', { quiz: quizId })
  return (
    <ListCard
      title="Son quiz sonucu"
      description="En son tamamlanan quiz"
      action={{ label: 'Quizleri aç', href: quizHref() }}
      state={state}
      isEmpty={latest === null}
      emptyText="Henüz tamamlanmış quiz yok."
    >
      {latest ? (
        <div className="grid gap-2">
          <Link
            to={quizHref(latest.quizId)}
            className="min-h-6 font-medium [overflow-wrap:anywhere] hover:underline"
          >
            {latest.title}
          </Link>
          <p className="text-2xl font-semibold tabular-nums">
            %{latest.score}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {latest.correctCount}/{latest.total} doğru
            </span>
          </p>
          <p className="text-sm text-muted-foreground">
            {[latest.subject, latest.at ? dateLabel(latest.at, { year: 'numeric' }) : '']
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      ) : null}
    </ListCard>
  )
}

/** Öğrenci ve veli Genel Bakışı'nın ders programı ve quiz kartları. */
export const LEARNER_CARDS = [
  defineCard({
    id: 'ogrenci.bugunku-ders-programi',
    roles: ['ogrenci', 'veli'],
    module: 'academic',
    section: (data) => data.academic,
    area: 'main',
    order: 50,
    component: TodayScheduleCard,
  }),
  defineCard({
    id: 'ogrenci.son-quiz-sonucu',
    roles: ['ogrenci', 'veli'],
    module: 'learning',
    section: (data) => data.learning,
    area: 'side',
    order: 60,
    component: LastQuizCard,
  }),
]
