import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  useArchiveCorporateCustomer,
  useCorporateAttendanceExport,
  useCorporateAttendanceReport,
  useCorporateBillable,
  useCorporateCustomer,
  useCorporateEmployees,
  useCreateCorporateInvoice,
  useEndCorporateEmployee,
  useLinkCorporateEmployee,
  type CorporateCustomer,
  type CorporateEmployee,
} from '@kampus/react-shared/use-finance-corporate.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import { FEE_ITEM_KIND_LABELS } from '@kampus/school-core/lib/fee-tariffs.ts'
import { assertFinancePeriod } from '@kampus/school-core/lib/finance-export.ts'
import {
  CORPORATE_MEMBER_STATUS_LABELS,
  eligibilityLabel,
  outcomeLabel,
  permilleLabel,
} from '@kampus/school-core/lib/finance-corporate.ts'
import { dateLabel, dayKey, money } from '@kampus/school-core/lib/format.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useCorporateReportPdf } from '@/hooks/use-finance-corporate-pdf.ts'
import { CORPORATE_REPORT_TITLE } from '@/lib/pdf/templates/finance-corporate.ts'
import { notify } from '@/lib/notify.ts'
import { SummaryLoading, SummaryMetrics } from '../management/SummaryParts.tsx'
import { RootError } from '../management/FormParts.tsx'
import { CsvButton, PdfDialogButton } from './CorporateParts.tsx'
import { CustomerFormModal } from './CorporateCustomerFormModal.tsx'
import {
  endFormSchema,
  linkFormField,
  linkFormSchema,
  monthPeriod,
  type EndFormValues,
  type LinkFormValues,
} from './corporate-forms.ts'

const EMPLOYEE_PAGE_SIZE = 100
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

/** Dönem hatası; geçerliyse `null`. Önizleme geçersiz dönemle istek atmaz. */
function periodError(from: string, to: string): string | null {
  if (from === '' || to === '') return 'Dönem başlangıcını ve bitişini seçin.'
  try {
    assertFinancePeriod({ from, to })
    return null
  } catch (error) {
    if (error instanceof DomainError) return error.message
    throw error
  }
}

/**
 * Şirket ayrıntısı (`?kurumsal=`; DOM-FIN-060, DOM-DIL-093): şirket bilgisi, bağlı kursiyerler,
 * toplu fatura önizlemesi ve kesimi, katılım özeti. Önizleme ve kesim aynı seçimi yapar; kesim
 * `Idempotency-Key` ile tekrarlanırsa ikinci fatura açılmaz.
 */
export function CorporateCustomerPanel({
  customerId,
  onClose,
}: {
  customerId: string
  onClose: () => void
}) {
  return (
    <SidePanel
      open={customerId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Kurumsal müşteri"
    >
      {customerId ? <CustomerDetail customerId={customerId} onArchived={onClose} /> : null}
    </SidePanel>
  )
}

function CustomerDetail({
  customerId,
  onArchived,
}: {
  customerId: string
  onArchived: () => void
}) {
  const item = useCorporateCustomer(customerId)
  const [editing, setEditing] = useState(false)
  const [archiving, setArchiving] = useState(false)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  const customer = item.data?.data
  if (!customer) return <SummaryLoading />
  return (
    <div className="grid gap-6">
      <section aria-labelledby="sirket-bilgileri" className="grid gap-3">
        <h3 id="sirket-bilgileri" className="text-base font-semibold">
          {customer.name}
        </h3>
        <dl className="grid gap-2 text-sm">
          <Pair
            label="Vergi dairesi / numarası"
            value={`${customer.taxOffice} / ${customer.taxNumber}`}
          />
          <Pair label="Fatura adresi" value={customer.billingAddress} />
          <Pair
            label="İletişim"
            value={
              [customer.contactName, customer.contactEmail, customer.contactPhone]
                .filter((part) => part !== null)
                .join(' · ') || '—'
            }
          />
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
            Düzenle
          </Button>
          <Button type="button" variant="outline" onClick={() => setArchiving(true)}>
            Arşivle
          </Button>
        </div>
      </section>
      <EmployeesSection customer={customer} />
      <BillingSection customer={customer} />
      <ReportSection customer={customer} />
      {editing ? <CustomerFormModal customer={customer} onClose={() => setEditing(false)} /> : null}
      {archiving ? (
        <ArchiveModal
          customer={customer}
          onClose={() => setArchiving(false)}
          onArchived={onArchived}
        />
      ) : null}
    </div>
  )
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,11rem)_1fr] gap-2 max-[480px]:grid-cols-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="[overflow-wrap:anywhere]">{value}</dd>
    </div>
  )
}

// --- Çalışanlar ----------------------------------------------------------------------------------

function EmployeesSection({ customer }: { customer: CorporateCustomer }) {
  const employees = useCorporateEmployees(customer.id, { page: 1, pageSize: EMPLOYEE_PAGE_SIZE })
  const [linking, setLinking] = useState(false)
  const [ending, setEnding] = useState<CorporateEmployee | null>(null)
  const items = employees.data?.data ?? []
  const total = employees.data?.meta.total ?? 0
  return (
    <section aria-labelledby="sirket-calisanlari" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="sirket-calisanlari" className="text-base font-semibold">
          Bağlı kursiyerler
        </h3>
        <Button type="button" size="sm" onClick={() => setLinking(true)}>
          <Icon name="Plus" size={16} aria-hidden="true" />
          Kursiyer bağla
        </Button>
      </div>
      {employees.error ? (
        <QueryError error={employees.error} onRetry={() => void employees.refetch()} />
      ) : null}
      {employees.isPending ? <SummaryLoading /> : null}
      {!employees.isPending && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Bu şirkete bağlı kursiyer yok.</p>
      ) : null}
      <ul className="grid gap-2" aria-label="Bağlı kursiyerler">
        {items.map((employee) => (
          <li
            key={employee.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
          >
            <span>
              <span className="font-medium">{employee.studentName ?? '—'}</span>
              <span className="block text-muted-foreground">
                {employee.endsOn
                  ? `${dayText(employee.startsOn)} – ${dayText(employee.endsOn)}`
                  : `${dayText(employee.startsOn)} tarihinden beri`}
              </span>
            </span>
            {employee.endsOn ? null : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label={`${employee.studentName ?? 'Kursiyer'} bağını bitir`}
                onClick={() => setEnding(employee)}
              >
                Bağı bitir
              </Button>
            )}
          </li>
        ))}
      </ul>
      {total > items.length ? (
        <p className="text-xs text-muted-foreground">
          İlk {items.length} bağ gösteriliyor (toplam {total}).
        </p>
      ) : null}
      {linking ? <LinkModal customer={customer} onClose={() => setLinking(false)} /> : null}
      {ending ? (
        <EndModal customerId={customer.id} employee={ending} onClose={() => setEnding(null)} />
      ) : null}
    </section>
  )
}

const LINK_FORM = 'kurumsal-bag-formu'

function LinkModal({ customer, onClose }: { customer: CorporateCustomer; onClose: () => void }) {
  const link = useLinkCorporateEmployee()
  const students = useCoreAll('students')
  const form = useForm<LinkFormValues>({
    resolver: zodResolver(linkFormSchema),
    defaultValues: { studentId: '', startsOn: dayKey(), noticeConfirmed: false },
  })
  const busy = link.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await link.submit(
      {
        customerId: customer.id,
        body: { studentId: values.studentId, startsOn: values.startsOn, noticeConfirmed: true },
      },
      {
        setError: (name, error) => {
          const field = linkFormField(name)
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success(`${outcome.data.data.studentName ?? 'Kursiyer'} şirkete bağlandı.`)
      onClose()
    }
  })
  const options = (students.data ?? [])
    .map((item) => ({ value: item.id, label: item.record.name }))
    .sort((a, b) => a.label.localeCompare(b.label, 'tr'))
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Kursiyer bağla"
      description={`${customer.name}, başlangıç gününden sonra vadesi gelen taksitlerin ödeyicisi olur.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={LINK_FORM} disabled={busy} aria-busy={busy || undefined}>
            Bağla
          </Button>
        </>
      }
    >
      {students.error ? (
        <QueryError error={students.error} onRetry={() => void students.refetch()} />
      ) : null}
      <form
        id={LINK_FORM}
        noValidate
        aria-label="Kursiyer bağla"
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField id="kurumsal-kursiyer" label="Kursiyer" error={errors.studentId}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('studentId')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="">Kursiyer seçin</NativeSelectOption>
              {options.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="kurumsal-baslangic" label="Başlangıç günü" error={errors.startsOn}>
          {(control) => (
            <Input {...control} type="date" {...form.register('startsOn')} disabled={busy} />
          )}
        </FormField>
        <div className="grid gap-1">
          <label className="flex min-h-11 items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1 size-4"
              aria-describedby={errors.noticeConfirmed ? 'kurumsal-aydinlatma-hata' : undefined}
              {...form.register('noticeConfirmed')}
              disabled={busy}
            />
            Kursiyere, şirkete yalnız devam ve kur sonucunun raporlanacağı aydınlatması yapıldı.
          </label>
          {errors.noticeConfirmed?.message ? (
            <p id="kurumsal-aydinlatma-hata" role="alert" className="text-sm text-danger">
              {errors.noticeConfirmed.message}
            </p>
          ) : null}
        </div>
        <RootError message={errors.root?.server?.message} />
      </form>
    </Modal>
  )
}

const END_FORM = 'kurumsal-bag-bitis-formu'

function EndModal({
  customerId,
  employee,
  onClose,
}: {
  customerId: string
  employee: CorporateEmployee
  onClose: () => void
}) {
  const end = useEndCorporateEmployee()
  const form = useForm<EndFormValues>({
    resolver: zodResolver(endFormSchema),
    defaultValues: { endsOn: dayKey() },
  })
  const busy = end.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await end.submit(
      { customerId, linkId: employee.id, version: employee.version, endsOn: values.endsOn },
      {
        setError: (name, error) =>
          name === 'endsOn'
            ? form.setError('endsOn', error, { shouldFocus: true })
            : form.setError('root.server', error),
      },
    )
    if (outcome.status === 'success') {
      notify.success('Şirket bağı bitirildi.')
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Bağı bitir"
      description={`${employee.studentName ?? 'Kursiyer'} için son gün. Bağ silinmez; geçmiş dönemin faturası için kalır.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={END_FORM} disabled={busy} aria-busy={busy || undefined}>
            Bitir
          </Button>
        </>
      }
    >
      <form
        id={END_FORM}
        noValidate
        aria-label="Bağı bitir"
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField id="kurumsal-bitis" label="Son gün" error={form.formState.errors.endsOn}>
          {(control) => (
            <Input {...control} type="date" {...form.register('endsOn')} disabled={busy} />
          )}
        </FormField>
        <RootError message={form.formState.errors.root?.server?.message} />
      </form>
    </Modal>
  )
}

function ArchiveModal({
  customer,
  onClose,
  onArchived,
}: {
  customer: CorporateCustomer
  onClose: () => void
  onArchived: () => void
}) {
  const archive = useArchiveCorporateCustomer()
  async function confirm() {
    const outcome = await archive.submit({ customerId: customer.id, version: customer.version })
    if (outcome.status === 'busy') return
    onClose()
    if (outcome.status === 'success') {
      notify.success(`${customer.name} arşivlendi.`)
      onArchived()
    }
  }
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Şirketi arşivle"
      description={`${customer.name} listeden kalkar; kesilmiş toplu faturalar kalır. Bağlı kursiyeri olan şirket arşivlenemez.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={archive.isPending}>
            Vazgeç
          </Button>
          <Button
            variant="destructive"
            disabled={archive.isPending}
            aria-busy={archive.isPending || undefined}
            onClick={() => void confirm()}
          >
            Arşivle
          </Button>
        </>
      }
    >
      <p className="text-sm">Bu işlem geri alınmaz.</p>
    </Modal>
  )
}

// --- Toplu fatura --------------------------------------------------------------------------------

function BillingSection({ customer }: { customer: CorporateCustomer }) {
  const initial = monthPeriod(dayKey())
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const invalid = periodError(from, to)
  const billable = useCorporateBillable(customer.id, { from, to }, { enabled: invalid === null })
  const create = useCreateCorporateInvoice()
  const preview = invalid === null ? billable.data?.data : undefined
  const lines = preview?.lines ?? []

  async function issue() {
    const outcome = await create.submit({ customerId: customer.id, from, to })
    if (outcome.status === 'success')
      notify.success(`${outcome.data.data.number} numaralı toplu fatura kesildi.`)
  }

  return (
    <section aria-labelledby="sirket-toplu-fatura" className="grid gap-3">
      <h3 id="sirket-toplu-fatura" className="text-base font-semibold">
        Toplu fatura
      </h3>
      <p className="text-sm text-muted-foreground">
        Dönemde vadesi gelen ve henüz faturalanmamış taksitler. Ödenmiş taksit de girer.
      </p>
      <div className="grid grid-cols-2 gap-3 max-[480px]:grid-cols-1">
        <FormField id="toplu-fatura-baslangic" label="Dönem başlangıcı">
          {(control) => (
            <Input
              {...control}
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          )}
        </FormField>
        <FormField id="toplu-fatura-bitis" label="Dönem bitişi">
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
      {invalid ? (
        <p role="alert" className="text-sm text-danger">
          {invalid}
        </p>
      ) : null}
      {billable.error && invalid === null ? (
        <QueryError error={billable.error} onRetry={() => void billable.refetch()} />
      ) : null}
      {invalid === null && billable.isPending ? <SummaryLoading /> : null}
      {preview ? (
        <>
          <SummaryMetrics
            items={[
              { label: 'Faturalanacak tutar', value: money(preview.totalCents) },
              { label: 'Taksit', value: String(lines.length) },
            ]}
          />
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">Bu dönemde faturalanacak taksit yok.</p>
          ) : (
            <ul className="grid gap-2" aria-label="Faturalanacak taksitler">
              {lines.map((line) => (
                <li
                  key={line.invoiceId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                >
                  <span>
                    <span className="font-medium">{line.studentName ?? '—'}</span>
                    <span className="block text-muted-foreground">
                      {line.installment}. taksit · {FEE_ITEM_KIND_LABELS[line.feeKind ?? 'tuition']}{' '}
                      · {dayText(line.dueDate)}
                    </span>
                  </span>
                  <span className="font-medium tabular-nums">{money(line.amountCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
      <div>
        <Button
          type="button"
          disabled={lines.length === 0 || create.isPending}
          aria-busy={create.isPending || undefined}
          onClick={() => void issue()}
        >
          Toplu fatura kes
        </Button>
      </div>
    </section>
  )
}

// --- Katılım özeti -------------------------------------------------------------------------------

function ReportSection({ customer }: { customer: CorporateCustomer }) {
  const report = useCorporateAttendanceReport(customer.id)
  const exporter = useCorporateAttendanceExport()
  const data = report.data?.data
  return (
    <section aria-labelledby="sirket-katilim" className="grid gap-3">
      <h3 id="sirket-katilim" className="text-base font-semibold">
        Katılım özeti
      </h3>
      <p className="text-sm text-muted-foreground">
        Bağlı kursiyerlerin yalnız devam saatleri ve onaylı kur sonucu. Yazma, ses kaydı ve öğretmen
        yorumu şirkete verilmez.
      </p>
      <div className="flex flex-wrap gap-2">
        <PdfDialogButton
          label="Katılım özeti PDF"
          title={CORPORATE_REPORT_TITLE}
          id={customer.id}
          usePdf={useCorporateReportPdf}
        />
        <CsvButton
          label="Katılım özeti CSV"
          filename={`katilim-ozeti-${dayKey()}.csv`}
          busy={exporter.isPending}
          download={() => exporter.submit(customer.id)}
        />
      </div>
      {report.error ? (
        <QueryError error={report.error} onRetry={() => void report.refetch()} />
      ) : null}
      {report.isPending ? <SummaryLoading /> : null}
      {data ? (
        <>
          <SummaryMetrics
            items={[
              { label: 'Kur kaydı', value: String(data.totals.enrollmentCount) },
              {
                label: 'Katılım',
                value:
                  data.totals.attendanceRatePermille === null
                    ? '—'
                    : `%${permilleLabel(data.totals.attendanceRatePermille)}`,
              },
            ]}
          />
          <ul className="grid gap-2" aria-label="Kursiyer katılımı">
            {data.employees.map((employee) => (
              <li key={employee.studentId} className="rounded-lg border px-3 py-2 text-sm">
                <span className="font-medium">{employee.studentName ?? '—'}</span>
                {employee.enrollments.length === 0 ? (
                  <span className="block text-muted-foreground">Kur kaydı yok.</span>
                ) : (
                  employee.enrollments.map((row) => (
                    <span key={row.enrollmentId} className="block text-muted-foreground">
                      {row.courseName} ({row.level}) ·{' '}
                      {CORPORATE_MEMBER_STATUS_LABELS[row.memberStatus]} · {row.attendedHours}/
                      {row.recordedHours} saat
                      {row.attendanceRatePermille === null
                        ? ''
                        : ` (%${permilleLabel(row.attendanceRatePermille)})`}{' '}
                      · Devam: {eligibilityLabel(row)} · Sonuç: {outcomeLabel(row.outcome)}
                    </span>
                  ))
                )}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}
