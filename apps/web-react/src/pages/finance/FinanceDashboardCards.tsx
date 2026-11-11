// Genel Bakış finans kartları (yönetici, ön büro, veli bakiyesi; IST-116). Kayıt yuvası
// `dashboard/dashboard-cards.tsx` Onur bloğudur; kural docs/sayfalar/platform.md "Pano kartı ekleme".
// Sayaç ve listeler tek özet isteğinden (`ctx.data.finance`) gelir, seçili kampüse daralır.
// "Gecikmiş tutar" kendi ucunu (`/finance/overview`) okur: kısmi ödemeyi düşer, Finans ekranının
// aynı adlı toplamıyla (`/finance/totals`) eşittir.
import { Link, useSearchParams } from 'react-router'
import { dateLabel, dayKey, money, number } from '@kampus/school-core/lib/format.ts'
import type { DashboardOf } from '@kampus/react-shared/dashboard.ts'
import { useFinanceOverview } from '@kampus/react-shared/use-finance-exports.ts'
import { useChemicalLots } from '@kampus/react-shared/use-finance-chemicals.ts'
import { useCriticalStockItems } from '@kampus/react-shared/use-finance-inventory.ts'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { useCoreAll, useCoreList } from '@/hooks/use-core-collection.ts'
import { useEnrollmentLearner } from '@/hooks/use-enrollment-learner.ts'
import { CollectionTrend } from '../dashboard/CollectionTrend.tsx'
import {
  CardList,
  combineStates,
  ListCard,
  ShareBar,
  StatCard,
} from '../dashboard/DashboardParts.tsx'
import { StudentName } from '../dashboard/StudentName.tsx'
import { defineCard, type DashboardCardContext } from '../dashboard/dashboard-cards-model.ts'
import { BRANCH_PARAM, sparkLabel } from '../dashboard/dashboard-filter-model.ts'
import {
  dashboardHref,
  invoiceStatusSlices,
  outstandingAmount,
  type InvoiceRow,
} from '../dashboard/dashboard-model.ts'
import {
  collectionRate,
  collectionRateLabel,
  overdueStudentsNote,
  overdueTrendPoints,
  priorityInvoicesQuery,
} from './finance-dashboard-model.ts'
import { EXPIRY_TONE, expiryText, lotText } from './finance-chemical-forms.ts'
import { criticalQuantityText } from './finance-inventory-forms.ts'
import { invoiceClassScope, invoiceRow } from './finance-rows.ts'

const SLICE_TONE = { gecikmis: 'warning', yaklasan: 'primary', odendi: 'success' } as const
const FRONT_DESK_PATH = 'tahsilat-takip'

type SliceKey = 'gecikmis' | 'yaklasan' | 'odendi'

/** Taksit durumu dilimi; veri gelene kadar yok. */
function invoiceSlice(
  invoices: Parameters<typeof invoiceStatusSlices>[0] | undefined,
  key: SliceKey,
) {
  return (invoices ? invoiceStatusSlices(invoices) : []).find((slice) => slice.key === key)
}

/**
 * Kurum geneli gecikmiş tutar: kısmi ödemede yalnız kalan kısım sayılır. Uç kampüs süzgeci almaz;
 * kampüs seçiliyken kurum rakamı seçili kampüsünki sanılmasın diye kart çizilmez ve istek atılmaz.
 * Mini grafik vadesi son altı aya düşen gecikmiş tutardır, daha eski vade toplamda kalır.
 */
function OverdueAmountCard({ ctx }: { ctx: DashboardCardContext<DashboardOf<'yonetici'>> }) {
  const [params] = useSearchParams()
  const branchSelected = params.has(BRANCH_PARAM)
  const query = useFinanceOverview(null, { enabled: !branchSelected })
  const learner = useEnrollmentLearner()
  if (branchSelected) return null
  const overview = query.data?.data
  const points = overdueTrendPoints(overview?.months ?? [])
  return (
    <StatCard
      label="Gecikmiş tutar"
      icon="Timer"
      value={money(overview?.overdueCents ?? 0)}
      note={overdueStudentsNote(overview?.overdueStudents.length ?? 0, learner.noun)}
      href={dashboardHref(ctx.role, 'finans', { durum: 'gecikmis' })}
      state={combineStates(query)}
      spark={{ label: sparkLabel('Vade ayına göre gecikmiş tutar', points, money), points }}
    />
  )
}

const NO_PRIORITY_QUERY = { page: 1, pageSize: 1 } as const
const CRITICAL_STOCK_QUERY = { page: 1, pageSize: 5 } as const

/**
 * Kritik stok (DOM-FIN-079, K-204): kurum toplamı kritik seviyede ya da altındaki en acil beş ürün.
 * Uygulama içi uyarıdır; kritik ürün yoksa (ya da liste gelmeden) kart çizilmez. Kritik seviye kurum
 * toplamına uygulanır (K-200); kampüs seçiliyken kurum listesi seçili kampüsünkü sanılmasın diye
 * kart gizlenir ve istek atılmaz.
 */
function CriticalStockCard({ ctx }: { ctx: DashboardCardContext }) {
  const [params] = useSearchParams()
  const branchSelected = params.has(BRANCH_PARAM)
  const query = useCriticalStockItems(CRITICAL_STOCK_QUERY, !branchSelected)
  const total = query.data?.meta.total ?? 0
  if (branchSelected || (!query.error && total === 0)) return null
  const path = ctx.role === 'onburo' ? FRONT_DESK_PATH : 'finans'
  return (
    <ListCard
      title="Kritik stok"
      description={`${number(total)} ürün kritik seviyede ya da altında`}
      action={{
        label: 'Tümünü gör',
        href: dashboardHref(ctx.role, path, { gorunum: 'stok', stok: 'kritik' }),
      }}
      state={combineStates(query)}
      isEmpty={false}
      emptyText="Kritik seviyede ürün yok."
    >
      <CardList label="Kritik stok">
        {query.data?.data.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0"
          >
            <span className="min-w-0 font-medium">{`${row.code} · ${row.name}`}</span>
            <span className="flex items-center gap-2 text-sm tabular-nums">
              {criticalQuantityText(row)}
              {row.quantity <= 0 ? <StatusBadge text="Tükendi" tone="red" /> : null}
            </span>
          </li>
        ))}
      </CardList>
    </ListCard>
  )
}

const CHEMICAL_EXPIRY_QUERY = { page: 1, pageSize: 5, status: 'attention' } as const

/**
 * Kimyasal son kullanma (DOM-FIN-090, K-243): süresi geçen ya da 30 gün içinde dolan en yakın beş
 * parti. Parti yoksa (ya da liste gelmeden) kart çizilmez; kampüs seçiliyken kurum listesi seçili
 * kampüsünkü sanılmasın diye kart gizlenir ve istek atılmaz.
 */
function ChemicalExpiryCard({ ctx }: { ctx: DashboardCardContext }) {
  const [params] = useSearchParams()
  const branchSelected = params.has(BRANCH_PARAM)
  const query = useChemicalLots(CHEMICAL_EXPIRY_QUERY, !branchSelected)
  const total = query.data?.meta.total ?? 0
  if (branchSelected || (!query.error && total === 0)) return null
  const path = ctx.role === 'onburo' ? FRONT_DESK_PATH : 'finans'
  return (
    <ListCard
      title="Kimyasal son kullanma"
      description={`${number(total)} partinin süresi geçti ya da 30 gün içinde doluyor`}
      action={{
        label: 'Tümünü gör',
        href: dashboardHref(ctx.role, path, { gorunum: 'stok', stok: 'son-kullanma' }),
      }}
      state={combineStates(query)}
      isEmpty={false}
      emptyText="Süresi yaklaşan parti yok."
    >
      <CardList label="Kimyasal son kullanma">
        {query.data?.data.map((row) => (
          <li
            key={row.key}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0"
          >
            <span className="min-w-0">
              <span className="block font-medium">{`${row.code} · ${row.name}`}</span>
              <span className="block text-sm text-muted-foreground">
                {`${lotText(row)} · ${row.warehouseName}`}
              </span>
            </span>
            <span className="flex items-center gap-2 text-sm tabular-nums">
              {expiryText(row)}
              <StatusBadge
                text={row.status === 'expired' ? 'Geçti' : 'Yaklaşıyor'}
                tone={EXPIRY_TONE[row.status]}
              />
            </span>
          </li>
        ))}
      </CardList>
    </ListCard>
  )
}

/**
 * Yönetici "Yaklaşan ödemeler & takip" (Vue `Dashboard.vue` personel tablosu): vadesi en erken
 * dört ödenmemiş taksit; öğrenci, sınıf, vade, tutar ve durum. Pano özetinde satır yoktur; liste
 * taksit koleksiyonundan okunur, seçili kampüs sınıflarına çevrilir. Kampüsün sınıfları tek
 * süzgece sığmıyorsa (`too_many`) kurum rakamı seçili kampüsünkü sanılmasın diye kart çizilmez.
 */
function PriorityInvoicesCard({ ctx }: { ctx: DashboardCardContext<DashboardOf<'yonetici'>> }) {
  const [params] = useSearchParams()
  const branchId = params.get(BRANCH_PARAM) ?? ''
  const classes = useCoreAll('classes', { filters: { branchId } }, { enabled: branchId !== '' })
  const scope = branchId
    ? invoiceClassScope(
        { branchId },
        (classes.data ?? []).map(({ record }) => ({
          id: record.id,
          name: record.name,
          branchId: record.branchId,
        })),
      )
    : ({ kind: 'all' } as const)
  const query = priorityInvoicesQuery(scope)
  const ready = branchId === '' || classes.data !== undefined
  const invoices = useCoreList('invoices', query ?? NO_PRIORITY_QUERY, {
    enabled: ready && query !== null,
  })
  if (ready && query === null) return null
  // Pano özeti henüz gelmediyse bugünün günü kullanılır; boş gün tarih biçimlendirmesini bozar.
  const today = ctx.data?.today ?? dayKey()
  const rows = invoices.data?.rows.map((item) => invoiceRow(item, today))
  return (
    <ListCard
      title="Yaklaşan ödemeler & takip"
      description="Öncelik verilmesi gereken tahsilatlar"
      action={{ label: 'Tümünü gör', href: dashboardHref(ctx.role, 'finans') }}
      state={branchId ? combineStates(classes, invoices) : combineStates(invoices)}
      isEmpty={invoices.data?.total === 0}
      emptyText="Ödenmemiş taksit bulunmuyor."
    >
      <CardList label="Öncelikli tahsilatlar">
        {rows?.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0"
          >
            <StudentName
              name={row.studentName}
              detail={`${row.className} · ${String(row.installment)}. taksit · vade ${dateLabel(row.dueDate, { year: 'numeric' })}`}
            />
            <span className="flex items-center gap-2 text-md font-semibold tabular-nums">
              {money(row.amount)}
              <StatusBadge text={row.status} />
            </span>
          </li>
        ))}
      </CardList>
    </ListCard>
  )
}

export const FINANCE_CARDS = [
  // --- Yönetici ---
  defineCard({
    id: 'yonetici.tahsilat-orani',
    roles: ['yonetici'],
    module: 'finance',
    section: (data) => data.finance,
    area: 'stat',
    order: 35,
    component: ({ ctx }) => {
      const invoices = ctx.data?.finance?.invoices
      const rate = invoices ? collectionRate(invoices) : null
      return (
        <StatCard
          label="Tahsilat oranı"
          icon="ChartNoAxesCombined"
          value={collectionRateLabel(rate)}
          note={rate === null ? 'Henüz ödeme planı yok' : 'Tüm ödeme planına göre'}
          href={dashboardHref(ctx.role, 'finans', { durum: 'odendi' })}
          state={ctx.state}
        />
      )
    },
  }),
  defineCard({
    id: 'yonetici.bugunku-tahsilat',
    roles: ['yonetici'],
    module: 'finance',
    section: (data) => data.finance,
    area: 'stat',
    order: 40,
    component: ({ ctx }) => (
      <StatCard
        label="Bugünkü tahsilat"
        icon="CircleCheck"
        value={money(ctx.data?.finance?.collectedToday.amount ?? 0)}
        note={`${number(ctx.data?.finance?.collectedToday.count ?? 0)} taksit bugün ödendi`}
        href={dashboardHref(ctx.role, 'finans', { durum: 'odendi' })}
        state={ctx.state}
      />
    ),
  }),
  defineCard({
    id: 'yonetici.bekleyen-tahsilat',
    roles: ['yonetici'],
    module: 'finance',
    section: (data) => data.finance,
    area: 'stat',
    order: 50,
    component: ({ ctx }) => {
      const invoices = ctx.data?.finance?.invoices
      return (
        <StatCard
          label="Bekleyen tahsilat"
          icon="Wallet"
          value={money(invoices ? outstandingAmount(invoices) : 0)}
          note={`${number(invoiceSlice(invoices, 'gecikmis')?.count)} gecikmiş taksit`}
          href={dashboardHref(ctx.role, 'finans', { durum: 'gecikmis' })}
          state={ctx.state}
        />
      )
    },
  }),
  defineCard({
    id: 'yonetici.gecikmis-tutar',
    roles: ['yonetici'],
    module: 'finance',
    section: (data) => data.finance,
    area: 'stat',
    order: 55,
    component: OverdueAmountCard,
  }),
  defineCard({
    id: 'yonetici.taksit-durumu',
    roles: ['yonetici'],
    module: 'finance',
    section: (data) => data.finance,
    area: 'main',
    order: 100,
    component: ({ ctx }) => {
      const invoices = ctx.data?.finance?.invoices
      const slices = invoices ? invoiceStatusSlices(invoices) : []
      return (
        <ListCard
          title="Taksit durumu"
          description={`Ödeme planı toplamı ${money(invoices?.amount)} · ${number(invoices?.total)} taksit`}
          action={{ label: 'Finansı aç', href: dashboardHref(ctx.role, 'finans') }}
          state={ctx.state}
          isEmpty={invoices?.total === 0}
          emptyText="Henüz ödeme planı oluşturulmadı."
        >
          <CardList label="Taksit durumları">
            {slices.map((slice) => (
              <li key={slice.key} className="grid gap-2 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <Link
                    to={dashboardHref(ctx.role, 'finans', { durum: slice.key })}
                    className="inline-flex min-h-6 items-center gap-2 font-medium hover:underline"
                  >
                    <StatusBadge text={slice.label} />
                    <span>{number(slice.count)} taksit</span>
                  </Link>
                  <span className="text-md font-semibold tabular-nums">
                    {money(slice.amount)}
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      %{slice.share}
                    </span>
                  </span>
                </div>
                <ShareBar value={slice.share} tone={SLICE_TONE[slice.key]} />
              </li>
            ))}
          </CardList>
        </ListCard>
      )
    },
  }),
  defineCard({
    id: 'yonetici.yaklasan-odemeler',
    roles: ['yonetici'],
    module: 'finance',
    section: (data) => data.finance,
    area: 'side',
    order: 105,
    component: PriorityInvoicesCard,
  }),
  defineCard({
    id: 'yonetici.aylik-tahsilat',
    roles: ['yonetici'],
    module: 'finance',
    section: (data) => data.finance,
    area: 'main',
    order: 200,
    component: ({ ctx }) => (
      <CollectionTrend
        monthly={ctx.data?.finance?.monthlyCollection}
        state={ctx.state}
        href={dashboardHref(ctx.role, 'finans', { durum: 'odendi' })}
      />
    ),
  }),

  // --- Ön büro ---
  defineCard({
    id: 'onburo.gecikmis-taksit',
    roles: ['onburo'],
    module: 'finance',
    section: (data) => data.finance,
    area: 'stat',
    order: 10,
    component: ({ ctx }) => {
      const slice = invoiceSlice(ctx.data?.finance?.invoices, 'gecikmis')
      return (
        <StatCard
          label="Gecikmiş taksit"
          icon="Timer"
          value={number(slice?.count)}
          note={`${money(slice?.amount)} tahsilat bekliyor`}
          href={dashboardHref(ctx.role, FRONT_DESK_PATH, { durum: 'gecikmis' })}
          state={ctx.state}
        />
      )
    },
  }),
  defineCard({
    id: 'onburo.yaklasan-taksit',
    roles: ['onburo'],
    module: 'finance',
    section: (data) => data.finance,
    area: 'stat',
    order: 20,
    component: ({ ctx }) => {
      const slice = invoiceSlice(ctx.data?.finance?.invoices, 'yaklasan')
      return (
        <StatCard
          label="Yaklaşan taksit"
          icon="CalendarDays"
          value={number(slice?.count)}
          note={`${money(slice?.amount)} vadesi gelmedi`}
          href={dashboardHref(ctx.role, FRONT_DESK_PATH, { durum: 'yaklasan' })}
          state={ctx.state}
        />
      )
    },
  }),
  defineCard({
    id: 'onburo.bugunku-tahsilat',
    roles: ['onburo'],
    module: 'finance',
    section: (data) => data.finance,
    area: 'stat',
    order: 30,
    component: ({ ctx }) => (
      <StatCard
        label="Bugünkü tahsilat"
        icon="CircleCheck"
        value={money(ctx.data?.finance?.collectedToday.amount ?? 0)}
        note={`${number(ctx.data?.finance?.collectedToday.count ?? 0)} taksit bugün ödendi`}
        href={dashboardHref(ctx.role, FRONT_DESK_PATH, { durum: 'odendi' })}
        state={ctx.state}
      />
    ),
  }),
  defineCard({
    id: 'onburo.tahsil-edilen',
    roles: ['onburo'],
    module: 'finance',
    section: (data) => data.finance,
    area: 'stat',
    order: 40,
    component: ({ ctx }) => {
      const slice = invoiceSlice(ctx.data?.finance?.invoices, 'odendi')
      return (
        <StatCard
          label="Tahsil edilen"
          icon="Wallet"
          value={money(slice?.amount)}
          note={`${number(slice?.count)} taksit ödendi`}
          href={dashboardHref(ctx.role, FRONT_DESK_PATH, { durum: 'odendi' })}
          state={ctx.state}
        />
      )
    },
  }),
  defineCard({
    id: 'onburo.gecikmis-taksitler',
    roles: ['onburo'],
    module: 'finance',
    section: (data) => data.finance,
    area: 'main',
    order: 100,
    component: ({ ctx }) => (
      <ListCard
        title="Gecikmiş taksitler"
        description="Vadesi en eski olanlar önce"
        action={{
          label: 'Tümünü gör',
          href: dashboardHref(ctx.role, FRONT_DESK_PATH, { durum: 'gecikmis' }),
        }}
        state={ctx.state}
        isEmpty={ctx.data?.finance?.overdue.length === 0}
        emptyText="Gecikmiş taksit bulunmuyor."
      >
        <InvoiceList label="Gecikmiş taksitler" rows={ctx.data?.finance?.overdue} />
      </ListCard>
    ),
  }),
  defineCard({
    id: 'onburo.yaklasan-taksitler',
    roles: ['onburo'],
    module: 'finance',
    section: (data) => data.finance,
    area: 'side',
    order: 110,
    component: ({ ctx }) => (
      <ListCard
        title="Yaklaşan taksitler"
        description="Vadesi en yakın olanlar"
        action={{
          label: 'Tümünü gör',
          href: dashboardHref(ctx.role, FRONT_DESK_PATH, { durum: 'yaklasan' }),
        }}
        state={ctx.state}
        isEmpty={ctx.data?.finance?.upcoming.length === 0}
        emptyText="Yaklaşan taksit bulunmuyor."
      >
        <InvoiceList label="Yaklaşan taksitler" rows={ctx.data?.finance?.upcoming} compact />
      </ListCard>
    ),
  }),
  defineCard({
    id: 'onburo.son-tahsilatlar',
    roles: ['onburo'],
    module: 'finance',
    section: (data) => data.finance,
    area: 'main',
    order: 200,
    component: ({ ctx }) => (
      <ListCard
        title="Son tahsilatlar"
        description="En son kaydedilen ödemeler; bugün ödenenler işaretli"
        action={{
          label: 'Tümünü gör',
          href: dashboardHref(ctx.role, FRONT_DESK_PATH, { durum: 'odendi' }),
        }}
        state={ctx.state}
        isEmpty={ctx.data?.finance?.recentPayments.length === 0}
        emptyText="Henüz tahsilat kaydı yok."
      >
        <InvoiceList
          label="Son tahsilatlar"
          rows={ctx.data?.finance?.recentPayments}
          today={ctx.data?.today ?? ''}
        />
      </ListCard>
    ),
  }),

  // --- Yönetici ve ön büro: kritik stok (DOM-FIN-079; ON-230). Haberler kartının yanında durur. ---
  defineCard({
    id: 'finans.kritik-stok',
    roles: ['yonetici', 'onburo'],
    module: 'finance',
    section: (data) => ('finance' in data ? data.finance : null),
    area: 'side',
    order: 405,
    component: CriticalStockCard,
  }),
  // --- Yönetici ve ön büro: kimyasal son kullanma (DOM-FIN-090; ON-234). Kritik stoğun altında. ---
  defineCard({
    id: 'finans.kimyasal-son-kullanma',
    roles: ['yonetici', 'onburo'],
    module: 'finance',
    section: (data) => ('finance' in data ? data.finance : null),
    area: 'side',
    order: 406,
    component: ChemicalExpiryCard,
  }),

  // --- Veli: çocuğun bakiyesi (DOM-FIN-052). Öğrencinin özetinde alan yoktur, kart çizilmez. ---
  defineCard({
    id: 'veli.guncel-bakiye',
    roles: ['ogrenci', 'veli'],
    module: 'finance',
    section: (data) => ('balance' in data ? data.balance : null),
    area: 'stat',
    order: 40,
    component: ({ ctx }) => {
      const { data } = ctx
      if (!data || !('balance' in data) || !data.balance) return null
      const child = data.role === 'veli' ? data.student.id : ''
      return (
        <StatCard
          label="Güncel bakiye"
          icon="Wallet"
          value={money(data.balance.outstanding)}
          note={`${number(data.balance.overdueCount)} gecikmiş taksit`}
          href={dashboardHref(ctx.role, 'finans', {}, child)}
          state={ctx.state}
        />
      )
    },
  }),
]

type InvoiceListProps = {
  label: string
  rows: readonly InvoiceRow[] | undefined
  /** Dar sütunda tutar ve vade alt satıra iner. */
  compact?: boolean
  /** Verilirse ödeme günü gösterilir; bugün ödenenler rozetle işaretlenir. */
  today?: string
}

function InvoiceList({ label, rows, compact = false, today }: InvoiceListProps) {
  return (
    <CardList label={label}>
      {rows?.map((row) => {
        const paidToday = today !== undefined && !!row.paidAt && dayKey(row.paidAt) === today
        const detail =
          today !== undefined && row.paidAt
            ? `${row.installment}. taksit · ödeme ${dateLabel(row.paidAt, { year: 'numeric' })}`
            : `${row.installment}. taksit · vade ${row.dueDate ? dateLabel(row.dueDate, { year: 'numeric' }) : '—'}`
        return (
          <li
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0"
          >
            <StudentName name={row.studentName} detail={detail} />
            <span
              className={
                compact
                  ? 'ml-11 text-md font-semibold tabular-nums'
                  : 'flex items-center gap-2 text-md font-semibold tabular-nums'
              }
            >
              {money(row.amount)}
              {paidToday ? <StatusBadge text="Bugün" tone="green" /> : null}
            </span>
          </li>
        )
      })}
    </CardList>
  )
}
