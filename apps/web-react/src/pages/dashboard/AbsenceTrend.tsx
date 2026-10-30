import { lazy, Suspense, useMemo } from 'react'
import type { components } from '@kampus/api-client/schema.d.ts'
import { ListCard, type CardState } from './DashboardParts.tsx'
import { hasTrendData, trendSummary, weeklyPoints } from './dashboard-model.ts'

// recharts yalnız grafik çizileceği anda ayrı parça olarak yüklenir (ADR 0002).
const TrendBars = lazy(() => import('./TrendBars.tsx'))

const UNIT = 'gün devamsızlık'

type Weeks = NonNullable<components['schemas']['DashboardStudent']['academic']>['weeklyAbsences']

type Props = {
  /** Özetin haftalık devamsızlığı; yanıt gelene kadar yok. */
  weeks: Weeks | undefined
  state: CardState
  /** Devamsızlık sayfasına derin bağlantı. */
  href: string
}

/**
 * Son 8 haftanın devamsızlık eğilimi. Her hafta sunucuda gün aralığıyla sayılır (yoklama satırları
 * istemciye çekilmez). Kayıt yoksa grafik çizilmez; grafik yalnız görsel destektir, bilgi yanındaki
 * metin özetindedir.
 */
export function AbsenceTrend({ weeks, state, href }: Props) {
  const count = weeks?.length ?? 8
  const points = useMemo(() => (weeks ? weeklyPoints(weeks) : []), [weeks])
  const summary = trendSummary(points, UNIT)

  return (
    <ListCard
      title="Haftalık devamsızlık"
      description={`Son ${count} hafta`}
      action={{ label: 'Devamsızlığı aç', href }}
      state={state}
      isEmpty={!hasTrendData(points)}
      emptyText={`Son ${count} haftada devamsızlık kaydı yok.`}
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
