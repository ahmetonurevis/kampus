import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useSearchParams } from 'react-router'
import { z } from 'zod'
import {
  completeRefundInvoiceSchema,
  discardRefundInvoiceSchema,
  ORIGINAL_INVOICE_TYPE_LABELS,
  ORIGINAL_INVOICE_TYPES,
  REFUND_DOCUMENT_KIND_LABELS,
  REFUND_DOCUMENT_KINDS,
  REFUND_DOCUMENT_STATUS_LABELS,
  REFUND_DOCUMENT_STATUSES,
  REFUND_INVOICE_AMOUNT_MAX,
  refundInvoiceFormField,
  refundInvoiceFormSchema,
  refundInvoiceFormToInput,
  suggestRefundDocumentKind,
  cancelWindowEndsOn,
  type RefundDocumentKind,
  type RefundDocumentStatus,
  type RefundInvoiceFormValues,
} from '@kampus/school-core/lib/finance-refund-invoices.ts'
import { dateLabel, dayKey, money } from '@kampus/school-core/lib/format.ts'
import { amountInputValue, parseAmountInput } from '@kampus/school-core/lib/payments.ts'
import {
  useCreateRefundInvoice,
  useRefundInvoices,
  useRefundInvoicesExport,
  useRefundInvoiceStep,
  useRefundInvoiceWithdrawal,
  type RefundInvoice,
} from '@kampus/react-shared/use-finance-refund-invoices.ts'
import { REAUTHENTICATION_CODE } from '@kampus/react-shared/use-withdrawals.ts'
import { ReauthModal } from '@/auth/ReauthModal.tsx'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useListState } from '@/hooks/use-list-state.ts'
import { saveBlob } from '@/lib/download.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { REFUND_INVOICE_WITHDRAWAL_PARAM } from './finance-refund-invoices.ts'

type Row = {
  id: string
  studentName: string
  kind: string
  original: string
  amount: string
  status: RefundDocumentStatus
  statusLabel: string
  cancelUntil: string
  doc: RefundInvoice
}

const NO_SORT: readonly string[] = []
const MOBILE = ['studentName', 'kind', 'status']
const URL_FILTERS = { status: 'belge_durum' } as const
const BOM = '﻿'
const STATUS_TONES: Readonly<Record<RefundDocumentStatus, 'gray' | 'amber' | 'green' | 'purple'>> =
  { draft: 'gray', ready: 'amber', sent: 'green', cancelled: 'purple' }
const VAT_LABELS = { '0': '%0', '100': '%1', '1000': '%10', '2000': '%20' } as const
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const isStatus = (value: string | null): value is RefundDocumentStatus =>
  value !== null && (REFUND_DOCUMENT_STATUSES as readonly string[]).includes(value)
const isKind = (value: string | null): value is RefundDocumentKind =>
  value !== null && (REFUND_DOCUMENT_KINDS as readonly string[]).includes(value)
const day = (value: string) => dateLabel(value, { year: 'numeric' })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * İade belgeleri (`?gorunum=iade-belgesi`; DOM-FIN-096, ON-266, K-292…K-295). Yalnız yönetici.
 * Ödenmiş iadenin faturası için iptal isteği ya da iade faturası taslağı hazırlanır, gönderime
 * hazır işaretlenir; entegratör bağlantısı olmadığından hazır belgeler CSV ile indirilir ve
 * entegratör portalındaki sonuç ("Sonucu işle") elle girilir. Ayrılış listesindeki "İade belgesi"
 * bağlantısı `?iade_kaydi=` ile o iadeyi seçer.
 */
export function FinanceRefundInvoicesSection() {
  const [params, setParams] = useSearchParams()
  const raw = params.get(REFUND_INVOICE_WITHDRAWAL_PARAM)
  const withdrawalId = raw !== null && UUID.test(raw) ? raw : null
  const list = useListState('iade-belgeleri', { urlFilters: URL_FILTERS })
  const status = text(list.state.filters.status)
  const kind = text(list.state.filters.kind)
  const filter = {
    ...(isStatus(status) ? { status } : {}),
    ...(isKind(kind) ? { kind } : {}),
  }
  const documents = useRefundInvoices({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...filter,
    ...(withdrawalId === null ? {} : { withdrawalId }),
  })
  const withdrawal = useRefundInvoiceWithdrawal(withdrawalId)
  const exporter = useRefundInvoicesExport()
  const [creating, setCreating] = useState(false)
  const [completing, setCompleting] = useState<RefundInvoice | null>(null)
  const [discarding, setDiscarding] = useState<RefundInvoice | null>(null)
  const [reauth, setReauth] = useState(false)

  async function download() {
    const outcome = await exporter.submit(filter)
    if (outcome.status === 'failed' && outcome.error.code === REAUTHENTICATION_CODE) setReauth(true)
    if (outcome.status !== 'success') return
    // Yanıt çözülürken BOM düşer; Excel Türkçe karakterleri onunla tanır.
    const csv = String(outcome.data).replace(BOM, '')
    saveBlob(
      new Blob([BOM, csv], { type: 'text/csv;charset=utf-8' }),
      `iade-belgeleri-${dayKey()}.csv`,
    )
    notify.success('Dosya indirildi.')
  }

  const filters = useMemo(
    () => [
      {
        key: 'status',
        label: 'Durum',
        type: 'select' as const,
        options: REFUND_DOCUMENT_STATUSES.map((value) => ({
          value,
          label: REFUND_DOCUMENT_STATUS_LABELS[value],
        })),
      },
      {
        key: 'kind',
        label: 'Belge türü',
        type: 'select' as const,
        options: REFUND_DOCUMENT_KINDS.map((value) => ({
          value,
          label: REFUND_DOCUMENT_KIND_LABELS[value],
        })),
      },
    ],
    [],
  )
  const rows = useMemo(
    () =>
      documents.data?.data.map((doc): Row => ({
        id: doc.id,
        studentName: doc.studentName ?? '—',
        kind: REFUND_DOCUMENT_KIND_LABELS[doc.kind],
        original: `${doc.originalInvoice.number} · ${day(doc.originalInvoice.date)}`,
        amount: money(doc.amountCents),
        status: doc.status,
        statusLabel: REFUND_DOCUMENT_STATUS_LABELS[doc.status],
        cancelUntil: doc.kind === 'cancellation' ? day(doc.cancelWindowEndsOn) : '—',
        doc,
      })) ?? [],
    [documents.data],
  )
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'studentName', label: 'Öğrenci' },
      { key: 'kind', label: 'Belge' },
      { key: 'original', label: 'Asıl fatura' },
      { key: 'amount', label: 'Tutar (KDV dahil)' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <span className="flex flex-col gap-1">
            <StatusBadge text={row.statusLabel} tone={STATUS_TONES[row.status]} />
            {row.doc.documentNumber ? (
              <span className="text-sm text-muted-foreground">{row.doc.documentNumber}</span>
            ) : null}
          </span>
        ),
      },
      { key: 'cancelUntil', label: 'İptal son günü' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <span className="flex flex-wrap gap-2">
            {row.doc.actions.ready ? <ReadyButton doc={row.doc} label={row.studentName} /> : null}
            {row.doc.actions.complete ? (
              <Button
                size="sm"
                aria-label={`${row.studentName} belgesinin sonucunu işle`}
                onClick={() => setCompleting(row.doc)}
              >
                Sonucu işle
              </Button>
            ) : null}
            {row.doc.actions.discard ? (
              <Button
                size="sm"
                variant="secondary"
                aria-label={`${row.studentName} belgesinden vazgeç`}
                onClick={() => setDiscarding(row.doc)}
              >
                Vazgeç
              </Button>
            ) : null}
          </span>
        ),
      },
    ],
    [],
  )

  const selected = withdrawal.data?.data
  const hasDocument = (documents.data?.meta.total ?? 0) > 0
  const canCreate =
    selected !== undefined &&
    selected.refundStatus === 'paid' &&
    !hasDocument &&
    !documents.isPending
  return (
    <section
      aria-labelledby="iade-belgeleri"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h2 id="iade-belgeleri" className="text-lg font-semibold">
            İade belgeleri
          </h2>
          <p className="text-sm text-muted-foreground">
            Ödenen iadenin faturası için iptal isteği ya da iade faturası. Entegratör bağlantısı
            olmadığından hazır belgeler dosyayla aktarılır, sonuç elle işlenir.
          </p>
          {withdrawalId !== null ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              {withdrawal.error ? (
                <QueryError error={withdrawal.error} onRetry={() => void withdrawal.refetch()} />
              ) : selected ? (
                <span>
                  Seçili iade: <strong>{selected.studentName ?? '—'}</strong> ·{' '}
                  {money(selected.refundCents)}
                  {selected.refundPaidDate ? ` · ödendi ${day(selected.refundPaidDate)}` : ''}
                </span>
              ) : null}
              {selected && selected.refundStatus !== 'paid' ? (
                <span className="text-muted-foreground">İade ödenmeden belge hazırlanmaz.</span>
              ) : null}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const next = new URLSearchParams(params)
                  next.delete(REFUND_INVOICE_WITHDRAWAL_PARAM)
                  setParams(next)
                }}
              >
                Tüm belgeler
              </Button>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => void download()}
            disabled={exporter.isPending}
            aria-busy={exporter.isPending || undefined}
          >
            <Icon name="Download" size={17} aria-hidden="true" />
            CSV indir
          </Button>
          {canCreate ? (
            <Button onClick={() => setCreating(true)}>
              <Icon name="Plus" size={17} aria-hidden="true" />
              Belge hazırla
            </Button>
          ) : null}
        </div>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={documents.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={filters}
        mobileColumns={MOBILE}
        caption="İade faturaları ve iptal istekleri"
        empty={
          withdrawalId === null
            ? 'Henüz iade belgesi yok. Ayrılış ve iade listesinde ödenmiş iadeden başlayın.'
            : 'Bu iade için belge yok.'
        }
        emptyFiltered="Bu seçimle eşleşen belge yok."
        loading={documents.isPending}
        fetching={documents.isFetching && !documents.isPending}
        error={
          documents.error ? (
            <QueryError error={documents.error} onRetry={() => void documents.refetch()} />
          ) : undefined
        }
      />
      {creating && selected ? (
        <CreateModal
          withdrawal={{
            id: selected.id,
            studentName: selected.studentName ?? '—',
            refundCents: selected.refundCents,
            refundPaidDate: selected.refundPaidDate ?? dayKey(),
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}
      {completing ? <CompleteModal doc={completing} onClose={() => setCompleting(null)} /> : null}
      {discarding ? <DiscardModal doc={discarding} onClose={() => setDiscarding(null)} /> : null}
      {reauth ? (
        <ReauthModal
          onCancel={() => setReauth(false)}
          onDone={() => {
            setReauth(false)
            void download()
          }}
        />
      ) : null}
    </section>
  )
}

/** Taslağı gönderime hazır işaretler (K-294); gönderim sürerken düğme kilitlidir. */
function ReadyButton({ doc, label }: { doc: RefundInvoice; label: string }) {
  const step = useRefundInvoiceStep()
  async function markReady() {
    const outcome = await step.submit({ action: 'ready', id: doc.id, version: doc.version })
    if (outcome.status === 'success') notify.success('Belge gönderime hazır.')
  }
  return (
    <Button
      size="sm"
      disabled={step.isPending}
      aria-busy={step.isPending || undefined}
      aria-label={`${label} belgesini gönderime hazır işaretle`}
      onClick={() => void markReady()}
    >
      Hazır işaretle
    </Button>
  )
}

const CREATE_FORM = 'iade-belgesi-formu'

/**
 * Taslak formu (K-292, K-293): asıl faturanın bilgileri elle girilir; önerilen tür girilen gün,
 * tutar ve fatura türüne göre canlı gösterilir. Belge tutarı öntanımlı olarak iade tutarıdır.
 */
function CreateModal({
  withdrawal,
  onClose,
}: {
  withdrawal: { id: string; studentName: string; refundCents: number; refundPaidDate: string }
  onClose: () => void
}) {
  const create = useCreateRefundInvoice()
  const today = dayKey()
  const form = useForm<RefundInvoiceFormValues, unknown, z.output<typeof refundInvoiceFormSchema>>({
    resolver: zodResolver(refundInvoiceFormSchema),
    defaultValues: {
      kind: 'suggested',
      originalNumber: '',
      originalDate: withdrawal.refundPaidDate,
      originalType: 'e_archive',
      originalTotal: '',
      vatRate: '1000',
      amount: amountInputValue(withdrawal.refundCents),
      note: '',
    },
  })
  const errors = form.formState.errors
  const busy = create.isPending || form.formState.isSubmitting
  const [originalDate, originalType, originalTotal, amount] = useWatch({
    control: form.control,
    name: ['originalDate', 'originalType', 'originalTotal', 'amount'],
  })
  const totalCents = parseAmountInput(originalTotal, { maxCents: REFUND_INVOICE_AMOUNT_MAX })
  const amountCents = parseAmountInput(amount, { maxCents: REFUND_INVOICE_AMOUNT_MAX })
  const suggestion =
    totalCents !== null && amountCents !== null && /^\d{4}-\d{2}-\d{2}$/.test(originalDate)
      ? {
          kind: suggestRefundDocumentKind({
            original: { date: originalDate, type: originalType, totalCents },
            amountCents,
            today,
          }),
          until: cancelWindowEndsOn({ date: originalDate, type: originalType }),
        }
      : null

  async function send(values: z.output<typeof refundInvoiceFormSchema>) {
    const outcome = await create.submit(refundInvoiceFormToInput(withdrawal.id, values), {
      setError: (name, error) => {
        const field = refundInvoiceFormField(name)
        form.setError(field ?? 'root.server', error)
      },
    })
    if (outcome.status === 'success') {
      notify.success(`${REFUND_DOCUMENT_KIND_LABELS[outcome.data.data.kind]} taslağı hazırlandı.`)
      onClose()
    }
  }
  const onSubmit = form.handleSubmit((values) => send(values))

  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="İade belgesi hazırla"
      description={`${withdrawal.studentName} · iade ${money(withdrawal.refundCents)}. Asıl faturanın bilgilerini entegratör ya da muhasebe programındaki faturadan girin.`}
      size="wide"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={CREATE_FORM} disabled={busy} aria-busy={busy || undefined}>
            Taslağı kaydet
          </Button>
        </>
      }
    >
      <form
        id={CREATE_FORM}
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4 sm:grid-cols-2"
      >
        <FormField id="asil-fatura-no" label="Asıl fatura no" error={errors.originalNumber}>
          {(control) => (
            <Input
              {...control}
              {...form.register('originalNumber')}
              autoComplete="off"
              placeholder="ABC2026000000001"
            />
          )}
        </FormField>
        <FormField id="asil-fatura-tarih" label="Asıl fatura tarihi" error={errors.originalDate}>
          {(control) => (
            <Input {...control} {...form.register('originalDate')} type="date" max={today} />
          )}
        </FormField>
        <FormField id="asil-fatura-tur" label="Asıl fatura türü" error={errors.originalType}>
          {(control) => (
            <NativeSelect {...control} {...form.register('originalType')}>
              {ORIGINAL_INVOICE_TYPES.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {ORIGINAL_INVOICE_TYPE_LABELS[value]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="asil-fatura-kdv" label="KDV oranı" error={errors.vatRate}>
          {(control) => (
            <NativeSelect {...control} {...form.register('vatRate')}>
              {Object.entries(VAT_LABELS).map(([value, label]) => (
                <NativeSelectOption key={value} value={value}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField
          id="asil-fatura-tutar"
          label="Asıl fatura tutarı (KDV dahil, ₺)"
          error={errors.originalTotal}
        >
          {(control) => (
            <Input {...control} {...form.register('originalTotal')} inputMode="decimal" />
          )}
        </FormField>
        <FormField
          id="iade-belgesi-tutar"
          label="Belge tutarı (KDV dahil, ₺)"
          error={errors.amount}
          description="İade tutarını ve asıl faturanın tutarını aşamaz."
        >
          {(control) => <Input {...control} {...form.register('amount')} inputMode="decimal" />}
        </FormField>
        <FormField
          id="iade-belgesi-tur"
          label="Belge türü"
          error={errors.kind}
          description={
            suggestion
              ? `Öneri: ${REFUND_DOCUMENT_KIND_LABELS[suggestion.kind]} (iptal son günü ${day(suggestion.until)}).`
              : 'Öneri asıl faturanın tarihi ve tutarı girilince görünür.'
          }
        >
          {(control) => (
            <NativeSelect {...control} {...form.register('kind')}>
              <NativeSelectOption value="suggested">Önerilen</NativeSelectOption>
              {REFUND_DOCUMENT_KINDS.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {REFUND_DOCUMENT_KIND_LABELS[value]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="iade-belgesi-not" label="Not" error={errors.note}>
          {(control) => <Textarea {...control} {...form.register('note')} rows={2} />}
        </FormField>
        <div className="sm:col-span-2">
          <RootError message={errors.root?.server?.message} />
        </div>
      </form>
    </Modal>
  )
}

const COMPLETE_FORM = 'iade-belgesi-sonuc'
const completeFormSchema = z.object({
  completedDate: completeRefundInvoiceSchema.shape.completedDate,
  documentNumber: z.string().trim(),
})

/** Entegratör portalındaki sonucu işler (K-294): iade faturasında numara zorunludur. */
function CompleteModal({ doc, onClose }: { doc: RefundInvoice; onClose: () => void }) {
  const step = useRefundInvoiceStep()
  const today = dayKey()
  const isInvoice = doc.kind === 'return_invoice'
  const form = useForm<
    z.input<typeof completeFormSchema>,
    unknown,
    z.output<typeof completeFormSchema>
  >({
    resolver: zodResolver(completeFormSchema),
    defaultValues: { completedDate: today, documentNumber: '' },
  })
  const errors = form.formState.errors
  const busy = step.isPending || form.formState.isSubmitting

  async function send(values: z.output<typeof completeFormSchema>) {
    const outcome = await step.submit(
      {
        action: 'complete',
        id: doc.id,
        version: doc.version,
        body: {
          completedDate: values.completedDate,
          ...(isInvoice ? { documentNumber: values.documentNumber } : {}),
        },
      },
      {
        setError: (name, error) =>
          form.setError(
            name === 'completedDate' || name === 'documentNumber' ? name : 'root.server',
            error,
          ),
      },
    )
    if (outcome.status === 'success') {
      notify.success(isInvoice ? 'İade faturası gönderildi olarak işlendi.' : 'İptal işlendi.')
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  }
  const onSubmit = form.handleSubmit((values) => send(values))

  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Sonucu işle"
      description={`${doc.studentName ?? '—'} · ${REFUND_DOCUMENT_KIND_LABELS[doc.kind]} · ${money(doc.amountCents)}. İşlenen sonuç değiştirilemez.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={COMPLETE_FORM} disabled={busy} aria-busy={busy || undefined}>
            {isInvoice ? 'Gönderildi olarak kaydet' : 'İptal edildi olarak kaydet'}
          </Button>
        </>
      }
    >
      <form
        id={COMPLETE_FORM}
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField
          id="iade-belgesi-sonuc-gun"
          label={isInvoice ? 'İade faturası tarihi' : 'İptal günü'}
          error={errors.completedDate}
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('completedDate')}
              type="date"
              min={doc.originalInvoice.date}
              max={today}
            />
          )}
        </FormField>
        {isInvoice ? (
          <FormField id="iade-faturasi-no" label="İade faturası no" error={errors.documentNumber}>
            {(control) => (
              <Input {...control} {...form.register('documentNumber')} autoComplete="off" />
            )}
          </FormField>
        ) : null}
        <RootError message={errors.root?.server?.message} />
      </form>
    </Modal>
  )
}

const DISCARD_FORM = 'iade-belgesi-vazgec'

/** Taslaktan ya da hazır belgeden gerekçeyle vazgeçme (K-294); aynı iade için yeni belge açılabilir. */
function DiscardModal({ doc, onClose }: { doc: RefundInvoice; onClose: () => void }) {
  const step = useRefundInvoiceStep()
  const form = useForm<
    z.input<typeof discardRefundInvoiceSchema>,
    unknown,
    z.output<typeof discardRefundInvoiceSchema>
  >({ resolver: zodResolver(discardRefundInvoiceSchema), defaultValues: { reason: '' } })
  const errors = form.formState.errors
  const busy = step.isPending || form.formState.isSubmitting

  async function send(values: z.output<typeof discardRefundInvoiceSchema>) {
    const outcome = await step.submit(
      { action: 'discard', id: doc.id, version: doc.version, body: values },
      {
        setError: (name, error) =>
          form.setError(name === 'reason' ? 'reason' : 'root.server', error),
      },
    )
    if (outcome.status === 'success') {
      notify.success('Belgeden vazgeçildi.')
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  }
  const onSubmit = form.handleSubmit((values) => send(values))

  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Belgeden vazgeç"
      description={`${doc.studentName ?? '—'} · ${REFUND_DOCUMENT_KIND_LABELS[doc.kind]}. Belge arşivlenir; aynı iade için yeni belge hazırlanabilir.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Kapat
          </Button>
          <Button type="submit" form={DISCARD_FORM} disabled={busy} aria-busy={busy || undefined}>
            Vazgeç
          </Button>
        </>
      }
    >
      <form
        id={DISCARD_FORM}
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField id="iade-belgesi-gerekce" label="Gerekçe" error={errors.reason}>
          {(control) => <Textarea {...control} {...form.register('reason')} rows={3} />}
        </FormField>
        <RootError message={errors.root?.server?.message} />
      </form>
    </Modal>
  )
}
