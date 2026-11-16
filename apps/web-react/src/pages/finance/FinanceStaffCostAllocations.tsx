import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { useCostCenters } from '@kampus/react-shared/use-finance-budget.ts'
import {
  useCancelStaffCostAllocation,
  useCreateStaffCostAllocation,
  useStaffCostAllocations,
  useStaffCostStaff,
  type StaffCostAllocation,
} from '@kampus/react-shared/use-finance-staff-costs.ts'
import {
  STAFF_COST_MAX_CENTERS,
  monthOf,
  staffCostAllocationCancelSchema,
} from '@kampus/school-core/lib/finance-staff-costs.ts'
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
  allocationHoursText,
  allocationPeriodText,
  sharesText,
  staffCostAllocationBody,
  staffCostAllocationDefaults,
  staffCostAllocationFormSchema,
  staffCostFormField,
  type StaffCostAllocationFormValues,
} from './finance-staff-cost-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['name', 'allocation']
const STATUS_OPTIONS = [
  { value: 'active', label: 'Etkin' },
  { value: 'passive', label: 'Pasif (ayrılan)' },
]
const FILTERS = [
  { key: 'status', label: 'Personel durumu', type: 'select' as const, options: STATUS_OPTIONS },
]
const CENTER_LIST = { page: 1, pageSize: 100, status: 'active' } as const
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)

type Row = { id: string; name: string; role: string; active: boolean; allocation: string }

/**
 * Personelin maliyet merkezi atamaları (DOM-FIN-104; K-332): personel listesi bu ayki atamayla,
 * "Atamalar" paneli geçmişi, yeni atamayı ve iptali taşır. Ücret tutarı göstermez.
 */
export function FinanceStaffCostAllocations() {
  const list = useListState('personel-maliyet', { urlPrefix: 'pm_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = text(list.state.filters.status)
  const staff = useStaffCostStaff({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(status === 'active' || status === 'passive' ? { status } : {}),
  })
  const panel = useDetailPanel('pm_personel')
  const openPerson = panel.open
  const rows = useMemo(
    () =>
      staff.data?.data.map((item): Row => ({
        id: item.membershipId,
        name: item.name,
        role: roleLabel(item.role),
        active: item.active,
        allocation: item.allocation === null ? 'Atama yok' : sharesText(item.allocation),
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
      { key: 'allocation', label: 'Bu ayki merkezler' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row: Row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.name} maliyet merkezi atamalarını aç`}
            onClick={() => openPerson(row.id)}
          >
            Atamalar
          </Button>
        ),
      },
    ],
    [openPerson],
  )
  return (
    <section aria-labelledby="personel-atamalari" className="border-t pt-5">
      <div className="grid gap-1 px-6 pb-2 max-[650px]:px-4">
        <h3 id="personel-atamalari" className="text-base font-semibold">
          Maliyet merkezi atamaları
        </h3>
        <p className="text-sm text-muted-foreground">
          Personel ay başından yürürlüğe giren atamayla merkezlere yüzde payla bağlanır; atama
          sonraki atamaya kadar sürer.
        </p>
      </div>
      <ServerDataTable
        list={list}
        rows={rows}
        total={staff.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={FILTERS}
        mobileColumns={MOBILE}
        caption="Personelin maliyet merkezi atamaları"
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
        title="Maliyet merkezi ataması"
      >
        {panel.selectedId ? <StaffAllocations membershipId={panel.selectedId} /> : null}
      </SidePanel>
    </section>
  )
}

type Dialog = { kind: 'create' } | { kind: 'cancel'; allocation: StaffCostAllocation } | null

function StaffAllocations({ membershipId }: { membershipId: string }) {
  const detail = useStaffCostAllocations(membershipId)
  const [dialog, setDialog] = useState<Dialog>(null)
  if (detail.error) return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
  const data = detail.data?.data
  if (!data) return <SummaryLoading />
  const current = data.allocations.find((item) => item.id === data.currentId) ?? null
  const history = [...data.allocations].reverse()
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
      <div>
        <Button onClick={() => setDialog({ kind: 'create' })}>Yeni atama</Button>
      </div>
      <section aria-labelledby="pm-gecmis" className="grid gap-2">
        <h4 id="pm-gecmis" className="text-sm font-semibold">
          Atamalar
        </h4>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Henüz atama yok.</p>
        ) : (
          <ul aria-label="Atamalar" className="grid gap-2 text-sm">
            {history.map((allocation) => (
              <li
                key={allocation.id}
                aria-label={allocationPeriodText(allocation)}
                className="grid gap-1 rounded-sm border px-3 py-2"
              >
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {allocationPeriodText(allocation)}
                  {allocation.id === data.currentId ? (
                    <StatusBadge text="Bu ay" tone="green" />
                  ) : null}
                </span>
                <span className="[overflow-wrap:anywhere]">{sharesText(allocation)}</span>
                {allocationHoursText(allocation) === '' ? null : (
                  <span className="text-muted-foreground">{allocationHoursText(allocation)}</span>
                )}
                <span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setDialog({ kind: 'cancel', allocation })}
                  >
                    İptal et
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Modal
        open={dialog?.kind === 'create'}
        onOpenChange={(open) => (open ? undefined : close())}
        title="Yeni maliyet merkezi ataması"
        description={`${data.name} için seçilen aydan başlayan atama; sonraki atamaya kadar sürer.`}
      >
        {dialog?.kind === 'create' ? (
          <CreateForm membershipId={membershipId} current={current} onDone={close} />
        ) : null}
      </Modal>
      <Modal
        open={dialog?.kind === 'cancel'}
        onOpenChange={(open) => (open ? undefined : close())}
        title="Atamayı iptal et"
      >
        {dialog?.kind === 'cancel' ? (
          <CancelForm allocation={dialog.allocation} onDone={close} />
        ) : null}
      </Modal>
    </div>
  )
}

/** Yeni atama (K-332): başlangıç ayı, merkez payları (toplam %100), tahmini saatler. */
function CreateForm({
  membershipId,
  current,
  onDone,
}: {
  membershipId: string
  current: StaffCostAllocation | null
  onDone: () => void
}) {
  const create = useCreateStaffCostAllocation()
  const centers = useCostCenters(CENTER_LIST)
  const form = useForm<StaffCostAllocationFormValues>({
    resolver: zodResolver(staffCostAllocationFormSchema),
    defaultValues: staffCostAllocationDefaults(monthOf(dayKey()), current),
  })
  const shares = useFieldArray({ control: form.control, name: 'shares' })
  const errors = form.formState.errors
  const busy = create.isPending || form.formState.isSubmitting
  const options = centers.data?.data ?? []
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(staffCostAllocationBody(membershipId, values), {
      setError: (name, error) => {
        const field = staffCostFormField(name)
        if (field) form.setError(field, error, { shouldFocus: true })
        else form.setError('root.server', error)
      },
    })
    if (outcome.status !== 'success') return
    notify.success('Atama kaydedildi.')
    onDone()
  })
  if (centers.error)
    return <QueryError error={centers.error} onRetry={() => void centers.refetch()} />
  return (
    <form
      noValidate
      aria-label="Maliyet merkezi ataması"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      {centers.data && options.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Etkin maliyet merkezi yok; önce "Bütçe" sekmesinden merkez ekleyin.
        </p>
      ) : null}
      <FormField id="pm-baslangic" label="Başlangıç ayı" error={errors.startMonth}>
        {(control) => (
          <Input {...control} type="month" {...form.register('startMonth')} disabled={busy} />
        )}
      </FormField>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Merkezler ve paylar</legend>
        {shares.fields.map((field, index) => {
          const shareErrors = errors.shares?.[index]
          const ordinal = String(index + 1)
          return (
            <div key={field.id} className="grid gap-2 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
              <FormField
                id={`pm-merkez-${ordinal}`}
                label={`${ordinal}. merkez`}
                error={shareErrors?.costCenterId}
              >
                {(control) => (
                  <NativeSelect
                    {...control}
                    {...form.register(`shares.${index}.costCenterId`)}
                    className="w-full"
                    disabled={busy}
                  >
                    <NativeSelectOption value="">Merkez seçin</NativeSelectOption>
                    {options.map((center) => (
                      <NativeSelectOption key={center.id} value={center.id}>
                        {`${center.code} · ${center.name}`}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
              <FormField
                id={`pm-pay-${ordinal}`}
                label={`${ordinal}. pay (%)`}
                error={shareErrors?.percent}
              >
                {(control) => (
                  <Input
                    {...control}
                    inputMode="decimal"
                    autoComplete="off"
                    {...form.register(`shares.${index}.percent`)}
                    disabled={busy}
                  />
                )}
              </FormField>
              <Button
                type="button"
                variant="ghost"
                aria-label={`${ordinal}. merkezi çıkar`}
                disabled={busy || shares.fields.length === 1}
                onClick={() => shares.remove(index)}
              >
                Çıkar
              </Button>
            </div>
          )
        })}
        {errors.shares?.message ? (
          <p role="alert" className="text-sm text-destructive">
            {errors.shares.message}
          </p>
        ) : null}
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={busy || shares.fields.length >= STAFF_COST_MAX_CENTERS}
            onClick={() => shares.append({ costCenterId: '', percent: '' })}
          >
            Merkez ekle
          </Button>
        </div>
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-1 text-sm font-medium">
          Tahmini aylık saat (yalnız saatli ücretlerde; boşsa o ücret rapora girmez)
        </legend>
        <FormField id="pm-saat-ana" label="Ana ücret saati" error={errors.wageHours}>
          {(control) => (
            <Input
              {...control}
              inputMode="numeric"
              {...form.register('wageHours')}
              disabled={busy}
            />
          )}
        </FormField>
        <FormField id="pm-saat-ek" label="Ek ders saati" error={errors.extraLessonHours}>
          {(control) => (
            <Input
              {...control}
              inputMode="numeric"
              {...form.register('extraLessonHours')}
              disabled={busy}
            />
          )}
        </FormField>
        <FormField id="pm-saat-nobet" label="Nöbet saati" error={errors.dutyHours}>
          {(control) => (
            <Input
              {...control}
              inputMode="numeric"
              {...form.register('dutyHours')}
              disabled={busy}
            />
          )}
        </FormField>
      </fieldset>
      <RootError message={errors.root?.server?.message} />
      <div>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Kaydet
        </Button>
      </div>
    </form>
  )
}

/** Atamayı gerekçeyle iptal (K-332): önceki atama iptal edilenin aylarını da kapsar. */
function CancelForm({
  allocation,
  onDone,
}: {
  allocation: StaffCostAllocation
  onDone: () => void
}) {
  const cancel = useCancelStaffCostAllocation()
  const form = useForm<{ reason: string }>({
    resolver: zodResolver(staffCostAllocationCancelSchema),
    defaultValues: { reason: '' },
  })
  const errors = form.formState.errors
  const busy = cancel.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await cancel.submit(
      { allocationId: allocation.id, version: allocation.version, reason: values.reason },
      {
        setError: (name, error) => {
          if (name === 'reason') form.setError('reason', error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status !== 'success') return
    notify.success('Atama iptal edildi.')
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
        {allocationPeriodText(allocation)} · {sharesText(allocation)}
      </p>
      <FormField id="pm-iptal" label="Gerekçe" error={errors.reason}>
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
