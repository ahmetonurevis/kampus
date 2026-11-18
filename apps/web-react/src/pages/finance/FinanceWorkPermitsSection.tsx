import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {
  useApplyWorkPermit,
  useApproveWorkPermit,
  useCancelWorkPermit,
  useCreateWorkPermit,
  useRejectWorkPermit,
  useUpdateWorkPermit,
  useWorkPermit,
  useWorkPermits,
  useWorkPermitTeachers,
  type WorkPermit,
} from '@kampus/react-shared/use-finance-work-permits.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  TEACHER_PERMIT_STATUS_LABELS,
  TEACHER_PERMIT_STATUSES,
  WORK_PERMIT_STATE_LABELS,
  WORK_PERMIT_TYPE_LABELS,
  WORK_PERMIT_TYPES,
  workPermitCancelSchema,
  workPermitRejectSchema,
} from '@kampus/school-core/lib/finance-work-permits.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FileUploadField, type FileUploadItem } from '@/components/FileUploadField.tsx'
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
import {
  approveBody,
  approveDefaults,
  approveFormField,
  approveFormSchema,
  currentPermitText,
  dayText,
  openApplicationText,
  permitBody,
  permitDatesText,
  permitDefaults,
  permitFormSchema,
  permitTitle,
  STATE_TONES,
  TEACHER_STATUS_TONES,
  teacherStatusText,
  VALIDITY_MODE_LABELS,
  VALIDITY_MODES,
  type ApproveFormValues,
  type PermitFormValues,
} from './finance-work-permit-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['name', 'status']
const STATUS_OPTIONS = [
  { value: 'attention', label: 'Dikkat isteyenler' },
  ...TEACHER_PERMIT_STATUSES.map((value) => ({
    value,
    label: TEACHER_PERMIT_STATUS_LABELS[value],
  })),
]
const FILTERS = [
  { key: 'status', label: 'Onay durumu', type: 'select' as const, options: STATUS_OPTIONS },
  {
    key: 'warning',
    label: 'Ders programı',
    type: 'select' as const,
    options: [{ value: 'true', label: 'Programda görevli, onaysız' }],
  },
]
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const STATUS_VALUES = new Set<string>(STATUS_OPTIONS.map((option) => option.value))

type Row = {
  id: string
  name: string
  status: string
  statusTone: (typeof TEACHER_STATUS_TONES)[keyof typeof TEACHER_STATUS_TONES]
  warning: boolean
  current: string
  application: string
}

/**
 * Çalışma onayları (DOM-FIN-114; ON-174): Finans "Çalışma onayları" sekmesi, yalnız yönetici
 * (K-377). Etkin öğretmenler onay durumuyla listelenir; rozetler dikkat isteyen ve ders programında
 * görevli olup onayı olmayan öğretmen sayısıdır (K-376). Öğretmen panelinde kayıtlar ve durum
 * geçişleri (başvuru, onay, ret, iptal), onay belgesi eki bulunur. MEBBİS'e gönderim yoktur.
 */
export function FinanceWorkPermitsSection() {
  const list = useListState('calisma-onayi', { urlPrefix: 'onay_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = text(list.state.filters.status)
  const warning = text(list.state.filters.warning) === 'true'
  const teachers = useWorkPermitTeachers({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(status !== null && STATUS_VALUES.has(status)
      ? { status: status as (typeof TEACHER_PERMIT_STATUSES)[number] | 'attention' }
      : {}),
    ...(warning ? { warning: 'true' as const } : {}),
  })
  const panel = useDetailPanel('onay_ogretmen')
  const openTeacher = panel.open
  const counts = teachers.data?.counts
  const rows = useMemo(
    () =>
      teachers.data?.data.map((item): Row => ({
        id: item.membershipId,
        name: item.name,
        status: teacherStatusText(item),
        statusTone: TEACHER_STATUS_TONES[item.status],
        warning: item.warning,
        current: currentPermitText(item),
        application: openApplicationText(item),
      })),
    [teachers.data],
  )
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'name', label: 'Öğretmen' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <span className="flex flex-wrap gap-1">
            <StatusBadge text={row.status} tone={row.statusTone} />
            {row.warning ? <StatusBadge text="Programda görevli, onaysız" tone="red" /> : null}
          </span>
        ),
      },
      { key: 'current', label: 'Geçerli onay' },
      { key: 'application', label: 'Süren başvuru' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row: Row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.name} çalışma onayı kayıtlarını aç`}
            onClick={() => openTeacher(row.id)}
          >
            Kayıtlar
          </Button>
        ),
      },
    ],
    [openTeacher],
  )
  const selected = teachers.data?.data.find((item) => item.membershipId === panel.selectedId)
  return (
    <section
      aria-labelledby="calisma-onaylari"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading grid gap-2 px-6 pt-6 pb-2">
        <h2 id="calisma-onaylari" className="text-lg font-semibold">
          Çalışma onayları
        </h2>
        <p className="text-sm text-muted-foreground">
          Öğretmenlerin MEBBİS çalışma onayı takibi. Başvuru MEBBİS’ten yapılır; Kampüs bilgi
          göndermez. Bitişine 30 gün ya da daha az kalan onay “dolmak üzere” sayılır.
        </p>
        {counts ? (
          <p aria-label="Uyarı özeti" className="flex flex-wrap gap-2 text-sm">
            <StatusBadge
              text={`Dikkat isteyen: ${String(counts.attention)}`}
              tone={counts.attention > 0 ? 'amber' : 'green'}
            />
            <StatusBadge
              text={`Programda onaysız: ${String(counts.warning)}`}
              tone={counts.warning > 0 ? 'red' : 'green'}
            />
          </p>
        ) : null}
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={teachers.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={FILTERS}
        mobileColumns={MOBILE}
        caption="Öğretmen çalışma onayları"
        empty="Kurumda etkin öğretmen yok."
        emptyFiltered="Bu seçimle eşleşen öğretmen yok."
        loading={teachers.isPending}
        fetching={teachers.isFetching && !teachers.isPending}
        error={
          teachers.error ? (
            <QueryError error={teachers.error} onRetry={() => void teachers.refetch()} />
          ) : undefined
        }
      />
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Öğretmen çalışma onayı"
      >
        {panel.selectedId ? (
          <TeacherPermits membershipId={panel.selectedId} name={selected?.name ?? ''} />
        ) : null}
      </SidePanel>
    </section>
  )
}

type DialogKind = 'apply' | 'approve' | 'reject' | 'edit' | 'cancel'
type Dialog = { kind: 'create' } | { kind: DialogKind; permit: WorkPermit } | null

const DIALOG_TITLES = {
  create: 'Yeni çalışma onayı kaydı',
  apply: 'Başvuru gününü kaydet',
  approve: 'Onayı kaydet',
  reject: 'Reddi kaydet',
  edit: 'Kaydı düzelt',
  cancel: 'Kaydı iptal et',
} as const

function TeacherPermits({ membershipId, name }: { membershipId: string; name: string }) {
  const permits = useWorkPermits({ page: 1, pageSize: 100, membershipId })
  const [dialog, setDialog] = useState<Dialog>(null)
  if (permits.error)
    return <QueryError error={permits.error} onRetry={() => void permits.refetch()} />
  const items = permits.data?.data
  if (!items) return <SummaryLoading />
  // Panel adresten de açılır (öğretmen o sayfada olmayabilir): açık başvuru ve branş kayıtlardan.
  const hasOpenApplication = items.some(
    (permit) => permit.status === 'preparing' || permit.status === 'applied',
  )
  const branch = items.find((permit) => permit.status === 'approved')?.branch ?? ''
  const teacherName = name || items[0]?.teacher.name || 'Öğretmen'
  const close = () => setDialog(null)
  const open = (kind: DialogKind, permit: WorkPermit) => () => setDialog({ kind, permit })
  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <h3 className="text-base font-semibold">{teacherName}</h3>
      </div>
      <div>
        <Button onClick={() => setDialog({ kind: 'create' })} disabled={hasOpenApplication}>
          Yeni kayıt
        </Button>
        {hasOpenApplication ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Süren başvuru sonuçlanmadan yeni kayıt açılmaz.
          </p>
        ) : null}
      </div>
      <section aria-labelledby="onay-kayitlari" className="grid gap-2">
        <h4 id="onay-kayitlari" className="text-sm font-semibold">
          Kayıtlar
        </h4>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Henüz çalışma onayı kaydı yok.</p>
        ) : (
          <ul aria-label="Çalışma onayı kayıtları" className="grid gap-2 text-sm">
            {items.map((permit) => (
              <li
                key={permit.id}
                aria-label={permitTitle(permit)}
                className="grid gap-1 rounded-sm border px-3 py-2"
              >
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {permitTitle(permit)}
                  <StatusBadge
                    text={WORK_PERMIT_STATE_LABELS[permit.state]}
                    tone={STATE_TONES[permit.state]}
                  />
                </span>
                <span className="text-muted-foreground">{permitDatesText(permit)}</span>
                {permit.note ? (
                  <span className="text-muted-foreground [overflow-wrap:anywhere]">
                    {permit.note}
                  </span>
                ) : null}
                <PermitDocument permit={permit} />
                <span className="flex flex-wrap gap-2">
                  {permit.status === 'preparing' ? (
                    <Button size="sm" onClick={open('apply', permit)}>
                      Başvuruldu
                    </Button>
                  ) : null}
                  {permit.status === 'applied' ? (
                    <>
                      <Button size="sm" onClick={open('approve', permit)}>
                        Onayı kaydet
                      </Button>
                      <Button size="sm" variant="secondary" onClick={open('reject', permit)}>
                        Reddi kaydet
                      </Button>
                    </>
                  ) : null}
                  <Button size="sm" variant="secondary" onClick={open('edit', permit)}>
                    Düzelt
                  </Button>
                  <Button size="sm" variant="secondary" onClick={open('cancel', permit)}>
                    İptal et
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Modal
        open={dialog !== null}
        onOpenChange={(value) => (value ? undefined : close())}
        title={dialog === null ? '' : DIALOG_TITLES[dialog.kind]}
      >
        {dialog?.kind === 'create' ? (
          <CreateForm membershipId={membershipId} branch={branch} onDone={close} />
        ) : null}
        {dialog?.kind === 'apply' ? <ApplyForm permit={dialog.permit} onDone={close} /> : null}
        {dialog?.kind === 'approve' ? <ApproveForm permit={dialog.permit} onDone={close} /> : null}
        {dialog?.kind === 'reject' ? <RejectForm permit={dialog.permit} onDone={close} /> : null}
        {dialog?.kind === 'edit' ? <EditForm permit={dialog.permit} onDone={close} /> : null}
        {dialog?.kind === 'cancel' ? <CancelForm permit={dialog.permit} onDone={close} /> : null}
      </Modal>
    </div>
  )
}

/** Onay belgesinin adı (ayrıntıdan); belge yoksa hiçbir şey. */
function PermitDocument({ permit }: { permit: WorkPermit }) {
  const detail = useWorkPermit(permit.id, permit.documentFileId !== null)
  const file = detail.data?.data.documentFile
  if (permit.documentFileId === null || !file) return null
  return <span className="[overflow-wrap:anywhere]">Onay belgesi: {file.name}</span>
}

type ServerError = { message?: string }

/** Yeni kayıt (K-375): tür, branş, isteğe bağlı başvuru günü ve not. */
function CreateForm({
  membershipId,
  branch,
  onDone,
}: {
  membershipId: string
  branch: string
  onDone: () => void
}) {
  const create = useCreateWorkPermit()
  const form = useForm<PermitFormValues>({
    resolver: zodResolver(permitFormSchema),
    defaultValues: permitDefaults(branch),
  })
  const errors = form.formState.errors
  const busy = create.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(permitBody(membershipId, values), {
      setError: (name, error) => {
        if (name === 'permitType' || name === 'branch' || name === 'applicationDate')
          form.setError(name, error, { shouldFocus: true })
        else form.setError('root.server', error)
      },
    })
    if (outcome.status !== 'success') return
    notify.success('Çalışma onayı kaydı açıldı.')
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Çalışma onayı kaydı"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="onay-tur" label="Onay türü" error={errors.permitType}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('permitType')}
            className="w-full"
            disabled={busy}
          >
            {WORK_PERMIT_TYPES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {WORK_PERMIT_TYPE_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="onay-brans" label="Branş" error={errors.branch}>
        {(control) => (
          <Input {...control} autoComplete="off" {...form.register('branch')} disabled={busy} />
        )}
      </FormField>
      <FormField
        id="onay-basvuru"
        label="Başvuru günü (isteğe bağlı)"
        description="Boş bırakırsanız kayıt “hazırlanıyor” olarak açılır."
        error={errors.applicationDate}
      >
        {(control) => (
          <Input {...control} type="date" {...form.register('applicationDate')} disabled={busy} />
        )}
      </FormField>
      <div className="sm:col-span-2">
        <FormField id="onay-not" label="Not (isteğe bağlı)" error={errors.note}>
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

/** Tek gün alanlı küçük form (başvuru günü). */
function ApplyForm({ permit, onDone }: { permit: WorkPermit; onDone: () => void }) {
  const apply = useApplyWorkPermit()
  const [value, setValue] = useState(() => dayKey())
  const [error, setError] = useState<ServerError | undefined>(undefined)
  const busy = apply.isPending
  const submit = async () => {
    setError(undefined)
    if (!daySchema.safeParse(value).success) {
      setError({ message: 'Geçerli bir tarih seçin.' })
      return
    }
    const outcome = await apply.submit(
      { permitId: permit.id, version: permit.version, applicationDate: value },
      { setError: (_name, issue) => setError(issue) },
    )
    if (outcome.status !== 'success') return
    notify.success('Başvuru günü kaydedildi.')
    onDone()
  }
  return (
    <form
      noValidate
      aria-label="Başvuru günü"
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <p className="text-sm">{permitTitle(permit)}</p>
      <FormField id="onay-basvuru-gunu" label="MEBBİS başvuru günü" error={error}>
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

/** Onay (K-376): gün, sayı, geçerlilik bitişi (varsayılan, gün ya da süresiz) ve belge. */
function ApproveForm({ permit, onDone }: { permit: WorkPermit; onDone: () => void }) {
  const approve = useApproveWorkPermit()
  const form = useForm<ApproveFormValues>({
    resolver: zodResolver(approveFormSchema),
    defaultValues: approveDefaults(dayKey()),
  })
  const [files, setFiles] = useState<readonly FileUploadItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const errors = form.formState.errors
  const busy = approve.isPending || form.formState.isSubmitting || uploading
  const mode = useWatch({ control: form.control, name: 'validityMode' })
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await approve.submit(
      {
        permitId: permit.id,
        version: permit.version,
        body: approveBody(values, files[0]?.id ?? null),
      },
      {
        setError: (name, error) => {
          const field = approveFormField(name)
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status !== 'success') return
    const until = outcome.data.data.validUntil
    notify.success(
      until === null
        ? 'Onay kaydedildi (süresiz).'
        : `Onay kaydedildi; geçerlilik ${dayText(until)} tarihine kadar.`,
    )
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Onay bilgisi"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <p className="text-sm sm:col-span-2">{permitTitle(permit)}</p>
      <FormField id="onay-gunu" label="Onay günü" error={errors.approvalDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('approvalDate')} disabled={busy} />
        )}
      </FormField>
      <FormField id="onay-sayi" label="Onay sayısı / belge no" error={errors.approvalNumber}>
        {(control) => (
          <Input
            {...control}
            autoComplete="off"
            {...form.register('approvalNumber')}
            disabled={busy}
          />
        )}
      </FormField>
      <FormField
        id="onay-gecerlilik"
        label="Geçerlilik bitişi"
        description="Varsayılan: onay gününün eğitim yılı sonu (yaz aylarında verilen onayda sonraki yıl)."
        error={errors.validityMode}
      >
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('validityMode')}
            className="w-full"
            disabled={busy}
          >
            {VALIDITY_MODES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {VALIDITY_MODE_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {mode === 'date' ? (
        <FormField id="onay-bitis" label="Bitiş günü" error={errors.validUntil}>
          {(control) => (
            <Input {...control} type="date" {...form.register('validUntil')} disabled={busy} />
          )}
        </FormField>
      ) : null}
      <div className="sm:col-span-2">
        <FileUploadField
          id="onay-belge"
          label="Onay belgesi (isteğe bağlı)"
          purpose="document"
          description="MEBBİS onay yazısının PDF’i; en çok 20 MB."
          listLabel="Onay belgesi"
          items={files}
          disabled={busy}
          onUploaded={(item) => setFiles([item])}
          onRemoved={() => setFiles([])}
          onBusyChange={setUploading}
          onBlockedChange={setBlocked}
        />
      </div>
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy || blocked} aria-busy={busy || undefined}>
          Onayı kaydet
        </Button>
      </div>
    </form>
  )
}

/** Ret (K-375): gün ve gerekçe. */
function RejectForm({ permit, onDone }: { permit: WorkPermit; onDone: () => void }) {
  const reject = useRejectWorkPermit()
  const form = useForm<{ decisionDate: string; reason: string }>({
    resolver: zodResolver(workPermitRejectSchema),
    defaultValues: { decisionDate: dayKey(), reason: '' },
  })
  const errors = form.formState.errors
  const busy = reject.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await reject.submit(
      { permitId: permit.id, version: permit.version, body: values },
      {
        setError: (name, error) => {
          if (name === 'decisionDate' || name === 'reason')
            form.setError(name, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status !== 'success') return
    notify.success('Ret kaydedildi.')
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Ret bilgisi"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <p className="text-sm">{permitTitle(permit)}</p>
      <FormField id="onay-ret-gunu" label="Ret günü" error={errors.decisionDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('decisionDate')} disabled={busy} />
        )}
      </FormField>
      <FormField id="onay-ret-gerekce" label="Ret gerekçesi" error={errors.reason}>
        {(control) => (
          <Textarea {...control} {...form.register('reason')} rows={2} disabled={busy} />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <div>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Kaydet
        </Button>
      </div>
    </form>
  )
}

/**
 * Düzeltme (K-375): açık kayıtta tür, branş ve not; sonuçlanmış kayıtta yalnız not. Onay belgesi
 * her durumda eklenir ya da değiştirilir.
 */
function EditForm({ permit, onDone }: { permit: WorkPermit; onDone: () => void }) {
  const update = useUpdateWorkPermit()
  const decided = permit.status === 'approved' || permit.status === 'rejected'
  const detail = useWorkPermit(permit.id)
  const current = detail.data?.data.documentFile ?? null
  const [permitType, setPermitType] = useState(permit.permitType)
  const [branch, setBranch] = useState(permit.branch)
  const [note, setNote] = useState(permit.note ?? '')
  const [files, setFiles] = useState<readonly FileUploadItem[] | null>(null)
  const [uploading, setUploading] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [error, setError] = useState<{ field: string; message?: string } | null>(null)
  const busy = update.isPending || uploading
  const shown = files ?? (current === null ? [] : [{ id: current.id, name: current.name }])
  const submit = async () => {
    setError(null)
    const trimmedNote = note.trim() === '' ? null : note.trim()
    const documentFileId = files === null ? undefined : (files[0]?.id ?? null)
    const body = {
      ...(decided || permitType === permit.permitType ? {} : { permitType }),
      ...(decided || branch.trim() === permit.branch ? {} : { branch: branch.trim() }),
      ...(trimmedNote === permit.note ? {} : { note: trimmedNote }),
      ...(documentFileId === undefined || documentFileId === permit.documentFileId
        ? {}
        : { documentFileId }),
    }
    if (Object.keys(body).length === 0) {
      setError({ field: 'root', message: 'Kayıtta değişen bir alan yok.' })
      return
    }
    const outcome = await update.submit(
      { permitId: permit.id, version: permit.version, body },
      { setError: (name, issue) => setError({ field: name, ...issue }) },
    )
    if (outcome.status !== 'success') return
    notify.success('Kayıt düzeltildi.')
    onDone()
  }
  const fieldError = (field: string) =>
    error?.field === field ? { message: error.message } : undefined
  return (
    <form
      noValidate
      aria-label="Kayıt düzeltme"
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      {decided ? (
        <p className="text-sm text-muted-foreground">
          {permitTitle(permit)}: sonuçlanmış kayıtta yalnız not ve onay belgesi değişir.
        </p>
      ) : (
        <>
          <FormField id="onay-duzelt-tur" label="Onay türü" error={fieldError('permitType')}>
            {(control) => (
              <NativeSelect
                {...control}
                value={permitType}
                onChange={(event) => setPermitType(event.target.value as typeof permitType)}
                className="w-full"
                disabled={busy}
              >
                {WORK_PERMIT_TYPES.map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {WORK_PERMIT_TYPE_LABELS[value]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField id="onay-duzelt-brans" label="Branş" error={fieldError('branch')}>
            {(control) => (
              <Input
                {...control}
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                disabled={busy}
              />
            )}
          </FormField>
        </>
      )}
      <FormField id="onay-duzelt-not" label="Not" error={fieldError('note')}>
        {(control) => (
          <Textarea
            {...control}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            disabled={busy}
          />
        )}
      </FormField>
      <FileUploadField
        id="onay-duzelt-belge"
        label="Onay belgesi"
        purpose="document"
        description="MEBBİS onay yazısının PDF’i; en çok 20 MB."
        listLabel="Onay belgesi"
        items={shown}
        error={fieldError('documentFileId')}
        disabled={busy}
        onUploaded={(item) => setFiles([item])}
        onRemoved={() => setFiles([])}
        onBusyChange={setUploading}
        onBlockedChange={setBlocked}
      />
      <RootError
        message={
          error && !['permitType', 'branch', 'note', 'documentFileId'].includes(error.field)
            ? error.message
            : undefined
        }
      />
      <div>
        <Button type="submit" disabled={busy || blocked} aria-busy={busy || undefined}>
          Kaydet
        </Button>
      </div>
    </form>
  )
}

/** Yanlış kaydın iptali: gerekçe zorunlu. */
function CancelForm({ permit, onDone }: { permit: WorkPermit; onDone: () => void }) {
  const cancel = useCancelWorkPermit()
  const form = useForm<{ reason: string }>({
    resolver: zodResolver(workPermitCancelSchema),
    defaultValues: { reason: '' },
  })
  const errors = form.formState.errors
  const busy = cancel.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await cancel.submit(
      { permitId: permit.id, version: permit.version, reason: values.reason },
      {
        setError: (name, error) => {
          if (name === 'reason') form.setError('reason', error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status !== 'success') return
    notify.success('Kayıt iptal edildi.')
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
        {permitTitle(permit)} · {permitDatesText(permit)}
      </p>
      <FormField id="onay-iptal" label="Gerekçe" error={errors.reason}>
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
