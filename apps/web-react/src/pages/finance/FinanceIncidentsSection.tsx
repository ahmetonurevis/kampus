import { zodResolver } from '@hookform/resolvers/zod'
import { useId, useMemo, useState } from 'react'
import { Controller, useForm, useWatch, type UseFormReturn } from 'react-hook-form'
import {
  useAddIncidentAddendum,
  useCreateIncident,
  useFinalizeIncident,
  useIncident,
  useIncidents,
  useIncidentStaff,
  useRecordIncidentNotification,
  useUpdateIncident,
  type IncidentDetail,
  type IncidentRow,
  type IncidentStaffMember,
} from '@kampus/react-shared/use-finance-incidents.ts'
import {
  INCIDENT_KIND_LABELS,
  INCIDENT_KINDS,
  INCIDENT_NOTIFICATION_CHANNEL_LABELS,
  INCIDENT_NOTIFICATION_CHANNELS,
  INCIDENT_REFERRAL_LABELS,
  INCIDENT_REFERRALS,
  INCIDENT_STATUS_LABELS,
  INCIDENT_STATUSES,
  INJURED_KIND_LABELS,
  INJURY_BODY_PART_LABELS,
  INJURY_BODY_PARTS,
  INJURY_SEVERITY_LABELS,
  INJURY_SEVERITIES,
} from '@kampus/school-core/lib/finance-incidents.ts'
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
import { useIncidentReportPdf } from '@/hooks/use-finance-incident-pdf.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { INCIDENT_REPORT_TITLE } from '@/lib/pdf/templates/finance-incident-report.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { PdfDialogButton } from './CorporateParts.tsx'
import {
  addendumFormSchema,
  incidentCreateBody,
  incidentDefaults,
  incidentEditDefaults,
  incidentFormField,
  incidentFormSchema,
  incidentStatusBadge,
  incidentUpdateBody,
  istanbulInstant,
  kindText,
  notificationDefaults,
  notificationFormSchema,
  notificationText,
  occurredText,
  type AddendumFormValues,
  type IncidentFormValues,
  type NotificationFormValues,
} from './finance-incident-forms.ts'

const NO_SORT: readonly string[] = []
const STAFF_QUERY = { page: 1, pageSize: 100 } as const
const FILTERS = [
  {
    key: 'status',
    label: 'Durum',
    type: 'select' as const,
    options: INCIDENT_STATUSES.map((value) => ({ value, label: INCIDENT_STATUS_LABELS[value] })),
  },
]
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)

/**
 * Kaza tutanakları (DOM-FIN-146; ON-162): Finans "Kaza tutanakları" sekmesi, yönetici ve ön büro.
 * Yönetici bütün tutanakları, ön büro yalnız açtıklarını görür (K-494). Tutanak taslak açılır,
 * düzeltilir ve kesinleşir; ağır yaralanan öğrencinin tutanağı veli bildirimi kaydı olmadan
 * kesinleşmez (K-493). Bildirim yalnız kayıttır, veliye ileti gitmez. Kesinleşmiş tutanağa yönetici
 * ek not yazar ve PDF basar. Sağlık grubu sunucudan yalnız yetkili okuyana döner; ayrıntı okuması
 * denetime düşer.
 */
export function FinanceIncidentsSection({ isManager }: { isManager: boolean }) {
  const panel = useDetailPanel('tutanak')
  const [creating, setCreating] = useState(false)
  return (
    <section
      aria-labelledby="kaza-tutanaklari"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h2 id="kaza-tutanaklari" className="text-lg font-semibold">
            Kaza tutanakları
          </h2>
          <p className="text-sm text-muted-foreground">
            {isManager
              ? 'Okuldaki kaza ve yaralanmalar. Sağlık bilgisi özel niteliklidir; her açılış kayda geçer.'
              : 'Açtığınız kaza tutanakları. Kesinleşen tutanağın sağlık bilgisini yalnız yönetim görür.'}
          </p>
        </div>
        <Button className="min-h-11" onClick={() => setCreating(true)}>
          Yeni tutanak
        </Button>
      </header>
      <IncidentList onOpen={panel.open} />
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Kaza tutanağı"
      >
        {panel.selectedId ? <IncidentPanel incidentId={panel.selectedId} /> : null}
      </SidePanel>
      <Modal
        open={creating}
        onOpenChange={setCreating}
        title="Yeni kaza tutanağı"
        description="Tutanak taslak açılır; kontrol edip kesinleştirin. Sağlık profilindeki bilgiler buraya kopyalanmaz."
        size="wide"
      >
        {creating ? (
          <IncidentForm
            onDone={(id) => {
              setCreating(false)
              if (id) panel.open(id)
            }}
          />
        ) : null}
      </Modal>
    </section>
  )
}

// --- Liste ---------------------------------------------------------------------------------------

type TableRow = {
  id: string
  row: IncidentRow
  occurred: string
  injured: string
  what: string
  notification: string
}

function IncidentList({ onOpen }: { onOpen: (id: string) => void }) {
  const list = useListState('kaza-tutanaklari', { urlPrefix: 'tutanak_' })
  const status = INCIDENT_STATUSES.find((value) => value === text(list.state.filters.status))
  const incidents = useIncidents({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(status === undefined ? {} : { status }),
  })
  const rows = useMemo(
    () =>
      incidents.data?.data.map((item): TableRow => ({
        id: item.id,
        row: item,
        occurred: occurredText(item.occurredAt),
        injured: `${item.injuredName ?? '—'} · ${INJURED_KIND_LABELS[item.injuredKind]}`,
        what: kindText(item),
        notification: notificationText(item),
      })),
    [incidents.data],
  )
  const columns = useMemo<DataColumn<TableRow>[]>(
    () => [
      { key: 'occurred', label: 'Olay anı' },
      { key: 'injured', label: 'Yaralanan' },
      { key: 'what', label: 'Tür ve yer' },
      { key: 'notification', label: 'Veli bildirimi' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => {
          const badge = incidentStatusBadge(row.row)
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
            aria-label={`${row.injured} ${row.occurred} tutanağını aç`}
            onClick={() => onOpen(row.id)}
          >
            Aç
          </Button>
        ),
      },
    ],
    [onOpen],
  )
  return (
    <ServerDataTable
      list={list}
      rows={rows}
      total={incidents.data?.meta.total ?? 0}
      sortable={NO_SORT}
      columns={columns}
      filters={FILTERS}
      search={false}
      mobileColumns={['injured', 'status']}
      caption="Kaza tutanakları"
      empty="Henüz kaza tutanağı yok."
      emptyFiltered="Bu durumda tutanak yok."
      loading={incidents.isPending}
      fetching={incidents.isFetching && !incidents.isPending}
      error={
        incidents.error ? (
          <QueryError error={incidents.error} onRetry={() => void incidents.refetch()} />
        ) : undefined
      }
    />
  )
}

// --- Form ----------------------------------------------------------------------------------------

function IncidentForm({
  detail,
  onDone,
}: {
  detail?: IncidentDetail
  onDone: (id?: string) => void
}) {
  const staff = useIncidentStaff(STAFF_QUERY)
  const create = useCreateIncident()
  const update = useUpdateIncident()
  const initial = useMemo(
    () => (detail === undefined ? incidentDefaults() : incidentEditDefaults(detail)),
    [detail],
  )
  const form = useForm<IncidentFormValues>({
    resolver: zodResolver(incidentFormSchema),
    defaultValues: initial,
  })
  const [injuredKind, firstAidGiven] = useWatch({
    control: form.control,
    name: ['injuredKind', 'firstAidGiven'],
  })
  const errors = form.formState.errors
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const people = staff.data?.data ?? []
  const setError = (name: string, error: { message: string }) => {
    const field = incidentFormField(name)
    if (field) form.setError(field, error, { shouldFocus: true })
    else form.setError('root.server', error)
  }
  const onSubmit = form.handleSubmit(async (values) => {
    if (detail === undefined) {
      const outcome = await create.submit(incidentCreateBody(values), { setError })
      if (outcome.status !== 'success') return
      notify.success('Tutanak taslak olarak açıldı.')
      onDone(outcome.data.data.id)
      return
    }
    const body = incidentUpdateBody(values, initial)
    if (Object.keys(body).length === 0) {
      form.setError('root.server', { message: 'Tutanakta değişiklik yok.' })
      return
    }
    const outcome = await update.submit(
      { incidentId: detail.id, version: detail.version, body },
      { setError },
    )
    if (outcome.status !== 'success') return
    notify.success('Tutanak düzeltildi.')
    onDone()
  })
  return (
    <form
      noValidate
      aria-label={detail === undefined ? 'Yeni kaza tutanağı' : 'Tutanağı düzelt'}
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      {staff.error ? (
        <div className="sm:col-span-2">
          <QueryError error={staff.error} onRetry={() => void staff.refetch()} />
        </div>
      ) : null}
      {detail === undefined ? (
        <>
          <FormField id="tutanak-yaralanan-tur" label="Yaralanan" error={errors.injuredKind}>
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('injuredKind')}
                className="w-full"
                disabled={busy}
              >
                <NativeSelectOption value="student">Öğrenci</NativeSelectOption>
                <NativeSelectOption value="staff">Personel</NativeSelectOption>
              </NativeSelect>
            )}
          </FormField>
          {injuredKind === 'student' ? (
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
          ) : (
            <StaffSelect
              id="tutanak-yaralanan-personel"
              label="Yaralanan personel"
              form={form}
              name="injuredMembershipId"
              people={people}
              busy={busy}
            />
          )}
        </>
      ) : (
        <p className="text-sm sm:col-span-2">{`Yaralanan: ${detail.injuredName ?? '—'} (${INJURED_KIND_LABELS[detail.injuredKind]}). Yaralanan değişmez; yanlışsa yeni tutanak açın.`}</p>
      )}
      <FormField id="tutanak-gun" label="Olay günü" error={errors.occurredDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('occurredDate')} disabled={busy} />
        )}
      </FormField>
      <FormField id="tutanak-saat" label="Olay saati" error={errors.occurredTime}>
        {(control) => (
          <Input {...control} type="time" {...form.register('occurredTime')} disabled={busy} />
        )}
      </FormField>
      <FormField id="tutanak-yer" label="Olay yeri" error={errors.location}>
        {(control) => (
          <Input {...control} autoComplete="off" {...form.register('location')} disabled={busy} />
        )}
      </FormField>
      <FormField id="tutanak-tur" label="Olay türü" error={errors.kind}>
        {(control) => (
          <NativeSelect {...control} {...form.register('kind')} className="w-full" disabled={busy}>
            {INCIDENT_KINDS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {INCIDENT_KIND_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <div className="sm:col-span-2">
        <FormField id="tutanak-aciklama" label="Olayın anlatımı" error={errors.description}>
          {(control) => (
            <Textarea {...control} {...form.register('description')} rows={3} disabled={busy} />
          )}
        </FormField>
      </div>
      <fieldset className="grid gap-2 sm:col-span-2" aria-describedby="tutanak-bolge-hata">
        <legend className="text-sm font-medium">Yaralanma bölgesi</legend>
        <Controller
          control={form.control}
          name="bodyParts"
          render={({ field }) => (
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
              {INJURY_BODY_PARTS.map((part) => (
                <div key={part} className="flex min-h-11 items-center gap-2">
                  <Checkbox
                    id={`tutanak-bolge-${part}`}
                    checked={field.value.includes(part)}
                    disabled={busy}
                    onCheckedChange={(checked) =>
                      field.onChange(
                        checked === true
                          ? [...field.value, part]
                          : field.value.filter((item) => item !== part),
                      )
                    }
                  />
                  <Label htmlFor={`tutanak-bolge-${part}`}>{INJURY_BODY_PART_LABELS[part]}</Label>
                </div>
              ))}
            </div>
          )}
        />
        {errors.bodyParts?.message ? (
          <p id="tutanak-bolge-hata" className="text-sm text-danger">
            {errors.bodyParts.message}
          </p>
        ) : null}
      </fieldset>
      <FormField id="tutanak-siddet" label="Şiddet" error={errors.severity}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('severity')}
            className="w-full"
            disabled={busy}
          >
            {INJURY_SEVERITIES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {INJURY_SEVERITY_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="tutanak-sevk" label="Sevk" error={errors.referral}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('referral')}
            className="w-full"
            disabled={busy}
          >
            {INCIDENT_REFERRALS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {INCIDENT_REFERRAL_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <div className="sm:col-span-2">
        <FormField
          id="tutanak-not"
          label="Yaralanma notu (isteğe bağlı)"
          error={errors.injuryNote}
          description="Görülen yaralanmayı kısaca yazın; tanı koymayın."
        >
          {(control) => (
            <Textarea {...control} {...form.register('injuryNote')} rows={2} disabled={busy} />
          )}
        </FormField>
      </div>
      <div className="flex min-h-11 items-center gap-2 sm:col-span-2">
        <Controller
          control={form.control}
          name="firstAidGiven"
          render={({ field }) => (
            <Checkbox
              id="tutanak-ilk-mudahale"
              checked={field.value}
              disabled={busy}
              onCheckedChange={(checked) => field.onChange(checked === true)}
            />
          )}
        />
        <Label htmlFor="tutanak-ilk-mudahale">İlk müdahale yapıldı</Label>
      </div>
      {firstAidGiven ? (
        <>
          <FormField id="tutanak-mudahale-yapan" label="Müdahaleyi yapan" error={errors.firstAidBy}>
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('firstAidBy')}
                className="w-full"
                disabled={busy}
              >
                <NativeSelectOption value="">Kurum dışından (ör. 112 ekibi)</NativeSelectOption>
                {people.map((person) => (
                  <NativeSelectOption key={person.membershipId} value={person.membershipId}>
                    {person.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField id="tutanak-mudahale" label="Ne yapıldı" error={errors.firstAidAction}>
            {(control) => (
              <Textarea
                {...control}
                {...form.register('firstAidAction')}
                rows={2}
                disabled={busy}
              />
            )}
          </FormField>
        </>
      ) : null}
      <StaffSelect
        id="tutanak-sorumlu"
        label="Sorumlu personel"
        form={form}
        name="responsibleMembershipId"
        people={people}
        busy={busy}
      />
      <fieldset className="grid gap-2 sm:col-span-2">
        <legend className="text-sm font-medium">Tanıklar (isteğe bağlı)</legend>
        <Controller
          control={form.control}
          name="witnessMembershipIds"
          render={({ field }) => (
            <div className="grid max-h-48 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
              {people.map((person) => (
                <div key={person.membershipId} className="flex min-h-11 items-center gap-2">
                  <Checkbox
                    id={`tutanak-tanik-${person.membershipId}`}
                    checked={field.value.includes(person.membershipId)}
                    disabled={busy}
                    onCheckedChange={(checked) =>
                      field.onChange(
                        checked === true
                          ? [...field.value, person.membershipId]
                          : field.value.filter((item) => item !== person.membershipId),
                      )
                    }
                  />
                  <Label htmlFor={`tutanak-tanik-${person.membershipId}`}>{person.name}</Label>
                </div>
              ))}
            </div>
          )}
        />
        {errors.witnessMembershipIds?.message ? (
          <p className="text-sm text-danger">{errors.witnessMembershipIds.message}</p>
        ) : null}
      </fieldset>
      <div className="grid gap-2 sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button
          type="submit"
          className="min-h-11 justify-self-start"
          disabled={busy}
          aria-busy={busy || undefined}
        >
          {detail === undefined ? 'Taslak tutanağı aç' : 'Düzeltmeyi kaydet'}
        </Button>
      </div>
    </form>
  )
}

function StaffSelect({
  id,
  label,
  form,
  name,
  people,
  busy,
}: {
  id: string
  label: string
  form: UseFormReturn<IncidentFormValues>
  name: 'responsibleMembershipId' | 'injuredMembershipId'
  people: readonly IncidentStaffMember[]
  busy: boolean
}) {
  return (
    <FormField id={id} label={label} error={form.formState.errors[name]}>
      {(control) => (
        <NativeSelect {...control} {...form.register(name)} className="w-full" disabled={busy}>
          <NativeSelectOption value="">Seçin</NativeSelectOption>
          {people.map((person) => (
            <NativeSelectOption key={person.membershipId} value={person.membershipId}>
              {person.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}
    </FormField>
  )
}

/** Yaralanan öğrenci: ad ya da numarayla arama (en az 2 karakter). */
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
      <Label htmlFor={id}>Yaralanan öğrenci</Label>
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

// --- Ayrıntı -------------------------------------------------------------------------------------

function IncidentPanel({ incidentId }: { incidentId: string }) {
  const incident = useIncident(incidentId)
  if (incident.error)
    return <QueryError error={incident.error} onRetry={() => void incident.refetch()} />
  const detail = incident.data?.data
  if (!detail) return <SummaryLoading />
  return <IncidentDetails key={detail.version} detail={detail} />
}

function IncidentDetails({ detail }: { detail: IncidentDetail }) {
  const [editing, setEditing] = useState(false)
  const finalize = useFinalizeIncident()
  const health = detail.health
  const badge = incidentStatusBadge(detail)
  const facts: [string, string][] = [
    ['Yaralanan', `${detail.injuredName ?? '—'} (${INJURED_KIND_LABELS[detail.injuredKind]})`],
    ['Olay anı', occurredText(detail.occurredAt)],
    ['Olay yeri', detail.location],
    ['Olay türü', INCIDENT_KIND_LABELS[detail.kind]],
    ['Sorumlu', detail.responsibleName ?? '—'],
    ['Tanıklar', detail.witnesses.map((item) => item.name ?? '—').join(', ') || 'Yok'],
  ]
  const healthFacts: [string, string][] =
    health === undefined
      ? []
      : [
          [
            'Yaralanma bölgesi',
            health.bodyParts.map((part) => INJURY_BODY_PART_LABELS[part]).join(', '),
          ],
          ['Şiddet', INJURY_SEVERITY_LABELS[health.severity]],
          ['Sevk', INCIDENT_REFERRAL_LABELS[health.referral]],
          ['Yaralanma notu', health.injuryNote ?? '—'],
          [
            'İlk müdahale',
            health.firstAid === null
              ? 'Yapılmadı'
              : `${health.firstAid.byName ?? 'Kurum dışından'}: ${health.firstAid.action}`,
          ],
        ]
  const onFinalize = async () => {
    const outcome = await finalize.submit({ incidentId: detail.id, version: detail.version })
    if (outcome.status === 'success') notify.success('Tutanak kesinleşti.')
  }
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge text={badge.text} tone={badge.tone} />
        {detail.access.manage && detail.status === 'finalized' ? (
          <PdfDialogButton
            label="Tutanak PDF"
            title={INCIDENT_REPORT_TITLE}
            id={detail.id}
            usePdf={useIncidentReportPdf}
          />
        ) : null}
      </div>
      <dl className="grid gap-2 text-sm">
        {[...facts, ...healthFacts].map(([label, value]) => (
          <div key={label} className="grid gap-0.5">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {health === undefined ? (
        <p className="text-sm text-muted-foreground">
          Sağlık bilgisi kesinleşen tutanakta yalnız yönetimde görünür.
        </p>
      ) : null}
      <section aria-labelledby="tutanak-anlatim" className="grid gap-1">
        <h3 id="tutanak-anlatim" className="text-sm font-semibold">
          Olayın anlatımı
        </h3>
        <p className="text-sm whitespace-pre-wrap">{detail.description}</p>
      </section>
      {detail.access.edit ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" className="min-h-11" onClick={() => setEditing(true)}>
            Düzelt
          </Button>
          <Button
            className="min-h-11"
            disabled={finalize.isPending}
            aria-busy={finalize.isPending || undefined}
            onClick={() => void onFinalize()}
          >
            Kesinleştir
          </Button>
        </div>
      ) : null}
      {detail.injuredKind === 'student' ? <Notifications detail={detail} /> : null}
      {detail.addenda !== undefined ? <Addenda detail={detail} /> : null}
      <Modal
        open={editing}
        onOpenChange={setEditing}
        title="Tutanağı düzelt"
        description="Taslak tutanak düzeltilir; kesinleşince değişmez."
        size="wide"
      >
        {editing ? <IncidentForm detail={detail} onDone={() => setEditing(false)} /> : null}
      </Modal>
    </div>
  )
}

function Notifications({ detail }: { detail: IncidentDetail }) {
  const record = useRecordIncidentNotification()
  const form = useForm<NotificationFormValues>({
    resolver: zodResolver(notificationFormSchema),
    defaultValues: notificationDefaults(),
  })
  const errors = form.formState.errors
  const busy = record.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await record.submit(
      {
        incidentId: detail.id,
        body: {
          channel: values.channel,
          notifiedAt: istanbulInstant(values.notifiedDate, values.notifiedTime),
        },
      },
      {
        setError: (name, error) =>
          form.setError(
            name === 'notifiedAt' ? 'notifiedTime' : name === 'channel' ? 'channel' : 'root.server',
            error,
          ),
      },
    )
    if (outcome.status === 'success') notify.success('Veli bildirimi kaydedildi.')
  })
  return (
    <section aria-labelledby="tutanak-bildirim" className="grid gap-2">
      <h3 id="tutanak-bildirim" className="text-sm font-semibold">
        Veli bildirimi
      </h3>
      {detail.notifications.length === 0 ? (
        <p className="text-sm text-muted-foreground">Veliye bildirim kaydedilmedi.</p>
      ) : (
        <ul className="grid gap-1 text-sm" aria-label="Veli bildirimleri">
          {detail.notifications.map((item) => (
            <li key={item.id}>
              {`${occurredText(item.notifiedAt)} · ${INCIDENT_NOTIFICATION_CHANNEL_LABELS[item.channel]} · ${item.notifiedByName ?? '—'}`}
            </li>
          ))}
        </ul>
      )}
      {detail.access.notify ? (
        <form
          noValidate
          aria-label="Veli bildirimini kaydet"
          className="grid gap-2 sm:grid-cols-3"
          onSubmit={(event) => void onSubmit(event)}
        >
          <FormField id="bildirim-kanal" label="Kanal" error={errors.channel}>
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('channel')}
                className="w-full"
                disabled={busy}
              >
                {INCIDENT_NOTIFICATION_CHANNELS.map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {INCIDENT_NOTIFICATION_CHANNEL_LABELS[value]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField id="bildirim-gun" label="Bildirim günü" error={errors.notifiedDate}>
            {(control) => (
              <Input {...control} type="date" {...form.register('notifiedDate')} disabled={busy} />
            )}
          </FormField>
          <FormField id="bildirim-saat" label="Bildirim saati" error={errors.notifiedTime}>
            {(control) => (
              <Input {...control} type="time" {...form.register('notifiedTime')} disabled={busy} />
            )}
          </FormField>
          <div className="grid gap-2 sm:col-span-3">
            <RootError message={errors.root?.server?.message} />
            <p className="text-xs text-muted-foreground">
              Yalnız kayıttır; veliye ileti gönderilmez.
            </p>
            <Button
              type="submit"
              variant="secondary"
              className="min-h-11 justify-self-start"
              disabled={busy}
              aria-busy={busy || undefined}
            >
              Bildirimi kaydet
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  )
}

function Addenda({ detail }: { detail: IncidentDetail }) {
  const add = useAddIncidentAddendum()
  const form = useForm<AddendumFormValues>({
    resolver: zodResolver(addendumFormSchema),
    defaultValues: { note: '' },
  })
  const errors = form.formState.errors
  const busy = add.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await add.submit(
      { incidentId: detail.id, body: { note: values.note.trim() } },
      {
        setError: (name, error) => form.setError(name === 'note' ? 'note' : 'root.server', error),
      },
    )
    if (outcome.status === 'success') notify.success('Ek not eklendi.')
  })
  const addenda = detail.addenda ?? []
  return (
    <section aria-labelledby="tutanak-ek-not" className="grid gap-2">
      <h3 id="tutanak-ek-not" className="text-sm font-semibold">
        Ek notlar
      </h3>
      {addenda.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ek not yok.</p>
      ) : (
        <ul className="grid gap-2 text-sm" aria-label="Ek notlar">
          {addenda.map((item) => (
            <li key={item.id} className="grid gap-0.5">
              <span className="text-muted-foreground">{`${occurredText(item.createdAt)} · ${item.createdByName ?? '—'}`}</span>
              <span className="whitespace-pre-wrap">{item.note}</span>
            </li>
          ))}
        </ul>
      )}
      {detail.status === 'finalized' ? (
        <form
          noValidate
          aria-label="Ek not yaz"
          className="grid gap-2"
          onSubmit={(event) => void onSubmit(event)}
        >
          <FormField
            id="tutanak-ek-not-metin"
            label="Ek not"
            error={errors.note}
            description="Kesinleşmiş tutanak değişmez; düzeltmeyi buraya yazın."
          >
            {(control) => (
              <Textarea {...control} {...form.register('note')} rows={3} disabled={busy} />
            )}
          </FormField>
          <RootError message={errors.root?.server?.message} />
          <Button
            type="submit"
            variant="secondary"
            className="min-h-11 justify-self-start"
            disabled={busy}
            aria-busy={busy || undefined}
          >
            Ek notu kaydet
          </Button>
        </form>
      ) : null}
    </section>
  )
}
