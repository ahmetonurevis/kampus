import { useId } from 'react'
import { SUBSKILLS } from '@kampus/school-core/content/taxonomy.ts'
import type { TaskAttemptSubskillScore } from '@kampus/react-shared/use-task-attempts.ts'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type Props = { subskills: readonly TaskAttemptSubskillScore[] | null }

/** Puan gösterimi: tamsayıysa ondalıksız, değilse iki ondalık (sunucu iki ondalığa yuvarlar). */
const points = (value: number) =>
  value.toLocaleString('tr-TR', { maximumFractionDigits: 2, minimumFractionDigits: 0 })

/**
 * Alt beceri dökümü (IST-042, DOM-BEC-006): her satır sunucunun madde puanlarından hesapladığı
 * gerçek veridir (yüzde, kazanılan / olası puan, madde sayısı). Döküm madde sonuçlarıyla aynı anda
 * açılır (DOM-BEC-045); sunucu `null` döndürdüyse bileşen hiçbir şey çizmez ve nedenine dair ipucu
 * vermez. Kursiyer sonucu ve personelin deneme görünümü aynı bileşeni kullanır.
 */
export function SubskillBreakdown({ subskills }: Props) {
  const headingId = useId()
  if (!subskills || subskills.length === 0) return null
  return (
    <section aria-labelledby={headingId} className="grid gap-2">
      <h4 id={headingId} className="text-sm font-semibold">
        Alt beceri dökümü
      </h4>
      <div className="overflow-hidden rounded-card border">
        <Table aria-labelledby={headingId}>
          <TableHeader>
            <TableRow>
              <TableHead>Alt beceri</TableHead>
              <TableHead className="text-right">Madde</TableHead>
              <TableHead className="text-right">Puan</TableHead>
              <TableHead className="w-[40%] max-[650px]:w-auto">Başarı</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {subskills.map((row) => (
              <TableRow key={row.subskill}>
                <TableCell className="font-medium">{SUBSKILLS[row.subskill].label}</TableCell>
                <TableCell className="text-right tabular-nums">{row.items}</TableCell>
                <TableCell className="text-right whitespace-nowrap tabular-nums">
                  {points(row.earned)} / {points(row.possible)}
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="h-2 min-w-12 flex-1 overflow-hidden rounded-full bg-surface-soft max-[650px]:hidden"
                    >
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${Math.min(100, Math.max(0, row.percent))}%` }}
                      />
                    </span>
                    <span className="w-12 text-right tabular-nums">%{row.percent}</span>
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}
