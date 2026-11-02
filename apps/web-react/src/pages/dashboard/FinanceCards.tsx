// Pano finans kartları (yönetici, ön büro, veli bakiyesi). Alan sahibi Onur (kayıt ve finans);
// kartlar Oğuzhan'ın panosundan ayrıştırılırken buraya toplandı ve girişleri `dashboard-cards.tsx`
// "Onur'a devredilecek" bölümündedir. Onur kartları `pages/finance/` altına taşıyıp girişleri
// Onur bloğuna alır, bu dosya o zaman silinir (docs/sayfalar/platform.md "Pano kartı ekleme").
import { Link } from 'react-router'
import { dateLabel, dayKey, money, number } from '@kampus/school-core/lib/format.ts'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { CollectionTrend } from './CollectionTrend.tsx'
import { CardList, ListCard, ShareBar, StatCard } from './DashboardParts.tsx'
import { StudentName } from './StudentName.tsx'
import { defineCard } from './dashboard-cards-model.ts'
import {
  dashboardHref,
  invoiceStatusSlices,
  outstandingAmount,
  type InvoiceRow,
} from './dashboard-model.ts'

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

export const FINANCE_CARDS = [
  // --- Yönetici ---
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
