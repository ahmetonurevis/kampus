import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useSearchParams } from 'react-router'
import {
  useCreateStaffDocument,
  useStaffDocumentAlerts,
  useStaffDocumentDetail,
  useStaffDocumentFileUrlFetcher,
  useStaffDocuments,
  useStaffDocumentStaff,
  useStaffDocumentTypes,
  useUpdateStaffDocumentTypes,
  type StaffDocument,
  type StaffDocumentTypeSettingRow,
} from '@kampus/react-shared/use-finance-staff-documents.ts'
import {
  HEALTH_REPORT_KIND_LABELS,
  HEALTH_REPORT_KINDS,
  isMultiDocumentType,
  STAFF_DOCUMENT_TYPE_LABELS,
  STAFF_DOCUMENT_TYPES,
  type StaffDocumentType,
} from '@kampus/school-core/lib/finance-staff-documents.ts'
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
  alertBadges,
  documentDateText,
  documentTitle,
  missingText,
  replaceOptions,
  sortDocuments,
  STAFF_DOCUMENT_TRACKING_DUE_PARAM as TRACKING_DUE_PARAM,
  STAFF_DOCUMENT_STATUS_TONE,
  staffDocumentBody,
  staffDocumentDefaults,
  staffDocumentFormField,
  staffDocumentFormSchema,
  statusLabel,
  typeSettingsBody,
  typeSettingsDefaults,
  validityText,
  type StaffDocumentFormValues,
  type TypeSettingFormRow,
} from './finance-staff-document-forms.ts'

const NO_SORT: readonly string[] = []
const TAB_PARAM = 'ozluk_sekme'
const TRACKING = 'takip'
const TRACKING_URL_FILTERS = { due: 'durum' } as const
const STAFF_URL_FILTERS = { missing: 'eksik' } as const
const DUE_OPTIONS = [
  { value: 'attention', label: 'Süresi geçen ve 30 gün içinde biten' },
  { value: 'expired', label: 'Süresi geçen' },
  { value: 'expiring', label: '30 gün içinde biten' },
  { value: 'valid', label: 'Geçerli ya da süresiz' },
]
const TYPE_OPTIONS = STAFF_DOCUMENT_TYPES.map((value) => ({
  value,
  label: STAFF_DOCUMENT_TYPE_LABELS[value],
}))
const TRACKING_FILTERS = [
  { key: 'due', label: 'Geçerlilik', type: 'select' as const, options: DUE_OPTIONS },
  { key: 'documentType', label: 'Belge türü', type: 'select' as const, options: TYPE_OPTIONS },
]
const STAFF_FILTERS = [
  {
    key: 'status',
    label: 'Personel durumu',
    type: 'select' as const,
    options: [
      { value: 'active', label: 'Etkin' },
      { value: 'passive', label: 'Pasif (ayrılan)' },
    ],
  },
  {
    key: 'missing',
    label: 'Zorunlu belge',
    type: 'select' as const,
    options: [{ value: 'true', label: 'Eksik belgesi olanlar' }],
  },
]
const TABS = [
  { value: 'personel', label: 'Personel' },
  { value: TRACKING, label: 'Geçerlilik takibi' },
] as const
type Tab = (typeof TABS)[number]['value']
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const isDue = (value: string | null): value is 'expired' | 'expiring' | 'attention' | 'valid' =>
  DUE_OPTIONS.some((option) => option.value === value)
const isType = (value: string | null): value is StaffDocumentType =>
  STAFF_DOCUMENT_TYPES.some((type) => type === value)

/**
 * Özlük belgeleri (DOM-FIN-113; ON-173): Finans "Özlük belgeleri" sekmesi, yönetici ve ön büro.
 * Üstte uyarı rozetleri (süresi geçen, yaklaşan, zorunlu belgesi eksik personel); "Personel"
 * görünümü eksik zorunlu türleri, "Geçerlilik takibi" bitişi yakın belgeleri listeler. Personel
 * panelinde belge geçmişi ve yeni belge; özel nitelikli belgenin (adli sicil, sağlık raporu)
 * dosyasını yalnız yönetici açar ve her açılış denetime düşer (K-374). Tür ayarı yalnız yönetici.
 */
export function FinanceStaffDocumentsSection({ isManager }: { isManager: boolean }) {
  const [params, setParams] = useSearchParams()
  const tab: Tab =
    params.get(TAB_PARAM) === TRACKING || params.has(TRACKING_DUE_PARAM) ? TRACKING : 'personel'
  const alerts = useStaffDocumentAlerts()
  const panel = useDetailPanel('ozluk_personel')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const setTab = (next: Tab) =>
    setParams(
      (current) => {
        const copy = new URLSearchParams(current)
        if (next === TRACKING) copy.set(TAB_PARAM, TRACKING)
        else {
          copy.delete(TAB_PARAM)
          copy.delete(TRACKING_DUE_PARAM)
        }
        return copy
      },
      { replace: true },
    )
  const badges = alertBadges(alerts.data?.data)
  return (
    <section
      aria-labelledby="ozluk-belgeleri"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h2 id="ozluk-belgeleri" className="text-lg font-semibold">
            Özlük belgeleri
          </h2>
          <p className="text-sm text-muted-foreground">
            Adli sicil ve sağlık raporu özel nitelikli kişisel veridir: listede yalnız tür ve tarih
            görünür, dosyayı yalnız yönetici açar ve her açılış denetim kaydına yazılır.
          </p>
          {badges.length > 0 ? (
            <ul aria-label="Belge uyarıları" className="flex flex-wrap gap-2 pt-1">
              {badges.map((badge) => (
                <li key={badge.key}>
                  <StatusBadge text={badge.text} tone={badge.tone} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {isManager ? (
          <Button variant="secondary" onClick={() => setSettingsOpen(true)}>
            Belge türleri
          </Button>
        ) : null}
      </header>
      <div className="px-6">
        <LineTabs label="Özlük görünümü" value={tab} options={TABS} onChange={setTab} />
      </div>
      {tab === TRACKING ? <TrackingList onOpen={panel.open} /> : <StaffList onOpen={panel.open} />}
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Personel özlük belgeleri"
      >
        {panel.selectedId ? (
          <StaffDocuments membershipId={panel.selectedId} isManager={isManager} />
        ) : null}
      </SidePanel>
      <Modal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title="Belge türleri"
        description="Zorunlu türler her etkin personelde aranır; geçerlilik süresi yeni belgenin bitişini belirler. Adli sicil ve sağlık raporu özel nitelikli kalır."
      >
        {settingsOpen ? <TypeSettingsForm onDone={() => setSettingsOpen(false)} /> : null}
      </Modal>
    </section>
  )
}

type StaffRow = {
  id: string
  name: string
  role: string
  active: boolean
  documents: string
  missing: string
  expired: number
  expiring: number
}

function StaffList({ onOpen }: { onOpen: (id: string) => void }) {
  const list = useListState('ozluk-personel', {
    urlPrefix: 'ozluk_',
    urlFilters: STAFF_URL_FILTERS,
  })
  const search = useDebouncedValue(list.state.query).trim()
  const status = text(list.state.filters.status)
  const missing = text(list.state.filters.missing)
  const staff = useStaffDocumentStaff({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(status === 'active' || status === 'passive' ? { status } : {}),
    ...(missing === 'true' ? { missing: 'true' as const } : {}),
  })
  const rows = useMemo(
    () =>
      staff.data?.data.map((item): StaffRow => ({
        id: item.membershipId,
        name: item.name,
        role: roleLabel(item.role),
        active: item.active,
        documents: `${String(item.documentCount)} belge`,
        missing: item.active ? (missingText(item.missingTypes) ?? 'Eksik yok') : '—',
        expired: item.expiredCount,
        expiring: item.expiringCount,
      })),
    [staff.data],
  )
  const columns = useMemo<DataColumn<StaffRow>[]>(
    () => [
      { key: 'name', label: 'Ad' },
      { key: 'role', label: 'Rol' },
      {
        key: 'active',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge text={row.active ? 'Etkin' : 'Pasif'} tone={row.active ? 'green' : 'gray'} />
        ),
      },
      { key: 'documents', label: 'Belgeler' },
      { key: 'missing', label: 'Eksik zorunlu belgeler' },
      {
        key: 'expired',
        label: 'Uyarı',
        cell: (row) =>
          row.expired === 0 && row.expiring === 0 ? (
            '—'
          ) : (
            <span className="flex flex-wrap gap-1">
              {row.expired > 0 ? (
                <StatusBadge text={`${String(row.expired)} süresi geçti`} tone="red" />
              ) : null}
              {row.expiring > 0 ? (
                <StatusBadge text={`${String(row.expiring)} yaklaşıyor`} tone="amber" />
              ) : null}
            </span>
          ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.name} özlük belgelerini aç`}
            onClick={() => onOpen(row.id)}
          >
            Belgeler
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
      total={staff.data?.meta.total ?? 0}
      sortable={NO_SORT}
      columns={columns}
      filters={STAFF_FILTERS}
      mobileColumns={['name', 'missing']}
      caption="Personel özlük belgeleri"
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
  )
}

type TrackingRow = {
  id: string
  membershipId: string
  name: string
  title: string
  date: string
  validity: string
  status: StaffDocument['status']
}

function TrackingList({ onOpen }: { onOpen: (id: string) => void }) {
  const list = useListState('ozluk-takip', {
    urlPrefix: 'ozluk_takip_',
    urlFilters: TRACKING_URL_FILTERS,
  })
  const search = useDebouncedValue(list.state.query).trim()
  const due = text(list.state.filters.due)
  const documentType = text(list.state.filters.documentType)
  const documents = useStaffDocuments({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isDue(due) ? { due } : {}),
    ...(isType(documentType) ? { documentType } : {}),
  })
  const rows = useMemo(
    () =>
      documents.data?.data.map((item): TrackingRow => ({
        id: item.id,
        membershipId: item.membershipId,
        name: item.staff.name,
        title: documentTitle(item),
        date: documentDateText(item),
        validity: validityText(item),
        status: item.status,
      })),
    [documents.data],
  )
  const columns = useMemo<DataColumn<TrackingRow>[]>(
    () => [
      { key: 'name', label: 'Personel' },
      { key: 'title', label: 'Belge' },
      { key: 'date', label: 'Belge tarihi' },
      { key: 'validity', label: 'Geçerlilik' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge
            text={statusLabel(row.status)}
            tone={STAFF_DOCUMENT_STATUS_TONE[row.status]}
          />
        ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.name} özlük belgelerini aç`}
            onClick={() => onOpen(row.membershipId)}
          >
            Personel
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
      total={documents.data?.meta.total ?? 0}
      sortable={NO_SORT}
      columns={columns}
      filters={TRACKING_FILTERS}
      mobileColumns={['name', 'title', 'status']}
      caption="Belge geçerlilik takibi"
      empty="Etkin personelde kayıtlı belge yok."
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

const FILE_POPUP_BLOCKED =
  'Açılır pencere engellendi. Tarayıcıda bu site için açılır pencerelere izin verip yeniden deneyin.'

/** Dosyayı yeni sekmede açar; sekme tıklamayla eşzamanlı açılır, bağlantı gelince adrese gider. */
function useOpenDocumentFile() {
  const fetchUrl = useStaffDocumentFileUrlFetcher()
  const [opening, setOpening] = useState('')
  async function open(documentId: string) {
    const tab = window.open('about:blank', '_blank')
    if (!tab) {
      // Bağlantı üretmek denetim kaydıdır; pencere açılamıyorsa üretilmez.
      notify.error(FILE_POPUP_BLOCKED)
      return
    }
    setOpening(documentId)
    try {
      const { url } = await fetchUrl(documentId)
      tab.opener = null
      tab.location.href = url
    } catch (error) {
      tab.close()
      notify.error('Dosya açılamadı. Biraz sonra yeniden deneyin.', error)
    } finally {
      setOpening('')
    }
  }
  return { open, opening }
}

function StaffDocuments({ membershipId, isManager }: { membershipId: string; isManager: boolean }) {
  const detail = useStaffDocumentDetail(membershipId)
  const files = useOpenDocumentFile()
  const [creating, setCreating] = useState(false)
  if (detail.error) return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
  const data = detail.data?.data
  if (!data) return <SummaryLoading />
  const missing = missingText(data.missingTypes)
  const documents = sortDocuments(data.documents)
  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <h3 className="text-base font-semibold">{data.name}</h3>
        <p className="text-sm text-muted-foreground">
          {roleLabel(data.role)}
          {data.active ? '' : ' · pasif (ayrılan)'}
        </p>
      </div>
      {missing === null ? null : (
        <p className="text-sm">
          <span className="font-medium">Eksik zorunlu belgeler:</span> {missing}
        </p>
      )}
      <div>
        <Button onClick={() => setCreating(true)} disabled={!data.active}>
          Yeni belge
        </Button>
        {data.active ? null : (
          <p className="mt-1 text-sm text-muted-foreground">Pasif personele belge kaydedilmez.</p>
        )}
      </div>
      <section aria-labelledby="ozluk-belge-listesi" className="grid gap-2">
        <h4 id="ozluk-belge-listesi" className="text-sm font-semibold">
          Belgeler
        </h4>
        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">Henüz belge kaydı yok.</p>
        ) : (
          <ul aria-label="Özlük belgeleri" className="grid gap-2 text-sm">
            {documents.map((doc) => (
              <li
                key={doc.id}
                aria-label={`${documentTitle(doc)}, ${documentDateText(doc)}`}
                className="grid gap-1 rounded-sm border px-3 py-2"
              >
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {documentTitle(doc)}
                  <StatusBadge
                    text={statusLabel(doc.status)}
                    tone={STAFF_DOCUMENT_STATUS_TONE[doc.status]}
                  />
                  {doc.sensitive ? <StatusBadge text="Özel nitelikli" tone="purple" /> : null}
                </span>
                <span className="text-muted-foreground">
                  {documentDateText(doc)} · {validityText(doc)}
                  {doc.validUntilSource === 'manual' ? ' (elle)' : ''}
                </span>
                {doc.note ? (
                  <span className="text-muted-foreground [overflow-wrap:anywhere]">{doc.note}</span>
                ) : null}
                {doc.restricted ? (
                  <span className="text-muted-foreground">Dosyayı yalnız yönetici açar.</span>
                ) : doc.file ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 truncate">{doc.file.name}</span>
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`${documentTitle(doc)} dosyasını aç`}
                      disabled={files.opening !== ''}
                      aria-busy={files.opening === doc.id || undefined}
                      onClick={() => void files.open(doc.id)}
                    >
                      Dosyayı aç
                    </Button>
                  </span>
                ) : (
                  <span className="text-muted-foreground">Dosya eklenmemiş.</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <Modal
        open={creating}
        onOpenChange={setCreating}
        title="Yeni özlük belgesi"
        description={`${data.name} için belge. Sağlık raporu, adli sicil ve kimlikte yeni belge geçerli belgenin yerine geçer.`}
      >
        {creating ? (
          <CreateForm
            membershipId={membershipId}
            documents={data.documents}
            isManager={isManager}
            onDone={() => setCreating(false)}
          />
        ) : null}
      </Modal>
    </div>
  )
}

/** Yeni belge (K-373): tür, sağlık raporunda tür, tarih, isteğe bağlı bitiş, dosya ve not. */
function CreateForm({
  membershipId,
  documents,
  isManager,
  onDone,
}: {
  membershipId: string
  documents: readonly StaffDocument[]
  isManager: boolean
  onDone: () => void
}) {
  const create = useCreateStaffDocument()
  const types = useStaffDocumentTypes()
  const form = useForm<StaffDocumentFormValues>({
    resolver: zodResolver(staffDocumentFormSchema),
    defaultValues: staffDocumentDefaults(dayKey()),
  })
  const [files, setFiles] = useState<readonly FileUploadItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [scanBlocked, setScanBlocked] = useState(false)
  const errors = form.formState.errors
  const saving = create.isPending || form.formState.isSubmitting
  const busy = saving || uploading
  const documentType = useWatch({ control: form.control, name: 'documentType' })
  const settings = types.data?.data
  const sensitiveTypes = new Set(
    (settings ?? []).filter((row) => row.sensitive).map((row) => row.documentType),
  )
  const available = STAFF_DOCUMENT_TYPES.filter((type) => isManager || !sensitiveTypes.has(type))
  const sensitive = sensitiveTypes.has(documentType)
  const validity = settings?.find((row) => row.documentType === documentType)?.validityMonths
  const replaceable = replaceOptions(documents, documentType)
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(
      // Özel nitelikli türde not alanı gizlidir; önceki türde yazılmış not gönderilmez.
      staffDocumentBody(
        membershipId,
        sensitive ? { ...values, note: '' } : values,
        files[0]?.id ?? null,
      ),
      {
        setError: (name, error) => {
          const field = staffDocumentFormField(name)
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status !== 'success') return
    notify.success(
      outcome.data.data.superseded === null
        ? 'Belge kaydedildi.'
        : 'Belge kaydedildi; önceki belgenin yerine geçti.',
    )
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Özlük belgesi"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="ozluk-tur" label="Belge türü" error={errors.documentType}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('documentType')}
            className="w-full"
            disabled={busy}
          >
            {available.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {STAFF_DOCUMENT_TYPE_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {documentType === 'health_report' ? (
        <FormField id="ozluk-rapor-turu" label="Rapor türü" error={errors.healthReportKind}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('healthReportKind')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="">Seçin</NativeSelectOption>
              {HEALTH_REPORT_KINDS.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {HEALTH_REPORT_KIND_LABELS[value]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      ) : null}
      <FormField id="ozluk-tarih" label="Belge tarihi" error={errors.documentDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('documentDate')} disabled={busy} />
        )}
      </FormField>
      <FormField
        id="ozluk-bitis"
        label="Geçerlilik bitişi (isteğe bağlı)"
        error={errors.validUntil}
        description={
          validity === undefined
            ? undefined
            : validity === null
              ? 'Boş bırakırsanız belge süresiz olur.'
              : `Boş bırakırsanız belge tarihinden ${String(validity)} ay sonra biter.`
        }
      >
        {(control) => (
          <Input {...control} type="date" {...form.register('validUntil')} disabled={busy} />
        )}
      </FormField>
      {isMultiDocumentType(documentType) && replaceable.length > 0 ? (
        <FormField
          id="ozluk-yerine"
          label="Yerine geçtiği belge (isteğe bağlı)"
          error={errors.replacesDocumentId}
        >
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('replacesDocumentId')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="">Yok, ayrı belge</NativeSelectOption>
              {replaceable.map((doc) => (
                <NativeSelectOption key={doc.id} value={doc.id}>
                  {`${documentTitle(doc)} · ${documentDateText(doc)}`}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      ) : null}
      <div className="sm:col-span-2">
        <FileUploadField
          id="ozluk-dosya"
          label="Belge dosyası (isteğe bağlı)"
          purpose="document"
          description="Belgenin taraması (PDF ya da görsel)."
          listLabel="Belge dosyası"
          items={files}
          disabled={saving}
          onUploaded={(item) => setFiles([item])}
          onRemoved={() => setFiles([])}
          onBusyChange={setUploading}
          onBlockedChange={setScanBlocked}
        />
      </div>
      {sensitive ? (
        <p className="text-sm text-muted-foreground sm:col-span-2">
          Özel nitelikli belgeye not yazılmaz; içerik yalnız dosyada tutulur.
        </p>
      ) : (
        <div className="sm:col-span-2">
          <FormField id="ozluk-not" label="Not (isteğe bağlı)" error={errors.note}>
            {(control) => (
              <Textarea {...control} {...form.register('note')} rows={2} disabled={busy} />
            )}
          </FormField>
        </div>
      )}
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy || scanBlocked} aria-busy={busy || undefined}>
          Kaydet
        </Button>
      </div>
    </form>
  )
}

/** Tür ayarları (K-372): zorunlu, geçerlilik süresi (ay), özel nitelikli; yalnız yönetici. */
function TypeSettingsForm({ onDone }: { onDone: () => void }) {
  const types = useStaffDocumentTypes()
  if (types.error) return <QueryError error={types.error} onRetry={() => void types.refetch()} />
  const rows = types.data?.data
  if (!rows) return <SummaryLoading />
  return <TypeSettingsFields original={rows} onDone={onDone} />
}

function TypeSettingsFields({
  original,
  onDone,
}: {
  original: readonly StaffDocumentTypeSettingRow[]
  onDone: () => void
}) {
  const update = useUpdateStaffDocumentTypes()
  const [rows, setRows] = useState<TypeSettingFormRow[]>(() => typeSettingsDefaults(original))
  const [errors, setErrors] = useState<Partial<Record<StaffDocumentType, string>>>({})
  const [rootError, setRootError] = useState<string | undefined>(undefined)
  const busy = update.isPending
  const patch = (type: StaffDocumentType, change: Partial<TypeSettingFormRow>) =>
    setRows((current) =>
      current.map((row) => (row.documentType === type ? { ...row, ...change } : row)),
    )
  const submit = async () => {
    setRootError(undefined)
    const result = typeSettingsBody(rows, original)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    if (result.body === null) {
      onDone()
      return
    }
    const outcome = await update.submit(result.body, {
      setError: (_name, issue) => setRootError(issue.message),
    })
    if (outcome.status !== 'success') return
    notify.success('Belge türü ayarları kaydedildi.')
    onDone()
  }
  return (
    <form
      noValidate
      aria-label="Belge türü ayarları"
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      {rows.map((row) => {
        const locked = original.find(
          (item) => item.documentType === row.documentType,
        )?.sensitiveLocked
        const id = `ozluk-ayar-${row.documentType}`
        return (
          <fieldset key={row.documentType} className="grid gap-2 rounded-sm border px-3 py-2">
            <legend className="px-1 text-sm font-semibold">
              {STAFF_DOCUMENT_TYPE_LABELS[row.documentType]}
            </legend>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <div className="flex min-h-11 items-center gap-2">
                <Checkbox
                  id={`${id}-zorunlu`}
                  checked={row.required}
                  disabled={busy}
                  onCheckedChange={(checked) =>
                    patch(row.documentType, { required: checked === true })
                  }
                />
                <Label htmlFor={`${id}-zorunlu`}>Zorunlu</Label>
              </div>
              <div className="flex min-h-11 items-center gap-2">
                <Checkbox
                  id={`${id}-ozel`}
                  checked={row.sensitive}
                  disabled={busy || locked === true}
                  onCheckedChange={(checked) =>
                    patch(row.documentType, { sensitive: checked === true })
                  }
                />
                <Label htmlFor={`${id}-ozel`}>
                  Özel nitelikli{locked === true ? ' (kanunen)' : ''}
                </Label>
              </div>
            </div>
            <FormField
              id={`${id}-sure`}
              label="Geçerlilik süresi (ay)"
              description="Boş bırakırsanız süresiz."
              error={
                errors[row.documentType] === undefined
                  ? undefined
                  : { message: errors[row.documentType] }
              }
            >
              {(control) => (
                <Input
                  {...control}
                  inputMode="numeric"
                  autoComplete="off"
                  value={row.validityMonths}
                  onChange={(event) =>
                    patch(row.documentType, { validityMonths: event.target.value })
                  }
                  disabled={busy}
                />
              )}
            </FormField>
          </fieldset>
        )
      })}
      <RootError message={rootError} />
      <div>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Kaydet
        </Button>
      </div>
    </form>
  )
}
