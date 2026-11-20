import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useSearchParams } from 'react-router'
import {
  useAnonymizeJobApplications,
  useChangeJobApplicationStage,
  useChangeJobPostingStatus,
  useCreateJobApplication,
  useCreateJobPosting,
  useJobApplication,
  useJobApplicationRetention,
  useJobApplications,
  useJobApplicationSettings,
  useJobPostings,
  useSetJobApplicationSettings,
  useUpdateJobApplication,
  useUpdateJobPosting,
  type JobApplicationDetail,
  type JobApplicationRow,
  type JobPostingRow,
} from '@kampus/react-shared/use-finance-job-postings.ts'
import { useFileUrlFetcher } from '@kampus/react-shared/use-files.ts'
import { isReauthenticationRequired } from '@kampus/react-shared/reauthentication.ts'
import {
  JOB_APPLICATION_CHANNEL_LABELS,
  JOB_APPLICATION_CHANNELS,
  JOB_APPLICATION_STAGE_LABELS,
  JOB_APPLICATION_STAGES,
  JOB_EMPLOYMENT_TYPE_LABELS,
  JOB_EMPLOYMENT_TYPES,
  JOB_POSTING_STATUS_LABELS,
  JOB_POSTING_STATUSES,
  type JobApplicationAnonymizationReason,
} from '@kampus/school-core/lib/finance-job-postings.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { useReauthRetry } from '@/auth/use-reauth-retry.tsx'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FileUploadField, type FileUploadItem } from '@/components/FileUploadField.tsx'
import { FormField } from '@/components/FormField.tsx'
import { LineTabs } from '@/components/LineTabs.tsx'
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
  applicationCountText,
  channelText,
  dayText,
  employmentTypeText,
  jobApplicationBody,
  jobApplicationDefaults,
  jobApplicationEditBody,
  jobApplicationEditDefaults,
  jobApplicationEditField,
  jobApplicationEditSchema,
  jobApplicationFormField,
  jobApplicationFormSchema,
  jobPostingBody,
  jobPostingDefaults,
  jobPostingFormField,
  jobPostingFormSchema,
  jobSettingsBody,
  jobSettingsDefaults,
  jobSettingsFormField,
  jobSettingsFormSchema,
  jobStageFormSchema,
  nextStages,
  postingStatusBadge,
  retentionText,
  stageText,
  stageTone,
  type JobApplicationEditValues,
  type JobApplicationFormValues,
  type JobPostingFormValues,
  type JobSettingsFormValues,
  type JobStageFormValues,
} from './finance-job-posting-forms.ts'

const NO_SORT: readonly string[] = []
const TAB_PARAM = 'is_ilani_sekme'
const TABS = [
  { value: 'ilanlar', label: 'İlanlar' },
  { value: 'basvurular', label: 'Başvurular' },
  { value: 'saklama', label: 'Saklama' },
] as const
type Tab = (typeof TABS)[number]['value']
const isTab = (value: string | null): value is Tab => TABS.some((tab) => tab.value === value)
const POSTING_FILTERS = [
  {
    key: 'status',
    label: 'Durum',
    type: 'select' as const,
    options: JOB_POSTING_STATUSES.map((value) => ({
      value,
      label: JOB_POSTING_STATUS_LABELS[value],
    })),
  },
  {
    key: 'employmentType',
    label: 'Çalışma türü',
    type: 'select' as const,
    options: JOB_EMPLOYMENT_TYPES.map((value) => ({
      value,
      label: JOB_EMPLOYMENT_TYPE_LABELS[value],
    })),
  },
]
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const oneOf = <T extends string>(values: readonly T[], value: string | null): T | undefined =>
  values.find((item) => item === value)
const FILE_POPUP_BLOCKED =
  'Açılır pencere engellendi. Tarayıcıda bu site için açılır pencerelere izin verip yeniden deneyin.'
const POSTING_OPTIONS_QUERY = { page: 1, pageSize: 100 } as const

/** Dosyayı yeni sekmede açar; sekme tıklamayla eşzamanlı açılır, bağlantı gelince adrese gider. */
function useOpenFile() {
  const fetchUrl = useFileUrlFetcher()
  return async (fileId: string) => {
    const tab = window.open('about:blank', '_blank')
    if (!tab) {
      notify.error(FILE_POPUP_BLOCKED)
      return
    }
    try {
      const { url } = await fetchUrl(fileId)
      tab.opener = null
      tab.location.href = url
    } catch (error) {
      tab.close()
      notify.error('Dosya açılamadı. Biraz sonra yeniden deneyin.', error)
    }
  }
}

type PostingTarget = { posting: JobPostingRow | null }

/**
 * İş ilanları (DOM-FIN-128; ON-177): Finans "İş ilanları" sekmesi, yalnız yönetici (K-440).
 * "İlanlar" taslak → yayında → kapandı akışını, "Başvurular" personelin girdiği başvuru havuzunu
 * aşamalarıyla, "Saklama" süresi dolan başvuruları ve kurum ayarını gösterir (K-441). Başvuru
 * ayrıntısı sağ panelde: iletişim, özgeçmiş, aydınlatma kaydı, aşama geçmişi ve aday talebiyle
 * anonimleştirme. Oturumsuz başvuru formu yoktur; başvuruyu personel girer.
 */
export function FinanceJobPostingsSection() {
  const [params, setParams] = useSearchParams()
  const requested = params.get(TAB_PARAM)
  const tab: Tab = isTab(requested) ? requested : 'ilanlar'
  const panel = useDetailPanel('basvuru')
  const [postingForm, setPostingForm] = useState<PostingTarget | null>(null)
  const [applying, setApplying] = useState(false)
  const setTab = (next: Tab) =>
    setParams(
      (current) => {
        const copy = new URLSearchParams(current)
        if (next === 'ilanlar') copy.delete(TAB_PARAM)
        else copy.set(TAB_PARAM, next)
        return copy
      },
      { replace: true },
    )
  return (
    <section
      aria-labelledby="is-ilanlari"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h2 id="is-ilanlari" className="text-lg font-semibold">
            İş ilanları
          </h2>
          <p className="text-sm text-muted-foreground">
            İlanlar ve gelen başvurular. Başvuruyu siz girersiniz; adaya gösterilen aydınlatma
            metninin sürümü kaydedilir, süresi dolan başvurular anonimleştirilir.
          </p>
        </div>
        <span className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setApplying(true)}>
            Başvuru kaydet
          </Button>
          <Button onClick={() => setPostingForm({ posting: null })}>Yeni ilan</Button>
        </span>
      </header>
      <div className="px-6">
        <LineTabs label="İş ilanı görünümü" value={tab} options={TABS} onChange={setTab} />
      </div>
      {tab === 'ilanlar' ? <PostingList onEdit={(posting) => setPostingForm({ posting })} /> : null}
      {tab === 'basvurular' ? <ApplicationList onOpen={panel.open} /> : null}
      {tab === 'saklama' ? <RetentionView onOpen={panel.open} /> : null}
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Başvuru"
      >
        {panel.selectedId ? <ApplicationPanel applicationId={panel.selectedId} /> : null}
      </SidePanel>
      <Modal
        open={postingForm !== null}
        onOpenChange={(open) => (open ? undefined : setPostingForm(null))}
        title={postingForm?.posting ? 'İlanı düzelt' : 'Yeni iş ilanı'}
        description={
          postingForm?.posting
            ? 'Yayındaki ilanın yayın günü değişmez; kapanan ilan düzeltilemez.'
            : 'İlan taslak açılır; yayımlayınca başvuru kaydedilebilir.'
        }
        size="wide"
      >
        {postingForm ? (
          <PostingForm posting={postingForm.posting} onDone={() => setPostingForm(null)} />
        ) : null}
      </Modal>
      <Modal
        open={applying}
        onOpenChange={setApplying}
        title="Başvuru kaydet"
        description="E-postayla, elden, tavsiyeyle ya da kurum sitesinden gelen başvuru. Adaya aydınlatma metni gösterilmeden kayıt yapılmaz."
        size="wide"
      >
        {applying ? (
          <ApplicationForm
            onDone={(id) => {
              setApplying(false)
              panel.open(id)
            }}
          />
        ) : null}
      </Modal>
    </section>
  )
}

// --- İlanlar -------------------------------------------------------------------------------------

type PostingTableRow = {
  id: string
  row: JobPostingRow
  title: string
  position: string
  type: string
  deadline: string
  applications: string
}

function PostingList({ onEdit }: { onEdit: (posting: JobPostingRow) => void }) {
  const list = useListState('is-ilanlari', { urlPrefix: 'ilan_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = oneOf(JOB_POSTING_STATUSES, text(list.state.filters.status))
  const employmentType = oneOf(JOB_EMPLOYMENT_TYPES, text(list.state.filters.employmentType))
  const postings = useJobPostings({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(status === undefined ? {} : { status }),
    ...(employmentType === undefined ? {} : { employmentType }),
  })
  const changeStatus = useChangeJobPostingStatus()
  const [closing, setClosing] = useState<JobPostingRow | null>(null)
  const rows = useMemo(
    () =>
      postings.data?.data.map((item): PostingTableRow => ({
        id: item.id,
        row: item,
        title: item.title,
        position: item.position,
        type: employmentTypeText(item.employmentType),
        deadline: dayText(item.deadlineOn),
        applications: applicationCountText(item),
      })),
    [postings.data],
  )
  const busy = changeStatus.isPending
  const columns = useMemo<DataColumn<PostingTableRow>[]>(() => {
    const publish = async (row: JobPostingRow) => {
      const outcome = await changeStatus.submit({
        postingId: row.id,
        version: row.version,
        status: 'published',
      })
      if (outcome.status === 'success') notify.success('İlan yayımlandı.')
    }
    return [
      { key: 'title', label: 'İlan' },
      { key: 'position', label: 'Pozisyon' },
      { key: 'type', label: 'Çalışma türü' },
      { key: 'deadline', label: 'Son başvuru' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => {
          const badge = postingStatusBadge(row.row)
          return <StatusBadge text={badge.text} tone={badge.tone} />
        },
      },
      { key: 'applications', label: 'Başvuru' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) =>
          row.row.status === 'closed' ? null : (
            <span className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="ghost"
                aria-label={`${row.title} ilanını düzelt`}
                disabled={busy}
                onClick={() => onEdit(row.row)}
              >
                Düzelt
              </Button>
              {row.row.status === 'draft' ? (
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={`${row.title} ilanını yayımla`}
                  disabled={busy}
                  onClick={() => void publish(row.row)}
                >
                  Yayımla
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                aria-label={`${row.title} ilanını kapat`}
                disabled={busy}
                onClick={() => setClosing(row.row)}
              >
                Kapat
              </Button>
            </span>
          ),
      },
    ]
  }, [busy, onEdit, changeStatus])
  return (
    <>
      <ServerDataTable
        list={list}
        rows={rows}
        total={postings.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={POSTING_FILTERS}
        mobileColumns={['title', 'status']}
        caption="İş ilanları"
        empty="Henüz iş ilanı yok."
        emptyFiltered="Bu seçimle eşleşen ilan yok."
        loading={postings.isPending}
        fetching={postings.isFetching && !postings.isPending}
        error={
          postings.error ? (
            <QueryError error={postings.error} onRetry={() => void postings.refetch()} />
          ) : undefined
        }
      />
      <Modal
        open={closing !== null}
        onOpenChange={(open) => (open ? undefined : setClosing(null))}
        title="İlanı kapat"
        description="Kapanan ilan yeniden açılmaz ve düzeltilemez. İşe alınmamış başvuruların saklama süresi bugünden başlar."
      >
        {closing ? <CloseConfirm posting={closing} onDone={() => setClosing(null)} /> : null}
      </Modal>
    </>
  )
}

function CloseConfirm({ posting, onDone }: { posting: JobPostingRow; onDone: () => void }) {
  const changeStatus = useChangeJobPostingStatus()
  const busy = changeStatus.isPending
  const onConfirm = async () => {
    const outcome = await changeStatus.submit({
      postingId: posting.id,
      version: posting.version,
      status: 'closed',
    })
    if (outcome.status === 'success') notify.success('İlan kapatıldı.')
    if (outcome.status !== 'busy') onDone()
  }
  return (
    <div className="grid gap-3">
      <p className="text-sm">{`"${posting.title}" ilanı kapatılacak.`}</p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} aria-busy={busy || undefined} onClick={() => void onConfirm()}>
          İlanı kapat
        </Button>
        <Button variant="outline" disabled={busy} onClick={onDone}>
          Vazgeç
        </Button>
      </div>
    </div>
  )
}

function PostingForm({ posting, onDone }: { posting: JobPostingRow | null; onDone: () => void }) {
  const create = useCreateJobPosting()
  const update = useUpdateJobPosting()
  const form = useForm<JobPostingFormValues>({
    resolver: zodResolver(jobPostingFormSchema),
    defaultValues: jobPostingDefaults(dayKey(), posting),
  })
  const errors = form.formState.errors
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const publishLocked = posting?.status === 'published'
  const onSubmit = form.handleSubmit(async (values) => {
    const setError = (name: string, error: { message: string }) => {
      const field = jobPostingFormField(name)
      if (field) form.setError(field, error, { shouldFocus: true })
      else form.setError('root.server', error)
    }
    const body = jobPostingBody(values)
    const outcome =
      posting === null
        ? await create.submit(body, { setError })
        : await update.submit(
            { postingId: posting.id, version: posting.version, body },
            { setError },
          )
    if (outcome.status !== 'success') return
    notify.success(posting === null ? 'İlan taslak olarak kaydedildi.' : 'İlan güncellendi.')
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="İş ilanı"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <div className="sm:col-span-2">
        <FormField id="ilan-baslik" label="İlan başlığı" error={errors.title}>
          {(control) => <Input {...control} {...form.register('title')} disabled={busy} />}
        </FormField>
      </div>
      <FormField id="ilan-pozisyon" label="Pozisyon / branş" error={errors.position}>
        {(control) => <Input {...control} {...form.register('position')} disabled={busy} />}
      </FormField>
      <FormField id="ilan-tur" label="Çalışma türü" error={errors.employmentType}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('employmentType')}
            className="w-full"
            disabled={busy}
          >
            {JOB_EMPLOYMENT_TYPES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {JOB_EMPLOYMENT_TYPE_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <div className="sm:col-span-2">
        <FormField id="ilan-aciklama" label="Açıklama" error={errors.description}>
          {(control) => (
            <Textarea {...control} {...form.register('description')} rows={4} disabled={busy} />
          )}
        </FormField>
      </div>
      <div className="sm:col-span-2">
        <FormField
          id="ilan-nitelik"
          label="Aranan nitelikler (isteğe bağlı)"
          error={errors.requirements}
        >
          {(control) => (
            <Textarea {...control} {...form.register('requirements')} rows={3} disabled={busy} />
          )}
        </FormField>
      </div>
      <FormField id="ilan-yayin" label="Yayın günü" error={errors.publishOn}>
        {(control) => (
          <Input
            {...control}
            type="date"
            {...form.register('publishOn')}
            disabled={busy || publishLocked}
          />
        )}
      </FormField>
      <FormField id="ilan-son" label="Son başvuru günü" error={errors.deadlineOn}>
        {(control) => (
          <Input {...control} type="date" {...form.register('deadlineOn')} disabled={busy} />
        )}
      </FormField>
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          {posting === null ? 'Taslak kaydet' : 'Kaydet'}
        </Button>
      </div>
    </form>
  )
}

// --- Başvurular ----------------------------------------------------------------------------------

type ApplicationTableRow = {
  id: string
  row: JobApplicationRow
  candidate: string
  posting: string
  channel: string
  received: string
  retention: string
}

const toApplicationRow = (item: JobApplicationRow): ApplicationTableRow => ({
  id: item.id,
  row: item,
  candidate: item.candidateName,
  posting: item.postingTitle,
  channel: channelText(item.channel),
  received: dayText(item.receivedOn),
  retention: retentionText(item.retentionDueOn),
})

function stageColumn(): DataColumn<ApplicationTableRow> {
  return {
    key: 'stage',
    label: 'Aşama',
    cell: (row) =>
      row.row.anonymized ? (
        <StatusBadge text="Anonimleştirildi" tone="gray" />
      ) : (
        <StatusBadge text={stageText(row.row.stage)} tone={stageTone(row.row.stage)} />
      ),
  }
}

function ApplicationList({ onOpen }: { onOpen: (id: string) => void }) {
  const postingOptions = useJobPostings(POSTING_OPTIONS_QUERY)
  const filters = useMemo(
    () => [
      {
        key: 'jobPostingId',
        label: 'İlan',
        type: 'select' as const,
        options: (postingOptions.data?.data ?? []).map((posting) => ({
          value: posting.id,
          label: posting.title,
        })),
      },
      {
        key: 'stage',
        label: 'Aşama',
        type: 'select' as const,
        options: JOB_APPLICATION_STAGES.map((value) => ({
          value,
          label: JOB_APPLICATION_STAGE_LABELS[value],
        })),
      },
      {
        key: 'channel',
        label: 'Kanal',
        type: 'select' as const,
        options: JOB_APPLICATION_CHANNELS.map((value) => ({
          value,
          label: JOB_APPLICATION_CHANNEL_LABELS[value],
        })),
      },
    ],
    [postingOptions.data],
  )
  const list = useListState('is-basvurulari', { urlPrefix: 'basvuru_' })
  const search = useDebouncedValue(list.state.query).trim()
  const jobPostingId = text(list.state.filters.jobPostingId)
  const stage = oneOf(JOB_APPLICATION_STAGES, text(list.state.filters.stage))
  const channel = oneOf(JOB_APPLICATION_CHANNELS, text(list.state.filters.channel))
  const applications = useJobApplications({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(jobPostingId === null ? {} : { jobPostingId }),
    ...(stage === undefined ? {} : { stage }),
    ...(channel === undefined ? {} : { channel }),
  })
  const rows = useMemo(() => applications.data?.data.map(toApplicationRow), [applications.data])
  const columns = useMemo<DataColumn<ApplicationTableRow>[]>(
    () => [
      { key: 'candidate', label: 'Aday' },
      { key: 'posting', label: 'İlan' },
      { key: 'channel', label: 'Kanal' },
      { key: 'received', label: 'Başvuru' },
      stageColumn(),
      { key: 'retention', label: 'Saklama sonu' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.candidate} başvurusunu aç`}
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
      total={applications.data?.meta.total ?? 0}
      sortable={NO_SORT}
      columns={columns}
      filters={filters}
      mobileColumns={['candidate', 'stage']}
      caption="Başvurular"
      empty="Henüz başvuru yok."
      emptyFiltered="Bu seçimle eşleşen başvuru yok."
      loading={applications.isPending}
      fetching={applications.isFetching && !applications.isPending}
      error={
        applications.error ? (
          <QueryError error={applications.error} onRetry={() => void applications.refetch()} />
        ) : undefined
      }
    />
  )
}

function ApplicationForm({ onDone }: { onDone: (id: string) => void }) {
  const postings = useJobPostings(POSTING_OPTIONS_QUERY)
  const settings = useJobApplicationSettings()
  const open = (postings.data?.data ?? []).filter((posting) => posting.status !== 'draft')
  if (postings.error)
    return <QueryError error={postings.error} onRetry={() => void postings.refetch()} />
  if (settings.error)
    return <QueryError error={settings.error} onRetry={() => void settings.refetch()} />
  if (postings.isPending || settings.isPending) return <SummaryLoading />
  if (open.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        Başvuru kaydetmek için önce bir ilanı yayımlayın.
      </p>
    )
  return (
    <ApplicationFormBody
      postings={open}
      noticeVersion={settings.data?.data.privacyNoticeVersion ?? null}
      onDone={onDone}
    />
  )
}

function ApplicationFormBody({
  postings,
  noticeVersion,
  onDone,
}: {
  postings: readonly JobPostingRow[]
  noticeVersion: string | null
  onDone: (id: string) => void
}) {
  const create = useCreateJobApplication()
  const form = useForm<JobApplicationFormValues>({
    resolver: zodResolver(jobApplicationFormSchema),
    defaultValues: jobApplicationDefaults(dayKey(), postings[0]?.id ?? '', noticeVersion),
  })
  const [files, setFiles] = useState<readonly FileUploadItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [scanBlocked, setScanBlocked] = useState(false)
  const [fileError, setFileError] = useState<string | undefined>(undefined)
  const errors = form.formState.errors
  const saving = create.isPending || form.formState.isSubmitting
  const busy = saving || uploading
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(jobApplicationBody(values, files[0]?.id ?? null), {
      setError: (name, error) => {
        const field = jobApplicationFormField(name)
        if (field) form.setError(field, error, { shouldFocus: true })
        else if (name === 'cvFileId') setFileError(error.message)
        else form.setError('root.server', error)
      },
    })
    if (outcome.status !== 'success') return
    notify.success('Başvuru kaydedildi.')
    onDone(outcome.data.data.id)
  })
  return (
    <form
      noValidate
      aria-label="İş başvurusu"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <div className="sm:col-span-2">
        <FormField id="basvuru-ilan" label="İlan" error={errors.jobPostingId}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('jobPostingId')}
              className="w-full"
              disabled={busy}
            >
              {postings.map((posting) => (
                <NativeSelectOption key={posting.id} value={posting.id}>
                  {posting.title}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      </div>
      <FormField id="basvuru-ad" label="Aday adı soyadı" error={errors.candidateName}>
        {(control) => <Input {...control} {...form.register('candidateName')} disabled={busy} />}
      </FormField>
      <FormField id="basvuru-kanal" label="Kanal" error={errors.channel}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('channel')}
            className="w-full"
            disabled={busy}
          >
            {JOB_APPLICATION_CHANNELS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {JOB_APPLICATION_CHANNEL_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="basvuru-eposta" label="E-posta" error={errors.email}>
        {(control) => (
          <Input {...control} type="email" {...form.register('email')} disabled={busy} />
        )}
      </FormField>
      <FormField id="basvuru-telefon" label="Telefon" error={errors.phone}>
        {(control) => (
          <Input
            {...control}
            type="tel"
            inputMode="tel"
            {...form.register('phone')}
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="basvuru-gun" label="Başvuru günü" error={errors.receivedOn}>
        {(control) => (
          <Input {...control} type="date" {...form.register('receivedOn')} disabled={busy} />
        )}
      </FormField>
      <span />
      <FormField
        id="basvuru-aydinlatma-surum"
        label="Gösterilen aydınlatma metni sürümü"
        error={errors.privacyNoticeVersion}
      >
        {(control) => (
          <Input {...control} {...form.register('privacyNoticeVersion')} disabled={busy} />
        )}
      </FormField>
      <FormField
        id="basvuru-aydinlatma-gun"
        label="Aydınlatmanın gösterildiği gün"
        error={errors.privacyNoticeShownOn}
      >
        {(control) => (
          <Input
            {...control}
            type="date"
            {...form.register('privacyNoticeShownOn')}
            disabled={busy}
          />
        )}
      </FormField>
      <div className="sm:col-span-2">
        <FileUploadField
          id="basvuru-ozgecmis"
          label="Özgeçmiş (PDF, isteğe bağlı)"
          purpose="document"
          listLabel="Özgeçmiş"
          items={files}
          disabled={saving}
          error={fileError === undefined ? undefined : { message: fileError }}
          onUploaded={(item) => {
            setFiles([item])
            setFileError(undefined)
          }}
          onRemoved={() => setFiles([])}
          onBusyChange={setUploading}
          onBlockedChange={setScanBlocked}
        />
      </div>
      <div className="sm:col-span-2">
        <FormField id="basvuru-not" label="Not (isteğe bağlı)" error={errors.note}>
          {(control) => (
            <Textarea {...control} {...form.register('note')} rows={2} disabled={busy} />
          )}
        </FormField>
      </div>
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy || scanBlocked} aria-busy={busy || undefined}>
          Başvuruyu kaydet
        </Button>
      </div>
    </form>
  )
}

/** Başvuru ayrıntısı: iletişim, özgeçmiş, aydınlatma, not, aşama geçmişi ve işlemler. */
function ApplicationPanel({ applicationId }: { applicationId: string }) {
  const detail = useJobApplication(applicationId)
  const openFile = useOpenFile()
  const [editing, setEditing] = useState(false)
  const [anonymizing, setAnonymizing] = useState(false)
  if (detail.error) return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
  const application = detail.data?.data
  if (!application) return <SummaryLoading />
  const anonymized = application.anonymized
  const stages = nextStages(application.stage)
  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <h3 className="text-base font-semibold">{application.candidateName}</h3>
        <p className="text-sm text-muted-foreground">
          {`${application.postingTitle} · ${channelText(application.channel)} · ${dayText(application.receivedOn)}`}
        </p>
        <span>
          {anonymized ? (
            <StatusBadge text="Anonimleştirildi" tone="gray" />
          ) : (
            <StatusBadge text={stageText(application.stage)} tone={stageTone(application.stage)} />
          )}
        </span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">E-posta</dt>
        <dd>{application.email ?? '—'}</dd>
        <dt className="text-muted-foreground">Telefon</dt>
        <dd>{application.phone ?? '—'}</dd>
        <dt className="text-muted-foreground">Aydınlatma</dt>
        <dd>{`Sürüm ${application.privacyNoticeVersion} · ${dayText(application.privacyNoticeShownOn)}`}</dd>
        <dt className="text-muted-foreground">Saklama sonu</dt>
        <dd>{retentionText(application.retentionDueOn)}</dd>
        {application.note ? (
          <>
            <dt className="text-muted-foreground">Not</dt>
            <dd className="whitespace-pre-wrap">{application.note}</dd>
          </>
        ) : null}
      </dl>
      {anonymized ? (
        <p className="text-sm text-muted-foreground">
          Başvuru anonimleştirildi; kişisel bilgiler ve özgeçmiş silindi. İlan, kanal, günler ve
          aşama geçmişi istatistik için kalır.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {application.cvFileId ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void openFile(application.cvFileId ?? '')}
            >
              Özgeçmişi aç
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Bilgileri düzelt
          </Button>
          {application.stage === 'hired' ? null : (
            <Button size="sm" variant="ghost" onClick={() => setAnonymizing(true)}>
              Aday talebiyle anonimleştir
            </Button>
          )}
        </div>
      )}
      <div className="grid gap-1">
        <h4 className="text-sm font-semibold">Aşama geçmişi</h4>
        <ol aria-label="Aşama geçmişi" className="grid gap-1 text-sm">
          {application.history.map((change, index) => (
            <li key={`${change.toStage}-${String(index)}`}>
              {`${dayText(change.changedOn)} · ${change.fromStage === null ? 'Kayıt' : `${stageText(change.fromStage)} → ${stageText(change.toStage)}`}`}
            </li>
          ))}
        </ol>
      </div>
      {!anonymized && stages.length > 0 ? (
        <StageForm application={application} stages={stages} />
      ) : null}
      <Modal open={editing} onOpenChange={setEditing} title="Başvuru bilgilerini düzelt">
        {editing ? <EditForm application={application} onDone={() => setEditing(false)} /> : null}
      </Modal>
      {anonymizing ? (
        <AnonymizeDialog
          ids={[application.id]}
          reason="data_subject_request"
          description={`${application.candidateName} başvurusunun adı, iletişimi, notu ve özgeçmişi silinecek. Geri alınamaz.`}
          onClose={() => setAnonymizing(false)}
        />
      ) : null}
    </div>
  )
}

function StageForm({
  application,
  stages,
}: {
  application: JobApplicationDetail
  stages: readonly JobApplicationDetail['stage'][]
}) {
  const change = useChangeJobApplicationStage()
  const form = useForm<JobStageFormValues>({
    resolver: zodResolver(jobStageFormSchema),
    defaultValues: { stage: stages[0] ?? 'rejected', changedOn: dayKey() },
  })
  const errors = form.formState.errors
  const busy = change.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await change.submit(
      { applicationId: application.id, version: application.version, body: values },
      {
        setError: (name, error) => {
          if (name === 'stage' || name === 'changedOn')
            form.setError(name, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') notify.success('Aşama güncellendi.')
  })
  return (
    <form
      noValidate
      aria-label="Aşama değiştir"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="basvuru-asama" label="Yeni aşama" error={errors.stage}>
        {(control) => (
          <NativeSelect {...control} {...form.register('stage')} className="w-full" disabled={busy}>
            {stages.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {JOB_APPLICATION_STAGE_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="basvuru-asama-gun" label="Aşama günü" error={errors.changedOn}>
        {(control) => (
          <Input {...control} type="date" {...form.register('changedOn')} disabled={busy} />
        )}
      </FormField>
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Aşamayı kaydet
        </Button>
      </div>
    </form>
  )
}

function EditForm({
  application,
  onDone,
}: {
  application: JobApplicationDetail
  onDone: () => void
}) {
  const update = useUpdateJobApplication()
  const form = useForm<JobApplicationEditValues>({
    resolver: zodResolver(jobApplicationEditSchema),
    defaultValues: jobApplicationEditDefaults(application),
  })
  const errors = form.formState.errors
  const busy = update.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const body = jobApplicationEditBody(application, values)
    if (body === null) {
      onDone()
      return
    }
    const outcome = await update.submit(
      { applicationId: application.id, version: application.version, body },
      {
        setError: (name, error) => {
          const field = jobApplicationEditField(name)
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status !== 'success') return
    notify.success('Başvuru güncellendi.')
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Başvuru bilgileri"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <div className="sm:col-span-2">
        <FormField id="duzelt-ad" label="Aday adı soyadı" error={errors.candidateName}>
          {(control) => <Input {...control} {...form.register('candidateName')} disabled={busy} />}
        </FormField>
      </div>
      <FormField id="duzelt-eposta" label="E-posta" error={errors.email}>
        {(control) => (
          <Input {...control} type="email" {...form.register('email')} disabled={busy} />
        )}
      </FormField>
      <FormField id="duzelt-telefon" label="Telefon" error={errors.phone}>
        {(control) => <Input {...control} type="tel" {...form.register('phone')} disabled={busy} />}
      </FormField>
      <div className="sm:col-span-2">
        <FormField id="duzelt-not" label="Not" error={errors.note}>
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

// --- Saklama -------------------------------------------------------------------------------------

function RetentionView({ onOpen }: { onOpen: (id: string) => void }) {
  const list = useListState('is-basvuru-saklama', { urlPrefix: 'saklama_' })
  const due = useJobApplicationRetention({ page: list.state.page, pageSize: list.state.pageSize })
  const [target, setTarget] = useState<{ ids: string[]; description: string } | null>(null)
  const rows = useMemo(() => due.data?.data.map(toApplicationRow), [due.data])
  const columns = useMemo<DataColumn<ApplicationTableRow>[]>(
    () => [
      { key: 'candidate', label: 'Aday' },
      { key: 'posting', label: 'İlan' },
      stageColumn(),
      { key: 'retention', label: 'Saklama sonu' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <span className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="ghost"
              aria-label={`${row.candidate} başvurusunu aç`}
              onClick={() => onOpen(row.id)}
            >
              Aç
            </Button>
            <Button
              size="sm"
              variant="secondary"
              aria-label={`${row.candidate} başvurusunu anonimleştir`}
              onClick={() =>
                setTarget({
                  ids: [row.id],
                  description: `${row.candidate} başvurusunun adı, iletişimi, notu ve özgeçmişi silinecek. Geri alınamaz.`,
                })
              }
            >
              Anonimleştir
            </Button>
          </span>
        ),
      },
    ],
    [onOpen],
  )
  const pageIds = due.data?.data.map((item) => item.id) ?? []
  return (
    <div className="grid gap-4 pb-6">
      <SettingsCard />
      <div className="flex flex-wrap items-center justify-between gap-2 px-6">
        <p className="text-sm text-muted-foreground">
          {due.data
            ? `Saklama süresi ${String(due.data.meta.retentionMonths)} ay; süresi dolan ${String(due.data.meta.total)} başvuru.`
            : 'Süresi dolan başvurular yükleniyor.'}
        </p>
        {pageIds.length > 1 ? (
          <Button
            variant="secondary"
            onClick={() =>
              setTarget({
                ids: pageIds,
                description: `Bu sayfadaki ${String(pageIds.length)} başvurunun adı, iletişimi, notu ve özgeçmişi silinecek. Geri alınamaz.`,
              })
            }
          >
            Bu sayfadakileri anonimleştir
          </Button>
        ) : null}
      </div>
      <ServerDataTable
        list={list}
        rows={rows}
        total={due.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={['candidate', 'retention']}
        caption="Saklama süresi dolan başvurular"
        empty="Saklama süresi dolan başvuru yok."
        emptyFiltered="Saklama süresi dolan başvuru yok."
        loading={due.isPending}
        fetching={due.isFetching && !due.isPending}
        error={
          due.error ? (
            <QueryError error={due.error} onRetry={() => void due.refetch()} />
          ) : undefined
        }
      />
      {target ? (
        <AnonymizeDialog
          ids={target.ids}
          reason="retention_expired"
          description={target.description}
          onClose={() => setTarget(null)}
        />
      ) : null}
    </div>
  )
}

function SettingsCard() {
  const settings = useJobApplicationSettings()
  if (settings.error)
    return <QueryError error={settings.error} onRetry={() => void settings.refetch()} />
  const current = settings.data?.data
  if (!current) return <SummaryLoading />
  return <SettingsForm key={current.version} current={current} />
}

function SettingsForm({
  current,
}: {
  current: { retentionMonths: number; privacyNoticeVersion: string | null; version: number }
}) {
  const save = useSetJobApplicationSettings()
  const form = useForm<JobSettingsFormValues>({
    resolver: zodResolver(jobSettingsFormSchema),
    defaultValues: jobSettingsDefaults(current),
  })
  const errors = form.formState.errors
  const busy = save.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const body = jobSettingsBody(current, values)
    if (body === null) {
      notify.success('Ayarda değişiklik yok.')
      return
    }
    const outcome = await save.submit(
      { version: current.version, body },
      {
        setError: (name, error) => {
          const field = jobSettingsFormField(name)
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') notify.success('Ayar kaydedildi.')
  })
  return (
    <form
      noValidate
      aria-label="Başvuru saklama ayarı"
      className="grid gap-3 px-6 pt-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="saklama-ay" label="Saklama süresi (ay)" error={errors.retentionMonths}>
        {(control) => (
          <Input
            {...control}
            inputMode="numeric"
            {...form.register('retentionMonths')}
            disabled={busy}
          />
        )}
      </FormField>
      <FormField
        id="saklama-aydinlatma"
        label="Geçerli aydınlatma metni sürümü"
        error={errors.privacyNoticeVersion}
      >
        {(control) => (
          <Input {...control} {...form.register('privacyNoticeVersion')} disabled={busy} />
        )}
      </FormField>
      <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
        Ayarı kaydet
      </Button>
      <div className="sm:col-span-3">
        <RootError message={errors.root?.server?.message} />
      </div>
    </form>
  )
}

/** Anonimleştirme onayı (K-441): uyarı, taze oturum (parola penceresi), tek seferlik anahtar. */
function AnonymizeDialog({
  ids,
  reason,
  description,
  onClose,
}: {
  ids: readonly string[]
  reason: JobApplicationAnonymizationReason
  description: string
  onClose: () => void
}) {
  const anonymize = useAnonymizeJobApplications()
  const { run, reauthModal } = useReauthRetry()
  const [error, setError] = useState<string | undefined>(undefined)
  const busy = anonymize.isPending
  const onConfirm = async () => {
    setError(undefined)
    const outcome = await run(() =>
      anonymize.submit(
        { applicationIds: [...ids], reason },
        {
          silent: isReauthenticationRequired,
          setError: (_name, problem) => setError(problem.message),
        },
      ),
    )
    if (outcome.status !== 'done') return
    const result = outcome.result
    if (result.status === 'success') {
      notify.success(`${String(result.data.data.anonymizedCount)} başvuru anonimleştirildi.`)
      onClose()
    }
  }
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Başvuruyu anonimleştir"
    >
      <div className="grid gap-3">
        <p className="text-sm">{description}</p>
        <p className="text-sm text-muted-foreground">
          İlan, kanal, günler, aşama geçmişi ve aydınlatma kaydı kalır. Onay için parolanız
          istenebilir.
        </p>
        <RootError message={error} />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="destructive"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => void onConfirm()}
          >
            Anonimleştir
          </Button>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Vazgeç
          </Button>
        </div>
      </div>
      {reauthModal}
    </Modal>
  )
}
