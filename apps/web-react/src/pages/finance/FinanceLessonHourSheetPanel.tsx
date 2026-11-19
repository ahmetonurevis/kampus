import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  useApproveLessonHourSheet,
  useRecordLessonHourConfirmation,
  useReopenLessonHourSheet,
  useSubmitLessonHourSheet,
  type LessonHourSheet,
  type LessonHourSheetStaff,
} from '@kampus/react-shared/use-finance-lesson-hour-sheets.ts'
import {
  LESSON_CONFIRMATION_CHANNEL_LABELS,
  LESSON_CONFIRMATION_CHANNELS,
  LESSON_SHEET_STATUS_LABELS,
  LESSON_TEACHER_STATE_LABELS,
  type LessonConfirmationOutcome,
} from '@kampus/school-core/lib/finance-lesson-hour-approvals.ts'
import { payrollMonthLabel } from '@kampus/school-core/lib/finance-payroll-periods.ts'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import {
  confirmationBody,
  confirmationDefaults,
  confirmationFormSchema,
  disputeFormSchema,
  reopenFormSchema,
  responseText,
  SHEET_STATUS_TONES,
  sheetActions,
  sheetTimeline,
  TEACHER_STATE_TONES,
  type ConfirmationFormValues,
} from './finance-lesson-sheet-forms.ts'

type Dialog =
  | { kind: 'respond'; staff: LessonHourSheetStaff; outcome: LessonConfirmationOutcome }
  | { kind: 'approve' }
  | { kind: 'reopen' }
  | null

/**
 * Ek ders çizelgesi onayı (DOM-FIN-120; ON-196): "Bordro aktarımı" sekmesindeki ek ders bölümü.
 * Taslak öğretmen kontrolüne gönderilir; öğretmen ekranı olmadığı için teyit ya da itiraz öğretmen
 * adına kanalıyla işlenir (K-409); her personel güncel saatlerini teyit edince müdür onayı ayı
 * kilitler, yeniden açma gerekçe ister (K-410). Onaysız ayın ek dersi dosyada "onay bekliyor"dur
 * (K-411).
 */
export function FinanceLessonHourSheetPanel({ sheet }: { sheet: LessonHourSheet }) {
  const [dialog, setDialog] = useState<Dialog>(null)
  const submit = useSubmitLessonHourSheet()
  const actions = sheetActions(sheet)
  const timeline = sheetTimeline(sheet)
  const label = payrollMonthLabel(sheet.month)
  const close = () => setDialog(null)

  async function send() {
    const outcome = await submit.submit({ month: sheet.month })
    if (outcome.status === 'success') notify.success('Çizelge öğretmen kontrolüne gönderildi.')
  }

  return (
    <section aria-labelledby="ek-ders-cizelgesi" className="grid gap-3 rounded-sm border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          <h3 id="ek-ders-cizelgesi" className="text-base font-semibold">
            Ek ders çizelgesi onayı
          </h3>
          <p className="text-sm text-muted-foreground">
            Bordroya yalnız müdür onaylı ayın ek dersi girer; onaysız saat dosyada “onay bekliyor”
            olarak, tutarsız yer alır.
          </p>
        </div>
        <StatusBadge
          text={LESSON_SHEET_STATUS_LABELS[sheet.status]}
          tone={SHEET_STATUS_TONES[sheet.status]}
        />
      </div>
      {sheet.payrollLocked ? (
        <p role="note" className="text-sm text-warning">
          {label} bordro dönemi kilitli; ek ders saati ve çizelge değiştirilemez. Fark için bordro
          dönemlerinde düzeltme kaydı girin.
        </p>
      ) : null}
      {timeline.length > 0 ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {timeline.map(([term, value]) => (
            <div key={term} className="contents">
              <dt className="text-muted-foreground">{term}</dt>
              <dd className="[overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {sheet.staff.length === 0 ? (
        <p className="text-sm text-muted-foreground">Bu ay ek ders saati girilmedi.</p>
      ) : (
        <ul aria-label="Öğretmen teyitleri" className="grid gap-2">
          {sheet.staff.map((staff) => (
            <li
              key={staff.membershipId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-sm border px-3 py-2 text-sm"
            >
              <span className="grid gap-1">
                <span className="font-medium">
                  {staff.staffActive ? staff.staffName : `${staff.staffName} (pasif)`} ·{' '}
                  {String(staff.totalHours)} saat
                </span>
                <span className="text-muted-foreground">{responseText(staff)}</span>
                {staff.lastResponse?.reason ? (
                  <span className="[overflow-wrap:anywhere]">
                    Gerekçe: {staff.lastResponse.reason}
                  </span>
                ) : null}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  text={LESSON_TEACHER_STATE_LABELS[staff.state]}
                  tone={TEACHER_STATE_TONES[staff.state]}
                />
                {actions.canRespond ? (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`${staff.staffName} teyidini kaydet`}
                      onClick={() => setDialog({ kind: 'respond', staff, outcome: 'confirmed' })}
                    >
                      Teyit alındı
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`${staff.staffName} itirazını kaydet`}
                      onClick={() => setDialog({ kind: 'respond', staff, outcome: 'disputed' })}
                    >
                      İtiraz
                    </Button>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {sheet.status === 'draft' ? (
          <Button
            disabled={!actions.canSubmit || submit.isPending}
            aria-busy={submit.isPending || undefined}
            onClick={() => void send()}
          >
            Öğretmen kontrolüne gönder
          </Button>
        ) : null}
        {sheet.status === 'teacher_review' ? (
          <>
            <Button disabled={!actions.canApprove} onClick={() => setDialog({ kind: 'approve' })}>
              Müdür onayı ver
            </Button>
            {actions.unconfirmed > 0 ? (
              <span className="text-sm text-muted-foreground">
                {String(actions.unconfirmed)} personelin teyidi bekleniyor.
              </span>
            ) : null}
          </>
        ) : null}
        {sheet.status === 'approved' ? (
          <Button
            variant="secondary"
            disabled={!actions.canReopen}
            onClick={() => setDialog({ kind: 'reopen' })}
          >
            Çizelgeyi yeniden aç
          </Button>
        ) : null}
      </div>
      {dialog?.kind === 'respond' ? (
        <ResponseModal
          month={sheet.month}
          staff={dialog.staff}
          outcome={dialog.outcome}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === 'approve' ? <ApproveModal sheet={sheet} onClose={close} /> : null}
      {dialog?.kind === 'reopen' ? <ReopenModal month={sheet.month} onClose={close} /> : null}
    </section>
  )
}

/** Öğretmen adına teyit ya da itiraz (K-409): kanal; itirazda gerekçe. */
function ResponseModal({
  month,
  staff,
  outcome,
  onClose,
}: {
  month: string
  staff: LessonHourSheetStaff
  outcome: LessonConfirmationOutcome
  onClose: () => void
}) {
  const record = useRecordLessonHourConfirmation()
  const disputed = outcome === 'disputed'
  const form = useForm<ConfirmationFormValues>({
    resolver: zodResolver(disputed ? disputeFormSchema : confirmationFormSchema),
    defaultValues: confirmationDefaults(),
  })
  const errors = form.formState.errors
  const busy = record.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const result = await record.submit(
      confirmationBody(month, staff.membershipId, outcome, values),
      {
        setError: (name, error) => {
          if (name === 'channel' || name === 'reason')
            form.setError(name, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (result.status !== 'success') return
    notify.success(
      disputed ? 'İtiraz kaydedildi; çizelge taslağa döndü.' : 'Öğretmen teyidi kaydedildi.',
    )
    onClose()
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={disputed ? 'Öğretmen itirazı' : 'Öğretmen teyidi'}
      description={`${staff.staffName} · ${String(staff.totalHours)} saat. Öğretmen adına, yanıtın alındığı kanalla kaydedilir.`}
    >
      <form
        noValidate
        aria-label={disputed ? 'Öğretmen itirazı' : 'Öğretmen teyidi'}
        className="grid gap-3"
        onSubmit={(event) => void onSubmit(event)}
      >
        <FormField id="ek-ders-kanal" label="Kanal" error={errors.channel}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('channel')}
              className="w-full"
              disabled={busy}
            >
              {LESSON_CONFIRMATION_CHANNELS.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {LESSON_CONFIRMATION_CHANNEL_LABELS[value]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        {disputed ? (
          <FormField id="ek-ders-itiraz" label="İtiraz gerekçesi" error={errors.reason}>
            {(control) => (
              <Textarea {...control} {...form.register('reason')} rows={3} disabled={busy} />
            )}
          </FormField>
        ) : null}
        <RootError message={errors.root?.server?.message} />
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
            Kaydet
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** Müdür onayı (K-410): ekrandaki çizelgenin damgası gönderilir; saat değiştiyse sunucu reddeder. */
function ApproveModal({ sheet, onClose }: { sheet: LessonHourSheet; onClose: () => void }) {
  const approve = useApproveLessonHourSheet()
  const [error, setError] = useState<string | undefined>(undefined)
  const label = payrollMonthLabel(sheet.month)
  const total = sheet.staff.reduce((sum, item) => sum + item.totalHours, 0)
  async function confirm() {
    setError(undefined)
    const outcome = await approve.submit(
      { month: sheet.month, entriesHash: sheet.entriesHash },
      { setError: (_name, issue) => setError(issue.message) },
    )
    if (outcome.status === 'success') {
      notify.success(`${label} ek ders çizelgesi onaylandı ve kilitlendi.`)
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'lesson_hours_changed')
      onClose()
  }
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={`${label} ek ders çizelgesini onayla`}
      description="Onaydan sonra bu ayın ek ders saati değiştirilemez; saatler bordro dosyasına tutarıyla girer."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={approve.isPending}>
            Vazgeç
          </Button>
          <Button
            onClick={() => void confirm()}
            disabled={approve.isPending}
            aria-busy={approve.isPending || undefined}
          >
            Onayla ve kilitle
          </Button>
        </>
      }
    >
      <div className="grid gap-3 text-sm">
        <p>
          {String(sheet.staff.length)} personel · toplam {String(total)} saat · her personel teyit
          etti.
        </p>
        <RootError message={error} />
      </div>
    </Modal>
  )
}

/** Yeniden açma (K-410): gerekçe zorunlu; çizelge taslağa döner. */
function ReopenModal({ month, onClose }: { month: string; onClose: () => void }) {
  const reopen = useReopenLessonHourSheet()
  const label = payrollMonthLabel(month)
  const form = useForm<{ reason: string }>({
    resolver: zodResolver(reopenFormSchema),
    defaultValues: { reason: '' },
  })
  const errors = form.formState.errors
  const busy = reopen.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await reopen.submit(
      { month, reason: values.reason.trim() },
      {
        setError: (name, error) => {
          if (name === 'reason') form.setError('reason', error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status !== 'success') return
    notify.success(`${label} ek ders çizelgesi yeniden açıldı.`)
    onClose()
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={`${label} ek ders çizelgesini yeniden aç`}
      description="Kilit kalkar; saatler düzeltildikten sonra çizelge yeniden gönderilip onaylanmalıdır."
    >
      <form
        noValidate
        aria-label="Çizelge yeniden açma gerekçesi"
        className="grid gap-3"
        onSubmit={(event) => void onSubmit(event)}
      >
        <FormField id="ek-ders-yeniden-ac" label="Gerekçe" error={errors.reason}>
          {(control) => (
            <Textarea {...control} {...form.register('reason')} rows={3} disabled={busy} />
          )}
        </FormField>
        <RootError message={errors.root?.server?.message} />
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" variant="destructive" disabled={busy} aria-busy={busy || undefined}>
            Yeniden aç
          </Button>
        </div>
      </form>
    </Modal>
  )
}
