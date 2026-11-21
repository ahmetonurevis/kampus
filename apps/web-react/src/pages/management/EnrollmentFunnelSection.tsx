import { useMemo, useState } from 'react'
import { useEnrollmentFunnel } from '@kampus/react-shared/enrollment-funnel.ts'
import { funnelStepLabel } from '@kampus/school-core/lib/enrollment-funnel.ts'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { combineStates, ListCard } from '../dashboard/DashboardParts.tsx'
import { counselorRows, rateLabel, type CounselorRow } from './enrollment-report-rows.ts'

const COUNSELOR_COLUMNS: readonly { key: keyof Omit<CounselorRow, 'id'>; label: string }[] = [
  { key: 'counselor', label: 'Danışman' },
  { key: 'prospects', label: 'Aday sayısı' },
  { key: 'enrolled', label: 'Kesin kayıt' },
  { key: 'conversion', label: 'Dönüşüm oranı' },
]
const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Dönem hunisi (ON-052; `GET /prospects/funnel`, DOM-KAY-040, IST-117): seçilen günlerde açılan
 * adayların aday → görüşme → (dil okulunda deneme dersi) → kesin kayıt yolculuğu. Adımlar
 * birikimlidir (ileri adıma ulaşan önceki adımı geçmiş sayılır); oranlar önceki adıma göredir ve
 * sunucudan gelir. Danışman, adayı açan personeldir. Aralık boşsa bütün adaylar sayılır; bitiş
 * başlangıçtan önceyse istek gönderilmez, alan uyarır.
 */
export function EnrollmentFunnelSection() {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const reversed = DAY.test(dateFrom) && DAY.test(dateTo) && dateTo < dateFrom
  const range = {
    ...(DAY.test(dateFrom) ? { dateFrom } : {}),
    ...(DAY.test(dateTo) ? { dateTo } : {}),
  }
  const funnel = useEnrollmentFunnel(range, { enabled: !reversed })
  const data = funnel.data?.data
  const counselors = useMemo(() => (data ? counselorRows(data.byCounselor) : []), [data])
  const total = data?.total

  return (
    <ListCard
      className="mb-6"
      title="Dönem hunisi"
      description="Seçilen günlerde açılan adayların kesin kayda yolculuğu"
      state={combineStates(funnel)}
      isEmpty={total !== undefined && total.prospects === 0}
      emptyText="Bu aralıkta açılmış aday yok."
      headerExtra={
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <Label htmlFor="huni-baslangic">Başlangıç</Label>
            <Input
              id="huni-baslangic"
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="huni-bitis">Bitiş</Label>
            <Input
              id="huni-bitis"
              type="date"
              value={dateTo}
              aria-invalid={reversed || undefined}
              aria-describedby={reversed ? 'huni-bitis-hata' : undefined}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </div>
          {reversed ? (
            <p id="huni-bitis-hata" role="alert" className="text-sm text-destructive">
              Bitiş günü başlangıç gününden önce olamaz.
            </p>
          ) : null}
        </div>
      }
    >
      {data && total ? (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            Açılan aday: {total.prospects} · kesin kayda dönüşüm {rateLabel(total.conversionRate)}
          </p>
          <ol
            aria-label="Dönem hunisi adımları"
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            {total.steps.map((step) => (
              <li key={step.step} className="grid gap-1 rounded-card border bg-surface-soft p-4">
                <strong className="text-stat font-semibold tabular-nums">{step.count}</strong>
                <span className="text-sm">{funnelStepLabel(step.step, data.institutionType)}</span>
                <span className="text-xs text-muted-foreground">
                  {step.rate === null ? 'Başlangıç' : `Önceki adımın ${rateLabel(step.rate)}`}
                </span>
              </li>
            ))}
          </ol>
          <h3 className="mt-6 mb-2 font-semibold">Danışman bazlı dönüşüm</h3>
          {/* Danışman sayısı azdır; arama ve sayfalama gerekmez, sayfadaki kanal tablosunun
              aramasıyla da karışmaz. */}
          {counselors.length === 0 ? (
            <p className="text-sm text-muted-foreground">Bu aralıkta danışmana bağlı aday yok.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Danışman bazlı dönüşüm</caption>
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    {COUNSELOR_COLUMNS.map((column) => (
                      <th key={column.key} scope="col" className="py-2 pr-4 font-medium">
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {counselors.map((row) => (
                    <tr key={row.id} className="border-b last:border-0">
                      {COUNSELOR_COLUMNS.map((column) => (
                        <td key={column.key} className="py-2 pr-4 tabular-nums">
                          {row[column.key]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </ListCard>
  )
}
