import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import type { TrendPoint } from './dashboard-model.ts'

/**
 * Haftalık/aylık sayım çubukları (recharts). Renkler `tokens.css`'teki `--chart-*` değişkenlerinden
 * `app.css` `.trend-bars` kurallarıyla gelir; animasyon yok. Grafik ekran okuyucudan gizlidir,
 * aynı bilgi çağıranın metin özetindedir.
 */
export default function TrendBars({
  points,
  formatTick,
}: {
  points: readonly TrendPoint[]
  /** Eksen değer biçimi (ör. tutar); verilmezse tam sayı sayımdır. */
  formatTick?: (value: number) => string
}) {
  return (
    <div aria-hidden="true" className="trend-bars h-40 min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={[...points]} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} interval="preserveStartEnd" fontSize={11} />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            width={formatTick ? 48 : 24}
            fontSize={11}
            {...(formatTick ? { tickFormatter: formatTick } : {})}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
