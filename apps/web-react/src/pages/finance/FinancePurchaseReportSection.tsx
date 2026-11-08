import { useState, type ReactNode } from 'react'
import {
  purchaseReportRangeIssue,
  PURCHASE_REPORT_RANGE_MAX_DAYS,
} from '@kampus/school-core/lib/finance-purchase-report.ts'
import {
  SUPPLIER_CATEGORY_LABELS,
  SUPPLIER_TYPE_LABELS,
} from '@kampus/school-core/lib/finance-suppliers.ts'
import { dayKey, money, number } from '@kampus/school-core/lib/format.ts'
import { useBudgetPeriods } from '@kampus/react-shared/use-finance-budget.ts'
import {
  usePurchaseReport,
  usePurchaseReportExport,
  type PurchaseReport,
  type PurchaseReportQuery,
} from '@kampus/react-shared/use-finance-purchase-report.ts'
import { REAUTHENTICATION_CODE } from '@kampus/react-shared/use-withdrawals.ts'
import { ReauthModal } from '@/auth/ReauthModal.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { saveBlob } from '@/lib/download.ts'
import { notify } from '@/lib/notify.ts'
import { StatGrid } from '../academic/AcademicParts.tsx'
import { defaultPeriodId, shareLabel } from './finance-cost-report-model.ts'

const BOM = '\uFEFF'
const PERIOD_LIST = { page: 1, pageSize: 100 } as const
const DAYS = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 })
const num = 'text-right tabular-nums'

type Mode = 'range' | 'period'
type Amounts = Pick<
  PurchaseReport['totals'],
  'orderCount' | 'netCents' | 'vatCents' | 'grossCents'
> & { shareBasisPoints: number | null }

const daysLabel = (days: number | null) => (days === null ? '—' : `${DAYS.format(days)} gün`)

/** Ekranın sorgusu; geçersiz aralıkta istek atılmaz, ileti alanın altında görünür. */
function queryOf(
  mode: Mode,
  from: string,
  to: string,
  periodId: string | null,
): { query: PurchaseReportQuery | null; error: string | null } {
  if (mode === 'period') return { query: periodId === null ? null : { periodId }, error: null }
  if (from === '' || to === '') return { query: null, error: 'Başlangıç ve bitiş gününü seçin.' }
  const issue = purchaseReportRangeIssue(from, to)
  return issue === null
    ? { query: { from, to }, error: null }
    : { query: null, error: issue.message }
}

function AmountHeads({ first }: { first: string }) {
  return (
    <TableHeader>
      <TableRow>
        <TableHead scope="col">{first}</TableHead>
        <TableHead scope="col" className={num}>
          Sipariş
        </TableHead>
        <TableHead scope="col" className={num}>
          Net
        </TableHead>
        <TableHead scope="col" className={num}>
          KDV
        </TableHead>
        <TableHead scope="col" className={num}>
          Brüt
        </TableHead>
        <TableHead scope="col" className={num}>
          Pay
        </TableHead>
      </TableRow>
    </TableHeader>
  )
}

function AmountCells({ row }: { row: Amounts }) {
  return (
    <>
      <TableCell className={num}>{number(row.orderCount)}</TableCell>
      <TableCell className={num}>{money(row.netCents)}</TableCell>
      <TableCell className={num}>{money(row.vatCents)}</TableCell>
      <TableCell className={num}>{money(row.grossCents)}</TableCell>
      <TableCell className={num}>{shareLabel(row.shareBasisPoints)}</TableCell>
    </>
  )
}

function ReportTable({
  caption,
  first,
  empty,
  children,
}: {
  caption: string
  first: string
  empty: boolean
  children: ReactNode
}) {
  return (
    <div className="mt-6 overflow-x-auto">
      <Table className="min-w-[640px]">
        <TableCaption className="mb-2 text-left font-medium text-foreground">
          {caption}
        </TableCaption>
        <AmountHeads first={first} />
        <TableBody>
          {empty ? (
            <TableRow>
              <TableCell colSpan={6} className="text-muted-foreground">
                Bu kapsamda sipariş yok.
              </TableCell>
            </TableRow>
          ) : (
            children
          )}
        </TableBody>
      </Table>
    </div>
  )
}

const supplierName = (row: PurchaseReport['suppliers'][number]) =>
  [
    row.name,
    row.type === 'individual' ? SUPPLIER_TYPE_LABELS.individual : null,
    row.isActive ? null : 'pasif',
  ]
    .filter(Boolean)
    .join(' · ')

/**
 * Satın alma raporu (DOM-FIN-075; ON-227). Finans "Satın alma raporu" sekmesi, yalnız yönetici
 * (K-155). Tarih aralığı ya da bütçe dönemi seçilir; hesap sunucudadır. CSV sunucuda üretilir: şahıs
 * tedarikçinin adını taşıdığı için taze oturum ister ve denetime düşer.
 */
export function FinancePurchaseReportSection() {
  const today = dayKey()
  const [mode, setMode] = useState<Mode>('range')
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`)
  const [to, setTo] = useState(today)
  const [chosen, setChosen] = useState<string | null>(null)
  const [reauth, setReauth] = useState(false)
  const periods = useBudgetPeriods(PERIOD_LIST)
  const periodList = periods.data?.data
  const periodId = chosen ?? defaultPeriodId(periodList)
  const { query, error } = queryOf(mode, from, to, periodId)
  const report = usePurchaseReport(query)
  const exporter = usePurchaseReportExport()
  const data = query === null ? undefined : report.data?.data

  async function download() {
    if (query === null) return
    const outcome = await exporter.submit(query)
    if (outcome.status === 'failed' && outcome.error.code === REAUTHENTICATION_CODE) setReauth(true)
    if (outcome.status !== 'success') return
    // Yanıt çözülürken BOM düşer; Excel Türkçe karakterleri onunla tanır.
    const csv = String(outcome.data).replace(BOM, '')
    const range = data ? `${data.from}-${data.to}` : today
    saveBlob(
      new Blob([BOM, csv], { type: 'text/csv;charset=utf-8' }),
      `satin-alma-raporu-${range}.csv`,
    )
    notify.success('Dosya indirildi.')
  }

  return (
    <section
      aria-labelledby="satin-alma-raporu"
      className="panel mt-6 overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading px-6 pt-6 pb-4 max-[650px]:px-4">
        <h2 id="satin-alma-raporu" className="text-lg font-semibold">
          Satın alma raporu
        </h2>
        <p className="text-sm text-muted-foreground">
          Açılan siparişlerin tedarikçi kategorisi, tedarikçi, maliyet merkezi ve gider kalemi
          bazında tutarı. İptal edilen siparişler toplamlara girmez.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="grid gap-1 text-sm font-medium">
            Kapsam
            <NativeSelect value={mode} onChange={(event) => setMode(event.target.value as Mode)}>
              <NativeSelectOption value="range">Tarih aralığı</NativeSelectOption>
              <NativeSelectOption value="period">Bütçe dönemi</NativeSelectOption>
            </NativeSelect>
          </label>
          {mode === 'range' ? (
            <div className="grid grid-cols-2 gap-4 max-[420px]:grid-cols-1">
              <FormField id="satin-alma-rapor-baslangic" label="Başlangıç günü">
                {(control) => (
                  <Input
                    {...control}
                    type="date"
                    value={from}
                    onChange={(event) => setFrom(event.target.value)}
                  />
                )}
              </FormField>
              <FormField id="satin-alma-rapor-bitis" label="Bitiş günü">
                {(control) => (
                  <Input
                    {...control}
                    type="date"
                    value={to}
                    onChange={(event) => setTo(event.target.value)}
                  />
                )}
              </FormField>
            </div>
          ) : (
            <label className="grid gap-1 text-sm font-medium">
              Bütçe dönemi
              <NativeSelect
                value={periodId ?? ''}
                disabled={!periodList || periodList.length === 0}
                onChange={(event) => setChosen(event.target.value)}
              >
                {(periodList ?? []).map((period) => (
                  <NativeSelectOption key={period.id} value={period.id}>
                    {period.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          )}
          <Button
            variant="outline"
            disabled={!data || exporter.isPending}
            aria-busy={exporter.isPending || undefined}
            onClick={() => void download()}
          >
            <Icon name="Download" size={17} aria-hidden="true" />
            CSV indir
          </Button>
        </div>
        {error ? (
          <p role="alert" className="mt-2 text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}
        {mode === 'range' ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Sipariş açılış günüyle sayılır; aralık en çok {String(PURCHASE_REPORT_RANGE_MAX_DAYS)}{' '}
            gün olabilir.
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Bütçe döneminde siparişin talebi hangi döneme bağlıysa o sayılır.
          </p>
        )}
        {mode === 'period' && periodList && periodList.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Önce "Bütçe" sekmesinde bir bütçe dönemi ekleyin.
          </p>
        ) : null}
        {mode === 'period' && periods.error ? (
          <QueryError error={periods.error} onRetry={() => void periods.refetch()} />
        ) : null}
      </header>
      <div className="px-6 pb-6 max-[650px]:px-4">
        {query !== null && report.error ? (
          <QueryError error={report.error} onRetry={() => void report.refetch()} />
        ) : null}
        {query !== null && report.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            Rapor yükleniyor…
          </p>
        ) : null}
        {data ? <ReportBody data={data} /> : null}
      </div>
      {reauth ? (
        <ReauthModal
          onCancel={() => setReauth(false)}
          onDone={() => {
            setReauth(false)
            void download()
          }}
        />
      ) : null}
    </section>
  )
}

function ReportBody({ data }: { data: PurchaseReport }) {
  const empty = data.totals.orderCount === 0
  return (
    <>
      <StatGrid
        label="Satın alma özeti"
        items={[
          {
            label: 'Sipariş',
            value: number(data.totals.orderCount),
            note: `${number(data.totals.supplierCount)} tedarikçi`,
          },
          { label: 'Net tutar', value: money(data.totals.netCents) },
          { label: 'KDV', value: money(data.totals.vatCents) },
          {
            label: 'Brüt tutar',
            value: money(data.totals.grossCents),
            ...(data.cancelled.orderCount > 0
              ? {
                  note: `${number(data.cancelled.orderCount)} iptal edilen sipariş (${money(data.cancelled.grossCents)}) hariç`,
                }
              : {}),
          },
          {
            label: 'Talepten siparişe ortalama',
            value: daysLabel(data.leadTime.averageDays),
            ...(data.leadTime.minDays === null
              ? {}
              : {
                  note: `En kısa ${daysLabel(data.leadTime.minDays)}, en uzun ${daysLabel(data.leadTime.maxDays)}`,
                }),
          },
        ]}
      />
      <ReportTable
        caption="En çok harcama yapılan tedarikçiler"
        first="Tedarikçi"
        empty={data.topSuppliers.length === 0}
      >
        {data.topSuppliers.map((row) => (
          <TableRow key={row.supplierId}>
            <TableCell>
              {String(row.rank)}. {supplierName(row)}
            </TableCell>
            <AmountCells row={row} />
          </TableRow>
        ))}
      </ReportTable>
      <ReportTable caption="Tedarikçi kategorisine göre" first="Kategori" empty={empty}>
        {data.categories.map((row) => (
          <TableRow key={row.category}>
            <TableCell>
              {SUPPLIER_CATEGORY_LABELS[row.category]}
              <span className="block text-xs text-muted-foreground">
                {number(row.supplierCount)} tedarikçi
              </span>
            </TableCell>
            <AmountCells row={row} />
          </TableRow>
        ))}
      </ReportTable>
      <ReportTable caption="Tedarikçiye göre" first="Tedarikçi" empty={empty}>
        {data.suppliers.map((row) => (
          <TableRow key={row.supplierId}>
            <TableCell>
              {supplierName(row)}
              <span className="block text-xs text-muted-foreground">
                {row.categories.map((category) => SUPPLIER_CATEGORY_LABELS[category]).join(', ')}
                {row.averageLeadDays === null
                  ? ''
                  : ` · ortalama ${daysLabel(row.averageLeadDays)}`}
              </span>
            </TableCell>
            <AmountCells row={row} />
          </TableRow>
        ))}
      </ReportTable>
      <ReportTable caption="Maliyet merkezine göre" first="Maliyet merkezi" empty={empty}>
        {data.costCenters.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              {row.code} · {row.name}
            </TableCell>
            <AmountCells row={row} />
          </TableRow>
        ))}
      </ReportTable>
      <ReportTable caption="Gider kalemine göre" first="Gider kalemi" empty={empty}>
        {data.budgetItems.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              {row.code} · {row.name}
            </TableCell>
            <AmountCells row={row} />
          </TableRow>
        ))}
      </ReportTable>
      <ul className="mt-4 grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
        <li>
          Birden çok kategorideki tedarikçinin siparişi her kategorisinde sayılır; kategori
          satırlarının toplamı genel toplamı aşabilir.
        </li>
        <li>Taslak sipariş tutara girer; tutar teklifteki KDV hariç fiyat ve KDV oranındandır.</li>
        <li>Şahıs tedarikçinin adı kişisel veridir; CSV dosyası denetim kaydına yazılır.</li>
      </ul>
    </>
  )
}
