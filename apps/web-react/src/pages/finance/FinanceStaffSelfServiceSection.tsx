import { zodResolver } from '@hookform/resolvers/zod'
import { useState, type ReactNode } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { isReauthenticationRequired } from '@kampus/react-shared/reauthentication.ts'
import {
  useCancelOwnChangeRequest,
  useCreateOwnChangeRequest,
  useCreateOwnLeaveRequest,
  useOwnChangeRequests,
  useOwnLeave,
  useOwnPayslipMonths,
  useOwnStaffDocuments,
  useOwnStaffProfile,
  type CreateOwnChangeRequestBody,
  type OwnLeave,
  type OwnStaffProfile,
  type StaffChangeRequest,
} from '@kampus/react-shared/use-finance-staff-self-service.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  DEFAULT_STAFF_DOCUMENT_SETTINGS,
  HEALTH_REPORT_KIND_LABELS,
  HEALTH_REPORT_KINDS,
  STAFF_DOCUMENT_TYPE_LABELS,
  STAFF_DOCUMENT_TYPES,
} from '@kampus/school-core/lib/finance-staff-documents.ts'
import {
  PERSONNEL_EMERGENCY_MAX,
  PERSONNEL_FILE_GROUP_LABELS,
} from '@kampus/school-core/lib/finance-personnel-files.ts'
import type { StaffChangeKind } from '@kampus/school-core/lib/finance-staff-self-service.ts'
import { useReauthRetry } from '@/auth/use-reauth-retry.tsx'
import { FileUploadField, type FileUploadItem } from '@/components/FileUploadField.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { FinancePayrollPayslipButton } from './FinancePayrollPayslipButton.tsx'
import {
  leaveRequestBody,
  leaveRequestDefaults,
  leaveRequestFormField,
  leaveRequestFormSchema,
  rangeText,
  daysText,
  statusLabel as leaveStatusLabel,
  statusTone as leaveStatusTone,
  type LeaveRequestFormValues,
} from './finance-leave-request-forms.ts'
import { educationText } from './finance-personnel-file-forms.ts'
import {
  documentTitle,
  STAFF_DOCUMENT_STATUS_TONE,
  statusLabel as documentStatusLabel,
  validityText,
} from './finance-staff-document-forms.ts'
import {
  bankBody,
  bankDefaults,
  bankFormField,
  bankFormSchema,
  changeStatusLabel,
  changeStatusTone,
  contactBody,
  contactDefaults,
  contactFormField,
  contactFormSchema,
  documentBody,
  documentDefaults,
  documentFormField,
  documentFormSchema,
  emergencyBody,
  emergencyDefaults,
  emergencyFormField,
  emergencyFormSchema,
  EMPTY_PERSON,
  kindLabel,
  payslipMonthText,
  proposalText,
  requestDayText,
  type BankFormValues,
  type ContactFormValues,
  type DocumentFormValues,
  type EmergencyFormValues,
} from './finance-staff-self-service-forms.ts'

const QUIET = { silent: isReauthenticationRequired }
const PANEL = 'panel overflow-hidden rounded-card border bg-surface px-6 py-6'
const LIST = 'grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm'

type Card = NonNullable<OwnStaffProfile['file']>

/**
 * "Bilgilerim" (DOM-FIN-166; ON-189; K-553…K-555): personelin kendi özlük özeti (salt okunur,
 * maskeli), değişiklik talepleri, özlük belgeleri, izin bakiyesi ve talebi, onaylı dönem bordro
 * pusulaları. Değişiklik doğrudan yazılmaz, yönetici onayına talep olarak gider. Yönetici ve ön
 * büroda Finans "Bilgilerim" sekmesidir; öğretmen menüsüne bağlanması rol kabuğundadır.
 */
export function StaffSelfServiceView() {
  const profile = useOwnStaffProfile()
  if (profile.error)
    return <QueryError error={profile.error} onRetry={() => void profile.refetch()} />
  const data = profile.data?.data
  if (data === undefined) return <SummaryLoading />
  return (
    <div className="grid gap-6">
      <ProfilePanel profile={data} />
      <RequestsPanel />
      <DocumentsPanel />
      <LeavePanel membershipId={data.membershipId} />
      <PayslipsPanel />
    </div>
  )
}

// --- Özlük özeti ---------------------------------------------------------------------------------

const Pair = ({ term, value }: { term: string; value: string | null | undefined }) => (
  <>
    <dt className="text-muted-foreground">{term}</dt>
    <dd className="[overflow-wrap:anywhere]">{value ?? '—'}</dd>
  </>
)

function Group({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section aria-label={title} className="grid content-start gap-2 rounded-card border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function ProfilePanel({ profile }: { profile: OwnStaffProfile }) {
  const [editing, setEditing] = useState<StaffChangeKind | null>(null)
  const pending = new Set(profile.pendingKinds)
  const card: Card | null = profile.file
  const action = (kind: StaffChangeKind, label: string) =>
    pending.has(kind) ? (
      <StatusBadge text="Onay bekliyor" tone="amber" />
    ) : profile.active ? (
      <Button size="sm" variant="secondary" onClick={() => setEditing(kind)}>
        {label}
      </Button>
    ) : null
  return (
    <section aria-labelledby="bilgilerim" className={PANEL}>
      <header className="mb-4 grid gap-1">
        <h2 id="bilgilerim" className="text-lg font-semibold">
          Bilgilerim
        </h2>
        <p className="text-sm text-muted-foreground">
          Özlük kartınız salt okunurdur. Değişiklik isteğiniz insan kaynaklarının onayından sonra
          kayda yazılır. T.C. kimlik numarası ve IBAN maskeli gösterilir.
        </p>
      </header>
      {card === null ? (
        <p className="mb-4 text-sm text-muted-foreground">
          Özlük kartınız henüz açılmadı. İletişim, acil durum ve banka bilgilerinizi talep olarak
          gönderebilirsiniz.
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Group title={PERSONNEL_FILE_GROUP_LABELS.identity}>
          <dl className={LIST}>
            <dt className="text-muted-foreground">T.C. kimlik no</dt>
            <dd className="font-mono">{card?.identity?.nationalIdMasked ?? '—'}</dd>
            <Pair term="Doğum günü" value={card?.identity?.birthDate ?? null} />
          </dl>
        </Group>
        <Group
          title={PERSONNEL_FILE_GROUP_LABELS.contact}
          action={action('contact', 'Değişiklik iste')}
        >
          <dl className={LIST}>
            <Pair term="Adres" value={card?.contact?.address} />
            <Pair term="Telefon" value={card?.contact?.phone} />
            <Pair term="E-posta" value={card?.contact?.email} />
          </dl>
        </Group>
        <Group title={PERSONNEL_FILE_GROUP_LABELS.education}>
          {(card?.education ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Bilgi girilmedi.</p>
          ) : (
            <ul aria-label="Eğitim geçmişi" className="grid gap-1 text-sm">
              {(card?.education ?? []).map((row, index) => (
                <li key={`${row.school}-${String(index)}`}>{educationText(row)}</li>
              ))}
            </ul>
          )}
        </Group>
        <Group
          title={PERSONNEL_FILE_GROUP_LABELS.bank}
          action={action('bank', 'Banka bilgisini değiştir')}
        >
          <dl className={LIST}>
            <dt className="text-muted-foreground">IBAN</dt>
            <dd className="font-mono [overflow-wrap:anywhere]">{card?.bank?.ibanMasked ?? '—'}</dd>
            <Pair term="Hesap sahibi" value={card?.bank?.accountHolder} />
          </dl>
        </Group>
        <Group
          title={PERSONNEL_FILE_GROUP_LABELS.emergencyContacts}
          action={action('emergency_contacts', 'Değişiklik iste')}
        >
          {(card?.emergencyContacts ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Bilgi girilmedi.</p>
          ) : (
            <ul aria-label="Acil durum kişileri" className="grid gap-1 text-sm">
              {(card?.emergencyContacts ?? []).map((row, index) => (
                <li key={`${row.name}-${String(index)}`}>
                  {row.name} ({row.relation}) · {row.phone}
                </li>
              ))}
            </ul>
          )}
        </Group>
      </div>
      <Modal
        open={editing !== null}
        onOpenChange={(open) => (open ? undefined : setEditing(null))}
        title={editing === null ? '' : `${kindLabel(editing)} değişikliği`}
        description="Talebiniz onaylanınca özlük kartınıza yazılır."
      >
        {editing === 'contact' ? <ContactForm onDone={() => setEditing(null)} /> : null}
        {editing === 'emergency_contacts' ? (
          <EmergencyForm current={card?.emergencyContacts} onDone={() => setEditing(null)} />
        ) : null}
        {editing === 'bank' ? (
          <BankForm name={profile.name} onDone={() => setEditing(null)} />
        ) : null}
      </Modal>
    </section>
  )
}

/** Talep gönderimi: IBAN talebi taze oturum isterse parola sorulur ve bir kez yinelenir. */
function useSubmitChange(onDone: () => void) {
  const create = useCreateOwnChangeRequest()
  const { run, reauthModal } = useReauthRetry()
  async function submit(
    body: CreateOwnChangeRequestBody,
    setError: (name: string, error: { type: string; message: string }) => void,
  ) {
    const outcome = await run(() => create.submit(body, { ...QUIET, setError }))
    if (outcome.status !== 'done' || outcome.result.status !== 'success') return
    notify.success('Talebiniz onaya gönderildi.')
    onDone()
  }
  return { submit, busy: create.isPending, reauthModal }
}

function ContactForm({ onDone }: { onDone: () => void }) {
  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: contactDefaults(),
  })
  const change = useSubmitChange(onDone)
  const errors = form.formState.errors
  const busy = change.busy || form.formState.isSubmitting
  const onSubmit = form.handleSubmit((values) =>
    change.submit(contactBody(values), (name, error) => {
      const field = contactFormField(name)
      if (field) form.setError(field, error, { shouldFocus: true })
      else form.setError('root.server', error)
    }),
  )
  return (
    <form
      noValidate
      aria-label="Adres ve telefon"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <p className="text-sm text-muted-foreground">Değişmeyecek alanı boş bırakın.</p>
      <FormField id="self-adres" label="Yeni adres" error={errors.address}>
        {(control) => (
          <Textarea {...control} {...form.register('address')} rows={2} disabled={busy} />
        )}
      </FormField>
      <FormField
        id="self-telefon"
        label="Yeni telefon"
        error={errors.phone}
        description="0XXXXXXXXXX"
      >
        {(control) => (
          <Input
            {...control}
            type="tel"
            autoComplete="tel"
            {...form.register('phone')}
            disabled={busy}
          />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <div>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Talep gönder
        </Button>
      </div>
      {change.reauthModal}
    </form>
  )
}

function EmergencyForm({
  current,
  onDone,
}: {
  current: Card['emergencyContacts']
  onDone: () => void
}) {
  const form = useForm<EmergencyFormValues>({
    resolver: zodResolver(emergencyFormSchema),
    defaultValues: emergencyDefaults(current),
  })
  const people = useFieldArray({ control: form.control, name: 'contacts' })
  const change = useSubmitChange(onDone)
  const errors = form.formState.errors
  const busy = change.busy || form.formState.isSubmitting
  const onSubmit = form.handleSubmit((values) =>
    change.submit(emergencyBody(values), (name, error) => {
      const field = emergencyFormField(name)
      if (field) form.setError(field as `contacts.${number}.name`, error, { shouldFocus: true })
      else form.setError('root.server', error)
    }),
  )
  return (
    <form
      noValidate
      aria-label="Acil durum kişileri"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <p className="text-sm text-muted-foreground">
        Liste bütün olarak yazılır; çıkardığınız kişi silinir.
      </p>
      {people.fields.map((field, index) => {
        const rowErrors = errors.contacts?.[index]
        const n = String(index + 1)
        return (
          <fieldset key={field.id} className="grid gap-2 rounded-card border p-3 sm:grid-cols-3">
            <legend className="px-1 text-sm font-medium">{`Kişi ${n}`}</legend>
            <FormField id={`self-acil-ad-${n}`} label="Ad soyad" error={rowErrors?.name}>
              {(control) => (
                <Input {...control} {...form.register(`contacts.${index}.name`)} disabled={busy} />
              )}
            </FormField>
            <FormField id={`self-acil-yakinlik-${n}`} label="Yakınlık" error={rowErrors?.relation}>
              {(control) => (
                <Input
                  {...control}
                  {...form.register(`contacts.${index}.relation`)}
                  disabled={busy}
                />
              )}
            </FormField>
            <FormField id={`self-acil-telefon-${n}`} label="Telefon" error={rowErrors?.phone}>
              {(control) => (
                <Input
                  {...control}
                  type="tel"
                  {...form.register(`contacts.${index}.phone`)}
                  disabled={busy}
                />
              )}
            </FormField>
            {people.fields.length > 1 ? (
              <div className="sm:col-span-3">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Kişi ${n} satırını çıkar`}
                  onClick={() => people.remove(index)}
                  disabled={busy}
                >
                  Çıkar
                </Button>
              </div>
            ) : null}
          </fieldset>
        )
      })}
      <RootError message={errors.contacts?.message ?? errors.root?.server?.message} />
      <div className="flex flex-wrap gap-2">
        {people.fields.length < PERSONNEL_EMERGENCY_MAX ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => people.append({ ...EMPTY_PERSON })}
            disabled={busy}
          >
            Kişi ekle
          </Button>
        ) : null}
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Talep gönder
        </Button>
      </div>
      {change.reauthModal}
    </form>
  )
}

function BankForm({ name, onDone }: { name: string; onDone: () => void }) {
  const form = useForm<BankFormValues>({
    resolver: zodResolver(bankFormSchema),
    defaultValues: bankDefaults(name),
  })
  const change = useSubmitChange(onDone)
  const errors = form.formState.errors
  const busy = change.busy || form.formState.isSubmitting
  const onSubmit = form.handleSubmit((values) =>
    change.submit(bankBody(values), (field, error) => {
      const target = bankFormField(field)
      if (target) form.setError(target, error, { shouldFocus: true })
      else form.setError('root.server', error)
    }),
  )
  return (
    <form
      noValidate
      aria-label="Banka bilgisi"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <p className="text-sm text-muted-foreground">
        Ücretiniz yalnız kendi adınıza açılmış hesaba ödenir. Güvenlik için parolanızı yeniden
        sorabiliriz.
      </p>
      <FormField
        id="self-iban"
        label="IBAN"
        error={errors.iban}
        description="TR ile başlayan 26 karakter"
      >
        {(control) => (
          <Input
            {...control}
            autoComplete="off"
            className="font-mono"
            {...form.register('iban')}
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="self-hesap-sahibi" label="Hesap sahibi" error={errors.accountHolder}>
        {(control) => <Input {...control} {...form.register('accountHolder')} disabled={busy} />}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <div>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Talep gönder
        </Button>
      </div>
      {change.reauthModal}
    </form>
  )
}

// --- Talepler ------------------------------------------------------------------------------------

function RequestsPanel() {
  const requests = useOwnChangeRequests({ page: 1, pageSize: 20 })
  const cancel = useCancelOwnChangeRequest()
  const rows = requests.data?.data
  async function withdraw(row: StaffChangeRequest) {
    const outcome = await cancel.submit({ requestId: row.id, version: row.version })
    if (outcome.status === 'success') notify.success('Talebiniz geri çekildi.')
  }
  return (
    <section aria-labelledby="degisiklik-taleplerim" className={PANEL}>
      <h2 id="degisiklik-taleplerim" className="mb-3 text-lg font-semibold">
        Değişiklik taleplerim
      </h2>
      {requests.error ? (
        <QueryError error={requests.error} onRetry={() => void requests.refetch()} />
      ) : rows === undefined ? (
        <SummaryLoading />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Henüz talebiniz yok.</p>
      ) : (
        <ul aria-label="Değişiklik taleplerim" className="grid gap-3">
          {rows.map((row) => (
            <li key={row.id} className="grid gap-1 rounded-card border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {kindLabel(row.kind)} · {requestDayText(row.createdAt)}
                </span>
                <StatusBadge
                  text={changeStatusLabel(row.status)}
                  tone={changeStatusTone(row.status)}
                />
              </div>
              <p className="[overflow-wrap:anywhere] text-muted-foreground">
                {proposalText(row.proposal)}
              </p>
              {row.rejectionReason === null ? null : (
                <p>
                  <span className="text-muted-foreground">Ret gerekçesi: </span>
                  {row.rejectionReason}
                </p>
              )}
              {row.status === 'pending' ? (
                <div>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`${kindLabel(row.kind)} talebini geri çek`}
                    disabled={cancel.isPending}
                    onClick={() => void withdraw(row)}
                  >
                    Geri çek
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// --- Belgeler ------------------------------------------------------------------------------------

function DocumentsPanel() {
  const documents = useOwnStaffDocuments()
  const [adding, setAdding] = useState(false)
  const data = documents.data?.data
  return (
    <section aria-labelledby="belgelerim" className={PANEL}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 id="belgelerim" className="text-lg font-semibold">
            Özlük belgelerim
          </h2>
          <p className="text-sm text-muted-foreground">
            Bildirdiğiniz belge onaylanınca listeye eklenir.
          </p>
        </div>
        <Button onClick={() => setAdding(true)}>Belge bildir</Button>
      </header>
      {documents.error ? (
        <QueryError error={documents.error} onRetry={() => void documents.refetch()} />
      ) : data === undefined ? (
        <SummaryLoading />
      ) : (
        <>
          {data.missingTypes.length > 0 ? (
            <p role="status" className="mb-2 text-sm">
              Eksik zorunlu belgeler:{' '}
              {data.missingTypes.map((type) => STAFF_DOCUMENT_TYPE_LABELS[type]).join(', ')}
            </p>
          ) : null}
          {data.documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">Kayıtlı belgeniz yok.</p>
          ) : (
            <ul aria-label="Özlük belgelerim" className="grid gap-2 text-sm">
              {data.documents.map((doc) => (
                <li
                  key={doc.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-card border p-3"
                >
                  <span>
                    <span className="font-medium">{documentTitle(doc)}</span>
                    <span className="text-muted-foreground"> · {validityText(doc)}</span>
                  </span>
                  <StatusBadge
                    text={documentStatusLabel(doc.status)}
                    tone={STAFF_DOCUMENT_STATUS_TONE[doc.status]}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <Modal
        open={adding}
        onOpenChange={setAdding}
        title="Belge bildir"
        description="Belge insan kaynaklarının onayından sonra özlük dosyanıza eklenir."
      >
        <DocumentForm onDone={() => setAdding(false)} />
      </Modal>
    </section>
  )
}

function DocumentForm({ onDone }: { onDone: () => void }) {
  const form = useForm<DocumentFormValues>({
    resolver: zodResolver(documentFormSchema),
    defaultValues: documentDefaults(dayKey()),
  })
  const change = useSubmitChange(onDone)
  const [files, setFiles] = useState<readonly FileUploadItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [scanBlocked, setScanBlocked] = useState(false)
  const errors = form.formState.errors
  const saving = change.busy || form.formState.isSubmitting
  const busy = saving || uploading
  const documentType = useWatch({ control: form.control, name: 'documentType' })
  const sensitive =
    DEFAULT_STAFF_DOCUMENT_SETTINGS[documentType as keyof typeof DEFAULT_STAFF_DOCUMENT_SETTINGS]
      ?.sensitive ?? false
  const onSubmit = form.handleSubmit((values) =>
    change.submit(documentBody(values, files[0]?.id ?? null, sensitive), (name, error) => {
      const field = documentFormField(name)
      if (field) form.setError(field, error, { shouldFocus: true })
      else form.setError('root.server', error)
    }),
  )
  return (
    <form
      noValidate
      aria-label="Belge bildirimi"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="self-belge-tur" label="Belge türü" error={errors.documentType}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('documentType')}
            className="w-full"
            disabled={busy}
          >
            {STAFF_DOCUMENT_TYPES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {STAFF_DOCUMENT_TYPE_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {documentType === 'health_report' ? (
        <FormField id="self-belge-rapor" label="Rapor türü" error={errors.healthReportKind}>
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
      <FormField id="self-belge-tarih" label="Belge tarihi" error={errors.documentDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('documentDate')} disabled={busy} />
        )}
      </FormField>
      <div className="sm:col-span-2">
        <FileUploadField
          id="self-belge-dosya"
          label="Belge dosyası (isteğe bağlı)"
          purpose="document"
          description="Belgenin taraması (PDF ya da görsel). Yükleme yetkiniz yoksa belgeyi dosyasız bildirip aslını insan kaynaklarına teslim edin."
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
          Özel nitelikli belgeye not yazılmaz; dosyayı yalnız yönetici açar.
        </p>
      ) : (
        <div className="sm:col-span-2">
          <FormField id="self-belge-not" label="Not (isteğe bağlı)" error={errors.note}>
            {(control) => (
              <Textarea {...control} {...form.register('note')} rows={2} disabled={busy} />
            )}
          </FormField>
        </div>
      )}
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy || scanBlocked} aria-busy={busy || undefined}>
          Bildir
        </Button>
      </div>
      {change.reauthModal}
    </form>
  )
}

// --- İzin ----------------------------------------------------------------------------------------

function LeavePanel({ membershipId }: { membershipId: string }) {
  const leave = useOwnLeave()
  const [requesting, setRequesting] = useState(false)
  const data = leave.data?.data
  const balance = data?.entitlement
  return (
    <section aria-labelledby="izinlerim" className={PANEL}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <h2 id="izinlerim" className="text-lg font-semibold">
          İzinlerim
        </h2>
        <Button onClick={() => setRequesting(true)} disabled={data === undefined}>
          İzin talep et
        </Button>
      </header>
      {leave.error ? (
        <QueryError error={leave.error} onRetry={() => void leave.refetch()} />
      ) : data === undefined ? (
        <SummaryLoading />
      ) : (
        <div className="grid gap-4">
          {balance == null ? (
            <p className="text-sm text-muted-foreground">
              İzin profiliniz açılmadığı için yıllık izin bakiyesi hesaplanamıyor.
            </p>
          ) : (
            <dl aria-label="Yıllık izin bakiyesi" className={LIST}>
              <Pair term="Kalan yıllık izin" value={daysText(balance.balanceDays)} />
              <Pair term="Kullanılan" value={daysText(balance.usedDays)} />
              <Pair term="Planlanan" value={daysText(balance.plannedDays)} />
              <Pair
                term="Bekleyen talepler"
                value={String(data.requests.filter((item) => item.status === 'pending').length)}
              />
            </dl>
          )}
          {data.requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">İzin talebiniz yok.</p>
          ) : (
            <ul aria-label="İzin taleplerim" className="grid gap-2 text-sm">
              {data.requests.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-card border p-3"
                >
                  <span>
                    <span className="font-medium">{item.typeLabel}</span>
                    <span className="text-muted-foreground">
                      {' '}
                      · {rangeText(item)} · {daysText(item.days)}
                    </span>
                  </span>
                  <StatusBadge
                    text={leaveStatusLabel(item.status)}
                    tone={leaveStatusTone(item.status)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <Modal open={requesting} onOpenChange={setRequesting} title="İzin talebi">
        {data === undefined ? null : (
          <LeaveForm
            membershipId={membershipId}
            types={data.types}
            onDone={() => setRequesting(false)}
          />
        )}
      </Modal>
    </section>
  )
}

function LeaveForm({
  membershipId,
  types,
  onDone,
}: {
  membershipId: string
  types: OwnLeave['types']
  onDone: () => void
}) {
  const create = useCreateOwnLeaveRequest()
  const form = useForm<LeaveRequestFormValues>({
    resolver: zodResolver(leaveRequestFormSchema),
    defaultValues: { ...leaveRequestDefaults(dayKey()), membershipId },
  })
  const errors = form.formState.errors
  const busy = create.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const { typeCode, startDate, endDate, days, description } = leaveRequestBody(values)
    const outcome = await create.submit(
      { typeCode, startDate, endDate, days, description },
      {
        setError: (name, error) => {
          const field = leaveRequestFormField(name)
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status !== 'success') return
    notify.success('İzin talebiniz onaya gönderildi.')
    onDone()
  })
  return (
    <form
      noValidate
      aria-label="İzin talebi"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField id="self-izin-tur" label="İzin türü" error={errors.typeCode}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('typeCode')}
            className="w-full"
            disabled={busy}
          >
            {types.map((type) => (
              <NativeSelectOption key={type.code} value={type.code}>
                {type.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="self-izin-gun" label="İş günü" error={errors.days}>
        {(control) => (
          <Input {...control} inputMode="numeric" {...form.register('days')} disabled={busy} />
        )}
      </FormField>
      <FormField id="self-izin-baslangic" label="İlk gün" error={errors.startDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('startDate')} disabled={busy} />
        )}
      </FormField>
      <FormField id="self-izin-bitis" label="Son gün" error={errors.endDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('endDate')} disabled={busy} />
        )}
      </FormField>
      <div className="sm:col-span-2">
        <FormField
          id="self-izin-aciklama"
          label="Açıklama (isteğe bağlı)"
          error={errors.description}
        >
          {(control) => (
            <Textarea {...control} {...form.register('description')} rows={2} disabled={busy} />
          )}
        </FormField>
      </div>
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Talep gönder
        </Button>
      </div>
    </form>
  )
}

// --- Pusulalar -----------------------------------------------------------------------------------

function PayslipsPanel() {
  const months = useOwnPayslipMonths()
  const rows = months.data?.data
  return (
    <section aria-labelledby="pusulalarim" className={PANEL}>
      <header className="mb-3 grid gap-1">
        <h2 id="pusulalarim" className="text-lg font-semibold">
          Bordro pusulalarım
        </h2>
        <p className="text-sm text-muted-foreground">
          Onaylanan dönemlerin pusulaları. Pusula açılırken parolanız yeniden sorulabilir.
        </p>
      </header>
      {months.error ? (
        <QueryError error={months.error} onRetry={() => void months.refetch()} />
      ) : rows === undefined ? (
        <SummaryLoading />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Onaylanmış dönemde pusulanız yok.</p>
      ) : (
        <ul aria-label="Bordro pusulalarım" className="grid gap-2 text-sm">
          {rows.map((row) => (
            <li
              key={row.month}
              className="flex flex-wrap items-center justify-between gap-2 rounded-card border p-3"
            >
              <span className="font-medium">{payslipMonthText(row.month)}</span>
              <FinancePayrollPayslipButton
                own
                month={row.month}
                size="sm"
                label="Pusulayı aç"
                accessibleName={`${payslipMonthText(row.month)} pusulasını aç`}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
