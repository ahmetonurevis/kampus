import { useMemo, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useFinanceOpeningWatch } from '@kampus/react-shared/use-finance-opening-watch.ts'
import { CONTRACT_STATUS_LABELS } from '@kampus/school-core/lib/contract-status.ts'
import {
  OPENING_CHANGE_KINDS,
  type OpeningChangeKind,
} from '@kampus/school-core/lib/finance-opening-watch.ts'
import { dateLabel, money, number } from '@kampus/school-core/lib/format.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useEnrollmentLearner } from '@/hooks/use-enrollment-learner.ts'
import { pageHref } from '@/lib/navigation.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { StatGrid } from '../academic/AcademicParts.tsx'
import {
  changeKindLabel,
  classColumnLabel,
  emptyText,
  financeViewSearch,
  RENEWAL_CHANGE_KINDS,
  termIdOf,
  windowOptions,
  withdrawnNote,
  YEAR_WINDOW,
  yearLabel,
  yearOptions,
} from './finance-opening-watch.ts'

const YEAR_PARAM = 'yil'
const WINDOW_PARAM = 'pencere'
const DAY = { year: 'numeric' } as const

type InstallmentRow = {
  id: string
  studentName: string
  className: string | null
  installment: number
  dueDate: string
  remainingCents: number
  status: 'overdue' | 'due_soon'
  overdueDays: number
}
type ContractRow = {
  id: string
  studentName: string
  className: string | null
  revision: number
  contractAt: string
  status: 'awaiting_signatory' | 'awaiting_approval'
}
type ChangeRow = {
  id: string
  kind: OpeningChangeKind
  kindLabel: string
  studentName: string
  date: string
  fromClassName: string | null
  toClassName: string | null
  note: string | null
}
type RefundRow = {
  id: string
  studentName: string
  withdrawalDate: string
  refundCents: number
  refundDueDate: string
  overdueDays: number
}

const keysOf = (columns: readonly { key: string }[]) => columns.map((column) => column.key)

/** Bölüm başlığı, açıklaması ve tümünü gösteren mevcut listeye bağlantı. */
function WatchPart({
  id,
  title,
  description,
  more,
  children,
}: {
  id: string
  title: string
  description: string
  more?: { label: string; to: string } | undefined
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} className="grid gap-2">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div className="grid gap-0.5">
          <h3 id={id} className="text-base font-semibold">
            {title}
          </h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {more ? (
          <Button asChild size="sm" variant="secondary">
            <Link to={more.to}>{more.label}</Link>
          </Button>
        ) : null}
      </header>
      {children}
    </section>
  )
}

/**
 * Finans & Tahsilat "Açılış nöbeti" (`?gorunum=acilis`; DOM-FIN-061, ON-095): yeni yıl ya da dönem
 * açılışında ilk taksitler, onaysız sözleşmeler, kayıt değişiklikleri ve bekleyen iadeler. Yıl ve
 * pencere adreste (`?yil=`, `?pencere=`); satırlar ilgili mevcut listeye ya da panele bağlanır, tam
 * liste, arama ve sayfalama o ekranlardadır. Taksit ayrıntısı sayfanın taksit panelinde açılır.
 */
export function FinanceOpeningWatchSection({
  onOpenInvoice,
}: {
  onOpenInvoice: (invoiceId: string) => void
}) {
  const { session } = useAuth()
  const learner = useEnrollmentLearner()
  const [params, setParams] = useSearchParams()
  const institutionYear = session?.institution?.academicYear ?? undefined
  const yearParam = Number(params.get(YEAR_PARAM))
  const academicYear = Number.isInteger(yearParam) && yearParam >= 2000 ? yearParam : undefined
  const windowValue = params.get(WINDOW_PARAM) ?? YEAR_WINDOW
  const termId = termIdOf(windowValue)
  const query = useFinanceOpeningWatch({
    ...(academicYear === undefined ? {} : { academicYear }),
    ...(termId === undefined ? {} : { termId }),
  })
  const data = query.data?.data
  const classLabel = classColumnLabel(session?.institution?.type)
  const role = session?.role
  const modules = session?.modules

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value === null) next.delete(key)
    else next.set(key, value)
    // Yıl değişince önceki yılın dönemi geçersizdir.
    if (key === YEAR_PARAM) next.delete(WINDOW_PARAM)
    setParams(next)
  }

  const installmentRows = useMemo<InstallmentRow[]>(
    () =>
      (data?.firstInstallments.rows ?? []).map((row) => ({
        id: row.invoiceId,
        studentName: row.studentName,
        className: row.className,
        installment: row.installment,
        dueDate: row.dueDate,
        remainingCents: row.remainingCents,
        status: row.status,
        overdueDays: row.overdueDays,
      })),
    [data],
  )
  const contractRows = useMemo<ContractRow[]>(
    () =>
      (data?.unapprovedContracts.rows ?? []).map((row) => ({
        id: row.contractId,
        studentName: row.studentName,
        className: row.className,
        revision: row.revision,
        contractAt: row.contractAt,
        status: row.status,
      })),
    [data],
  )
  const changeRows = useMemo<ChangeRow[]>(
    () =>
      (data?.enrollmentChanges.rows ?? []).map((row, index) => ({
        id: `${row.kind}-${row.studentId}-${String(index)}`,
        kind: row.kind,
        kindLabel: changeKindLabel(row.kind),
        studentName: row.studentName,
        date: row.date,
        fromClassName: row.fromClassName,
        toClassName: row.toClassName,
        note: withdrawnNote(row.withoutRenewal),
      })),
    [data],
  )
  const refundRows = useMemo<RefundRow[]>(
    () =>
      (data?.refunds.rows ?? []).map((row) => ({
        id: row.withdrawalId,
        studentName: row.studentName,
        withdrawalDate: row.withdrawalDate,
        refundCents: row.refundCents,
        refundDueDate: row.refundDueDate,
        overdueDays: row.overdueDays,
      })),
    [data],
  )

  const installmentColumns = useMemo<DataColumn<InstallmentRow>[]>(
    () => [
      { key: 'studentName', label: learner.title },
      { key: 'className', label: classLabel },
      { key: 'installment', label: 'Taksit', cell: (row) => `${String(row.installment)}. taksit` },
      { key: 'dueDate', label: 'Vade', cell: (row) => dateLabel(row.dueDate, DAY) },
      { key: 'remainingCents', label: 'Kalan', cell: (row) => money(row.remainingCents) },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) =>
          row.status === 'overdue' ? (
            <StatusBadge text={`Gecikmiş · ${number(row.overdueDays)} gün`} tone="red" />
          ) : (
            <StatusBadge text="Yaklaşan" tone="purple" />
          ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.studentName} ${String(row.installment)}. taksit ayrıntısını aç`}
            onClick={() => onOpenInvoice(row.id)}
          >
            Ayrıntı
          </Button>
        ),
      },
    ],
    [learner.title, classLabel, onOpenInvoice],
  )
  const contractColumns = useMemo<DataColumn<ContractRow>[]>(
    () => [
      { key: 'studentName', label: learner.title },
      { key: 'className', label: classLabel },
      {
        key: 'revision',
        label: 'Sürüm',
        cell: (row) => (row.revision > 1 ? `Ek protokol ${String(row.revision - 1)}` : 'İlk'),
      },
      { key: 'contractAt', label: 'Tarih', cell: (row) => dateLabel(row.contractAt, DAY) },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => <StatusBadge text={CONTRACT_STATUS_LABELS[row.status]} tone="amber" />,
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button asChild size="sm" variant="secondary">
            <Link
              to={financeViewSearch('sozlesmeler', { sozlesme: row.id })}
              aria-label={`${row.studentName} sözleşmesini aç`}
            >
              Sözleşmeyi aç
            </Link>
          </Button>
        ),
      },
    ],
    [learner.title, classLabel],
  )
  const changeColumns = useMemo<DataColumn<ChangeRow>[]>(
    () => [
      { key: 'kindLabel', label: 'Değişiklik' },
      { key: 'studentName', label: learner.title },
      { key: 'date', label: 'Gün', cell: (row) => dateLabel(row.date, DAY) },
      { key: 'fromClassName', label: `Önceki ${classLabel.toLocaleLowerCase('tr')}` },
      { key: 'toClassName', label: `Yeni ${classLabel.toLocaleLowerCase('tr')}` },
      {
        key: 'note',
        label: 'Not',
        cell: (row) => (row.note ? <StatusBadge text={row.note} tone="amber" /> : '—'),
      },
    ],
    [learner.title, classLabel],
  )
  const refundColumns = useMemo<DataColumn<RefundRow>[]>(
    () => [
      { key: 'studentName', label: learner.title },
      {
        key: 'withdrawalDate',
        label: 'Ayrılış',
        cell: (row) => dateLabel(row.withdrawalDate, DAY),
      },
      { key: 'refundCents', label: 'İade', cell: (row) => money(row.refundCents) },
      {
        key: 'refundDueDate',
        label: 'Son gün',
        cell: (row) =>
          row.overdueDays > 0 ? (
            <StatusBadge
              text={`${dateLabel(row.refundDueDate, DAY)} · ${number(row.overdueDays)} gün geçti`}
              tone="red"
            />
          ) : (
            dateLabel(row.refundDueDate, DAY)
          ),
      },
    ],
    [learner.title],
  )

  const currentYear = data?.academicYear ?? academicYear ?? institutionYear
  const visibleKinds = OPENING_CHANGE_KINDS.filter(
    (kind) => data?.renewalModule !== false || !RENEWAL_CHANGE_KINDS.includes(kind),
  )
  const counts = data?.enrollmentChanges.counts

  return (
    <section aria-labelledby="acilis-nobeti-baslik" className="mt-6 grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <h2 id="acilis-nobeti-baslik" className="text-lg font-semibold">
            Açılış nöbeti
          </h2>
          <p className="text-sm text-muted-foreground">
            {data
              ? `${yearLabel(data.academicYear)} · ${dateLabel(data.from, DAY)} – ${dateLabel(data.to, DAY)} arası`
              : 'Yeni yıl ya da dönem açılışında izlenecekler'}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {currentYear === undefined ? null : (
            <label className="grid gap-1 text-sm font-medium">
              Eğitim yılı
              <NativeSelect
                value={String(currentYear)}
                onChange={(event) => setParam(YEAR_PARAM, event.target.value)}
                className="min-h-9 text-sm"
              >
                {yearOptions(institutionYear ?? currentYear, currentYear).map((year) => (
                  <NativeSelectOption key={year} value={String(year)}>
                    {yearLabel(year)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          )}
          {data && data.terms.length > 0 ? (
            <label className="grid gap-1 text-sm font-medium">
              Açılış
              <NativeSelect
                value={windowValue}
                onChange={(event) =>
                  setParam(
                    WINDOW_PARAM,
                    event.target.value === YEAR_WINDOW ? null : event.target.value,
                  )
                }
                className="min-h-9 text-sm"
              >
                {windowOptions(data.terms).map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          ) : null}
        </div>
      </header>
      {query.error ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : !data ? (
        <p role="status" className="text-sm text-muted-foreground">
          Açılış nöbeti yükleniyor…
        </p>
      ) : (
        <>
          <StatGrid
            label="Açılış nöbeti özeti"
            items={[
              {
                label: 'Gecikmiş ilk taksit',
                value: number(data.firstInstallments.overdueCount),
                note: money(data.firstInstallments.overdueCents),
              },
              {
                label: 'Yaklaşan ilk taksit',
                value: number(data.firstInstallments.dueSoonCount),
                note: `7 gün içinde · ${money(data.firstInstallments.dueSoonCents)}`,
              },
              {
                label: 'Onay bekleyen sözleşme',
                value: number(
                  data.unapprovedContracts.awaitingSignatoryCount +
                    data.unapprovedContracts.awaitingApprovalCount,
                ),
                note: `${number(data.unapprovedContracts.awaitingSignatoryCount)} kurum imzası, ${number(data.unapprovedContracts.awaitingApprovalCount)} ödeyici onayı`,
              },
              {
                label: 'Bekleyen iade',
                value: number(data.refunds.pendingCount),
                note:
                  data.refunds.overdueCount > 0
                    ? `${money(data.refunds.pendingCents)} · ${number(data.refunds.overdueCount)} iadenin süresi geçti`
                    : money(data.refunds.pendingCents),
              },
            ]}
          />
          <WatchPart
            id="acilis-ilk-taksit"
            title="İlk taksitler"
            description={`${yearLabel(data.academicYear)} sözleşmelerinin vadesi geçen ya da 7 gün içinde gelen ödenmemiş ilk taksitleri; kısmi ödeme düşülmüştür.`}
            more={{
              label: 'Gecikmiş taksitlerin tümü',
              to: financeViewSearch('', { durum: 'gecikmis' }),
            }}
          >
            <DataTable
              listKey={`acilis-taksit-${String(data.academicYear)}`}
              rows={installmentRows}
              columns={installmentColumns}
              mobileColumns={['studentName', 'dueDate', 'status']}
              caption="Ödenmemiş ilk taksitler"
              search={false}
              excludeFilters={keysOf(installmentColumns)}
              pageSize={20}
              empty={emptyText(learner, 'ilk taksiti bekleyen')}
            />
          </WatchPart>
          <WatchPart
            id="acilis-sozlesme"
            title="Onaylanmamış sözleşmeler"
            description="Kurum imzası ya da ödeyici onayı bekleyen sözleşme ve ek protokoller."
            more={{ label: 'Sözleşmelerin tümü', to: financeViewSearch('sozlesmeler') }}
          >
            <DataTable
              listKey={`acilis-sozlesme-${String(data.academicYear)}`}
              rows={contractRows}
              columns={contractColumns}
              mobileColumns={['studentName', 'status']}
              caption="Onaylanmamış sözleşmeler"
              search={false}
              excludeFilters={keysOf(contractColumns)}
              pageSize={20}
              empty={emptyText(learner, 'sözleşmesi onay bekleyen')}
            />
          </WatchPart>
          <WatchPart
            id="acilis-kayit"
            title="Kayıt değişiklikleri"
            description="Açılış penceresindeki kesin kayıt, yenileme, dönem geçişi, mezuniyet ve ayrılışlar."
            more={
              role && modules?.renewal === true && data.renewalModule
                ? { label: 'Kayıt yenileme', to: pageHref(role, { path: 'kayit-yenileme' }) }
                : undefined
            }
          >
            {counts ? (
              <ul aria-label="Kayıt değişikliği sayıları" className="flex flex-wrap gap-2">
                {visibleKinds.map((kind) => (
                  <li key={kind}>
                    <StatusBadge
                      text={`${changeKindLabel(kind)}: ${number(counts[kind])}`}
                      tone="gray"
                    />
                  </li>
                ))}
                {data.enrollmentChanges.withdrawnWithoutRenewal > 0 ? (
                  <li>
                    <StatusBadge
                      text={`Yenilemeden ayrılan: ${number(data.enrollmentChanges.withdrawnWithoutRenewal)}`}
                      tone="amber"
                    />
                  </li>
                ) : null}
              </ul>
            ) : null}
            <DataTable
              listKey={`acilis-kayit-${data.from}-${data.to}`}
              rows={changeRows}
              columns={changeColumns}
              mobileColumns={['kindLabel', 'studentName', 'date']}
              caption="Açılış penceresindeki kayıt değişiklikleri"
              search={false}
              excludeFilters={keysOf(changeColumns)}
              pageSize={20}
              empty={emptyText(learner, 'kaydı değişen')}
            />
          </WatchPart>
          <WatchPart
            id="acilis-iade"
            title="Bekleyen iadeler"
            description="Ödenmemiş ayrılış iadeleri, son günü en yakın önce."
            more={{
              label: 'Ayrılış ve iade listesi',
              to: financeViewSearch('ayrilis', { iade: 'pending' }),
            }}
          >
            <DataTable
              listKey="acilis-iade"
              rows={refundRows}
              columns={refundColumns}
              mobileColumns={['studentName', 'refundCents', 'refundDueDate']}
              caption="Bekleyen iadeler"
              search={false}
              excludeFilters={keysOf(refundColumns)}
              pageSize={20}
              empty={emptyText(learner, 'iadesi bekleyen')}
            />
          </WatchPart>
        </>
      )}
    </section>
  )
}
