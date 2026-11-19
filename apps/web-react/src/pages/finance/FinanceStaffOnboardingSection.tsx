import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useCreateLeaveProfile } from '@kampus/react-shared/use-finance-staff-leave.ts'
import { useCreatePayRate } from '@kampus/react-shared/use-finance-pay-rates.ts'
import {
  useCompleteOnboardingStep,
  useCreateJobOffer,
  useJobOffer,
  useJobOffers,
  useJobOfferTransition,
  useLinkJobOfferAccount,
  useOnboardingSettings,
  useOnboardingStaff,
  useReopenOnboardingStep,
  useUpdateJobOffer,
  useUpdateOnboardingSettings,
  useUpdateOnboardingStep,
  type JobOfferDetail,
  type JobOfferVerb,
  type OnboardingSettings,
  type OnboardingStep,
} from '@kampus/react-shared/use-finance-staff-onboarding.ts'
import { WAGE_TYPE_LABELS, WAGE_TYPES } from '@kampus/school-core/lib/finance-pay-rates.ts'
import {
  JOB_OFFER_STATUS_LABELS,
  JOB_OFFER_STATUSES,
  ONBOARDING_STATE_LABELS,
  jobOfferWageText,
} from '@kampus/school-core/lib/finance-staff-onboarding.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { STAFF_ROLE_LABELS, STAFF_ROLES } from '@kampus/school-core/lib/staff-accounts.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useJobOfferLetterPdf } from '@/hooks/use-finance-job-offer-pdf.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { JOB_OFFER_LETTER_TITLE } from '@/lib/pdf/templates/finance-job-offer.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { PdfDialogButton } from './CorporateParts.tsx'
import {
  dayText,
  EVIDENCE_LABELS,
  EVIDENCE_TONES,
  offerBody,
  offerChanges,
  offerDefaults,
  offerFormField,
  offerFormSchema,
  offerValues,
  onboardingText,
  ONBOARDING_TONES,
  orientationBody,
  quickActionOf,
  STATUS_TONES,
  stepMetaText,
  type OfferFormValues,
} from './finance-staff-onboarding-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['name', 'status']
const FILTERS = [
  {
    key: 'status',
    label: 'Durum',
    type: 'select' as const,
    options: JOB_OFFER_STATUSES.map((value) => ({ value, label: JOB_OFFER_STATUS_LABELS[value] })),
  },
]
const STATUS_VALUES = new Set<string>(JOB_OFFER_STATUSES)

type Row = {
  id: string
  name: string
  position: string
  start: string
  status: (typeof JOB_OFFER_STATUSES)[number]
  onboarding: string
  onboardingState: keyof typeof ONBOARDING_TONES
}

/**
 * İşe başlama (DOM-FIN-121; ON-179): Finans "İşe başlama" sekmesi, yalnız yönetici (K-412).
 * Teklifler listelenir; panelde teklif, durum geçişleri, mektup PDF'i ve kabulden sonra işe
 * başlama listesi bulunur. Hesap burada açılmaz: Kullanıcılar sayfasında davetle açılan hesap
 * bağlanır (IST-007). Kaynak isteyen adım kaynak kaydı olmadan işaretlenmez (K-413).
 */
export function FinanceStaffOnboardingSection() {
  const list = useListState('ise-baslama', { urlPrefix: 'teklif_' })
  const search = useDebouncedValue(list.state.query).trim()
  const statusFilter = list.state.filters.status
  const status =
    typeof statusFilter === 'string' && STATUS_VALUES.has(statusFilter)
      ? (statusFilter as (typeof JOB_OFFER_STATUSES)[number])
      : undefined
  const offers = useJobOffers({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(status === undefined ? {} : { status }),
  })
  const panel = useDetailPanel('teklif')
  const openOffer = panel.open
  const [dialog, setDialog] = useState<'create' | 'settings' | null>(null)
  const rows = useMemo(
    () =>
      offers.data?.data.map((item): Row => ({
        id: item.id,
        name: item.name,
        position: item.position,
        start: dayText(item.startDate),
        status: item.status,
        onboarding: onboardingText(item),
        onboardingState: item.onboarding.state,
      })),
    [offers.data],
  )
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'name', label: 'Aday' },
      { key: 'position', label: 'Pozisyon' },
      { key: 'start', label: 'İşe başlama' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge text={JOB_OFFER_STATUS_LABELS[row.status]} tone={STATUS_TONES[row.status]} />
        ),
      },
      {
        key: 'onboarding',
        label: 'İşe başlama listesi',
        cell: (row) =>
          row.onboardingState === 'none' ? (
            '—'
          ) : (
            <StatusBadge text={row.onboarding} tone={ONBOARDING_TONES[row.onboardingState]} />
          ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row: Row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.name} teklifini aç`}
            onClick={() => openOffer(row.id)}
          >
            Aç
          </Button>
        ),
      },
    ],
    [openOffer],
  )
  return (
    <section
      aria-labelledby="ise-baslama"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading grid gap-2 px-6 pt-6 pb-2">
        <h2 id="ise-baslama" className="text-lg font-semibold">
          İşe başlama
        </h2>
        <p className="text-sm text-muted-foreground">
          İş teklifi ve kabulden sonra işe başlama listesi. Kampüs adaya e-posta göndermez; teklif
          mektubunu PDF olarak indirip iletin.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDialog('create')}>Yeni teklif</Button>
          <Button variant="secondary" onClick={() => setDialog('settings')}>
            Oryantasyon adımları
          </Button>
        </div>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={offers.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={FILTERS}
        mobileColumns={MOBILE}
        caption="İş teklifleri"
        empty="Henüz iş teklifi yok."
        emptyFiltered="Bu seçimle eşleşen teklif yok."
        loading={offers.isPending}
        fetching={offers.isFetching && !offers.isPending}
        error={
          offers.error ? (
            <QueryError error={offers.error} onRetry={() => void offers.refetch()} />
          ) : undefined
        }
      />
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="İş teklifi"
      >
        {panel.selectedId ? <OfferPanel offerId={panel.selectedId} /> : null}
      </SidePanel>
      <Modal
        open={dialog !== null}
        onOpenChange={(value) => (value ? undefined : setDialog(null))}
        title={dialog === 'settings' ? 'Oryantasyon adımları' : 'Yeni iş teklifi'}
      >
        {dialog === 'create' ? (
          <OfferForm
            onDone={(id) => {
              setDialog(null)
              openOffer(id)
            }}
          />
        ) : null}
        {dialog === 'settings' ? <SettingsDialog onDone={() => setDialog(null)} /> : null}
      </Modal>
    </section>
  )
}

type PanelDialog =
  | { kind: 'edit' }
  | { kind: 'decision'; verb: JobOfferVerb }
  | { kind: 'complete'; step: OnboardingStep }
  | { kind: 'assign'; step: OnboardingStep }
  | null

const VERB_TITLES = {
  send: 'Gönderildi olarak işaretle',
  accept: 'Kabulü kaydet',
  reject: 'Reddi kaydet',
  withdraw: 'Teklifi geri çek',
} as const satisfies Record<JobOfferVerb, string>

function OfferPanel({ offerId }: { offerId: string }) {
  const detail = useJobOffer(offerId)
  const [dialog, setDialog] = useState<PanelDialog>(null)
  if (detail.error) return <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
  const offer = detail.data?.data
  if (!offer) return <SummaryLoading />
  const close = () => setDialog(null)
  const decide = (verb: JobOfferVerb) => () => setDialog({ kind: 'decision', verb })
  const withdrawable =
    offer.status === 'draft' ||
    offer.status === 'sent' ||
    (offer.status === 'accepted' && offer.onboarding.state === 'open')
  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold">
          {offer.name}
          <StatusBadge
            text={JOB_OFFER_STATUS_LABELS[offer.status]}
            tone={STATUS_TONES[offer.status]}
          />
        </h3>
        <p className="text-sm text-muted-foreground">
          {offer.position} · {STAFF_ROLE_LABELS[offer.staffRole]} · işe başlama{' '}
          {dayText(offer.startDate)}
        </p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Ücret önerisi</dt>
        <dd>{jobOfferWageText(offer)}</dd>
        {offer.candidateEmail ? (
          <>
            <dt className="text-muted-foreground">E-posta</dt>
            <dd className="[overflow-wrap:anywhere]">{offer.candidateEmail}</dd>
          </>
        ) : null}
        {offer.candidatePhone ? (
          <>
            <dt className="text-muted-foreground">Telefon</dt>
            <dd>{offer.candidatePhone}</dd>
          </>
        ) : null}
        {offer.respondBy ? (
          <>
            <dt className="text-muted-foreground">Son yanıt günü</dt>
            <dd>{dayText(offer.respondBy)}</dd>
          </>
        ) : null}
        {offer.sentOn ? (
          <>
            <dt className="text-muted-foreground">Gönderim</dt>
            <dd>{dayText(offer.sentOn)}</dd>
          </>
        ) : null}
        {offer.acceptedOn ? (
          <>
            <dt className="text-muted-foreground">Kabul</dt>
            <dd>{dayText(offer.acceptedOn)}</dd>
          </>
        ) : null}
        {offer.closedOn ? (
          <>
            <dt className="text-muted-foreground">
              {offer.status === 'rejected' ? 'Ret' : 'Geri çekme'}
            </dt>
            <dd>
              {dayText(offer.closedOn)}
              {offer.closeReason ? ` · ${offer.closeReason}` : ''}
            </dd>
          </>
        ) : null}
        {offer.note ? (
          <>
            <dt className="text-muted-foreground">Not</dt>
            <dd className="[overflow-wrap:anywhere]">{offer.note}</dd>
          </>
        ) : null}
      </dl>
      <div className="flex flex-wrap gap-2">
        {offer.status === 'draft' ? (
          <>
            <Button size="sm" onClick={decide('send')}>
              Gönderildi
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'edit' })}>
              Düzelt
            </Button>
          </>
        ) : null}
        {offer.status === 'sent' ? (
          <>
            <Button size="sm" onClick={decide('accept')}>
              Kabul edildi
            </Button>
            <Button size="sm" variant="secondary" onClick={decide('reject')}>
              Reddedildi
            </Button>
          </>
        ) : null}
        {withdrawable ? (
          <Button size="sm" variant="secondary" onClick={decide('withdraw')}>
            Geri çek
          </Button>
        ) : null}
        <PdfDialogButton
          label="Teklif mektubu"
          title={JOB_OFFER_LETTER_TITLE}
          id={offer.id}
          usePdf={useJobOfferLetterPdf}
          accessibleName={`${offer.name} teklif mektubu PDF`}
        />
      </div>
      {offer.steps.length > 0 ? (
        <Checklist
          offer={offer}
          onComplete={(step) => setDialog({ kind: 'complete', step })}
          onAssign={(step) => setDialog({ kind: 'assign', step })}
        />
      ) : null}
      <Modal
        open={dialog !== null}
        onOpenChange={(value) => (value ? undefined : close())}
        title={
          dialog === null
            ? ''
            : dialog.kind === 'edit'
              ? 'Teklifi düzelt'
              : dialog.kind === 'decision'
                ? VERB_TITLES[dialog.verb]
                : dialog.kind === 'complete'
                  ? 'Adımı tamamla'
                  : 'Sorumlu ve son gün'
        }
      >
        {dialog?.kind === 'edit' ? <OfferForm offer={offer} onDone={close} /> : null}
        {dialog?.kind === 'decision' ? (
          <DecisionForm offer={offer} verb={dialog.verb} onDone={close} />
        ) : null}
        {dialog?.kind === 'complete' ? (
          <CompleteForm offer={offer} step={dialog.step} onDone={close} />
        ) : null}
        {dialog?.kind === 'assign' ? (
          <AssignForm offer={offer} step={dialog.step} onDone={close} />
        ) : null}
      </Modal>
    </div>
  )
}

/** İşe başlama listesi (K-413, K-414): hesap bağlama, adımlar, kaynak durumu ve hızlı işlemler. */
function Checklist({
  offer,
  onComplete,
  onAssign,
}: {
  offer: JobOfferDetail
  onComplete: (step: OnboardingStep) => void
  onAssign: (step: OnboardingStep) => void
}) {
  const reopen = useReopenOnboardingStep()
  const createPayRate = useCreatePayRate()
  const createProfile = useCreateLeaveProfile()
  const open = offer.status === 'accepted'
  const today = dayKey()
  const progress = offer.onboarding
  const busy = reopen.isPending || createPayRate.isPending || createProfile.isPending
  const runQuick = async (kind: 'pay_rate' | 'seniority') => {
    const membershipId = offer.membershipId
    if (membershipId === null) return
    const outcome =
      kind === 'pay_rate'
        ? await createPayRate.submit({
            membershipId,
            component: 'wage',
            rateType: offer.wageType,
            amountCents: offer.offeredAmountCents,
            startDate: offer.startDate,
            endDate: null,
            note: 'İş teklifinden aktarıldı',
          })
        : await createProfile.submit({ membershipId, seniorityStartDate: offer.startDate })
    if (outcome.status !== 'success') return
    notify.success(
      kind === 'pay_rate'
        ? 'Teklifteki ücret, ücret tanımına aktarıldı.'
        : 'Kıdem başlangıcı işe başlama günü olarak girildi.',
    )
  }
  return (
    <section aria-labelledby="ise-baslama-listesi" className="grid gap-3">
      <h4
        id="ise-baslama-listesi"
        className="flex flex-wrap items-center gap-2 text-sm font-semibold"
      >
        İşe başlama listesi
        <StatusBadge
          text={
            progress.state === 'open'
              ? `${String(progress.requiredDone)}/${String(progress.requiredTotal)} zorunlu adım`
              : ONBOARDING_STATE_LABELS[progress.state]
          }
          tone={ONBOARDING_TONES[progress.state]}
        />
      </h4>
      {open ? <AccountLink offer={offer} /> : null}
      <ul aria-label="İşe başlama adımları" className="grid gap-2 text-sm">
        {offer.steps.map((step) => {
          const quick = quickActionOf(step, offer, today)
          return (
            <li
              key={step.id}
              aria-label={step.label}
              className="grid gap-1 rounded-sm border px-3 py-2"
            >
              <span className="flex flex-wrap items-center gap-2 font-medium">
                {step.label}
                {step.completedOn !== null ? (
                  <StatusBadge text="Tamamlandı" tone="green" />
                ) : (
                  <StatusBadge
                    text={EVIDENCE_LABELS[step.evidence.state]}
                    tone={EVIDENCE_TONES[step.evidence.state]}
                  />
                )}
              </span>
              <span className="text-muted-foreground">{stepMetaText(step)}</span>
              <span className="text-muted-foreground">{step.evidence.detail}</span>
              {step.evidence.warning ? (
                <span className="text-sm">
                  <StatusBadge text="Uyarı" tone="amber" /> {step.evidence.warning}
                </span>
              ) : null}
              {step.note ? (
                <span className="text-muted-foreground [overflow-wrap:anywhere]">{step.note}</span>
              ) : null}
              {open ? (
                <span className="flex flex-wrap gap-2">
                  {step.completedOn === null ? (
                    <Button
                      size="sm"
                      disabled={busy || step.evidence.state === 'missing'}
                      aria-label={`${step.label}: tamamlandı`}
                      onClick={() => onComplete(step)}
                    >
                      Tamamlandı
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      aria-label={`${step.label}: işareti geri al`}
                      onClick={() =>
                        void reopen
                          .submit({ offerId: offer.id, stepId: step.id, version: offer.version })
                          .then((outcome) => {
                            if (outcome.status === 'success') notify.success('İşaret geri alındı.')
                          })
                      }
                    >
                      Geri al
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    aria-label={`${step.label}: sorumlu ve son gün`}
                    onClick={() => onAssign(step)}
                  >
                    Sorumlu
                  </Button>
                  {quick === 'pay_rate' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void runQuick('pay_rate')}
                    >
                      Teklifteki ücreti aktar
                    </Button>
                  ) : null}
                  {quick === 'seniority' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void runQuick('seniority')}
                    >
                      Kıdem başlangıcını gir
                    </Button>
                  ) : null}
                </span>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Hesap bağlama (IST-007): davetle açılmış, teklifteki roldeki etkin personel seçilir. */
function AccountLink({ offer }: { offer: JobOfferDetail }) {
  const staff = useOnboardingStaff()
  const link = useLinkJobOfferAccount()
  const [membershipId, setMembershipId] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const options = (staff.data?.data ?? []).filter(
    (item) => item.role === offer.staffRole && item.membershipId !== offer.membershipId,
  )
  const submit = async () => {
    setError(undefined)
    if (membershipId === '') {
      setError('Personel hesabını seçin.')
      return
    }
    const outcome = await link.submit(
      { offerId: offer.id, version: offer.version, membershipId },
      { setError: (_name, issue) => setError(issue.message) },
    )
    if (outcome.status !== 'success') return
    setMembershipId('')
    notify.success('Personel hesabı bağlandı.')
  }
  return (
    <form
      noValidate
      aria-label="Personel hesabı"
      className="grid gap-2 rounded-sm border px-3 py-2"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <p className="text-sm">
        {offer.member === null
          ? 'Hesap henüz bağlanmadı.'
          : `Bağlı hesap: ${offer.member.name}${offer.member.active ? '' : ' (pasif)'}`}{' '}
        <span className="text-muted-foreground">
          Hesap Kullanıcılar sayfasından davetle açılır; burada yalnız bağlanır.
        </span>
      </p>
      <FormField
        id="ise-baslama-hesap"
        label={`Personel hesabı (${STAFF_ROLE_LABELS[offer.staffRole]})`}
        error={error === undefined ? undefined : { message: error }}
      >
        {(control) => (
          <NativeSelect
            {...control}
            className="w-full"
            value={membershipId}
            onChange={(event) => setMembershipId(event.target.value)}
            disabled={link.isPending}
          >
            <NativeSelectOption value="">Seçin</NativeSelectOption>
            {options.map((item) => (
              <NativeSelectOption key={item.membershipId} value={item.membershipId}>
                {item.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <div>
        <Button
          type="submit"
          size="sm"
          disabled={link.isPending}
          aria-busy={link.isPending || undefined}
        >
          Hesabı bağla
        </Button>
      </div>
    </form>
  )
}

/** Yeni teklif ya da taslak düzeltmesi (K-412). */
function OfferForm({
  offer,
  onDone,
}: {
  offer?: JobOfferDetail
  onDone: (offerId: string) => void
}) {
  const create = useCreateJobOffer()
  const update = useUpdateJobOffer()
  const staff = useOnboardingStaff()
  const form = useForm<OfferFormValues>({
    resolver: zodResolver(offerFormSchema),
    defaultValues: offer === undefined ? offerDefaults(dayKey()) : offerValues(offer),
  })
  const errors = form.formState.errors
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const kind = useWatch({ control: form.control, name: 'candidateKind' })
  const setError = (name: string, error: { message?: string }) => {
    const field = offerFormField(name)
    if (field) form.setError(field, error, { shouldFocus: true })
    else form.setError('root.server', error)
  }
  const onSubmit = form.handleSubmit(async (values) => {
    if (offer === undefined) {
      const outcome = await create.submit(offerBody(values), { setError })
      if (outcome.status !== 'success') return
      notify.success('Teklif taslağı hazırlandı.')
      onDone(outcome.data.data.id)
      return
    }
    const changes = offerChanges(offer, values)
    if (Object.keys(changes).length === 0) {
      form.setError('root.server', { message: 'Teklifte değişen bir alan yok.' })
      return
    }
    const outcome = await update.submit(
      { offerId: offer.id, version: offer.version, body: changes },
      { setError },
    )
    if (outcome.status !== 'success') return
    notify.success('Teklif düzeltildi.')
    onDone(offer.id)
  })
  return (
    <form
      noValidate
      aria-label="İş teklifi"
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      {offer === undefined ? (
        <FormField id="teklif-aday-turu" label="Aday" error={errors.candidateKind}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('candidateKind')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="candidate">Kurum dışından aday</NativeSelectOption>
              <NativeSelectOption value="staff">Kurumdaki personel</NativeSelectOption>
            </NativeSelect>
          )}
        </FormField>
      ) : null}
      {kind === 'staff' ? (
        offer === undefined ? (
          <FormField id="teklif-personel" label="Personel" error={errors.membershipId}>
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('membershipId')}
                className="w-full"
                disabled={busy}
              >
                <NativeSelectOption value="">Seçin</NativeSelectOption>
                {(staff.data?.data ?? []).map((item) => (
                  <NativeSelectOption key={item.membershipId} value={item.membershipId}>
                    {item.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        ) : null
      ) : (
        <>
          <FormField id="teklif-ad" label="Adayın adı" error={errors.candidateName}>
            {(control) => (
              <Input
                {...control}
                autoComplete="off"
                {...form.register('candidateName')}
                disabled={busy}
              />
            )}
          </FormField>
          <FormField
            id="teklif-eposta"
            label="E-posta (isteğe bağlı)"
            description="Kampüs bu adrese e-posta göndermez."
            error={errors.candidateEmail}
          >
            {(control) => (
              <Input
                {...control}
                type="email"
                autoComplete="off"
                {...form.register('candidateEmail')}
                disabled={busy}
              />
            )}
          </FormField>
          <FormField
            id="teklif-telefon"
            label="Telefon (isteğe bağlı)"
            error={errors.candidatePhone}
          >
            {(control) => (
              <Input
                {...control}
                inputMode="tel"
                autoComplete="off"
                {...form.register('candidatePhone')}
                disabled={busy}
              />
            )}
          </FormField>
        </>
      )}
      <FormField id="teklif-pozisyon" label="Pozisyon" error={errors.position}>
        {(control) => (
          <Input {...control} autoComplete="off" {...form.register('position')} disabled={busy} />
        )}
      </FormField>
      <FormField id="teklif-rol" label="Rol" error={errors.staffRole}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('staffRole')}
            className="w-full"
            disabled={busy}
          >
            {STAFF_ROLES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {STAFF_ROLE_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="teklif-baslangic" label="İşe başlama günü" error={errors.startDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('startDate')} disabled={busy} />
        )}
      </FormField>
      <FormField id="teklif-ucret-turu" label="Ücret türü" error={errors.wageType}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('wageType')}
            className="w-full"
            disabled={busy}
          >
            {WAGE_TYPES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {WAGE_TYPE_LABELS[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="teklif-ucret" label="Ücret önerisi (₺)" error={errors.amount}>
        {(control) => (
          <Input
            {...control}
            inputMode="decimal"
            autoComplete="off"
            {...form.register('amount')}
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="teklif-son-gun" label="Son yanıt günü (isteğe bağlı)" error={errors.respondBy}>
        {(control) => (
          <Input {...control} type="date" {...form.register('respondBy')} disabled={busy} />
        )}
      </FormField>
      <div className="sm:col-span-2">
        <FormField id="teklif-not" label="Ek koşullar / not (isteğe bağlı)" error={errors.note}>
          {(control) => (
            <Textarea {...control} {...form.register('note')} rows={2} disabled={busy} />
          )}
        </FormField>
      </div>
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Kaydet
        </Button>
      </div>
    </form>
  )
}

/** Gönderim, kabul, ret ya da geri çekme günü; ret ve geri çekmede isteğe bağlı gerekçe. */
function DecisionForm({
  offer,
  verb,
  onDone,
}: {
  offer: JobOfferDetail
  verb: JobOfferVerb
  onDone: () => void
}) {
  const transition = useJobOfferTransition()
  const [day, setDay] = useState(() => dayKey())
  const [reason, setReason] = useState('')
  const [error, setError] = useState<{ field: string; message?: string } | null>(null)
  const withReason = verb === 'reject' || verb === 'withdraw'
  const submit = async () => {
    setError(null)
    const outcome = await transition.submit(
      {
        offerId: offer.id,
        version: offer.version,
        verb,
        day,
        reason: reason.trim() === '' ? null : reason.trim(),
      },
      { setError: (name, issue) => setError({ field: name, ...issue }) },
    )
    if (outcome.status !== 'success') return
    notify.success(
      verb === 'accept'
        ? 'Kabul kaydedildi; işe başlama listesi açıldı.'
        : `${VERB_TITLES[verb]}: kaydedildi.`,
    )
    onDone()
  }
  const dayError =
    error !== null && (error.field === 'sentOn' || error.field === 'decidedOn')
      ? { message: error.message }
      : undefined
  return (
    <form
      noValidate
      aria-label={VERB_TITLES[verb]}
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <p className="text-sm">
        {offer.name} · {offer.position}
      </p>
      <FormField
        id="teklif-karar-gunu"
        label={verb === 'send' ? 'Gönderim günü' : 'Gün'}
        error={dayError}
      >
        {(control) => (
          <Input
            {...control}
            type="date"
            value={day}
            onChange={(event) => setDay(event.target.value)}
            disabled={transition.isPending}
          />
        )}
      </FormField>
      {withReason ? (
        <FormField
          id="teklif-karar-gerekce"
          label="Gerekçe (isteğe bağlı)"
          error={error?.field === 'reason' ? { message: error.message } : undefined}
        >
          {(control) => (
            <Textarea
              {...control}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              disabled={transition.isPending}
            />
          )}
        </FormField>
      ) : null}
      <RootError
        message={
          error !== null && dayError === undefined && error.field !== 'reason'
            ? error.message
            : undefined
        }
      />
      <div>
        <Button
          type="submit"
          variant={verb === 'withdraw' ? 'destructive' : 'default'}
          disabled={transition.isPending}
          aria-busy={transition.isPending || undefined}
        >
          Kaydet
        </Button>
      </div>
    </form>
  )
}

/** Adımı tamamla (K-414): gün (bugünden sonra olamaz) ve isteğe bağlı not. */
function CompleteForm({
  offer,
  step,
  onDone,
}: {
  offer: JobOfferDetail
  step: OnboardingStep
  onDone: () => void
}) {
  const complete = useCompleteOnboardingStep()
  const [day, setDay] = useState(() => dayKey())
  const [note, setNote] = useState('')
  const [error, setError] = useState<{ field: string; message?: string } | null>(null)
  const submit = async () => {
    setError(null)
    const outcome = await complete.submit(
      {
        offerId: offer.id,
        stepId: step.id,
        version: offer.version,
        completedOn: day,
        note: note.trim() === '' ? null : note.trim(),
      },
      { setError: (name, issue) => setError({ field: name, ...issue }) },
    )
    if (outcome.status !== 'success') return
    notify.success(
      outcome.data.data.onboarding.state === 'completed'
        ? 'Adım tamamlandı; işe başlama listesi tamamlandı.'
        : 'Adım tamamlandı.',
    )
    onDone()
  }
  return (
    <form
      noValidate
      aria-label="Adımı tamamla"
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <p className="text-sm">{step.label}</p>
      <FormField
        id="adim-gun"
        label="Tamamlanma günü"
        error={error?.field === 'completedOn' ? { message: error.message } : undefined}
      >
        {(control) => (
          <Input
            {...control}
            type="date"
            value={day}
            onChange={(event) => setDay(event.target.value)}
            disabled={complete.isPending}
          />
        )}
      </FormField>
      <FormField
        id="adim-not"
        label="Not (isteğe bağlı)"
        error={error?.field === 'note' ? { message: error.message } : undefined}
      >
        {(control) => (
          <Textarea
            {...control}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            disabled={complete.isPending}
          />
        )}
      </FormField>
      <RootError
        message={
          error !== null && error.field !== 'completedOn' && error.field !== 'note'
            ? error.message
            : undefined
        }
      />
      <div>
        <Button
          type="submit"
          disabled={complete.isPending}
          aria-busy={complete.isPending || undefined}
        >
          Tamamlandı
        </Button>
      </div>
    </form>
  )
}

/** Sorumlu ve son gün (K-414). */
function AssignForm({
  offer,
  step,
  onDone,
}: {
  offer: JobOfferDetail
  step: OnboardingStep
  onDone: () => void
}) {
  const staff = useOnboardingStaff()
  const update = useUpdateOnboardingStep()
  const [responsible, setResponsible] = useState(step.responsible?.membershipId ?? '')
  const [dueDate, setDueDate] = useState(step.dueDate ?? '')
  const [error, setError] = useState<string | undefined>(undefined)
  const submit = async () => {
    setError(undefined)
    const outcome = await update.submit(
      {
        offerId: offer.id,
        stepId: step.id,
        version: offer.version,
        body: {
          responsibleMembershipId: responsible === '' ? null : responsible,
          dueDate: dueDate === '' ? null : dueDate,
        },
      },
      { setError: (_name, issue) => setError(issue.message) },
    )
    if (outcome.status !== 'success') return
    notify.success('Adım güncellendi.')
    onDone()
  }
  return (
    <form
      noValidate
      aria-label="Sorumlu ve son gün"
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <p className="text-sm">{step.label}</p>
      <FormField id="adim-sorumlu" label="Sorumlu">
        {(control) => (
          <NativeSelect
            {...control}
            className="w-full"
            value={responsible}
            onChange={(event) => setResponsible(event.target.value)}
            disabled={update.isPending}
          >
            <NativeSelectOption value="">Sorumlu yok</NativeSelectOption>
            {(staff.data?.data ?? []).map((item) => (
              <NativeSelectOption key={item.membershipId} value={item.membershipId}>
                {item.name} ({STAFF_ROLE_LABELS[item.role]})
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="adim-son-gun" label="Son gün (isteğe bağlı)">
        {(control) => (
          <Input
            {...control}
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            disabled={update.isPending}
          />
        )}
      </FormField>
      <RootError message={error} />
      <div>
        <Button type="submit" disabled={update.isPending} aria-busy={update.isPending || undefined}>
          Kaydet
        </Button>
      </div>
    </form>
  )
}

/** Oryantasyon adımları (K-413): yeni listelere kopyalanır; açılmış listeler değişmez. */
function SettingsDialog({ onDone }: { onDone: () => void }) {
  const settings = useOnboardingSettings()
  if (settings.error)
    return <QueryError error={settings.error} onRetry={() => void settings.refetch()} />
  const data = settings.data?.data
  if (!data) return <SummaryLoading />
  return <SettingsForm settings={data} onDone={onDone} />
}

function SettingsForm({ settings, onDone }: { settings: OnboardingSettings; onDone: () => void }) {
  const update = useUpdateOnboardingSettings()
  // Satır anahtarı yalnız listede kalır (silme ve eklemede odak doğru satırda kalsın diye).
  const [steps, setSteps] = useState(() =>
    settings.orientationSteps.map((step) => ({ ...step, key: crypto.randomUUID() })),
  )
  const [error, setError] = useState<string | undefined>(undefined)
  const patch = (index: number, change: Partial<(typeof steps)[number]>) =>
    setSteps((current) =>
      current.map((step, position) => (position === index ? { ...step, ...change } : step)),
    )
  const submit = async () => {
    setError(undefined)
    const outcome = await update.submit(
      {
        version: settings.version,
        body: orientationBody({ steps: steps.map(({ label, required }) => ({ label, required })) }),
      },
      { setError: (_name, issue) => setError(issue.message) },
    )
    if (outcome.status !== 'success') return
    notify.success('Oryantasyon adımları kaydedildi.')
    onDone()
  }
  return (
    <form
      noValidate
      aria-label="Oryantasyon adımları"
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <p className="text-sm text-muted-foreground">
        Adımlar teklif kabul edilince işe başlama listesine kopyalanır; açılmış listeler değişmez.
        Boş bırakılan satır kaydedilmez.
      </p>
      <ul className="grid gap-2">
        {steps.map((step, index) => (
          <li key={step.key} className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <FormField id={`oryantasyon-${String(index)}`} label={`Adım ${String(index + 1)}`}>
                {(control) => (
                  <Input
                    {...control}
                    value={step.label}
                    onChange={(event) => patch(index, { label: event.target.value })}
                    disabled={update.isPending}
                  />
                )}
              </FormField>
            </div>
            <div className="flex items-center gap-2 pb-2">
              <Checkbox
                id={`oryantasyon-${String(index)}-zorunlu`}
                checked={step.required}
                disabled={update.isPending}
                onCheckedChange={(checked) => patch(index, { required: checked === true })}
              />
              <Label htmlFor={`oryantasyon-${String(index)}-zorunlu`}>Zorunlu</Label>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              aria-label={`Adım ${String(index + 1)} sil`}
              disabled={update.isPending}
              onClick={() => setSteps((current) => current.filter((_, at) => at !== index))}
            >
              Sil
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={update.isPending || steps.length >= 20}
          onClick={() =>
            setSteps((current) => [
              ...current,
              { label: '', required: true, key: crypto.randomUUID() },
            ])
          }
        >
          Adım ekle
        </Button>
        <Button type="submit" disabled={update.isPending} aria-busy={update.isPending || undefined}>
          Kaydet
        </Button>
      </div>
      <RootError message={error} />
    </form>
  )
}
