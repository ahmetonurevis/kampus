import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import {
  certificateErrorField,
  isStaffCertificate,
  useCancelCourseCertificate,
  useCourseCertificate,
  useIssueCourseCertificate,
  useRecordMebbisCertificate,
} from '@kampus/react-shared/use-course-certificates.ts'
import {
  CANCELLATION_REASON_MAX,
  certificateCancelInputSchema,
  MEBBIS_NUMBER_MAX,
  mebbisRecordInputSchema,
  type CertificateCancelInput,
  type MebbisRecordInput,
} from '@kampus/school-core/cefr/certificates.ts'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { FormActions, RootError } from '../management/FormParts.tsx'
import { RECORD_UNAVAILABLE_MESSAGE, submitWithFreshRecord } from './fresh-submit.ts'
import { useDiscardGuard, useReportDirty } from './use-discard-guard.tsx'

// Kurum başarı belgesi pencereleri (OG-088; IST-081): düzenleme onayı (DOM-DIL-081), gerekçeli
// iptal (DOM-DIL-082, `If-Match`) ve MEBBİS izi (DOM-DIL-080). Yetki ve kural sunucudadır; hata
// metinleri `CERTIFICATE_MESSAGES`'tan gelir.

/** Düzenlenecek belge: kaydın güncel onaylı kararı; yeniden düzenlemede iptal edilen belge. */
export type IssueTarget = {
  decisionId: string
  learner: string
  replacesCertificateId: string | null
  /** Yerine düzenlenen belgenin numarası (yeniden düzenlemede). */
  replacesNumber: string
}

/** Belge düzenleme onayı: içerik düzenleme anında dondurulur, sonradan değişmez. */
export function IssueCertificateDialog({
  target,
  onClose,
}: {
  target: IssueTarget | null
  onClose: () => void
}) {
  const issue = useIssueCourseCertificate()
  const reissue = target?.replacesCertificateId != null

  async function confirm() {
    if (!target) return
    const outcome = await issue.submit({
      decisionId: target.decisionId,
      replacesCertificateId: target.replacesCertificateId,
    })
    if (outcome.status === 'success') {
      notify.success(`${target.learner} için belge ${outcome.data.data.number} düzenlendi.`)
      onClose()
    } else if (outcome.status === 'failed') {
      // Hata metni toast'ta; liste tazelendiği için pencere kapanır.
      onClose()
    }
  }

  return (
    <AlertDialog open={target !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {reissue ? 'Belgeyi yeniden düzenle' : 'Belge düzenle'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {target
              ? reissue
                ? `${target.learner} için iptal edilen ${target.replacesNumber} yerine yeni kurum başarı belgesi düzenlenecek. Belge içeriği kaydın güncel onaylı kararından alınır ve sonradan değişmez.`
                : `${target.learner} için kurum başarı belgesi düzenlenecek. Belge içeriği onaylı kur sonu kararından alınır ve sonradan değişmez.`
              : ''}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={issue.isPending}>Vazgeç</AlertDialogCancel>
          <AlertDialogAction
            disabled={issue.isPending}
            aria-busy={issue.isPending || undefined}
            onClick={(event) => {
              // Pencere sonuç gelene kadar açık kalır; kapanışı `confirm` yönetir.
              event.preventDefault()
              void confirm()
            }}
          >
            {reissue ? 'Yeniden düzenle' : 'Belgeyi düzenle'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export type CancelTarget = { id: string; number: string; learner: string }

/** Belgeyi gerekçeyle iptal et; numara ve kod değişmez, doğrulama "iptal edildi" döner. */
export function CancelCertificateModal({
  target,
  onClose,
}: {
  target: CancelTarget | null
  onClose: () => void
}) {
  const guard = useDiscardGuard(onClose)
  return (
    <>
      <Modal
        open={target !== null}
        onOpenChange={(open) => (open ? undefined : guard.requestClose())}
        title="Belgeyi iptal et"
        description="İptal geri alınmaz; gerekçe kayda geçer ve doğrulamada belge iptal görünür."
      >
        {target ? (
          <CancelForm
            key={target.id}
            target={target}
            onCancel={guard.requestClose}
            onDone={guard.closeClean}
            setDirty={guard.setDirty}
          />
        ) : null}
      </Modal>
      {guard.dialog}
    </>
  )
}

type FormProps<T> = {
  target: T
  onCancel: () => void
  onDone: () => void
  setDirty: (dirty: boolean) => void
}

function CancelForm({ target, onCancel, onDone, setDirty }: FormProps<CancelTarget>) {
  const cancel = useCancelCourseCertificate()
  const item = useCourseCertificate(target.id)
  const form = useForm<CertificateCancelInput>({
    resolver: zodResolver(certificateCancelInputSchema),
    defaultValues: { reason: '' },
  })
  useReportDirty(form.formState.isDirty, setDirty)
  const busy = cancel.isPending || form.formState.isSubmitting
  const submit = form.handleSubmit(async (body) => {
    // Sürüm gönderim anında kimlikle yeniden okunur (`If-Match`); liste kopyası bayat olabilir.
    const result = await submitWithFreshRecord(
      async () => {
        const fresh = (await item.refetch()).data?.data
        return fresh && isStaffCertificate(fresh) && fresh.status === 'valid' ? fresh : undefined
      },
      (fresh) =>
        cancel.submit(
          { certificateId: fresh.id, version: fresh.rowVersion, body },
          { setError: form.setError },
        ),
    )
    if (result.status === 'missing') {
      notify.error(RECORD_UNAVAILABLE_MESSAGE)
      onDone()
      return
    }
    if (result.outcome.status === 'success') {
      notify.success(`${target.number} iptal edildi.`)
      onDone()
    }
  })
  return (
    <form
      noValidate
      aria-label="Belgeyi iptal et"
      onSubmit={(event) => void submit(event)}
      className="grid gap-5"
    >
      <p className="text-sm">
        <strong className="font-semibold">{target.number}</strong> ({target.learner}) iptal
        edilecek. Hata varsa iptalden sonra yerine yeni belge düzenlenir.
      </p>
      <FormField id="belge-iptal-gerekce" label="Gerekçe" error={form.formState.errors.reason}>
        {(control) => (
          <Textarea
            {...control}
            {...form.register('reason')}
            maxLength={CANCELLATION_REASON_MAX}
            rows={4}
            disabled={busy}
          />
        )}
      </FormField>
      <RootError message={form.formState.errors.root?.server?.message} />
      <FormActions busy={busy} onCancel={onCancel} submitLabel="Belgeyi iptal et" />
    </form>
  )
}

export type MebbisTarget = { decisionId: string; learner: string }

/** Resmî Kurs Bitirme Belgesinin MEBBİS'te düzenlendiğini işaretle (platform belgeyi üretmez). */
export function MebbisRecordModal({
  target,
  onClose,
}: {
  target: MebbisTarget | null
  onClose: () => void
}) {
  const guard = useDiscardGuard(onClose)
  return (
    <>
      <Modal
        open={target !== null}
        onOpenChange={(open) => (open ? undefined : guard.requestClose())}
        title="MEBBİS'te düzenlendi"
        description="Resmî belge MEBBİS'te düzenlenir; burada yalnız numarası ve tarihi kaydedilir."
      >
        {target ? (
          <MebbisForm
            key={target.decisionId}
            target={target}
            onCancel={guard.requestClose}
            onDone={guard.closeClean}
            setDirty={guard.setDirty}
          />
        ) : null}
      </Modal>
      {guard.dialog}
    </>
  )
}

function MebbisForm({ target, onCancel, onDone, setDirty }: FormProps<MebbisTarget>) {
  const record = useRecordMebbisCertificate()
  const form = useForm<MebbisRecordInput>({
    resolver: zodResolver(mebbisRecordInputSchema),
    defaultValues: { certificateNumber: '', issuedDate: '' },
  })
  useReportDirty(form.formState.isDirty, setDirty)
  const busy = record.isPending || form.formState.isSubmitting
  const submit = form.handleSubmit(async (body) => {
    const outcome = await record.submit(
      { decisionId: target.decisionId, body },
      { setError: form.setError, fieldFor: certificateErrorField },
    )
    if (outcome.status === 'success') {
      notify.success(`${target.learner} için MEBBİS belgesi işaretlendi.`)
      onDone()
    }
  })
  return (
    <form
      noValidate
      aria-label="MEBBİS belgesini işaretle"
      onSubmit={(event) => void submit(event)}
      className="grid gap-5"
    >
      <p className="text-sm">
        <strong className="font-semibold">{target.learner}</strong> için MEBBİS'te düzenlenen Kurs
        Bitirme Belgesinin bilgilerini girin.
      </p>
      <FormField
        id="mebbis-belge-no"
        label="MEBBİS belge numarası"
        error={form.formState.errors.certificateNumber}
      >
        {(control) => (
          <Input
            {...control}
            {...form.register('certificateNumber')}
            maxLength={MEBBIS_NUMBER_MAX}
            autoComplete="off"
            disabled={busy}
          />
        )}
      </FormField>
      <FormField
        id="mebbis-belge-tarihi"
        label="Belge tarihi"
        error={form.formState.errors.issuedDate}
      >
        {(control) => (
          <Input {...control} {...form.register('issuedDate')} type="date" disabled={busy} />
        )}
      </FormField>
      <RootError message={form.formState.errors.root?.server?.message} />
      <FormActions busy={busy} onCancel={onCancel} submitLabel="İşaretle" />
    </form>
  )
}
