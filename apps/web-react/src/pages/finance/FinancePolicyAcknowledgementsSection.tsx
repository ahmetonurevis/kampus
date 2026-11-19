import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useSearchParams } from 'react-router'
import {
  useCreatePolicyAcknowledgement,
  useCreatePolicyDocument,
  usePolicyDocument,
  usePolicyDocuments,
  usePolicyDocumentStaff,
  usePolicyStaff,
  type PolicyDocumentRow,
} from '@kampus/react-shared/use-finance-policy-acknowledgements.ts'
import { useFileUrlFetcher } from '@kampus/react-shared/use-files.ts'
import {
  POLICY_AUDIENCE_LABELS,
  POLICY_AUDIENCES,
  POLICY_TYPE_LABELS,
  POLICY_TYPES,
  PROXY_POLICY_ACK_CHANNELS,
  POLICY_ACK_CHANNEL_LABELS,
} from '@kampus/school-core/lib/finance-policy-acknowledgements.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
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
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { roleLabel } from './finance-fixed-asset-assignment-forms.ts'
import {
  audienceText,
  channelText,
  dayText,
  missingDocumentsText,
  policyAckBody,
  policyAckDefaults,
  policyAckFormField,
  policyAckFormSchema,
  policyDocumentBody,
  policyDocumentDefaults,
  policyDocumentFormField,
  policyDocumentFormSchema,
  policyTypeText,
  rateText,
  versionText,
  type PolicyAckFormValues,
  type PolicyDocumentFormValues,
} from './finance-policy-acknowledgement-forms.ts'

const NO_SORT: readonly string[] = []
const TAB_PARAM = 'politika_sekme'
const STAFF_TAB = 'personel'
const TABS = [
  { value: 'belgeler', label: 'Belgeler' },
  { value: STAFF_TAB, label: 'Personel' },
] as const
type Tab = (typeof TABS)[number]['value']
const TYPE_OPTIONS = POLICY_TYPES.map((value) => ({ value, label: POLICY_TYPE_LABELS[value] }))
const DOCUMENT_FILTERS = [
  { key: 'policyType', label: 'Belge türü', type: 'select' as const, options: TYPE_OPTIONS },
  {
    key: 'status',
    label: 'Sürüm',
    type: 'select' as const,
    options: [{ value: 'all', label: 'Geçmiş sürümler dahil' }],
  },
]
const STAFF_FILTERS = [
  {
    key: 'missing',
    label: 'Onay durumu',
    type: 'select' as const,
    options: [{ value: 'true', label: 'Eksik onayı olanlar' }],
  },
]
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const isPolicyType = (value: string | null): value is (typeof POLICY_TYPES)[number] =>
  POLICY_TYPES.some((type) => type === value)
const FILE_POPUP_BLOCKED =
  'Açılır pencere engellendi. Tarayıcıda bu site için açılır pencerelere izin verip yeniden deneyin.'

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

type PublishTarget = { previous: PolicyDocumentRow | null }

/**
 * Politika onayları (DOM-FIN-127; ON-190): Finans "Politika onayları" sekmesi, yönetici ve ön büro.
 * "Belgeler" geçerli sürümleri onay oranıyla, "Personel" her personelin eksik onaylarını listeler.
 * Belge panelinde onaylamayan personel ve personel adına onay kaydı (kanal, gün, isteğe bağlı ıslak
 * imza taraması; K-437). Belge ve yeni sürümü yalnız yönetici yayımlar; yeni sürüm önceki sürümün
 * onaylarını geçersiz kılar (K-436).
 */
export function FinancePolicyAcknowledgementsSection({ isManager }: { isManager: boolean }) {
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get(TAB_PARAM) === STAFF_TAB ? STAFF_TAB : 'belgeler'
  const panel = useDetailPanel('politika_belge')
  const [publish, setPublish] = useState<PublishTarget | null>(null)
  const setTab = (next: Tab) =>
    setParams(
      (current) => {
        const copy = new URLSearchParams(current)
        if (next === STAFF_TAB) copy.set(TAB_PARAM, STAFF_TAB)
        else copy.delete(TAB_PARAM)
        return copy
      },
      { replace: true },
    )
  return (
    <section
      aria-labelledby="politika-onaylari"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h2 id="politika-onaylari" className="text-lg font-semibold">
            Politika onayları
          </h2>
          <p className="text-sm text-muted-foreground">
            Personel yönetmeliği, KVKK taahhüdü ve iş güvenliği gibi belgelerin okundu onayları.
            Yeni sürüm yayımlanınca personel yeniden onaylar; onay kaydı silinmez.
          </p>
        </div>
        {isManager ? (
          <Button onClick={() => setPublish({ previous: null })}>Yeni belge</Button>
        ) : null}
      </header>
      <div className="px-6">
        <LineTabs label="Politika görünümü" value={tab} options={TABS} onChange={setTab} />
      </div>
      {tab === STAFF_TAB ? (
        <StaffList />
      ) : (
        <DocumentList
          isManager={isManager}
          onOpen={panel.open}
          onNewVersion={(previous) => setPublish({ previous })}
        />
      )}
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Politika belgesi"
      >
        {panel.selectedId ? <DocumentPanel documentId={panel.selectedId} /> : null}
      </SidePanel>
      <Modal
        open={publish !== null}
        onOpenChange={(open) => (open ? undefined : setPublish(null))}
        title={publish?.previous ? 'Yeni sürüm yayımla' : 'Yeni politika belgesi'}
        description={
          publish?.previous
            ? 'Yeni sürüm öncekinin yerine geçer; önceki sürümün onayları geçersiz sayılır ve personel yeniden onaylar.'
            : 'Belge PDF olarak yüklenir; hedef kitledeki etkin personelin onayı izlenir.'
        }
      >
        {publish ? (
          <PublishForm previous={publish.previous} onDone={() => setPublish(null)} />
        ) : null}
      </Modal>
    </section>
  )
}

type DocumentTableRow = {
  id: string
  row: PolicyDocumentRow
  title: string
  type: string
  version: string
  published: string
  audience: string
  rate: string
}

function DocumentList({
  isManager,
  onOpen,
  onNewVersion,
}: {
  isManager: boolean
  onOpen: (id: string) => void
  onNewVersion: (previous: PolicyDocumentRow) => void
}) {
  const list = useListState('politika-belgeler', { urlPrefix: 'politika_' })
  const search = useDebouncedValue(list.state.query).trim()
  const policyType = text(list.state.filters.policyType)
  const status = text(list.state.filters.status)
  const openFile = useOpenFile()
  const documents = usePolicyDocuments({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isPolicyType(policyType) ? { policyType } : {}),
    ...(status === 'all' ? { status: 'all' as const } : {}),
  })
  const rows = useMemo(
    () =>
      documents.data?.data.map((item): DocumentTableRow => ({
        id: item.id,
        row: item,
        title: item.title,
        type: policyTypeText(item.policyType),
        version: item.current ? versionText(item.version) : `${versionText(item.version)} (eski)`,
        published: dayText(item.publishedOn),
        audience: audienceText(item.audience),
        rate: rateText(item),
      })),
    [documents.data],
  )
  const columns = useMemo<DataColumn<DocumentTableRow>[]>(
    () => [
      { key: 'title', label: 'Belge' },
      { key: 'type', label: 'Tür' },
      { key: 'version', label: 'Sürüm' },
      { key: 'published', label: 'Yayın' },
      { key: 'audience', label: 'Hedef kitle' },
      {
        key: 'rate',
        label: 'Onay',
        cell: (row) =>
          row.row.current ? (
            <StatusBadge
              text={rateText(row.row)}
              tone={row.row.pendingCount === 0 ? 'green' : 'amber'}
            />
          ) : (
            <StatusBadge text="Geçersiz (yeni sürüm var)" tone="gray" />
          ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <span className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              aria-label={`${row.title} onaylarını aç`}
              onClick={() => onOpen(row.id)}
            >
              Onaylar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`${row.title} PDF'ini aç`}
              onClick={() => void openFile(row.row.fileId)}
            >
              PDF
            </Button>
            {isManager && row.row.current ? (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`${row.title} için yeni sürüm`}
                onClick={() => onNewVersion(row.row)}
              >
                Yeni sürüm
              </Button>
            ) : null}
          </span>
        ),
      },
    ],
    [isManager, onOpen, onNewVersion, openFile],
  )
  return (
    <ServerDataTable
      list={list}
      rows={rows}
      total={documents.data?.meta.total ?? 0}
      sortable={NO_SORT}
      columns={columns}
      filters={DOCUMENT_FILTERS}
      mobileColumns={['title', 'rate']}
      caption="Politika belgeleri"
      empty="Henüz politika belgesi yayımlanmadı."
      emptyFiltered="Bu seçimle eşleşen belge yok."
      loading={documents.isPending}
      fetching={documents.isFetching && !documents.isPending}
      error={
        documents.error ? (
          <QueryError error={documents.error} onRetry={() => void documents.refetch()} />
        ) : undefined
      }
    />
  )
}

type StaffTableRow = { id: string; name: string; role: string; summary: string; missing: string }

function StaffList() {
  const list = useListState('politika-personel', {
    urlPrefix: 'politika_personel_',
    urlFilters: { missing: 'eksik' },
  })
  const search = useDebouncedValue(list.state.query).trim()
  const missing = text(list.state.filters.missing)
  const staff = usePolicyStaff({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(missing === 'true' ? { missing: 'true' as const } : {}),
  })
  const rows = useMemo(
    () =>
      staff.data?.data.map((item): StaffTableRow => ({
        id: item.membershipId,
        name: item.name,
        role: roleLabel(item.role),
        summary: `${String(item.acknowledgedCount)} / ${String(item.requiredCount)}`,
        missing: missingDocumentsText(item.missingDocuments) ?? 'Eksik yok',
      })),
    [staff.data],
  )
  const columns = useMemo<DataColumn<StaffTableRow>[]>(
    () => [
      { key: 'name', label: 'Ad' },
      { key: 'role', label: 'Rol' },
      { key: 'summary', label: 'Onaylanan' },
      { key: 'missing', label: 'Eksik onaylar' },
    ],
    [],
  )
  return (
    <ServerDataTable
      list={list}
      rows={rows}
      total={staff.data?.meta.total ?? 0}
      sortable={NO_SORT}
      columns={columns}
      filters={STAFF_FILTERS}
      mobileColumns={['name', 'missing']}
      caption="Personel politika onayları"
      empty="Kurumda etkin personel yok."
      emptyFiltered="Bu seçimle eşleşen personel yok."
      loading={staff.isPending}
      fetching={staff.isFetching && !staff.isPending}
      error={
        staff.error ? (
          <QueryError error={staff.error} onRetry={() => void staff.refetch()} />
        ) : undefined
      }
    />
  )
}

const PANEL_TABS = [
  { value: 'pending', label: 'Onaylamayanlar' },
  { value: 'acknowledged', label: 'Onaylayanlar' },
] as const
type PanelTab = (typeof PANEL_TABS)[number]['value']
const PANEL_PAGE_SIZE = 100

/** Sürüm ayrıntısı, sürüm geçmişi, onaylamayan/onaylayan personel ve personel adına onay. */
function DocumentPanel({ documentId }: { documentId: string }) {
  const detail = usePolicyDocument(documentId)
  const [status, setStatus] = useState<PanelTab>('pending')
  const [recording, setRecording] = useState<{ id: string; name: string } | null>(null)
  const openFile = useOpenFile()
  const staff = usePolicyDocumentStaff(documentId, { page: 1, pageSize: PANEL_PAGE_SIZE, status })
  if (detail.error) return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
  const doc = detail.data?.data
  if (!doc) return <SummaryLoading />
  const people = staff.data?.data ?? []
  const total = staff.data?.meta.total ?? 0
  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <h3 className="text-base font-semibold">{doc.title}</h3>
        <p className="text-sm text-muted-foreground">
          {`${policyTypeText(doc.policyType)} · ${versionText(doc.version)} · ${dayText(doc.publishedOn)} · ${audienceText(doc.audience)}`}
        </p>
        <p className="text-sm">
          {doc.current ? `Onay: ${rateText(doc)}` : 'Bu sürümün yerine yeni sürüm yayımlandı.'}
        </p>
      </div>
      {doc.versions.length > 1 ? (
        <div className="grid gap-1">
          <h4 className="text-sm font-semibold">Sürüm geçmişi</h4>
          <ul aria-label="Sürüm geçmişi" className="grid gap-1 text-sm">
            {doc.versions.map((version) => (
              <li key={version.id}>
                {`${versionText(version.version)} · ${dayText(version.publishedOn)} · ${String(version.acknowledgedCount)} onay`}
                {version.current ? ' (geçerli)' : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <LineTabs label="Onay durumu" value={status} options={PANEL_TABS} onChange={setStatus} />
      {staff.error ? (
        <QueryError error={staff.error} onRetry={() => void staff.refetch()} />
      ) : staff.isPending ? (
        <SummaryLoading />
      ) : people.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {status === 'pending'
            ? 'Hedef kitledeki bütün etkin personel onayladı.'
            : 'Henüz onay kaydı yok.'}
        </p>
      ) : (
        <ul aria-label={status === 'pending' ? 'Onaylamayan personel' : 'Onaylayan personel'}>
          {people.map((person) => (
            <li
              key={person.membershipId}
              className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm"
            >
              <span>
                <span className="font-medium">{person.name}</span>
                <span className="text-muted-foreground">{` · ${roleLabel(person.role)}`}</span>
                {person.acknowledgement ? (
                  <span className="block text-muted-foreground">
                    {`${dayText(person.acknowledgement.acknowledgedOn)} · ${channelText(person.acknowledgement.channel)}`}
                  </span>
                ) : null}
              </span>
              {person.acknowledgement?.scanFileId ? (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`${person.name} imza taramasını aç`}
                  onClick={() => void openFile(person.acknowledgement?.scanFileId ?? '')}
                >
                  Tarama
                </Button>
              ) : null}
              {doc.current && person.acknowledgement === null ? (
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={`${person.name} için onay kaydet`}
                  onClick={() => setRecording({ id: person.membershipId, name: person.name })}
                >
                  Onay kaydet
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {total > PANEL_PAGE_SIZE ? (
        <p className="text-sm text-muted-foreground">
          {`İlk ${String(PANEL_PAGE_SIZE)} kişi gösteriliyor; "Personel" görünümünde arayın.`}
        </p>
      ) : null}
      <Modal
        open={recording !== null}
        onOpenChange={(open) => (open ? undefined : setRecording(null))}
        title="Okundu onayı kaydet"
        description={
          recording
            ? `${recording.name} adına "okundu ve imzalandı" kaydı. Kayıt silinmez.`
            : undefined
        }
      >
        {recording ? (
          <AckForm
            documentId={doc.id}
            membershipId={recording.id}
            onDone={() => setRecording(null)}
          />
        ) : null}
      </Modal>
    </div>
  )
}

function AckForm({
  documentId,
  membershipId,
  onDone,
}: {
  documentId: string
  membershipId: string
  onDone: () => void
}) {
  const create = useCreatePolicyAcknowledgement()
  const form = useForm<PolicyAckFormValues>({
    resolver: zodResolver(policyAckFormSchema),
    defaultValues: policyAckDefaults(dayKey()),
  })
  const [files, setFiles] = useState<readonly FileUploadItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [scanBlocked, setScanBlocked] = useState(false)
  const errors = form.formState.errors
  const saving = create.isPending || form.formState.isSubmitting
  const busy = saving || uploading
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(
      policyAckBody(documentId, membershipId, values, files[0]?.id ?? null),
      {
        setError: (name, error) => {
          const field = policyAckFormField(name)
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status !== 'success') return
    notify.success('Onay kaydedildi.')
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Okundu onayı"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="politika-onay-gunu" label="Onay günü" error={errors.acknowledgedOn}>
        {(control) => (
          <Input {...control} type="date" {...form.register('acknowledgedOn')} disabled={busy} />
        )}
      </FormField>
      <FormField id="politika-kanal" label="Kanal" error={errors.channel}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('channel')}
            className="w-full"
            disabled={busy}
          >
            {PROXY_POLICY_ACK_CHANNELS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {POLICY_ACK_CHANNEL_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <div className="sm:col-span-2">
        <FileUploadField
          id="politika-tarama"
          label="Islak imza taraması (isteğe bağlı)"
          purpose="document"
          description="İmzalı formun PDF taraması."
          listLabel="İmza taraması"
          items={files}
          disabled={saving}
          onUploaded={(item) => setFiles([item])}
          onRemoved={() => setFiles([])}
          onBusyChange={setUploading}
          onBlockedChange={setScanBlocked}
        />
      </div>
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy || scanBlocked} aria-busy={busy || undefined}>
          Onayı kaydet
        </Button>
      </div>
    </form>
  )
}

function PublishForm({
  previous,
  onDone,
}: {
  previous: PolicyDocumentRow | null
  onDone: () => void
}) {
  const create = useCreatePolicyDocument()
  const form = useForm<PolicyDocumentFormValues>({
    resolver: zodResolver(policyDocumentFormSchema),
    defaultValues: policyDocumentDefaults(dayKey(), previous),
  })
  const [files, setFiles] = useState<readonly FileUploadItem[]>([])
  const [fileError, setFileError] = useState<string | undefined>(undefined)
  const [uploading, setUploading] = useState(false)
  const [scanBlocked, setScanBlocked] = useState(false)
  const errors = form.formState.errors
  const saving = create.isPending || form.formState.isSubmitting
  const busy = saving || uploading
  const onSubmit = form.handleSubmit(async (values) => {
    const fileId = files[0]?.id
    if (fileId === undefined) {
      setFileError('Belge dosyasını (PDF) yükleyin.')
      return
    }
    const outcome = await create.submit(policyDocumentBody(values, fileId, previous?.id ?? null), {
      setError: (name, error) => {
        const field = policyDocumentFormField(name)
        if (field) form.setError(field, error, { shouldFocus: true })
        else if (name === 'fileId') setFileError(error.message)
        else form.setError('root.server', error)
      },
    })
    if (outcome.status !== 'success') return
    notify.success(previous ? 'Yeni sürüm yayımlandı.' : 'Belge yayımlandı.')
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Politika belgesi"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <div className="sm:col-span-2">
        <FormField id="politika-ad" label="Belge adı" error={errors.title}>
          {(control) => <Input {...control} {...form.register('title')} disabled={busy} />}
        </FormField>
      </div>
      <FormField id="politika-tur" label="Belge türü" error={errors.policyType}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('policyType')}
            className="w-full"
            disabled={busy}
          >
            {POLICY_TYPES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {POLICY_TYPE_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="politika-kitle" label="Hedef kitle" error={errors.audience}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('audience')}
            className="w-full"
            disabled={busy}
          >
            {POLICY_AUDIENCES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {POLICY_AUDIENCE_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="politika-yayin" label="Yayın günü" error={errors.publishedOn}>
        {(control) => (
          <Input {...control} type="date" {...form.register('publishedOn')} disabled={busy} />
        )}
      </FormField>
      <div className="sm:col-span-2">
        <FileUploadField
          id="politika-dosya"
          label="Belge dosyası (PDF)"
          purpose="document"
          listLabel="Belge dosyası"
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
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy || scanBlocked} aria-busy={busy || undefined}>
          {previous ? 'Yeni sürümü yayımla' : 'Yayımla'}
        </Button>
      </div>
    </form>
  )
}
