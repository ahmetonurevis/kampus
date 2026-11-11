// Analiz ekranlarının ortak parçaları: eğilim grafiği ve puan çubuğu listesi.
import { lazy, Suspense } from 'react'
import { ShareBar } from '../dashboard/DashboardParts.tsx'
import type { TrendPoint } from '../dashboard/dashboard-model.ts'
import { topicHint } from './exam-analysis-model.ts'

// recharts yalnız grafik çizileceği anda ayrı parça olarak yüklenir (ADR 0002).
const TrendBars = lazy(() => import('../dashboard/TrendBars.tsx'))

/**
 * Eğilim grafiği ve metin özeti. Grafik ekran okuyucudan gizlidir; bilgi yanındaki metindedir.
 * Çağıran en az bir nokta olduğunu doğrular (kayıt yoksa grafik yerine boş durum gösterilir).
 */
export function TrendChart({ points, unit }: { points: readonly TrendPoint[]; unit: string }) {
  const first = points[0]
  const last = points.at(-1)
  return (
    <div className="grid gap-3">
      <Suspense
        fallback={
          <div role="status" className="h-40 text-sm text-muted-foreground">
            Grafik yükleniyor…
          </div>
        }
      >
        <TrendBars points={points} />
      </Suspense>
      {first && last ? (
        <p className="text-sm text-muted-foreground">
          {points.length === 1
            ? `${first.label}: ${first.value} ${unit}.`
            : `${first.label}: ${first.value} ${unit}; ${last.label}: ${last.value} ${unit}.`}
        </p>
      ) : null}
    </div>
  )
}

/** Ders veya konu başına 100 üzerinden puan çubukları; 65 altı dikkat rengidir (işletme göstergesi). */
export function ScoreBars({
  label,
  items,
  hints = false,
}: {
  label: string
  items: readonly { key: string; name: string; score: number; text?: string }[]
  /** Çubuğun altına "Güçlü alan / Tekrar önerilir" gibi kısa not yazar. */
  hints?: boolean
}) {
  return (
    <ul aria-label={label} className="grid gap-4">
      {items.map((item) => (
        <li key={item.key} className="grid gap-1.5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <strong className="min-w-0 font-medium [overflow-wrap:anywhere]">{item.name}</strong>
            <span className="tabular-nums text-muted-foreground">
              {item.text ?? `${item.score}/100`}
            </span>
          </div>
          <ShareBar value={item.score} tone={item.score < 65 ? 'warning' : 'primary'} />
          {hints ? (
            <small className="text-xs text-muted-foreground">{topicHint(item.score)}</small>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
