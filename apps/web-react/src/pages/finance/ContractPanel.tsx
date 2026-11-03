import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch, type FieldValues, type Path, type UseFormReturn } from 'react-hook-form'
import type { z } from 'zod'
import {
  amendmentBody,
  amendmentDefaults,
  amendmentFormSchema,
  canRepriceContract,
  contractActions,
  type AmendmentFormValues,
  type ContractRecord,
} from '@kampus/react-shared/contract-model.ts'
import {
  useAmendContract,
  useCancelContractAmendment,
  useSetContractSignatory,
} from '@kampus/react-shared/use-contract-commands.ts'
import {
  cancelAmendmentSchema,
  contractSignatorySchema,
  type CancelAmendmentInput,
  type ContractSignatoryInput,
} from '@kampus/school-core/lib/contract-approval.ts'
import {
  CONTRACT_APPROVAL_METHOD_LABELS,
  contractStatus,
  SIGNATORY_ROLE_LABELS,
  SIGNATORY_ROLES,
  type ContractStatus,
} from '@kampus/school-core/lib/contract-status.ts'
import {
  FEE_DISCOUNT_KIND_LABELS,
  FEE_DISCOUNT_KINDS,
} from '@kampus/school-core/lib/fee-tariffs.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import type { State } from '@kampus/school-core/data/seed.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PdfButton } from '@/components/PdfButton.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCoreAll, useCoreItem } from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  AcceptCheckbox,
  ContractFacts,
  ContractPlanTable,
  ContractStatusBadge,
  contractVersionLabel,
} from './ContractParts.tsx'
import { useContractApproval, type ContractApproval } from './use-contract-approval.ts'

type InvoiceRecord = State['invoices'][number]
type Mode = 'view' | 'sign' | 'approve' | 'amend' | 'cancel'
type ServerError = { type: string; message: string }

/**
 * Sunucu maddesi formun alanıysa alana, değilse formun genel hatasına (`root.server`) yazılır.
 * `exclusive` kancada alan maddesi varken toast çıkmaz.
 */
function fieldErrors<T extends FieldValues>(form: UseFormReturn<T>, fields: readonly Path<T>[]) {
  return (name: string, error: ServerError) => {
    const field = fields.find((item) => item === name)
    if (field) form.setError(field, error, { shouldFocus: true })
    else form.setError('root.server', error)
  }
}

function RootError({ message }: { message: string | undefined }) {
  return message ? (
    <p role="alert" className="text-sm text-danger">
      {message}
    </p>
  ) : null
}

/**
 * Sözleşme ayrıntısı (yönetici ve ön büro; IST-092, DOM-FIN-010, -012, -051): sürüm ve durum,
 * imza yetkilisi, ödeyici onayının biçimi ve zamanı, belgedeki plan. İşlemler panelin içinde kısa
 * form olarak açılır: imza yetkilisi (yalnız yönetici), ıslak imzalı onay, ek protokol ve onaysız
 * ek protokolün iptali. Sözleşmenin PDF'i geniş alanda açılır.
 */
export function ContractPanel({
  contractId,
  onClose,
  onOpen,
}: {
  contractId: string
  onClose: () => void
  /** Başka sürümü aynı panelde açar (önceki sürüm, ek protokol). */
  onOpen: (contractId: string) => void
}) {
  return (
    <SidePanel
      open={contractId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Sözleşme ayrıntısı"
    >
      {contractId ? (
        <ContractDetail key={contractId} contractId={contractId} onOpen={onOpen} />
      ) : null}
    </SidePanel>
  )
}

function ContractDetail({
  contractId,
  onOpen,
}: {
  contractId: string
  onOpen: (contractId: string) => void
}) {
  const { session } = useAuth()
  const item = useCoreItem('contracts', contractId)
  const studentId = item.data?.record.studentId ?? ''
  const versions = useCoreAll(
    'contracts',
    { filters: { studentId } },
    { enabled: studentId !== '' },
  )
  const invoices = useCoreAll('invoices', { filters: { studentId } }, { enabled: studentId !== '' })
  const [mode, setMode] = useState<Mode>('view')
  const back = () => setMode('view')
  const approval = useContractApproval({
    successMessage: 'Ödeyici onayı ıslak imzayla işlendi.',
    onSuccess: back,
    onConflict: back,
  })

  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  if (versions.error)
    return <QueryError error={versions.error} onRetry={() => void versions.refetch()} />
  if (!item.data || !versions.data)
    return (
      <>
        <SummaryLoading />
        {approval.reauthModal}
      </>
    )

  const contract = item.data.record
  const version = item.data.version
  // Panelin kaydı listedekinden tazedir; durum öğrencinin bütün sürümleriyle türetilir.
  const all = [
    contract,
    ...versions.data.map((row) => row.record).filter((row) => row.id !== contract.id),
  ]
  const status = contractStatus(contract, all)
  const role = session?.role
  const actions = role
    ? contractActions(contract, all, role)
    : { sign: false, approve: false, amend: false, cancelAmendment: false }
  const previous = all.find((row) => row.id === contract.amendsContractId)
  const amendments = all.filter(
    (row) => row.amendsContractId === contract.id && row.cancelledAt === undefined,
  )
  const target = { contractId: contract.id, version }
  const invoiceRows = invoices.data?.map((row) => row.record)

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold [overflow-wrap:anywhere]">{contract.title}</h3>
          <p className="text-sm text-muted-foreground">{contractVersionLabel(contract)}</p>
        </div>
        <ContractStatusBadge status={status} />
      </div>
      <ContractFacts
        contract={contract}
        status={status}
        studentName={item.data.joined?.studentName}
      />
      <StatusNote status={status} canSign={actions.sign} contract={contract} />
      {invoices.error ? (
        <QueryError error={invoices.error} onRetry={() => void invoices.refetch()} />
      ) : invoiceRows ? (
        <ContractPlanTable contract={contract} invoices={invoiceRows} />
      ) : (
        <p role="status" className="mb-6 text-sm text-muted-foreground">
          Ödeme planı yükleniyor…
        </p>
      )}

      {mode === 'sign' ? <SignatoryForm contract={contract} target={target} onDone={back} /> : null}
      {mode === 'approve' ? (
        <WetSignatureForm approval={approval} target={target} onCancel={back} />
      ) : null}
      {mode === 'amend' && invoiceRows ? (
        <AmendmentForm
          contract={contract}
          invoices={invoiceRows}
          target={target}
          onCancel={back}
          onCreated={onOpen}
        />
      ) : null}
      {mode === 'cancel' ? <CancelAmendmentForm target={target} onDone={back} /> : null}

      {mode === 'view' ? (
        <div className="detail-actions flex flex-wrap gap-2">
          {actions.sign ? (
            <Button onClick={() => setMode('sign')}>
              <Icon name="Pencil" size={17} aria-hidden="true" />
              {contract.signatory ? 'İmza yetkilisini düzelt' : 'İmza yetkilisini işle'}
            </Button>
          ) : null}
          {actions.approve ? (
            <Button onClick={() => setMode('approve')}>
              <Icon name="CircleCheck" size={17} aria-hidden="true" />
              Islak imzalı onayı işle
            </Button>
          ) : null}
          {actions.amend ? (
            <Button variant="secondary" disabled={!invoiceRows} onClick={() => setMode('amend')}>
              <Icon name="Plus" size={17} aria-hidden="true" />
              Ek protokol hazırla
            </Button>
          ) : null}
          {actions.cancelAmendment ? (
            <Button variant="outline" onClick={() => setMode('cancel')}>
              Ek protokolü iptal et
            </Button>
          ) : null}
          <PdfButton
            type="contract"
            recordId={contract.id}
            label="Sözleşmeyi görüntüle"
            variant="outline"
            size="default"
          />
          {previous ? (
            <Button variant="ghost" onClick={() => onOpen(previous.id)}>
              Önceki sürümü aç
            </Button>
          ) : null}
          {amendments.map((row) => (
            <Button key={row.id} variant="ghost" onClick={() => onOpen(row.id)}>
              {contractVersionLabel(row)} aç
            </Button>
          ))}
        </div>
      ) : null}
      {approval.reauthModal}
    </>
  )
}

function StatusNote({
  status,
  canSign,
  contract,
}: {
  status: ContractStatus
  canSign: boolean
  contract: ContractRecord
}) {
  let text: string | null = null
  if (status === 'awaiting_signatory')
    text = canSign
      ? 'Onaydan önce kurumu bağlayan kurucu ya da kurucu temsilcisini işleyin.'
      : 'Onay için önce yöneticinin imza yetkilisini işlemesi gerekir.'
  else if (status === 'awaiting_approval')
    text =
      'Veli kendi hesabından elektronik onay verebilir; kâğıt üzerinde imzalandıysa ıslak imzalı onayı işleyin.'
  else if (status === 'approved')
    text =
      'Onaylanmış sözleşmenin tutarı ve planı değiştirilemez; değişiklik ek protokolle yeni sürüm olarak yapılır.'
  else if (status === 'superseded')
    text = 'Bu sürümün yerini onaylı bir ek protokol aldı; salt okunur geçmiştir.'
  else if (contract.cancelledAt) text = 'İptal edilen ek protokol hiçbir taksiti değiştirmedi.'
  return text ? <p className="mb-5 text-sm text-muted-foreground">{text}</p> : null
}

interface FormProps {
  target: { contractId: string; version: number }
  onDone: () => void
}

/** Kurucu ya da kurucu temsilcisi (ÖÖKY m.31/4); onaya kadar düzeltilebilir. */
function SignatoryForm({ contract, target, onDone }: FormProps & { contract: ContractRecord }) {
  const sign = useSetContractSignatory()
  const form = useForm<ContractSignatoryInput>({
    resolver: zodResolver(contractSignatorySchema),
    defaultValues: {
      name: contract.signatory?.name ?? '',
      role: contract.signatory?.role ?? 'founder',
    },
  })
  const busy = sign.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await sign.submit(
      { ...target, body: values },
      { setError: fieldErrors(form, ['name', 'role']) },
    )
    if (outcome.status === 'success') {
      notify.success('İmza yetkilisi işlendi.')
      onDone()
    } else if (outcome.status === 'failed' && outcome.error.status === 409) onDone()
  })
  return (
    <form
      noValidate
      aria-label="İmza yetkilisi"
      onSubmit={(event) => void onSubmit(event)}
      className="grid gap-4 border-t pt-5"
    >
      <h4 className="font-semibold">İmza yetkilisi</h4>
      <FormField id="sozlesme-imza-ad" label="Ad soyad" error={errors.name}>
        {(control) => (
          <Input {...control} {...form.register('name')} autoComplete="off" disabled={busy} />
        )}
      </FormField>
      <FormField id="sozlesme-imza-sifat" label="Sıfat" error={errors.role}>
        {(control) => (
          <NativeSelect {...control} {...form.register('role')} className="w-full" disabled={busy}>
            {SIGNATORY_ROLES.map((role) => (
              <NativeSelectOption key={role} value={role}>
                {SIGNATORY_ROLE_LABELS[role]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <FormButtons busy={busy} onCancel={onDone} submit="İmza yetkilisini kaydet" />
    </form>
  )
}

/**
 * Görevli kâğıt üzerindeki ıslak imzayı işler; biçim rolden gelir (core `approveContract`). Onay
 * borç doğurduğu için taze oturum ister; gönderim ve parola akışı `ContractDetail`'deki
 * `useContractApproval`'dadır (yükleme sırasında sökülmez).
 */
function WetSignatureForm({
  approval,
  target,
  onCancel,
}: {
  approval: ContractApproval
  target: FormProps['target']
  onCancel: () => void
}) {
  const { form, busy } = approval
  const errors = form.formState.errors
  const onSubmit = approval.submitFor(target)
  return (
    <>
      <form
        noValidate
        aria-label="Islak imzalı onay"
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4 border-t pt-5"
      >
        <h4 className="font-semibold">Ödeyici onayı</h4>
        <p className="text-sm">
          Onay biçimi: <strong>{CONTRACT_APPROVAL_METHOD_LABELS.wet_signature}</strong>. Onaydan
          sonra tutar ve plan değiştirilemez; plan onay anındaki hâliyle belgeye yazılır.
        </p>
        <AcceptCheckbox
          id="sozlesme-islak-imza"
          label="Ödeyicinin ıslak imzalı sözleşmesini teslim aldım"
          registration={form.register('accepted')}
          error={errors.accepted?.message}
          disabled={busy}
        />
        <RootError message={errors.root?.server?.message} />
        <FormButtons busy={busy} onCancel={onCancel} submit="Onayı işle" />
      </form>
    </>
  )
}

/**
 * Ek protokol taslağı: tahsil edilmiş taksitler ve ek hizmetler korunur, kalan net yeni plana
 * dağıtılır; önceki sürüm ve taksitler ek protokol onaylanana kadar değişmez.
 */
function AmendmentForm({
  contract,
  invoices,
  target,
  onCancel,
  onCreated,
}: {
  contract: ContractRecord
  invoices: readonly InvoiceRecord[]
  target: FormProps['target']
  onCancel: () => void
  onCreated: (contractId: string) => void
}) {
  const amend = useAmendContract()
  const [today] = useState(() => dayKey())
  const form = useForm<AmendmentFormValues, unknown, z.output<typeof amendmentFormSchema>>({
    resolver: zodResolver(amendmentFormSchema),
    defaultValues: amendmentDefaults(contract, invoices, today),
  })
  const changeDiscounts = useWatch({ control: form.control, name: 'changeDiscounts' })
  const busy = amend.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const reprice = canRepriceContract(contract)
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await amend.submit(
      { ...target, body: amendmentBody(values) },
      {
        setError: fieldErrors(form, ['reason', 'installmentCount', 'firstDueDate', 'discounts']),
      },
    )
    if (outcome.status === 'success') {
      notify.success('Ek protokol taslağı açıldı. İmza yetkilisini işleyip ödeyici onayını alın.')
      const created = outcome.data.data.entity?.id
      if (created) onCreated(created)
      else onCancel()
    } else if (outcome.status === 'failed' && outcome.error.status === 409) onCancel()
  })
  return (
    <form
      noValidate
      aria-label="Ek protokol"
      onSubmit={(event) => void onSubmit(event)}
      className="grid gap-4 border-t pt-5"
    >
      <h4 className="font-semibold">Ek protokol</h4>
      <p className="text-sm text-muted-foreground">
        Tahsil edilmiş taksitler ve ek hizmetler korunur; kalan tutar yeni plana bölünür. Yeni plan
        ek protokol onaylanınca taksitlere geçer.
      </p>
      <FormField id="ek-protokol-gerekce" label="Gerekçe" error={errors.reason}>
        {(control) => (
          <Textarea {...control} {...form.register('reason')} rows={3} disabled={busy} />
        )}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="ek-protokol-taksit" label="Taksit sayısı" error={errors.installmentCount}>
          {(control) => (
            <Input
              {...control}
              {...form.register('installmentCount')}
              inputMode="numeric"
              disabled={busy}
            />
          )}
        </FormField>
        <FormField id="ek-protokol-vade" label="İlk vade" error={errors.firstDueDate}>
          {(control) => (
            <Input
              {...control}
              {...form.register('firstDueDate')}
              type="date"
              min={today}
              disabled={busy}
            />
          )}
        </FormField>
      </div>
      {reprice ? (
        <fieldset className="grid gap-2 text-sm" aria-describedby="ek-protokol-indirim-hata">
          <legend className="mb-1 font-medium">İndirimler</legend>
          <label className="flex min-h-6 items-center gap-2">
            <input
              type="checkbox"
              className="size-4"
              {...form.register('changeDiscounts')}
              disabled={busy}
            />
            İndirimleri tarifeden yeniden hesapla
          </label>
          {changeDiscounts
            ? FEE_DISCOUNT_KINDS.map((kind) => (
                <label key={kind} className="ml-6 flex min-h-6 items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4"
                    value={kind}
                    {...form.register('discounts')}
                    disabled={busy}
                  />
                  {FEE_DISCOUNT_KIND_LABELS[kind]}
                </label>
              ))
            : null}
          {errors.discounts?.message ? (
            <p id="ek-protokol-indirim-hata" role="alert" className="text-sm text-danger">
              {errors.discounts.message}
            </p>
          ) : null}
        </fieldset>
      ) : null}
      <RootError message={errors.root?.server?.message} />
      <FormButtons busy={busy} onCancel={onCancel} submit="Ek protokolü hazırla" />
    </form>
  )
}

/** Onaylanmamış ek protokolü gerekçeyle kapatır; kayıt silinmez, önceki sürüm yürürlükte kalır. */
function CancelAmendmentForm({ target, onDone }: FormProps) {
  const cancel = useCancelContractAmendment()
  const form = useForm<CancelAmendmentInput>({
    resolver: zodResolver(cancelAmendmentSchema),
    defaultValues: { reason: '' },
  })
  const busy = cancel.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await cancel.submit(
      { ...target, body: values },
      { setError: fieldErrors(form, ['reason']) },
    )
    if (outcome.status === 'success') {
      notify.success('Ek protokol iptal edildi.')
      onDone()
    } else if (outcome.status === 'failed' && outcome.error.status === 409) onDone()
  })
  return (
    <form
      noValidate
      aria-label="Ek protokol iptali"
      onSubmit={(event) => void onSubmit(event)}
      className="grid gap-4 border-t pt-5"
    >
      <h4 className="font-semibold">Ek protokolü iptal et</h4>
      <FormField id="ek-protokol-iptal-gerekce" label="İptal gerekçesi" error={errors.reason}>
        {(control) => (
          <Textarea {...control} {...form.register('reason')} rows={3} disabled={busy} />
        )}
      </FormField>
      <RootError message={errors.root?.server?.message} />
      <FormButtons busy={busy} onCancel={onDone} submit="Ek protokolü iptal et" />
    </form>
  )
}

function FormButtons({
  busy,
  onCancel,
  submit,
}: {
  busy: boolean
  onCancel: () => void
  submit: string
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
        {submit}
      </Button>
      <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
        Vazgeç
      </Button>
    </div>
  )
}
