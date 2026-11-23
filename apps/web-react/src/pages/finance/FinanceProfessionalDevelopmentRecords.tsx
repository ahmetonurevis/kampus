import { useState } from 'react'
import { useDevelopmentGoals } from '@kampus/react-shared/use-finance-development-goals.ts'
import {
  useAttachProfessionalDevelopmentDocument,
  useLinkProfessionalDevelopmentCertificate,
  useProfessionalDevelopmentDocumentUrlFetcher,
  useRemoveProfessionalDevelopmentDocument,
  useUnlinkProfessionalDevelopmentCertificate,
  type ProfessionalDevelopmentEnrollment,
  type ProfessionalDevelopmentProgram,
} from '@kampus/react-shared/use-finance-professional-development.ts'
import { useStaffDocumentDetail } from '@kampus/react-shared/use-finance-staff-documents.ts'
import { dateLabel, dayKey } from '@kampus/school-core/lib/format.ts'
import { FileUploadField, type FileUploadItem } from '@/components/FileUploadField.tsx'
import { FormField } from '@/components/FormField.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { notify } from '@/lib/notify.ts'
import {
  byteSizeLabel,
  certificateChoices,
  goalChoices,
} from './finance-professional-development-hours-forms.ts'

const GOAL_PAGE = { page: 1, pageSize: 100 } as const
const day = (value: string) => dateLabel(value, { year: 'numeric' })
const POPUP_BLOCKED =
  'Açılır pencere engellendi. Tarayıcıda bu site için açılır pencerelere izin verip yeniden deneyin.'

type Props = {
  program: ProfessionalDevelopmentProgram
  enrollment: ProfessionalDevelopmentEnrollment
}

const refOf = ({ program, enrollment }: Props) => ({
  programId: program.id,
  enrollmentId: enrollment.id,
  version: enrollment.version,
})

/**
 * Katılım belgesi ve sertifika (DOM-FIN-144; ON-215; K-488): yalnız yönetici ve "katıldı" katılımda.
 * Belge PDF olarak yüklenir ve katılıma bağlanır; açılışı denetimdedir. Sertifika ikinci kez
 * tutulmaz: personelin sertifika özlük belgesi seçilir ya da yüklenen dosyayla yeni özlük belgesi
 * açılır.
 */
export function EnrollmentRecords(props: Props) {
  return (
    <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
      <DocumentBlock {...props} />
      <CertificateBlock {...props} />
    </div>
  )
}

function DocumentBlock(props: Props) {
  const { enrollment } = props
  const attach = useAttachProfessionalDevelopmentDocument()
  const remove = useRemoveProfessionalDevelopmentDocument()
  const fetchUrl = useProfessionalDevelopmentDocumentUrlFetcher()
  const [files, setFiles] = useState<readonly FileUploadItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const busy = attach.isPending || remove.isPending || uploading
  const prefix = `mg-belge-${enrollment.id}`
  const save = async () => {
    setError(undefined)
    const fileId = files[0]?.id
    if (fileId === undefined) {
      setError('Önce belgeyi yükleyin.')
      return
    }
    const outcome = await attach.submit(
      { ...refOf(props), fileId },
      { setError: (_name, issue) => setError(issue.message) },
    )
    if (outcome.status === 'success') {
      setFiles([])
      notify.success(`${enrollment.staffName} için katılım belgesi kaydedildi.`)
    }
  }
  const open = async () => {
    const tab = window.open('about:blank', '_blank')
    if (!tab) {
      // Bağlantı üretmek denetim kaydıdır; pencere açılamıyorsa üretilmez.
      notify.error(POPUP_BLOCKED)
      return
    }
    try {
      const { url } = await fetchUrl({ programId: props.program.id, enrollmentId: enrollment.id })
      tab.opener = null
      tab.location.href = url
    } catch (failure) {
      tab.close()
      notify.error('Belge açılamadı. Biraz sonra yeniden deneyin.', failure)
    }
  }
  const document = enrollment.document
  return (
    <div className="grid content-start gap-2">
      <h4 className="text-sm font-medium">Katılım belgesi</h4>
      {document !== null ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>
            {document.name}
            {document.byteSize === null ? '' : ` · ${byteSizeLabel(document.byteSize)}`}
          </span>
          <Button
            size="sm"
            variant="outline"
            aria-label={`${enrollment.staffName} katılım belgesini aç`}
            onClick={() => void open()}
          >
            Aç
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`${enrollment.staffName} katılım belgesini kaldır`}
            disabled={busy}
            onClick={() =>
              void remove.submit(refOf(props)).then((outcome) => {
                if (outcome.status === 'success') notify.success('Katılım belgesi kaldırıldı.')
              })
            }
          >
            Kaldır
          </Button>
        </div>
      ) : null}
      <FileUploadField
        id={`${prefix}-dosya`}
        label={document === null ? 'Belge yükle (PDF, en çok 10 MB)' : 'Yeni belgeyle değiştir'}
        purpose="document"
        listLabel="Katılım belgesi"
        items={files}
        disabled={attach.isPending}
        error={error ? { message: error } : undefined}
        onUploaded={(item) => setFiles([item])}
        onRemoved={() => setFiles([])}
        onBusyChange={setUploading}
        onBlockedChange={setBlocked}
      />
      {files.length > 0 ? (
        <Button
          size="sm"
          className="justify-self-start"
          disabled={busy || blocked}
          aria-busy={attach.isPending || undefined}
          onClick={() => void save()}
        >
          Belgeyi kaydet
        </Button>
      ) : null}
    </div>
  )
}

function CertificateBlock(props: Props) {
  const { enrollment } = props
  const certificate = enrollment.certificate
  const unlink = useUnlinkProfessionalDevelopmentCertificate()
  return (
    <div className="grid content-start gap-2">
      <h4 className="text-sm font-medium">Sertifika</h4>
      {certificate !== null ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>
            Özlük belgelerinde
            {certificate.documentDate === null ? '' : ` · ${day(certificate.documentDate)}`}
            {certificate.validUntil === null
              ? ' · süresiz'
              : ` · ${day(certificate.validUntil)} tarihine kadar`}
          </span>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`${enrollment.staffName} sertifika bağını kaldır`}
            disabled={unlink.isPending}
            onClick={() =>
              void unlink.submit(refOf(props)).then((outcome) => {
                if (outcome.status === 'success')
                  notify.success('Sertifika bağı kaldırıldı; özlük belgesi duruyor.')
              })
            }
          >
            Bağı kaldır
          </Button>
        </div>
      ) : (
        <CertificateForm {...props} />
      )}
    </div>
  )
}

function CertificateForm(props: Props) {
  const { enrollment } = props
  const link = useLinkProfessionalDevelopmentCertificate()
  const detail = useStaffDocumentDetail(enrollment.membershipId)
  const choices = certificateChoices(detail.data?.data.documents ?? [])
  const [existing, setExisting] = useState('')
  const [files, setFiles] = useState<readonly FileUploadItem[]>([])
  const [documentDate, setDocumentDate] = useState(() => dayKey())
  const [validUntil, setValidUntil] = useState('')
  const [uploading, setUploading] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const busy = link.isPending || uploading
  const prefix = `mg-sertifika-${enrollment.id}`
  const submit = async () => {
    setError(undefined)
    const fileId = files[0]?.id
    const body =
      existing !== ''
        ? { source: 'existing' as const, staffDocumentId: existing }
        : fileId !== undefined
          ? {
              source: 'upload' as const,
              fileId,
              documentDate,
              validUntil: validUntil === '' ? null : validUntil,
            }
          : null
    if (body === null) {
      setError('Özlük belgelerinden bir sertifika seçin ya da sertifika dosyasını yükleyin.')
      return
    }
    const outcome = await link.submit(
      { ...refOf(props), body },
      { setError: (_name, issue) => setError(issue.message) },
    )
    if (outcome.status === 'success') {
      setFiles([])
      notify.success(`${enrollment.staffName} için sertifika bağlandı.`)
    }
  }
  return (
    <form
      noValidate
      aria-label={`${enrollment.staffName} sertifikası`}
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      {detail.error ? (
        <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
      ) : null}
      {choices.length > 0 ? (
        <FormField id={`${prefix}-var`} label="Özlük belgelerindeki sertifika">
          {(control) => (
            <NativeSelect
              {...control}
              value={existing}
              onChange={(event) => setExisting(event.target.value)}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="">Yeni dosya yükleyeceğim</NativeSelectOption>
              {choices.map((doc) => (
                <NativeSelectOption key={doc.id} value={doc.id}>
                  {`Sertifika · ${day(doc.documentDate)}`}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      ) : null}
      {existing === '' ? (
        <>
          <FileUploadField
            id={`${prefix}-dosya`}
            label="Sertifika dosyası (PDF, en çok 10 MB)"
            purpose="document"
            listLabel="Sertifika dosyası"
            items={files}
            disabled={link.isPending}
            onUploaded={(item) => setFiles([item])}
            onRemoved={() => setFiles([])}
            onBusyChange={setUploading}
            onBlockedChange={setBlocked}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <FormField id={`${prefix}-tarih`} label="Sertifika tarihi">
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  value={documentDate}
                  onChange={(event) => setDocumentDate(event.target.value)}
                  disabled={busy}
                />
              )}
            </FormField>
            <FormField id={`${prefix}-bitis`} label="Geçerlilik bitişi (isteğe bağlı)">
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  value={validUntil}
                  onChange={(event) => setValidUntil(event.target.value)}
                  disabled={busy}
                />
              )}
            </FormField>
          </div>
        </>
      ) : null}
      <p role={error ? 'alert' : undefined} className="text-sm text-destructive">
        {error ?? ''}
      </p>
      <Button
        type="submit"
        size="sm"
        className="justify-self-start"
        disabled={busy || blocked}
        aria-busy={link.isPending || undefined}
      >
        Sertifikayı bağla
      </Button>
    </form>
  )
}

/** Öğretmenin bağlanabilir gelişim hedefleri (K-489); hedefi olmayan personelde alan çıkmaz. */
export function useGoalOptions(enrollment: ProfessionalDevelopmentEnrollment, enabled: boolean) {
  const goals = useDevelopmentGoals(
    { ...GOAL_PAGE, teacherMembershipId: enrollment.membershipId },
    enabled && enrollment.staffRole === 'ogretmen',
  )
  return goalChoices(goals.data?.data ?? [], enrollment.developmentGoal?.id ?? null)
}
