import { lazy, Suspense, useMemo } from 'react'
import { dayKey, money, number } from '@kampus/school-core/lib/format.ts'
import { useCoreCounts } from '@/hooks/use-core-collection.ts'
import { combineStates, ListCard } from './DashboardParts.tsx'
import { hasTrendData, monthlyPoints, monthRangeStart, monthSlices } from './dashboard-model.ts'

// recharts yalnız grafik çizileceği anda ayrı parça olarak yüklenir (ADR 0002).
const TrendBars = lazy(() => import('./TrendBars.tsx'))

const MONTHS = 6

type Props = {
  now: Date
  /** Taksit sayfasına derin bağlantı. */
  href: string
}

/**
 * Son 6 ayın aylık tahsilatı. Sunucu `invoices` için `paidAt` gününe göre süzer ve `paidAt:month`
 * ile Europe/Istanbul ayına gruplar; ödenmemiş taksit hiçbir aya girmez. Satır çekilmez. Kayıt
 * yoksa grafik çizilmez; grafik yalnız görsel destektir, bilgi metin özetindedir.
 */
export function CollectionTrend({ now, href }: Props) {
  const today = dayKey(now)
  const slices = useMemo(() => monthSlices(today, MONTHS), [today])
  const counts = useCoreCounts('invoices', {
    groupBy: 'paidAt:month',
    sum: 'amount',
    filters: { dateField: 'paidAt', dateFrom: monthRangeStart(slices), dateTo: today },
  })
  const points = useMemo(
    () => (counts.data ? monthlyPoints(slices, counts.data, 'sum') : []),
    [counts.data, slices],
  )
  const peak = points.reduce((best, point) => (point.value > best.value ? point : best), {
    label: '',
    value: 0,
  })
  const summary = counts.data
    ? `Son ${MONTHS} ayda ${number(counts.data.total)} taksitte toplam ${money(counts.data.sum)} tahsil edildi. ` +
      `En yüksek ay: ${peak.label} (${money(peak.value)}).`
    : ''

  return (
    <ListCard
      title="Aylık tahsilat"
      description={`Son ${MONTHS} ay, ödeme tarihine göre`}
      action={{ label: 'Finansı aç', href }}
      state={combineStates(counts)}
      isEmpty={!hasTrendData(points)}
      emptyText={`Son ${MONTHS} ayda tahsilat kaydı yok.`}
    >
      <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]">
        <Suspense
          fallback={
            <div role="status" className="h-40 text-sm text-muted-foreground">
              Grafik yükleniyor…
            </div>
          }
        >
          <TrendBars points={points} formatTick={(value) => number(Math.round(value / 100))} />
        </Suspense>
        <p className="text-sm text-muted-foreground">{summary}</p>
      </div>
    </ListCard>
  )
}
