import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import {
  useCreateHealthScreening,
  useHealthScreening,
  useHealthScreeningClasses,
  useHealthScreeningReport,
  useHealthScreenings,
  useHealthScreeningStaff,
  usePublishHealthScreening,
  useRecordHealthScreeningResults,
  type HealthScreeningDetail,
  type HealthScreeningRow,
  type HealthScreeningStudentRow,
} from '@kampus/react-shared/use-finance-health-screenings.ts'
import {
  HEALTH_SCREENING_KIND_LABELS,
  HEALTH_SCREENING_KINDS,
  HEALTH_SCREENING_OUTCOMES,
  HEALTH_SCREENING_STATUS_LABELS,
  HEALTH_SCREENING_STATUSES,
  type HealthScreeningOutcome,
} from '@kampus/school-core/lib/finance-health-screenings.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  classesText,
  draftOf,
  draftThreshold,
  entryPlan,
  kindLabel,
  measurementText,
  NOTE_MAX,
  outcomeText,
  referralCellText,
  screenedOnText,
  screeningCreateBody,
  screeningDefaults,
  screeningFormField,
  screeningFormSchema,
  sessionStatusBadge,
  thresholdText,
  type EntryDraft,
  type ScreeningFormValues,
} from './finance-health-screening-forms.ts'

const NO_SORT: readonly string[] = []
const OPTIONS_QUERY = { page: 1, pageSize: 100 } as const
const FILTERS = [
  {
    key: 'status',
    label: 'Durum',
    type: 'select' as const,
    options: HEALTH_SCREENING_STATUSES.map((value) => ({
      value,
      label: HEALTH_SCREENING_STATUS_LABELS[value],
    })),
  },
  {
    key: 'kind',
    label: 'Tür',
    type: 'select' as const,
    options: HEALTH_SCREENING_KINDS.map((value) => ({
      value,
      label: HEALTH_SCREENING_KIND_LABELS[value],
    })),
  },
]
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)

/**
 * Sağlık taramaları (DOM-FIN-153; ON-163): Finans "Sağlık taramaları" sekmesi, yönetici ve ön büro
 * (sağlık personeli rolü yok; K-516). Tarama oturumu açılır, sonuçlar sınıf tablosundan hızlıca
 * girilir (öğrenci başına tek sonuç, BKİ sunucuda hesaplanır; K-514), sınıf raporu küçük grupları
 * gizler (K-516) ve yayımlanınca veli kendi çocuğunun sonucunu görür; ileri değerlendirme
 * önerilenler için "gönderilecek" bildirim kaydı açılır, ileti gönderilmez (K-515). Ölçüm dönen her
 * açılış sunucuda denetime düşer.
 */
export function FinanceHealthScreeningsSection() {
  const panel = useDetailPanel('tarama')
  return (
    <section
      aria-labelledby="saglik-taramalari"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading grid gap-1 px-6 pt-6 pb-2">
        <h2 id="saglik-taramalari" className="text-lg font-semibold">
          Sağlık taramaları
        </h2>
        <p className="text-sm text-muted-foreground">
          Boy-kilo ve görme taramaları. Ölçümler özel nitelikli sağlık verisidir; her açılış kayda
          geçer. Persentil hesaplanmaz, yalnız kurumun eşiği uygulanır.
        </p>
      </header>
      <div className="grid gap-8 px-6 pb-6">
        <Sessions onOpen={panel.open} />
        {panel.selectedId ? (
          <Workspace key={panel.selectedId} sessionId={panel.selectedId} onClose={panel.close} />
        ) : null}
      </div>
    </section>
  )
}

// --- Oturumlar -----------------------------------------------------------------------------------

type SessionTableRow = {
  id: string
  row: HealthScreeningRow
  kind: string
  day: string
  classes: string
  results: string
}

function Sessions({ onOpen }: { onOpen: (id: string) => void }) {
  const [creating, setCreating] = useState(false)
  const list = useListState('saglik-taramalari', { urlPrefix: 'tarama_' })
  const status = HEALTH_SCREENING_STATUSES.find(
    (value) => value === text(list.state.filters.status),
  )
  const kind = HEALTH_SCREENING_KINDS.find((value) => value === text(list.state.filters.kind))
  const sessions = useHealthScreenings({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(status === undefined ? {} : { status }),
    ...(kind === undefined ? {} : { kind }),
  })
  const rows = useMemo(
    () =>
      sessions.data?.data.map((item): SessionTableRow => ({
        id: item.id,
        row: item,
        kind: kindLabel(item.kind),
        day: screenedOnText(item.screenedOn),
        classes: classesText(item),
        results: String(item.resultCount),
      })),
    [sessions.data],
  )
  const columns = useMemo<DataColumn<SessionTableRow>[]>(
    () => [
      { key: 'kind', label: 'Tür' },
      { key: 'day', label: 'Gün' },
      { key: 'classes', label: 'Sınıflar' },
      { key: 'results', label: 'Sonuç' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => {
          const badge = sessionStatusBadge(row.row)
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
            aria-label={`${row.kind} ${row.day} taramasını aç`}
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
    <section aria-labelledby="tarama-oturumlari" className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="tarama-oturumlari" className="text-base font-semibold">
          Tarama oturumları
        </h3>
        <Button className="min-h-11" onClick={() => setCreating(true)}>
          Yeni tarama
        </Button>
      </div>
      <ServerDataTable
        list={list}
        rows={rows}
        total={sessions.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={FILTERS}
        search={false}
        mobileColumns={['kind', 'status']}
        caption="Tarama oturumları"
        empty="Henüz sağlık taraması yok."
        emptyFiltered="Bu süzgece uyan tarama yok."
        loading={sessions.isPending}
        fetching={sessions.isFetching && !sessions.isPending}
        error={
          sessions.error ? (
            <QueryError error={sessions.error} onRetry={() => void sessions.refetch()} />
          ) : undefined
        }
      />
      <Modal
        open={creating}
        onOpenChange={setCreating}
        title="Yeni sağlık taraması"
        description="Tür, gün, hedef sınıflar ve taramayı yapan. Eşikler kurumun kararıdır; boş eşik uygulanmaz."
        size="wide"
      >
        {creating ? (
          <ScreeningForm
            onDone={(id) => {
              setCreating(false)
              if (id) onOpen(id)
            }}
          />
        ) : null}
      </Modal>
    </section>
  )
}

function ScreeningForm({ onDone }: { onDone: (id?: string) => void }) {
  const classes = useHealthScreeningClasses(OPTIONS_QUERY)
  const staff = useHealthScreeningStaff(OPTIONS_QUERY)
  const create = useCreateHealthScreening()
  const form = useForm<ScreeningFormValues>({
    resolver: zodResolver(screeningFormSchema),
    defaultValues: screeningDefaults(),
  })
  const errors = form.formState.errors
  const busy = create.isPending || form.formState.isSubmitting
  const kind = useWatch({ control: form.control, name: 'kind' })
  const performerKind = useWatch({ control: form.control, name: 'performerKind' })
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(screeningCreateBody(values), {
      setError: (name, error) => {
        const field = screeningFormField(name)
        if (field) form.setError(field, error, { shouldFocus: true })
        else form.setError('root.server', error)
      },
    })
    if (outcome.status !== 'success') return
    notify.success('Tarama açıldı.')
    onDone(outcome.data.data.id)
  })
  const loadError = classes.error ?? staff.error
  return (
    <form
      noValidate
      aria-label="Yeni sağlık taraması"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      {loadError ? (
        <div className="sm:col-span-2">
          <QueryError
            error={loadError}
            onRetry={() => {
              void classes.refetch()
              void staff.refetch()
            }}
          />
        </div>
      ) : null}
      <FormField id="tarama-tur" label="Tür" error={errors.kind}>
        {(control) => (
          <NativeSelect {...control} {...form.register('kind')} className="w-full" disabled={busy}>
            {HEALTH_SCREENING_KINDS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {HEALTH_SCREENING_KIND_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="tarama-gun" label="Tarama günü" error={errors.screenedOn}>
        {(control) => (
          <Input {...control} type="date" {...form.register('screenedOn')} disabled={busy} />
        )}
      </FormField>
      <Controller
        control={form.control}
        name="classIds"
        render={({ field }) => (
          <fieldset className="grid gap-2 sm:col-span-2">
            <legend className="text-sm font-medium">Hedef sınıflar</legend>
            {classes.isPending ? <SummaryLoading /> : null}
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
              {(classes.data?.data ?? []).map((item) => (
                <div key={item.id} className="flex min-h-11 items-center gap-2">
                  <Checkbox
                    id={`tarama-sinif-${item.id}`}
                    checked={field.value.includes(item.id)}
                    disabled={busy}
                    onCheckedChange={(checked) =>
                      field.onChange(
                        checked === true
                          ? [...field.value, item.id]
                          : field.value.filter((value) => value !== item.id),
                      )
                    }
                  />
                  <Label htmlFor={`tarama-sinif-${item.id}`}>
                    {`${item.name} (${String(item.studentCount)})`}
                  </Label>
                </div>
              ))}
            </div>
            {errors.classIds?.message ? (
              <p className="text-sm text-danger">{errors.classIds.message}</p>
            ) : null}
          </fieldset>
        )}
      />
      <FormField id="tarama-yapan-tur" label="Taramayı yapan" error={errors.performerKind}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('performerKind')}
            className="w-full"
            disabled={busy}
          >
            <NativeSelectOption value="external">Dış sağlık personeli</NativeSelectOption>
            <NativeSelectOption value="staff">Kurum personeli</NativeSelectOption>
          </NativeSelect>
        )}
      </FormField>
      {performerKind === 'staff' ? (
        <FormField id="tarama-personel" label="Personel" error={errors.performerMembershipId}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('performerMembershipId')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="">Seçin</NativeSelectOption>
              {(staff.data?.data ?? []).map((person) => (
                <NativeSelectOption key={person.membershipId} value={person.membershipId}>
                  {person.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      ) : (
        <FormField
          id="tarama-dis-personel"
          label="Ad ve kurumu"
          error={errors.performerName}
          description="Ör. ASM hemşiresi Ayşe K."
        >
          {(control) => <Input {...control} {...form.register('performerName')} disabled={busy} />}
        </FormField>
      )}
      {kind === 'growth' ? (
        <>
          <FormField
            id="tarama-bki-alt"
            label="BKİ alt eşiği (isteğe bağlı)"
            error={errors.bmiBelow}
            description="Altındaki BKİ ileri değerlendirme önerir."
          >
            {(control) => (
              <Input
                {...control}
                inputMode="decimal"
                {...form.register('bmiBelow')}
                disabled={busy}
              />
            )}
          </FormField>
          <FormField
            id="tarama-bki-ust"
            label="BKİ üst eşiği (isteğe bağlı)"
            error={errors.bmiAbove}
            description="Üstündeki BKİ ileri değerlendirme önerir."
          >
            {(control) => (
              <Input
                {...control}
                inputMode="decimal"
                {...form.register('bmiAbove')}
                disabled={busy}
              />
            )}
          </FormField>
        </>
      ) : (
        <FormField
          id="tarama-gorme-esik"
          label="Görme eşiği (isteğe bağlı)"
          error={errors.acuityBelow}
          description="Bir gözün ondalık değeri bunun altındaysa (ör. 0,8) öneri konur."
        >
          {(control) => (
            <Input
              {...control}
              inputMode="decimal"
              {...form.register('acuityBelow')}
              disabled={busy}
            />
          )}
        </FormField>
      )}
      <div className="grid gap-2 sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button
          type="submit"
          className="min-h-11 justify-self-start"
          disabled={busy}
          aria-busy={busy || undefined}
        >
          Taramayı aç
        </Button>
      </div>
    </form>
  )
}

// --- Seçili tarama -------------------------------------------------------------------------------

function Workspace({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const detail = useHealthScreening(sessionId)
  const data = detail.data?.data
  return (
    <section aria-labelledby="secili-tarama" className="grid gap-4 border-t pt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="secili-tarama" className="text-base font-semibold">
          {data
            ? `${kindLabel(data.kind)} taraması · ${screenedOnText(data.screenedOn)}`
            : 'Tarama'}
        </h3>
        <Button variant="ghost" className="min-h-11" onClick={onClose}>
          Taramayı kapat
        </Button>
      </div>
      {detail.error ? (
        <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
      ) : !data ? (
        <SummaryLoading />
      ) : (
        <>
          <Facts detail={data} />
          <Report sessionId={sessionId} />
          <EntryTable
            key={`${String(data.version)} ${data.students.map((row) => String(row.result?.version ?? 0)).join(' ')}`}
            detail={data}
          />
          {data.status === 'open' ? <Publish detail={data} /> : null}
        </>
      )}
    </section>
  )
}

function Facts({ detail }: { detail: HealthScreeningDetail }) {
  const badge = sessionStatusBadge(detail)
  const facts: [string, string][] = [
    ['Sınıflar', classesText(detail)],
    ['Yapan', detail.performer.name || '—'],
    ['Eşik', thresholdText(detail.thresholds)],
    ['Sonuç', String(detail.resultCount)],
    ['Gönderilecek bildirim', String(detail.notificationCount)],
  ]
  return (
    <div className="grid gap-2">
      <StatusBadge text={badge.text} tone={badge.tone} />
      <dl className="grid gap-2 text-sm sm:grid-cols-3">
        {facts.map(([label, value]) => (
          <div key={label} className="grid gap-0.5">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function Report({ sessionId }: { sessionId: string }) {
  const report = useHealthScreeningReport(sessionId)
  if (report.error) return <QueryError error={report.error} onRetry={() => void report.refetch()} />
  const data = report.data?.data
  if (!data) return <SummaryLoading />
  const rows = [
    ...data.classes.map((row) => ({ ...row, label: row.className })),
    { ...data.total, classId: 'toplam', label: 'Toplam' },
  ]
  return (
    <div className="grid gap-2">
      <h4 className="text-sm font-semibold">Sınıf raporu</h4>
      <p className="text-sm text-muted-foreground">
        5'ten küçük gruplarda ileri değerlendirme sayısı gizlenir; öğrenci tanınmaz.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label="Sınıf raporu">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th scope="col" className="py-2 pr-3 font-medium">
                Sınıf
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Öğrenci
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Taranan
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Katılmadı
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Reddetti
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Girilmedi
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                İleri değerlendirme
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.classId} className="border-b last:border-b-0">
                <th scope="row" className="py-2 pr-3 text-left font-medium">
                  {row.label}
                </th>
                <td className="py-2 pr-3">{row.roster}</td>
                <td className="py-2 pr-3">{row.screened}</td>
                <td className="py-2 pr-3">{row.absent}</td>
                <td className="py-2 pr-3">{row.refused}</td>
                <td className="py-2 pr-3">{row.missing}</td>
                <td className="py-2 pr-3">{referralCellText(row.referral)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// --- Hızlı giriş ---------------------------------------------------------------------------------

function EntryTable({ detail }: { detail: HealthScreeningDetail }) {
  const record = useRecordHealthScreeningResults()
  const [drafts, setDrafts] = useState<ReadonlyMap<string, EntryDraft>>(
    () => new Map(detail.students.map((row) => [row.studentId, draftOf(row)])),
  )
  const [rowErrors, setRowErrors] = useState<ReadonlyMap<string, string>>(() => new Map())
  const editable = detail.status === 'open'
  const growth = detail.kind === 'growth'
  const update = (studentId: string, patch: Partial<EntryDraft>) =>
    setDrafts((current) => {
      const next = new Map(current)
      const base = current.get(studentId)
      if (base) next.set(studentId, { ...base, ...patch })
      return next
    })
  const plans = detail.students.map((row) => ({
    row,
    plan: entryPlan(detail.kind, row, drafts.get(row.studentId) ?? draftOf(row)),
  }))
  const dirty = plans.filter(({ plan }) => plan.status !== 'unchanged').length
  const save = async () => {
    const errors = new Map<string, string>()
    for (const { row, plan } of plans)
      if (plan.status === 'invalid') errors.set(row.studentId, plan.message)
    setRowErrors(errors)
    if (errors.size > 0) {
      notify.error('Bazı satırlar eksik ya da hatalı; kaydetmeden önce düzeltin.')
      return
    }
    const results = plans.flatMap(({ plan }) => (plan.status === 'ready' ? [plan.item] : []))
    if (results.length === 0) return
    const outcome = await record.submit({ sessionId: detail.id, body: { results } })
    if (outcome.status === 'success') notify.success(`${String(results.length)} sonuç kaydedildi.`)
  }
  return (
    <div className="grid gap-2">
      <h4 className="text-sm font-semibold">Sonuçlar</h4>
      <p className="text-sm text-muted-foreground">
        {editable
          ? growth
            ? 'Boy cm, kilo kg (tek ondalık, virgül olabilir). BKİ kaydedince hesaplanır; eşik aşılırsa öneri kendiliğinden konur. Not veliye görünür.'
            : 'Görme ondalık değerdir (0,05–2,00; ör. 1,0 = 10/10). Eşik altı göz öneri alır. Not veliye görünür.'
          : 'Tarama yayımlandı; sonuçlar değişmez.'}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm" aria-label="Tarama sonuçları">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th scope="col" className="py-2 pr-2 font-medium">
                Öğrenci
              </th>
              <th scope="col" className="py-2 pr-2 font-medium">
                Durum
              </th>
              <th scope="col" className="py-2 pr-2 font-medium">
                {growth ? 'Boy (cm)' : 'Sağ göz'}
              </th>
              <th scope="col" className="py-2 pr-2 font-medium">
                {growth ? 'Kilo (kg)' : 'Sol göz'}
              </th>
              {growth ? null : (
                <th scope="col" className="py-2 pr-2 font-medium">
                  Gözlük
                </th>
              )}
              <th scope="col" className="py-2 pr-2 font-medium">
                İleri değerlendirme
              </th>
              <th scope="col" className="py-2 pr-2 font-medium">
                Not
              </th>
              <th scope="col" className="py-2 pr-2 font-medium">
                Kayıtlı
              </th>
            </tr>
          </thead>
          <tbody>
            {plans.map(({ row }) => (
              <EntryRow
                key={row.studentId}
                row={row}
                draft={drafts.get(row.studentId) ?? draftOf(row)}
                growth={growth}
                overThreshold={draftThreshold(
                  detail.kind,
                  detail.thresholds,
                  drafts.get(row.studentId) ?? draftOf(row),
                )}
                editable={editable && !record.isPending}
                error={rowErrors.get(row.studentId)}
                onChange={(patch) => update(row.studentId, patch)}
              />
            ))}
          </tbody>
        </table>
      </div>
      {detail.students.length === 0 ? (
        <p className="text-sm text-muted-foreground">Hedef sınıflarda etkin öğrenci yok.</p>
      ) : null}
      {editable ? (
        <Button
          className="min-h-11 justify-self-start"
          disabled={record.isPending || dirty === 0}
          aria-busy={record.isPending || undefined}
          onClick={() => void save()}
        >
          {dirty === 0 ? 'Değişiklik yok' : `Değişiklikleri kaydet (${String(dirty)})`}
        </Button>
      ) : null}
    </div>
  )
}

function EntryRow({
  row,
  draft,
  growth,
  overThreshold,
  editable,
  error,
  onChange,
}: {
  row: HealthScreeningStudentRow
  draft: EntryDraft
  growth: boolean
  overThreshold: boolean
  editable: boolean
  error: string | undefined
  onChange: (patch: Partial<EntryDraft>) => void
}) {
  const name = row.studentName ?? 'Öğrenci'
  const screened = draft.outcome === 'screened'
  const result = row.result
  return (
    <>
      <tr className={error ? '' : 'border-b'}>
        <th scope="row" className="py-2 pr-2 text-left font-medium">
          <span className="block">{name}</span>
          <span className="block text-xs font-normal text-muted-foreground">
            {row.inTargetClass ? row.className : `${row.className} (sınıf değişti)`}
          </span>
        </th>
        <td className="py-2 pr-2">
          <NativeSelect
            aria-label={`${name} durum`}
            value={draft.outcome}
            disabled={!editable}
            onChange={(event) =>
              onChange({ outcome: event.target.value as HealthScreeningOutcome | '' })
            }
          >
            <NativeSelectOption value="">Girilmedi</NativeSelectOption>
            {HEALTH_SCREENING_OUTCOMES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {outcomeText(value)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </td>
        <td className="py-2 pr-2">
          <Input
            aria-label={`${name} ${growth ? 'boy' : 'sağ göz'}`}
            inputMode="decimal"
            className="w-20"
            value={draft.first}
            disabled={!editable || !screened}
            onChange={(event) => onChange({ first: event.target.value })}
          />
        </td>
        <td className="py-2 pr-2">
          <Input
            aria-label={`${name} ${growth ? 'kilo' : 'sol göz'}`}
            inputMode="decimal"
            className="w-20"
            value={draft.second}
            disabled={!editable || !screened}
            onChange={(event) => onChange({ second: event.target.value })}
          />
        </td>
        {growth ? null : (
          <td className="py-2 pr-2">
            <Checkbox
              aria-label={`${name} gözlüklü`}
              checked={draft.wearsGlasses}
              disabled={!editable || !screened}
              onCheckedChange={(checked) => onChange({ wearsGlasses: checked === true })}
            />
          </td>
        )}
        <td className="py-2 pr-2">
          <div className="flex items-center gap-2">
            <Checkbox
              aria-label={`${name} ileri değerlendirme önerilir`}
              checked={screened && (draft.referral || overThreshold)}
              disabled={!editable || !screened || overThreshold}
              onCheckedChange={(checked) => onChange({ referral: checked === true })}
            />
            {overThreshold ? <span className="text-xs text-muted-foreground">Eşik</span> : null}
          </div>
        </td>
        <td className="py-2 pr-2">
          <Input
            aria-label={`${name} not`}
            className="w-40"
            maxLength={NOTE_MAX}
            value={draft.note}
            disabled={!editable || draft.outcome === ''}
            onChange={(event) => onChange({ note: event.target.value })}
          />
        </td>
        <td className="py-2 pr-2 text-xs text-muted-foreground">
          {result === null
            ? '—'
            : result.outcome === 'screened'
              ? measurementText(result.measurement)
              : outcomeText(result.outcome)}
        </td>
      </tr>
      {error ? (
        <tr className="border-b">
          <td colSpan={growth ? 7 : 8} className="pb-2 text-sm text-danger" role="alert">
            {`${name}: ${error}`}
          </td>
        </tr>
      ) : null}
    </>
  )
}

function Publish({ detail }: { detail: HealthScreeningDetail }) {
  const publish = usePublishHealthScreening()
  const [confirming, setConfirming] = useState(false)
  const referred = detail.students.filter((row) => row.result?.referralRecommended).length
  const run = async () => {
    const outcome = await publish.submit({ sessionId: detail.id, version: detail.version })
    if (outcome.status !== 'success') return
    setConfirming(false)
    notify.success('Tarama yayımlandı; veliler sonucu görebilir.')
  }
  return (
    <>
      <Button
        variant="secondary"
        className="min-h-11 justify-self-start"
        disabled={detail.resultCount === 0}
        onClick={() => setConfirming(true)}
      >
        Veliye yayımla
      </Button>
      <Modal
        open={confirming}
        onOpenChange={setConfirming}
        title="Tarama yayımlansın mı?"
        description={`Sonuçlar velilere açılır ve sonra değiştirilemez. İleri değerlendirme önerilen ${String(referred)} öğrenci için "gönderilecek" bildirim kaydı açılır; ileti gönderilmez.`}
      >
        <div className="flex flex-wrap gap-2">
          <Button
            className="min-h-11"
            disabled={publish.isPending}
            aria-busy={publish.isPending || undefined}
            onClick={() => void run()}
          >
            Yayımla
          </Button>
          <Button variant="ghost" className="min-h-11" onClick={() => setConfirming(false)}>
            Vazgeç
          </Button>
        </div>
      </Modal>
    </>
  )
}
