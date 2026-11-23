import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {
  useCreateTransportDocument,
  useSetTransportDocumentSettings,
  useTransportDocumentAlerts,
  useTransportDocumentFileUrlFetcher,
  useTransportDocuments,
  useTransportDocumentSettings,
  type TransportDocumentRow,
  type TransportDocumentSettingsData,
} from '@kampus/react-shared/use-finance-transport-documents.ts'
import { useTransportVehicles } from '@kampus/react-shared/use-finance-transport.ts'
import { useVisitorHosts } from '@kampus/react-shared/use-finance-visitors.ts'
import {
  DRIVING_LICENSE_CLASSES,
  isEndDateRequired,
  isSensitiveTransportDocumentType,
  TRANSPORT_DOCUMENT_SUBJECTS,
  TRANSPORT_DOCUMENT_TYPES,
  transportDocumentTypesFor,
  type TransportDocumentSubject,
} from '@kampus/school-core/lib/finance-transport-documents.ts'
import { TRANSPORT_DIRECTION_LABELS } from '@kampus/school-core/lib/finance-transport.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FileUploadField, type FileUploadItem } from '@/components/FileUploadField.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  alertCount,
  documentTitle,
  documentTypeText,
  fitnessText,
  fitnessTone,
  missingText,
  periodText,
  statusLine,
  statusText,
  subjectKindText,
  subjectText,
  TRANSPORT_DOCUMENT_STATUS_TONE,
  transportDocumentBody,
  transportDocumentDefaults,
  transportDocumentFormField,
  transportDocumentFormSchema,
  warningDaysFormSchema,
  type TransportDocumentFormValues,
  type WarningDaysFormValues,
} from './finance-transport-document-forms.ts'
import { plateText } from './finance-transport-forms.ts'

const NO_SORT: readonly string[] = []
const PICK_QUERY = { page: 1, pageSize: 100 } as const
const DUE_OPTIONS = [
  { value: 'attention', label: 'Uyarı gerektiren' },
  { value: 'expired', label: 'Süresi geçen' },
  { value: 'expiring', label: 'Süresi yaklaşan' },
  { value: 'valid', label: 'Geçerli' },
] as const
const FILTERS = [
  { key: 'due', label: 'Uyarı', type: 'select' as const, options: DUE_OPTIONS },
  {
    key: 'subject',
    label: 'Kime ait',
    type: 'select' as const,
    options: TRANSPORT_DOCUMENT_SUBJECTS.map((value) => ({
      value,
      label: subjectKindText(value),
    })),
  },
  {
    key: 'documentType',
    label: 'Tür',
    type: 'select' as const,
    options: TRANSPORT_DOCUMENT_TYPES.map((value) => ({ value, label: documentTypeText(value) })),
  },
]
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const FILE_POPUP_BLOCKED =
  'Açılır pencere engellendi. Tarayıcıda bu site için açılır pencerelere izin verip yeniden deneyin.'

/** "Belgeler" sekmesinin uyarı rozeti (süresi geçen + yaklaşan; K-498). */
export function useTransportDocumentsBadge(enabled: boolean): number | undefined {
  const alerts = useTransportDocumentAlerts(enabled)
  return alertCount(alerts.data?.data)
}

/** Güzergâh listesinin "Belge" sütunu: aracın uygunluğu (K-498); atama engellenmez. */
export function TransportVehicleFitnessBadge({ vehicleId }: { vehicleId: string }) {
  const alerts = useTransportDocumentAlerts()
  const vehicle = alerts.data?.data.vehicles.find((row) => row.vehicleId === vehicleId)
  if (vehicle === undefined) return <span className="text-muted-foreground">—</span>
  return <StatusBadge text={vehicle.fit ? 'Uygun' : 'Uygun değil'} tone={fitnessTone(vehicle)} />
}

/**
 * Servis belgeleri (DOM-FIN-147; ON-147; K-496…K-498): Servis sekmesinin "Belgeler" görünümü,
 * yönetici ve ön büro. Üstte araç uygunluğu (süresi geçmiş zorunlu belge "uygun değil", eksik belge
 * ayrı uyarı), altta bitişi en yakın önce belge listesi ve "Belge ekle". Adli sicil ve psikoteknik
 * yalnız yöneticide; dosya açılışı denetime düşer. Uyarı penceresini yalnız yönetici değiştirir.
 */
export function FinanceTransportDocumentsSection() {
  const { session } = useAuth()
  const isManager = session?.role === 'yonetici'
  const [creating, setCreating] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  return (
    <div className="grid gap-4 px-6 pt-4 pb-2">
      <FitnessSummary />
      <div className="flex flex-wrap justify-end gap-2">
        {isManager ? (
          <Button variant="secondary" className="min-h-11" onClick={() => setSettingsOpen(true)}>
            Uyarı ayarı
          </Button>
        ) : null}
        <Button className="min-h-11" onClick={() => setCreating(true)}>
          Belge ekle
        </Button>
      </div>
      <DocumentList />
      <Modal open={creating} onOpenChange={setCreating} title="Servis belgesi ekle" size="wide">
        {creating ? <DocumentForm isManager={isManager} onDone={() => setCreating(false)} /> : null}
      </Modal>
      <Modal open={settingsOpen} onOpenChange={setSettingsOpen} title="Belge uyarı ayarı">
        {settingsOpen ? <SettingsCard onDone={() => setSettingsOpen(false)} /> : null}
      </Modal>
    </div>
  )
}

function FitnessSummary() {
  const alerts = useTransportDocumentAlerts()
  if (alerts.error) return <QueryError error={alerts.error} onRetry={() => void alerts.refetch()} />
  const data = alerts.data?.data
  if (!data) return <SummaryLoading />
  return (
    <section aria-labelledby="servis-uygunluk" className="grid gap-2">
      <h3 id="servis-uygunluk" className="font-semibold">
        Araç uygunluğu
      </h3>
      <p className="text-sm text-muted-foreground">
        {`${String(data.expiredCount)} belgenin süresi geçti, ${String(data.expiringCount)} belge ${String(data.warningDays)} gün içinde bitiyor. Uygun olmayan araçta öğrenci ataması engellenmez; belgeyi yenileyin.`}
      </p>
      {data.vehicles.length === 0 ? (
        <p className="text-sm text-muted-foreground">Henüz servis aracı yok.</p>
      ) : (
        <ul aria-label="Araç uygunluğu" className="grid gap-2 text-sm">
          {data.vehicles.map((vehicle) => {
            const missing = missingText(vehicle)
            return (
              <li
                key={vehicle.vehicleId}
                aria-label={`${plateText(vehicle.plate)}: ${fitnessText(vehicle)}`}
                className="grid gap-1 rounded-sm border px-3 py-2"
              >
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {plateText(vehicle.plate)}
                  <StatusBadge text={fitnessText(vehicle)} tone={fitnessTone(vehicle)} />
                </span>
                {missing === null ? null : (
                  <span className="text-muted-foreground">{`Eksik: ${missing}`}</span>
                )}
                {vehicle.routes.length === 0 ? null : (
                  <span className="text-muted-foreground">
                    {`Güzergâhlar: ${vehicle.routes
                      .map(
                        (route) => `${route.name} (${TRANSPORT_DIRECTION_LABELS[route.direction]})`,
                      )
                      .join(', ')}`}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

type DocumentTableRow = {
  id: string
  row: TransportDocumentRow
  title: string
  subject: string
  period: string
}

/** Dosyayı yeni sekmede açar; sekme tıklamayla eşzamanlı açılır, bağlantı gelince adrese gider. */
function useOpenDocumentFile() {
  const fetchUrl = useTransportDocumentFileUrlFetcher()
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

function DocumentList() {
  const list = useListState('servis-belgeler', { urlPrefix: 'belge_' })
  const files = useOpenDocumentFile()
  const due = DUE_OPTIONS.find((option) => option.value === text(list.state.filters.due))?.value
  const subject = TRANSPORT_DOCUMENT_SUBJECTS.find(
    (value) => value === text(list.state.filters.subject),
  )
  const documentType = TRANSPORT_DOCUMENT_TYPES.find(
    (value) => value === text(list.state.filters.documentType),
  )
  const documents = useTransportDocuments({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(due === undefined ? {} : { due }),
    ...(subject === undefined ? {} : { subject }),
    ...(documentType === undefined ? {} : { documentType }),
  })
  const rows = useMemo(
    () =>
      documents.data?.data.map((row): DocumentTableRow => ({
        id: row.id,
        row,
        title: documentTitle(row),
        subject: subjectText(row),
        period: periodText(row),
      })),
    [documents.data],
  )
  const columns = useMemo<DataColumn<DocumentTableRow>[]>(
    () => [
      { key: 'title', label: 'Belge' },
      { key: 'subject', label: 'Kime ait' },
      { key: 'period', label: 'Geçerlilik' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <span className="grid gap-1">
            <StatusBadge
              text={statusText(row.row.status)}
              tone={TRANSPORT_DOCUMENT_STATUS_TONE[row.row.status]}
            />
            <span className="text-2xs text-muted-foreground">{statusLine(row.row)}</span>
          </span>
        ),
      },
      {
        key: ACTIONS_KEY,
        label: 'Dosya',
        cell: (row) =>
          row.row.restricted ? (
            <span className="text-muted-foreground">Yalnız yönetici</span>
          ) : row.row.hasFile === true ? (
            <Button
              className="min-h-11"
              variant="secondary"
              aria-label={`${row.title} dosyasını aç`}
              disabled={files.opening !== ''}
              aria-busy={files.opening === row.id || undefined}
              onClick={() => void files.open(row.id)}
            >
              Dosyayı aç
            </Button>
          ) : (
            <span className="text-muted-foreground">Dosya yok</span>
          ),
      },
    ],
    [files],
  )
  return (
    <ServerDataTable
      list={list}
      rows={rows}
      total={documents.data?.meta.total ?? 0}
      sortable={NO_SORT}
      columns={columns}
      filters={FILTERS}
      mobileColumns={['title', 'status']}
      caption="Servis belgeleri"
      empty="Henüz servis belgesi yok. Araç muayenesi, sigortalar ve sürücü belgelerini ekleyin."
      emptyFiltered="Bu süzgeçle eşleşen belge yok."
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

/** Yeni belge (K-496, K-497): özne, tür, numara (araçta), sınıf (ehliyette), tarihler ve dosya. */
function DocumentForm({ isManager, onDone }: { isManager: boolean; onDone: () => void }) {
  const create = useCreateTransportDocument()
  const vehicles = useTransportVehicles(PICK_QUERY)
  const staff = useVisitorHosts(PICK_QUERY)
  const form = useForm<TransportDocumentFormValues>({
    resolver: zodResolver(transportDocumentFormSchema),
    defaultValues: transportDocumentDefaults(dayKey()),
  })
  const [files, setFiles] = useState<readonly FileUploadItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [scanBlocked, setScanBlocked] = useState(false)
  const [image, setImage] = useState(false)
  const errors = form.formState.errors
  const saving = create.isPending || form.formState.isSubmitting
  const busy = saving || uploading
  const subject = useWatch({ control: form.control, name: 'subject' })
  const documentType = useWatch({ control: form.control, name: 'documentType' })
  const types = transportDocumentTypesFor(subject).filter(
    (type) => isManager || !isSensitiveTransportDocumentType(type),
  )
  const onSubjectChange = (next: TransportDocumentSubject) => {
    form.setValue('subject', next)
    form.setValue('documentType', transportDocumentTypesFor(next)[0])
  }
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(transportDocumentBody(values, files[0]?.id ?? null), {
      setError: (name, error) => {
        const field = transportDocumentFormField(name)
        if (field) form.setError(field, error, { shouldFocus: true })
        else form.setError('root.server', error)
      },
    })
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
      aria-label="Servis belgesi"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="servis-belge-ozne" label="Kime ait" error={errors.subject}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('subject', {
              onChange: (event: { target: { value: string } }) => {
                const next = TRANSPORT_DOCUMENT_SUBJECTS.find(
                  (value) => value === event.target.value,
                )
                if (next) onSubjectChange(next)
              },
            })}
            className="w-full"
            disabled={busy}
          >
            {TRANSPORT_DOCUMENT_SUBJECTS.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {subjectKindText(value)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {subject === 'staff' ? (
        <FormField id="servis-belge-personel" label="Personel" error={errors.membershipId}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('membershipId')}
              className="w-full"
              disabled={busy || staff.isPending}
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
          id="servis-belge-arac"
          label="Araç"
          error={errors.vehicleId}
          description={
            subject === 'driver' ? 'Belge aracın şu anki sürücüsüne kaydedilir.' : undefined
          }
        >
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('vehicleId')}
              className="w-full"
              disabled={busy || vehicles.isPending}
            >
              <NativeSelectOption value="">Seçin</NativeSelectOption>
              {(vehicles.data?.data ?? []).map((vehicle) => (
                <NativeSelectOption key={vehicle.id} value={vehicle.id}>
                  {subject === 'driver'
                    ? `${plateText(vehicle.plate)} · ${vehicle.driverName}`
                    : plateText(vehicle.plate)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      )}
      <FormField id="servis-belge-tur" label="Belge türü" error={errors.documentType}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('documentType')}
            className="w-full"
            disabled={busy}
          >
            {types.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {documentTypeText(value)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {subject === 'vehicle' ? (
        <FormField
          id="servis-belge-no"
          label="Belge ya da poliçe no (isteğe bağlı)"
          error={errors.documentNumber}
        >
          {(control) => <Input {...control} {...form.register('documentNumber')} disabled={busy} />}
        </FormField>
      ) : documentType === 'driving_license' ? (
        <FormField id="servis-belge-sinif" label="Ehliyet sınıfı" error={errors.licenseClass}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('licenseClass')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="">Seçin</NativeSelectOption>
              {DRIVING_LICENSE_CLASSES.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {value}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      ) : (
        <p className="text-sm text-muted-foreground sm:self-end">
          Kişi belgesinin içeriği ve numarası tutulmaz; yalnız tür, tarih ve dosya.
        </p>
      )}
      <FormField id="servis-belge-baslangic" label="Belge tarihi" error={errors.startDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('startDate')} disabled={busy} />
        )}
      </FormField>
      <FormField
        id="servis-belge-bitis"
        label={
          isEndDateRequired(documentType) ? 'Geçerlilik bitişi' : 'Geçerlilik bitişi (isteğe bağlı)'
        }
        error={errors.endDate}
        description={isEndDateRequired(documentType) ? undefined : 'Boş bırakırsanız süresiz olur.'}
      >
        {(control) => (
          <Input {...control} type="date" {...form.register('endDate')} disabled={busy} />
        )}
      </FormField>
      <div className="grid gap-2 sm:col-span-2">
        {isManager ? (
          <FormField id="servis-belge-dosya-turu" label="Dosya biçimi">
            {(control) => (
              <NativeSelect
                {...control}
                value={image ? 'image' : 'pdf'}
                className="w-full"
                disabled={busy || files.length > 0}
                onChange={(event) => setImage(event.target.value === 'image')}
              >
                <NativeSelectOption value="pdf">PDF</NativeSelectOption>
                <NativeSelectOption value="image">Görsel (JPG, PNG, WebP)</NativeSelectOption>
              </NativeSelect>
            )}
          </FormField>
        ) : null}
        <FileUploadField
          key={image ? 'image' : 'pdf'}
          id="servis-belge-dosya"
          label="Belge dosyası (isteğe bağlı)"
          purpose={image ? 'question_image' : 'document'}
          description={
            image ? 'Belgenin fotoğrafı, en çok 2 MB.' : 'Belgenin taraması (PDF), en çok 10 MB.'
          }
          listLabel="Belge dosyası"
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
        <Button
          type="submit"
          className="min-h-11"
          disabled={busy || scanBlocked}
          aria-busy={busy || undefined}
        >
          Belgeyi kaydet
        </Button>
      </div>
    </form>
  )
}

function SettingsCard({ onDone }: { onDone: () => void }) {
  const settings = useTransportDocumentSettings()
  if (settings.error)
    return <QueryError error={settings.error} onRetry={() => void settings.refetch()} />
  const current = settings.data?.data
  if (!current) return <SummaryLoading />
  return <SettingsForm key={current.version} current={current} onDone={onDone} />
}

/** Uyarı penceresi (K-498): bitişine kaç gün kala "süresi yaklaşıyor" denir. */
function SettingsForm({
  current,
  onDone,
}: {
  current: TransportDocumentSettingsData
  onDone: () => void
}) {
  const save = useSetTransportDocumentSettings()
  const form = useForm<WarningDaysFormValues>({
    resolver: zodResolver(warningDaysFormSchema),
    defaultValues: { warningDays: String(current.warningDays) },
  })
  const errors = form.formState.errors
  const busy = save.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const warningDays = Number(values.warningDays.trim())
    if (warningDays === current.warningDays) {
      onDone()
      return
    }
    const outcome = await save.submit(
      { version: current.version, body: { warningDays } },
      {
        setError: (name, error) => {
          if (name === 'warningDays') form.setError(name, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status !== 'success') return
    notify.success('Uyarı ayarı kaydedildi.')
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="Belge uyarı ayarı"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField
        id="servis-belge-uyari"
        label="Uyarı süresi (gün)"
        error={errors.warningDays}
        description="Bitişine bu kadar gün kalan belge “süresi yaklaşıyor” listesine girer."
      >
        {(control) => (
          <Input
            {...control}
            inputMode="numeric"
            {...form.register('warningDays')}
            disabled={busy}
          />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy || undefined}>
        Ayarı kaydet
      </Button>
    </form>
  )
}
