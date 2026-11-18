import { useId, useMemo, useState, type ReactNode } from 'react'
import { useForm, type FieldErrors, type Resolver } from 'react-hook-form'
import {
  useCancelStaffAdvance,
  useCloseStaffAdvance,
  useCloseStaffGarnishment,
  useCreateStaffAdvance,
  useCreateStaffGarnishment,
  useCreateStaffPension,
  useMonthlyDeductionPreview,
  useOptOutStaffPension,
  usePauseStaffPension,
  useStaffDeductions,
  useStaffDeductionStaff,
  useUpdateStaffGarnishment,
  type MonthlyDeductionResult,
  type StaffAdvance,
  type StaffDeductions,
  type StaffGarnishment,
  type StaffPension,
} from '@kampus/react-shared/use-finance-staff-deductions.ts'
import {
  MONTHLY_DEDUCTION_KIND_LABELS,
  MONTHLY_DEDUCTION_STATUS_LABELS,
  monthOf,
  rateLabel,
  STAFF_ADVANCE_PAYMENT_METHOD_LABELS,
  STAFF_ADVANCE_STATUS_LABELS,
  STAFF_GARNISHMENT_CLOSE_REASON_LABELS,
  STAFF_PENSION_OPT_OUT_KIND_LABELS,
  STAFF_PENSION_STATE_LABELS,
} from '@kampus/school-core/lib/finance-staff-deductions.ts'
import { dateLabel, dayKey, money } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
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
  advanceCancelForm,
  advanceCloseForm,
  advanceForm,
  basisPointsText,
  fieldOf,
  garnishmentBalanceForm,
  garnishmentCloseForm,
  garnishmentForm,
  pensionForm,
  pensionOptOutForm,
  pensionPauseForm,
  previewForm,
  validateDeductionForm,
  type DeductionFormSpec,
  type FormValues,
} from './finance-staff-deduction-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['name', 'summary']
const STATUS_OPTIONS = [
  { value: 'active', label: 'Etkin' },
  { value: 'passive', label: 'Pasif (ayrılan)' },
]
const HOLDING_OPTIONS = [{ value: 'true', label: 'Açık kaydı olanlar' }]
const FILTERS = [
  { key: 'status', label: 'Personel durumu', type: 'select' as const, options: STATUS_OPTIONS },
  { key: 'holding', label: 'Kesinti', type: 'select' as const, options: HOLDING_OPTIONS },
]
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const monthText = (month: string) =>
  dateLabel(`${month}-15T09:00:00.000Z`, { month: 'long', year: 'numeric' })
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)

type Row = { id: string; name: string; role: string; active: boolean; summary: string }

/**
 * Avans ve kesintiler (DOM-FIN-101; ON-199): personel listesi, açık avans, icra ve BES sayılarıyla;
 * satırdan sağ panelde personelin avansları (taksit planı), icraları (sırası), BES katılımı, yeni
 * kayıt formları ve ay için kesinti listesi. Yalnız yönetici (K-315); icra okuması denetlenir.
 */
export function FinanceStaffDeductionsSection() {
  const list = useListState('avans-kesinti', { urlPrefix: 'kesinti_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = text(list.state.filters.status)
  const holding = text(list.state.filters.holding)
  const staff = useStaffDeductionStaff({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(status === 'active' || status === 'passive' ? { status } : {}),
    ...(holding === 'true' ? { holding } : {}),
  })
  const panel = useDetailPanel('kesinti_personel')
  const openPerson = panel.open
  const rows = useMemo(
    () =>
      staff.data?.data.map((item): Row => ({
        id: item.membershipId,
        name: item.name,
        role: roleLabel(item.role),
        active: item.active,
        summary: [
          `${String(item.activeAdvanceCount)} avans`,
          `${String(item.activeGarnishmentCount)} icra`,
          item.openPensionCount > 0 ? 'BES var' : 'BES yok',
        ].join(' · '),
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
      { key: 'summary', label: 'Açık kayıtlar' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row: Row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.name} kesintilerini aç`}
            onClick={() => openPerson(row.id)}
          >
            Kesintiler
          </Button>
        ),
      },
    ],
    [openPerson],
  )
  return (
    <section
      aria-labelledby="avans-kesintiler"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading px-6 pt-6 pb-2">
        <h2 id="avans-kesintiler" className="text-lg font-semibold">
          Avans ve kesintiler
        </h2>
        <p className="text-sm text-muted-foreground">
          Avans taksitleri, icra ve BES kesintileri bordroya girmeden önce burada izlenir. İcra
          bilgisi hassastır; görüntülemeler kayda alınır.
        </p>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={staff.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={FILTERS}
        mobileColumns={MOBILE}
        caption="Avans ve kesinti personeli"
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
        title="Avans ve kesintiler"
      >
        {panel.selectedId ? <StaffDeductionsDetail membershipId={panel.selectedId} /> : null}
      </SidePanel>
    </section>
  )
}

type Opened =
  | { form: 'advance' | 'garnishment' | 'pension' }
  | { form: 'advanceClose' | 'advanceCancel'; record: StaffAdvance }
  | { form: 'garnishmentBalance' | 'garnishmentClose'; record: StaffGarnishment }
  | { form: 'pensionPause' | 'pensionOptOut'; record: StaffPension }
  | null

function StaffDeductionsDetail({ membershipId }: { membershipId: string }) {
  const detail = useStaffDeductions(membershipId)
  const [opened, setOpened] = useState<Opened>(null)
  if (detail.error) return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
  const data = detail.data?.data
  if (!data) return <SummaryLoading />
  const close = () => setOpened(null)
  const hasOpenPension = data.pensions.some((item) => item.optOutDate === null)
  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h3 className="text-base font-semibold">{data.staff.name}</h3>
        <p className="text-sm text-muted-foreground">
          {roleLabel(data.staff.role)}
          {data.staff.active ? '' : ' · pasif: yeni kesinti yazılamaz'}
        </p>
      </div>

      <section aria-labelledby="avanslar" className="grid gap-3">
        <SectionHeading id="avanslar" title="Avanslar">
          {data.staff.active ? (
            <Button size="sm" variant="secondary" onClick={() => setOpened({ form: 'advance' })}>
              Yeni avans
            </Button>
          ) : null}
        </SectionHeading>
        {opened?.form === 'advance' ? (
          <AdvanceCreate membershipId={membershipId} onDone={close} />
        ) : null}
        <AdvanceList items={data.advances} opened={opened} onOpen={setOpened} onDone={close} />
      </section>

      <section aria-labelledby="icralar" className="grid gap-3">
        <SectionHeading id="icralar" title="İcra kesintileri">
          {data.staff.active ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setOpened({ form: 'garnishment' })}
            >
              Yeni icra
            </Button>
          ) : null}
        </SectionHeading>
        {opened?.form === 'garnishment' ? (
          <GarnishmentCreate membershipId={membershipId} onDone={close} />
        ) : null}
        <GarnishmentList
          items={data.garnishments}
          opened={opened}
          onOpen={setOpened}
          onDone={close}
        />
      </section>

      <section aria-labelledby="bes" className="grid gap-3">
        <SectionHeading id="bes" title="BES otomatik katılım">
          {data.staff.active && !hasOpenPension ? (
            <Button size="sm" variant="secondary" onClick={() => setOpened({ form: 'pension' })}>
              BES katılımı ekle
            </Button>
          ) : null}
        </SectionHeading>
        {opened?.form === 'pension' ? (
          <PensionCreate membershipId={membershipId} onDone={close} />
        ) : null}
        <PensionList items={data.pensions} opened={opened} onOpen={setOpened} onDone={close} />
      </section>

      <MonthPreview membershipId={membershipId} data={data} />
    </div>
  )
}

function SectionHeading({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
      <h4 id={id} className="text-sm font-semibold">
        {title}
      </h4>
      {children}
    </div>
  )
}

// --- Genel form ----------------------------------------------------------------------------------

type SubmitResult = { status: string }
type SetServerError = (name: string, error: { type: string; message: string }) => void

/**
 * Core şemalı küçük form (react-hook-form): değerler düz metin, gövde `validateDeductionForm` ile
 * kurulur; sunucu alan hatası aynı alana, karşılığı olmayan hata forma döner.
 */
function DeductionForm({
  spec,
  defaults,
  hidden = {},
  busy,
  onSubmit,
  onCancel,
}: {
  spec: DeductionFormSpec
  defaults: FormValues
  hidden?: FormValues
  busy: boolean
  onSubmit: (body: Record<string, unknown>, setError: SetServerError) => Promise<SubmitResult>
  onCancel?: () => void
}) {
  const prefix = useId()
  const resolver: Resolver<FormValues> = (values) => {
    const { errors } = validateDeductionForm(spec, { ...values, ...hidden })
    const entries = Object.entries(errors)
    if (entries.length === 0) return { values, errors: {} }
    return {
      values: {},
      errors: Object.fromEntries(
        entries.map(([name, message]) => [name, { type: 'validate', message }]),
      ) as FieldErrors<FormValues>,
    }
  }
  const form = useForm<FormValues>({ defaultValues: defaults, resolver })
  const errors = form.formState.errors
  const locked = busy || form.formState.isSubmitting
  const submit = form.handleSubmit(async (values) => {
    const { body } = validateDeductionForm(spec, { ...values, ...hidden })
    await onSubmit(body, (name, error) => {
      const field = fieldOf(spec, name)
      if (field) form.setError(field, error, { shouldFocus: true })
      else form.setError('root.server', error)
    })
  })
  const rootMessage = errors.root?.server?.message ?? errors.root?.message
  return (
    <form
      noValidate
      aria-label={spec.title}
      className="grid gap-3 rounded-sm border px-3 py-3"
      onSubmit={(event) => void submit(event)}
    >
      <p className="text-sm font-semibold">{spec.title}</p>
      {spec.fields.map((field) => {
        const id = `${prefix}-${field.name}`
        return (
          <FormField
            key={field.name}
            id={id}
            label={field.label}
            error={errors[field.name]}
            {...(field.description ? { description: field.description } : {})}
          >
            {(control) =>
              field.kind === 'select' ? (
                <NativeSelect
                  {...control}
                  {...form.register(field.name)}
                  className="w-full"
                  disabled={locked}
                >
                  {(field.options ?? []).map((option) => (
                    <NativeSelectOption key={option.value} value={option.value}>
                      {option.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              ) : field.kind === 'textarea' ? (
                <Textarea {...control} {...form.register(field.name)} rows={2} disabled={locked} />
              ) : (
                <Input
                  {...control}
                  {...form.register(field.name)}
                  type={
                    field.kind === 'date'
                      ? 'date'
                      : field.kind === 'month'
                        ? 'month'
                        : field.kind === 'number'
                          ? 'number'
                          : 'text'
                  }
                  {...(field.kind === 'amount' ? { inputMode: 'decimal' as const } : {})}
                  {...(field.kind === 'number' ? { min: 1, max: 24 } : {})}
                  disabled={locked}
                />
              )
            }
          </FormField>
        )
      })}
      <RootError message={rootMessage} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={locked} aria-busy={locked || undefined}>
          {spec.submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={locked}>
            Vazgeç
          </Button>
        ) : null}
      </div>
    </form>
  )
}

// --- Avans ---------------------------------------------------------------------------------------

function AdvanceCreate({ membershipId, onDone }: { membershipId: string; onDone: () => void }) {
  const create = useCreateStaffAdvance()
  const today = dayKey()
  return (
    <DeductionForm
      spec={advanceForm}
      defaults={{
        amount: '',
        givenDate: today,
        paymentMethod: 'bank_transfer',
        installmentCount: '1',
        firstMonth: monthOf(today),
      }}
      hidden={{ membershipId }}
      busy={create.isPending}
      onCancel={onDone}
      onSubmit={async (body, setError) => {
        const outcome = await create.submit(body as Parameters<typeof create.submit>[0], {
          setError,
        })
        if (outcome.status === 'success') {
          notify.success('Avans kaydedildi.')
          onDone()
        }
        return outcome
      }}
    />
  )
}

const ADVANCE_TONES = { active: 'green', closed: 'gray', cancelled: 'amber' } as const
const INSTALLMENT_STATE_LABELS = {
  past: 'Geçmiş ay',
  current: 'Bu ay',
  upcoming: 'Gelecek',
  closed: 'Erken kapandı',
  cancelled: 'İptal',
} as const

function AdvanceList({
  items,
  opened,
  onOpen,
  onDone,
}: {
  items: readonly StaffAdvance[]
  opened: Opened
  onOpen: (opened: Opened) => void
  onDone: () => void
}) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">Avans yok.</p>
  return (
    <ul aria-label="Avanslar" className="grid gap-2 text-sm">
      {items.map((item) => {
        const editing = opened !== null && 'record' in opened && opened.record.id === item.id
        return (
          <li key={item.id} className="grid gap-2 rounded-sm border px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{money(item.amountCents)}</span>
              <StatusBadge
                text={STAFF_ADVANCE_STATUS_LABELS[item.status]}
                tone={ADVANCE_TONES[item.status]}
              />
            </div>
            <span className="text-muted-foreground">
              {dayText(item.givenDate)} · {STAFF_ADVANCE_PAYMENT_METHOD_LABELS[item.paymentMethod]}{' '}
              · {String(item.installmentCount)} taksit · kalan {money(item.outstandingCents)}
              {item.closedRemainderCents === null
                ? ''
                : ` · erken ödenen ${money(item.closedRemainderCents)}`}
            </span>
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Taksit planı</caption>
              <thead>
                <tr>
                  <th scope="col" className="font-medium">
                    Ay
                  </th>
                  <th scope="col" className="font-medium">
                    Taksit
                  </th>
                  <th scope="col" className="font-medium">
                    Durum
                  </th>
                </tr>
              </thead>
              <tbody>
                {item.installments.map((installment) => (
                  <tr key={installment.month}>
                    <td>{monthText(installment.month)}</td>
                    <td>{money(installment.amountCents)}</td>
                    <td>{INSTALLMENT_STATE_LABELS[installment.state]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {item.status === 'active' && !editing ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onOpen({ form: 'advanceClose', record: item })}
                >
                  Erken kapat
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onOpen({ form: 'advanceCancel', record: item })}
                >
                  İptal et
                </Button>
              </div>
            ) : null}
            {editing && opened.form === 'advanceClose' ? (
              <AdvanceClose advance={item} onDone={onDone} />
            ) : null}
            {editing && opened.form === 'advanceCancel' ? (
              <AdvanceCancel advance={item} onDone={onDone} />
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

function AdvanceClose({ advance, onDone }: { advance: StaffAdvance; onDone: () => void }) {
  const command = useCloseStaffAdvance()
  const today = dayKey()
  const next = advance.installments.find((item) => item.state === 'upcoming')?.month
  return (
    <DeductionForm
      spec={advanceCloseForm}
      defaults={{ closedDate: today, fromMonth: next ?? monthOf(today), method: 'cash' }}
      busy={command.isPending}
      onCancel={onDone}
      onSubmit={async (body, setError) => {
        const outcome = await command.submit(
          {
            id: advance.id,
            version: advance.version,
            body: body as Parameters<typeof command.submit>[0]['body'],
          },
          { setError },
        )
        if (outcome.status === 'success') {
          notify.success('Avans erken kapatıldı.')
          onDone()
        }
        return outcome
      }}
    />
  )
}

function AdvanceCancel({ advance, onDone }: { advance: StaffAdvance; onDone: () => void }) {
  const command = useCancelStaffAdvance()
  return (
    <DeductionForm
      spec={advanceCancelForm}
      defaults={{ reason: '' }}
      busy={command.isPending}
      onCancel={onDone}
      onSubmit={async (body, setError) => {
        const outcome = await command.submit(
          {
            id: advance.id,
            version: advance.version,
            body: body as Parameters<typeof command.submit>[0]['body'],
          },
          { setError },
        )
        if (outcome.status === 'success') {
          notify.success('Avans iptal edildi.')
          onDone()
        }
        return outcome
      }}
    />
  )
}

// --- İcra ----------------------------------------------------------------------------------------

function GarnishmentCreate({ membershipId, onDone }: { membershipId: string; onDone: () => void }) {
  const create = useCreateStaffGarnishment()
  return (
    <DeductionForm
      spec={garnishmentForm}
      defaults={{
        office: '',
        fileNumber: '',
        claim: '',
        rate: '25',
        isAlimony: 'false',
        receivedDate: dayKey(),
      }}
      hidden={{ membershipId }}
      busy={create.isPending}
      onCancel={onDone}
      onSubmit={async (body, setError) => {
        const outcome = await create.submit(body as Parameters<typeof create.submit>[0], {
          setError,
        })
        if (outcome.status === 'success') {
          notify.success('İcra kesintisi kaydedildi.')
          onDone()
        }
        return outcome
      }}
    />
  )
}

function GarnishmentList({
  items,
  opened,
  onOpen,
  onDone,
}: {
  items: readonly StaffGarnishment[]
  opened: Opened
  onOpen: (opened: Opened) => void
  onDone: () => void
}) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">İcra kaydı yok.</p>
  return (
    <ul aria-label="İcra kesintileri" className="grid gap-2 text-sm">
      {items.map((item) => {
        const editing = opened !== null && 'record' in opened && opened.record.id === item.id
        return (
          <li key={item.id} className="grid gap-2 rounded-sm border px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium [overflow-wrap:anywhere]">
                {item.office} · {item.fileNumber}
              </span>
              {item.status === 'closed' ? (
                <StatusBadge text="Kapandı" tone="gray" />
              ) : (
                <StatusBadge
                  text={
                    item.queuePosition === 1 ? 'Kesiliyor' : `${String(item.queuePosition)}. sırada`
                  }
                  tone={item.queuePosition === 1 ? 'green' : 'amber'}
                />
              )}
              {item.isAlimony ? <StatusBadge text="Nafaka" tone="purple" /> : null}
            </div>
            <span className="text-muted-foreground">
              Alacak {money(item.claimCents)} · kalan {money(item.remainingCents)} · oran{' '}
              {rateLabel(item.rateBasisPoints)} · tebliğ {dayText(item.receivedDate)}
              {item.closedDate === null
                ? ''
                : ` · kapanış ${dayText(item.closedDate)} (${
                    item.closeReason ? STAFF_GARNISHMENT_CLOSE_REASON_LABELS[item.closeReason] : ''
                  })`}
            </span>
            {item.status === 'active' && !editing ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onOpen({ form: 'garnishmentBalance', record: item })}
                >
                  Kalanı güncelle
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onOpen({ form: 'garnishmentClose', record: item })}
                >
                  Kapat
                </Button>
              </div>
            ) : null}
            {editing && opened.form === 'garnishmentBalance' ? (
              <GarnishmentUpdate garnishment={item} onDone={onDone} />
            ) : null}
            {editing && opened.form === 'garnishmentClose' ? (
              <GarnishmentClose garnishment={item} onDone={onDone} />
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

const centsText = (cents: number) => (cents / 100).toFixed(2).replace('.', ',')

function GarnishmentUpdate({
  garnishment,
  onDone,
}: {
  garnishment: StaffGarnishment
  onDone: () => void
}) {
  const command = useUpdateStaffGarnishment()
  return (
    <DeductionForm
      spec={garnishmentBalanceForm}
      defaults={{ remaining: centsText(garnishment.remainingCents) }}
      busy={command.isPending}
      onCancel={onDone}
      onSubmit={async (body, setError) => {
        const outcome = await command.submit(
          {
            id: garnishment.id,
            version: garnishment.version,
            body: body as Parameters<typeof command.submit>[0]['body'],
          },
          { setError },
        )
        if (outcome.status === 'success') {
          notify.success('Kalan alacak güncellendi.')
          onDone()
        }
        return outcome
      }}
    />
  )
}

function GarnishmentClose({
  garnishment,
  onDone,
}: {
  garnishment: StaffGarnishment
  onDone: () => void
}) {
  const command = useCloseStaffGarnishment()
  return (
    <DeductionForm
      spec={garnishmentCloseForm}
      defaults={{ closedDate: dayKey(), reason: 'paid_off' }}
      busy={command.isPending}
      onCancel={onDone}
      onSubmit={async (body, setError) => {
        const outcome = await command.submit(
          {
            id: garnishment.id,
            version: garnishment.version,
            body: body as Parameters<typeof command.submit>[0]['body'],
          },
          { setError },
        )
        if (outcome.status === 'success') {
          notify.success('İcra kapatıldı.')
          onDone()
        }
        return outcome
      }}
    />
  )
}

// --- BES -----------------------------------------------------------------------------------------

function PensionCreate({ membershipId, onDone }: { membershipId: string; onDone: () => void }) {
  const create = useCreateStaffPension()
  return (
    <DeductionForm
      spec={pensionForm}
      defaults={{ rate: basisPointsText(300), startDate: dayKey() }}
      hidden={{ membershipId }}
      busy={create.isPending}
      onCancel={onDone}
      onSubmit={async (body, setError) => {
        const outcome = await create.submit(body as Parameters<typeof create.submit>[0], {
          setError,
        })
        if (outcome.status === 'success') {
          notify.success('BES katılımı kaydedildi.')
          onDone()
        }
        return outcome
      }}
    />
  )
}

const PENSION_TONES = {
  scheduled: 'gray',
  active: 'green',
  paused: 'amber',
  opted_out: 'gray',
} as const

function PensionList({
  items,
  opened,
  onOpen,
  onDone,
}: {
  items: readonly StaffPension[]
  opened: Opened
  onOpen: (opened: Opened) => void
  onDone: () => void
}) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">BES katılımı yok.</p>
  return (
    <ul aria-label="BES katılımları" className="grid gap-2 text-sm">
      {items.map((item) => {
        const editing = opened !== null && 'record' in opened && opened.record.id === item.id
        return (
          <li key={item.id} className="grid gap-2 rounded-sm border px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Katkı {rateLabel(item.rateBasisPoints)}</span>
              <StatusBadge
                text={STAFF_PENSION_STATE_LABELS[item.state]}
                tone={PENSION_TONES[item.state]}
              />
            </div>
            <span className="text-muted-foreground">
              Başlangıç {dayText(item.startDate)}
              {item.pauses.map(
                (pause) => ` · ara ${monthText(pause.fromMonth)} – ${monthText(pause.toMonth)}`,
              )}
              {item.optOutDate && item.optOutKind
                ? ` · ${STAFF_PENSION_OPT_OUT_KIND_LABELS[item.optOutKind]} ${dayText(item.optOutDate)}`
                : ''}
            </span>
            {item.optOutDate === null && !editing ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onOpen({ form: 'pensionPause', record: item })}
                >
                  Ara ver
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onOpen({ form: 'pensionOptOut', record: item })}
                >
                  Cayma / ayrılma
                </Button>
              </div>
            ) : null}
            {editing && opened.form === 'pensionPause' ? (
              <PensionPause pension={item} onDone={onDone} />
            ) : null}
            {editing && opened.form === 'pensionOptOut' ? (
              <PensionOptOut pension={item} onDone={onDone} />
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

function PensionPause({ pension, onDone }: { pension: StaffPension; onDone: () => void }) {
  const command = usePauseStaffPension()
  const month = monthOf(dayKey())
  return (
    <DeductionForm
      spec={pensionPauseForm}
      defaults={{ fromMonth: month, toMonth: month }}
      busy={command.isPending}
      onCancel={onDone}
      onSubmit={async (body, setError) => {
        const outcome = await command.submit(
          {
            id: pension.id,
            version: pension.version,
            body: body as Parameters<typeof command.submit>[0]['body'],
          },
          { setError },
        )
        if (outcome.status === 'success') {
          notify.success('BES kesintisine ara verildi.')
          onDone()
        }
        return outcome
      }}
    />
  )
}

function PensionOptOut({ pension, onDone }: { pension: StaffPension; onDone: () => void }) {
  const command = useOptOutStaffPension()
  return (
    <DeductionForm
      spec={pensionOptOutForm}
      defaults={{ optOutDate: dayKey() }}
      busy={command.isPending}
      onCancel={onDone}
      onSubmit={async (body, setError) => {
        const outcome = await command.submit(
          {
            id: pension.id,
            version: pension.version,
            body: body as Parameters<typeof command.submit>[0]['body'],
          },
          { setError },
        )
        if (outcome.status === 'success') {
          notify.success('BES ayrılışı kaydedildi.')
          onDone()
        }
        return outcome
      }}
    />
  )
}

// --- Ay için kesinti listesi ---------------------------------------------------------------------

function sourceLabel(data: StaffDeductions, kind: string, sourceId: string): string {
  if (kind === 'advance') {
    const advance = data.advances.find((item) => item.id === sourceId)
    return advance ? `${dayText(advance.givenDate)} avansı` : 'Avans'
  }
  if (kind === 'garnishment') {
    const garnishment = data.garnishments.find((item) => item.id === sourceId)
    return garnishment ? `${garnishment.office} · ${garnishment.fileNumber}` : 'İcra'
  }
  const pension = data.pensions.find((item) => item.id === sourceId)
  return pension ? `Katkı ${rateLabel(pension.rateBasisPoints)}` : 'BES'
}

/** Ay için kesinti listesi (K-315): net ücret saklanmaz, yalnız hesaplanır. */
function MonthPreview({ membershipId, data }: { membershipId: string; data: StaffDeductions }) {
  const preview = useMonthlyDeductionPreview()
  const [result, setResult] = useState<MonthlyDeductionResult | null>(null)
  return (
    <section aria-labelledby="ay-kesinti" className="grid gap-3">
      <SectionHeading id="ay-kesinti" title="Ay için kesinti listesi" />
      <DeductionForm
        spec={previewForm}
        defaults={{ month: monthOf(dayKey()), net: '', pensionBase: '' }}
        busy={preview.isPending}
        onSubmit={async (body, setError) => {
          try {
            const response = await preview.mutateAsync({
              membershipId,
              body: body as Parameters<typeof preview.mutateAsync>[0]['body'],
            })
            setResult(response.data)
            return { status: 'success' }
          } catch (error) {
            if (!preview.applyToForm(setError))
              notify.error('Kesinti listesi hesaplanamadı.', error)
            return { status: 'error' }
          }
        }}
      />
      {result ? <PreviewTable result={result} data={data} /> : null}
    </section>
  )
}

function PreviewTable({ result, data }: { result: MonthlyDeductionResult; data: StaffDeductions }) {
  if (result.lines.length === 0)
    return (
      <p className="text-sm text-muted-foreground">{monthText(result.month)} için kesinti yok.</p>
    )
  return (
    <div className="grid gap-2 text-sm">
      <table className="w-full text-left">
        <caption className="text-left font-medium">{monthText(result.month)} kesintileri</caption>
        <thead>
          <tr>
            <th scope="col">Sıra</th>
            <th scope="col">Kesinti</th>
            <th scope="col">Tutar</th>
            <th scope="col">Durum</th>
          </tr>
        </thead>
        <tbody>
          {result.lines.map((line) => (
            <tr key={`${line.kind}-${line.sourceId}`}>
              <td>{String(line.order)}</td>
              <td className="[overflow-wrap:anywhere]">
                {MONTHLY_DEDUCTION_KIND_LABELS[line.kind]} ·{' '}
                {sourceLabel(data, line.kind, line.sourceId)}
              </td>
              <td>{line.amountCents === null ? '—' : money(line.amountCents)}</td>
              <td>{MONTHLY_DEDUCTION_STATUS_LABELS[line.status]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Toplam kesinti {money(result.totalCents)}
        {result.remainingNetCents === null
          ? ''
          : ` · net ücretten kalan ${money(result.remainingNetCents)}`}
      </p>
    </div>
  )
}
