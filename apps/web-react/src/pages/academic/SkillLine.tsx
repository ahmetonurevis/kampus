import { CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import type { TrendPoint } from '../dashboard/dashboard-model.ts'

/**
 * Tek becerinin puan çizgisi (recharts; OG-080, DOM-BEC-035). Dikey eksen 0–100 sabittir, böylece
 * dört küçük grafik birbiriyle karşılaştırılabilir. Renkler `app.css` `.skill-line` kurallarıyla
 * `--chart-*` değişkenlerinden gelir; animasyon yok. Grafik ekran okuyucudan gizlidir, aynı bilgi
 * çağıranın özet metninde ve satır listesindedir.
 */
export default function SkillLine({ points }: { points: readonly TrendPoint[] }) {
  return (
    <div aria-hidden="true" className="skill-line h-28 min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={[...points]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} interval="preserveStartEnd" fontSize={11} />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 50, 100]}
            tickLine={false}
            axisLine={false}
            width={28}
            fontSize={11}
          />
          <Line
            type="monotone"
            dataKey="value"
            strokeWidth={2}
            dot={{ r: 3 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
