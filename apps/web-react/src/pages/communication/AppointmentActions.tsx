import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useUpdateAppointment } from '@kampus/react-shared/use-appointment-commands.ts'
import type { AppointmentTransition } from '@kampus/school-core/lib/appointments.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummarySection } from '../management/SummaryParts.tsx'
import { focusFirstError } from '../requests/request-forms.ts'
import {
  APPOINTMENT_REASON_MAX_LENGTH,
  REASON_TRANSITIONS,
  TRANSITION_TOASTS,
  reasonLabel,
  transitionBody,
} from './appointment-forms.ts'
import type { AppointmentRow } from './appointment-rows.ts'

/** `status` sunucu yolunun alanıdır (yanlış geçiş, çakışma, geçmiş saat); formda girdisi yoktur. */
type ActionValues = { reason: string; status?: string }

type Props = {
  /** Sorgudaki güncel satır; formun kendi tabanı değil, yalnız tazelenme sinyalidir. */
  row: AppointmentRow
  /** Güncel randevuyu yeniden okur; gönderim ve çakışma sonrası eylemler bununla tazelenir. */
  reload: () => Promise<AppointmentRow | null>
}

/**
 * Randevu işlemleri: öğretmen onaylar ya da gerekçeyle reddeder, onaylı randevuyu gerekçeyle iptal
 * eder; talep eden bekleyen talebini geri çeker, onaylı randevusunu gerekçeyle iptal eder
 * (DOM-ILT-102). Hangi düğmenin göründüğü satırdan türer (`appointmentActions`); karar sunucudadır.
 *
 * `If-Match` formun kurulduğu (ya da son tazelendiği) andaki sürümdür (`base`, W16b deseni): sorgu
 * arkadan yeni sürüm getirse bile gerekçe yazmaya başlanmış (kirli) form eski sürümle gönderir ve
 * sunucu 409 verir; kullanıcı güncel randevuyu görmeden karar vermez. Temiz form yeni sürüme
 * sessizce geçer. 409'da Türkçe toast çıkar, randevu yeniden okunur ve yazılan gerekçe korunur;
 * işlem artık yapılamıyorsa (ör. talep bu arada geri çekildi) form yerine bir not ve gerekçenin
 * salt okunur kopyası görünür. Sunucunun alan hataları (çakışma, geçmiş saat) düğmelerin üstünde
 * tek yerde görünür; toast çıkmaz.
 */
export function AppointmentActions({ row, reload }: Props) {
  const update = useUpdateAppointment()
  const [base, setBase] = useState<AppointmentRow>(row)
  const [confirming, setConfirming] = useState(false)
  const form = useForm<ActionValues>({ defaultValues: { reason: '' } })
  const reason = useWatch({ control: form.control, name: 'reason' })
  const busy = update.isPending || form.formState.isSubmitting
  const dirty = form.formState.isDirty
  const errors = form.formState.errors

  // Sorgu arkadan yeni sürüm getirdiyse ve kullanıcı forma dokunmadıysa taban sessizce yenilenir
  // (render sırasında kendi state'inin ayarlanması); kirli form eski tabanda kalır.
  if (row.version !== base.version && !dirty) setBase(row)

  const actions = base.actions
  const needsReason = actions.includes('reject') || actions.includes('cancel')

  async function run(status: AppointmentTransition) {
    form.clearErrors()
    const outcome = transitionBody(status, REASON_TRANSITIONS.includes(status) ? reason : '')
    if (!outcome.ok) {
      form.setError('reason', { type: 'manual', message: outcome.message }, { shouldFocus: true })
      return
    }
    const result = await update.submit(
      { appointmentId: base.id, version: base.version, body: outcome.body },
      { setError: focusFirstError(form.setError) },
    )
    if (result.status === 'busy') return
    setConfirming(false)
    if (result.status === 'success') {
      notify.success(TRANSITION_TOASTS[status])
      form.reset({ reason: '' })
    }
    // Başarıda yeni sürüm, 409'da güncel randevu okunur; gerekçe korunur (sessiz üzerine yazma yok).
    if (result.status === 'success' || result.error.status === 409) {
      const fresh = await reload()
      if (fresh) setBase(fresh)
    }
  }

  if (actions.length === 0) {
    if (reason.trim() !== '')
      return (
        <SummarySection title="İşlemler">
          <p role="status" className="flex items-start gap-2 text-sm text-muted-foreground">
            <Icon name="Info" size={17} aria-hidden="true" className="mt-0.5 shrink-0" />
            Randevunun durumu bu arada değişti ({base.status}); işlem gönderilemedi.
          </p>
          <div className="mt-3">
            <FormField
              id="randevu-gerekce-gonderilmedi"
              label="Yazdığınız gerekçe (gönderilmedi)"
              description="Gerekçe kaydedilmedi; gerekirse kopyalayabilirsiniz."
            >
              {(control) => <Textarea {...control} value={reason} readOnly rows={4} />}
            </FormField>
          </div>
        </SummarySection>
      )
    return base.closed ? (
      <SummarySection title="İşlemler">
        <p role="status" className="text-sm text-muted-foreground">
          Sonuçlanmış randevu değiştirilemez; geçmişi yukarıda görünür.
        </p>
      </SummarySection>
    ) : null
  }

  return (
    <SummarySection title="İşlemler">
      <form
        noValidate
        aria-label="Randevu işlemleri"
        onSubmit={(event) => event.preventDefault()}
        className="grid gap-4"
      >
        {needsReason ? (
          <FormField
            id="randevu-gerekce"
            label={reasonLabel(actions)}
            description={`Gerekçe randevu geçmişine yazılır. En çok ${APPOINTMENT_REASON_MAX_LENGTH} karakter.`}
            error={errors.reason}
          >
            {(control) => (
              <Textarea {...control} {...form.register('reason')} rows={4} disabled={busy} />
            )}
          </FormField>
        ) : null}
        <RootError message={errors.status?.message ?? errors.root?.server?.message} />
        <div className="flex flex-wrap justify-end gap-2">
          {actions.includes('reject') ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => void run('Reddedildi')}
              disabled={busy}
            >
              <Icon name="X" size={17} aria-hidden="true" />
              Reddet
            </Button>
          ) : null}
          {actions.includes('approve') ? (
            <Button
              type="button"
              onClick={() => void run('Onaylandı')}
              disabled={busy}
              aria-busy={busy || undefined}
            >
              <Icon name="Check" size={17} aria-hidden="true" />
              Onayla
            </Button>
          ) : null}
          {actions.includes('cancel') ? (
            <Button
              type="button"
              variant="destructive"
              onClick={() => void run('İptal')}
              disabled={busy}
              aria-busy={busy || undefined}
            >
              Randevuyu iptal et
            </Button>
          ) : null}
          {actions.includes('withdraw') ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming(true)}
              disabled={busy}
            >
              <Icon name="Undo2" size={16} aria-hidden="true" />
              Talebi geri çek
            </Button>
          ) : null}
        </div>
      </form>
      <Modal
        open={confirming}
        onOpenChange={(open) => (open || busy ? undefined : setConfirming(false))}
        title="Talebi geri çek"
        description="Talep onaylanmadan geri çekilirse öğretmenin bekleyen taleplerinden çıkar ve saat yeniden alınabilir olur. Bu işlem geri alınamaz."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>
              Vazgeç
            </Button>
            <Button
              variant="destructive"
              onClick={() => void run('Geri çekildi')}
              disabled={busy}
              aria-busy={busy || undefined}
            >
              Evet, geri çek
            </Button>
          </>
        }
      >
        <p className="text-sm [overflow-wrap:anywhere]">
          {base.type} · {base.when}
        </p>
      </Modal>
    </SummarySection>
  )
}
