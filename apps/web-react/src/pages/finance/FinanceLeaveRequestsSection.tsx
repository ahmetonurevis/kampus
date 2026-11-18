import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {
  useApproveLeaveRequest,
  useAssignLeaveSubstitutes,
  useCancelLeaveRequest,
  useCreateLeaveRequest,
  useLeaveRequest,
  useLeaveRequestPreview,
  useLeaveRequests,
  useRejectLeaveRequest,
  type LeaveRequestDetail,
  type LeaveRequestLessonView,
  type LeaveRequestTeacher,
} from '@kampus/react-shared/use-finance-leave-requests.ts'
import { useLeaveStaff, useLeaveTypes } from '@kampus/react-shared/use-finance-staff-leave.ts'
import {
  leaveRequestCancelSchema,
  leaveRequestRejectSchema,
  type LeaveRequestStatus,
} from '@kampus/school-core/lib/finance-leave-requests.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
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
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { roleLabel } from './finance-fixed-asset-assignment-forms.ts'
import {
  balanceText,
  changedSubstitutes,
  currentChoices,
  daysText,
  dayText,
  leaveRequestBody,
  leaveRequestDefaults,
  leaveRequestFormField,
  leaveRequestFormSchema,
  lessonSummary,
  lessonText,
  previewQuery,
  rangeText,
  STATUS_OPTIONS,
  statusLabel,
  statusTone,
  substituteOptionLabel,
  warningText,
  weekdayHint,
  type LeaveRequestFormValues,
  type SubstituteChoices,
} from './finance-leave-request-forms.ts'
import { selectableLeaveTypes, typeFacts } from './finance-staff-leave-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['name', 'status']
const FILTERS = [
  { key: 'status', label: 'Talep durumu', type: 'select' as const, options: STATUS_OPTIONS },
]
const STATUSES = new Set<string>(STATUS_OPTIONS.map((option) => option.value))
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)

type Row = {
  id: string
  name: string
  type: string
  range: string
  days: string
  lessons: string
  status: LeaveRequestStatus
}

/**
 * İzin talepleri (DOM-FIN-116; ON-182): Finans "İzin talepleri" sekmesi, yalnız yönetici. Yönetici
 * talebi personel adına açar (personel self-servisi ON-189); onay bekleyen talepler listenin
 * başındadır. Panelde talep, kalan yıllık izin, etkilenen dersler ve yedek öğretmen seçimi, onay
 * (yetersiz bakiyede avans izin işareti), gerekçeli ret ve iptal bulunur.
 */
export function FinanceLeaveRequestsSection() {
  const list = useListState('izin-talepleri', { urlPrefix: 'talep_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = text(list.state.filters.status)
  const [creating, setCreating] = useState(false)
  const requests = useLeaveRequests({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(status !== null && STATUSES.has(status) ? { status: status as LeaveRequestStatus } : {}),
  })
  const panel = useDetailPanel('talep')
  const openRequest = panel.open
  const rows = useMemo(
    () =>
      requests.data?.data.map((item): Row => ({
        id: item.id,
        name: item.name,
        type: item.typeLabel,
        range: rangeText(item),
        days: daysText(item.days),
        lessons: lessonSummary(item),
        status: item.status,
      })),
    [requests.data],
  )
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'name', label: 'Personel' },
      { key: 'type', label: 'Tür' },
      { key: 'range', label: 'Tarih' },
      { key: 'days', label: 'Gün' },
      { key: 'lessons', label: 'Dersler' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => <StatusBadge text={statusLabel(row.status)} tone={statusTone(row.status)} />,
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row: Row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.name} talebini aç`}
            onClick={() => openRequest(row.id)}
          >
            Talebi aç
          </Button>
        ),
      },
    ],
    [openRequest],
  )
  return (
    <section
      aria-labelledby="izin-talepleri"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h2 id="izin-talepleri" className="text-lg font-semibold">
            İzin talepleri
          </h2>
          <p className="text-sm text-muted-foreground">
            Onaylanan talep kullanılan izne yazılır ve yıllık izin bakiyesinden düşer. Derslere
            yedek öğretmen elle seçilir; seçim ders programına yazılmaz.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>Yeni talep</Button>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={requests.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={FILTERS}
        mobileColumns={MOBILE}
        caption="İzin talepleri"
        empty="Henüz izin talebi yok."
        emptyFiltered="Bu seçimle eşleşen talep yok."
        loading={requests.isPending}
        fetching={requests.isFetching && !requests.isPending}
        error={
          requests.error ? (
            <QueryError error={requests.error} onRetry={() => void requests.refetch()} />
          ) : undefined
        }
      />
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="İzin talebi"
      >
        {panel.selectedId ? <RequestDetail requestId={panel.selectedId} /> : null}
      </SidePanel>
      <Modal
        open={creating}
        onOpenChange={setCreating}
        title="Yeni izin talebi"
        description="Personel adına talep açın. İş günü tam gündür; hafta tatili ve genel tatil sayılmaz."
      >
        {creating ? (
          <RequestForm
            onDone={(id) => {
              setCreating(false)
              openRequest(id)
            }}
          />
        ) : null}
      </Modal>
    </section>
  )
}

/** Derslerin yedek öğretmen seçimi; uyarılar seçeneğin adında ve seçimin altında. */
function SubstituteList({
  lessons,
  teachers,
  choices,
  onChange,
  disabled,
}: {
  lessons: readonly LeaveRequestLessonView[]
  teachers: readonly LeaveRequestTeacher[]
  choices: SubstituteChoices
  onChange: (lessonId: string, teacherId: string) => void
  disabled: boolean
}) {
  return (
    <ul aria-label="Etkilenen dersler" className="grid gap-2 text-sm">
      {lessons.map((lesson, index) => {
        const chosen = choices[lesson.lessonId] ?? ''
        const warnings =
          chosen === ''
            ? []
            : (lesson.candidateWarnings.find((item) => item.teacherId === chosen)?.warnings ?? [])
        return (
          <li key={lesson.lessonId} className="grid gap-1 rounded-sm border px-3 py-2">
            <FormField
              id={`yedek-${String(index)}`}
              label={`Yedek öğretmen: ${lessonText(lesson)}`}
              description={warnings.length === 0 ? undefined : `Uyarı: ${warningText(warnings)}`}
            >
              {(control) => (
                <NativeSelect
                  {...control}
                  className="w-full"
                  value={chosen}
                  disabled={disabled}
                  onChange={(event) => onChange(lesson.lessonId, event.target.value)}
                >
                  <NativeSelectOption value="">Yedek seçilmedi</NativeSelectOption>
                  {teachers.map((teacher) => (
                    <NativeSelectOption key={teacher.id} value={teacher.id}>
                      {substituteOptionLabel(teacher, lesson)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </FormField>
          </li>
        )
      })}
    </ul>
  )
}

/** Yeni talep (K-397…K-399): personel, tür, aralık, iş günü, açıklama ve derslere yedek. */
function RequestForm({ onDone }: { onDone: (id: string) => void }) {
  const staff = useLeaveStaff({ page: 1, pageSize: 100, status: 'active' })
  const types = useLeaveTypes()
  const create = useCreateLeaveRequest()
  const [choices, setChoices] = useState<SubstituteChoices>({})
  const form = useForm<LeaveRequestFormValues>({
    resolver: zodResolver(leaveRequestFormSchema),
    defaultValues: leaveRequestDefaults(dayKey()),
  })
  const errors = form.formState.errors
  const busy = create.isPending || form.formState.isSubmitting
  const values = useWatch({ control: form.control })
  const query = previewQuery({
    membershipId: values.membershipId ?? '',
    typeCode: values.typeCode ?? '',
    startDate: values.startDate ?? '',
    endDate: values.endDate ?? '',
    days: values.days ?? '',
  })
  // Nesne her çizimde yenidir; gecikme metin anahtarıyla eşitlenir.
  const settled = useDebouncedValue(query === null ? '' : JSON.stringify(query))
  const preview = useLeaveRequestPreview(
    settled === '' ? null : (JSON.parse(settled) as NonNullable<typeof query>),
  )
  const options = selectableLeaveTypes(types.data?.data ?? [])
  const selected = options.find((type) => type.code === values.typeCode)
  const lessons = preview.data?.data.lessons ?? []
  const onSubmit = form.handleSubmit(async (input) => {
    const known = new Set(lessons.map((lesson) => lesson.lessonId))
    const outcome = await create.submit(
      leaveRequestBody(
        input,
        Object.fromEntries(Object.entries(choices).filter(([id]) => known.has(id))),
      ),
      {
        setError: (name, error) => {
          const field = leaveRequestFormField(name)
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status !== 'success') return
    notify.success('İzin talebi açıldı.')
    onDone(outcome.data.data.id)
  })
  if (types.error) return <QueryError error={types.error} onRetry={() => void types.refetch()} />
  if (staff.error) return <QueryError error={staff.error} onRetry={() => void staff.refetch()} />
  const balance = balanceText(preview.data?.data.balanceAfterDays ?? null)
  const overLimit =
    preview.data !== undefined && preview.data.data.lessonCount > preview.data.data.lessonLimit
  return (
    <form
      noValidate
      aria-label="İzin talebi"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="talep-personel" label="Personel" error={errors.membershipId}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('membershipId')}
            className="w-full"
            disabled={busy || staff.isPending}
          >
            <NativeSelectOption value="">Personel seçin</NativeSelectOption>
            {(staff.data?.data ?? []).map((person) => (
              <NativeSelectOption key={person.membershipId} value={person.membershipId}>
                {`${person.name} (${roleLabel(person.role)})`}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField
        id="talep-tur"
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
      <FormField id="talep-baslangic" label="İlk gün" error={errors.startDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('startDate')} disabled={busy} />
        )}
      </FormField>
      <FormField id="talep-bitis" label="Son gün" error={errors.endDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('endDate')} disabled={busy} />
        )}
      </FormField>
      <FormField
        id="talep-gun"
        label="İş günü"
        error={errors.days}
        description={weekdayHint(values.startDate ?? '', values.endDate ?? '')}
      >
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
        <FormField id="talep-aciklama" label="Açıklama (isteğe bağlı)" error={errors.description}>
          {(control) => (
            <Textarea {...control} {...form.register('description')} rows={2} disabled={busy} />
          )}
        </FormField>
      </div>
      <section aria-labelledby="talep-dersler" className="grid gap-2 sm:col-span-2">
        <h3 id="talep-dersler" className="text-sm font-semibold">
          Etkilenen dersler
        </h3>
        {balance === null ? null : <p className="text-sm">{balance}</p>}
        {query === null ? (
          <p className="text-sm text-muted-foreground">
            Personel ve tarihleri seçince dersler listelenir.
          </p>
        ) : preview.error ? (
          <QueryError error={preview.error} onRetry={() => void preview.refetch()} />
        ) : preview.data === undefined ? (
          <SummaryLoading />
        ) : preview.data.data.ownTeacherId === null ? (
          <p className="text-sm text-muted-foreground">
            Personel bir öğretmen kaydına bağlı değil; ders bağı yok.
          </p>
        ) : lessons.length === 0 ? (
          <p className="text-sm text-muted-foreground">Bu aralıkta dersi yok.</p>
        ) : (
          <>
            {overLimit ? (
              <p role="alert" className="text-sm text-destructive">
                Aralıkta {String(preview.data.data.lessonCount)} ders var; bir talebe en çok{' '}
                {String(preview.data.data.lessonLimit)} ders bağlanır. İzni bölün.
              </p>
            ) : null}
            <SubstituteList
              lessons={lessons}
              teachers={preview.data.data.teachers}
              choices={choices}
              disabled={busy}
              onChange={(lessonId, teacherId) =>
                setChoices((current) => ({ ...current, [lessonId]: teacherId }))
              }
            />
          </>
        )}
      </section>
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Talebi aç
        </Button>
      </div>
    </form>
  )
}

type Dialog = 'approve' | 'reject' | 'cancel' | null

function RequestDetail({ requestId }: { requestId: string }) {
  const detail = useLeaveRequest(requestId)
  const [dialog, setDialog] = useState<Dialog>(null)
  if (detail.error) return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
  const data = detail.data?.data
  if (!data) return <SummaryLoading />
  const close = () => setDialog(null)
  const open = data.status === 'pending' || data.status === 'approved'
  const balance = balanceText(data.balanceAfterDays)
  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <h3 className="text-base font-semibold">{data.name}</h3>
        <p className="text-sm text-muted-foreground">{roleLabel(data.role)}</p>
        <span>
          <StatusBadge text={statusLabel(data.status)} tone={statusTone(data.status)} />
        </span>
      </div>
      <dl aria-label="Talep" className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Tür</dt>
        <dd>{data.typeLabel}</dd>
        <dt className="text-muted-foreground">Tarih</dt>
        <dd>{rangeText(data)}</dd>
        <dt className="text-muted-foreground">İş günü</dt>
        <dd>{daysText(data.days)}</dd>
        {data.description ? (
          <>
            <dt className="text-muted-foreground">Açıklama</dt>
            <dd className="[overflow-wrap:anywhere]">{data.description}</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">Açıldı</dt>
        <dd>{dayText(dayKey(data.createdAt))}</dd>
        {data.decidedAt ? (
          <>
            <dt className="text-muted-foreground">Karar</dt>
            <dd>
              {dayText(dayKey(data.decidedAt))}
              {data.advanceApproved ? ' · avans izin olarak onaylandı' : ''}
            </dd>
          </>
        ) : null}
        {data.rejectReason ? (
          <>
            <dt className="text-muted-foreground">Ret gerekçesi</dt>
            <dd className="[overflow-wrap:anywhere]">{data.rejectReason}</dd>
          </>
        ) : null}
        {data.cancelReason ? (
          <>
            <dt className="text-muted-foreground">İptal gerekçesi</dt>
            <dd className="[overflow-wrap:anywhere]">{data.cancelReason}</dd>
          </>
        ) : null}
      </dl>
      {balance === null ? null : <p className="text-sm font-medium">{balance}</p>}
      {open ? (
        <div className="flex flex-wrap gap-2">
          {data.status === 'pending' ? (
            <>
              <Button onClick={() => setDialog('approve')}>Onayla</Button>
              <Button variant="secondary" onClick={() => setDialog('reject')}>
                Reddet
              </Button>
            </>
          ) : null}
          <Button variant="secondary" onClick={() => setDialog('cancel')}>
            {data.status === 'pending' ? 'Talebi geri çek' : 'Talebi iptal et'}
          </Button>
        </div>
      ) : null}
      <section aria-labelledby="talep-ders-baslik" className="grid gap-2">
        <h4 id="talep-ders-baslik" className="text-sm font-semibold">
          Etkilenen dersler
        </h4>
        {data.lessons.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {data.ownTeacherId === null
              ? 'Personel bir öğretmen kaydına bağlı değil; ders bağı yok.'
              : 'Talep açılırken bu aralıkta dersi yoktu.'}
          </p>
        ) : open ? (
          <SubstituteForm key={data.version} data={data} />
        ) : (
          <ul aria-label="Etkilenen dersler" className="grid gap-1 text-sm">
            {data.lessons.map((lesson) => (
              <li key={lesson.lessonId}>
                {lessonText(lesson)} · {lesson.substituteName ?? 'yedek seçilmedi'}
              </li>
            ))}
          </ul>
        )}
      </section>
      <Modal
        open={dialog === 'approve'}
        onOpenChange={(value) => (value ? undefined : close())}
        title="İzin talebini onayla"
        description="Onaylanan talep kullanılan izne yazılır."
      >
        {dialog === 'approve' ? <ApproveForm data={data} onDone={close} /> : null}
      </Modal>
      <Modal
        open={dialog === 'reject' || dialog === 'cancel'}
        onOpenChange={(value) => (value ? undefined : close())}
        title={dialog === 'reject' ? 'İzin talebini reddet' : 'İzin talebini iptal et'}
        description={
          dialog === 'cancel' && data.status === 'approved'
            ? 'Talebin ürettiği izin kaydı da iptal edilir ve gün bakiyeye geri döner.'
            : undefined
        }
      >
        {dialog === 'reject' || dialog === 'cancel' ? (
          <ReasonForm data={data} kind={dialog} onDone={close} />
        ) : null}
      </Modal>
    </div>
  )
}

/** Yedek seçimi (K-399): yalnız değişen dersler gönderilir. */
function SubstituteForm({ data }: { data: LeaveRequestDetail }) {
  const assign = useAssignLeaveSubstitutes()
  const [choices, setChoices] = useState<SubstituteChoices>(() => currentChoices(data.lessons))
  const [error, setError] = useState<string | undefined>()
  const busy = assign.isPending
  const save = async () => {
    const substitutes = changedSubstitutes(data.lessons, choices)
    if (substitutes.length === 0) {
      setError('Yedek öğretmen seçiminde değişiklik yok.')
      return
    }
    setError(undefined)
    const outcome = await assign.submit(
      { requestId: data.id, version: data.version, substitutes },
      { setError: (_name, problem) => setError(problem.message) },
    )
    if (outcome.status === 'success') notify.success('Yedek öğretmenler kaydedildi.')
  }
  return (
    <div className="grid gap-2">
      <SubstituteList
        lessons={data.lessons}
        teachers={data.teachers}
        choices={choices}
        disabled={busy}
        onChange={(lessonId, teacherId) =>
          setChoices((current) => ({ ...current, [lessonId]: teacherId }))
        }
      />
      <RootError message={error} />
      <div>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={() => void save()}
        >
          Yedekleri kaydet
        </Button>
      </div>
    </div>
  )
}

/** Onay (K-398): kalan izin yetmiyorsa avans izin işareti istenir. */
function ApproveForm({ data, onDone }: { data: LeaveRequestDetail; onDone: () => void }) {
  const approve = useApproveLeaveRequest()
  const short = data.balanceAfterDays !== null && data.balanceAfterDays < 0
  const [advance, setAdvance] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const busy = approve.isPending
  const submit = async () => {
    setError(undefined)
    const outcome = await approve.submit(
      { requestId: data.id, version: data.version, allowAdvance: advance },
      { setError: (_name, problem) => setError(problem.message) },
    )
    if (outcome.status !== 'success') return
    notify.success('İzin talebi onaylandı.')
    onDone()
  }
  return (
    <form
      noValidate
      aria-label="Onay"
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <p className="text-sm">
        {data.name} · {data.typeLabel} · {rangeText(data)} · {daysText(data.days)}
      </p>
      {data.balanceAfterDays === null ? null : (
        <p className="text-sm">{balanceText(data.balanceAfterDays)}</p>
      )}
      {short ? (
        <div className="flex min-h-11 items-center gap-2">
          <Checkbox
            id="talep-avans"
            checked={advance}
            disabled={busy}
            onCheckedChange={(checked) => setAdvance(checked === true)}
          />
          <Label htmlFor="talep-avans">Avans izin olarak onayla</Label>
        </div>
      ) : null}
      <RootError message={error} />
      <div>
        <Button type="submit" disabled={busy || (short && !advance)} aria-busy={busy || undefined}>
          Onayla
        </Button>
      </div>
    </form>
  )
}

/** Gerekçeli ret ya da iptal (K-397). */
function ReasonForm({
  data,
  kind,
  onDone,
}: {
  data: LeaveRequestDetail
  kind: 'reject' | 'cancel'
  onDone: () => void
}) {
  const reject = useRejectLeaveRequest()
  const cancel = useCancelLeaveRequest()
  const command = kind === 'reject' ? reject : cancel
  const form = useForm<{ reason: string }>({
    resolver: zodResolver(kind === 'reject' ? leaveRequestRejectSchema : leaveRequestCancelSchema),
    defaultValues: { reason: '' },
  })
  const errors = form.formState.errors
  const busy = command.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await command.submit(
      { requestId: data.id, version: data.version, reason: values.reason },
      {
        setError: (name, error) => {
          if (name === 'reason') form.setError('reason', error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status !== 'success') return
    notify.success(kind === 'reject' ? 'İzin talebi reddedildi.' : 'İzin talebi iptal edildi.')
    onDone()
  })
  return (
    <form
      noValidate
      aria-label={kind === 'reject' ? 'Ret gerekçesi' : 'İptal gerekçesi'}
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id={`talep-${kind}`} label="Gerekçe" error={errors.reason}>
        {(control) => (
          <Textarea {...control} {...form.register('reason')} rows={2} disabled={busy} />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <div>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          {kind === 'reject' ? 'Reddet' : 'İptal et'}
        </Button>
      </div>
    </form>
  )
}
