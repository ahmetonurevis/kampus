import { useMemo } from 'react'
import { useProspectLossBreakdown } from '@kampus/react-shared/use-prospect-reports.ts'
import { combineStates, ListCard, ShareBar } from '../dashboard/DashboardParts.tsx'
import { lossInstitutionRows, lossReasonRows, type LossRow } from './enrollment-loss-rows.ts'

/**
 * Kayıt Raporları "Kayıp aday analizi" (IST-117, DOM-KAY-005): vazgeçen adayların nedeni ve tercih
 * ettiği kurum. Satır çekilmez, sunucu kırılımından gelir; kurum adı serbest metindir.
 */
export function EnrollmentLossBreakdown() {
  const query = useProspectLossBreakdown()
  const breakdown = query.data?.data
  const reasons = useMemo(() => (breakdown ? lossReasonRows(breakdown) : []), [breakdown])
  const institutions = useMemo(() => (breakdown ? lossInstitutionRows(breakdown) : []), [breakdown])

  return (
    <ListCard
      className="mt-6"
      title="Kayıp aday analizi"
      description={`Vazgeçen: ${breakdown?.total ?? 0} · Neden ve tercih edilen kurum`}
      state={combineStates(query)}
      isEmpty={(breakdown?.total ?? 0) === 0}
      emptyText="Henüz vazgeçen aday yok."
    >
      <div className="grid gap-6 md:grid-cols-2">
        <LossList title="Vazgeçme nedenleri" rows={reasons} />
        <LossList title="Tercih edilen kurumlar" rows={institutions} />
      </div>
    </ListCard>
  )
}

function LossList({ title, rows }: { title: string; rows: readonly LossRow[] }) {
  return (
    <div className="min-w-0">
      <h3 className="mb-3 text-base font-semibold">{title}</h3>
      <ul aria-label={title} className="grid gap-3">
        {rows.map((row) => (
          <li key={row.label} className="grid gap-1.5 text-sm">
            <span className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 [overflow-wrap:anywhere]">{row.label}</span>
              <span className="shrink-0 tabular-nums">
                <strong className="font-semibold">{row.count}</strong>
                <span className="text-muted-foreground"> · %{row.share}</span>
              </span>
            </span>
            <ShareBar value={row.share} />
          </li>
        ))}
      </ul>
    </div>
  )
}
