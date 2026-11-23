import { useState } from 'react'
import { View } from 'react-native'
import {
  amendmentDefaults,
  canRepriceContract,
  type AmendmentFormValues,
  type ContractRecord,
} from '@kampus/react-shared/contract-model.ts'
import {
  useAmendContract,
  useCancelContractAmendment,
  useSetContractSignatory,
} from '@kampus/react-shared/use-contract-commands.ts'
import type { ContractSignatoryInput } from '@kampus/school-core/lib/contract-approval.ts'
import {
  SIGNATORY_ROLE_LABELS,
  SIGNATORY_ROLES,
  type SignatoryRole,
} from '@kampus/school-core/lib/contract-status.ts'
import {
  FEE_DISCOUNT_KIND_LABELS,
  FEE_DISCOUNT_KINDS,
} from '@kampus/school-core/lib/fee-tariffs.ts'
import type { State } from '@kampus/school-core/data/seed.ts'
import { Button, DateField, Field, Select, Sheet, T } from '../../ui/components.tsx'
import { Notice } from '../../ui/SchoolLayout.tsx'
import { createFieldCollector, type FieldErrors } from '../command-failure.ts'
import {
  checkAmendment,
  checkCancelAmendment,
  checkSignatory,
  contractFailure,
  type ContractFailure,
  type FormErrors,
} from '../contract-staff.ts'
import { useNotify } from '../toast.tsx'
import { CheckRow, FieldError } from './finance-form-parts.tsx'

type Target = { contractId: string; version: number }
type FormProps = {
  target: Target
  /** Ayrıntıya döner (vazgeç, başarı, çakışma). */
  onDone: () => void
}

const errorProp = (text: string | undefined) => (text ? { error: text } : {})

/**
 * Sözleşme formlarının ortak hata durumu: alan hataları alanın altında, genel mesaj alt bilgide,
 * çakışmada (kayıt eskidi, kanca listeyi tazeledi) form kapanır ve mesaj toast olur. Değerler
 * yalnız bellekte durur.
 */
function useContractForm(fields: readonly string[], onDone: () => void) {
  const notify = useNotify()
  const [errors, setErrors] = useState<FormErrors>({})
  const [failure, setFailure] = useState<ContractFailure | null>(null)
  return {
    errors,
    failure,
    setErrors,
    clear: (field: string) => {
      setErrors({ ...errors, [field]: undefined })
      setFailure(null)
    },
    begin: () => {
      setErrors({})
      setFailure(null)
    },
    /** Başarısız komutun sonucunu ekrana yazar. */
    fail: (error: Parameters<typeof contractFailure>[0], collected: FieldErrors) => {
      const next = contractFailure(error, collected, fields)
      if (next.conflict) {
        notify(next.message ?? 'Sözleşme değişti. Güncel sürüm yüklendi.', 'error')
        onDone()
        return
      }
      setErrors(next.errors)
      setFailure(next)
    },
  }
}

function FormFooter({
  failure,
  failureTitle,
  pending,
  submit,
  onSubmit,
  onCancel,
  danger = false,
}: {
  failure: ContractFailure | null
  failureTitle: string
  pending: boolean
  submit: string
  onSubmit: () => void
  onCancel: () => void
  danger?: boolean
}) {
  return (
    <View style={{ gap: 10 }}>
      {failure?.message && (
        <Notice tone="red" title={failureTitle} text={failure.message}>
          {failure.uncertain && (
            <T size={13}>İşlem yapılmış olabilir. Yeniden denemek işlemi ikinci kez yapmaz.</T>
          )}
        </Notice>
      )}
      <Button
        {...(danger ? { danger: true } : { primary: true })}
        disabled={pending}
        onPress={onSubmit}
      >
        {pending ? 'Kaydediliyor…' : failure?.uncertain ? 'Yeniden dene' : submit}
      </Button>
      <Button disabled={pending} onPress={onCancel}>
        Vazgeç
      </Button>
    </View>
  )
}

/** İmza yetkilisi (yalnız yönetici; ÖÖKY m.31/4): kurucu ya da temsilcisi, onaya kadar düzeltilir. */
export function SignatorySheet({
  contract,
  target,
  onDone,
}: FormProps & { contract: ContractRecord }) {
  const notify = useNotify()
  const sign = useSetContractSignatory()
  const form = useContractForm(['name', 'role'], onDone)
  const [values, setValues] = useState<ContractSignatoryInput>({
    name: contract.signatory?.name ?? '',
    role: contract.signatory?.role ?? 'founder',
  })
  const pending = sign.isPending

  async function submit() {
    if (pending) return
    const check = checkSignatory(values)
    if (!check.ok) {
      form.setErrors(check.errors)
      return
    }
    form.begin()
    const collector = createFieldCollector()
    const outcome = await sign.submit(
      { ...target, body: check.body },
      { setError: collector.setError, silent: () => true },
    )
    if (outcome.status === 'success') {
      notify('İmza yetkilisi işlendi.')
      onDone()
    } else if (outcome.status === 'failed') form.fail(outcome.error, collector.fields)
  }

  return (
    <Sheet
      visible
      title="İmza yetkilisi"
      onClose={pending ? () => undefined : onDone}
      pinFooter
      footer={
        <FormFooter
          failure={form.failure}
          failureTitle="İmza yetkilisi işlenemedi"
          pending={pending}
          submit="İmza yetkilisini kaydet"
          onSubmit={() => void submit()}
          onCancel={onDone}
        />
      }
    >
      <Field
        label="Ad soyad"
        value={values.name}
        onChange={(name) => {
          setValues({ ...values, name })
          form.clear('name')
        }}
        maxLength={120}
        editable={!pending}
        {...errorProp(form.errors.name)}
      />
      <Select
        label="Sıfat"
        value={values.role}
        required
        disabled={pending}
        options={SIGNATORY_ROLES.map((role) => ({
          value: role,
          label: SIGNATORY_ROLE_LABELS[role],
        }))}
        onChange={(role) => {
          setValues({ ...values, role: role as SignatoryRole })
          form.clear('role')
        }}
      />
      <FieldError text={form.errors.role} />
    </Sheet>
  )
}

/**
 * Ek protokol taslağı (DOM-FIN-010, -020, -021): tahsil edilmiş taksitler ve ek hizmetler korunur,
 * kalan tutar yeni plana bölünür; önceki sürüm ve taksitler onaya kadar değişmez. Oluşan taslak aynı
 * pencerede açılır.
 */
export function AmendmentSheet({
  contract,
  invoices,
  today,
  target,
  onDone,
  onCreated,
}: FormProps & {
  contract: ContractRecord
  invoices: readonly State['invoices'][number][]
  today: string
  onCreated: (contractId: string) => void
}) {
  const notify = useNotify()
  const amend = useAmendContract()
  const form = useContractForm(['reason', 'installmentCount', 'firstDueDate', 'discounts'], onDone)
  const [values, setValues] = useState<AmendmentFormValues>(() =>
    amendmentDefaults(contract, invoices, today),
  )
  const pending = amend.isPending
  const change = (patch: Partial<AmendmentFormValues>, field: string) => {
    setValues({ ...values, ...patch })
    form.clear(field)
  }

  async function submit() {
    if (pending) return
    const check = checkAmendment(values)
    if (!check.ok) {
      form.setErrors(check.errors)
      return
    }
    form.begin()
    const collector = createFieldCollector()
    const outcome = await amend.submit(
      { ...target, body: check.body },
      { setError: collector.setError, silent: () => true },
    )
    if (outcome.status === 'success') {
      notify('Ek protokol taslağı açıldı. İmza yetkilisini işleyip ödeyici onayını alın.')
      const created = outcome.data.data.entity?.id
      if (created) onCreated(created)
      else onDone()
    } else if (outcome.status === 'failed') form.fail(outcome.error, collector.fields)
  }

  return (
    <Sheet
      visible
      title="Ek protokol"
      onClose={pending ? () => undefined : onDone}
      pinFooter
      footer={
        <FormFooter
          failure={form.failure}
          failureTitle="Ek protokol hazırlanamadı"
          pending={pending}
          submit="Ek protokolü hazırla"
          onSubmit={() => void submit()}
          onCancel={onDone}
        />
      }
    >
      <T muted size={14}>
        Tahsil edilmiş taksitler ve ek hizmetler korunur; kalan tutar yeni plana bölünür. Yeni plan
        ek protokol onaylanınca taksitlere geçer.
      </T>
      <Field
        label="Gerekçe"
        value={values.reason}
        multiline
        maxLength={500}
        editable={!pending}
        onChange={(reason) => change({ reason }, 'reason')}
        {...errorProp(form.errors.reason)}
      />
      <Field
        label="Taksit sayısı"
        value={values.installmentCount}
        keyboard="number-pad"
        maxLength={2}
        editable={!pending}
        onChange={(installmentCount) => change({ installmentCount }, 'installmentCount')}
        {...errorProp(form.errors.installmentCount)}
      />
      <DateField
        label="İlk vade"
        value={values.firstDueDate}
        onChange={(firstDueDate) => change({ firstDueDate }, 'firstDueDate')}
      />
      <FieldError text={form.errors.firstDueDate} />
      {canRepriceContract(contract) && (
        <View style={{ gap: 8 }}>
          <CheckRow
            label="İndirimleri tarifeden yeniden hesapla"
            checked={values.changeDiscounts}
            disabled={pending}
            onChange={(changeDiscounts) => change({ changeDiscounts }, 'discounts')}
          />
          {values.changeDiscounts &&
            FEE_DISCOUNT_KINDS.map((kind) => (
              <CheckRow
                key={kind}
                label={FEE_DISCOUNT_KIND_LABELS[kind]}
                checked={values.discounts.includes(kind)}
                disabled={pending}
                onChange={(checked) =>
                  change(
                    {
                      discounts: checked
                        ? [...values.discounts, kind]
                        : values.discounts.filter((item) => item !== kind),
                    },
                    'discounts',
                  )
                }
              />
            ))}
          <FieldError text={form.errors.discounts} />
        </View>
      )}
    </Sheet>
  )
}

/** Onaylanmamış ek protokolü gerekçeyle kapatır; kayıt silinmez, önceki sürüm yürürlükte kalır. */
export function CancelAmendmentSheet({ target, onDone }: FormProps) {
  const notify = useNotify()
  const cancel = useCancelContractAmendment()
  const form = useContractForm(['reason'], onDone)
  const [reason, setReason] = useState('')
  const pending = cancel.isPending

  async function submit() {
    if (pending) return
    const check = checkCancelAmendment({ reason })
    if (!check.ok) {
      form.setErrors(check.errors)
      return
    }
    form.begin()
    const collector = createFieldCollector()
    const outcome = await cancel.submit(
      { ...target, body: check.body },
      { setError: collector.setError, silent: () => true },
    )
    if (outcome.status === 'success') {
      notify('Ek protokol iptal edildi.')
      onDone()
    } else if (outcome.status === 'failed') form.fail(outcome.error, collector.fields)
  }

  return (
    <Sheet
      visible
      title="Ek protokolü iptal et"
      onClose={pending ? () => undefined : onDone}
      pinFooter
      footer={
        <FormFooter
          danger
          failure={form.failure}
          failureTitle="Ek protokol iptal edilemedi"
          pending={pending}
          submit="Ek protokolü iptal et"
          onSubmit={() => void submit()}
          onCancel={onDone}
        />
      }
    >
      <Field
        label="İptal gerekçesi"
        value={reason}
        multiline
        maxLength={500}
        editable={!pending}
        onChange={(text) => {
          setReason(text)
          form.clear('reason')
        }}
        {...errorProp(form.errors.reason)}
      />
    </Sheet>
  )
}
