import { dateLabel, homeworkStatus, number } from '@kampus/school-core/lib/format.ts'
import type { DashboardOf } from '@kampus/react-shared/dashboard.ts'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { scoreText, scoreTone } from '../academic/academic-rows.ts'
import { AbsenceTrend } from './AbsenceTrend.tsx'
import { useGradeSpark } from './use-grade-spark.ts'
import { CardList, ListCard, ShareBar, StatCard } from './DashboardParts.tsx'
import { defineCard, type DashboardCardContext } from './dashboard-cards-model.ts'
import { sparkLabel } from './dashboard-filter-model.ts'
import {
  attendanceSummary,
  dashboardHref,
  overallAverage,
  subjectAverageRows,
} from './dashboard-model.ts'

export type Summary = DashboardOf<'ogrenci'> | DashboardOf<'veli'>
export type StudentContext = DashboardCardContext<Summary>

/**
 * Öğrenci ve veli bağlantısı: velide çocuk sekmesi `akademik-takip` sayfasında, öğrencide kendi
 * sayfasındadır. Çocuk adreste `?cocuk=` olarak taşınır.
 */
export function linkFor(ctx: StudentContext, data: Summary) {
  const parent = data.role === 'veli'
  const child = parent ? data.student.id : ''
  return (studentPath: string, tab: string, params: Record<string, string> = {}) =>
    parent
      ? dashboardHref(ctx.role, 'akademik-takip', { sekme: tab }, child)
      : dashboardHref(ctx.role, studentPath, params)
}

/**
 * Öğrenci ve veli Genel Bakışı (Vue `Dashboard.vue` öğrenci/veli): not ortalaması, devamsızlık,
 * ödev teslimi; yaklaşan ödevler, ders ortalamaları ve son notlar. Velide özet seçili çocuğa
 * göredir. Öğrencinin özetinde ödeme alanı yoktur; veli bakiyesi
 * `pages/finance/FinanceDashboardCards.tsx` dosyasındadır (Onur).
 * Sayfa özet gelmeden kartları çizmez, bu yüzden `data` her zaman doludur.
 */
function OverallAverageCard({ ctx }: { ctx: StudentContext }) {
  const { data } = ctx
  const points = useGradeSpark(data?.student.id)
  if (!data?.academic) return null
  const average = overallAverage(data.academic.grades)
  return (
    <StatCard
      label="Genel not ortalaması"
      icon="Award"
      value={average === null ? '—' : `${average}/100`}
      note={`${number(data.academic.grades.count)} değerlendirme`}
      href={linkFor(ctx, data)('notlarim', 'notlar')}
      state={ctx.state}
      spark={{
        label: sparkLabel('Aylık not ortalaması', points, (value) => `${value}/100`),
        points,
      }}
    />
  )
}

export const STUDENT_CARDS = [
  defineCard({
    id: 'ogrenci.not-ortalamasi',
    roles: ['ogrenci', 'veli'],
    module: 'academic',
    section: (data) => data.academic,
    area: 'stat',
    order: 10,
    component: OverallAverageCard,
  }),
  defineCard({
    id: 'ogrenci.devamsizlik',
    roles: ['ogrenci', 'veli'],
    module: 'academic',
    section: (data) => data.academic,
    area: 'stat',
    order: 20,
    component: ({ ctx }) => {
      const { data } = ctx
      if (!data?.academic) return null
      const absence = attendanceSummary(data.academic.attendance)
      return (
        <StatCard
          label="Devamsızlık"
          icon="ClipboardCheck"
          value={`${number(absence.absent)} gün`}
          note={`${number(absence.late)} geç kalma · ${number(absence.total)} yoklama`}
          href={linkFor(ctx, data)('devamsizlik', 'devamsizlik', { durum: 'absent' })}
          state={ctx.state}
        />
      )
    },
  }),
  defineCard({
    id: 'ogrenci.teslim-edilen-odev',
    roles: ['ogrenci', 'veli'],
    module: 'learning',
    section: (data) => data.learning,
    area: 'stat',
    order: 30,
    component: ({ ctx }) => {
      const { data } = ctx
      if (!data?.learning) return null
      return (
        <StatCard
          label="Teslim edilen ödev"
          icon="NotebookPen"
          value={`${number(data.learning.submitted)}/${number(data.learning.assigned)}`}
          note="Sınıfa verilen ödevlerden"
          href={linkFor(ctx, data)('odevler', 'odevler')}
          state={ctx.state}
        />
      )
    },
  }),
  defineCard({
    id: 'ogrenci.yaklasan-odevler',
    roles: ['ogrenci', 'veli'],
    module: 'learning',
    section: (data) => data.learning,
    area: 'main',
    order: 100,
    component: ({ ctx }) => {
      const { data } = ctx
      if (!data?.learning) return null
      const upcoming = data.learning.homework
      const studentId = data.student.id
      // Ödev durumu core `homeworkStatus` ile: teslim ve puan sunucudan, son teslim isteğin anına göre.
      const submissions = upcoming.flatMap((item) =>
        item.submission ? [{ homeworkId: item.id, studentId, score: item.submission.score }] : [],
      )
      return (
        <ListCard
          title="Yaklaşan ödevler"
          description="Son teslim tarihi gelmemiş ödevler"
          action={{ label: 'Ödevleri aç', href: linkFor(ctx, data)('odevler', 'odevler') }}
          state={ctx.state}
          isEmpty={upcoming.length === 0}
          emptyText="Teslim süresi devam eden ödev yok."
        >
          <CardList label="Yaklaşan ödevler">
            {upcoming.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0"
              >
                <span className="grid min-w-0">
                  <strong className="font-medium [overflow-wrap:anywhere]">{item.title}</strong>
                  <small className="text-sm text-muted-foreground">
                    Son teslim · {dateLabel(item.dueDate, { weekday: 'long' })}
                  </small>
                </span>
                <StatusBadge text={homeworkStatus(item, submissions, studentId, ctx.now)} />
              </li>
            ))}
          </CardList>
        </ListCard>
      )
    },
  }),
  defineCard({
    id: 'ogrenci.ders-ortalamalari',
    roles: ['ogrenci', 'veli'],
    module: 'academic',
    section: (data) => data.academic,
    area: 'side',
    order: 110,
    component: ({ ctx }) => {
      const { data } = ctx
      if (!data?.academic) return null
      const averages = subjectAverageRows(data.academic.grades)
      return (
        <ListCard
          title="Ders ortalamaları"
          description="Bütün değerlendirmelerden"
          action={{ label: 'Notları aç', href: linkFor(ctx, data)('notlarim', 'notlar') }}
          state={ctx.state}
          isEmpty={averages.length === 0}
          emptyText="Henüz not girilmedi."
        >
          <CardList label="Ders ortalamaları">
            {averages.map((row) => (
              <li key={row.subjectId} className="grid gap-1.5 py-2 first:pt-0 last:pb-0">
                <span className="flex items-center justify-between gap-3">
                  <span className="[overflow-wrap:anywhere]">{row.name}</span>
                  <strong className="font-semibold tabular-nums">{row.average}</strong>
                </span>
                <ShareBar
                  value={row.average}
                  tone={scoreTone(row.average) === 'amber' ? 'warning' : 'success'}
                />
              </li>
            ))}
          </CardList>
        </ListCard>
      )
    },
  }),
  defineCard({
    id: 'ogrenci.devamsizlik-egilimi',
    roles: ['ogrenci', 'veli'],
    module: 'academic',
    section: (data) => data.academic,
    area: 'main',
    order: 200,
    component: ({ ctx }) => {
      const { data } = ctx
      if (!data?.academic) return null
      return (
        <AbsenceTrend
          weeks={data.academic.weeklyAbsences}
          state={ctx.state}
          href={linkFor(ctx, data)('devamsizlik', 'devamsizlik', { durum: 'absent' })}
        />
      )
    },
  }),
  defineCard({
    id: 'ogrenci.son-notlar',
    roles: ['ogrenci', 'veli'],
    module: 'academic',
    section: (data) => data.academic,
    area: 'side',
    order: 210,
    component: ({ ctx }) => {
      const { data } = ctx
      if (!data?.academic) return null
      const { recentGrades } = data.academic
      return (
        <ListCard
          title="Son notlar"
          description="En son girilen değerlendirmeler"
          action={{ label: 'Tümünü gör', href: linkFor(ctx, data)('notlarim', 'notlar') }}
          state={ctx.state}
          isEmpty={recentGrades.length === 0}
          emptyText="Henüz not girilmedi."
        >
          <CardList label="Son notlar">
            {recentGrades.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0"
              >
                <span className="grid min-w-0">
                  <strong className="font-medium [overflow-wrap:anywhere]">{row.title}</strong>
                  <small className="text-sm text-muted-foreground">
                    {dateLabel(row.date, { year: 'numeric' })}
                  </small>
                </span>
                {row.score === undefined ? null : (
                  <StatusBadge text={scoreText(row.score)} tone={scoreTone(row.score)} />
                )}
              </li>
            ))}
          </CardList>
        </ListCard>
      )
    },
  }),
]
