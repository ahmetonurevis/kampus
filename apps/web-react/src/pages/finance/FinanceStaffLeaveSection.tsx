import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {
  useCancelLeaveRecord,
  useCreateLeaveProfile,
  useCreateLeaveRecord,
  useCreateLeaveType,
  useLeaveStaff,
  useLeaveStaffDetail,
  useLeaveTypes,
  useUpdateLeaveProfile,
  useUpdateLeaveType,
  type LeaveRecordView,
  type LeaveStaffDetail,
  type LeaveTypeView,
} from '@kampus/react-shared/use-finance-staff-leave.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import { leaveRecordCancelSchema } from '@kampus/school-core/lib/finance-staff-leave.ts'
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
  accrualText,
  CUSTOM_KIND_OPTIONS,
  dayText,
  daysText,
  leaveProfileBody,
  leaveProfileDefaults,
  leaveProfileFormField,
  leaveProfileFormSchema,
  leaveProfileUpdateBody,
  leaveRecordBody,
  leaveRecordDefaults,
  leaveRecordFormField,
  leaveRecordFormSchema,
  leaveTypeDefaults,
  leaveTypeFormField,
  leaveTypeFormSchema,
  leaveTypeUpdateBody,
  NEW_LEAVE_TYPE_DEFAULTS,
  newLeaveTypeBody,
  newLeaveTypeFormSchema,
  rangeText,
  recordFlags,
  recordTitle,
  selectableLeaveTypes,
  typeFacts,
  type LeaveProfileFormValues,
  type LeaveRecordFormValues,
  type LeaveTypeFormValues,
  type NewLeaveTypeFormValues,
} from './finance-staff-leave-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['name', 'balance']
const STATUS_OPTIONS = [
  { value: 'active', label: 'Etkin' },
  { value: 'passive', label: 'Pasif (ayrılan)' },
]
const FILTERS = [
  { key: 'status', label: 'Personel durumu', type: 'select' as const, options: STATUS_OPTIONS },
]
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)

type Row = {
  id: string
  name: string
  role: string
  active: boolean
  seniority: string
  annual: string
  balance: string
}

/**
 * Personel izinleri (DOM-FIN-109; ON-181): Finans "Personel izinleri" sekmesi, yalnız yönetici.
 * Personel listesi kıdem başlangıcını ve bugünkü yıllık izin bakiyesini gösterir; panelde izin
 * bilgisi (kıdem başlangıcı, doğum günü, açılış devri), hak ediş dökümü, kullanılmış izin kayıtları
 * ve iptali bulunur. "İzin türleri" kurum ayarını açar. Talep ve onay akışı ON-182'dedir.
 */
export function FinanceStaffLeaveSection() {
  const list = useListState('personel-izin', { urlPrefix: 'izin_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = text(list.state.filters.status)
  const [typesOpen, setTypesOpen] = useState(false)
  const staff = useLeaveStaff({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(status === 'active' || status === 'passive' ? { status } : {}),
  })
  const panel = useDetailPanel('izin_personel')
  const openPerson = panel.open
  const rows = useMemo(
    () =>
      staff.data?.data.map((item): Row => ({
        id: item.membershipId,
        name: item.name,
        role: roleLabel(item.role),
        active: item.active,
        seniority:
          item.seniorityStartDate === null ? 'Girilmedi' : dayText(item.seniorityStartDate),
        annual:
          item.summary?.annualDays == null
            ? '—'
            : `${daysText(item.summary.annualDays)} (${String(item.summary.serviceYears)}. yıl)`,
        balance: item.summary === null ? '—' : daysText(item.summary.balanceDays),
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
      { key: 'seniority', label: 'Kıdem başlangıcı' },
      { key: 'annual', label: 'Yıllık hak' },
      { key: 'balance', label: 'Kalan izin' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row: Row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.name} izinlerini aç`}
            onClick={() => openPerson(row.id)}
          >
            İzinler
          </Button>
        ),
      },
    ],
    [openPerson],
  )
  return (
    <section
      aria-labelledby="personel-izinleri"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h2 id="personel-izinleri" className="text-lg font-semibold">
            Personel izinleri
          </h2>
          <p className="text-sm text-muted-foreground">
            Yıllık izin kıdem başlangıcının her yıl dönümünde hak edilir (1–5 yıl 14, 6–14 yıl 20,
            15 yıl ve üstü 26 iş günü); kullanılmayan izin devreder.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setTypesOpen(true)}>
          İzin türleri
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
        caption="Personel izinleri"
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
        title="Personel izni"
      >
        {panel.selectedId ? <StaffLeave membershipId={panel.selectedId} /> : null}
      </SidePanel>
      <SidePanel open={typesOpen} onOpenChange={setTypesOpen} title="İzin türleri">
        {typesOpen ? <LeaveTypes /> : null}
      </SidePanel>
    </section>
  )
}

type Dialog =
  { kind: 'profile' } | { kind: 'record' } | { kind: 'cancel'; record: LeaveRecordView } | null

function StaffLeave({ membershipId }: { membershipId: string }) {
  const [date, setDate] = useState('')
  const on = daySchema.safeParse(date).success ? date : undefined
  const detail = useLeaveStaffDetail(membershipId, on)
  const [dialog, setDialog] = useState<Dialog>(null)
  if (detail.error) return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
  const data = detail.data?.data
  if (!data) return <SummaryLoading />
  const close = () => setDialog(null)
  const entitlement = data.entitlement
  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <h3 className="text-base font-semibold">{data.name}</h3>
        <p className="text-sm text-muted-foreground">
          {roleLabel(data.role)}
          {data.active
            ? ''
            : ` · pasif (ayrılan)${data.employmentEndDate ? `, hizmet ${dayText(data.employmentEndDate)} gününde bitti` : ''}`}
        </p>
      </div>
      <section aria-labelledby="izin-bilgisi" className="grid gap-2">
        <h4 id="izin-bilgisi" className="text-sm font-semibold">
          İzin bilgisi
        </h4>
        {data.profile === null ? (
          <p className="text-sm text-muted-foreground">
            Kıdem başlangıcı girilmedi; yıllık izin hesaplanmıyor.
          </p>
        ) : (
          <dl
            aria-label="İzin bilgisi"
            className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm"
          >
            <dt className="text-muted-foreground">Kıdem başlangıcı</dt>
            <dd>{dayText(data.profile.seniorityStartDate)}</dd>
            <dt className="text-muted-foreground">Doğum günü</dt>
            <dd>
              {data.profile.birthDate === null ? 'Girilmedi' : dayText(data.profile.birthDate)}
            </dd>
            <dt className="text-muted-foreground">Açılış devri</dt>
            <dd>
              {data.profile.openingBalance === null
                ? 'Yok'
                : `${dayText(data.profile.openingBalance.asOf)} itibarıyla ${daysText(data.profile.openingBalance.days)}`}
            </dd>
          </dl>
        )}
        <div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setDialog({ kind: 'profile' })}
            disabled={!data.active}
          >
            {data.profile === null ? 'Kıdem başlangıcını gir' : 'İzin bilgisini düzelt'}
          </Button>
        </div>
      </section>
      {entitlement === null ? null : (
        <section aria-labelledby="izin-bakiye" className="grid gap-2">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h4 id="izin-bakiye" className="text-sm font-semibold">
              {on === undefined ? 'Bugünkü yıllık izin' : 'Seçilen gündeki yıllık izin'}
            </h4>
            <FormField id="izin-gun" label="Bakiye günü">
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
          <dl
            aria-label="Yıllık izin bakiyesi"
            className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm"
          >
            <dt className="text-muted-foreground">Hizmet</dt>
            <dd>{String(entitlement.serviceYears)} tam yıl</dd>
            <dt className="text-muted-foreground">Devreden</dt>
            <dd>{daysText(entitlement.carriedOverDays)}</dd>
            <dt className="text-muted-foreground">Bu yılın hakkı</dt>
            <dd>{daysText(entitlement.currentYearDays)}</dd>
            <dt className="text-muted-foreground">Bu yıl kullanılan</dt>
            <dd>{daysText(entitlement.usedThisYearDays)}</dd>
            <dt className="text-muted-foreground">Kalan</dt>
            <dd className="font-medium">
              {daysText(entitlement.balanceDays)}
              {entitlement.balanceDays < 0 ? ' (avans izin)' : ''}
            </dd>
            {entitlement.plannedDays > 0 ? (
              <>
                <dt className="text-muted-foreground">Planlanan sonrası</dt>
                <dd>{daysText(entitlement.balanceAfterPlannedDays)}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">Sonraki hak ediş</dt>
            <dd>
              {entitlement.next === null
                ? 'Yok (hizmet bitti)'
                : `${dayText(entitlement.next.date)} · ${daysText(entitlement.next.days)}`}
            </dd>
          </dl>
          {entitlement.accruals.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Henüz hak ediş yok: ilk yıllık izin bir yıl dolunca hak edilir.
            </p>
          ) : (
            <details className="text-sm">
              <summary className="cursor-pointer">Hak ediş dökümü</summary>
              <ul aria-label="Hak ediş dökümü" className="mt-2 grid gap-1">
                {[...entitlement.accruals].reverse().map((accrual) => (
                  <li key={accrual.serviceYear}>
                    {accrualText(accrual)}
                    {accrual.inOpeningBalance ? ' · açılış devrinde' : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
      <section aria-labelledby="izin-kayitlari" className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 id="izin-kayitlari" className="text-sm font-semibold">
            Kullanılan izinler
          </h4>
          <Button size="sm" onClick={() => setDialog({ kind: 'record' })} disabled={!data.active}>
            İzin kaydı ekle
          </Button>
        </div>
        {data.records.length === 0 ? (
          <p className="text-sm text-muted-foreground">Henüz izin kaydı yok.</p>
        ) : (
          <ul aria-label="Kullanılan izinler" className="grid gap-2 text-sm">
            {data.records.map((record) => (
              <li
                key={record.id}
                aria-label={recordTitle(record)}
                className="grid gap-1 rounded-sm border px-3 py-2"
              >
                <span className="font-medium">{record.typeLabel}</span>
                <span>
                  {rangeText(record)} · {daysText(record.days)}
                </span>
                <span className="text-muted-foreground">{recordFlags(record)}</span>
                {record.note ? (
                  <span className="text-muted-foreground [overflow-wrap:anywhere]">
                    {record.note}
                  </span>
                ) : null}
                <span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setDialog({ kind: 'cancel', record })}
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
        open={dialog?.kind === 'profile'}
        onOpenChange={(open) => (open ? undefined : close())}
        title="İzin bilgisi"
        description="Kıdem başlangıcı işe giriş günüdür (deneme süresi dahil). Doğum günü yalnız 18 yaş altı ve 50 yaş ve üstü en az 20 gün kuralı için kullanılır."
      >
        {dialog?.kind === 'profile' ? <ProfileForm data={data} onDone={close} /> : null}
      </Modal>
      <Modal
        open={dialog?.kind === 'record'}
        onOpenChange={(open) => (open ? undefined : close())}
        title="İzin kaydı ekle"
        description="Kullanılan izin; iş günü sayısını hafta tatili ve genel tatil hariç girin."
      >
        {dialog?.kind === 'record' ? (
          <RecordForm membershipId={membershipId} onDone={close} />
        ) : null}
      </Modal>
      <Modal
        open={dialog?.kind === 'cancel'}
        onOpenChange={(open) => (open ? undefined : close())}
        title="İzin kaydını iptal et"
      >
        {dialog?.kind === 'cancel' ? <CancelForm record={dialog.record} onDone={close} /> : null}
      </Modal>
    </div>
  )
}

/** İzin bilgisi (K-360): açılış ya da yalnız değişen alanların düzeltmesi. */
function ProfileForm({ data, onDone }: { data: LeaveStaffDetail; onDone: () => void }) {
  const create = useCreateLeaveProfile()
  const update = useUpdateLeaveProfile()
  const current = data.profile
  const form = useForm<LeaveProfileFormValues>({
    resolver: zodResolver(leaveProfileFormSchema),
    defaultValues: leaveProfileDefaults(current),
  })
  const errors = form.formState.errors
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const setError = (name: string, error: { message: string }) => {
    const field = leaveProfileFormField(name)
    if (field) form.setError(field, error, { shouldFocus: true })
    else form.setError('root.server', error)
  }
  const onSubmit = form.handleSubmit(async (values) => {
    if (current === null) {
      const outcome = await create.submit(leaveProfileBody(data.membershipId, values), {
        setError,
      })
      if (outcome.status !== 'success') return
    } else {
      const body = leaveProfileUpdateBody(current, values)
      if (Object.keys(body).length === 0) {
        form.setError('root.server', { message: 'İzin bilgisinde değişiklik yok.' })
        return
      }
      const outcome = await update.submit(
        { membershipId: data.membershipId, version: current.version, body },
        { setError },
      )
      if (outcome.status !== 'success') return
    }
    notify.success('İzin bilgisi kaydedildi.')
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="İzin bilgisi"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="izin-kidem" label="Kıdem başlangıcı" error={errors.seniorityStartDate}>
        {(control) => (
          <Input
            {...control}
            type="date"
            {...form.register('seniorityStartDate')}
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="izin-dogum" label="Doğum günü (isteğe bağlı)" error={errors.birthDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('birthDate')} disabled={busy} />
        )}
      </FormField>
      <FormField
        id="izin-acilis-gun"
        label="Açılış devri günü (isteğe bağlı)"
        error={errors.openingDate}
        description="Sistem öncesi hak ediş ve kullanım bu güne kadar devirde sayılır."
      >
        {(control) => (
          <Input {...control} type="date" {...form.register('openingDate')} disabled={busy} />
        )}
      </FormField>
      <FormField
        id="izin-acilis-bakiye"
        label="Devreden gün"
        error={errors.openingDays}
        description="O günün sonundaki kalan yıllık izin; eksi avans izindir."
      >
        {(control) => (
          <Input
            {...control}
            inputMode="numeric"
            autoComplete="off"
            {...form.register('openingDays')}
            disabled={busy}
          />
        )}
      </FormField>
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Kaydet
        </Button>
      </div>
    </form>
  )
}

/** Kullanılmış izin (K-362): tür, aralık, iş günü ve not. */
function RecordForm({ membershipId, onDone }: { membershipId: string; onDone: () => void }) {
  const types = useLeaveTypes()
  const create = useCreateLeaveRecord()
  const form = useForm<LeaveRecordFormValues>({
    resolver: zodResolver(leaveRecordFormSchema),
    defaultValues: leaveRecordDefaults(dayKey()),
  })
  const errors = form.formState.errors
  const busy = create.isPending || form.formState.isSubmitting
  const typeCode = useWatch({ control: form.control, name: 'typeCode' })
  const options = selectableLeaveTypes(types.data?.data ?? [])
  const selected = options.find((type) => type.code === typeCode)
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(leaveRecordBody(membershipId, values), {
      setError: (name, error) => {
        const field = leaveRecordFormField(name)
        if (field) form.setError(field, error, { shouldFocus: true })
        else form.setError('root.server', error)
      },
    })
    if (outcome.status !== 'success') return
    notify.success('İzin kaydı eklendi.')
    onDone()
  })
  if (types.error) return <QueryError error={types.error} onRetry={() => void types.refetch()} />
  return (
    <form
      noValidate
      aria-label="İzin kaydı"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <div className="sm:col-span-2">
        <FormField
          id="izin-tur"
          label="İzin türü"
          error={errors.typeCode}
          description={selected === undefined ? undefined : typeFacts(selected)}
        >
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('typeCode')}
              className="w-full"
              disabled={busy || types.isPending}
            >
              {options.map((type) => (
                <NativeSelectOption key={type.code} value={type.code}>
                  {type.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      </div>
      <FormField id="izin-baslangic" label="İlk gün" error={errors.startDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('startDate')} disabled={busy} />
        )}
      </FormField>
      <FormField id="izin-bitis" label="Son gün" error={errors.endDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('endDate')} disabled={busy} />
        )}
      </FormField>
      <FormField id="izin-gunler" label="İş günü" error={errors.days}>
        {(control) => (
          <Input
            {...control}
            inputMode="numeric"
            autoComplete="off"
            {...form.register('days')}
            disabled={busy}
          />
        )}
      </FormField>
      <div className="sm:col-span-2">
        <FormField id="izin-not" label="Not (isteğe bağlı)" error={errors.note}>
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

/** Kaydı gerekçeyle iptal (K-362); iptal edilen kayıt bakiyeye sayılmaz. */
function CancelForm({ record, onDone }: { record: LeaveRecordView; onDone: () => void }) {
  const cancel = useCancelLeaveRecord()
  const form = useForm<{ reason: string }>({
    resolver: zodResolver(leaveRecordCancelSchema),
    defaultValues: { reason: '' },
  })
  const errors = form.formState.errors
  const busy = cancel.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await cancel.submit(
      { recordId: record.id, version: record.version, reason: values.reason },
      {
        setError: (name, error) => {
          if (name === 'reason') form.setError('reason', error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status !== 'success') return
    notify.success('İzin kaydı iptal edildi.')
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="İptal gerekçesi"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <p className="text-sm">{recordTitle(record)}</p>
      <FormField id="izin-iptal" label="Gerekçe" error={errors.reason}>
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

/** İzin türleri (K-361): kurum ayarı ve ek tür. */
function LeaveTypes() {
  const types = useLeaveTypes()
  const [editing, setEditing] = useState<LeaveTypeView | 'new' | null>(null)
  if (types.error) return <QueryError error={types.error} onRetry={() => void types.refetch()} />
  const list = types.data?.data
  if (!list) return <SummaryLoading />
  const close = () => setEditing(null)
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Yasanın belirlediği alanlar kilitlidir: yıllık izin ücretlidir ve yıllık izinden düşer;
        mazeret izinleri (4857 Ek md. 2) ücretlidir ve yasal günün altına inmez; rapor yıllık
        izinden düşmez. Ayar geçmiş kayıtları değiştirmez.
      </p>
      <ul aria-label="İzin türleri" className="grid gap-2 text-sm">
        {list.map((type) => (
          <li
            key={type.code}
            aria-label={type.label}
            className="flex flex-wrap items-center justify-between gap-2 rounded-sm border px-3 py-2"
          >
            <span className="grid gap-0.5">
              <span className="font-medium">{type.label}</span>
              <span className="text-muted-foreground">{typeFacts(type)}</span>
            </span>
            <Button
              size="sm"
              variant="secondary"
              aria-label={`${type.label} ayarla`}
              onClick={() => setEditing(type)}
            >
              Ayarla
            </Button>
          </li>
        ))}
      </ul>
      <div>
        <Button onClick={() => setEditing('new')}>Yeni tür</Button>
      </div>
      <Modal
        open={editing !== null}
        onOpenChange={(open) => (open ? undefined : close())}
        title={editing === 'new' ? 'Yeni izin türü' : 'İzin türünü ayarla'}
      >
        {editing === 'new' ? <NewTypeForm onDone={close} /> : null}
        {editing !== null && editing !== 'new' ? <TypeForm type={editing} onDone={close} /> : null}
      </Modal>
    </div>
  )
}

const YES_NO = (yes: string, no: string) => [
  { value: 'true', label: yes },
  { value: 'false', label: no },
]

function TypeForm({ type, onDone }: { type: LeaveTypeView; onDone: () => void }) {
  const update = useUpdateLeaveType()
  const schema = useMemo(() => leaveTypeFormSchema(type), [type])
  const form = useForm<LeaveTypeFormValues>({
    resolver: zodResolver(schema),
    defaultValues: leaveTypeDefaults(type),
  })
  const errors = form.formState.errors
  const busy = update.isPending || form.formState.isSubmitting
  const locked = (field: 'paid' | 'deductsFromAnnual' | 'isActive') => type.locked.includes(field)
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await update.submit(
      { code: type.code, version: type.version, body: leaveTypeUpdateBody(type, values) },
      {
        setError: (name, error) => {
          const field = leaveTypeFormField(name)
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status !== 'success') return
    notify.success('İzin türü kaydedildi.')
    onDone()
  })
  const select = (
    id: string,
    label: string,
    name: 'paid' | 'deductsFromAnnual' | 'isActive',
    options: { value: string; label: string }[],
  ) =>
    locked(name) ? (
      // Kilitli alan forma kaydedilmez; değer varsayılandan gelir ve gövdeye girmez.
      <p className="grid gap-1 text-sm">
        <span className="font-medium">{label}</span>
        <span>
          {options.find((option) => option.value === leaveTypeDefaults(type)[name])?.label} · yasa
          gereği değiştirilemez
        </span>
      </p>
    ) : (
      <FormField id={id} label={label} error={errors[name]}>
        {(control) => (
          <NativeSelect {...control} {...form.register(name)} className="w-full" disabled={busy}>
            {options.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
    )
  return (
    <form
      noValidate
      aria-label="İzin türü ayarı"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <div className="sm:col-span-2">
        <FormField id="izin-tur-ad" label="Tür adı" error={errors.label}>
          {(control) => <Input {...control} {...form.register('label')} disabled={busy} />}
        </FormField>
      </div>
      {select('izin-tur-ucret', 'Ücret', 'paid', YES_NO('Ücretli', 'Ücretsiz'))}
      {select(
        'izin-tur-dus',
        'Yıllık izin',
        'deductsFromAnnual',
        YES_NO('Yıllık izinden düşer', 'Yıllık izinden düşmez'),
      )}
      <FormField
        id="izin-tur-gun"
        label="Varsayılan gün"
        error={errors.defaultDays}
        description={
          type.statutoryMinDays === null
            ? 'Boş bırakılabilir.'
            : `Yasal en az ${String(type.statutoryMinDays)} gün.`
        }
      >
        {(control) => (
          <Input
            {...control}
            inputMode="numeric"
            autoComplete="off"
            {...form.register('defaultDays')}
            disabled={busy}
          />
        )}
      </FormField>
      {select('izin-tur-durum', 'Durum', 'isActive', YES_NO('Açık', 'Kapalı'))}
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Kaydet
        </Button>
      </div>
    </form>
  )
}

function NewTypeForm({ onDone }: { onDone: () => void }) {
  const create = useCreateLeaveType()
  const form = useForm<NewLeaveTypeFormValues>({
    resolver: zodResolver(newLeaveTypeFormSchema),
    defaultValues: NEW_LEAVE_TYPE_DEFAULTS,
  })
  const errors = form.formState.errors
  const busy = create.isPending || form.formState.isSubmitting
  const kind = useWatch({ control: form.control, name: 'kind' })
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(newLeaveTypeBody(values), {
      setError: (name, error) => {
        const field = leaveTypeFormField(name)
        if (field && field !== 'isActive') form.setError(field, error, { shouldFocus: true })
        else form.setError('root.server', error)
      },
    })
    if (outcome.status !== 'success') return
    notify.success('İzin türü eklendi.')
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Yeni izin türü"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="izin-yeni-bicim" label="Biçim" error={errors.kind}>
        {(control) => (
          <NativeSelect {...control} {...form.register('kind')} className="w-full" disabled={busy}>
            {CUSTOM_KIND_OPTIONS.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="izin-yeni-ad" label="Tür adı" error={errors.label}>
        {(control) => <Input {...control} {...form.register('label')} disabled={busy} />}
      </FormField>
      <FormField
        id="izin-yeni-ucret"
        label="Ücret"
        error={errors.paid}
        description={kind === 'unpaid' ? 'Ücretsiz izin her zaman ücretsizdir.' : undefined}
      >
        {(control) => (
          <NativeSelect {...control} {...form.register('paid')} className="w-full" disabled={busy}>
            {YES_NO('Ücretli', 'Ücretsiz').map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="izin-yeni-dus" label="Yıllık izin" error={errors.deductsFromAnnual}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('deductsFromAnnual')}
            className="w-full"
            disabled={busy}
          >
            {YES_NO('Yıllık izinden düşer', 'Yıllık izinden düşmez').map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField
        id="izin-yeni-gun"
        label="Varsayılan gün (isteğe bağlı)"
        error={errors.defaultDays}
      >
        {(control) => (
          <Input
            {...control}
            inputMode="numeric"
            autoComplete="off"
            {...form.register('defaultDays')}
            disabled={busy}
          />
        )}
      </FormField>
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Kaydet
        </Button>
      </div>
    </form>
  )
}
