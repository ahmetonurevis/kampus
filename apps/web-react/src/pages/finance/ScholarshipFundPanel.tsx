import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  useAllocateFromScholarshipFund,
  useCancelScholarshipFundAllocation,
  useCancelScholarshipFundDonation,
  useCloseScholarshipFund,
  useDonateToScholarshipFund,
  useScholarshipFundExport,
  useScholarshipFundReport,
  type ScholarshipFundMovement,
  type ScholarshipFundReport,
} from '@kampus/react-shared/use-finance-scholarship-funds.ts'
import { useScholarshipAwards } from '@kampus/react-shared/use-finance-scholarships.ts'
import {
  SCHOLARSHIP_FUND_CHANNEL_LABELS,
  SCHOLARSHIP_FUND_CHANNELS,
  SCHOLARSHIP_FUND_DONOR_KIND_LABELS,
  SCHOLARSHIP_FUND_MOVEMENT_LABELS,
  SCHOLARSHIP_FUND_STATUS_LABELS,
} from '@kampus/school-core/lib/finance-scholarship-funds.ts'
import { dateLabel, dayKey, money } from '@kampus/school-core/lib/format.ts'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useScholarshipFundPdf } from '@/hooks/use-finance-scholarship-fund-pdf.ts'
import {
  movementDetail,
  SCHOLARSHIP_FUND_REPORT_TITLE,
  signedAmount,
} from '@/lib/pdf/templates/finance-scholarship-fund.ts'
import { notify } from '@/lib/notify.ts'
import { SummaryLoading, SummaryMetrics } from '../management/SummaryParts.tsx'
import { RootError } from '../management/FormParts.tsx'
import { CsvButton, PdfDialogButton } from './CorporateParts.tsx'
import {
  allocationBody,
  allocationFormSchema,
  awardOptionLabel,
  cancelFormSchema,
  donationBody,
  donationDefaults,
  donationFormSchema,
  formField,
  type AllocationFormValues,
  type CancelFormValues,
  type DonationFormValues,
} from './scholarship-fund-forms.ts'

const AWARD_PAGE_SIZE = 100
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

type Fund = ScholarshipFundReport['fund']

/**
 * Burs fonu ayrıntısı (`?burs-fonu=`; DOM-FIN-068): bağışçı, bağış/atama/bakiye toplamları ve
 * yürüyen bakiyeli hareket dökümü. Yönetici bağış girer, kesin kayıtta ya da yenilemede atanmış
 * bursu fondan karşılar, hareketi gerekçeyle iptal eder ve sıfır bakiyede fonu kapatır. Öğrenci
 * adı yalnız yöneticinin yanıtında doludur (K-98). Rapor PDF ve CSV olarak alınır.
 */
export function ScholarshipFundPanel({
  fundId,
  canManage,
  onClose,
}: {
  fundId: string
  canManage: boolean
  onClose: () => void
}) {
  return (
    <SidePanel
      open={fundId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Burs fonu"
    >
      {fundId ? <FundDetail fundId={fundId} canManage={canManage} /> : null}
    </SidePanel>
  )
}

type Dialog =
  | { kind: 'donate' }
  | { kind: 'allocate' }
  | { kind: 'close' }
  | { kind: 'cancel'; movement: ScholarshipFundMovement }

function FundDetail({ fundId, canManage }: { fundId: string; canManage: boolean }) {
  const report = useScholarshipFundReport(fundId)
  const exporter = useScholarshipFundExport()
  const [dialog, setDialog] = useState<Dialog | null>(null)
  if (report.error) return <QueryError error={report.error} onRetry={() => void report.refetch()} />
  const data = report.data?.data
  if (!data) return <SummaryLoading />
  const { fund, movements } = data
  const open = fund.status === 'active'
  const closeDialog = () => setDialog(null)
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{fund.name}</h3>
        <StatusBadge
          text={SCHOLARSHIP_FUND_STATUS_LABELS[fund.status]}
          tone={open ? 'green' : 'gray'}
        />
      </div>
      <SummaryMetrics
        items={[
          { label: 'Bağış', value: money(fund.donatedCents) },
          { label: 'Atanan', value: money(fund.allocatedCents) },
          { label: 'Bakiye', value: money(fund.balanceCents) },
        ]}
      />
      <dl className="grid gap-2 text-sm">
        <Pair
          label="Bağışçı"
          value={
            fund.donorName === null
              ? SCHOLARSHIP_FUND_DONOR_KIND_LABELS[fund.donorKind]
              : `${fund.donorName} (${SCHOLARSHIP_FUND_DONOR_KIND_LABELS[fund.donorKind]})`
          }
        />
        {fund.description ? <Pair label="Açıklama" value={fund.description} /> : null}
        <Pair label="Açılış" value={dateLabel(fund.createdAt, { year: 'numeric' })} />
      </dl>
      <div className="flex flex-wrap gap-2">
        {canManage && open ? (
          <>
            <Button type="button" onClick={() => setDialog({ kind: 'donate' })}>
              Bağış ekle
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDialog({ kind: 'allocate' })}
            >
              Bursu fondan karşıla
            </Button>
          </>
        ) : null}
        <PdfDialogButton
          label="Rapor PDF"
          title={SCHOLARSHIP_FUND_REPORT_TITLE}
          id={fundId}
          usePdf={useScholarshipFundPdf}
        />
        <CsvButton
          label="Rapor CSV"
          filename={`burs-fonu-${dayKey()}.csv`}
          busy={exporter.isPending}
          download={() => exporter.submit(fundId)}
        />
        {canManage && open ? (
          <Button type="button" variant="outline" onClick={() => setDialog({ kind: 'close' })}>
            Fonu kapat
          </Button>
        ) : null}
      </div>
      <section aria-labelledby="burs-fonu-hareketleri" className="grid gap-2">
        <h4 id="burs-fonu-hareketleri" className="text-sm font-semibold">
          Hareketler
        </h4>
        {movements.length === 0 ? (
          <p className="text-sm text-muted-foreground">Henüz bağış ya da atama yok.</p>
        ) : (
          <ul className="grid gap-2" aria-label="Fon hareketleri">
            {movements.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <span>
                  <span className="font-medium">
                    {SCHOLARSHIP_FUND_MOVEMENT_LABELS[row.kind]} · {dayText(row.day)}
                  </span>
                  <span className="block text-muted-foreground">{movementDetail(row) || '—'}</span>
                  {row.cancelledAt ? (
                    <span className="block text-muted-foreground">
                      İptal gerekçesi: {row.cancelReason ?? '—'}
                    </span>
                  ) : null}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  {row.cancelledAt ? <StatusBadge text="İptal edildi" tone="gray" /> : null}
                  <span className="font-medium tabular-nums">{signedAmount(row)}</span>
                  <span className="text-muted-foreground tabular-nums">
                    Bakiye {money(row.balanceAfterCents)}
                  </span>
                  {canManage && open && row.cancelledAt === null ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-label={`${SCHOLARSHIP_FUND_MOVEMENT_LABELS[row.kind]} ${dayText(row.day)} ${money(row.amountCents)} iptal et`}
                      onClick={() => setDialog({ kind: 'cancel', movement: row })}
                    >
                      İptal et
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {dialog?.kind === 'donate' ? <DonationModal fund={fund} onClose={closeDialog} /> : null}
      {dialog?.kind === 'allocate' ? <AllocationModal fund={fund} onClose={closeDialog} /> : null}
      {dialog?.kind === 'close' ? <CloseModal fund={fund} onClose={closeDialog} /> : null}
      {dialog?.kind === 'cancel' ? (
        <CancelModal fund={fund} movement={dialog.movement} onClose={closeDialog} />
      ) : null}
    </div>
  )
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_1fr] gap-2 max-[480px]:grid-cols-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function ModalFooter({
  formId,
  busy,
  label,
  onClose,
  destructive = false,
}: {
  formId: string
  busy: boolean
  label: string
  onClose: () => void
  destructive?: boolean
}) {
  return (
    <>
      <Button variant="secondary" onClick={onClose} disabled={busy}>
        Vazgeç
      </Button>
      <Button
        type="submit"
        form={formId}
        variant={destructive ? 'destructive' : 'default'}
        disabled={busy}
        aria-busy={busy || undefined}
      >
        {label}
      </Button>
    </>
  )
}

const DONATION_FORM = 'burs-fonu-bagis-formu'
const DONATION_FIELDS = ['amount', 'donatedOn', 'channel', 'note'] as const

function DonationModal({ fund, onClose }: { fund: Fund; onClose: () => void }) {
  const donate = useDonateToScholarshipFund()
  const today = dayKey()
  const form = useForm<DonationFormValues>({
    resolver: zodResolver(donationFormSchema),
    defaultValues: donationDefaults(today),
  })
  const busy = donate.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await donate.submit(
      { fundId: fund.id, body: donationBody(values) },
      {
        setError: (name, error) => {
          const field = formField(DONATION_FIELDS, name === 'amountCents' ? 'amount' : name)
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success('Bağış kaydedildi.')
      onClose()
    }
  })
  return (
    <Modal
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Bağış ekle"
      description={`${fund.name} fonuna bağış girilir. Bu kayıt bağış makbuzu yerine geçmez.`}
      footer={<ModalFooter formId={DONATION_FORM} busy={busy} label="Kaydet" onClose={onClose} />}
    >
      <form
        id={DONATION_FORM}
        noValidate
        aria-label="Bağış"
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField id="burs-fonu-bagis-tutar" label="Tutar (₺)" error={errors.amount}>
          {(control) => (
            <Input {...control} {...form.register('amount')} inputMode="decimal" disabled={busy} />
          )}
        </FormField>
        <FormField id="burs-fonu-bagis-gun" label="Bağış günü" error={errors.donatedOn}>
          {(control) => (
            <Input
              {...control}
              {...form.register('donatedOn')}
              type="date"
              max={today}
              disabled={busy}
            />
          )}
        </FormField>
        <FormField id="burs-fonu-bagis-kaynak" label="Kaynak" error={errors.channel}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('channel')}
              className="w-full"
              disabled={busy}
            >
              {SCHOLARSHIP_FUND_CHANNELS.map((channel) => (
                <NativeSelectOption key={channel} value={channel}>
                  {SCHOLARSHIP_FUND_CHANNEL_LABELS[channel]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField
          id="burs-fonu-bagis-not"
          label="Not (isteğe bağlı)"
          description="Ör. dekont numarası."
          error={errors.note}
        >
          {(control) => <Input {...control} {...form.register('note')} disabled={busy} />}
        </FormField>
        <RootError message={errors.root?.server?.message} />
      </form>
    </Modal>
  )
}

const ALLOCATION_FORM = 'burs-fonu-atama-formu'
const ALLOCATION_FIELDS = ['awardId', 'amount'] as const

function AllocationModal({ fund, onClose }: { fund: Fund; onClose: () => void }) {
  const allocate = useAllocateFromScholarshipFund()
  const awards = useScholarshipAwards({ page: 1, pageSize: AWARD_PAGE_SIZE })
  const students = useCoreAll('students')
  const options = useMemo(() => {
    const names = new Map(students.data?.map((item) => [item.id, item.record.name]))
    return (awards.data?.data ?? []).map((award) => ({
      value: award.id,
      label: awardOptionLabel(award, names),
    }))
  }, [awards.data, students.data])
  const form = useForm<AllocationFormValues>({
    resolver: zodResolver(allocationFormSchema),
    defaultValues: { awardId: '', amount: '' },
  })
  const busy = allocate.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await allocate.submit(
      { fundId: fund.id, body: allocationBody(values) },
      {
        setError: (name, error) => {
          const field = formField(ALLOCATION_FIELDS, name === 'amountCents' ? 'amount' : name)
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success('Burs fondan karşılandı.')
      onClose()
    }
  })
  return (
    <Modal
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Bursu fondan karşıla"
      description={`Kesin kayıtta ya da yenilemede atanmış burs ${fund.name} fonundan karşılanır; sözleşme değişmez. Fon bakiyesi ${money(fund.balanceCents)}.`}
      footer={<ModalFooter formId={ALLOCATION_FORM} busy={busy} label="Kaydet" onClose={onClose} />}
    >
      {awards.error ? (
        <QueryError error={awards.error} onRetry={() => void awards.refetch()} />
      ) : null}
      <form
        id={ALLOCATION_FORM}
        noValidate
        aria-label="Fondan burs ataması"
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField id="burs-fonu-atama-burs" label="Burs ataması" error={errors.awardId}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('awardId')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="">Burs ataması seçin</NativeSelectOption>
              {options.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField
          id="burs-fonu-atama-tutar"
          label="Fondan karşılanacak tutar (₺)"
          description="Fon bakiyesini ve bursun fonlardan karşılanmamış kısmını aşamaz."
          error={errors.amount}
        >
          {(control) => (
            <Input {...control} {...form.register('amount')} inputMode="decimal" disabled={busy} />
          )}
        </FormField>
        <RootError message={errors.root?.server?.message} />
      </form>
    </Modal>
  )
}

const CANCEL_FORM = 'burs-fonu-iptal-formu'

function CancelModal({
  fund,
  movement,
  onClose,
}: {
  fund: Fund
  movement: ScholarshipFundMovement
  onClose: () => void
}) {
  const cancelDonation = useCancelScholarshipFundDonation()
  const cancelAllocation = useCancelScholarshipFundAllocation()
  const command = movement.kind === 'donation' ? cancelDonation : cancelAllocation
  const form = useForm<CancelFormValues>({
    resolver: zodResolver(cancelFormSchema),
    defaultValues: { reason: '' },
  })
  const busy = command.isPending || form.formState.isSubmitting
  const label = SCHOLARSHIP_FUND_MOVEMENT_LABELS[movement.kind]
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await command.submit(
      {
        fundId: fund.id,
        movementId: movement.id,
        version: movement.version,
        reason: values.reason,
      },
      {
        setError: (name, error) =>
          name === 'reason'
            ? form.setError('reason', error, { shouldFocus: true })
            : form.setError('root.server', error),
      },
    )
    if (outcome.status === 'success') {
      notify.success(`${label} iptal edildi.`)
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  return (
    <Modal
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={`${label} iptali`}
      description={
        movement.kind === 'donation'
          ? `${money(movement.amountCents)} bağış bakiyeden düşer; atamalarda kullanılıyorsa önce atama iptal edilir.`
          : `${money(movement.amountCents)} fon bakiyesine geri döner; burs ataması kalır.`
      }
      footer={
        <ModalFooter
          formId={CANCEL_FORM}
          busy={busy}
          label="İptal et"
          onClose={onClose}
          destructive
        />
      }
    >
      <form
        id={CANCEL_FORM}
        noValidate
        aria-label={`${label} iptali`}
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField
          id="burs-fonu-iptal-gerekce"
          label="İptal gerekçesi"
          error={form.formState.errors.reason}
        >
          {(control) => (
            <Textarea {...control} {...form.register('reason')} rows={3} disabled={busy} />
          )}
        </FormField>
        <RootError message={form.formState.errors.root?.server?.message} />
      </form>
    </Modal>
  )
}

function CloseModal({ fund, onClose }: { fund: Fund; onClose: () => void }) {
  const close = useCloseScholarshipFund()
  const busy = close.isPending
  async function run() {
    const outcome = await close.submit({ fundId: fund.id, version: fund.version })
    if (outcome.status === 'success') {
      notify.success(`${fund.name} kapatıldı.`)
      onClose()
    } else if (outcome.status === 'failed') onClose()
  }
  return (
    <Modal
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Fonu kapat"
      description={
        fund.balanceCents === 0
          ? 'Kapalı fona bağış ve atama yapılmaz; rapor kalır.'
          : `Fonda ${money(fund.balanceCents)} bakiye var; fon yalnız sıfır bakiyede kapanır.`
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy || fund.balanceCents !== 0}
            aria-busy={busy || undefined}
            onClick={() => void run()}
          >
            Fonu kapat
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        Toplam bağış {money(fund.donatedCents)}, atanan {money(fund.allocatedCents)}.
      </p>
    </Modal>
  )
}
