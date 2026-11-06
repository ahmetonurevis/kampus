import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {
  useEndStudentService,
  useStudentServiceQuote,
  useStudentServices,
  useSubscribeStudentService,
  type StudentServiceItem,
} from '@kampus/react-shared/use-finance-student-services.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  STUDENT_SERVICE_KINDS,
  STUDENT_SERVICE_STATUS_LABELS,
  studentServiceFormSchema,
  studentServiceFormToBody,
  studentServiceKindLabel,
  type StudentServiceFormValues,
  type StudentServiceQuote,
} from '@kampus/school-core/lib/finance-student-services.ts'
import { dateLabel, dayKey, money } from '@kampus/school-core/lib/format.ts'
import { amountInputValue, parseAmountInput } from '@kampus/school-core/lib/payments.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { notify } from '@/lib/notify.ts'

const SUBSCRIBE_FORM = 'ek-hizmet-formu'
const END_FORM = 'ek-hizmet-cikis-formu'
const PAGE_SIZE = 50
const dayText = (day: string) => dateLabel(day, { year: 'numeric' })

/**
 * Öğrencinin ek hizmetleri (DOM-FIN-003, ON-087): taksit panelinin altında. Yönetici ve ön büro
 * yazar ve çıkarır, veli ve öğrenci yalnız görür. Tutar tarifeden önerilir, personel düşürebilir (K-17).
 */
export function StudentServicesSection({ studentId }: { studentId: string }) {
  const { session } = useAuth()
  const canManage = session?.role === 'yonetici' || session?.role === 'onburo'
  const query = useStudentServices({ studentId, pageSize: PAGE_SIZE })
  const [subscribing, setSubscribing] = useState(false)
  const [ending, setEnding] = useState<StudentServiceItem | null>(null)
  const items = query.data?.data
  return (
    <section aria-labelledby="ek-hizmetler" className="mt-6 border-t pt-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 id="ek-hizmetler" className="text-base font-semibold">
          Ek hizmetler
        </h3>
        {canManage ? (
          <Button variant="secondary" onClick={() => setSubscribing(true)}>
            Ek hizmete yaz
          </Button>
        ) : null}
      </div>
      {query.error ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : !items ? (
        <p role="status" className="text-sm text-muted-foreground">
          Ek hizmetler yükleniyor…
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ek hizmet aboneliği yok.</p>
      ) : (
        <ul className="grid gap-3">
          {items.map((item) => (
            <ServiceRow
              key={item.id}
              item={item}
              onEnd={canManage && item.status === 'active' ? () => setEnding(item) : null}
            />
          ))}
        </ul>
      )}
      {subscribing ? (
        <SubscribeModal studentId={studentId} onClose={() => setSubscribing(false)} />
      ) : null}
      {ending ? <EndModal item={ending} onClose={() => setEnding(null)} /> : null}
    </section>
  )
}

function ServiceRow({ item, onEnd }: { item: StudentServiceItem; onEnd: (() => void) | null }) {
  const label = studentServiceKindLabel(item.kind)
  const period = item.endedDate ?? item.endDate
  return (
    <li className="rounded-card border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{label}</span>
        <StatusBadge text={STUDENT_SERVICE_STATUS_LABELS[item.status]} />
      </div>
      <p className="mt-1 text-muted-foreground">
        {dayText(item.startDate)}
        {period ? ` – ${dayText(period)}` : ''} · {money(item.billedCents)} · Kalan{' '}
        {money(item.openCents)}
      </p>
      {item.amountCents < item.tariffAmountCents ? (
        <p className="mt-1 text-muted-foreground">
          Tutar elle düzeltildi: {money(item.amountCents)}, tarife {money(item.tariffAmountCents)}
          {item.unit === 'month' ? ' (aylık)' : ''}
        </p>
      ) : null}
      {item.refundDecisionRequired ? (
        <p role="note" className="mt-2 text-warning">
          Karar gerekir: kullanılmamış dönem için iade kuralı yok, tutar otomatik iade edilmez.
        </p>
      ) : null}
      {onEnd ? (
        <div className="mt-2">
          <Button variant="secondary" onClick={onEnd} aria-label={`${label} hizmetinden çıkar`}>
            Çıkar
          </Button>
        </div>
      ) : null}
    </li>
  )
}

/** Aylık kalemde ay sayısı ve toplam, ötekilerde tek taksit; girilen tutar geçersizse tarifeyle. */
function quoteSummaryText(quote: StudentServiceQuote, amountCents: number | null): string {
  const unit = amountCents ?? quote.tariffAmountCents
  if (quote.unit !== 'month') return `Tek taksit: ${money(unit)}.`
  const months = quote.dueDates.length
  if (months === 0) return 'Ay sayısı için bitiş gününü seçin.'
  return `${String(months)} ay için ayrı taksit: aylık ${money(unit)}, toplam ${money(unit * months)}.`
}

function SubscribeModal({ studentId, onClose }: { studentId: string; onClose: () => void }) {
  const { session } = useAuth()
  const subscribe = useSubscribeStudentService()
  const [today] = useState(() => dayKey(Date.now()))
  const form = useForm<StudentServiceFormValues>({
    resolver: zodResolver(studentServiceFormSchema),
    defaultValues: {
      kind: 'transport',
      academicYear: session?.institution?.academicYear ?? Number(today.slice(0, 4)),
      startDate: today,
      endDate: '',
      amount: '',
    },
  })
  const busy = subscribe.isPending || form.formState.isSubmitting
  const errors = form.formState.errors

  const [kind, academicYear, startDate, endDate, amount] = useWatch({
    control: form.control,
    name: ['kind', 'academicYear', 'startDate', 'endDate', 'amount'],
  })
  const datesReady =
    daySchema.safeParse(startDate).success &&
    (endDate === '' || daySchema.safeParse(endDate).success)
  const quote = useStudentServiceQuote(
    { studentId, kind, academicYear, startDate, ...(endDate === '' ? {} : { endDate }) },
    { enabled: datesReady },
  )
  const quoted = quote.data?.data
  const tariffCents = quoted?.tariffAmountCents

  // Önerilen tutar tarifedir; tarih değişince sorgu yenilense de personelin düzeltmesi korunur, hizmet
  // değişince tutar boşalır (boş tutar sunucuda tarife demektir).
  const prefilled = useRef<string | null>(null)
  useEffect(() => {
    if (tariffCents === undefined) return
    const key = `${kind}:${String(tariffCents)}`
    if (prefilled.current === key) return
    prefilled.current = key
    form.setValue('amount', amountInputValue(tariffCents))
  }, [form, kind, tariffCents])

  const hasFieldError = Boolean(errors.kind ?? errors.startDate ?? errors.endDate)
  const isMonthly = quoted?.unit === 'month'

  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await subscribe.submit(studentServiceFormToBody(studentId, values), {
      setError: (name, error) => {
        if (name === 'kind' || name === 'startDate' || name === 'endDate')
          form.setError(name, error, { shouldFocus: true })
        else if (name === 'amountCents') form.setError('amount', error, { shouldFocus: true })
        else form.setError('root.server', error)
      },
    })
    if (outcome.status === 'success') {
      notify.success('Ek hizmet taksiti yazıldı.')
      onClose()
    }
  })

  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Ek hizmete yaz"
      description="Önerilen tutar yayımlı tarifedir; düşürülebilir, üstüne çıkılamaz. Öğrenimden ayrı taksit açar, aylık kalemde bitiş günü zorunludur."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={SUBSCRIBE_FORM} disabled={busy} aria-busy={busy || undefined}>
            Yaz
          </Button>
        </>
      }
    >
      <form
        id={SUBSCRIBE_FORM}
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField id="ek-hizmet-tur" label="Hizmet" error={errors.kind}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('kind', {
                onChange: () => {
                  prefilled.current = null
                  form.setValue('amount', '')
                },
              })}
              className="w-full"
              disabled={busy}
            >
              {STUDENT_SERVICE_KINDS.map((kind) => (
                <NativeSelectOption key={kind} value={kind}>
                  {studentServiceKindLabel(kind)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="ek-hizmet-baslangic" label="Başlangıç" error={errors.startDate}>
            {(control) => (
              <Input {...control} {...form.register('startDate')} type="date" disabled={busy} />
            )}
          </FormField>
          <FormField id="ek-hizmet-bitis" label="Bitiş (isteğe bağlı)" error={errors.endDate}>
            {(control) => (
              <Input {...control} {...form.register('endDate')} type="date" disabled={busy} />
            )}
          </FormField>
        </div>
        <FormField
          id="ek-hizmet-tutar"
          label={isMonthly ? 'Aylık tutar (₺)' : 'Tutar (₺)'}
          error={errors.amount}
          {...(tariffCents === undefined
            ? {}
            : { description: `Tarifedeki tutar: ${money(tariffCents)}` })}
        >
          {(control) => (
            <Input {...control} {...form.register('amount')} inputMode="decimal" disabled={busy} />
          )}
        </FormField>
        {quoted ? (
          <p role="status" className="text-sm text-muted-foreground">
            {quoteSummaryText(quoted, parseAmountInput(amount))}
          </p>
        ) : quote.error && !hasFieldError ? (
          <p role="alert" className="text-sm text-danger">
            {quote.error.message}
          </p>
        ) : null}
        {errors.root?.server?.message ? (
          <p role="alert" className="text-sm text-danger">
            {errors.root.server.message}
          </p>
        ) : null}
      </form>
    </Modal>
  )
}

/** Çıkış: ileri vadeli ödenmemiş taksit iptal edilir; ödenen tutar için iade otomatik yazılmaz. */
function EndModal({ item, onClose }: { item: StudentServiceItem; onClose: () => void }) {
  const end = useEndStudentService()
  const [today] = useState(() => dayKey(Date.now()))
  const form = useForm<{ endedDate: string }>({ defaultValues: { endedDate: today } })
  const busy = end.isPending || form.formState.isSubmitting
  const errors = form.formState.errors

  const onSubmit = form.handleSubmit(async ({ endedDate }) => {
    const outcome = await end.submit(
      { serviceId: item.id, version: item.version, body: { endedDate } },
      {
        setError: (_name, error) => form.setError('endedDate', error, { shouldFocus: true }),
      },
    )
    if (outcome.status === 'success') {
      notify.success('Ek hizmet aboneliği kapatıldı.')
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })

  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={`${studentServiceKindLabel(item.kind)} hizmetinden çıkar`}
      description="Çıkış gününden sonra vadeli ödenmemiş taksitler iptal edilir. Ödenen tutar otomatik iade edilmez."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={END_FORM} disabled={busy} aria-busy={busy || undefined}>
            Çıkışı kaydet
          </Button>
        </>
      }
    >
      <form id={END_FORM} noValidate onSubmit={(event) => void onSubmit(event)}>
        <FormField id="ek-hizmet-cikis" label="Çıkış günü" error={errors.endedDate}>
          {(control) => (
            <Input
              {...control}
              {...form.register('endedDate', { required: 'Günü seçin.' })}
              type="date"
              max={today}
              disabled={busy}
            />
          )}
        </FormField>
      </form>
    </Modal>
  )
}
