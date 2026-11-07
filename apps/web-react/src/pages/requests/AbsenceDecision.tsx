import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useApproveAbsence, useRejectAbsence } from '@kampus/react-shared/use-request-commands.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
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
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { SummarySection } from '../management/SummaryParts.tsx'
import { RootError } from '../management/FormParts.tsx'
import {
  ABSENCE_REJECT_REASON_MAX_LENGTH,
  rejectFormSchema,
  type RejectFormValues,
} from './absence-forms.ts'
import { focusFirstError } from './request-forms.ts'
import type { AbsenceRow } from './request-rows.ts'

/**
 * Yönetici kararı (DOM-ILT-053; Sabah kararı 71): ana işlem "Onayla" görünür, "Reddet" sakin
 * ikincil düğmedir ve gerekçe alanını açar. Karar bir kez verilir: onay kalıcıdır ve bu yüzden
 * onaylanır; ikinci karar sunucuda 409 `absence_already_decided` olur (Türkçe toast, kayıt
 * tazelenir). Red gerekçesi yalnız denetim kaydına yazılır, veli görmez (Sabah kararı 72). Okunan
 * sürüm `If-Match` olarak gider.
 */
export function AbsenceDecision({ row }: { row: AbsenceRow }) {
  const approve = useApproveAbsence()
  const [confirming, setConfirming] = useState(false)
  const [rejecting, setRejecting] = useState(false)

  async function confirmApprove() {
    const outcome = await approve.submit({ absenceId: row.id, version: row.version })
    if (outcome.status === 'busy') return
    // Başarıda ve karar çakışmasında kayıt tazelenir; pencere kapanır.
    setConfirming(false)
    if (outcome.status === 'success') notify.success('Bildirim onaylandı.')
  }

  return (
    <SummarySection title="Karar">
      <p className="mb-4 text-sm text-muted-foreground">
        Karar bir kez verilir. Belge zorunlu değildir; belgeyi kâğıtta alan idare de onaylayabilir.
        Red gerekçesi yalnız denetim kaydına yazılır, veli göremez.
      </p>
      {rejecting ? (
        <RejectForm row={row} onCancel={() => setRejecting(false)} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={() => setConfirming(true)}>
            <Icon name="Check" size={17} aria-hidden="true" />
            Onayla
          </Button>
          <Button type="button" variant="ghost" onClick={() => setRejecting(true)}>
            Reddet…
          </Button>
        </div>
      )}
      <AlertDialog open={confirming} onOpenChange={(open) => setConfirming(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bildirimi onayla</AlertDialogTitle>
            <AlertDialogDescription>
              {`${row.student || 'Öğrenci'} için ${row.range} tarihli bildirimin günleri yoklamada özürlü sayılır. Karar sonradan değiştirilemez.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={approve.isPending}>Vazgeç</AlertDialogCancel>
            <AlertDialogAction
              disabled={approve.isPending}
              aria-busy={approve.isPending || undefined}
              onClick={(event) => {
                // Pencere sonuç gelene kadar açık kalır; kapanışı `confirmApprove` yönetir.
                event.preventDefault()
                void confirmApprove()
              }}
            >
              Onayla
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SummarySection>
  )
}

function RejectForm({ row, onCancel }: { row: AbsenceRow; onCancel: () => void }) {
  const reject = useRejectAbsence()
  const form = useForm<RejectFormValues, unknown, RejectFormValues>({
    resolver: zodResolver(rejectFormSchema),
    defaultValues: { reason: '' },
  })
  const busy = reject.isPending || form.formState.isSubmitting
  const errors = form.formState.errors

  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await reject.submit(
      { absenceId: row.id, version: row.version, body: { reason: values.reason } },
      { setError: focusFirstError(form.setError) },
    )
    if (outcome.status === 'success') notify.success('Bildirim reddedildi.')
  })

  return (
    <form
      noValidate
      aria-label="Bildirimi reddet"
      onSubmit={(event) => void onSubmit(event)}
      className="grid gap-4"
    >
      <FormField
        id="mazeret-red-gerekce"
        label="Red gerekçesi"
        description="Gerekçe yalnız denetim kaydına yazılır; veli yalnız bildirimin onaylanmadığını görür."
        error={errors.reason}
      >
        {(control) => (
          <Textarea
            {...control}
            {...form.register('reason')}
            rows={3}
            maxLength={ABSENCE_REJECT_REASON_MAX_LENGTH}
            disabled={busy}
          />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Vazgeç
        </Button>
        <Button type="submit" variant="destructive" disabled={busy} aria-busy={busy || undefined}>
          Reddet
        </Button>
      </div>
    </form>
  )
}
