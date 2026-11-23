import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {
  useCreateDonationCampaign,
  useCreateDonor,
  useDonationCampaigns,
  useDonationSettings,
  useDonors,
  useSetDonationSettings,
  useUpdateDonationCampaign,
  useUpdateDonor,
  type DonationCampaign,
  type DonationSettings,
  type Donor,
} from '@kampus/react-shared/use-finance-donations.ts'
import { useBankAccounts } from '@kampus/react-shared/use-payment-commands.ts'
import {
  DONATION_CAMPAIGN_STATUS_LABELS,
  DONATION_CAMPAIGN_STATUSES,
  DONOR_KIND_LABELS,
  DONOR_KINDS,
  DONOR_RELATION_LABELS,
  DONOR_RELATIONS,
  type DonationCampaignStatus,
} from '@kampus/school-core/lib/finance-donations.ts'
import { dateLabel, dayKey } from '@kampus/school-core/lib/format.ts'
import { bankAccountLabel } from '@kampus/school-core/lib/payments.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { CampaignProgress, DonationCampaignPanel } from './DonationCampaignPanel.tsx'
import {
  campaignBody,
  campaignDefaults,
  campaignFormSchema,
  campaignValues,
  donorBody,
  donorDefaults,
  donorFormSchema,
  donorUpdateBody,
  formField,
  settingsBody,
  settingsFormSchema,
  type CampaignFormValues,
  type DonorFormValues,
  type SettingsFormValues,
} from './donation-forms.ts'

const NO_SORT: readonly string[] = []
const STATUS_OPTIONS = DONATION_CAMPAIGN_STATUSES.map((value) => ({
  value,
  label: DONATION_CAMPAIGN_STATUS_LABELS[value],
}))
const isStatus = (value: unknown): value is DonationCampaignStatus =>
  (DONATION_CAMPAIGN_STATUSES as readonly unknown[]).includes(value)
const STATUS_TONE = { draft: 'gray', open: 'green', closed: 'purple' } as const
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

type CampaignRow = { id: string; campaign: DonationCampaign }

/**
 * Bağışlar (`?gorunum=bagis`; DOM-FIN-097, ON-258): kampanya listesi ve ilerleme, bağışçılar ve
 * makbuz ayarı. Kampanya ayrıntısı `?bagis-kampanyasi=` sağ panelindedir (bağış kaydı, makbuz PDF'i,
 * iptal, CSV). Yalnız yöneticide açılır (K-299); çevrim içi ödeme yoktur.
 */
export function DonationsSection() {
  const list = useListState('bagis-kampanyalari', { urlPrefix: 'bk_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = list.state.filters.status
  const campaigns = useDonationCampaigns({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isStatus(status) ? { status } : {}),
  })
  const panel = useDetailPanel('bagis-kampanyasi')
  const openCampaign = panel.open
  const [dialog, setDialog] = useState<
    { kind: 'campaign'; campaign: DonationCampaign | null } | { kind: 'settings' } | null
  >(null)

  const rows = useMemo(
    () => campaigns.data?.data.map((campaign): CampaignRow => ({ id: campaign.id, campaign })),
    [campaigns.data],
  )
  const columns = useMemo<DataColumn<CampaignRow>[]>(
    () => [
      { key: 'name', label: 'Kampanya', cell: (row) => row.campaign.name },
      {
        key: 'period',
        label: 'Dönem',
        cell: (row) => `${dayText(row.campaign.startsOn)} – ${dayText(row.campaign.endsOn)}`,
      },
      {
        key: 'progress',
        label: 'Toplanan',
        cell: (row) => <CampaignProgress campaign={row.campaign} />,
      },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge
            text={DONATION_CAMPAIGN_STATUS_LABELS[row.campaign.status]}
            tone={STATUS_TONE[row.campaign.status]}
          />
        ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.campaign.name} kampanyasını aç`}
            onClick={() => openCampaign(row.id)}
          >
            Ayrıntı
          </Button>
        ),
      },
    ],
    [openCampaign],
  )
  const filters = useMemo(
    () => [{ key: 'status', label: 'Durum', type: 'select' as const, options: STATUS_OPTIONS }],
    [],
  )

  return (
    <>
      <section
        aria-labelledby="bagis-kampanyalari"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
          <div>
            <h2 id="bagis-kampanyalari" className="text-lg font-semibold">
              Bağış kampanyaları
            </h2>
            <p className="text-sm text-muted-foreground">
              Elle kaydedilen bağışlar, hedefe göre ilerleme ve numaralı bağış makbuzu.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setDialog({ kind: 'settings' })}>
              Makbuz ayarı
            </Button>
            <Button onClick={() => setDialog({ kind: 'campaign', campaign: null })}>
              <Icon name="Plus" size={17} aria-hidden="true" />
              Yeni kampanya
            </Button>
          </div>
        </header>
        <ServerDataTable
          list={list}
          rows={rows}
          total={campaigns.data?.meta.total ?? 0}
          sortable={NO_SORT}
          columns={columns}
          filters={filters}
          mobileColumns={['name', 'progress']}
          caption="Bağış kampanyaları"
          empty="Henüz bağış kampanyası yok."
          emptyFiltered="Bu aramayla eşleşen kampanya yok."
          loading={campaigns.isPending}
          fetching={campaigns.isFetching && !campaigns.isPending}
          error={
            campaigns.error ? (
              <QueryError error={campaigns.error} onRetry={() => void campaigns.refetch()} />
            ) : undefined
          }
        />
      </section>
      <DonorsSection />
      {dialog?.kind === 'campaign' ? (
        <CampaignFormModal
          campaign={dialog.campaign}
          onClose={() => setDialog(null)}
          onSaved={(id) => {
            setDialog(null)
            openCampaign(id)
          }}
        />
      ) : null}
      {dialog?.kind === 'settings' ? <SettingsModal onClose={() => setDialog(null)} /> : null}
      <DonationCampaignPanel
        campaignId={panel.selectedId}
        onClose={panel.close}
        onEdit={(campaign) => setDialog({ kind: 'campaign', campaign })}
      />
    </>
  )
}

const CAMPAIGN_FORM = 'bagis-kampanyasi-formu'
const CAMPAIGN_FIELDS = [
  'name',
  'purpose',
  'target',
  'startsOn',
  'endsOn',
  'bankAccountId',
] as const
const CAMPAIGN_FIELD_OF: Record<string, string> = { targetCents: 'target' }

/** Yeni kampanya ya da düzeltme; düzeltme taslakta ve açıkken (K-296). */
export function CampaignFormModal({
  campaign,
  onClose,
  onSaved,
}: {
  campaign: DonationCampaign | null
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const create = useCreateDonationCampaign()
  const update = useUpdateDonationCampaign()
  const accounts = useBankAccounts()
  const form = useForm<CampaignFormValues>({
    resolver: zodResolver(campaignFormSchema),
    defaultValues: campaign === null ? campaignDefaults(dayKey()) : campaignValues(campaign),
  })
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const onSubmit = form.handleSubmit(async (values) => {
    const fields = {
      setError: (name: string, error: { message: string }) => {
        const field = formField(CAMPAIGN_FIELDS, CAMPAIGN_FIELD_OF[name] ?? name)
        if (field) form.setError(field, error, { shouldFocus: true })
        else form.setError('root.server', error)
      },
    }
    const outcome =
      campaign === null
        ? await create.submit(campaignBody(values), fields)
        : await update.submit(
            { campaignId: campaign.id, version: campaign.version, body: campaignBody(values) },
            fields,
          )
    if (outcome.status === 'success') {
      notify.success(campaign === null ? 'Kampanya taslak olarak açıldı.' : 'Kampanya güncellendi.')
      onSaved(outcome.data.data.id)
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  const title = campaign === null ? 'Yeni bağış kampanyası' : 'Kampanyayı düzelt'
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={title}
      description="Kampanya taslak açılır; bağış kampanya açıldıktan sonra kaydedilir."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={CAMPAIGN_FORM} disabled={busy} aria-busy={busy || undefined}>
            Kaydet
          </Button>
        </>
      }
    >
      {accounts.error ? (
        <QueryError error={accounts.error} onRetry={() => void accounts.refetch()} />
      ) : null}
      <form
        id={CAMPAIGN_FORM}
        noValidate
        aria-label={title}
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField id="bagis-kampanya-ad" label="Kampanya adı" error={errors.name}>
          {(control) => <Input {...control} {...form.register('name')} disabled={busy} />}
        </FormField>
        <FormField id="bagis-kampanya-amac" label="Amaç" error={errors.purpose}>
          {(control) => (
            <Textarea {...control} {...form.register('purpose')} rows={2} disabled={busy} />
          )}
        </FormField>
        <FormField id="bagis-kampanya-hedef" label="Hedef tutar (₺)" error={errors.target}>
          {(control) => (
            <Input {...control} {...form.register('target')} inputMode="decimal" disabled={busy} />
          )}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="bagis-kampanya-baslangic" label="Başlangıç" error={errors.startsOn}>
            {(control) => (
              <Input {...control} {...form.register('startsOn')} type="date" disabled={busy} />
            )}
          </FormField>
          <FormField id="bagis-kampanya-bitis" label="Bitiş" error={errors.endsOn}>
            {(control) => (
              <Input {...control} {...form.register('endsOn')} type="date" disabled={busy} />
            )}
          </FormField>
        </div>
        <FormField
          id="bagis-kampanya-hesap"
          label="Banka hesabı (isteğe bağlı)"
          description="Havale bağışında hesap seçilmezse bu hesap yazılır."
          error={errors.bankAccountId}
        >
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('bankAccountId')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="">Hesap yok</NativeSelectOption>
              {(accounts.data?.data ?? []).map((account) => (
                <NativeSelectOption key={account.id} value={account.id}>
                  {bankAccountLabel(account)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <RootError message={errors.root?.server?.message} />
      </form>
    </Modal>
  )
}

type DonorRow = { id: string; donor: Donor }

/** Bağışçılar: kimlik numarası maskeli; iletişim yalnız yöneticide (K-298). */
function DonorsSection() {
  const list = useListState('bagiscilar', { urlPrefix: 'bc_' })
  const search = useDebouncedValue(list.state.query).trim()
  const donors = useDonors({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 2 ? { q: search } : {}),
  })
  const [editing, setEditing] = useState<{ donor: Donor | null } | null>(null)
  const rows = useMemo(
    () => donors.data?.data.map((donor): DonorRow => ({ id: donor.id, donor })),
    [donors.data],
  )
  const columns = useMemo<DataColumn<DonorRow>[]>(
    () => [
      { key: 'name', label: 'Bağışçı', cell: (row) => row.donor.name },
      { key: 'kind', label: 'Tür', cell: (row) => DONOR_KIND_LABELS[row.donor.kind] },
      {
        key: 'identity',
        label: 'Kimlik no',
        cell: (row) => row.donor.maskedIdentityNumber ?? '—',
      },
      {
        key: 'contact',
        label: 'İletişim',
        cell: (row) =>
          [row.donor.phone, row.donor.email].filter((part) => part !== null).join(' · ') || '—',
      },
      {
        key: 'link',
        label: 'Bağ',
        cell: (row) =>
          row.donor.link === null
            ? '—'
            : `${DONOR_RELATION_LABELS[row.donor.link.relation]} · ${row.donor.link.studentName ?? 'Öğrenci'}`,
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.donor.name} bağışçısını düzelt`}
            onClick={() => setEditing({ donor: row.donor })}
          >
            Düzelt
          </Button>
        ),
      },
    ],
    [],
  )
  return (
    <section
      aria-labelledby="bagiscilar"
      className="panel mt-6 overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div>
          <h2 id="bagiscilar" className="text-lg font-semibold">
            Bağışçılar
          </h2>
          <p className="text-sm text-muted-foreground">
            Kimlik numarası listede son dört hanesiyle görünür; tam numara yalnız makbuzda.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setEditing({ donor: null })}>
          <Icon name="Plus" size={17} aria-hidden="true" />
          Yeni bağışçı
        </Button>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={donors.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={['name', 'identity']}
        caption="Bağışçılar"
        empty="Henüz bağışçı yok."
        emptyFiltered="Bu aramayla eşleşen bağışçı yok."
        loading={donors.isPending}
        fetching={donors.isFetching && !donors.isPending}
        error={
          donors.error ? (
            <QueryError error={donors.error} onRetry={() => void donors.refetch()} />
          ) : undefined
        }
      />
      {editing ? <DonorFormModal donor={editing.donor} onClose={() => setEditing(null)} /> : null}
    </section>
  )
}

const DONOR_FORM = 'bagisci-formu'
const DONOR_FIELDS = [
  'kind',
  'name',
  'identityNumber',
  'phone',
  'email',
  'address',
  'studentId',
  'relation',
] as const

function DonorFormModal({ donor, onClose }: { donor: Donor | null; onClose: () => void }) {
  const create = useCreateDonor()
  const update = useUpdateDonor()
  const students = useCoreAll('students')
  const form = useForm<DonorFormValues>({
    resolver: zodResolver(donorFormSchema),
    defaultValues:
      donor === null
        ? donorDefaults()
        : {
            ...donorDefaults(),
            kind: donor.kind,
            name: donor.name,
            phone: donor.phone ?? '',
            email: donor.email ?? '',
            address: donor.address ?? '',
            studentId: donor.link?.studentId ?? '',
            relation: donor.link?.relation ?? '',
          },
  })
  const kind = useWatch({ control: form.control, name: 'kind' })
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const onSubmit = form.handleSubmit(async (values) => {
    const fields = {
      setError: (name: string, error: { message: string }) => {
        const field = formField(DONOR_FIELDS, name.replace(/^link\./, ''))
        if (field) form.setError(field, error, { shouldFocus: true })
        else form.setError('root.server', error)
      },
    }
    const outcome =
      donor === null
        ? await create.submit(donorBody(values), fields)
        : await update.submit(
            { donorId: donor.id, version: donor.version, body: donorUpdateBody(values) },
            fields,
          )
    if (outcome.status === 'success') {
      notify.success(donor === null ? 'Bağışçı kaydedildi.' : 'Bağışçı güncellendi.')
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  const title = donor === null ? 'Yeni bağışçı' : 'Bağışçıyı düzelt'
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={title}
      description="Kimlik numarası, iletişim ve öğrenci bağı isteğe bağlıdır; bağışçı verisini yalnız yönetici görür."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={DONOR_FORM} disabled={busy} aria-busy={busy || undefined}>
            Kaydet
          </Button>
        </>
      }
    >
      <form
        id={DONOR_FORM}
        noValidate
        aria-label={title}
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField id="bagisci-tur" label="Bağışçı türü" error={errors.kind}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('kind')}
              className="w-full"
              disabled={busy || donor !== null}
            >
              {DONOR_KINDS.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {DONOR_KIND_LABELS[value]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField
          id="bagisci-ad"
          label={kind === 'person' ? 'Ad soyad' : 'Kurum unvanı'}
          error={errors.name}
        >
          {(control) => <Input {...control} {...form.register('name')} disabled={busy} />}
        </FormField>
        <FormField
          id="bagisci-kimlik"
          label={kind === 'person' ? 'T.C. kimlik no (isteğe bağlı)' : 'VKN (isteğe bağlı)'}
          {...(donor?.maskedIdentityNumber
            ? { description: `Kayıtlı: ${donor.maskedIdentityNumber}. Boş bırakırsanız değişmez.` }
            : {})}
          error={errors.identityNumber}
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('identityNumber')}
              inputMode="numeric"
              autoComplete="off"
              disabled={busy}
            />
          )}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="bagisci-telefon" label="Telefon (isteğe bağlı)" error={errors.phone}>
            {(control) => (
              <Input {...control} {...form.register('phone')} inputMode="tel" disabled={busy} />
            )}
          </FormField>
          <FormField id="bagisci-eposta" label="E-posta (isteğe bağlı)" error={errors.email}>
            {(control) => (
              <Input {...control} {...form.register('email')} type="email" disabled={busy} />
            )}
          </FormField>
        </div>
        <FormField id="bagisci-adres" label="Adres (isteğe bağlı)" error={errors.address}>
          {(control) => (
            <Textarea {...control} {...form.register('address')} rows={2} disabled={busy} />
          )}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="bagisci-ogrenci"
            label="Bağlı öğrenci (isteğe bağlı)"
            error={errors.studentId}
          >
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('studentId')}
                className="w-full"
                disabled={busy}
              >
                <NativeSelectOption value="">Bağ yok</NativeSelectOption>
                {(students.data ?? []).map((item) => (
                  <NativeSelectOption key={item.id} value={item.id}>
                    {item.record.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField id="bagisci-bag" label="Bağ türü" error={errors.relation}>
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('relation')}
                className="w-full"
                disabled={busy}
              >
                <NativeSelectOption value="">Seçin</NativeSelectOption>
                {DONOR_RELATIONS.map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {DONOR_RELATION_LABELS[value]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        </div>
        <RootError message={errors.root?.server?.message} />
      </form>
    </Modal>
  )
}

const SETTINGS_FORM = 'bagis-ayar-formu'

/** Vergi indirimi ibaresi (K-299); yalnız bundan sonra kesilen makbuzları etkiler. */
function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useDonationSettings()
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Makbuz ayarı"
      description="Vergi indirimi ibaresi yalnız kurumunuz bu kapsamdaysa açılmalıdır; metni mali müşavirinizle doğrulayın."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" form={SETTINGS_FORM} disabled={!settings.data}>
            Kaydet
          </Button>
        </>
      }
    >
      {settings.error ? (
        <QueryError error={settings.error} onRetry={() => void settings.refetch()} />
      ) : settings.data ? (
        <SettingsForm settings={settings.data.data} onClose={onClose} />
      ) : null}
    </Modal>
  )
}

function SettingsForm({ settings, onClose }: { settings: DonationSettings; onClose: () => void }) {
  const save = useSetDonationSettings()
  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: {
      taxNoticeEnabled: settings.taxNoticeEnabled,
      taxNoticeText: settings.taxNoticeText ?? '',
    },
  })
  const enabled = useWatch({ control: form.control, name: 'taxNoticeEnabled' })
  const busy = save.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await save.submit(
      { version: settings.version, body: settingsBody(values) },
      {
        setError: (name, error) =>
          name === 'taxNoticeText'
            ? form.setError('taxNoticeText', error, { shouldFocus: true })
            : form.setError('root.server', error),
      },
    )
    if (outcome.status === 'success') {
      notify.success('Makbuz ayarı kaydedildi.')
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  return (
    <form
      id={SETTINGS_FORM}
      noValidate
      aria-label="Makbuz ayarı"
      onSubmit={(event) => void onSubmit(event)}
      className="grid gap-4"
    >
      <div className="flex min-h-11 items-center gap-2">
        <Checkbox
          id="bagis-vergi-ibaresi"
          checked={enabled}
          disabled={busy}
          onCheckedChange={(checked) =>
            form.setValue('taxNoticeEnabled', checked === true, { shouldDirty: true })
          }
        />
        <Label htmlFor="bagis-vergi-ibaresi">Makbuza vergi indirimi ibaresi yaz</Label>
      </div>
      <FormField
        id="bagis-vergi-metni"
        label="İbare metni"
        description="Anonim olmayan bağışların makbuzuna, kayıt anında kopyalanır."
        error={form.formState.errors.taxNoticeText}
      >
        {(control) => (
          <Textarea
            {...control}
            {...form.register('taxNoticeText')}
            rows={3}
            readOnly={!enabled}
            disabled={busy}
          />
        )}
      </FormField>
      <RootError message={form.formState.errors.root?.server?.message} />
    </form>
  )
}
