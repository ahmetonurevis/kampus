import { Line, LineChart, ResponsiveContainer } from 'recharts'
import type { TrendPoint } from './dashboard-model.ts'

/**
 * Sayaç kartı mini grafiği (recharts, eksensiz çizgi). Renk `app.css` `.sparkline` kuralıyla
 * `--chart-bar` değişkeninden gelir; animasyon yok. Grafik ekran okuyucudan gizlidir, aynı bilgi
 * çağıranın `role="img"` etiketindedir.
 */
export default function Sparkline({ points }: { points: readonly TrendPoint[] }) {
  return (
    <div aria-hidden="true" className="sparkline h-8 min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={[...points]} margin={{ top: 4, right: 2, bottom: 4, left: 2 }}>
          <Line
            type="monotone"
            dataKey="value"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
