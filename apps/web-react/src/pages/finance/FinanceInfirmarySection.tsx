import { zodResolver } from '@hookform/resolvers/zod'
import { useId, useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import {
  useApproveMedicationConsent,
  useCreateInfirmaryVisit,
  useDischargeInfirmaryVisit,
  useInfirmaryStaff,
  useInfirmaryVisit,
  useInfirmaryVisits,
  useMedicationConsent,
  useMedicationConsents,
  useMedicationSchedule,
  useRecordMedicationAdministration,
  useRejectMedicationConsent,
  type InfirmaryVisitDetail,
  type InfirmaryVisitRow,
  type MedicationConsentRow,
  type MedicationScheduleSlot,
} from '@kampus/react-shared/use-finance-infirmary.ts'
import type { HealthAccessReason } from '@kampus/school-core/lib/finance-health-access.ts'
import {
  CONSENT_STATUS_LABELS,
  CONSENT_STATUSES,
  VISIT_ACTION_LABELS,
  VISIT_ACTIONS,
  VISIT_OUTCOME_LABELS,
  VISIT_OUTCOMES,
  VISIT_STATUS_LABELS,
  VISIT_STATUSES,
  type VisitAction,
} from '@kampus/school-core/lib/finance-infirmary.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCoreList } from '@/hooks/use-core-collection.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  HealthAccessGate,
  HealthAccessPrompt,
  useHealthAccessReason,
  useRememberHealthReason,
} from './FinanceHealthAccessReasonDialog.tsx'
import { occurredText } from './finance-incident-forms.ts'
import {
  actionsText,
  consentPeriodText,
  consentStatusBadge,
  dischargeBody,
  dischargeDefaults,
  dischargeFormSchema,
  rejectFormSchema,
  scheduleSlotText,
  visitCreateBody,
  visitDefaults,
  visitFormField,
  visitFormSchema,
  visitStatusBadge,
  visitTimeText,
  type DischargeFormValues,
  type RejectFormValues,
  type VisitFormValues,
} from './finance-infirmary-forms.ts'

const NO_SORT: readonly string[] = []
const STAFF_QUERY = { page: 1, pageSize: 100 } as const
const VISIT_FILTERS = [
  {
    key: 'status',
    label: 'Durum',
    type: 'select' as const,
    options: VISIT_STATUSES.map((value) => ({ value, label: VISIT_STATUS_LABELS[value] })),
  },
]
const CONSENT_FILTERS = [
  {
    key: 'status',
    label: 'Durum',
    type: 'select' as const,
    options: CONSENT_STATUSES.map((value) => ({ value, label: CONSENT_STATUS_LABELS[value] })),
  },
]
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)

/**
 * Revir (DOM-FIN-151; ON-101; IST-102): Finans "Revir" sekmesi, yönetici ve ön büro (revir
 * görevlisi rolü yok; K-510). Bugünkü ilaç uygulama listesi, revir ziyaretleri (açma, ayrıntı,
 * kapatma) ve veli ilaç talepleri (onay, gerekçeli ret, uygulamalar). Onaysız ilaç verilmez; aynı
 * doz saati iki kez yazılmaz (K-509). Sağlık ayrıntısı sunucudan okunur ve her açılış denetime
 * düşer; veliye ya da öğretmene ileti gönderilmez. İlaç listeleri ve ziyaret ayrıntısı erişim
 * gerekçesi ister (DOM-FIN-156): ilaç listelerinin gerekçesi görünüm için bir kez seçilir ve talep
 * ayrıntısında da kullanılır; ziyareti yeni açanın gerekçesi "ilk yardım / revir işlemi" olarak
 * önceden kaydedilir (K-525).
 */
export function FinanceInfirmarySection() {
  const medications = useHealthAccessReason(MEDICATIONS_SCOPE)
  return (
    <section
      aria-labelledby="revir"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading grid gap-1 px-6 pt-6 pb-2">
        <h2 id="revir" className="text-lg font-semibold">
          Revir
        </h2>
        <p className="text-sm text-muted-foreground">
          Revir ziyaretleri ve veli onaylı ilaçlar. Sağlık bilgisi özel niteliklidir; her açılış
          kayda geçer, veliye ileti gönderilmez.
        </p>
      </header>
      <div className="grid gap-8 px-6 pb-6">
        {medications.reason === null ? (
          <HealthAccessPrompt
            subject="Bugünkü ilaç uygulamaları ve ilaç onayları"
            askOnOpen={false}
            onConfirm={medications.choose}
          />
        ) : (
          <TodaySchedule reason={medications.reason} />
        )}
        <Visits />
        {medications.reason === null ? null : <Consents reason={medications.reason} />}
      </div>
    </section>
  )
}

// --- Bugünkü ilaçlar -----------------------------------------------------------------------------

const MEDICATIONS_SCOPE = 'infirmary-medications'
const visitScope = (visitId: string) => `infirmary-visit:${visitId}`

function TodaySchedule({ reason }: { reason: HealthAccessReason }) {
  const schedule = useMedicationSchedule(undefined, reason)
  const record = useRecordMedicationAdministration()
  const [busySlot, setBusySlot] = useState('')
  const slots = schedule.data?.data ?? []
  const give = async (slot: MedicationScheduleSlot) => {
    setBusySlot(`${slot.consentId} ${slot.scheduledTime}`)
    const outcome = await record.submit({
      consentId: slot.consentId,
      body: { scheduledTime: slot.scheduledTime, dose: slot.dose },
    })
    setBusySlot('')
    if (outcome.status === 'success') notify.success('İlaç uygulaması kaydedildi.')
  }
  return (
    <section aria-labelledby="revir-bugun" className="grid gap-2">
      <h3 id="revir-bugun" className="text-base font-semibold">
        Bugünkü ilaç uygulamaları
      </h3>
      {schedule.error ? (
        <QueryError error={schedule.error} onRetry={() => void schedule.refetch()} />
      ) : schedule.isPending ? (
        <SummaryLoading />
      ) : slots.length === 0 ? (
        <p className="text-sm text-muted-foreground">Bugün verilecek onaylı ilaç yok.</p>
      ) : (
        <ul aria-label="Bugünkü ilaçlar" className="grid gap-2">
          {slots.map((slot) => {
            const key = `${slot.consentId} ${slot.scheduledTime}`
            const busy = busySlot === key
            return (
              <li
                key={key}
                className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm"
              >
                <span>{`${slot.scheduledTime} · ${slot.studentName ?? '—'} · ${slot.medicationName} (${slot.dose})`}</span>
                {slot.administration === null ? (
                  <Button
                    size="sm"
                    className="min-h-11"
                    disabled={record.isPending}
                    aria-busy={busy || undefined}
                    aria-label={`${slot.studentName ?? 'Öğrenci'} ${slot.scheduledTime} dozunu verildi olarak kaydet`}
                    onClick={() => void give(slot)}
                  >
                    Verildi olarak kaydet
                  </Button>
                ) : (
                  <StatusBadge text={scheduleSlotText(slot)} tone="green" />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// --- Ziyaretler ----------------------------------------------------------------------------------

type VisitTableRow = { id: string; row: InfirmaryVisitRow; student: string; time: string }

function Visits() {
  const panel = useDetailPanel('ziyaret')
  const [creating, setCreating] = useState(false)
  const rememberReason = useRememberHealthReason()
  const list = useListState('revir-ziyaretleri', { urlPrefix: 'ziyaret_' })
  const status = VISIT_STATUSES.find((value) => value === text(list.state.filters.status))
  const visits = useInfirmaryVisits({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(status === undefined ? {} : { status }),
  })
  const rows = useMemo(
    () =>
      visits.data?.data.map((item): VisitTableRow => ({
        id: item.id,
        row: item,
        student: item.studentName ?? '—',
        time: visitTimeText(item),
      })),
    [visits.data],
  )
  const columns = useMemo<DataColumn<VisitTableRow>[]>(
    () => [
      { key: 'student', label: 'Öğrenci' },
      { key: 'time', label: 'Geliş – ayrılış' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => {
          const badge = visitStatusBadge(row.row)
          return <StatusBadge text={badge.text} tone={badge.tone} />
        },
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.student} ziyaretini aç`}
            onClick={() => panel.open(row.id)}
          >
            Aç
          </Button>
        ),
      },
    ],
    [panel],
  )
  return (
    <section aria-labelledby="revir-ziyaretler" className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="revir-ziyaretler" className="text-base font-semibold">
          Revir ziyaretleri
        </h3>
        <Button className="min-h-11" onClick={() => setCreating(true)}>
          Yeni ziyaret
        </Button>
      </div>
      <ServerDataTable
        list={list}
        rows={rows}
        total={visits.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={VISIT_FILTERS}
        search={false}
        mobileColumns={['student', 'status']}
        caption="Revir ziyaretleri"
        empty="Henüz revir ziyareti yok."
        emptyFiltered="Bu durumda ziyaret yok."
        loading={visits.isPending}
        fetching={visits.isFetching && !visits.isPending}
        error={
          visits.error ? (
            <QueryError error={visits.error} onRetry={() => void visits.refetch()} />
          ) : undefined
        }
      />
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Revir ziyareti"
      >
        {panel.selectedId ? (
          <HealthAccessGate
            key={panel.selectedId}
            scope={visitScope(panel.selectedId)}
            subject="Revir ziyareti"
            askOnOpen
          >
            {(reason) => <VisitPanel visitId={panel.selectedId} reason={reason} />}
          </HealthAccessGate>
        ) : null}
      </SidePanel>
      <Modal
        open={creating}
        onOpenChange={setCreating}
        title="Yeni revir ziyareti"
        description="Öğrenci revirdeyken açılır, dönüşte kapatılır. Sağlık profilindeki bilgiler buraya kopyalanmaz."
        size="wide"
      >
        {creating ? (
          <VisitForm
            onDone={(id) => {
              setCreating(false)
              if (!id) return
              rememberReason(visitScope(id), { code: 'first_aid', note: null })
              panel.open(id)
            }}
          />
        ) : null}
      </Modal>
    </section>
  )
}

function ActionChecks({
  value,
  onChange,
  idPrefix,
  disabled,
  error,
}: {
  value: readonly VisitAction[]
  onChange: (value: VisitAction[]) => void
  idPrefix: string
  disabled: boolean
  error: string | undefined
}) {
  return (
    <fieldset className="grid gap-2 sm:col-span-2">
      <legend className="text-sm font-medium">Yapılanlar</legend>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
        {VISIT_ACTIONS.map((action) => (
          <div key={action} className="flex min-h-11 items-center gap-2">
            <Checkbox
              id={`${idPrefix}-${action}`}
              checked={value.includes(action)}
              disabled={disabled}
              onCheckedChange={(checked) =>
                onChange(
                  checked === true ? [...value, action] : value.filter((item) => item !== action),
                )
              }
            />
            <Label htmlFor={`${idPrefix}-${action}`}>{VISIT_ACTION_LABELS[action]}</Label>
          </div>
        ))}
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </fieldset>
  )
}

function VisitForm({ onDone }: { onDone: (id?: string) => void }) {
  const staff = useInfirmaryStaff(STAFF_QUERY)
  const create = useCreateInfirmaryVisit()
  const form = useForm<VisitFormValues>({
    resolver: zodResolver(visitFormSchema),
    defaultValues: visitDefaults(),
  })
  const errors = form.formState.errors
  const busy = create.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(visitCreateBody(values), {
      setError: (name, error) => {
        const field = visitFormField(name)
        if (field) form.setError(field, error, { shouldFocus: true })
        else form.setError('root.server', error)
      },
    })
    if (outcome.status !== 'success') return
    notify.success('Revir ziyareti açıldı.')
    onDone(outcome.data.data.id)
  })
  return (
    <form
      noValidate
      aria-label="Yeni revir ziyareti"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      {staff.error ? (
        <div className="sm:col-span-2">
          <QueryError error={staff.error} onRetry={() => void staff.refetch()} />
        </div>
      ) : null}
      <div className="sm:col-span-2">
        <Controller
          control={form.control}
          name="studentId"
          render={({ field }) => (
            <StudentChoice
              value={field.value}
              onChange={field.onChange}
              error={errors.studentId?.message}
              disabled={busy}
            />
          )}
        />
      </div>
      <FormField id="revir-gun" label="Geliş günü" error={errors.arrivedDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('arrivedDate')} disabled={busy} />
        )}
      </FormField>
      <FormField id="revir-saat" label="Geliş saati" error={errors.arrivedTime}>
        {(control) => (
          <Input {...control} type="time" {...form.register('arrivedTime')} disabled={busy} />
        )}
      </FormField>
      <FormField id="revir-gonderen" label="Gönderen" error={errors.referredByMembershipId}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('referredByMembershipId')}
            className="w-full"
            disabled={busy}
          >
            <NativeSelectOption value="">Kendisi geldi</NativeSelectOption>
            {(staff.data?.data ?? []).map((person) => (
              <NativeSelectOption key={person.membershipId} value={person.membershipId}>
                {person.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <div className="sm:col-span-2">
        <FormField id="revir-sikayet" label="Şikâyet" error={errors.complaint}>
          {(control) => (
            <Textarea {...control} {...form.register('complaint')} rows={2} disabled={busy} />
          )}
        </FormField>
      </div>
      <Controller
        control={form.control}
        name="actions"
        render={({ field }) => (
          <ActionChecks
            value={field.value}
            onChange={field.onChange}
            idPrefix="revir-yapilan"
            disabled={busy}
            error={errors.actions?.message}
          />
        )}
      />
      <div className="sm:col-span-2">
        <FormField
          id="revir-not"
          label="Revir notu (isteğe bağlı)"
          error={errors.note}
          description="Not veliye gösterilmez; tanı koymayın."
        >
          {(control) => (
            <Textarea {...control} {...form.register('note')} rows={2} disabled={busy} />
          )}
        </FormField>
      </div>
      <div className="grid gap-2 sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button
          type="submit"
          className="min-h-11 justify-self-start"
          disabled={busy}
          aria-busy={busy || undefined}
        >
          Ziyareti aç
        </Button>
      </div>
    </form>
  )
}

/** Öğrenci: ad ya da numarayla arama (en az 2 karakter). */
function StudentChoice({
  value,
  onChange,
  error,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  error: string | undefined
  disabled: boolean
}) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState('')
  const search = useDebouncedValue(query).trim()
  const students = useCoreList(
    'students',
    { q: search, pageSize: 5 },
    { enabled: search.length >= 2 },
  )
  const id = useId()
  if (value !== '')
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">{`Öğrenci: ${picked}`}</span>
        <Button
          type="button"
          variant="ghost"
          className="min-h-11"
          disabled={disabled}
          onClick={() => onChange('')}
        >
          Öğrenciyi değiştir
        </Button>
      </div>
    )
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>Öğrenci</Label>
      <Input
        id={id}
        value={query}
        placeholder="Ad ya da numara (en az 2 karakter)"
        disabled={disabled}
        aria-invalid={Boolean(error)}
        onChange={(event) => setQuery(event.target.value)}
      />
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {search.length >= 2 ? (
        <ul aria-label="Öğrenci arama sonuçları" className="grid gap-1">
          {(students.data?.rows ?? []).map(({ record }) => (
            <li key={record.id}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPicked(record.name)
                  setQuery('')
                  onChange(record.id)
                }}
              >
                {record.name}
                {record.number ? ` · ${record.number}` : ''}
              </Button>
            </li>
          ))}
          {students.isSuccess && students.data.rows.length === 0 ? (
            <li className="text-sm text-muted-foreground">Sonuç yok.</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}

function VisitPanel({ visitId, reason }: { visitId: string; reason: HealthAccessReason }) {
  const visit = useInfirmaryVisit(visitId, reason)
  if (visit.error) return <QueryError error={visit.error} onRetry={() => void visit.refetch()} />
  const detail = visit.data?.data
  if (!detail) return <SummaryLoading />
  return <VisitDetails key={detail.version} detail={detail} />
}

function VisitDetails({ detail }: { detail: InfirmaryVisitDetail }) {
  const badge = visitStatusBadge(detail)
  const facts: [string, string][] = [
    ['Öğrenci', detail.studentName ?? '—'],
    ['Geliş', occurredText(detail.arrivedAt)],
    ['Ayrılış', detail.returnedAt === null ? 'Revirde' : occurredText(detail.returnedAt)],
    ['Gönderen', detail.referredByName ?? 'Kendisi geldi'],
    ['Şikâyet', detail.complaint],
    ['Yapılanlar', actionsText(detail.actions)],
    ['Revir notu', detail.note ?? '—'],
    ['Kaza tutanağı', detail.incidentReportId === null ? 'Bağlı değil' : 'Bağlı'],
  ]
  return (
    <div className="grid gap-4">
      <StatusBadge text={badge.text} tone={badge.tone} />
      <dl className="grid gap-2 text-sm">
        {facts.map(([label, value]) => (
          <div key={label} className="grid gap-0.5">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="whitespace-pre-wrap">{value}</dd>
          </div>
        ))}
      </dl>
      {detail.status === 'open' ? <DischargeForm detail={detail} /> : null}
    </div>
  )
}

function DischargeForm({ detail }: { detail: InfirmaryVisitDetail }) {
  const discharge = useDischargeInfirmaryVisit()
  const form = useForm<DischargeFormValues>({
    resolver: zodResolver(dischargeFormSchema),
    defaultValues: dischargeDefaults(detail),
  })
  const errors = form.formState.errors
  const busy = discharge.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await discharge.submit(
      { visitId: detail.id, version: detail.version, body: dischargeBody(values) },
      {
        setError: (name, error) =>
          form.setError(
            name === 'actions' || name === 'outcome' || name === 'note' ? name : 'root.server',
            error,
          ),
      },
    )
    if (outcome.status === 'success') notify.success('Ziyaret kapatıldı.')
  })
  return (
    <form
      noValidate
      aria-label="Ziyareti kapat"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="revir-sonuc" label="Sonuç" error={errors.outcome}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('outcome')}
            className="w-full"
            disabled={busy}
          >
            {VISIT_OUTCOMES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {VISIT_OUTCOME_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <Controller
        control={form.control}
        name="actions"
        render={({ field }) => (
          <ActionChecks
            value={field.value}
            onChange={field.onChange}
            idPrefix="revir-kapat-yapilan"
            disabled={busy}
            error={errors.actions?.message}
          />
        )}
      />
      <FormField id="revir-kapat-not" label="Revir notu (isteğe bağlı)" error={errors.note}>
        {(control) => <Textarea {...control} {...form.register('note')} rows={2} disabled={busy} />}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <p className="text-xs text-muted-foreground">
        Ayrılış anı şimdi yazılır; kapanan ziyaret değişmez. Veliye ileti gönderilmez.
      </p>
      <Button
        type="submit"
        className="min-h-11 justify-self-start"
        disabled={busy}
        aria-busy={busy || undefined}
      >
        Ziyareti kapat
      </Button>
    </form>
  )
}

// --- İlaç onayları -------------------------------------------------------------------------------

type ConsentTableRow = {
  id: string
  row: MedicationConsentRow
  student: string
  medication: string
  period: string
}

function Consents({ reason }: { reason: HealthAccessReason }) {
  const panel = useDetailPanel('ilac')
  const [rejecting, setRejecting] = useState<MedicationConsentRow | null>(null)
  const approve = useApproveMedicationConsent()
  const list = useListState('revir-ilac-onaylari', { urlPrefix: 'ilac_' })
  const status = CONSENT_STATUSES.find((value) => value === text(list.state.filters.status))
  const consents = useMedicationConsents(
    {
      page: list.state.page,
      pageSize: list.state.pageSize,
      ...(status === undefined ? {} : { status }),
    },
    reason,
  )
  const rows = useMemo(
    () =>
      consents.data?.data.map((item): ConsentTableRow => ({
        id: item.id,
        row: item,
        student: item.studentName ?? '—',
        medication: `${item.medicationName} · ${item.dose}`,
        period: consentPeriodText(item),
      })),
    [consents.data],
  )
  const columns = useMemo<DataColumn<ConsentTableRow>[]>(() => {
    const onApprove = async (row: MedicationConsentRow) => {
      const outcome = await approve.submit({ consentId: row.id, version: row.version })
      if (outcome.status === 'success') notify.success('İlaç talebi onaylandı.')
    }
    return [
      { key: 'student', label: 'Öğrenci' },
      { key: 'medication', label: 'İlaç ve doz' },
      { key: 'period', label: 'Dönem ve saatler' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => {
          const badge = consentStatusBadge(row.row)
          return <StatusBadge text={badge.text} tone={badge.tone} />
        },
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="secondary"
              aria-label={`${row.student} ilaç talebini aç`}
              onClick={() => panel.open(row.id)}
            >
              Aç
            </Button>
            {row.row.status === 'pending' ? (
              <>
                <Button
                  size="sm"
                  disabled={approve.isPending}
                  aria-label={`${row.student} ilaç talebini onayla`}
                  onClick={() => void onApprove(row.row)}
                >
                  Onayla
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`${row.student} ilaç talebini reddet`}
                  onClick={() => setRejecting(row.row)}
                >
                  Reddet
                </Button>
              </>
            ) : null}
          </div>
        ),
      },
    ]
  }, [approve, panel])
  return (
    <section aria-labelledby="revir-ilac-onaylari" className="grid gap-2">
      <h3 id="revir-ilac-onaylari" className="text-base font-semibold">
        İlaç onayları
      </h3>
      <p className="text-sm text-muted-foreground">
        Veli kendi çocuğu için ilaç talebi açar; onaylanmayan ilaç verilmez.
      </p>
      <ServerDataTable
        list={list}
        rows={rows}
        total={consents.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={CONSENT_FILTERS}
        search={false}
        mobileColumns={['student', 'status']}
        caption="İlaç onayları"
        empty="Henüz ilaç talebi yok."
        emptyFiltered="Bu durumda talep yok."
        loading={consents.isPending}
        fetching={consents.isFetching && !consents.isPending}
        error={
          consents.error ? (
            <QueryError error={consents.error} onRetry={() => void consents.refetch()} />
          ) : undefined
        }
      />
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="İlaç talebi"
      >
        {panel.selectedId ? <ConsentPanel consentId={panel.selectedId} reason={reason} /> : null}
      </SidePanel>
      <Modal
        open={rejecting !== null}
        onOpenChange={(open) => (open ? undefined : setRejecting(null))}
        title="İlaç talebini reddet"
        description="Gerekçe veliye gösterilir."
      >
        {rejecting ? <RejectForm consent={rejecting} onDone={() => setRejecting(null)} /> : null}
      </Modal>
    </section>
  )
}

function RejectForm({ consent, onDone }: { consent: MedicationConsentRow; onDone: () => void }) {
  const reject = useRejectMedicationConsent()
  const form = useForm<RejectFormValues>({
    resolver: zodResolver(rejectFormSchema),
    defaultValues: { reason: '' },
  })
  const errors = form.formState.errors
  const busy = reject.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await reject.submit(
      { consentId: consent.id, version: consent.version, reason: values.reason.trim() },
      {
        setError: (name, error) =>
          form.setError(name === 'reason' ? 'reason' : 'root.server', error),
      },
    )
    if (outcome.status !== 'success') return
    notify.success('İlaç talebi reddedildi.')
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Ret gerekçesi"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="ilac-ret-gerekce" label="Gerekçe" error={errors.reason}>
        {(control) => (
          <Textarea {...control} {...form.register('reason')} rows={3} disabled={busy} />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <Button
        type="submit"
        className="min-h-11 justify-self-start"
        disabled={busy}
        aria-busy={busy || undefined}
      >
        Talebi reddet
      </Button>
    </form>
  )
}

function ConsentPanel({ consentId, reason }: { consentId: string; reason: HealthAccessReason }) {
  const consent = useMedicationConsent(consentId, reason)
  if (consent.error)
    return <QueryError error={consent.error} onRetry={() => void consent.refetch()} />
  const detail = consent.data?.data
  if (!detail) return <SummaryLoading />
  const badge = consentStatusBadge(detail)
  const facts: [string, string][] = [
    ['Öğrenci', detail.studentName ?? '—'],
    ['İlaç', detail.medicationName],
    ['Doz', detail.dose],
    ['Dönem ve saatler', consentPeriodText(detail)],
    ['Veli notu', detail.note ?? '—'],
    ['Talebi açan', detail.requestedByName ?? '—'],
    ...(detail.decidedByName === null
      ? []
      : ([['Karar veren', detail.decidedByName]] as [string, string][])),
    ...(detail.rejectionReason === null
      ? []
      : ([['Ret gerekçesi', detail.rejectionReason]] as [string, string][])),
  ]
  return (
    <div className="grid gap-4">
      <StatusBadge text={badge.text} tone={badge.tone} />
      <dl className="grid gap-2 text-sm">
        {facts.map(([label, value]) => (
          <div key={label} className="grid gap-0.5">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="whitespace-pre-wrap">{value}</dd>
          </div>
        ))}
      </dl>
      <section aria-labelledby="ilac-uygulamalar" className="grid gap-1">
        <h3 id="ilac-uygulamalar" className="text-sm font-semibold">
          Uygulamalar
        </h3>
        {detail.administrations.length === 0 ? (
          <p className="text-sm text-muted-foreground">Henüz uygulama yok.</p>
        ) : (
          <ul aria-label="İlaç uygulamaları" className="grid gap-1 text-sm">
            {detail.administrations.map((item) => (
              <li key={item.id}>
                {`${occurredText(item.administeredAt)} · ${item.scheduledTime} dozu · ${item.dose} · ${item.administeredByName ?? '—'}`}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
