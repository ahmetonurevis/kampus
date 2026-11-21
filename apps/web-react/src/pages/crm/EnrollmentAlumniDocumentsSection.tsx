import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {
  useAlumniFees,
  useAlumniRequest,
  useAlumniRequests,
  useAlumniStudents,
  useCreateAlumniRequest,
  useTransitionAlumniRequest,
  useUpdateAlumniFees,
  type AlumniRequestRow,
} from '@kampus/react-shared/use-enrollment-alumni-documents.ts'
import {
  ALUMNI_DELIVERY_LABELS,
  ALUMNI_DELIVERY_METHODS,
  ALUMNI_DOCUMENT_FEE_ROLES,
  ALUMNI_DOCUMENT_ROLES,
  ALUMNI_DOCUMENT_TYPE_LABELS,
  ALUMNI_DOCUMENT_TYPES,
  ALUMNI_FEE_PAYMENT_LABELS,
  ALUMNI_FEE_PAYMENT_METHODS,
  ALUMNI_REQUEST_CHANNEL_LABELS,
  ALUMNI_REQUEST_CHANNELS,
  ALUMNI_REQUEST_STATUS_LABELS,
  ALUMNI_REQUEST_STATUSES,
  ALUMNI_REQUESTER_LABELS,
  ALUMNI_REQUESTER_KINDS,
  type AlumniDocumentType,
  type AlumniFeePaymentMethod,
  type AlumniRequestStatus,
} from '@kampus/school-core/lib/enrollment-alumni-documents.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FileUploadField, type FileUploadItem } from '@/components/FileUploadField.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useAlumniDocumentPdf } from '@/hooks/use-enrollment-alumni-document-pdf.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { FinancePdfDialog } from '../finance/FinancePdfDialog.tsx'
import { useOpenFile } from '../learning/SubmissionFiles.tsx'
import { RootError } from '../management/FormParts.tsx'
import {
  ALUMNI_REQUEST_DEFAULTS,
  ALUMNI_STATUS_TONES,
  alumniFeesBody,
  alumniFeesDefaults,
  alumniFeesFormSchema,
  alumniFormField,
  alumniListRow,
  alumniRequestFormSchema,
  authorizationNeed,
  createAlumniRequestBody,
  documentTypeOptions,
  eligibleGuardians,
  studentOptionLabel,
  type AlumniFeesFormValues,
  type AlumniListRow,
  type AlumniRequestFormValues,
} from './enrollment-alumni-document-forms.ts'

const YEAR = { year: 'numeric' } as const

const NO_SORT: readonly string[] = []
const MOBILE = ['student', 'status']
const FILTERS = [
  {
    key: 'status',
    label: 'Durum',
    type: 'select' as const,
    options: ALUMNI_REQUEST_STATUSES.map((value) => ({
      value,
      label: ALUMNI_REQUEST_STATUS_LABELS[value],
    })),
  },
  {
    key: 'documentType',
    label: 'Belge türü',
    type: 'select' as const,
    options: ALUMNI_DOCUMENT_TYPES.map((value) => ({
      value,
      label: ALUMNI_DOCUMENT_TYPE_LABELS[value],
    })),
  },
]
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const isStatus = (value: string | null): value is AlumniRequestStatus =>
  ALUMNI_REQUEST_STATUSES.some((status) => status === value)
const isType = (value: string | null): value is AlumniDocumentType =>
  ALUMNI_DOCUMENT_TYPES.some((type) => type === value)
const hasRole = (roles: readonly string[], role: string | undefined) =>
  roles.some((allowed) => allowed === role)

/**
 * Mezun belge talepleri (DOM-KAY-044; ON-260): mezun hesabı olmadığı için ön büro telefon, e-posta,
 * dilekçe ya da şahsen gelen talebi kaydeder, hazırlar ve kimliği kontrol ederek teslim eder.
 * Öğrenim belgesi ve not dökümü kayıtlardan PDF olarak üretilir; diploma örneği taranmış dosyadır.
 * Ücret ayarını yalnız yönetici değiştirir (K-329).
 */
export function EnrollmentAlumniDocumentsSection() {
  const { session } = useAuth()
  if (!hasRole(ALUMNI_DOCUMENT_ROLES, session?.role)) return null
  return (
    <AlumniRequests
      canEditFees={hasRole(ALUMNI_DOCUMENT_FEE_ROLES, session?.role)}
      institutionType={session?.institution.type}
    />
  )
}

function AlumniRequests({
  canEditFees,
  institutionType,
}: {
  canEditFees: boolean
  institutionType: string | undefined
}) {
  const list = useListState('mezun-belgeleri', { urlPrefix: 'mezun_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = text(list.state.filters.status)
  const documentType = text(list.state.filters.documentType)
  const requests = useAlumniRequests({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isStatus(status) ? { status } : {}),
    ...(isType(documentType) ? { documentType } : {}),
  })
  const [creating, setCreating] = useState(false)
  const [editingFees, setEditingFees] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const rows = useMemo(() => requests.data?.data.map(alumniListRow), [requests.data])
  const columns = useMemo<DataColumn<AlumniListRow>[]>(
    () => [
      { key: 'student', label: 'Öğrenci' },
      { key: 'document', label: 'Belge' },
      { key: 'requester', label: 'Talep eden' },
      { key: 'delivery', label: 'Teslim' },
      { key: 'fee', label: 'Ücret' },
      { key: 'number', label: 'Belge no' },
      { key: 'received', label: 'Alındı' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge text={row.statusLabel} tone={ALUMNI_STATUS_TONES[row.status]} />
        ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.student} talebini aç`}
            onClick={() => setOpenId(row.id)}
          >
            Aç
          </Button>
        ),
      },
    ],
    [],
  )
  return (
    <section
      aria-labelledby="mezun-belge-talepleri"
      className="panel mt-6 overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div>
          <h2 id="mezun-belge-talepleri" className="text-lg font-semibold">
            Mezun belge talepleri
          </h2>
          <p className="text-sm text-muted-foreground">
            Mezun ve ayrılmış öğrencilerin öğrenim belgesi, not dökümü ve diploma örneği talepleri.
            Belgeler bilgilendirme amaçlıdır; resmî belge e-Okul'dan alınır.
          </p>
        </div>
        <span className="flex flex-wrap gap-2">
          {canEditFees ? (
            <Button variant="secondary" onClick={() => setEditingFees(true)}>
              Belge ücretleri
            </Button>
          ) : null}
          <Button onClick={() => setCreating(true)}>
            <Icon name="Plus" size={17} aria-hidden="true" />
            Yeni belge talebi
          </Button>
        </span>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={requests.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={FILTERS}
        mobileColumns={MOBILE}
        caption="Mezun belge talepleri"
        empty="Henüz mezun belge talebi yok."
        emptyFiltered="Bu seçimle eşleşen talep yok."
        loading={requests.isPending}
        fetching={requests.isFetching && !requests.isPending}
        error={
          requests.error ? (
            <QueryError error={requests.error} onRetry={() => void requests.refetch()} />
          ) : undefined
        }
      />
      {creating ? (
        <NewRequestModal
          institutionType={institutionType}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            setOpenId(id)
          }}
        />
      ) : null}
      {openId !== null ? (
        <RequestLoader requestId={openId} onClose={() => setOpenId(null)} />
      ) : null}
      {editingFees ? <FeesModal onClose={() => setEditingFees(false)} /> : null}
    </section>
  )
}

const NEW_FORM = 'mezun-belge-formu'

function NewRequestModal({
  institutionType,
  onClose,
  onCreated,
}: {
  institutionType: string | undefined
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const create = useCreateAlumniRequest()
  const fees = useAlumniFees()
  const [studentQuery, setStudentQuery] = useState('')
  const debounced = useDebouncedValue(studentQuery).trim()
  const students = useAlumniStudents({
    page: 1,
    pageSize: 50,
    ...(debounced.length >= 2 ? { q: debounced } : {}),
  })
  const form = useForm<AlumniRequestFormValues>({
    resolver: zodResolver(alumniRequestFormSchema),
    defaultValues: ALUMNI_REQUEST_DEFAULTS,
  })
  const [files, setFiles] = useState<FileUploadItem[]>([])
  const [fileError, setFileError] = useState<string | undefined>()
  const [uploading, setUploading] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const values = useWatch({ control: form.control })
  const student = students.data?.data.find((item) => item.id === values.studentId)
  const need = authorizationNeed(student, values.requesterKind ?? 'self')
  const guardians = eligibleGuardians(student)
  const types = documentTypeOptions(institutionType, student)
  const unitFee = fees.data?.data[values.documentType ?? 'education_certificate'] ?? 0
  const copies = Number(values.copies)
  const busy = create.isPending || form.formState.isSubmitting
  const errors = form.formState.errors

  const onSubmit = form.handleSubmit(async (formValues) => {
    const fileId = files[0]?.id ?? null
    if (need !== null && fileId === null) {
      setFileError(
        need === 'proxy'
          ? 'Vekâletnameyi PDF olarak yükleyin.'
          : 'Reşit kişinin yazılı rızasını PDF olarak yükleyin.',
      )
      return
    }
    const outcome = await create.submit(createAlumniRequestBody(formValues, fileId), {
      setError: (name: string, error: { type: string; message: string }) => {
        const field = alumniFormField(name)
        if (field === 'authorizationFileId') setFileError(error.message)
        else if (field) form.setError(field, error, { shouldFocus: true })
        else form.setError('root.server', error)
      },
    })
    if (outcome.status === 'success') {
      notify.success('Belge talebi kaydedildi.')
      onCreated(outcome.data.data.id)
    }
  })

  return (
    <Modal
      open
      size="wide"
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Yeni belge talebi"
      description="Telefon, e-posta, dilekçe ya da ön büroda gelen talebi kaydedin. Talep edenin yetkisi kayıttaki veli bağı ve yaşa göre denetlenir."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button
            type="submit"
            form={NEW_FORM}
            disabled={busy || uploading || blocked}
            aria-busy={busy || undefined}
          >
            Talebi kaydet
          </Button>
        </>
      }
    >
      <form
        id={NEW_FORM}
        noValidate
        aria-label="Yeni belge talebi"
        onSubmit={(event) => void onSubmit(event)}
        className="grid grid-cols-2 gap-4 max-[650px]:grid-cols-1"
      >
        <FormField
          id="mezun-ara"
          label="Öğrenci ara"
          description="Ad ya da okul numarasıyla; yalnız mezun ve ayrılmış öğrenciler."
        >
          {(control) => (
            <Input
              {...control}
              type="search"
              value={studentQuery}
              onChange={(event) => setStudentQuery(event.target.value)}
              disabled={busy}
            />
          )}
        </FormField>
        <FormField id="mezun-ogrenci" label="Öğrenci" error={errors.studentId}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('studentId')}
              className="w-full"
              disabled={busy || students.isPending}
            >
              <NativeSelectOption value="">
                {students.isPending ? 'Yükleniyor…' : 'Öğrenci seçin'}
              </NativeSelectOption>
              {(students.data?.data ?? []).map((item) => (
                <NativeSelectOption key={item.id} value={item.id}>
                  {studentOptionLabel(item)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        {students.error ? (
          <div className="col-span-full">
            <QueryError error={students.error} onRetry={() => void students.refetch()} />
          </div>
        ) : null}
        <FormField id="mezun-belge-turu" label="Belge türü" error={errors.documentType}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('documentType')}
              className="w-full"
              disabled={busy}
            >
              {types.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {ALUMNI_DOCUMENT_TYPE_LABELS[value]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField
          id="mezun-adet"
          label="Adet"
          description={
            unitFee === 0
              ? 'Bu belge ücretsizdir.'
              : `Belge başı ${money(unitFee)}; toplam ${Number.isInteger(copies) && copies > 0 ? money(unitFee * copies) : '—'}.`
          }
          error={errors.copies}
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('copies')}
              inputMode="numeric"
              maxLength={2}
              disabled={busy}
            />
          )}
        </FormField>
        <FormField id="mezun-kanal" label="Talep nasıl geldi" error={errors.channel}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('channel')}
              className="w-full"
              disabled={busy}
            >
              {ALUMNI_REQUEST_CHANNELS.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {ALUMNI_REQUEST_CHANNEL_LABELS[value]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField
          id="mezun-talep-eden"
          label="Talep eden"
          description={
            student?.adult === false
              ? 'Kişi reşit değil: talebi velisi yapar.'
              : 'Reşit kişinin belgesini velisi yazılı rızayla, vekili vekâletnameyle alır.'
          }
          error={errors.requesterKind}
        >
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('requesterKind')}
              className="w-full"
              disabled={busy}
            >
              {ALUMNI_REQUESTER_KINDS.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {ALUMNI_REQUESTER_LABELS[value]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        {values.requesterKind === 'guardian' ? (
          <FormField
            id="mezun-veli"
            label="Veli"
            description="Yalnız velayeti olan ve iletişim kısıtı bulunmayan veliler listelenir."
            error={errors.guardianParentId}
          >
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('guardianParentId')}
                className="w-full"
                disabled={busy}
              >
                <NativeSelectOption value="">
                  {guardians.length === 0 ? 'Uygun veli yok' : 'Veli seçin'}
                </NativeSelectOption>
                {guardians.map((guardian) => (
                  <NativeSelectOption key={guardian.parentId} value={guardian.parentId}>
                    {guardian.name ?? 'Adı kayıtlı değil'}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        ) : null}
        {values.requesterKind === 'proxy' ? (
          <FormField id="mezun-vekil" label="Vekilin adı soyadı" error={errors.proxyName}>
            {(control) => (
              <Input {...control} {...form.register('proxyName')} maxLength={120} disabled={busy} />
            )}
          </FormField>
        ) : null}
        {need !== null ? (
          <div className="col-span-full">
            <FileUploadField
              id="mezun-yetki-belgesi"
              label={need === 'proxy' ? 'Vekâletname (PDF)' : 'Yazılı rıza belgesi (PDF)'}
              description="Taranmış belge talebe bağlanır; yalnız yönetici ve ön büro açabilir."
              purpose="document"
              items={files}
              {...(fileError === undefined ? {} : { error: { message: fileError } })}
              disabled={busy}
              onUploaded={(item) => {
                setFiles([item])
                setFileError(undefined)
              }}
              onRemoved={() => setFiles([])}
              onBusyChange={setUploading}
              onBlockedChange={setBlocked}
            />
          </div>
        ) : null}
        <FormField id="mezun-teslim" label="Teslim yolu" error={errors.deliveryMethod}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('deliveryMethod')}
              className="w-full"
              disabled={busy}
            >
              {ALUMNI_DELIVERY_METHODS.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {ALUMNI_DELIVERY_LABELS[value]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        {values.deliveryMethod === 'email' ? (
          <FormField id="mezun-eposta" label="Teslim e-postası" error={errors.deliveryEmail}>
            {(control) => (
              <Input
                {...control}
                {...form.register('deliveryEmail')}
                type="email"
                maxLength={254}
                disabled={busy}
              />
            )}
          </FormField>
        ) : null}
        {values.deliveryMethod === 'cargo' ? (
          <div className="col-span-full">
            <FormField id="mezun-adres" label="Kargo adresi" error={errors.deliveryAddress}>
              {(control) => (
                <Textarea
                  {...control}
                  {...form.register('deliveryAddress')}
                  rows={3}
                  maxLength={500}
                  disabled={busy}
                />
              )}
            </FormField>
          </div>
        ) : null}
        <div className="col-span-full">
          <RootError message={errors.root?.server?.message} />
        </div>
      </form>
    </Modal>
  )
}

type Step = 'ready' | 'deliver' | 'reject' | null

/** Talep ayrıntısı sunucudan okunur: yeni açılan talep listenin bu sayfasında olmayabilir. */
function RequestLoader({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const detail = useAlumniRequest(requestId)
  if (detail.data) return <RequestModal request={detail.data.data} onClose={onClose} />
  return (
    <Modal open onOpenChange={(next) => (next ? undefined : onClose())} title="Belge talebi">
      {detail.error ? (
        <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
      ) : (
        <p className="text-sm">Yükleniyor…</p>
      )}
    </Modal>
  )
}

function RequestModal({ request, onClose }: { request: AlumniRequestRow; onClose: () => void }) {
  const transition = useTransitionAlumniRequest()
  const files = useOpenFile()
  const [step, setStep] = useState<Step>(null)
  const [pdfOpen, setPdfOpen] = useState(false)
  const [pdfUsed, setPdfUsed] = useState(false)
  const pdfButton = useRef<HTMLButtonElement>(null)
  const generated = request.documentType !== 'diploma_copy'
  const printable = generated && (request.status === 'ready' || request.status === 'delivered')
  const fields: [string, string][] = [
    ['Öğrenci', request.studentName ?? '—'],
    ['Belge', `${ALUMNI_DOCUMENT_TYPE_LABELS[request.documentType]} × ${String(request.copies)}`],
    ['Talep eden', `${request.requesterName} (${ALUMNI_REQUESTER_LABELS[request.requesterKind]})`],
    ['Geliş yolu', ALUMNI_REQUEST_CHANNEL_LABELS[request.channel]],
    [
      'Teslim yolu',
      [
        ALUMNI_DELIVERY_LABELS[request.deliveryMethod],
        request.deliveryEmail,
        request.deliveryAddress,
      ]
        .filter((part): part is string => part !== null)
        .join(' · '),
    ],
    [
      'Ücret',
      request.feeCents === 0
        ? 'Ücretsiz'
        : `${money(request.feeCents)}${
            request.paymentMethod === null
              ? ' · ödenmedi'
              : ` · ödendi (${ALUMNI_FEE_PAYMENT_LABELS[request.paymentMethod]})`
          }`,
    ],
    ['Belge no', request.documentNumber ?? '—'],
    ['Alındı', `${dateLabel(request.receivedAt, YEAR)} · ${request.receivedByName ?? '—'}`],
  ]
  if (request.readyAt !== null)
    fields.push([
      'Hazırlandı',
      `${dateLabel(request.readyAt, YEAR)} · ${request.readyByName ?? '—'}`,
    ])
  if (request.manualNote !== null) fields.push(['Açıklama', request.manualNote])
  if (request.deliveredAt !== null)
    fields.push([
      'Teslim edildi',
      `${dateLabel(request.deliveredAt, YEAR)} · ${request.deliveredByName ?? '—'} · ${request.identityCheckNote ?? ''}`,
    ])
  if (request.rejectedAt !== null)
    fields.push([
      'Reddedildi',
      `${dateLabel(request.rejectedAt, YEAR)} · ${request.rejectedByName ?? '—'} · ${request.rejectionReason ?? ''}`,
    ])

  async function start() {
    const outcome = await transition.submit({
      action: 'start',
      requestId: request.id,
      version: request.version,
    })
    if (outcome.status === 'success') notify.success('Talep hazırlanıyor.')
  }

  return (
    <Modal
      open
      size="wide"
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={`${request.studentName ?? 'Öğrenci'} · ${ALUMNI_DOCUMENT_TYPE_LABELS[request.documentType]}`}
      description={`Durum: ${ALUMNI_REQUEST_STATUS_LABELS[request.status]}`}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Kapat
        </Button>
      }
    >
      <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
        {fields.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        {request.authorizationFileId !== null ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={files.opening === request.authorizationFileId}
            onClick={() => void files.open(request.authorizationFileId ?? '')}
          >
            <Icon name="FileText" size={16} aria-hidden="true" />
            {request.requesterKind === 'proxy' ? 'Vekâletnameyi aç' : 'Rıza belgesini aç'}
          </Button>
        ) : null}
        {request.diplomaFileId !== null ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={files.opening === request.diplomaFileId}
            onClick={() => void files.open(request.diplomaFileId ?? '')}
          >
            <Icon name="FileText" size={16} aria-hidden="true" />
            Diploma örneğini aç
          </Button>
        ) : null}
        {printable ? (
          <Button
            ref={pdfButton}
            variant="secondary"
            size="sm"
            aria-haspopup="dialog"
            onClick={() => {
              setPdfUsed(true)
              setPdfOpen(true)
            }}
          >
            <Icon name="FileText" size={16} aria-hidden="true" />
            Belgeyi görüntüle
          </Button>
        ) : null}
        {request.actions.includes('start') ? (
          <Button
            size="sm"
            disabled={transition.isPending}
            aria-busy={transition.isPending || undefined}
            onClick={() => void start()}
          >
            Hazırlamaya başla
          </Button>
        ) : null}
        {request.actions.includes('ready') ? (
          <Button size="sm" onClick={() => setStep('ready')}>
            Hazır işaretle
          </Button>
        ) : null}
        {request.actions.includes('deliver') ? (
          <Button size="sm" onClick={() => setStep('deliver')}>
            Teslim et
          </Button>
        ) : null}
        {request.actions.includes('reject') ? (
          <Button size="sm" variant="outline" onClick={() => setStep('reject')}>
            Reddet
          </Button>
        ) : null}
      </div>
      {step === 'ready' ? <ReadyForm request={request} onDone={() => setStep(null)} /> : null}
      {step === 'deliver' ? <DeliverForm request={request} onDone={() => setStep(null)} /> : null}
      {step === 'reject' ? <RejectForm request={request} onDone={() => setStep(null)} /> : null}
      {pdfUsed ? (
        <AlumniPdf
          requestId={request.id}
          open={pdfOpen}
          onOpenChange={setPdfOpen}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            pdfButton.current?.focus()
          }}
        />
      ) : null}
    </Modal>
  )
}

function AlumniPdf({
  requestId,
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  requestId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloseAutoFocus: (event: Event) => void
}) {
  const pdf = useAlumniDocumentPdf(requestId, open)
  return (
    <FinancePdfDialog
      title="Mezun belgesi"
      pdf={pdf}
      open={open}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
    />
  )
}

function StepForm({
  label,
  submitLabel,
  busy,
  disabled = false,
  onSubmit,
  onCancel,
  error,
  children,
}: {
  label: string
  submitLabel: string
  busy: boolean
  disabled?: boolean
  onSubmit: () => void
  onCancel: () => void
  error: string | undefined
  children: ReactNode
}) {
  return (
    <form
      noValidate
      aria-label={label}
      className="mt-4 grid gap-3 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      {children}
      <RootError message={error} />
      <span className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy || disabled} aria-busy={busy || undefined}>
          {submitLabel}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onCancel} disabled={busy}>
          Vazgeç
        </Button>
      </span>
    </form>
  )
}

function ReadyForm({ request, onDone }: { request: AlumniRequestRow; onDone: () => void }) {
  const transition = useTransitionAlumniRequest()
  const [note, setNote] = useState('')
  const [files, setFiles] = useState<FileUploadItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const diploma = request.documentType === 'diploma_copy'
  async function submit() {
    const fileId = files[0]?.id ?? null
    if (diploma && fileId === null) {
      setError('Diploma örneğinin taranmış PDF dosyasını yükleyin.')
      return
    }
    const outcome = await transition.submit(
      {
        action: 'ready',
        requestId: request.id,
        version: request.version,
        body: diploma ? { fileId } : { manualNote: note.trim() === '' ? null : note.trim() },
      },
      { setError: (_name: string, issue: { message: string }) => setError(issue.message) },
    )
    if (outcome.status === 'success') {
      notify.success(`Belge hazır: ${outcome.data.data.documentNumber ?? ''}`)
      onDone()
    }
  }
  return (
    <StepForm
      label="Hazır işaretle"
      submitLabel="Hazır işaretle"
      busy={transition.isPending}
      disabled={uploading || blocked}
      onSubmit={() => void submit()}
      onCancel={onDone}
      error={error}
    >
      {diploma ? (
        <FileUploadField
          id="mezun-diploma"
          label="Diploma örneği (PDF)"
          description="e-Okul'dan alınan diplomanın taranmış dosyası; resmî sisteme gönderilmez."
          purpose="document"
          items={files}
          disabled={transition.isPending}
          onUploaded={(item) => {
            setFiles([item])
            setError(undefined)
          }}
          onRemoved={() => setFiles([])}
          onBusyChange={setUploading}
          onBlockedChange={setBlocked}
        />
      ) : (
        <FormField
          id="mezun-not"
          label="Açıklama (isteğe bağlı)"
          description="Kayıtlarda olmayan bilgi belgeye yazılır; kayıtta not yoksa zorunludur."
        >
          {(control) => (
            <Textarea
              {...control}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              maxLength={1000}
            />
          )}
        </FormField>
      )}
    </StepForm>
  )
}

function DeliverForm({ request, onDone }: { request: AlumniRequestRow; onDone: () => void }) {
  const transition = useTransitionAlumniRequest()
  const [note, setNote] = useState('')
  const [method, setMethod] = useState<AlumniFeePaymentMethod | ''>('')
  const [error, setError] = useState<string | undefined>()
  const paid = request.feeCents > 0
  async function submit() {
    if (note.trim().length < 5) {
      setError('Kimliğin nasıl doğrulandığını en az 5 karakterle yazın.')
      return
    }
    if (paid && method === '') {
      setError('Ücretli belge, ücreti alınmadan teslim edilmez; ödeme yöntemini seçin.')
      return
    }
    const outcome = await transition.submit(
      {
        action: 'deliver',
        requestId: request.id,
        version: request.version,
        body: { identityCheckNote: note.trim(), paymentMethod: method === '' ? null : method },
      },
      { setError: (_name: string, issue: { message: string }) => setError(issue.message) },
    )
    if (outcome.status === 'success') {
      notify.success('Belge teslim edildi.')
      onDone()
    }
  }
  return (
    <StepForm
      label="Teslim et"
      submitLabel="Teslim et"
      busy={transition.isPending}
      onSubmit={() => void submit()}
      onCancel={onDone}
      error={error}
    >
      <FormField
        id="mezun-kimlik-notu"
        label="Kimlik doğrulama notu"
        description="Teslim alanın kimliğini nasıl doğruladığınızı yazın (ör. nüfus cüzdanı görüldü)."
      >
        {(control) => (
          <Textarea
            {...control}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            maxLength={500}
          />
        )}
      </FormField>
      {paid ? (
        <FormField
          id="mezun-odeme"
          label={`Ödeme yöntemi (${money(request.feeCents)})`}
          description="Ödendi işareti teslimle birlikte yazılır; tahsilat kaydı açılmaz."
        >
          {(control) => (
            <NativeSelect
              {...control}
              value={method}
              onChange={(event) => setMethod(event.target.value as AlumniFeePaymentMethod | '')}
              className="w-full"
            >
              <NativeSelectOption value="">Seçin</NativeSelectOption>
              {ALUMNI_FEE_PAYMENT_METHODS.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {ALUMNI_FEE_PAYMENT_LABELS[value]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      ) : null}
    </StepForm>
  )
}

function RejectForm({ request, onDone }: { request: AlumniRequestRow; onDone: () => void }) {
  const transition = useTransitionAlumniRequest()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | undefined>()
  async function submit() {
    if (reason.trim().length < 5) {
      setError('Ret gerekçesini en az 5 karakterle yazın.')
      return
    }
    const outcome = await transition.submit(
      { action: 'reject', requestId: request.id, version: request.version, reason: reason.trim() },
      { setError: (_name: string, issue: { message: string }) => setError(issue.message) },
    )
    if (outcome.status === 'success') {
      notify.success('Talep reddedildi.')
      onDone()
    }
  }
  return (
    <StepForm
      label="Talebi reddet"
      submitLabel="Reddet"
      busy={transition.isPending}
      onSubmit={() => void submit()}
      onCancel={onDone}
      error={error}
    >
      <FormField id="mezun-ret" label="Ret gerekçesi">
        {(control) => (
          <Textarea
            {...control}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={500}
          />
        )}
      </FormField>
    </StepForm>
  )
}

const FEES_FORM = 'mezun-ucret-formu'

function FeesModal({ onClose }: { onClose: () => void }) {
  const fees = useAlumniFees()
  if (fees.isPending)
    return (
      <Modal open onOpenChange={(next) => (next ? undefined : onClose())} title="Belge ücretleri">
        <p className="text-sm">Yükleniyor…</p>
      </Modal>
    )
  if (fees.error)
    return (
      <Modal open onOpenChange={(next) => (next ? undefined : onClose())} title="Belge ücretleri">
        <QueryError error={fees.error} onRetry={() => void fees.refetch()} />
      </Modal>
    )
  return <FeesForm current={fees.data.data} onClose={onClose} />
}

function FeesForm({
  current,
  onClose,
}: {
  current: Record<AlumniDocumentType, number>
  onClose: () => void
}) {
  const update = useUpdateAlumniFees()
  const form = useForm<AlumniFeesFormValues>({
    resolver: zodResolver(alumniFeesFormSchema),
    defaultValues: alumniFeesDefaults(current),
  })
  const busy = update.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const body = alumniFeesBody(values, current)
    if (Object.keys(body).length === 0) {
      onClose()
      return
    }
    const outcome = await update.submit(body, {
      setError: (name: string, error: { type: string; message: string }) => {
        if (ALUMNI_DOCUMENT_TYPES.some((type) => type === name))
          form.setError(name as AlumniDocumentType, error)
        else form.setError('root.server', error)
      },
    })
    if (outcome.status === 'success') {
      notify.success('Belge ücretleri güncellendi.')
      onClose()
    }
  })
  return (
    <Modal
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Belge ücretleri"
      description="Belge başı ücret; 0 ücretsiz demektir. Açılmış taleplerin ücreti değişmez."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={FEES_FORM} disabled={busy} aria-busy={busy || undefined}>
            Kaydet
          </Button>
        </>
      }
    >
      <form
        id={FEES_FORM}
        noValidate
        aria-label="Belge ücretleri"
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        {ALUMNI_DOCUMENT_TYPES.map((type) => (
          <FormField
            key={type}
            id={`mezun-ucret-${type}`}
            label={`${ALUMNI_DOCUMENT_TYPE_LABELS[type]} (₺)`}
            error={form.formState.errors[type]}
          >
            {(control) => (
              <Input {...control} {...form.register(type)} inputMode="decimal" disabled={busy} />
            )}
          </FormField>
        ))}
        <RootError message={form.formState.errors.root?.server?.message} />
      </form>
    </Modal>
  )
}
