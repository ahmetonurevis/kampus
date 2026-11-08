import { zodResolver } from '@hookform/resolvers/zod'
import { useId, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {
  bankIgnoreSchema,
  bankMatchSchema,
  type BankIgnoreInput,
  type BankMatchInput,
} from '@kampus/school-core/lib/finance-bank-matching.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { receiptNumberLabel } from '@kampus/school-core/lib/finance-receipt.ts'
import {
  BANK_MATCH_DUPLICATE_CODE,
  useBankSuggestions,
  useIgnoreBankTransaction,
  useMatchBankTransaction,
  type BankMatchSuggestion,
  type BankTransaction,
} from '@kampus/react-shared/use-finance-bank-matching.ts'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCoreAll, useCoreList } from '@/hooks/use-core-collection.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useEnrollmentLearner } from '@/hooks/use-enrollment-learner.ts'
import { notify } from '@/lib/notify.ts'
import {
  amountNote,
  CONFIDENCE_TONES,
  confidenceLabel,
  reasonText,
  STATUS_TONES,
  statusLabel,
} from './bank-matching-model.ts'

// Banka hareketi eşleştirme paneli (IST-115, ON-099; DOM-FIN-069): öneriler sıralı ve güven
// düzeyiyle; yetkili öneriyi seçer ya da başka öğrenci ve taksit seçer, onaylayınca tahsilat
// yazılır. Öneri kendiliğinden tahsilat olmaz. Yoksayma gerekçelidir.

const MATCH_FORM = 'banka-eslestirme-formu'
const IGNORE_FORM = 'banka-yoksay-formu'

export function BankMatchPanel({
  transaction,
  onClose,
}: {
  transaction: BankTransaction
  onClose: () => void
}) {
  const learner = useEnrollmentLearner()
  const [studentId, setStudentId] = useState<string | undefined>(undefined)
  const [ignoring, setIgnoring] = useState(false)
  // Olası mükerrer uyarısı (K-121): sunucunun mesajı; seçim değişince kalkar.
  const [duplicate, setDuplicate] = useState<{ message: string; invoiceId: string } | null>(null)
  const suggestions = useBankSuggestions(transaction.id, studentId)
  const matcher = useMatchBankTransaction()
  const open = transaction.status === 'unmatched'
  const form = useForm<BankMatchInput>({
    resolver: zodResolver(bankMatchSchema),
    defaultValues: { studentId: '', invoiceId: '' },
  })
  const chosenStudent = useWatch({ control: form.control, name: 'studentId' })
  const chosenInvoice = useWatch({ control: form.control, name: 'invoiceId' })
  const list = suggestions.data?.data.suggestions ?? []

  const warned = duplicate !== null && duplicate.invoiceId === chosenInvoice
  const onMatch = form.handleSubmit(async ({ studentId: student, invoiceId }) => {
    const outcome = await matcher.submit(
      {
        transactionId: transaction.id,
        version: transaction.version,
        studentId: student,
        invoiceId,
        confirmDuplicate: warned,
      },
      { silent: (error) => error.code === BANK_MATCH_DUPLICATE_CODE },
    )
    if (outcome.status === 'success') {
      const { payment } = outcome.data.data
      notify.success(`Tahsilat kaydedildi: ${receiptNumberLabel(payment)}.`)
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === BANK_MATCH_DUPLICATE_CODE)
      setDuplicate({ message: outcome.error.message, invoiceId })
    else if (outcome.status === 'failed' && outcome.error.status === 409) onClose()
  })

  function choose(suggestion: BankMatchSuggestion) {
    form.setValue('studentId', suggestion.studentId, { shouldValidate: true })
    form.setValue('invoiceId', suggestion.invoiceId, { shouldValidate: true })
  }

  const busy = matcher.isPending || form.formState.isSubmitting
  return (
    <Modal
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Banka hareketini eşleştir"
      description={`${dateLabel(transaction.bookingDate, { year: 'numeric' })} · ${money(transaction.amountCents)} · ${transaction.bankAccountLabel}`}
      size="wide"
      footer={
        open && !ignoring ? (
          <>
            <Button variant="secondary" onClick={() => setIgnoring(true)} disabled={busy}>
              Yoksay
            </Button>
            <Button
              type="submit"
              form={MATCH_FORM}
              disabled={busy || chosenInvoice === ''}
              aria-busy={busy || undefined}
            >
              {warned ? 'Ayrı ödeme, yine de tahsil et' : 'Onayla ve tahsil et'}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Kapat
          </Button>
        )
      }
    >
      <div className="grid gap-4">
        <dl className="grid gap-2 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted-foreground">Açıklama</dt>
          <dd className="break-words">{transaction.description || '—'}</dd>
          {transaction.counterparty ? (
            <>
              <dt className="text-muted-foreground">Gönderen</dt>
              <dd>{transaction.counterparty}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">Referans</dt>
          <dd>{transaction.reference ?? '—'}</dd>
          <dt className="text-muted-foreground">Durum</dt>
          <dd>
            <StatusBadge
              text={statusLabel(transaction.status)}
              tone={STATUS_TONES[transaction.status]}
            />
          </dd>
        </dl>
        {transaction.referenceInUse ? (
          <p role="alert" className="rounded-md border border-warning p-3 text-sm">
            Bu referansla kayıtlı bir tahsilat var; havale elle girilmiş olabilir. Mükerrer tahsilat
            açılmaz, hareketi yoksayın.
          </p>
        ) : null}
        {warned ? (
          <p role="alert" className="rounded-md border border-warning p-3 text-sm">
            {duplicate.message}
          </p>
        ) : null}
        {transaction.status === 'matched' && transaction.payment ? (
          <p className="text-sm">
            {transaction.payment.studentName ?? learner.title} için{' '}
            {receiptNumberLabel(transaction.payment)} numaralı tahsilatla eşleşti. Geri almak için
            tahsilatı Tahsilat geçmişi’nden iptal edin.
          </p>
        ) : null}
        {transaction.status === 'ignored' ? (
          <p className="text-sm">Yoksayıldı: {transaction.ignoreReason}</p>
        ) : null}

        {open && ignoring ? (
          <IgnoreForm
            transaction={transaction}
            onDone={onClose}
            onCancel={() => setIgnoring(false)}
          />
        ) : null}

        {open && !ignoring ? (
          <form
            id={MATCH_FORM}
            noValidate
            aria-label="Eşleştirme formu"
            onSubmit={(event) => void onMatch(event)}
            className="grid gap-4"
          >
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-base font-semibold">
                {studentId === undefined ? 'Öneriler' : `Seçilen ${learner.noun}`}
              </legend>
              {suggestions.error ? (
                <QueryError error={suggestions.error} onRetry={() => void suggestions.refetch()} />
              ) : null}
              {suggestions.isPending ? (
                <p className="text-sm text-muted-foreground">Öneriler hazırlanıyor…</p>
              ) : list.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {studentId === undefined
                    ? `Açıklamada eşleşen ${learner.noun} bulunamadı. Aşağıdan ${learner.noun} seçin ya da hareketi yoksayın.`
                    : `Bu ${learner.titleGenitive.toLocaleLowerCase('tr')} açık taksiti yok.`}
                </p>
              ) : (
                list.map((suggestion) => (
                  <SuggestionOption
                    key={suggestion.studentId}
                    suggestion={suggestion}
                    amountCents={transaction.amountCents}
                    checked={
                      chosenStudent === suggestion.studentId &&
                      chosenInvoice === suggestion.invoiceId
                    }
                    onChoose={() => choose(suggestion)}
                  />
                ))
              )}
              {form.formState.errors.invoiceId ? (
                <p role="alert" className="text-sm text-destructive">
                  Onaylamak için bir öneri ya da taksit seçin.
                </p>
              ) : null}
            </fieldset>
            {chosenStudent !== '' ? (
              <InvoicePicker
                studentId={chosenStudent}
                value={chosenInvoice}
                onChange={(invoiceId) =>
                  form.setValue('invoiceId', invoiceId, { shouldValidate: true })
                }
              />
            ) : null}
            <StudentPicker
              label={`Başka ${learner.noun} seç`}
              onPick={(id) => {
                form.reset({ studentId: '', invoiceId: '' })
                setStudentId(id)
              }}
              onClear={
                studentId === undefined
                  ? undefined
                  : () => {
                      form.reset({ studentId: '', invoiceId: '' })
                      setStudentId(undefined)
                    }
              }
            />
          </form>
        ) : null}
      </div>
    </Modal>
  )
}

function SuggestionOption({
  suggestion,
  amountCents,
  checked,
  onChoose,
}: {
  suggestion: BankMatchSuggestion
  amountCents: number
  checked: boolean
  onChoose: () => void
}) {
  const id = useId()
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer gap-3 rounded-md border p-3 has-[:checked]:border-primary"
    >
      <input
        id={id}
        type="radio"
        name="oneri"
        checked={checked}
        onChange={onChoose}
        className="mt-1 size-4"
      />
      <span className="grid gap-1 text-sm">
        <span className="flex flex-wrap items-center gap-2">
          <strong className="font-semibold">{suggestion.studentName}</strong>
          <StatusBadge
            text={confidenceLabel(suggestion.confidence)}
            tone={CONFIDENCE_TONES[suggestion.confidence]}
          />
        </span>
        <span>
          {suggestion.installment}. taksit · vade{' '}
          {dateLabel(suggestion.dueDate, { year: 'numeric' })} · kalan {money(suggestion.openCents)}
        </span>
        <span className="text-muted-foreground">Gerekçe: {reasonText(suggestion.reasons)}</span>
        <span className="text-muted-foreground">{amountNote(suggestion, amountCents)}</span>
      </span>
    </label>
  )
}

/** Seçilen öğrencinin ödenmemiş taksitleri; başka taksit seçilebilir (artanı en eski vadeye). */
function InvoicePicker({
  studentId,
  value,
  onChange,
}: {
  studentId: string
  value: string
  onChange: (invoiceId: string) => void
}) {
  const invoices = useCoreAll('invoices', { filters: { studentId } })
  const open = (invoices.data ?? [])
    .map((row) => row.record)
    .filter((invoice) => !invoice.paidAt)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.installment - b.installment)
  return (
    <label className="grid max-w-md gap-1 text-sm font-medium">
      Tahsil edilecek taksit
      <NativeSelect value={value} onChange={(event) => onChange(event.target.value)}>
        <NativeSelectOption value="">Taksit seçin</NativeSelectOption>
        {open.map((invoice) => (
          <NativeSelectOption key={invoice.id} value={invoice.id}>
            {invoice.installment}. taksit · vade {dateLabel(invoice.dueDate, { year: 'numeric' })} ·{' '}
            {money(invoice.amount)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </label>
  )
}

function StudentPicker({
  label,
  onPick,
  onClear,
}: {
  label: string
  onPick: (studentId: string) => void
  onClear: (() => void) | undefined
}) {
  const [query, setQuery] = useState('')
  const search = useDebouncedValue(query).trim()
  const students = useCoreList(
    'students',
    { q: search, pageSize: 5 },
    { enabled: search.length >= 2 },
  )
  const id = useId()
  return (
    <div className="grid gap-2 border-t pt-3">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex flex-wrap gap-2">
        <Input
          id={id}
          value={query}
          placeholder="Ad ya da numara (en az 2 karakter)"
          className="max-w-sm"
          onChange={(event) => setQuery(event.target.value)}
        />
        {onClear ? (
          <Button type="button" variant="ghost" onClick={onClear}>
            Önerilere dön
          </Button>
        ) : null}
      </div>
      {search.length >= 2 ? (
        <ul aria-label="Arama sonuçları" className="grid gap-1">
          {(students.data?.rows ?? []).map(({ record }) => (
            <li key={record.id}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setQuery('')
                  onPick(record.id)
                }}
              >
                {record.name}
                {record.number ? ` · ${record.number}` : ''}
              </Button>
            </li>
          ))}
          {students.isSuccess && students.data.rows.length === 0 ? (
            <li className="text-sm text-muted-foreground">Sonuç yok.</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}

function IgnoreForm({
  transaction,
  onDone,
  onCancel,
}: {
  transaction: BankTransaction
  onDone: () => void
  onCancel: () => void
}) {
  const ignore = useIgnoreBankTransaction()
  const form = useForm<BankIgnoreInput>({
    resolver: zodResolver(bankIgnoreSchema),
    defaultValues: { ignoreReason: '' },
  })
  const busy = ignore.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async ({ ignoreReason }) => {
    const outcome = await ignore.submit(
      { transactionId: transaction.id, version: transaction.version, ignoreReason },
      { setError: (_name, error) => form.setError('ignoreReason', error) },
    )
    if (outcome.status === 'success') {
      notify.success('Hareket yoksayıldı.')
      onDone()
    } else if (outcome.status === 'failed' && outcome.error.status === 409) onDone()
  })
  return (
    <form
      id={IGNORE_FORM}
      noValidate
      aria-label="Yoksayma formu"
      onSubmit={(event) => void onSubmit(event)}
      className="grid gap-3"
    >
      <FormField
        id="yoksay-gerekce"
        label="Yoksayma gerekçesi"
        description="Örneğin kira geliri, banka iadesi ya da başka kurum geliri. Tahsilat yazılmaz."
        error={form.formState.errors.ignoreReason}
      >
        {(control) => <Textarea {...control} {...form.register('ignoreReason')} disabled={busy} />}
      </FormField>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Vazgeç
        </Button>
        <Button type="submit" variant="destructive" disabled={busy} aria-busy={busy || undefined}>
          Hareketi yoksay
        </Button>
      </div>
    </form>
  )
}
