import { useState } from 'react'
import {
  useStaffCosts,
  useStaffCostsExport,
  type StaffCostQuery,
  type StaffCostReport,
} from '@kampus/react-shared/use-finance-staff-costs.ts'
import {
  STAFF_COST_FLAG_LABELS,
  staffCostNotes,
} from '@kampus/school-core/lib/finance-staff-cost-report.ts'
import {
  monthOf,
  monthRangeLabel,
  shareLabel,
  staffCostMonthSchema,
  staffCostRangeIssue,
} from '@kampus/school-core/lib/finance-staff-costs.ts'
import { dayKey, money, number } from '@kampus/school-core/lib/format.ts'
import { FormField } from '@/components/FormField.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { StatGrid } from '../academic/AcademicParts.tsx'
import { CsvButton } from './CorporateParts.tsx'
import { FinanceStaffCostAllocations } from './FinanceStaffCostAllocations.tsx'
import { roleLabel } from './finance-fixed-asset-assignment-forms.ts'

const num = 'text-right tabular-nums'
const hidden = (cents: number | null) => (cents === null ? 'Küçük grup' : money(cents))

/** Ay alanları geçerliyse sorgu, değilse kullanıcı mesajı. */
function reportQuery(
  from: string,
  to: string,
  people: boolean,
): { query: StaffCostQuery } | { issue: string } {
  if (!staffCostMonthSchema.safeParse(from).success || !staffCostMonthSchema.safeParse(to).success)
    return { issue: 'Başlangıç ve bitiş ayını seçin.' }
  const issue = staffCostRangeIssue(from, to)
  if (issue !== null) return { issue }
  return { query: { from, to, ...(people ? { people: 'true' as const } : {}) } }
}

/**
 * Personel maliyeti (DOM-FIN-104; ON-204): Finans "Personel maliyeti" sekmesi, yalnız yönetici
 * (K-334). Üstte seçilen ay aralığının tahmini işveren maliyeti merkez kırılımında, altta
 * personelin maliyet merkezi atamaları. Tutarlar bordro değil tahmindir; her rapor okuması ve CSV
 * denetim kaydına yazılır. Kişi satırları istenmedikçe küçük grup gizlenir.
 */
export function FinanceStaffCostsSection() {
  const current = monthOf(dayKey())
  const [from, setFrom] = useState(current)
  const [to, setTo] = useState(current)
  const [people, setPeople] = useState(false)
  const built = reportQuery(from, to, people)
  const query = 'query' in built ? built.query : null
  const report = useStaffCosts(query ?? {}, query !== null)
  const exporter = useStaffCostsExport()
  const data: StaffCostReport | undefined = query === null ? undefined : report.data?.data
  return (
    <section
      aria-labelledby="personel-maliyeti"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading px-6 pt-6 pb-4 max-[650px]:px-4">
        <h2 id="personel-maliyeti" className="text-lg font-semibold">
          Personel maliyeti
        </h2>
        <p className="text-sm text-muted-foreground">
          Ücret tanımı ve bordro parametrelerinden tahmini işveren maliyeti, maliyet merkezine göre.
          Ücret kişisel veridir: her görüntüleme ve dosya denetim kaydına yazılır.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <FormField id="pm-ay-baslangic" label="Başlangıç ayı">
            {(control) => (
              <Input
                {...control}
                type="month"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            )}
          </FormField>
          <FormField id="pm-ay-bitis" label="Bitiş ayı">
            {(control) => (
              <Input
                {...control}
                type="month"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            )}
          </FormField>
          <Button
            variant="secondary"
            aria-pressed={people}
            onClick={() => setPeople((value) => !value)}
          >
            {people ? 'Kişi satırlarını gizle' : 'Kişi satırlarını göster'}
          </Button>
          {query === null ? null : (
            <CsvButton
              label="CSV indir"
              filename={`personel-maliyeti-${from}${from === to ? '' : `-${to}`}.csv`}
              busy={exporter.isPending}
              download={() => exporter.submit(query)}
            />
          )}
        </div>
        {'issue' in built ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {built.issue}
          </p>
        ) : null}
      </header>
      {query !== null && report.error ? (
        <div className="px-6 pb-6 max-[650px]:px-4">
          <QueryError error={report.error} onRetry={() => void report.refetch()} />
        </div>
      ) : null}
      {query !== null && report.isPending ? (
        <p role="status" className="px-6 pb-6 text-sm text-muted-foreground">
          Rapor yükleniyor…
        </p>
      ) : null}
      {data ? <Report data={data} /> : null}
      <FinanceStaffCostAllocations />
    </section>
  )
}

function Report({ data }: { data: StaffCostReport }) {
  const { totals } = data
  return (
    <div className="grid gap-4 px-6 pb-6 max-[650px]:px-4">
      <StatGrid
        label={`Personel maliyeti özeti, ${monthRangeLabel(data.from, data.to)}`}
        items={[
          { label: 'Personel', value: number(totals.staffCount) },
          { label: 'Brüt ücret', value: money(totals.grossCents) },
          {
            label: 'İşveren SGK ve işsizlik',
            value: money(totals.employerSgkCents + totals.unemploymentCents),
          },
          { label: 'Yan haklar', value: money(totals.benefitsCents) },
          { label: 'Tahmini toplam maliyet', value: money(totals.totalCents) },
        ]}
      />
      {data.centers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Bu dönemde ücret tanımı olan personel yok; "Ücret tanımları" sekmesinden ekleyin.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table aria-label="Maliyet merkezine göre personel maliyeti">
            <TableHeader>
              <TableRow>
                <TableHead>Merkez</TableHead>
                <TableHead className="text-right">Personel</TableHead>
                <TableHead className="text-right">Brüt</TableHead>
                <TableHead className="text-right">SGK işveren</TableHead>
                <TableHead className="text-right">İşsizlik işveren</TableHead>
                <TableHead className="text-right">Yan haklar</TableHead>
                <TableHead className="text-right">Tahmini toplam</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.centers.map((row) => (
                <TableRow key={row.id ?? 'atanmamis'}>
                  <TableCell>
                    <span className="grid">
                      <span className="font-medium">{row.name}</span>
                      {row.path === null ? null : (
                        <span className="text-xs text-muted-foreground">
                          {row.path}
                          {row.isActive ? '' : ' · pasif'}
                        </span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className={num}>{number(row.staffCount)}</TableCell>
                  <TableCell className={num}>{hidden(row.grossCents)}</TableCell>
                  <TableCell className={num}>{hidden(row.employerSgkCents)}</TableCell>
                  <TableCell className={num}>{hidden(row.unemploymentCents)}</TableCell>
                  <TableCell className={num}>{hidden(row.benefitsCents)}</TableCell>
                  <TableCell className={num}>{hidden(row.totalCents)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold">
                <TableCell>Kurum toplamı</TableCell>
                <TableCell className={num}>{number(totals.staffCount)}</TableCell>
                <TableCell className={num}>{money(totals.grossCents)}</TableCell>
                <TableCell className={num}>{money(totals.employerSgkCents)}</TableCell>
                <TableCell className={num}>{money(totals.unemploymentCents)}</TableCell>
                <TableCell className={num}>{money(totals.benefitsCents)}</TableCell>
                <TableCell className={num}>{money(totals.totalCents)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
      {data.persons === null || data.persons.length === 0 ? null : (
        <div className="overflow-x-auto">
          <Table aria-label="Kişi bazında personel maliyeti">
            <TableHeader>
              <TableRow>
                <TableHead>Personel</TableHead>
                <TableHead>Merkez</TableHead>
                <TableHead className="text-right">Pay</TableHead>
                <TableHead className="text-right">Brüt</TableHead>
                <TableHead className="text-right">İşveren payları</TableHead>
                <TableHead className="text-right">Yan haklar</TableHead>
                <TableHead className="text-right">Tahmini toplam</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.persons.map((row) => (
                <TableRow key={`${row.membershipId}:${row.centerId ?? ''}`}>
                  <TableCell>
                    <span className="grid">
                      <span className="font-medium">{row.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {roleLabel(row.role)}
                        {row.flags.map((flag) => ` · ${STAFF_COST_FLAG_LABELS[flag]}`).join('')}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>{row.centerName}</TableCell>
                  <TableCell className={num}>
                    {row.shareBasisPoints === null ? 'değişti' : shareLabel(row.shareBasisPoints)}
                  </TableCell>
                  <TableCell className={num}>{money(row.grossCents)}</TableCell>
                  <TableCell className={num}>
                    {money(row.employerSgkCents + row.unemploymentCents)}
                  </TableCell>
                  <TableCell className={num}>{money(row.benefitsCents)}</TableCell>
                  <TableCell className={num}>{money(row.totalCents)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <ul className="grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
        {staffCostNotes(data).map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </div>
  )
}
