import { useDashboard } from '@kampus/react-shared/use-dashboard.ts'
import type { Session } from '@/auth/auth-port.ts'
import { DashboardCardGrid } from './DashboardCardGrid.tsx'
import { combineStates } from './DashboardParts.tsx'

export type CardRole = 'yonetici' | 'onburo' | 'ogretmen'

const STAT_LABELS = {
  yonetici: 'Kurum özeti',
  onburo: 'Tahsilat özeti',
  ogretmen: 'Sınıf özeti',
} as const satisfies Record<CardRole, string>

/**
 * Yönetici, ön büro ve öğretmen Genel Bakışı: tek özet isteği (`useDashboard`) ve kart kaydından
 * çizilen gövde. Hangi kartın hangi rolde ve hangi modülle göründüğü `dashboard-cards.tsx`'tedir.
 */
export function RoleDashboard({
  session,
  role,
  now,
}: {
  session: Session
  role: CardRole
  now: Date
}) {
  const query = useDashboard(role)
  const ctx = {
    session,
    role,
    modules: session.modules,
    data: query.data ?? null,
    state: combineStates(query),
    now,
  }
  return <DashboardCardGrid ctx={ctx} statLabel={STAT_LABELS[role]} />
}
