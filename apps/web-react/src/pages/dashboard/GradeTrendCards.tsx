import { lazy, Suspense, useMemo } from 'react'
import type { CollectionCountsQuery } from '@kampus/react-shared/collections.ts'
import { useCoreAll, useCoreCounts } from '@/hooks/use-core-collection.ts'
import { ListCard, type CardState } from './DashboardParts.tsx'
import { defineCard, type DashboardCardContext } from './dashboard-cards-model.ts'
import {
  gradeTrendSummary,
  hasGradeTrend,
  monthlyGradePoints,
  MIN_TREND_MONTHS,
} from './dashboard-grade-trend-model.ts'
import { dashboardHref } from './dashboard-model.ts'
import { linkFor, type StudentContext } from './StudentCards.tsx'

// recharts yalnız grafik çizileceği anda ayrı parça olarak yüklenir (ADR 0002).
const TrendBars = lazy(() => import('./TrendBars.tsx'))

type Props = {
  title: string
  description: string
  /** Metin özetinin öznesi ("Not ortalaması", "Sınıflarınızın branş ortalaması"). */
  subject: string
  /** Aylık sayım sorgusu; `null` iken (özne henüz bilinmiyor) istek atılmaz. */
  filters: CollectionCountsQuery['filters'] | null
  state: CardState
  action: { label: string; href: string }
}

/**
 * Aylık not ortalaması eğilimi: notlar listesinin aylık sayımı (`GET /collections/grades/counts`,
 * `groupBy=date:month&sum=score`); ay başına ortalama sunucudaki toplamdan hesaplanır, not satırı
 * çekilmez ve rol kapsamı sunucudadır. İki aydan az veri varsa grafik yerine kısa metin gösterilir.
 * Grafik ekran okuyucudan gizlidir; bilgi yanındaki metin özetindedir.
 */
function GradeTrendCard({ title, description, subject, filters, state, action }: Props) {
  const counts = useCoreCounts(
    'grades',
    { groupBy: 'date:month', sum: 'score', ...(filters ? { filters } : {}) },
    { enabled: filters !== null },
  )
  const points = useMemo(() => monthlyGradePoints(counts.data?.groups ?? []), [counts.data])
  const combined: CardState = {
    isPending: state.isPending || counts.isPending,
    error: state.error ?? counts.error,
    retry: () => {
      state.retry()
      if (counts.error) void counts.refetch()
    },
  }
  return (
    <ListCard
      title={title}
      description={description}
      action={action}
      state={combined}
      isEmpty={!hasGradeTrend(points)}
      emptyText={`Eğilim için en az ${MIN_TREND_MONTHS} ayın notu gerekir.`}
    >
      <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]">
        <Suspense
          fallback={
            <div role="status" className="h-40 text-sm text-muted-foreground">
              Grafik yükleniyor…
            </div>
          }
        >
          <TrendBars points={points} />
        </Suspense>
        <p className="text-sm text-muted-foreground">{gradeTrendSummary(points, subject)}</p>
      </div>
    </ListCard>
  )
}

/**
 * Öğrenci ve veli: seçili öğrencinin notları. Öğrencide sunucu kendi kaydını, velide seçili çocuk
 * (`?cocuk=`, özet de ona göredir) kapsamı belirler; `studentId` süzgeci yalnız çocuğu seçer.
 */
function LearnerGradeTrend({ ctx }: { ctx: StudentContext }) {
  const { data } = ctx
  return (
    <GradeTrendCard
      title="Not ortalaması eğilimi"
      description="Aylık not ortalaması"
      subject="Not ortalaması"
      filters={data ? { studentId: data.student.id } : null}
      state={ctx.state}
      action={{
        label: 'Notları aç',
        href: data ? linkFor(ctx, data)('notlarim', 'notlar') : '',
      }}
    />
  )
}

/**
 * Öğretmen: sınıflarındaki öğrencilerin kendi branşındaki notları. Sınıf ve öğrenci kapsamı
 * sunucudadır (öğretmen yalnız ders verdiği ve danışmanı olduğu sınıfların notlarını okur); ders
 * süzgeci öğretmenin branşıdır, rehber olduğu sınıfta başka derslerin notları ortalamaya girmez.
 */
function TeacherGradeTrend({ ctx }: { ctx: DashboardCardContext }) {
  const teachers = useCoreAll('teachers')
  const subjectId = teachers.data?.[0]?.record.subjectId
  const state: CardState = {
    isPending: ctx.state.isPending || teachers.isPending,
    error: ctx.state.error ?? teachers.error,
    retry: () => {
      ctx.state.retry()
      if (teachers.error) void teachers.refetch()
    },
  }
  return (
    <GradeTrendCard
      title="Sınıf branş ortalaması"
      description="Sınıflarınızdaki öğrencilerin branşınızdaki aylık not ortalaması"
      subject="Sınıflarınızın branş ortalaması"
      filters={teachers.data ? (subjectId ? { subjectId } : {}) : null}
      state={state}
      action={{ label: 'Sınıf analizini aç', href: dashboardHref(ctx.role, 'sinif-analizi') }}
    />
  )
}

export const GRADE_TREND_CARDS = [
  defineCard({
    id: 'ogrenci.not-egilimi',
    roles: ['ogrenci', 'veli'],
    module: 'academic',
    section: (data) => data.academic,
    area: 'main',
    order: 220,
    component: LearnerGradeTrend,
  }),
  defineCard({
    id: 'ogretmen.sinif-brans-ortalamasi',
    roles: ['ogretmen'],
    module: 'academic',
    section: (data) => data.academic,
    area: 'main',
    order: 220,
    component: TeacherGradeTrend,
  }),
]
