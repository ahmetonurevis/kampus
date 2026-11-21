import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {
  useCancelPayRate,
  useCreatePayRate,
  useEndPayRate,
  usePayRateStaff,
  useStaffPayRates,
  type PayRate,
} from '@kampus/react-shared/use-finance-pay-rates.ts'
import { usePayrollPeriodYear } from '@kampus/react-shared/use-finance-payroll-periods.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  BENEFIT_FORM_LABELS,
  BENEFIT_FORMS,
  PAY_RATE_COMPONENT_LABELS,
  PAY_RATE_COMPONENTS,
  PAY_RATE_STATE_LABELS,
  PAY_RATE_TYPE_LABELS,
  payRateCancelSchema,
  type PayRateComponent,
} from '@kampus/school-core/lib/finance-pay-rates.ts'
import {
  lockedMonthsIn,
  payrollMonthLabel,
} from '@kampus/school-core/lib/finance-payroll-periods.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { roleLabel } from './finance-fixed-asset-assignment-forms.ts'
import {
  AMOUNT_MASK,
  amountText,
  firstRateType,
  latestRateIds,
  payRateBody,
  payRateDefaults,
  payRateFormField,
  payRateFormSchema,
  periodText,
  RATE_TYPES_BY_COMPONENT,
  rateTitle,
  type PayRateFormValues,
} from './finance-pay-rate-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['name', 'wage']
const STATUS_OPTIONS = [
  { value: 'active', label: 'Etkin' },
  { value: 'passive', label: 'Pasif (ayrılan)' },
]
const FILTERS = [
  { key: 'status', label: 'Personel durumu', type: 'select' as const, options: STATUS_OPTIONS },
]
const STATE_TONES = { scheduled: 'purple', active: 'green', ended: 'gray' } as const
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)

type Row = {
  id: string
  name: string
  role: string
  active: boolean
  wage: string
  extras: string
}

/**
 * Ücret tanımları (DOM-FIN-099; ON-194): Finans "Ücret tanımları" sekmesi, yalnız yönetici (K-306).
 * Personel listesi varsayılan maskelidir; "Tutarları göster" tutarları ister ve okuma denetime
 * düşer (K-307). Personel panelinde geçmiş, bugün geçerli tanımlar, yeni tanım, son tanımın bitişi
 * ve iptali bulunur. Tutarlar adrese ve kalıcı depoya yazılmaz.
 */
export function FinancePayRatesSection() {
  const list = useListState('ucret-tanimi', { urlPrefix: 'ucret_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = text(list.state.filters.status)
  const [showAmounts, setShowAmounts] = useState(false)
  const staff = usePayRateStaff({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(status === 'active' || status === 'passive' ? { status } : {}),
    ...(showAmounts ? { showAmounts: 'true' as const } : {}),
  })
  const panel = useDetailPanel('ucret_personel')
  const openPerson = panel.open
  const rows = useMemo(
    () =>
      staff.data?.data.map((item): Row => ({
        id: item.membershipId,
        name: item.name,
        role: roleLabel(item.role),
        active: item.active,
        wage:
          item.wage === null
            ? 'Tanım yok'
            : `${PAY_RATE_TYPE_LABELS[item.wage.rateType]} · ${
                item.wage.amountCents === null
                  ? AMOUNT_MASK
                  : amountText({
                      component: 'wage',
                      rateType: item.wage.rateType,
                      amountCents: item.wage.amountCents,
                      benefitForm: null,
                      taxable: null,
                    })
              }`,
        extras: `${String(item.lessonRateCount)} ek ders · ${String(item.benefitCount)} yan hak`,
      })),
    [staff.data],
  )
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'name', label: 'Ad' },
      { key: 'role', label: 'Rol' },
      {
        key: 'active',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge
            text={row.active ? 'Etkin' : 'Pasif'}
            tone={row.active ? 'green' : 'amber'}
          />
        ),
      },
      { key: 'wage', label: 'Bugünkü ana ücret' },
      { key: 'extras', label: 'Ek ders ve yan hak' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row: Row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.name} ücret tanımlarını aç`}
            onClick={() => openPerson(row.id)}
          >
            Ücretler
          </Button>
        ),
      },
    ],
    [openPerson],
  )
  return (
    <section
      aria-labelledby="ucret-tanimlari"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h2 id="ucret-tanimlari" className="text-lg font-semibold">
            Ücret tanımları
          </h2>
          <p className="text-sm text-muted-foreground">
            Ücret kişisel veridir: tutarlar varsayılan gizlidir, her görüntüleme denetim kaydına
            yazılır.
          </p>
        </div>
        <Button
          variant="secondary"
          aria-pressed={showAmounts}
          onClick={() => setShowAmounts((value) => !value)}
        >
          {showAmounts ? 'Tutarları gizle' : 'Tutarları göster'}
        </Button>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={staff.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={FILTERS}
        mobileColumns={MOBILE}
        caption="Personel ücret tanımları"
        empty="Kurumda personel yok."
        emptyFiltered="Bu seçimle eşleşen personel yok."
        loading={staff.isPending}
        fetching={staff.isFetching && !staff.isPending}
        error={
          staff.error ? (
            <QueryError error={staff.error} onRetry={() => void staff.refetch()} />
          ) : undefined
        }
      />
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Personel ücreti"
      >
        {panel.selectedId ? <StaffPayRates membershipId={panel.selectedId} /> : null}
      </SidePanel>
    </section>
  )
}

type Dialog =
  { kind: 'create' } | { kind: 'end'; rate: PayRate } | { kind: 'cancel'; rate: PayRate } | null

function StaffPayRates({ membershipId }: { membershipId: string }) {
  const [date, setDate] = useState('')
  const on = daySchema.safeParse(date).success ? date : undefined
  const detail = useStaffPayRates(membershipId, on)
  const [dialog, setDialog] = useState<Dialog>(null)
  if (detail.error) return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
  const data = detail.data?.data
  if (!data) return <SummaryLoading />
  const latest = latestRateIds(data.rates)
  const history = [...data.rates].sort(
    (a, b) =>
      PAY_RATE_COMPONENTS.indexOf(a.component) - PAY_RATE_COMPONENTS.indexOf(b.component) ||
      b.startDate.localeCompare(a.startDate),
  )
  const close = () => setDialog(null)
  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <h3 className="text-base font-semibold">{data.name}</h3>
        <p className="text-sm text-muted-foreground">
          {roleLabel(data.role)}
          {data.active ? '' : ' · pasif (ayrılan)'}
        </p>
      </div>
      <section aria-labelledby="ucret-gecerli" className="grid gap-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h4 id="ucret-gecerli" className="text-sm font-semibold">
            {on === undefined ? 'Bugün geçerli ücret' : 'Seçilen gün geçerli ücret'}
          </h4>
          <FormField id="ucret-gun" label="Geçerli ücret günü">
            {(control) => (
              <Input
                {...control}
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            )}
          </FormField>
        </div>
        {data.effective.length === 0 ? (
          <p className="text-sm text-muted-foreground">Bu gün yürürlükte tanım yok.</p>
        ) : (
          <ul aria-label="Geçerli ücret" className="grid gap-1 text-sm">
            {data.effective.map((rate) => (
              <li key={rate.id} className="[overflow-wrap:anywhere]">
                <span className="font-medium">{rateTitle(rate)}</span>: {amountText(rate)}
              </li>
            ))}
          </ul>
        )}
      </section>
      <div>
        <Button onClick={() => setDialog({ kind: 'create' })} disabled={!data.active}>
          Yeni tanım
        </Button>
        {data.active ? null : (
          <p className="mt-1 text-sm text-muted-foreground">Pasif personele yeni tanım yapılmaz.</p>
        )}
      </div>
      <section aria-labelledby="ucret-gecmis" className="grid gap-2">
        <h4 id="ucret-gecmis" className="text-sm font-semibold">
          Ücret geçmişi
        </h4>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Henüz ücret tanımı yok.</p>
        ) : (
          <ul aria-label="Ücret geçmişi" className="grid gap-2 text-sm">
            {history.map((rate) => (
              <li
                key={rate.id}
                aria-label={`${rateTitle(rate)}, ${periodText(rate)}`}
                className="grid gap-1 rounded-sm border px-3 py-2"
              >
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {rateTitle(rate)}
                  <StatusBadge
                    text={PAY_RATE_STATE_LABELS[rate.state]}
                    tone={STATE_TONES[rate.state]}
                  />
                </span>
                <span>{amountText(rate)}</span>
                <span className="text-muted-foreground">
                  {periodText(rate)}
                  {rate.autoClosed ? ' · sonraki tanımla kapandı' : ''}
                </span>
                {rate.note ? (
                  <span className="text-muted-foreground [overflow-wrap:anywhere]">
                    {rate.note}
                  </span>
                ) : null}
                {latest.has(rate.id) ? (
                  <span className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setDialog({ kind: 'end', rate })}
                    >
                      Bitişi değiştir
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setDialog({ kind: 'cancel', rate })}
                    >
                      İptal et
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      <Modal
        open={dialog?.kind === 'create'}
        onOpenChange={(open) => (open ? undefined : close())}
        title="Yeni ücret tanımı"
        description={`${data.name} için yürürlük tarihli tanım. Aynı türün yürürlükteki tanımı yeni başlangıçtan bir gün önce kendiliğinden kapanır.`}
      >
        {dialog?.kind === 'create' ? (
          <CreateForm membershipId={membershipId} onDone={close} />
        ) : null}
      </Modal>
      <Modal
        open={dialog?.kind === 'end'}
        onOpenChange={(open) => (open ? undefined : close())}
        title="Bitişi değiştir"
      >
        {dialog?.kind === 'end' ? <EndForm rate={dialog.rate} onDone={close} /> : null}
      </Modal>
      <Modal
        open={dialog?.kind === 'cancel'}
        onOpenChange={(open) => (open ? undefined : close())}
        title="Ücret tanımını iptal et"
      >
        {dialog?.kind === 'cancel' ? <CancelForm rate={dialog.rate} onDone={close} /> : null}
      </Modal>
    </div>
  )
}

/** Yeni tanım (K-304, K-305): bileşen, tür, tutar, yürürlük; yan hakta nakdi/ayni ve vergi. */
function CreateForm({ membershipId, onDone }: { membershipId: string; onDone: () => void }) {
  const create = useCreatePayRate()
  const schema = useMemo(() => payRateFormSchema(membershipId), [membershipId])
  const form = useForm<PayRateFormValues>({
    resolver: zodResolver(schema),
    defaultValues: payRateDefaults(dayKey()),
  })
  const errors = form.formState.errors
  const busy = create.isPending || form.formState.isSubmitting
  const component = useWatch({ control: form.control, name: 'component' })
  const lockedWarning = useLockedMonthWarning(
    useWatch({ control: form.control, name: 'startDate' }),
    useWatch({ control: form.control, name: 'endDate' }),
  )
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(payRateBody(membershipId, values), {
      setError: (name, error) => {
        const field = payRateFormField(name)
        if (field) form.setError(field, error, { shouldFocus: true })
        else form.setError('root.server', error)
      },
    })
    if (outcome.status !== 'success') return
    const closed = outcome.data.data.closedRate
    notify.success(
      closed === null
        ? 'Ücret tanımı kaydedildi.'
        : `Ücret tanımı kaydedildi; önceki tanım ${periodText(closed)} olarak kapandı.`,
    )
    onDone()
  })
  const typeField = form.register('rateType')
  const componentField = form.register('component')
  return (
    <form
      noValidate
      aria-label="Ücret tanımı"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="ucret-bilesen" label="Tanım" error={errors.component}>
        {(control) => (
          <NativeSelect
            {...control}
            {...componentField}
            onChange={(event) => {
              void componentField.onChange(event)
              form.setValue('rateType', firstRateType(event.target.value as PayRateComponent))
            }}
            className="w-full"
            disabled={busy}
          >
            {PAY_RATE_COMPONENTS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {PAY_RATE_COMPONENT_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="ucret-tur" label="Tür" error={errors.rateType}>
        {(control) => (
          <NativeSelect {...control} {...typeField} className="w-full" disabled={busy}>
            {RATE_TYPES_BY_COMPONENT[component].map((value) => (
              <NativeSelectOption key={value} value={value}>
                {PAY_RATE_TYPE_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField
        id="ucret-tutar"
        label="Tutar (₺)"
        error={errors.amount}
        description={
          component === 'wage'
            ? 'Türün birimiyle: aylık, saat ya da ders saati başı.'
            : component === 'lesson'
              ? 'Saat başı.'
              : 'Aylık.'
        }
      >
        {(control) => (
          <Input
            {...control}
            inputMode="decimal"
            autoComplete="off"
            {...form.register('amount')}
            disabled={busy}
          />
        )}
      </FormField>
      {component === 'benefit' ? (
        <>
          <FormField id="ucret-bicim" label="Nakdi ya da ayni" error={errors.benefitForm}>
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('benefitForm')}
                className="w-full"
                disabled={busy}
              >
                {BENEFIT_FORMS.map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {BENEFIT_FORM_LABELS[value]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField id="ucret-vergi" label="Vergi" error={errors.taxable}>
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('taxable')}
                className="w-full"
                disabled={busy}
              >
                <NativeSelectOption value="true">Vergiye tabi</NativeSelectOption>
                <NativeSelectOption value="false">Vergiden istisna</NativeSelectOption>
              </NativeSelect>
            )}
          </FormField>
        </>
      ) : null}
      <FormField id="ucret-baslangic" label="Yürürlük başlangıcı" error={errors.startDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('startDate')} disabled={busy} />
        )}
      </FormField>
      <FormField id="ucret-bitis" label="Bitiş (isteğe bağlı)" error={errors.endDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('endDate')} disabled={busy} />
        )}
      </FormField>
      {lockedWarning === null ? null : (
        <p role="note" className="rounded-lg border p-3 text-sm text-warning sm:col-span-2">
          {lockedWarning}
        </p>
      )}
      <div className="sm:col-span-2">
        <FormField id="ucret-not" label="Not (isteğe bağlı)" error={errors.note}>
          {(control) => (
            <Textarea {...control} {...form.register('note')} rows={2} disabled={busy} />
          )}
        </FormField>
      </div>
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Kaydet
        </Button>
      </div>
    </form>
  )
}

/**
 * Kilitli ay uyarısı (DOM-FIN-108, K-357): seçilen yürürlük onaylı bordro ayına düşüyorsa form
 * kaydetmeden önce uyarır; asıl denetim sunucudadır (409 `payroll_period_locked`).
 */
function useLockedMonthWarning(startDate: string, endDate: string): string | null {
  const periods = usePayrollPeriodYear(undefined)
  const locked = periods.data?.data.lockedMonths ?? []
  if (locked.length === 0 || !daySchema.safeParse(startDate).success) return null
  const to = daySchema.safeParse(endDate).success ? endDate : null
  const touched = lockedMonthsIn(locked, { from: startDate, to })
  if (touched.length === 0) return null
  return `Bu tanım onaylanmış bordro ayına düşüyor (${touched.map(payrollMonthLabel).join(', ')}); kilitli ay değiştirilemez. Düzeltme için Bordro dönemleri sekmesinden düzeltme kaydı girin ya da dönemi yeniden açın.`
}

/** Son tanımın bitişi (K-304): boş bırakılırsa süresiz. */
function EndForm({ rate, onDone }: { rate: PayRate; onDone: () => void }) {
  const end = useEndPayRate()
  const [value, setValue] = useState(rate.endDate ?? '')
  const [error, setError] = useState<string | undefined>(undefined)
  const busy = end.isPending
  const submit = async () => {
    setError(undefined)
    if (value !== '' && !daySchema.safeParse(value).success) {
      setError('Geçerli bir tarih seçin.')
      return
    }
    const outcome = await end.submit(
      { rateId: rate.id, version: rate.version, endDate: value === '' ? null : value },
      { setError: (_name, issue) => setError(issue.message) },
    )
    if (outcome.status !== 'success') return
    notify.success('Bitiş günü kaydedildi.')
    onDone()
  }
  return (
    <form
      noValidate
      aria-label="Bitiş günü"
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <p className="text-sm">
        {rateTitle(rate)} · {periodText(rate)}
      </p>
      <FormField
        id="ucret-yeni-bitis"
        label="Bitiş günü"
        description="Boş bırakırsanız tanım süresiz olur."
        error={error === undefined ? undefined : { message: error }}
      >
        {(control) => (
          <Input
            {...control}
            type="date"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={busy}
          />
        )}
      </FormField>
      <div>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Kaydet
        </Button>
      </div>
    </form>
  )
}

/** Son tanımı gerekçeyle iptal (K-304); kapattığı tanımın eski bitişi geri yazılır. */
function CancelForm({ rate, onDone }: { rate: PayRate; onDone: () => void }) {
  const cancel = useCancelPayRate()
  const form = useForm<{ reason: string }>({
    resolver: zodResolver(payRateCancelSchema),
    defaultValues: { reason: '' },
  })
  const errors = form.formState.errors
  const busy = cancel.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await cancel.submit(
      { rateId: rate.id, version: rate.version, reason: values.reason },
      {
        setError: (name, error) => {
          if (name === 'reason') form.setError('reason', error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status !== 'success') return
    notify.success(
      outcome.data.data.reopenedRate === null
        ? 'Ücret tanımı iptal edildi.'
        : 'Ücret tanımı iptal edildi; önceki tanımın bitişi geri alındı.',
    )
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="İptal gerekçesi"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <p className="text-sm">
        {rateTitle(rate)} · {amountText(rate)} · {periodText(rate)}
      </p>
      <FormField id="ucret-iptal" label="Gerekçe" error={errors.reason}>
        {(control) => (
          <Textarea {...control} {...form.register('reason')} rows={2} disabled={busy} />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <div>
        <Button type="submit" variant="destructive" disabled={busy} aria-busy={busy || undefined}>
          İptal et
        </Button>
      </div>
    </form>
  )
}
