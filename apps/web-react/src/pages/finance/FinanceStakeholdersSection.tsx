import { useMemo, useState } from 'react'
import {
  useStakeholderAgreements,
  useStakeholderAgreementsExport,
  useStakeholders,
  useStakeholdersExport,
  type AgreementQuery,
  type StakeholderQuery,
} from '@kampus/react-shared/use-finance-stakeholders.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import {
  AGREEMENT_VIEW_STATUSES,
  STAKEHOLDER_TYPE_LABELS,
  STAKEHOLDER_TYPES,
  type AgreementViewStatus,
  type StakeholderType,
} from '@kampus/school-core/lib/finance-stakeholders.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { saveBlob } from '@/lib/download.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { StakeholderFormModal } from './FinanceStakeholderForms.tsx'
import { AgreementDetailView, StakeholderDetailView } from './FinanceStakeholderPanels.tsx'
import {
  AGREEMENT_STATUS_VIEW,
  contributionText,
  remainingText,
} from './finance-stakeholder-forms.ts'

export const STAKEHOLDER_PANEL = 'paydas'
export const AGREEMENT_PANEL = 'anlasma'
const NO_SORT: readonly string[] = []
const BOM = '\uFEFF'
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const isType = (value: string | null): value is StakeholderType =>
  STAKEHOLDER_TYPES.some((type) => type === value)
const isStatus = (value: string | null): value is AgreementViewStatus =>
  AGREEMENT_VIEW_STATUSES.some((status) => status === value)
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const ENDING_OPTIONS = [
  { value: 'renewal', label: 'Yenileme uyarısındakiler' },
  { value: '30', label: '30 gün içinde bitenler' },
  { value: '60', label: '60 gün içinde bitenler' },
  { value: '90', label: '90 gün içinde bitenler' },
]
const STAKEHOLDER_FILTERS = [
  {
    key: 'type',
    label: 'Tür',
    type: 'select' as const,
    options: STAKEHOLDER_TYPES.map((value) => ({ value, label: STAKEHOLDER_TYPE_LABELS[value] })),
  },
  {
    key: 'status',
    label: 'Durum',
    type: 'select' as const,
    options: [
      { value: 'active', label: 'Etkin' },
      { value: 'inactive', label: 'Pasif' },
    ],
  },
  {
    key: 'renewal',
    label: 'Yenileme',
    type: 'select' as const,
    options: [{ value: 'true', label: 'Yenilemesi yaklaşanlar' }],
  },
]
const AGREEMENT_FILTERS = [
  {
    key: 'ending',
    label: 'Bitiş',
    type: 'select' as const,
    options: ENDING_OPTIONS,
  },
  {
    key: 'status',
    label: 'Durum',
    type: 'select' as const,
    options: AGREEMENT_VIEW_STATUSES.map((value) => ({
      value,
      label: AGREEMENT_STATUS_VIEW[value].label,
    })),
  },
]
const AGREEMENT_URL_FILTERS = { ending: 'bitis', status: 'durum' } as const

/** Bitiş süzgecinin sorgu karşılığı: bildirim penceresi ya da N gün içinde bitenler (K-319). */
function endingQuery(value: string | null): Partial<AgreementQuery> {
  if (value === 'renewal') return { renewalDue: 'true' }
  const days = Number(value)
  return Number.isInteger(days) && days > 0 ? { expiringWithinDays: days } : {}
}

async function downloadCsv(
  submit: () => Promise<{ status: string; data?: unknown }>,
  filename: string,
) {
  const outcome = await submit()
  if (outcome.status !== 'success') return
  // Yanıt çözülürken BOM düşer; Excel Türkçe karakterleri onunla tanır.
  const csv = String(outcome.data).replace(BOM, '')
  saveBlob(new Blob([BOM, csv], { type: 'text/csv;charset=utf-8' }), filename)
  notify.success('Dosya indirildi.')
}

type StakeholderRowView = {
  id: string
  name: string
  isActive: boolean
  type: string
  taxNumber: string
  contact: string
  tags: string
  agreements: { active: number; renewal: number }
}

type AgreementRowView = {
  id: string
  stakeholder: string
  subject: string
  period: string
  contribution: string
  status: AgreementViewStatus
  remaining: string
  renewalDue: boolean
}

/**
 * Paydaşlar ve sponsorlar (`?gorunum=paydas`; DOM-FIN-102, ON-262). Yalnız yönetici (K-317).
 * Üstte paydaş listesi (ad, VKN ve iletişim kişisinde arama; tür, durum, yenileme süzgeci; satırda
 * yürürlükteki ve yenilemesi yaklaşan anlaşma sayısı), altta anlaşma listesi (bitişi yaklaşanlar,
 * durum; K-318, K-319). İletişim e-postası ve telefonu listede maskeli, tam değer `?paydas=`
 * panelindedir. Anlaşma `?anlasma=` panelinde açılır. İki listenin de CSV'si ekrandaki süzgeçle
 * iner. Arka plan bildirimi yoktur; uyarı listede ve Genel Bakış kartındadır.
 */
export function FinanceStakeholdersSection() {
  const stakeholderPanel = useDetailPanel(STAKEHOLDER_PANEL)
  const agreementPanel = useDetailPanel(AGREEMENT_PANEL)
  return (
    <div className="grid gap-6">
      <StakeholderList onOpen={stakeholderPanel.open} />
      <AgreementList onOpen={agreementPanel.open} />
      <SidePanel
        open={stakeholderPanel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : stakeholderPanel.close())}
        title="Paydaş"
      >
        {stakeholderPanel.selectedId ? (
          <StakeholderDetailView
            stakeholderId={stakeholderPanel.selectedId}
            onOpenAgreement={agreementPanel.open}
          />
        ) : null}
      </SidePanel>
      <SidePanel
        open={agreementPanel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : agreementPanel.close())}
        title="Anlaşma"
      >
        {agreementPanel.selectedId ? (
          <AgreementDetailView
            agreementId={agreementPanel.selectedId}
            onArchived={agreementPanel.close}
          />
        ) : null}
      </SidePanel>
    </div>
  )
}

function StakeholderList({ onOpen }: { onOpen: (id: string) => void }) {
  const list = useListState('paydaslar', { urlPrefix: 'paydas_' })
  const search = useDebouncedValue(list.state.query).trim()
  const type = text(list.state.filters.type)
  const status = text(list.state.filters.status)
  const renewal = text(list.state.filters.renewal)
  const filter: Omit<StakeholderQuery, 'page' | 'pageSize'> = {
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isType(type) ? { type } : {}),
    ...(status === 'active' || status === 'inactive' ? { status } : {}),
    ...(renewal === 'true' ? { renewalDue: 'true' as const } : {}),
  }
  const stakeholders = useStakeholders({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...filter,
  })
  const exporter = useStakeholdersExport()
  const [creating, setCreating] = useState(false)

  const rows = useMemo(
    () =>
      stakeholders.data?.data.map((item): StakeholderRowView => ({
        id: item.id,
        name: item.name,
        isActive: item.isActive,
        type: STAKEHOLDER_TYPE_LABELS[item.type],
        taxNumber: item.taxNumber ?? '—',
        contact:
          [item.contactName, item.contactPhone, item.contactEmail].filter(Boolean).join(' · ') ||
          '—',
        tags: item.tags.join(', ') || '—',
        agreements: { active: item.activeAgreementCount, renewal: item.renewalDueCount },
      })),
    [stakeholders.data],
  )
  const columns = useMemo<DataColumn<StakeholderRowView>[]>(
    () => [
      {
        key: 'name',
        label: 'Paydaş',
        cell: (row) => (
          <span className="flex flex-wrap items-center gap-2">
            {row.name}
            {row.isActive ? null : <StatusBadge text="Pasif" tone="gray" />}
          </span>
        ),
      },
      { key: 'type', label: 'Tür' },
      { key: 'taxNumber', label: 'VKN' },
      { key: 'contact', label: 'İletişim' },
      { key: 'tags', label: 'Etiketler' },
      {
        key: 'agreements',
        label: 'Anlaşmalar',
        cell: (row) => (
          <span className="flex flex-wrap items-center gap-2">
            {`${String(row.agreements.active)} yürürlükte`}
            {row.agreements.renewal > 0 ? (
              <StatusBadge
                text={`${String(row.agreements.renewal)} yenileme yaklaşıyor`}
                tone="amber"
              />
            ) : null}
          </span>
        ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.name} ayrıntısını aç`}
            onClick={() => onOpen(row.id)}
          >
            Ayrıntı
          </Button>
        ),
      },
    ],
    [onOpen],
  )

  return (
    <section
      aria-labelledby="paydaslar"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div>
          <h2 id="paydaslar" className="text-lg font-semibold">
            Paydaşlar ve sponsorlar
          </h2>
          <p className="text-sm text-muted-foreground">
            Sponsorlar, iş birliği kurumları, üniversiteler, belediye ve STK'lar ile veli derneği;
            iletişim bilgisi listede maskelidir.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => void downloadCsv(() => exporter.submit(filter), 'paydaslar.csv')}
            disabled={exporter.isPending}
            aria-busy={exporter.isPending || undefined}
          >
            <Icon name="Download" size={17} aria-hidden="true" />
            CSV indir
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Icon name="Plus" size={17} aria-hidden="true" />
            Yeni paydaş
          </Button>
        </div>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={stakeholders.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={STAKEHOLDER_FILTERS}
        mobileColumns={['name', 'agreements']}
        caption="Paydaşlar ve sponsorlar"
        empty="Henüz paydaş yok."
        emptyFiltered="Bu seçimle eşleşen paydaş yok."
        loading={stakeholders.isPending}
        fetching={stakeholders.isFetching && !stakeholders.isPending}
        error={
          stakeholders.error ? (
            <QueryError error={stakeholders.error} onRetry={() => void stakeholders.refetch()} />
          ) : undefined
        }
      />
      {creating ? (
        <StakeholderFormModal
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false)
            onOpen(id)
          }}
        />
      ) : null}
    </section>
  )
}

function AgreementList({ onOpen }: { onOpen: (id: string) => void }) {
  const list = useListState('paydas-anlasmalari', {
    urlPrefix: 'anlasma_',
    urlFilters: AGREEMENT_URL_FILTERS,
  })
  const search = useDebouncedValue(list.state.query).trim()
  const status = text(list.state.filters.status)
  const filter: Omit<AgreementQuery, 'page' | 'pageSize'> = {
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isStatus(status) ? { status } : {}),
    ...endingQuery(text(list.state.filters.ending)),
  }
  const agreements = useStakeholderAgreements({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...filter,
  })
  const exporter = useStakeholderAgreementsExport()

  const rows = useMemo(
    () =>
      agreements.data?.data.map((item): AgreementRowView => ({
        id: item.id,
        stakeholder: item.stakeholder.name,
        subject: item.subject,
        period: `${dayText(item.startDate)} – ${dayText(item.endDate)}`,
        contribution: contributionText(item),
        status: item.status,
        remaining: remainingText(item),
        renewalDue: item.renewalDue,
      })),
    [agreements.data],
  )
  const columns = useMemo<DataColumn<AgreementRowView>[]>(
    () => [
      { key: 'subject', label: 'Konu' },
      { key: 'stakeholder', label: 'Paydaş' },
      { key: 'period', label: 'Dönem' },
      { key: 'contribution', label: 'Katkı' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge
              text={AGREEMENT_STATUS_VIEW[row.status].label}
              tone={AGREEMENT_STATUS_VIEW[row.status].tone}
            />
            {row.renewalDue ? <StatusBadge text="Yenileme yaklaşıyor" tone="amber" /> : null}
            {row.remaining ? (
              <span className="text-sm text-muted-foreground">{row.remaining}</span>
            ) : null}
          </span>
        ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${row.subject} anlaşmasını aç`}
            onClick={() => onOpen(row.id)}
          >
            Ayrıntı
          </Button>
        ),
      },
    ],
    [onOpen],
  )

  return (
    <section
      aria-labelledby="paydas-anlasmalari"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div>
          <h2 id="paydas-anlasmalari" className="text-lg font-semibold">
            İş birliği ve sponsorluk anlaşmaları
          </h2>
          <p className="text-sm text-muted-foreground">
            Bitişi yaklaşan anlaşmalar "Bitiş" süzgeciyle listelenir; yenileme bildirim gününe giren
            anlaşma uyarı rozeti taşır.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => void downloadCsv(() => exporter.submit(filter), 'paydas-anlasmalari.csv')}
          disabled={exporter.isPending}
          aria-busy={exporter.isPending || undefined}
        >
          <Icon name="Download" size={17} aria-hidden="true" />
          CSV indir
        </Button>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={agreements.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={AGREEMENT_FILTERS}
        mobileColumns={['subject', 'status']}
        caption="İş birliği ve sponsorluk anlaşmaları"
        empty="Henüz anlaşma yok; paydaşın ayrıntısından anlaşma açın."
        emptyFiltered="Bu seçimle eşleşen anlaşma yok."
        loading={agreements.isPending}
        fetching={agreements.isFetching && !agreements.isPending}
        error={
          agreements.error ? (
            <QueryError error={agreements.error} onRetry={() => void agreements.refetch()} />
          ) : undefined
        }
      />
    </section>
  )
}
