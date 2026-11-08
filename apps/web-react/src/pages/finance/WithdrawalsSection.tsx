import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { dateLabel, dayKey, money } from '@kampus/school-core/lib/format.ts'
import { bankAccountLabel } from '@kampus/school-core/lib/payments.ts'
import {
  contractLineRows,
  contractLinesToShow,
  paidTuitionLabel,
  payerDecisionSchema,
  payRefundSchema,
  refundApprovalRequired,
  refundPayerOptions,
  WITHDRAWAL_PAYER_LABELS,
  WITHDRAWAL_REASON_LABELS,
  WITHDRAWAL_REASONS,
  withdrawalFormSchema,
  withdrawalTargetLabel,
  type PayerDecisionInput,
  type PayRefundInput,
  type PayRefundOutput,
  type WithdrawalBreakdown,
  type WithdrawalContractPayer,
  type WithdrawalFormValues,
  type WithdrawalReason,
} from '@kampus/school-core/lib/withdrawals.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import { useBankAccounts } from '@kampus/react-shared/use-payment-commands.ts'
import {
  REAUTHENTICATION_CODE,
  usePayRefund,
  useQuoteWithdrawal,
  useWithdrawals,
  useWithdrawStudent,
} from '@kampus/react-shared/use-withdrawals.ts'
import { ReauthModal } from '@/auth/ReauthModal.tsx'
import { useAuth } from '@/auth/use-auth.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { PdfButton } from '@/components/PdfButton.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useEnrollmentLearner } from '@/hooks/use-enrollment-learner.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { SummaryLoading } from '../management/SummaryParts.tsx'

type WithdrawalRow = {
  id: string
  studentName: string
  withdrawalDate: string
  reason: WithdrawalReason
  reasonLabel: string
  refundCents: number
  debtCents: number
  refundDueDate: string
  refundStatus: 'none' | 'pending' | 'paid'
  statusLabel: string
  maskedIban: string | null
  breakdown: WithdrawalBreakdown
  version: number
}

const STATUS_LABELS = { none: 'İade yok', pending: 'Ödenecek', paid: 'Ödendi' } as const
const NO_SORT: readonly string[] = []
const MOBILE_COLUMNS = ['studentName', 'refundCents', 'statusLabel']
const START_FORM = 'ayrilis-formu'
/** İade durumu adreste de tutulur: açılış nöbeti bekleyen iadelere bağlanır (DOM-FIN-061). */
const WITHDRAWAL_URL_FILTERS = { refundStatus: 'iade' }
const REFUND_FORM = 'iade-formu'

/**
 * Ayrılış ve iade (ADR 0006 karar 10; DOM-FIN-040, -041; DOM-KAY-024; IST-110). Son günü en yakın
 * iade önce gelir. Yönetici hesabı önizler, onaylar ve iadeyi ödenmiş işaretler; ön büro yalnız
 * listeyi görür. Onay ve ödeme taze oturum ister: oturum eskiyse parola sorulup işlem tekrarlanır.
 * Paket içeren ayrılışta yönetici iade tutarını görüp ayrıca onaylar; kullanılan saat girilmemişse
 * önizleme açık uyarı verir (K-21).
 */
const isRefundStatus = (value: unknown): value is keyof typeof STATUS_LABELS =>
  typeof value === 'string' && Object.hasOwn(STATUS_LABELS, value)

export function WithdrawalsSection({ canManage }: { canManage: boolean }) {
  const learner = useEnrollmentLearner()
  const list = useListState('ayrilislar', { urlFilters: WITHDRAWAL_URL_FILTERS })
  // Öğrenci adı araması ve iade durumu sunucuda süzülür (ON-118).
  const search = useDebouncedValue(list.state.query)
  const refundStatus = isRefundStatus(list.state.filters.refundStatus)
    ? list.state.filters.refundStatus
    : null
  const withdrawals = useWithdrawals({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.trim().length >= 2 ? { q: search.trim() } : {}),
    ...(refundStatus ? { refundStatus } : {}),
  })
  const [starting, setStarting] = useState(false)
  const [paying, setPaying] = useState<WithdrawalRow | null>(null)
  const [viewing, setViewing] = useState<WithdrawalRow | null>(null)

  const rows = useMemo(
    () =>
      withdrawals.data?.data.map((item): WithdrawalRow => ({
        id: item.id,
        studentName: item.studentName ?? '—',
        withdrawalDate: item.withdrawalDate,
        reason: item.reason,
        reasonLabel: WITHDRAWAL_REASON_LABELS[item.reason],
        refundCents: item.refundCents,
        debtCents: item.debtCents,
        refundDueDate: item.refundDueDate,
        refundStatus: item.refundStatus,
        statusLabel: STATUS_LABELS[item.refundStatus],
        maskedIban: item.maskedIban,
        breakdown: item.breakdown,
        version: item.version,
      })),
    [withdrawals.data],
  )

  const columns = useMemo<DataColumn<WithdrawalRow>[]>(
    () => [
      { key: 'studentName', label: learner.title },
      {
        key: 'withdrawalDate',
        label: 'Ayrılış',
        cell: (row) => dateLabel(row.withdrawalDate, { year: 'numeric' }),
      },
      { key: 'reasonLabel', label: 'Neden' },
      { key: 'refundCents', label: 'İade', cell: (row) => money(row.refundCents) },
      { key: 'debtCents', label: 'Kalan borç', cell: (row) => money(row.debtCents) },
      {
        key: 'refundDueDate',
        label: 'İade son günü',
        cell: (row) =>
          row.refundStatus === 'pending' ? dateLabel(row.refundDueDate, { year: 'numeric' }) : '—',
      },
      {
        key: 'statusLabel',
        label: 'İade durumu',
        cell: (row) => <StatusBadge text={row.statusLabel} />,
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <span className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              aria-label={`${row.studentName} hesap dökümünü görüntüle`}
              onClick={() => setViewing(row)}
            >
              Döküm
            </Button>
            <PdfButton
              type="refund-statement"
              recordId={row.id}
              label="Kırılım"
              ariaLabel={`${row.studentName} iade kırılımını görüntüle`}
            />
            {canManage && row.refundStatus === 'pending' ? (
              <Button
                size="sm"
                aria-label={`${row.studentName} iadesini ödenmiş işaretle`}
                onClick={() => setPaying(row)}
              >
                İadeyi öde
              </Button>
            ) : null}
          </span>
        ),
      },
    ],
    [canManage, learner],
  )

  const total = withdrawals.data?.meta.total ?? 0
  return (
    <section
      aria-labelledby="ayrilis-iade"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div>
          <h2 id="ayrilis-iade" className="text-lg font-semibold">
            Ayrılış ve iade
          </h2>
          <p className="text-sm text-muted-foreground">
            {total} kayıt · İade, ayrılıştan en geç bir ay sonra yapılır.
          </p>
          <label className="mt-3 grid w-full max-w-xs gap-1 text-sm font-medium">
            İade durumu
            <NativeSelect
              value={refundStatus ?? ''}
              onChange={(event) =>
                list.dispatch({ type: 'filter', key: 'refundStatus', value: event.target.value })
              }
            >
              <NativeSelectOption value="">Tümü</NativeSelectOption>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <NativeSelectOption key={value} value={value}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        </div>
        {canManage ? <Button onClick={() => setStarting(true)}>Ayrılış başlat</Button> : null}
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={total}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={MOBILE_COLUMNS}
        caption="Ayrılış ve iade kayıtları"
        loading={withdrawals.isPending}
        fetching={withdrawals.isFetching && !withdrawals.isPending}
        error={
          withdrawals.error ? (
            <QueryError error={withdrawals.error} onRetry={() => void withdrawals.refetch()} />
          ) : undefined
        }
      />
      {starting ? <StartModal onClose={() => setStarting(false)} /> : null}
      {paying ? <RefundModal row={paying} onClose={() => setPaying(null)} /> : null}
      {viewing ? (
        <Modal
          open
          onOpenChange={(open) => (open ? undefined : setViewing(null))}
          title="Hesap dökümü"
          description={`${viewing.studentName} · ${viewing.reasonLabel}`}
        >
          <BreakdownList breakdown={viewing.breakdown} />
        </Modal>
      ) : null}
    </section>
  )
}

function BreakdownRows({ rows }: { rows: readonly (readonly [string, string])[] }) {
  return rows.map(([label, value]) => (
    <div key={label} className="flex justify-between gap-4 border-b py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  ))
}

/** Birden çok sözleşmede ve pakette her sözleşme ayrı başlıkla, ardından tek bakiye (K-06). */
function ContractBreakdown({
  breakdown,
  payers,
  institutionType,
}: {
  breakdown: WithdrawalBreakdown
  payers?: readonly WithdrawalContractPayer[] | undefined
  institutionType: InstitutionType
}) {
  const lines = contractLinesToShow(breakdown.contracts)
  const decision = breakdown.payerDecision
  return (
    <div className="grid gap-4 text-sm">
      {lines.map((line) => (
        <section key={line.contractId} aria-label={line.title}>
          <h4 className="font-semibold">{line.title}</h4>
          <dl className="grid gap-1">
            <BreakdownRows
              rows={contractLineRows(
                line,
                breakdown.deductionBasisPoints,
                payers?.find((item) => item.contractId === line.contractId)?.payerName,
                institutionType,
              )}
            />
          </dl>
        </section>
      ))}
      <section aria-label="Toplam">
        <h4 className="font-semibold">Toplam</h4>
        <p className="text-muted-foreground">
          Sözleşmelerin sonucu tek bakiyede netleşir; iade ve borç birlikte oluşmaz.
        </p>
        <dl className="grid gap-1">
          {breakdown.creditCents > 0 ? (
            <BreakdownRows rows={[['Dağıtılmamış tahsilat', money(breakdown.creditCents)]]} />
          ) : null}
          {decision ? (
            <BreakdownRows
              rows={[
                ['İadeyi alacak ödeyici', WITHDRAWAL_PAYER_LABELS[decision.payer]],
                ...(decision.reason
                  ? ([['Karar gerekçesi', decision.reason]] as [string, string][])
                  : []),
              ]}
            />
          ) : null}
          {breakdown.refundApprovedCents === undefined ? null : (
            <BreakdownRows
              rows={[['Yöneticinin onayladığı iade', money(breakdown.refundApprovedCents)]]}
            />
          )}
          <div className="flex justify-between gap-4 py-1.5 font-semibold">
            <dt>İade</dt>
            <dd>{money(breakdown.refundCents)}</dd>
          </div>
          <div className="flex justify-between gap-4 py-1.5 font-semibold">
            <dt>Kalan borç</dt>
            <dd>{money(breakdown.debtCents)}</dd>
          </div>
        </dl>
      </section>
    </div>
  )
}

/**
 * Hesap dökümü; ekran ve iade belgesi aynı sözlerle yazar (IST-110). Ödenen ücret okulda "öğrenim
 * ücreti", dil okulu ve kursta "kurs ücreti"dir (DOM-KAY-012).
 */
function BreakdownList({
  breakdown,
  payers,
}: {
  breakdown: WithdrawalBreakdown
  payers?: readonly WithdrawalContractPayer[]
}) {
  const { session } = useAuth()
  const institutionType = session?.institution.type ?? 'school'
  if (contractLinesToShow(breakdown.contracts).length > 0)
    return (
      <ContractBreakdown breakdown={breakdown} payers={payers} institutionType={institutionType} />
    )
  const extras = breakdown.extras.reduce((sum, line) => sum + line.paidCents - line.usedCents, 0)
  const lines: readonly [string, string][] = [
    ['Hesap tabanı (net ücret)', money(breakdown.baseCents)],
    [`Kesinti (%${String(breakdown.deductionBasisPoints / 100)})`, money(breakdown.deductionCents)],
    [
      `Kullanım (${String(breakdown.attendedUnits)} / ${String(breakdown.totalUnits)})`,
      money(breakdown.usageCents),
    ],
    ['Hak edilen', money(breakdown.entitledCents)],
    ...(breakdown.scholarshipExempt
      ? ([['Burslu istisnası', 'Ödenenden fazlası istenmez']] as [string, string][])
      : []),
    [paidTuitionLabel(institutionType), money(breakdown.paidCents)],
    ...(breakdown.extras.length > 0
      ? ([['Ek hizmet bakiyesi', money(extras)]] as [string, string][])
      : []),
    ...(breakdown.creditCents > 0
      ? ([['Dağıtılmamış tahsilat', money(breakdown.creditCents)]] as [string, string][])
      : []),
  ]
  return (
    <dl className="grid gap-1 text-sm">
      <BreakdownRows rows={lines} />
      <div className="flex justify-between gap-4 py-1.5 font-semibold">
        <dt>İade</dt>
        <dd>{money(breakdown.refundCents)}</dd>
      </div>
      <div className="flex justify-between gap-4 py-1.5 font-semibold">
        <dt>Kalan borç</dt>
        <dd>{money(breakdown.debtCents)}</dd>
      </div>
    </dl>
  )
}

function StartModal({ onClose }: { onClose: () => void }) {
  const { session } = useAuth()
  const learner = useEnrollmentLearner()
  const students = useCoreAll('students')
  const quote = useQuoteWithdrawal()
  const withdraw = useWithdrawStudent()
  const [quoted, setQuoted] = useState<{
    breakdown: WithdrawalBreakdown
    payersDiffer: boolean
    payers: readonly WithdrawalContractPayer[]
  } | null>(null)
  const preview = quoted?.breakdown ?? null
  // Ödeyiciler farklı ve iade varken iadeyi kimin alacağı yöneticinin kararıdır (K-12).
  const needsDecision = Boolean(quoted?.payersDiffer && quoted.breakdown.refundCents > 0)
  // Paket içeren ayrılışta iade tutarı yönetici onayından geçer; onay gördüğü tutara bağlıdır (K-21).
  const needsApproval = preview !== null && refundApprovalRequired(preview)
  const [refundApproved, setRefundApproved] = useState(false)
  const missingHours = preview?.contracts?.filter((line) => line.usedHoursMissing) ?? []
  const decisionForm = useForm<PayerDecisionInput>({
    resolver: zodResolver(payerDecisionSchema),
    defaultValues: { payer: '', reason: '' },
  })
  const [reauth, setReauth] = useState(false)
  const today = dayKey()
  const form = useForm<WithdrawalFormValues>({
    resolver: zodResolver(withdrawalFormSchema),
    defaultValues: {
      studentId: '',
      withdrawalDate: today,
      termStartDate: '',
      attendedUnits: 0,
      totalUnits: 180,
      publicSchoolExemption: false,
      reason: 'transfer',
      targetSchool: '',
    },
  })
  const busy = quote.isPending || withdraw.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const fields = {
    setError: (name: string, error: { type: string; message: string }) => {
      if (
        name === 'withdrawalDate' ||
        name === 'attendedUnits' ||
        name === 'publicSchoolExemption' ||
        name === 'termStartDate'
      )
        form.setError(name, error)
      else if (needsDecision && name === 'payerDecision.reason')
        decisionForm.setError('reason', error)
      else if (needsDecision && name.startsWith('payerDecision'))
        decisionForm.setError('payer', error)
      else form.setError('root.server', error)
    },
  }

  const onPreview = form.handleSubmit(async (values) => {
    const outcome = await quote.submit(
      {
        studentId: values.studentId,
        body: {
          withdrawalDate: values.withdrawalDate,
          termStartDate: values.termStartDate,
          attendedUnits: values.attendedUnits,
          totalUnits: values.totalUnits,
          publicSchoolExemption: values.publicSchoolExemption,
        },
      },
      fields,
    )
    if (outcome.status === 'success') {
      setRefundApproved(false)
      setQuoted(outcome.data.data)
    }
  })

  async function send() {
    const { studentId, targetSchool, ...rest } = form.getValues()
    const outcome = await withdraw.submit(
      {
        studentId,
        body: {
          ...rest,
          targetSchool: targetSchool.trim() || null,
          ...(needsDecision ? { payerDecision: decisionForm.getValues() } : {}),
          ...(needsApproval && preview ? { approvedRefundCents: preview.refundCents } : {}),
        },
      },
      fields,
    )
    if (outcome.status === 'success') {
      notify.success('Ayrılış kaydedildi.')
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === REAUTHENTICATION_CODE)
      setReauth(true)
    // Tutar önizlemeden sonra değiştiyse eski tutarın onayı geçmez: hesap yeniden görülür (K-21).
    else if (outcome.status === 'failed' && outcome.error.code === 'withdrawal_refund_changed')
      setQuoted(null)
  }
  // Karar gerekiyorsa önce alanlar doğrulanır; kararsız onay sunucuya gitmez.
  const confirm = needsDecision ? decisionForm.handleSubmit(() => send()) : send

  if (students.error)
    return (
      <Modal open onOpenChange={(open) => (open ? undefined : onClose())} title="Ayrılış başlat">
        <QueryError error={students.error} onRetry={() => void students.refetch()} />
      </Modal>
    )

  const options = (students.data ?? [])
    .filter((row) => row.record.isActive !== false)
    .map((row) => ({ id: row.id, name: row.record.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
  const locked = busy || preview !== null
  return (
    <Modal
      open
      size="wide"
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Ayrılış başlat"
      description="Önce hesap gösterilir; onaydan önce hiçbir kayıt yazılmaz."
      footer={
        preview ? (
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setQuoted(null)}>
              Bilgileri düzenle
            </Button>
            <Button
              variant="destructive"
              disabled={busy || (needsApproval && !refundApproved)}
              aria-busy={busy || undefined}
              onClick={() => void confirm()}
            >
              Ayrılışı onayla
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Vazgeç
            </Button>
            <Button type="submit" form={START_FORM} disabled={busy} aria-busy={busy || undefined}>
              Hesabı göster
            </Button>
          </>
        )
      }
    >
      {!students.data ? (
        <SummaryLoading />
      ) : (
        <form
          id={START_FORM}
          noValidate
          onSubmit={(event) => void onPreview(event)}
          className="grid grid-cols-2 gap-4 max-[650px]:grid-cols-1"
        >
          <FormField id="ayrilis-ogrenci" label={learner.title} error={errors.studentId}>
            {(control) => (
              <NativeSelect {...control} {...form.register('studentId')} disabled={locked}>
                <NativeSelectOption value="">{learner.title} seçin</NativeSelectOption>
                {options.map((option) => (
                  <NativeSelectOption key={option.id} value={option.id}>
                    {option.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField id="ayrilis-neden" label="Ayrılış nedeni" error={errors.reason}>
            {(control) => (
              <NativeSelect {...control} {...form.register('reason')} disabled={locked}>
                {WITHDRAWAL_REASONS.map((reason) => (
                  <NativeSelectOption key={reason} value={reason}>
                    {WITHDRAWAL_REASON_LABELS[reason]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField id="ayrilis-tarih" label="Ayrılış tarihi" error={errors.withdrawalDate}>
            {(control) => (
              <Input
                {...control}
                {...form.register('withdrawalDate')}
                type="date"
                max={today}
                disabled={locked}
              />
            )}
          </FormField>
          <FormField id="ayrilis-donem" label="Dönem başlangıcı" error={errors.termStartDate}>
            {(control) => (
              <Input
                {...control}
                {...form.register('termStartDate')}
                type="date"
                disabled={locked}
              />
            )}
          </FormField>
          <FormField
            id="ayrilis-gorulen"
            label="Görülen gün veya ders saati"
            error={errors.attendedUnits}
            description="Öğrenim sözleşmesine uygulanır; paket satışının saati kayıttan gelir."
          >
            {(control) => (
              <Input
                {...control}
                {...form.register('attendedUnits', { valueAsNumber: true })}
                type="number"
                min={0}
                disabled={locked}
              />
            )}
          </FormField>
          <FormField
            id="ayrilis-toplam"
            label="Toplam gün veya ders saati"
            error={errors.totalUnits}
          >
            {(control) => (
              <Input
                {...control}
                {...form.register('totalUnits', { valueAsNumber: true })}
                type="number"
                min={1}
                disabled={locked}
              />
            )}
          </FormField>
          <FormField
            id="ayrilis-hedef"
            label={`${withdrawalTargetLabel(session?.institution.type)} (varsa)`}
            error={errors.targetSchool}
          >
            {(control) => (
              <Input {...control} {...form.register('targetSchool')} disabled={locked} />
            )}
          </FormField>
          {session?.institution.type === 'school' ? (
            <div className="grid gap-1 self-end pb-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  {...form.register('publicSchoolExemption')}
                  disabled={locked}
                  aria-invalid={Boolean(errors.publicSchoolExemption)}
                  className="size-4"
                />
                Resmî okul 9. sınıf kaydı belgelendi (kesinti yok)
              </label>
              {errors.publicSchoolExemption?.message ? (
                <p role="alert" className="text-danger">
                  {errors.publicSchoolExemption.message}
                </p>
              ) : null}
            </div>
          ) : null}
          {errors.root?.server?.message ? (
            <p role="alert" className="col-span-full text-sm text-danger">
              {errors.root.server.message}
            </p>
          ) : null}
        </form>
      )}
      {preview ? (
        <div className="mt-5 rounded-card border bg-surface-soft p-4">
          <h3 className="mb-2 font-semibold">Hesap önizlemesi</h3>
          {(preview.contracts?.length ?? 0) > 1 ? (
            <p className="mb-2 text-sm text-muted-foreground">
              Yürürlükteki {preview.contracts?.length} sözleşme hesaba girdi.
            </p>
          ) : null}
          {missingHours.length > 0 ? (
            <p role="alert" className="mb-3 rounded-md border bg-warning-soft p-3 text-sm">
              Kullanılan saat girilmedi: {missingHours.map((line) => line.title).join(', ')}. İade
              sıfır saate göre hesaplandı ve fazla çıkabilir. Onaydan önce saati paket satışı
              ayrıntısından girin.
            </p>
          ) : null}
          <BreakdownList breakdown={preview} payers={quoted?.payers ?? []} />
          {needsDecision ? (
            <div className="mt-4 grid gap-4 border-t pt-4">
              <p className="text-sm font-medium" role="status">
                Hesaba giren sözleşmelerin ödeyicileri farklı. İade otomatik tek kişiye yazılmaz;
                iadeyi alacak ödeyiciyi siz seçersiniz, IBAN bu kişiye ait olmalıdır.
              </p>
              <FormField
                id="ayrilis-iade-odeyici"
                label="İadeyi alacak ödeyici"
                error={decisionForm.formState.errors.payer}
              >
                {(control) => (
                  <NativeSelect {...control} {...decisionForm.register('payer')} disabled={busy}>
                    <NativeSelectOption value="">Ödeyici seçin</NativeSelectOption>
                    {refundPayerOptions(quoted?.payers ?? []).map((item) => (
                      <NativeSelectOption key={item.payer} value={item.payer}>
                        {item.payerName} ({WITHDRAWAL_PAYER_LABELS[item.payer]})
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
              <FormField
                id="ayrilis-karar-gerekce"
                label="Karar gerekçesi"
                error={decisionForm.formState.errors.reason}
              >
                {(control) => (
                  <Textarea
                    {...control}
                    {...decisionForm.register('reason')}
                    rows={2}
                    maxLength={500}
                    disabled={busy}
                  />
                )}
              </FormField>
            </div>
          ) : null}
          {needsApproval ? (
            <label className="mt-4 flex items-start gap-2 border-t pt-4 text-sm font-medium">
              <input
                type="checkbox"
                checked={refundApproved}
                disabled={busy}
                onChange={(event) => setRefundApproved(event.target.checked)}
                className="mt-0.5 size-4"
              />
              Paket içeren bu ayrılışta {money(preview.refundCents)} iade tutarını inceledim,
              onaylıyorum.
            </label>
          ) : null}
          <p className="mt-3 text-sm text-muted-foreground">
            Onayla {learner.noun} pasifleşir, açık taksitler iptal edilir, ileri tarihli etüt,
            servis ve kulüp kayıtları sonlanır
            {preview.contracts?.some((line) => line.packageSaleId !== undefined)
              ? ', paketlerin kalan saati iade edilmiş yazılır'
              : ''}
            . Kesinti oranı ve hesap tabanı hukuki doğrulama bekliyor.
          </p>
        </div>
      ) : null}
      {reauth ? (
        <ReauthModal
          onCancel={() => setReauth(false)}
          onDone={() => {
            setReauth(false)
            void send()
          }}
        />
      ) : null}
    </Modal>
  )
}

type RefundModalProps = { row: WithdrawalRow; onClose: () => void }
type BankAccountOption = { id: string; bankName: string; iban: string }

/**
 * İade ödemesi (DOM-FIN-041, M-13): iade kurumun bildirilmiş banka hesabından çıkar ve ödeme
 * gününün gün sonuna girer; kapatılmış güne yazılmaz. Hesaplar yüklenince form açılır, ilk hesap
 * öntanımlıdır.
 */
function RefundModal(props: RefundModalProps) {
  const accounts = useBankAccounts()
  if (accounts.isPending)
    return (
      <Modal open onOpenChange={(open) => (open ? undefined : props.onClose())} title="İadeyi öde">
        <SummaryLoading />
      </Modal>
    )
  return <RefundFormModal {...props} accounts={accounts.data?.data ?? []} />
}

function RefundFormModal({
  row,
  onClose,
  accounts,
}: RefundModalProps & { accounts: readonly BankAccountOption[] }) {
  const pay = usePayRefund()
  const today = dayKey()
  const [reauth, setReauth] = useState(false)
  const form = useForm<PayRefundInput, unknown, PayRefundOutput>({
    resolver: zodResolver(payRefundSchema),
    defaultValues: {
      paidDate: today,
      iban: '',
      accountHolder: '',
      bankAccountId: accounts[0]?.id ?? '',
    },
  })
  const busy = pay.isPending || form.formState.isSubmitting
  const errors = form.formState.errors

  async function send(values: PayRefundOutput) {
    const outcome = await pay.submit(
      { withdrawalId: row.id, version: row.version, body: values },
      {
        setError: (name, error) => {
          if (
            name === 'iban' ||
            name === 'accountHolder' ||
            name === 'paidDate' ||
            name === 'bankAccountId'
          )
            form.setError(name, error)
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success('İade ödendi olarak kaydedildi.')
      onClose()
    } else if (outcome.status === 'failed') {
      if (outcome.error.code === REAUTHENTICATION_CODE) setReauth(true)
      else if (outcome.error.code === 'version_conflict') onClose()
    }
  }
  const onSubmit = form.handleSubmit((values) => send(values))

  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="İadeyi öde"
      description={`${row.studentName} · ${money(row.refundCents)}. Ödenen iade değiştirilemez; ödeme gününün gün sonuna iade ödemesi olarak girer.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={REFUND_FORM} disabled={busy} aria-busy={busy || undefined}>
            Ödendi olarak kaydet
          </Button>
        </>
      }
    >
      <form
        id={REFUND_FORM}
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField id="iade-tarih" label="Ödeme tarihi" error={errors.paidDate}>
          {(control) => (
            <Input
              {...control}
              {...form.register('paidDate')}
              type="date"
              max={today}
              disabled={busy}
            />
          )}
        </FormField>
        <FormField
          id="iade-hesap"
          label="Kurum banka hesabı"
          error={errors.bankAccountId}
          description={
            accounts.length === 0
              ? 'Tanımlı banka hesabı yok; Ayarlar’dan hesap ekleyin.'
              : 'İadenin çıktığı bildirilmiş hesap.'
          }
        >
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('bankAccountId')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="">Hesap seçin</NativeSelectOption>
              {accounts.map((account) => (
                <NativeSelectOption key={account.id} value={account.id}>
                  {bankAccountLabel(account)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="iade-iban" label="IBAN" error={errors.iban}>
          {(control) => (
            <Input {...control} {...form.register('iban')} autoComplete="off" disabled={busy} />
          )}
        </FormField>
        <FormField
          id="iade-sahip"
          label="Hesap sahibi"
          error={errors.accountHolder}
          description={
            row.breakdown.payerDecision
              ? `Ayrılış kararıyla seçilen ödeyici olmalıdır: ${WITHDRAWAL_PAYER_LABELS[row.breakdown.payerDecision.payer]}.`
              : 'Sözleşmedeki ödeyici olmalıdır.'
          }
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('accountHolder')}
              autoComplete="off"
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
      {reauth ? (
        <ReauthModal
          onCancel={() => setReauth(false)}
          onDone={() => {
            setReauth(false)
            void onSubmit()
          }}
        />
      ) : null}
    </Modal>
  )
}
