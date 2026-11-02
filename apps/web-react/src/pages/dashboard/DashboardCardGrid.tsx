import { DashboardGrid, StatGrid } from './DashboardParts.tsx'
import { DASHBOARD_CARDS } from './dashboard-cards.tsx'
import {
  layoutCards,
  visibleCards,
  type DashboardCard,
  type DashboardCardContext,
} from './dashboard-cards-model.ts'

type Props = {
  ctx: DashboardCardContext
  /** Sayaç bölgesinin erişilebilir adı. */
  statLabel: string
  cards?: readonly DashboardCard[]
}

/**
 * Genel Bakış gövdesi: kart kaydını (`dashboard-cards.tsx`) rol ve modüle göre süzer, sayaçları
 * `StatGrid`'e, kalan kartları 2:1 `DashboardGrid` satırlarına dizer. Sayfalar kartları bilmez.
 */
export function DashboardCardGrid({ ctx, statLabel, cards = DASHBOARD_CARDS }: Props) {
  const { stats, rows } = layoutCards(visibleCards(cards, ctx))
  return (
    <>
      <StatGrid label={statLabel}>
        {stats.map((card) => (
          <card.component key={card.id} ctx={ctx} />
        ))}
      </StatGrid>
      {rows.map((row) => (
        <DashboardGrid key={row.map((card) => card.id).join('+')}>
          {row.map((card) => (
            <card.component key={card.id} ctx={ctx} />
          ))}
        </DashboardGrid>
      ))}
    </>
  )
}
