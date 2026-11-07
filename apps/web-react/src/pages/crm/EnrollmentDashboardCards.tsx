// Genel Bakış kayıt (CRM aday) kartları, ön büro (IST-116). Kayıt yuvası
// `dashboard/dashboard-cards.tsx` Onur bloğudur; kural docs/sayfalar/platform.md "Pano kartı ekleme".
// Vue ön büro panosundaki üç aday sayacı (bugünkü görüşme, görüşme bekleyen, toplam kesin kayıt)
// ve aşama dağılımı; sayılar kurum genelidir (aday özeti şube süzgecine bağlı değildir).
import { dayKey, number } from '@kampus/school-core/lib/format.ts'
import type { DashboardOf } from '@kampus/react-shared/dashboard.ts'
import { useCoreCounts } from '@/hooks/use-core-collection.ts'
import { CardList, combineStates, ListCard, StatCard } from '../dashboard/DashboardParts.tsx'
import { defineCard, type DashboardCardContext } from '../dashboard/dashboard-cards-model.ts'
import { dashboardHref, sectionVisible } from '../dashboard/dashboard-model.ts'
import {
  ENROLLED_STAGE,
  enrollmentRate,
  NEW_STAGE,
  stageCount,
  todayMeetingsQuery,
} from './enrollment-dashboard-model.ts'

/**
 * "Bugünkü tanışma görüşmesi" (Vue ön büro kartı): görüşmesi bugüne düşen açık adaylar, sunucu
 * sayımı (`trialAt` günü). Kart Tanışma Görüşmeleri'nin haftalık takvimine bağlanır.
 */
function TodayMeetingsCard({ ctx }: { ctx: DashboardCardContext<DashboardOf<'onburo'>> }) {
  const meetings = useCoreCounts('prospects', todayMeetingsQuery(dayKey(ctx.now)))
  return (
    <StatCard
      label="Bugünkü tanışma görüşmesi"
      icon="CalendarDays"
      value={number(meetings.data?.total ?? 0)}
      note="Açık adayların bugünkü görüşmeleri"
      href={dashboardHref(ctx.role, 'deneme-dersi-takvimi', { gorunum: 'hafta' })}
      state={combineStates(meetings)}
    />
  )
}

export const ENROLLMENT_CARDS = [
  defineCard({
    id: 'onburo.bugunku-gorusme',
    roles: ['onburo'],
    module: 'crm',
    section: (data) => data.prospects,
    area: 'stat',
    order: 45,
    component: TodayMeetingsCard,
  }),
  defineCard({
    id: 'onburo.gorusme-bekleyen-aday',
    roles: ['onburo'],
    module: 'crm',
    section: (data) => data.prospects,
    area: 'stat',
    order: 50,
    component: ({ ctx }) => {
      const stages = ctx.data?.prospects?.stages ?? []
      return (
        <StatCard
          label="Görüşme bekleyen aday"
          icon="ContactRound"
          value={number(stageCount(stages, NEW_STAGE))}
          note="Yeni aday aşamasında"
          href={dashboardHref(ctx.role, 'adaylar', { asama: NEW_STAGE })}
          state={ctx.state}
        />
      )
    },
  }),
  defineCard({
    id: 'onburo.toplam-kesin-kayit',
    roles: ['onburo'],
    module: 'crm',
    section: (data) => data.prospects,
    area: 'stat',
    order: 55,
    component: ({ ctx }) => {
      const stages = ctx.data?.prospects?.stages ?? []
      const total = ctx.data?.prospects?.total ?? 0
      const rate = enrollmentRate(stages, total)
      return (
        <StatCard
          label="Toplam kesin kayıt"
          icon="UserRoundPlus"
          value={number(stageCount(stages, ENROLLED_STAGE))}
          note={rate === null ? 'Henüz aday yok' : `${number(total)} adaydan %${rate} kesin kayıt`}
          href={dashboardHref(ctx.role, 'adaylar', { asama: ENROLLED_STAGE })}
          state={ctx.state}
        />
      )
    },
  }),
  defineCard({
    id: 'onburo.aday-asamalari',
    roles: ['onburo'],
    module: 'crm',
    section: (data) => data.prospects,
    // Kart finans bölümünün içindeydi: finans kapalıysa ön büro panosunda aday kartı da yoktur.
    when: ({ data, modules }) =>
      sectionVisible(data?.finance, data !== null, modules.finance === true),
    area: 'side',
    order: 210,
    component: ({ ctx }) => (
      <ListCard
        title="Aday aşamaları"
        description="CRM'deki adayların dağılımı"
        action={{ label: 'Adayları aç', href: dashboardHref(ctx.role, 'adaylar') }}
        state={ctx.state}
        isEmpty={ctx.data?.prospects?.total === 0}
        emptyText="Henüz aday kaydı yok."
      >
        <CardList label="Aday aşamaları">
          {ctx.data?.prospects?.stages.map((group) => (
            <li
              key={String(group.stage)}
              className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
            >
              <span>{group.stage ?? 'Aşama yok'}</span>
              <strong className="font-semibold tabular-nums">{number(group.count)}</strong>
            </li>
          ))}
        </CardList>
      </ListCard>
    ),
  }),
]
