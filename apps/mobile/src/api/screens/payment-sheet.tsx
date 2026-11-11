import { useState } from 'react'
import { View } from 'react-native'
import type { InvoiceRow } from '@kampus/react-shared/finance-model.ts'
import {
  allocatedToInvoice,
  useBankAccounts,
  usePaymentSettings,
  useRecordPayment,
  useStudentPayments,
  type RecordPaymentBody,
} from '@kampus/react-shared/use-payment-commands.ts'
import { money } from '@kampus/school-core/lib/format.ts'
import {
  bankAccountLabel,
  PAYMENT_METHOD_LABELS,
  usesBankAccount,
  type PaymentMethod,
} from '@kampus/school-core/lib/payments.ts'
import { Button, DateField, Field, Select, Sheet, T } from '../../ui/components.tsx'
import { DetailPair, Notice } from '../../ui/SchoolLayout.tsx'
import { createFieldCollector } from '../command-failure.ts'
import {
  checkPaymentForm,
  openAmount,
  paymentDuplicateKey,
  paymentFailure,
  paymentFormDefaults,
  paymentMethodsFor,
  type PaymentFormErrors,
  type PaymentFormInput,
} from '../finance-staff.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'
import { useNotify } from '../toast.tsx'
import { FieldError, useFinanceRefresh } from './finance-form-parts.tsx'

const TITLE = 'Tahsilat kaydet'

type Props = {
  row: InvoiceRow
  today: string
  /** Taksit ayrıntısına döner. */
  onBack: () => void
  /** Pencereyi kapatır (başarı, mükerrer ödeme). */
  onClose: () => void
}

/**
 * Tahsilat kaydı (`POST /payments`; ADR 0006, DOM-FIN-030…032; web `PaymentPanel` eşi): tutar taksitin
 * kalanıyla gelir, kısmi ödeme girilebilir, nakit yalnız kurum ayarı açıksa listelenir. Form verileri
 * gelince kurulur. Değerler yalnız bellekte durur. Havalede aynı gün aynı tutarda ekstreden onaylanmış
 * tahsilat varsa (K-121) uyarı çıkar; "Ayrı ödeme, yine de kaydet" açık onaydır (`confirmDuplicate`).
 */
export function PaymentSheet({ row, today, onBack, onClose }: Props) {
  const history = useStudentPayments(row.studentId)
  const settings = usePaymentSettings()
  const accounts = useBankAccounts()
  const error = history.error ?? accounts.error
  if (history.data && accounts.data && !settings.isPending)
    return (
      <PaymentForm
        row={row}
        today={today}
        onBack={onBack}
        onClose={onClose}
        paidCents={allocatedToInvoice(history.data.data, row.id)}
        cashEnabled={settings.cashEnabled}
        accounts={accounts.data.data}
      />
    )
  return (
    <Sheet visible title={TITLE} onClose={onBack}>
      {error ? (
        <QueryError
          error={error}
          onRetry={() => {
            if (history.error) void history.refetch()
            if (accounts.error) void accounts.refetch()
          }}
        />
      ) : (
        <ListLoading label="Tahsilat bilgileri yükleniyor…" />
      )}
    </Sheet>
  )
}

function PaymentForm({
  row,
  today,
  onBack,
  onClose,
  paidCents,
  cashEnabled,
  accounts,
}: Props & {
  paidCents: number
  cashEnabled: boolean
  accounts: readonly { id: string; bankName: string; iban: string }[]
}) {
  const notify = useNotify()
  const refresh = useFinanceRefresh()
  const pay = useRecordPayment()
  const [values, setValues] = useState<PaymentFormInput>(() =>
    paymentFormDefaults(row, paidCents, cashEnabled, accounts, today),
  )
  const [errors, setErrors] = useState<PaymentFormErrors>({})
  const [message, setMessage] = useState<string | null>(null)
  // Sonucu belirsiz gönderim: form kilitlenir, yalnız aynı gövde yeniden gönderilir.
  const [uncertain, setUncertain] = useState<RecordPaymentBody | null>(null)
  // Olası mükerrer uyarısı (K-121): sunucunun mesajı ve uyarının verildiği yöntem/tutar/gün.
  const [duplicate, setDuplicate] = useState<{ message: string; key: string } | null>(null)
  const warned = duplicate !== null && duplicate.key === paymentDuplicateKey(values)
  const isNote = values.method === 'Senet'
  const pending = pay.isPending

  function change(patch: Partial<PaymentFormInput>) {
    setValues({ ...values, ...patch })
    const cleared = { ...errors }
    for (const key of Object.keys(patch) as (keyof PaymentFormInput)[]) delete cleared[key]
    setErrors(cleared)
    setMessage(null)
  }

  async function send(body: RecordPaymentBody, key: string | null) {
    const collector = createFieldCollector()
    const outcome = await pay.submit(body, {
      setError: collector.setError,
      // Hata pencerenin içinde gösterilir; toast aynı hatayı ikinci kez söylemesin.
      silent: () => true,
    })
    if (outcome.status === 'busy') return
    if (outcome.status === 'success') {
      notify('Tahsilat kaydedildi.')
      onClose()
      return
    }
    const failure = paymentFailure(outcome.error, collector.fields)
    if (failure.alreadyPaid) {
      notify(failure.message ?? 'Bu taksit zaten ödenmiş.', 'error')
      onClose()
      return
    }
    if (failure.possibleDuplicate && key !== null) {
      setDuplicate({ message: failure.message ?? outcome.error.message, key })
      return
    }
    setErrors(failure.errors)
    setMessage(failure.message)
    setUncertain(failure.uncertain ? body : null)
  }

  function submit() {
    if (pending) return
    if (uncertain) {
      void send(uncertain, null)
      return
    }
    const check = checkPaymentForm(row, values, today)
    if (!check.ok) {
      setErrors(check.errors)
      setMessage(null)
      return
    }
    setErrors({})
    setMessage(null)
    void send(
      warned ? { ...check.body, confirmDuplicate: true } : check.body,
      paymentDuplicateKey(values),
    )
  }

  /** Belirsiz sonuçtan çıkarken liste sunucudan yeniden okunur. */
  function leave(next: () => void) {
    if (pending) return
    if (uncertain) refresh()
    next()
  }

  const footer = (
    <View style={{ gap: 12 }}>
      {warned && !uncertain && (
        <Notice tone="amber" title="Olası mükerrer tahsilat" text={duplicate.message} />
      )}
      {message && (
        <Notice tone="red" title="Tahsilat kaydedilemedi" text={message}>
          {uncertain && (
            <T size={13}>
              Tahsilat kaydedilmiş olabilir. Yeniden denemek aynı kaydı gönderir, mükerrer tahsilat
              oluşmaz.
            </T>
          )}
        </Notice>
      )}
      <Button primary icon="CircleCheck" disabled={pending} onPress={submit}>
        {pending
          ? 'Kaydediliyor…'
          : uncertain
            ? 'Yeniden dene'
            : warned
              ? 'Ayrı ödeme, yine de kaydet'
              : 'Tahsilatı kaydet'}
      </Button>
      <Button disabled={pending} onPress={() => leave(onBack)}>
        {uncertain ? 'Listeyi yenile ve çık' : 'Vazgeç'}
      </Button>
    </View>
  )

  return (
    <Sheet visible title={TITLE} onClose={() => leave(onClose)} footer={footer} pinFooter>
      <Notice
        title={`${row.studentName} · ${String(row.installment)}. taksit · ${money(row.amount)}`}
        {...(paidCents > 0
          ? { text: `Ödenen ${money(paidCents)} · Kalan ${money(openAmount(row, paidCents))}` }
          : {})}
      />
      {uncertain ? (
        <View style={{ gap: 12 }}>
          <DetailPair label="Tutar" value={money(uncertain.amountCents)} />
          <DetailPair label="Ödeme yöntemi" value={PAYMENT_METHOD_LABELS[uncertain.method]} />
          {!!uncertain.reference && <DetailPair label="Referans" value={uncertain.reference} />}
        </View>
      ) : (
        <>
          <Field
            label="Tutar (₺)"
            value={values.amount}
            onChange={(amount) => change({ amount })}
            keyboard="decimal-pad"
            hint="Kısmi ödeme girilebilir. Taksiti aşan tutar en eski vadeli taksite düşer."
            editable={!pending}
            {...(errors.amount ? { error: errors.amount } : {})}
          />
          <Select
            label="Ödeme yöntemi"
            value={values.method}
            required
            disabled={pending}
            options={paymentMethodsFor(cashEnabled).map((method) => ({
              value: method,
              label: PAYMENT_METHOD_LABELS[method],
            }))}
            onChange={(method) => change({ method: method as PaymentMethod })}
          />
          <FieldError text={errors.method} />
          {usesBankAccount(values.method) && accounts.length > 0 && (
            <>
              <Select
                label="Banka hesabı"
                value={values.bankAccountId}
                required
                disabled={pending}
                options={accounts.map((account) => ({
                  value: account.id,
                  label: bankAccountLabel(account),
                }))}
                onChange={(bankAccountId) => change({ bankAccountId })}
              />
              <FieldError text={errors.bankAccountId} />
            </>
          )}
          {values.method !== 'Nakit' && (
            <Field
              label={isNote ? 'Senet numarası' : 'İşlem referansı'}
              value={values.reference}
              onChange={(reference) => change({ reference })}
              hint={
                isNote
                  ? 'Senet üzerindeki numara.'
                  : 'Banka dekontundaki veya POS fişindeki numara.'
              }
              maxLength={100}
              editable={!pending}
              {...(errors.reference ? { error: errors.reference } : {})}
            />
          )}
          <DateField
            label="Ödeme tarihi"
            value={values.paidDate}
            onChange={(paidDate) => change({ paidDate })}
          />
          <FieldError text={errors.paidDate} />
        </>
      )}
    </Sheet>
  )
}
