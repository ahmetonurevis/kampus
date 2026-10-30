import { lazy, Suspense, useMemo } from 'react'
import { money, number } from '@kampus/school-core/lib/format.ts'
import type { components } from '@kampus/api-client/schema.d.ts'
import { ListCard, type CardState } from './DashboardParts.tsx'
import { hasTrendData, monthlyPoints } from './dashboard-model.ts'

// recharts yalnız grafik çizileceği anda ayrı parça olarak yüklenir (ADR 0002).
const TrendBars = lazy(() => import('./TrendBars.tsx'))

type Monthly = NonNullable<components['schemas']['DashboardAdmin']['finance']>['monthlyCollection']

type Props = {
  /** Özetin aylık tahsilatı; yanıt gelene kadar yok. */
  monthly: Monthly | undefined
  state: CardState
  /** Taksit sayfasına derin bağlantı. */
  href: string
}

/**
 * Son 6 ayın aylık tahsilatı. Sunucu `invoices`'ı `paidAt` gününe göre süzer ve `paidAt:month` ile
 * Europe/Istanbul ayına gruplar; ödenmemiş taksit hiçbir aya girmez. Kayıt yoksa grafik çizilmez;
 * grafik yalnız görsel destektir, bilgi metin özetindedir.
 */
export function CollectionTrend({ monthly, state, href }: Props) {
  const months = monthly?.months.length ?? 6
  const points = useMemo(() => (monthly ? monthlyPoints(monthly.months) : []), [monthly])
  const peak = points.reduce((best, point) => (point.value > best.value ? point : best), {
    label: '',
    value: 0,
  })
  const summary = monthly
    ? `Son ${months} ayda ${number(monthly.count)} taksitte toplam ${money(monthly.amount)} tahsil edildi. ` +
      `En yüksek ay: ${peak.label} (${money(peak.value)}).`
    : ''

  return (
    <ListCard
      title="Aylık tahsilat"
      description={`Son ${months} ay, ödeme tarihine göre`}
      action={{ label: 'Finansı aç', href }}
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
