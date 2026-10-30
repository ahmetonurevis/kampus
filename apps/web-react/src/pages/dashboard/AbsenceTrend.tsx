import { lazy, Suspense, useMemo } from 'react'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { useCoreCountSeries } from '@/hooks/use-core-collection.ts'
import { combineStates, ListCard } from './DashboardParts.tsx'
import { hasTrendData, trendSummary, weekSlices, weeklyPoints } from './dashboard-model.ts'

// recharts yalnız grafik çizileceği anda ayrı parça olarak yüklenir (ADR 0002).
const TrendBars = lazy(() => import('./TrendBars.tsx'))

const WEEKS = 8
const UNIT = 'gün devamsızlık'

type Props = {
  studentId: string
  now: Date
  /** Devamsızlık sayfasına derin bağlantı. */
  href: string
}

/**
 * Son 8 haftanın devamsızlık eğilimi. Her hafta sunucuda `dateFrom`/`dateTo` ile sayılır
 * (yoklama satırları istemciye çekilmez). Kayıt yoksa grafik çizilmez; grafik yalnız görsel
 * destektir, bilgi yanındaki metin özetindedir.
 */
export function AbsenceTrend({ studentId, now, href }: Props) {
  const today = dayKey(now)
  const slices = useMemo(() => weekSlices(today, WEEKS), [today])
  const queries = useMemo(
    () =>
      slices.map((slice) => ({
        groupBy: 'status' as const,
        filters: { studentId, dateFrom: slice.from, dateTo: slice.to },
      })),
    [slices, studentId],
  )
  const series = useCoreCountSeries('attendance', queries)
  const points = useMemo(
    () => (series.data ? weeklyPoints(slices, series.data, 'absent') : []),
    [series.data, slices],
  )
  const summary = trendSummary(points, UNIT)

  return (
    <ListCard
      title="Haftalık devamsızlık"
      description={`Son ${WEEKS} hafta`}
      action={{ label: 'Devamsızlığı aç', href }}
      state={combineStates(series)}
      isEmpty={!hasTrendData(points)}
      emptyText={`Son ${WEEKS} haftada devamsızlık kaydı yok.`}
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
        <p className="text-sm text-muted-foreground">{summary}</p>
      </div>
    </ListCard>
  )
}
