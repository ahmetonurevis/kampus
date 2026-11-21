import { number } from '@kampus/school-core/lib/format.ts'
import { StatCard } from './DashboardParts.tsx'
import { defineCard } from './dashboard-cards-model.ts'
import { dashboardHref } from './dashboard-model.ts'
import { requestCardModel } from './dashboard-front-desk-model.ts'

/**
 * Ön büro Genel Bakışı'nın iletişim kartı (IST-116): "Yeni talep" sayacı. Değer özet yanıtının
 * `requests` bölümüdür (`requests` `groupBy=status`, sunucu sayımı); kart Şikayet & Talepler'i
 * `?durum=Yeni` süzgeciyle açar ve sayı o listenin toplamıyla aynıdır. Liste kampüs süzgeci
 * taşımadığı için sayı da kampüs seçiminden bağımsızdır. Finans ve aday kartları Onur'dadır.
 */
export const FRONT_DESK_CARDS = [
  defineCard({
    id: 'onburo.yeni-talep',
    roles: ['onburo'],
    module: 'communication',
    section: (data) => data.requests,
    area: 'stat',
    order: 60,
    component: ({ ctx }) => {
      const model = requestCardModel(ctx.data?.requests ?? null)
      return (
        <StatCard
          label="Yeni talep"
          icon="MessagesSquare"
          value={number(model.value)}
          note={model.note}
          href={dashboardHref(ctx.role, 'talepler', model.filter)}
          state={ctx.state}
        />
      )
    },
  }),
]
