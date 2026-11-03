// Genel Bakış kayıt (CRM aday) kartları, ön büro (IST-116). Kayıt yuvası
// `dashboard/dashboard-cards.tsx` Onur bloğudur; kural docs/sayfalar/platform.md "Pano kartı ekleme".
import { number } from '@kampus/school-core/lib/format.ts'
import { CardList, ListCard, StatCard } from '../dashboard/DashboardParts.tsx'
import { defineCard } from '../dashboard/dashboard-cards-model.ts'
import { dashboardHref, sectionVisible } from '../dashboard/dashboard-model.ts'

const stageCount = (stages: readonly { stage: string | null; count: number }[], name: string) =>
  stages.find((item) => item.stage === name)?.count ?? 0

export const ENROLLMENT_CARDS = [
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
          value={number(stageCount(stages, 'Yeni aday'))}
          note={`${number(stageCount(stages, 'Kayıt oldu'))} aday kesin kayıt oldu`}
          href={dashboardHref(ctx.role, 'adaylar')}
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
