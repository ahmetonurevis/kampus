import { lazy, Suspense, useCallback, useMemo } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { money, number } from '@kampus/school-core/lib/format.ts'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { keptHistoryState } from '@/lib/history-state.ts'
import { ListCard, type CardState } from './DashboardParts.tsx'
import {
  collectionWindow,
  COLLECTION_PERIODS,
  DEFAULT_PERIOD,
  periodLabel,
  periodValue,
  PERIOD_PARAM,
  type CollectionPeriod,
  type MonthlyCollection,
} from './dashboard-filter-model.ts'
import { hasTrendData, monthlyPoints } from './dashboard-model.ts'

// recharts yalnız grafik çizileceği anda ayrı parça olarak yüklenir (ADR 0002).
const TrendBars = lazy(() => import('./TrendBars.tsx'))

type Props = {
  /** Özetin aylık tahsilatı; yanıt gelene kadar yok. */
  monthly: MonthlyCollection | undefined
  state: CardState
  /** Taksit sayfasına derin bağlantı. */
  href: string
}

/** Tahsilat dönemi seçici (Vue "Grafik dönemi"): seçim adreste (`?donem=`) tutulur. */
function PeriodSelect({
  period,
  onChange,
}: {
  period: CollectionPeriod
  onChange: (period: CollectionPeriod) => void
}) {
  return (
    <NativeSelect
      aria-label="Grafik dönemi"
      value={String(period)}
      onChange={(event) => onChange(periodValue(event.target.value))}
      className="min-h-9 text-sm"
    >
      {COLLECTION_PERIODS.map((value) => (
        <NativeSelectOption key={value} value={String(value)}>
          {periodLabel(value)}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  )
}

/**
 * Seçili dönemin (son 6 ya da 12 ay) aylık tahsilatı. Sunucu `invoices`'ı `paidAt` gününe göre
 * süzer ve `paidAt:month` ile Europe/Istanbul ayına gruplar; ödenmemiş taksit hiçbir aya girmez.
 * Sunucu 12 aylık seri döndürür, dönem seçimi seriyi keser (yeni istek yok). Kayıt yoksa grafik
 * çizilmez; grafik yalnız görsel destektir, bilgi metin özetindedir.
 */
export function CollectionTrend({ monthly, state, href }: Props) {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const period = periodValue(params.get(PERIOD_PARAM))
  const setPeriod = useCallback(
    (value: CollectionPeriod) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          if (value === DEFAULT_PERIOD) next.delete(PERIOD_PARAM)
          else next.set(PERIOD_PARAM, String(value))
          return next
        },
        { replace: true, preventScrollReset: true, state: keptHistoryState(location.state) },
      ),
    [setParams, location.state],
  )
  const span = useMemo(
    () => (monthly ? collectionWindow(monthly, period) : null),
    [monthly, period],
  )
  const months = period
  const points = useMemo(() => (span ? monthlyPoints(span.months) : []), [span])
  const peak = points.reduce((best, point) => (point.value > best.value ? point : best), {
    label: '',
    value: 0,
  })
  const summary = span
    ? `Son ${months} ayda ${number(span.count)} taksitte toplam ${money(span.amount)} tahsil edildi. ` +
      `En yüksek ay: ${peak.label} (${money(peak.value)}).`
    : ''

  return (
    <ListCard
      title="Aylık tahsilat"
      description={`Son ${months} ay, ödeme tarihine göre`}
      action={{ label: 'Finansı aç', href }}
      headerExtra={<PeriodSelect period={period} onChange={setPeriod} />}
      state={state}
      isEmpty={!hasTrendData(points)}
      emptyText={`Son ${months} ayda tahsilat kaydı yok.`}
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
