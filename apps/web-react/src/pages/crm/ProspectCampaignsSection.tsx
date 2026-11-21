import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import {
  useArchiveCampaign,
  useCampaigns,
  useCreateCampaign,
  useUpdateCampaign,
  type CampaignRow,
} from '@kampus/react-shared/use-prospect-campaigns.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import {
  CAMPAIGN_CHANNEL_LABELS,
  CAMPAIGN_CHANNELS,
  type CampaignChannel,
} from '@kampus/school-core/lib/prospect-campaigns.ts'
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
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import {
  CAMPAIGN_STATUS_TONES,
  campaignDefaults,
  campaignFormField,
  campaignFormSchema,
  campaignListRow,
  createCampaignBody,
  newCampaignFormSchema,
  updateCampaignBody,
  type CampaignFormValues,
  type CampaignListRow,
} from './prospect-campaign-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['code', 'status']
const FILTERS = [
  {
    key: 'status',
    label: 'Durum',
    type: 'select' as const,
    options: [
      { value: 'usable', label: 'Geçerli (bugün kullanılabilir)' },
      { value: 'active', label: 'Etkin' },
      { value: 'inactive', label: 'Pasif' },
    ],
  },
  {
    key: 'channel',
    label: 'Kanal',
    type: 'select' as const,
    options: CAMPAIGN_CHANNELS.map((value) => ({ value, label: CAMPAIGN_CHANNEL_LABELS[value] })),
  },
]
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const isStatus = (value: string | null): value is 'usable' | 'active' | 'inactive' =>
  value === 'usable' || value === 'active' || value === 'inactive'
const isChannel = (value: string | null): value is CampaignChannel =>
  CAMPAIGN_CHANNELS.some((channel) => channel === value)

/**
 * Kampanya kodları (DOM-KAY-041; ON-134): yönetici ve ön büro kampanyayı ekler, düzeltir,
 * pasifleştirir ve arşivler. Kod eklemede verilir, sonradan değişmez (K-288). Aday formuna kod
 * girildiğinde ya da adres `?kampanya=KOD` taşıdığında aday kampanyaya bağlanır. `search: false`
 * tablo aramasını kapatır: Kayıt Raporları'nda sayfanın tek "Tabloda ara" alanı kanal tablosudur.
 */
export function ProspectCampaignsSection({ search: searchable = true }: { search?: boolean }) {
  const list = useListState('kampanyalar', { urlPrefix: 'kampanya_' })
  const search = useDebouncedValue(list.state.query).trim()
  const status = text(list.state.filters.status)
  const channel = text(list.state.filters.channel)
  const campaigns = useCampaigns({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.length >= 1 ? { q: search } : {}),
    ...(isStatus(status) ? { status } : {}),
    ...(isChannel(channel) ? { channel } : {}),
  })
  const [editing, setEditing] = useState<CampaignRow | 'new' | null>(null)
  const [archiving, setArchiving] = useState<CampaignRow | null>(null)
  const byId = useMemo(
    () => new Map((campaigns.data?.data ?? []).map((item) => [item.id, item])),
    [campaigns.data],
  )
  const rows = useMemo(() => campaigns.data?.data.map(campaignListRow), [campaigns.data])
  const columns = useMemo<DataColumn<CampaignListRow>[]>(
    () => [
      { key: 'code', label: 'Kod', cell: (row) => <span className="font-mono">{row.code}</span> },
      { key: 'name', label: 'Kampanya' },
      { key: 'channel', label: 'Kanal' },
      { key: 'period', label: 'Geçerlilik' },
      { key: 'cost', label: 'Maliyet' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge text={row.statusLabel} tone={CAMPAIGN_STATUS_TONES[row.status]} />
        ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => {
          const campaign = byId.get(row.id)
          if (!campaign) return null
          return (
            <span className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                aria-label={`${row.code} kampanyasını düzenle`}
                onClick={() => setEditing(campaign)}
              >
                Düzenle
              </Button>
              <Button
                size="sm"
                variant="outline"
                aria-label={`${row.code} kampanyasını arşivle`}
                onClick={() => setArchiving(campaign)}
              >
                Arşivle
              </Button>
            </span>
          )
        },
      },
    ],
    [byId],
  )

  return (
    <section
      aria-labelledby="kampanya-kodlari"
      className="panel mb-6 overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div>
          <h2 id="kampanya-kodlari" className="text-lg font-semibold">
            Kampanya kodları
          </h2>
          <p className="text-sm text-muted-foreground">
            Aday formunda kod girilen aday kampanyaya bağlanır; bağlantı adresi
            <span className="font-mono"> ?kampanya=KOD </span>
            formu kodla açar.
          </p>
        </div>
        <Button onClick={() => setEditing('new')}>
          <Icon name="Plus" size={17} aria-hidden="true" />
          Yeni kampanya
        </Button>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={campaigns.data?.meta.total ?? 0}
        sortable={NO_SORT}
        search={searchable}
        columns={columns}
        filters={FILTERS}
        mobileColumns={MOBILE}
        caption="Kampanya kodları"
        empty="Henüz kampanya kodu yok."
        emptyFiltered="Bu seçimle eşleşen kampanya yok."
        loading={campaigns.isPending}
        fetching={campaigns.isFetching && !campaigns.isPending}
        error={
          campaigns.error ? (
            <QueryError error={campaigns.error} onRetry={() => void campaigns.refetch()} />
          ) : undefined
        }
      />
      {editing !== null ? (
        <CampaignFormModal
          {...(editing === 'new' ? {} : { campaign: editing })}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {archiving ? (
        <ArchiveCampaignModal campaign={archiving} onClose={() => setArchiving(null)} />
      ) : null}
    </section>
  )
}

const FORM_ID = 'kampanya-formu'

function CampaignFormModal({ campaign, onClose }: { campaign?: CampaignRow; onClose: () => void }) {
  const create = useCreateCampaign()
  const update = useUpdateCampaign()
  const [today] = useState(() => dayKey(new Date()))
  const form = useForm<CampaignFormValues>({
    resolver: zodResolver(campaign ? campaignFormSchema : newCampaignFormSchema),
    defaultValues: campaignDefaults(campaign, today),
  })
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const fields = {
    setError: (name: string, error: { type: string; message: string }) => {
      const field = campaignFormField(name)
      if (field) form.setError(field, error, { shouldFocus: true })
      else form.setError('root.server', error)
    },
  }
  const onSubmit = form.handleSubmit(async (values) => {
    if (campaign) {
      const body = updateCampaignBody(values, campaign)
      if (Object.keys(body).length === 0) {
        onClose()
        return
      }
      const outcome = await update.submit(
        { campaignId: campaign.id, version: campaign.version, body },
        fields,
      )
      if (outcome.status === 'success') {
        notify.success(`${campaign.code} güncellendi.`)
        onClose()
      } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
      return
    }
    const outcome = await create.submit(createCampaignBody(values), fields)
    if (outcome.status === 'success') {
      notify.success(`${outcome.data.data.code} kampanyası eklendi.`)
      onClose()
    }
  })
  const title = campaign ? 'Kampanyayı düzenle' : 'Yeni kampanya'
  return (
    <Modal
      open
      size="wide"
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={title}
      description="Kod sonradan değişmez; ad, kanal, günler, maliyet ve etkinlik düzeltilebilir."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={FORM_ID} disabled={busy} aria-busy={busy || undefined}>
            Kaydet
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        noValidate
        aria-label={title}
        onSubmit={(event) => void onSubmit(event)}
        className="grid grid-cols-2 gap-4 max-[650px]:grid-cols-1"
      >
        <FormField
          id="kampanya-kod"
          label="Kampanya kodu"
          description="İngilizce büyük harf, rakam ve tire; 3–20 karakter."
          error={errors.code}
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('code')}
              maxLength={20}
              autoCapitalize="characters"
              readOnly={Boolean(campaign)}
              disabled={busy}
              className="font-mono uppercase"
            />
          )}
        </FormField>
        <FormField id="kampanya-ad" label="Kampanya adı" error={errors.name}>
          {(control) => (
            <Input {...control} {...form.register('name')} maxLength={120} disabled={busy} />
          )}
        </FormField>
        <FormField id="kampanya-kanal" label="Kanal" error={errors.channel}>
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('channel')}
              className="w-full"
              disabled={busy}
            >
              {CAMPAIGN_CHANNELS.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {CAMPAIGN_CHANNEL_LABELS[value]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField
          id="kampanya-maliyet"
          label="Toplam maliyet (₺, isteğe bağlı)"
          description="Aday başı ve kayıt başı maliyet bu tutardan hesaplanır."
          error={errors.cost}
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('cost')}
              inputMode="decimal"
              placeholder="Örn. 12.500,00"
              disabled={busy}
            />
          )}
        </FormField>
        <FormField id="kampanya-baslangic" label="Başlangıç günü" error={errors.startDate}>
          {(control) => (
            <Input {...control} {...form.register('startDate')} type="date" disabled={busy} />
          )}
        </FormField>
        <FormField id="kampanya-bitis" label="Bitiş günü" error={errors.endDate}>
          {(control) => (
            <Input {...control} {...form.register('endDate')} type="date" disabled={busy} />
          )}
        </FormField>
        <Controller
          name="isActive"
          control={form.control}
          render={({ field }) => (
            <div className="flex min-h-11 items-center gap-2.5">
              <Checkbox
                id="kampanya-etkin"
                checked={field.value}
                onCheckedChange={(value) => field.onChange(value === true)}
                disabled={busy}
              />
              <Label htmlFor="kampanya-etkin" className="font-normal">
                Etkin (pasif kampanyanın kodu yeni adaya bağlanmaz)
              </Label>
            </div>
          )}
        />
        <div className="col-span-full">
          <RootError message={errors.root?.server?.message} />
        </div>
      </form>
    </Modal>
  )
}

function ArchiveCampaignModal({
  campaign,
  onClose,
}: {
  campaign: CampaignRow
  onClose: () => void
}) {
  const archive = useArchiveCampaign()
  async function confirm() {
    const outcome = await archive.submit({ campaignId: campaign.id, version: campaign.version })
    if (outcome.status === 'busy') return
    if (outcome.status === 'success') notify.success(`${campaign.code} arşivlendi.`)
    onClose()
  }
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Kampanyayı arşivle"
      description={`${campaign.code} kodu yeni adaya bağlanamaz ve yeniden kullanılamaz; bağlı adaylar kayıt hunisi raporunda kalır.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={archive.isPending}>
            Vazgeç
          </Button>
          <Button
            variant="destructive"
            disabled={archive.isPending}
            aria-busy={archive.isPending || undefined}
            onClick={() => void confirm()}
          >
            Arşivle
          </Button>
        </>
      }
    >
      <p className="text-sm">Bu işlem geri alınmaz.</p>
    </Modal>
  )
}
