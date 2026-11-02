import { use } from 'react'
import { useDashboard } from '@kampus/react-shared/use-dashboard.ts'
import { EmptyState } from '@/components/EmptyState.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import type { Session } from '@/auth/auth-port.ts'
import { ViewScopeContext } from '@/layout/view-scope.ts'
import { DashboardCardGrid } from './DashboardCardGrid.tsx'
import { combineStates } from './DashboardParts.tsx'

type Props = { session: Session; now: Date }

/**
 * Öğrenci ve veli Genel Bakışı (Vue `Dashboard.vue` öğrenci/veli): tek özet isteği
 * (`useDashboard`). Velide özet seçili çocuğa göredir (`?cocuk=`, istekte `studentId`); çocuk
 * değişince özet o çocuk için yeniden okunur. Özet gelmeden kart çizilmez; kartlar kart
 * kaydındadır (`dashboard-cards.tsx`).
 */
export function StudentDashboard({ session, now }: Props) {
  const parent = session.role === 'veli'
  const childId = use(ViewScopeContext)
  const noChild = parent && childId === ''
  const query = useDashboard(parent ? 'veli' : 'ogrenci', parent ? { studentId: childId } : {}, {
    enabled: !noChild,
  })
  if (noChild)
    return (
      <EmptyState
        title="Bağlı öğrenci bulunamadı."
        description="Hesabınıza bağlı bir öğrenci olduğunda özet burada görünür."
      />
    )
  if (query.error) return <QueryError error={query.error} onRetry={() => void query.refetch()} />
  if (!query.data)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Öğrenci bilgileri yükleniyor…
      </p>
    )
  const ctx = {
    session,
    role: session.role,
    modules: session.modules,
    data: query.data,
    state: combineStates(query),
    now,
  }
  return (
    <DashboardCardGrid
      ctx={ctx}
      statLabel={parent ? `${query.data.student.name} özeti` : 'Özetim'}
    />
  )
}
