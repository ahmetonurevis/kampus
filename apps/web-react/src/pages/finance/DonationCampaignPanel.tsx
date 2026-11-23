import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {
  useCampaignDonations,
  useCampaignDonationsExport,
  useCancelDonation,
  useCloseDonationCampaign,
  useDonationCampaign,
  useDonors,
  useOpenDonationCampaign,
  useRecordDonation,
  type Donation,
  type DonationCampaign,
} from '@kampus/react-shared/use-finance-donations.ts'
import { useBankAccounts } from '@kampus/react-shared/use-payment-commands.ts'
import {
  ANONYMOUS_DONOR_LABEL,
  DONATION_CAMPAIGN_STATUS_LABELS,
  DONATION_KIND_LABELS,
  DONATION_KINDS,
  DONATION_METHOD_LABELS,
  DONATION_METHODS,
  donationReceiptLabel,
} from '@kampus/school-core/lib/finance-donations.ts'
import { dateLabel, dayKey, money } from '@kampus/school-core/lib/format.ts'
import { bankAccountLabel } from '@kampus/school-core/lib/payments.ts'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDonationReceiptPdf } from '@/hooks/use-finance-donation-receipt-pdf.ts'
import { DONATION_RECEIPT_TITLE } from '@/lib/pdf/templates/finance-donation-receipt.ts'
import { notify } from '@/lib/notify.ts'
import { SummaryLoading, SummaryMetrics } from '../management/SummaryParts.tsx'
import { RootError } from '../management/FormParts.tsx'
import { CsvButton, PdfDialogButton } from './CorporateParts.tsx'
import {
  cancelFormSchema,
  donationBody,
  donationDefaults,
  donationFormSchema,
  formField,
  type CancelFormValues,
  type DonationFormValues,
} from './donation-forms.ts'

const PAGE_SIZE = 20
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

/** Toplanan / hedef çubuğu; ilerleme yüzdesi sunucudan gelir (ayni bağış dahil değil, K-297). */
export function CampaignProgress({ campaign }: { campaign: DonationCampaign }) {
  return (
    <div className="grid min-w-36 gap-1">
      <div
        role="progressbar"
        aria-label={`${campaign.name} ilerlemesi`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(campaign.percent, 100)}
        aria-valuetext={`Hedefin yüzde ${String(campaign.percent)}'i toplandı`}
        className="h-2 overflow-hidden rounded-full bg-surface-soft"
      >
        <span
          className="block h-full bg-primary"
          style={{ width: `${String(Math.min(campaign.percent, 100))}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">
        {money(campaign.collectedCents)} / {money(campaign.targetCents)} · %
        {String(campaign.percent)}
      </span>
    </div>
  )
}

/** Bağışın listedeki açıklaması: tutar ya da ayni bağış, yol ve bağışçı. */
export function donationSummary(row: Donation): string {
  const amount =
    row.kind === 'cash'
      ? money(row.amountCents ?? 0)
      : `Ayni${row.declaredValueCents === null ? '' : ` · ${money(row.declaredValueCents)}`}`
  const method = row.method === null ? row.description : DONATION_METHOD_LABELS[row.method]
  return [amount, method, row.donorName ?? ANONYMOUS_DONOR_LABEL]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ')
}

/**
 * Bağış kampanyası ayrıntısı (`?bagis-kampanyasi=`; DOM-FIN-097): toplamlar ve ilerleme, açma,
 * kapatma ve düzeltme, bağış kaydı, bağış listesi (makbuz PDF'i ve iptal) ve döküm CSV'si.
 */
export function DonationCampaignPanel({
  campaignId,
  onClose,
  onEdit,
}: {
  campaignId: string
  onClose: () => void
  onEdit: (campaign: DonationCampaign) => void
}) {
  return (
    <SidePanel
      open={campaignId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Bağış kampanyası"
    >
      {campaignId ? <CampaignDetail campaignId={campaignId} onEdit={onEdit} /> : null}
    </SidePanel>
  )
}

type Dialog = { kind: 'donate' } | { kind: 'status' } | { kind: 'cancel'; donation: Donation }

function CampaignDetail({
  campaignId,
  onEdit,
}: {
  campaignId: string
  onEdit: (campaign: DonationCampaign) => void
}) {
  const campaign = useDonationCampaign(campaignId)
  const [page, setPage] = useState(1)
  const donations = useCampaignDonations(campaignId, { page, pageSize: PAGE_SIZE })
  const exporter = useCampaignDonationsExport()
  const [dialog, setDialog] = useState<Dialog | null>(null)
  if (campaign.error)
    return <QueryError error={campaign.error} onRetry={() => void campaign.refetch()} />
  const data = campaign.data?.data
  if (!data) return <SummaryLoading />
  const total = donations.data?.meta.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const closeDialog = () => setDialog(null)
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{data.name}</h3>
        <StatusBadge
          text={DONATION_CAMPAIGN_STATUS_LABELS[data.status]}
          tone={data.status === 'open' ? 'green' : data.status === 'draft' ? 'gray' : 'purple'}
        />
      </div>
      <CampaignProgress campaign={data} />
      <SummaryMetrics
        items={[
          { label: 'Toplanan (nakdi)', value: money(data.collectedCents) },
          { label: 'Hedef', value: money(data.targetCents) },
          { label: 'Kalan', value: money(data.remainingCents) },
          {
            label: 'Ayni bağış',
            value: `${String(data.inKindCount)} adet · ${money(data.inKindDeclaredCents)}`,
          },
        ]}
      />
      <dl className="grid gap-2 text-sm">
        <Pair label="Amaç" value={data.purpose} />
        <Pair label="Dönem" value={`${dayText(data.startsOn)} – ${dayText(data.endsOn)}`} />
        <Pair label="Banka hesabı" value={data.bankAccountLabel ?? '—'} />
      </dl>
      <div className="flex flex-wrap gap-2">
        {data.status === 'open' ? (
          <Button type="button" onClick={() => setDialog({ kind: 'donate' })}>
            Bağış kaydet
          </Button>
        ) : null}
        {data.status !== 'closed' ? (
          <>
            <Button type="button" variant="secondary" onClick={() => onEdit(data)}>
              Düzelt
            </Button>
            <Button type="button" variant="outline" onClick={() => setDialog({ kind: 'status' })}>
              {data.status === 'draft' ? 'Kampanyayı aç' : 'Kampanyayı kapat'}
            </Button>
          </>
        ) : null}
        <CsvButton
          label="Bağış CSV"
          filename={`bagislar-${dayKey()}.csv`}
          busy={exporter.isPending}
          download={() => exporter.submit(campaignId)}
        />
      </div>
      <section aria-labelledby="bagis-listesi" className="grid gap-2">
        <h4 id="bagis-listesi" className="text-sm font-semibold">
          Bağışlar
        </h4>
        {donations.error ? (
          <QueryError error={donations.error} onRetry={() => void donations.refetch()} />
        ) : !donations.data ? (
          <SummaryLoading />
        ) : donations.data.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Henüz bağış yok.</p>
        ) : (
          <ul className="grid gap-2" aria-label="Kampanya bağışları">
            {donations.data.data.map((row) => {
              const label = donationReceiptLabel(row)
              return (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                >
                  <span>
                    <span className="font-medium">
                      {label} · {dayText(row.donatedOn)}
                    </span>
                    <span className="block text-muted-foreground">{donationSummary(row)}</span>
                    {row.cancelledAt && row.cancelReason !== null ? (
                      <span className="block text-muted-foreground">
                        İptal gerekçesi: {row.cancelReason}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    {row.cancelledAt ? <StatusBadge text="İptal edildi" tone="gray" /> : null}
                    <PdfDialogButton
                      label="Makbuz"
                      title={DONATION_RECEIPT_TITLE}
                      id={row.id}
                      usePdf={useDonationReceiptPdf}
                      accessibleName={`${label} makbuzu`}
                    />
                    {row.cancelledAt === null ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label={`${label} bağışını iptal et`}
                        onClick={() => setDialog({ kind: 'cancel', donation: row })}
                      >
                        İptal et
                      </Button>
                    ) : null}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        {pages > 1 ? (
          <div className="flex items-center justify-between gap-2 text-sm">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Önceki
            </Button>
            <span className="text-muted-foreground">
              Sayfa {String(page)} / {String(pages)}
            </span>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
            >
              Sonraki
            </Button>
          </div>
        ) : null}
      </section>
      {dialog?.kind === 'donate' ? <DonationModal campaign={data} onClose={closeDialog} /> : null}
      {dialog?.kind === 'status' ? <StatusModal campaign={data} onClose={closeDialog} /> : null}
      {dialog?.kind === 'cancel' ? (
        <CancelModal donation={dialog.donation} onClose={closeDialog} />
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

function Footer({
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

const DONATION_FORM = 'bagis-formu'
const DONATION_FIELDS = [
  'donorId',
  'kind',
  'donatedOn',
  'amount',
  'method',
  'bankAccountId',
  'reference',
  'description',
  'declaredValue',
  'note',
] as const
const DONATION_FIELD_OF: Record<string, string> = {
  amountCents: 'amount',
  declaredValueCents: 'declaredValue',
}

function DonationModal({ campaign, onClose }: { campaign: DonationCampaign; onClose: () => void }) {
  const record = useRecordDonation()
  const accounts = useBankAccounts()
  const [donorSearch, setDonorSearch] = useState('')
  const query = useDebouncedValue(donorSearch).trim()
  const donors = useDonors({ page: 1, pageSize: 100, ...(query.length >= 2 ? { q: query } : {}) })
  const today = dayKey()
  const form = useForm<DonationFormValues>({
    resolver: zodResolver(donationFormSchema),
    defaultValues: donationDefaults(today > campaign.endsOn ? campaign.endsOn : today),
  })
  const kind = useWatch({ control: form.control, name: 'kind' })
  const method = useWatch({ control: form.control, name: 'method' })
  const busy = record.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await record.submit(
      { campaignId: campaign.id, body: donationBody(values) },
      {
        setError: (name, error) => {
          const field = formField(DONATION_FIELDS, DONATION_FIELD_OF[name] ?? name)
          if (field) form.setError(field, error, { shouldFocus: true })
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success(`Bağış kaydedildi, makbuz ${donationReceiptLabel(outcome.data.data)}.`)
      onClose()
    }
  })
  return (
    <Modal
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Bağış kaydet"
      description={`${campaign.name} kampanyasına elle bağış girilir ve numaralı makbuz kesilir.`}
      footer={<Footer formId={DONATION_FORM} busy={busy} label="Kaydet" onClose={onClose} />}
    >
      {donors.error ? (
        <QueryError error={donors.error} onRetry={() => void donors.refetch()} />
      ) : null}
      <form
        id={DONATION_FORM}
        noValidate
        aria-label="Bağış"
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField id="bagis-bagisci-ara" label="Bağışçı ara">
          {(control) => (
            <Input
              {...control}
              value={donorSearch}
              onChange={(event) => setDonorSearch(event.target.value)}
              disabled={busy}
            />
          )}
        </FormField>
        <FormField
          id="bagis-bagisci"
          label="Bağışçı"
          description="Listede yoksa önce Bağışçılar bölümünden ekleyin."
          error={errors.donorId}
        >
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('donorId')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="">Anonim bağış</NativeSelectOption>
              {(donors.data?.data ?? []).map((donor) => (
                <NativeSelectOption key={donor.id} value={donor.id}>
                  {donor.maskedIdentityNumber === null
                    ? donor.name
                    : `${donor.name} · ${donor.maskedIdentityNumber}`}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="bagis-tur" label="Bağış türü" error={errors.kind}>
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('kind')}
                className="w-full"
                disabled={busy}
              >
                {DONATION_KINDS.map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {DONATION_KIND_LABELS[value]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField id="bagis-gun" label="Bağış günü" error={errors.donatedOn}>
            {(control) => (
              <Input
                {...control}
                {...form.register('donatedOn')}
                type="date"
                min={campaign.startsOn}
                max={today > campaign.endsOn ? campaign.endsOn : today}
                disabled={busy}
              />
            )}
          </FormField>
        </div>
        {kind === 'cash' ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="bagis-tutar" label="Tutar (₺)" error={errors.amount}>
                {(control) => (
                  <Input
                    {...control}
                    {...form.register('amount')}
                    inputMode="decimal"
                    disabled={busy}
                  />
                )}
              </FormField>
              <FormField id="bagis-yol" label="Ödeme yolu" error={errors.method}>
                {(control) => (
                  <NativeSelect
                    {...control}
                    {...form.register('method')}
                    className="w-full"
                    disabled={busy}
                  >
                    {DONATION_METHODS.map((value) => (
                      <NativeSelectOption key={value} value={value}>
                        {DONATION_METHOD_LABELS[value]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
            </div>
            {method === 'bank_transfer' ? (
              <FormField id="bagis-hesap" label="Banka hesabı" error={errors.bankAccountId}>
                {(control) => (
                  <NativeSelect
                    {...control}
                    {...form.register('bankAccountId')}
                    className="w-full"
                    disabled={busy}
                  >
                    <NativeSelectOption value="">
                      {campaign.bankAccountLabel === null
                        ? 'Hesap seçin'
                        : `Kampanya hesabı (${campaign.bankAccountLabel})`}
                    </NativeSelectOption>
                    {(accounts.data?.data ?? []).map((account) => (
                      <NativeSelectOption key={account.id} value={account.id}>
                        {bankAccountLabel(account)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
            ) : null}
            <FormField
              id="bagis-referans"
              label="Dekont / slip no (isteğe bağlı)"
              error={errors.reference}
            >
              {(control) => <Input {...control} {...form.register('reference')} disabled={busy} />}
            </FormField>
          </>
        ) : (
          <>
            <FormField
              id="bagis-ayni-aciklama"
              label="Ayni bağış açıklaması"
              description="Ne bağışlandı, kaç adet. Ayni bağış hedefe sayılmaz."
              error={errors.description}
            >
              {(control) => (
                <Textarea {...control} {...form.register('description')} rows={2} disabled={busy} />
              )}
            </FormField>
            <FormField
              id="bagis-beyan"
              label="Beyan edilen değer (₺, isteğe bağlı)"
              error={errors.declaredValue}
            >
              {(control) => (
                <Input
                  {...control}
                  {...form.register('declaredValue')}
                  inputMode="decimal"
                  disabled={busy}
                />
              )}
            </FormField>
          </>
        )}
        <FormField id="bagis-not" label="Not (isteğe bağlı)" error={errors.note}>
          {(control) => <Input {...control} {...form.register('note')} disabled={busy} />}
        </FormField>
        <RootError message={errors.root?.server?.message} />
      </form>
    </Modal>
  )
}

function StatusModal({ campaign, onClose }: { campaign: DonationCampaign; onClose: () => void }) {
  const open = useOpenDonationCampaign()
  const close = useCloseDonationCampaign()
  const opening = campaign.status === 'draft'
  const command = opening ? open : close
  async function run() {
    const outcome = await command.submit({ campaignId: campaign.id, version: campaign.version })
    if (outcome.status === 'success') {
      notify.success(opening ? `${campaign.name} açıldı.` : `${campaign.name} kapatıldı.`)
      onClose()
    } else if (outcome.status === 'failed') onClose()
  }
  return (
    <Modal
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={opening ? 'Kampanyayı aç' : 'Kampanyayı kapat'}
      description={
        opening
          ? 'Açık kampanyaya bağış kaydedilir.'
          : 'Kapanan kampanyaya bağış kaydedilmez ve kampanya yeniden açılmaz; bağış iptali yapılabilir.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={command.isPending}>
            Vazgeç
          </Button>
          <Button
            type="button"
            variant={opening ? 'default' : 'destructive'}
            disabled={command.isPending}
            aria-busy={command.isPending || undefined}
            onClick={() => void run()}
          >
            {opening ? 'Kampanyayı aç' : 'Kampanyayı kapat'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        Toplanan {money(campaign.collectedCents)}, hedef {money(campaign.targetCents)}.
      </p>
    </Modal>
  )
}

const CANCEL_FORM = 'bagis-iptal-formu'

function CancelModal({ donation, onClose }: { donation: Donation; onClose: () => void }) {
  const cancel = useCancelDonation()
  const form = useForm<CancelFormValues>({
    resolver: zodResolver(cancelFormSchema),
    defaultValues: { reason: '' },
  })
  const busy = cancel.isPending || form.formState.isSubmitting
  const label = donationReceiptLabel(donation)
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await cancel.submit(
      { donationId: donation.id, version: donation.version, reason: values.reason },
      {
        setError: (name, error) =>
          name === 'reason'
            ? form.setError('reason', error, { shouldFocus: true })
            : form.setError('root.server', error),
      },
    )
    if (outcome.status === 'success') {
      notify.success(`${label} makbuzu iptal edildi.`)
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  return (
    <Modal
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Bağış iptali"
      description={`${label} makbuzu "İptal edildi" ibaresiyle kalır; numara yeniden kullanılmaz.`}
      footer={
        <Footer formId={CANCEL_FORM} busy={busy} label="İptal et" onClose={onClose} destructive />
      }
    >
      <form
        id={CANCEL_FORM}
        noValidate
        aria-label="Bağış iptali"
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField
          id="bagis-iptal-gerekce"
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
