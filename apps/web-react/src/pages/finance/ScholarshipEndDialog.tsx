import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { isReauthenticationRequired } from '@kampus/react-shared/reauthentication.ts'
import {
  useEndScholarship,
  useQuoteScholarshipEnd,
  type ScholarshipEndQuote,
} from '@kampus/react-shared/use-finance-scholarships.ts'
import {
  SCHOLARSHIP_END_REASON_LABELS,
  SCHOLARSHIP_TERMINATION_REASONS,
  scholarshipEndNotice,
  type ScholarshipTerminationReason,
} from '@kampus/school-core/lib/finance-scholarship-revocation.ts'
import { dateLabel, dayKey, money } from '@kampus/school-core/lib/format.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { useReauthRetry } from '@/auth/use-reauth-retry.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { interestBasis } from '@/lib/pdf/templates/finance-scholarship-end.ts'

export type ScholarshipEndTarget = {
  kind: 'terminate' | 'revoke'
  awardId: string
  version: number
  studentName: string
  programName: string
}

type Values = { reason: ScholarshipTerminationReason; effectiveDate: string; note: string }

const FORM = 'burs-karar-formu'
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const STATUS = {
  kept: 'Uygulandı',
  reinstated: 'Burs kalkar, yeni taksit',
  clawback: 'Geri istenir',
  already_reinstated: 'Önceki kesmede kalktı',
} as const

/**
 * Burs kesme ve gerçek dışı beyanla iptal penceresi (DOM-FIN-025; ON-283, K-264…K-266). Önce sunucu
 * hesabı gösterilir (`end-quote`): kalkan burs payları, geri istenen anapara ve kanuni faiz, veliye
 * gidecek bilgi metni. Onay önizlemedeki toplamla gider; hesap değiştiyse sunucu 409 verir ve
 * önizleme yenilenir. Komut taze oturum ister; parola penceresi işlem sonrası yeniden dener.
 */
export function ScholarshipEndDialog({
  target,
  onClose,
}: {
  target: ScholarshipEndTarget
  onClose: () => void
}) {
  const quote = useQuoteScholarshipEnd()
  const end = useEndScholarship()
  const { run, reauthModal } = useReauthRetry()
  const { session } = useAuth()
  const [today] = useState(() => dayKey(Date.now()))
  const [preview, setPreview] = useState<ScholarshipEndQuote | null>(null)
  const form = useForm<Values>({
    defaultValues: { reason: 'discipline', effectiveDate: today, note: '' },
  })
  const terminate = target.kind === 'terminate'
  const busy = quote.isPending || end.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const setError = (name: string, error: { type: string; message: string }) => {
    if (name === 'effectiveDate' || name === 'note' || name === 'reason')
      form.setError(name, error, { shouldFocus: true })
    else form.setError('root.server', error)
  }

  const onPreview = form.handleSubmit(async (values) => {
    const outcome = await quote.submit(
      {
        awardId: target.awardId,
        body: terminate
          ? { kind: 'terminate', effectiveDate: values.effectiveDate }
          : { kind: 'revoke' },
      },
      { setError },
    )
    if (outcome.status === 'success') setPreview(outcome.data.data)
  })

  const onConfirm = form.handleSubmit(async (values) => {
    if (preview === null) return
    const outcome = await run(() =>
      end.submit(
        terminate
          ? {
              kind: 'terminate',
              awardId: target.awardId,
              version: target.version,
              body: {
                reason: values.reason,
                note: values.note,
                effectiveDate: values.effectiveDate,
                confirmedCents: preview.totalCents,
              },
            }
          : {
              kind: 'revoke',
              awardId: target.awardId,
              version: target.version,
              body: { note: values.note, confirmedCents: preview.totalCents },
            },
        { silent: isReauthenticationRequired, setError },
      ),
    )
    if (outcome.status !== 'done') return
    const result = outcome.result
    if (result.status === 'success') {
      notify.success(terminate ? 'Burs kesildi.' : 'Burs iptal edildi, geri isteme yazıldı.')
      onClose()
    } else if (result.status === 'failed' && result.error.code === 'scholarship_end_changed')
      setPreview(null)
    else if (result.status === 'failed' && result.error.status === 409) onClose()
  })

  const notice =
    preview === null
      ? []
      : scholarshipEndNotice(preview, {
          programName: target.programName,
          studentName: target.studentName,
          reason: terminate ? form.getValues('reason') : 'false_declaration',
          institutionType: session?.institution.type,
        })

  return (
    <Modal
      open
      size="wide"
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={terminate ? 'Bursu kes' : 'Gerçek dışı beyan: iptal ve geri iste'}
      description={`${target.studentName} · ${target.programName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          {preview === null ? (
            <Button type="submit" form={FORM} disabled={busy} aria-busy={busy || undefined}>
              Hesabı göster
            </Button>
          ) : (
            <Button
              type="button"
              variant={terminate ? 'default' : 'destructive'}
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={() => void onConfirm()}
            >
              {terminate ? 'Bursu kes' : 'İptal et ve geri iste'}
            </Button>
          )}
        </>
      }
    >
      <form id={FORM} noValidate onSubmit={(event) => void onPreview(event)} className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          {terminate
            ? 'Kesme ileriye etkilidir: kesme gününden sonra vadesi gelen taksitlerde burs payı ayrı taksit olarak eklenir, önceki dönemde uygulanan burs geri istenmez.'
            : 'İptal geriye etkilidir: bugüne kadar uygulanan burs, her taksitin vade gününden bugüne kanuni faiziyle (3095 sayılı Kanun) ayrı alacak olarak geri istenir; sonraki taksitlerde burs kalkar.'}
        </p>
        {terminate ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="burs-kesme-neden" label="Kesme nedeni" error={errors.reason}>
              {(control) => (
                <NativeSelect
                  {...control}
                  {...form.register('reason', { onChange: () => setPreview(null) })}
                  className="w-full"
                  disabled={busy}
                >
                  {SCHOLARSHIP_TERMINATION_REASONS.map((reason) => (
                    <NativeSelectOption key={reason} value={reason}>
                      {SCHOLARSHIP_END_REASON_LABELS[reason]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField id="burs-kesme-gun" label="Kesme günü" error={errors.effectiveDate}>
              {(control) => (
                <Input
                  {...control}
                  {...form.register('effectiveDate', {
                    required: 'Kesme gününü seçin.',
                    onChange: () => setPreview(null),
                  })}
                  type="date"
                  min={today}
                  disabled={busy}
                />
              )}
            </FormField>
          </div>
        ) : null}
        <FormField
          id="burs-karar-gerekce"
          label={terminate ? 'Gerekçe' : 'Gerçek dışı beyanın açıklaması'}
          error={errors.note}
        >
          {(control) => (
            <Textarea
              {...control}
              {...form.register('note', {
                validate: (value) =>
                  value.trim().length >= 2 ? true : 'Gerekçeyi yazın (en az 2 karakter).',
              })}
              rows={3}
              maxLength={1000}
              disabled={busy}
            />
          )}
        </FormField>
        {errors.root?.server?.message ? (
          <p role="alert" className="text-sm text-danger">
            {errors.root.server.message}
          </p>
        ) : null}
      </form>
      {preview ? (
        <section aria-labelledby="burs-karar-onizleme" className="mt-5 grid gap-3">
          <h3 id="burs-karar-onizleme" className="text-base font-semibold">
            Hesap önizlemesi
          </h3>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Burs</dt>
              <dd className="font-medium">{money(preview.scholarshipCents)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Kalkan burs (yeni taksit)</dt>
              <dd className="font-medium">{money(preview.reinstatedCents)}</dd>
            </div>
            {terminate ? (
              <div>
                <dt className="text-muted-foreground">Uygulanmış, geri istenmez</dt>
                <dd className="font-medium">{money(preview.keptCents)}</dd>
              </div>
            ) : (
              <>
                <div>
                  <dt className="text-muted-foreground">Geri istenen anapara</dt>
                  <dd className="font-medium">{money(preview.principalCents)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Kanuni faiz</dt>
                  <dd className="font-medium">{money(preview.interestCents)}</dd>
                </div>
              </>
            )}
          </dl>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Burs payının vadeleri</caption>
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Vade
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Burs payı
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Durum
                  </th>
                  <th scope="col" className="py-1 font-medium">
                    Faiz
                  </th>
                </tr>
              </thead>
              <tbody>
                {preview.lines.map((line) => (
                  <tr key={line.dueDate} className="border-t">
                    <td className="py-1 pr-3">{dayText(line.dueDate)}</td>
                    <td className="py-1 pr-3">{money(line.shareCents)}</td>
                    <td className="py-1 pr-3">{STATUS[line.status]}</td>
                    <td className="py-1">
                      {line.status === 'clawback'
                        ? `${money(line.interestCents)} (${interestBasis(line)})`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.fullScholarship ? (
            <p className="text-sm text-muted-foreground">
              Tam bursta taksit olmadığı için burs Eylül–Haziran on aya eşit dağıtıldı.
            </p>
          ) : null}
          <div className="rounded-control border bg-surface-soft p-3 text-sm">
            <p className="mb-1 font-medium">Veliye bilgi metni</p>
            {notice.map((paragraph) => (
              <p key={paragraph} className="mt-1">
                {paragraph}
              </p>
            ))}
          </div>
          <p className="text-sm font-semibold">Yeni alacak toplamı: {money(preview.totalCents)}</p>
        </section>
      ) : null}
      {reauthModal}
    </Modal>
  )
}
