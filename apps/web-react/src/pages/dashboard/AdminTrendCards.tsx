import { money } from '@kampus/school-core/lib/format.ts'
import { StatCard } from './DashboardParts.tsx'
import { defineCard } from './dashboard-cards-model.ts'
import { collectionSpark, currentMonthAmount, sparkLabel } from './dashboard-filter-model.ts'
import { dashboardHref } from './dashboard-model.ts'

/**
 * Yönetici "Bu ay tahsilat" sayacı (Vue `Dashboard.vue` yönetici ilk kartı): bu ayın tahsilatı ve
 * son 6 ayın tahsilat eğilimi mini grafiği. Değer ve grafik özetin aylık tahsilat serisindendir
 * (ödeme tarihine göre, seçili kampüse göre daralmış); hiç tahsilat yoksa grafik çizilmez.
 */
export const ADMIN_TREND_CARDS = [
  defineCard({
    id: 'yonetici.bu-ay-tahsilat',
    roles: ['yonetici'],
    module: 'finance',
    section: (data) => data.finance,
    area: 'stat',
    order: 5,
    component: ({ ctx }) => {
      const monthly = ctx.data?.finance?.monthlyCollection
      const points = collectionSpark(monthly)
      return (
        <StatCard
          label="Bu ay tahsilat"
          icon="Wallet"
          value={money(currentMonthAmount(monthly))}
          note="Son 6 ayın tahsilat eğilimi"
          href={dashboardHref(ctx.role, 'finans', { durum: 'odendi' })}
          state={ctx.state}
          spark={{ label: sparkLabel('Son 6 ayın tahsilatı', points, money), points }}
        />
      )
    },
  }),
]
