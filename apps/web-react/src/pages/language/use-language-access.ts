import { useMemo } from 'react'
import { useCoordinatorDuties } from '@kampus/react-shared/use-coordinator-duties.ts'
import { useAuth } from '@/auth/use-auth.ts'

const NO_LEVELS: ReadonlySet<string> = new Set()

/**
 * Kur ve grup ekranlarında oturumun rolü ve öğretmenin akademik koordinatörü olduğu CEFR
 * seviyeleri (DOM-YTK-027). Görev listesini yalnız öğretmen okur; sunucu ona kendi görevlerini
 * döndürür. Yetki sunucudadır; bu yalnız düğmelerin görünürlüğüdür.
 */
export function useLanguageAccess() {
  const { session } = useAuth()
  const role = session?.role
  const duties = useCoordinatorDuties({ pageSize: 100 }, { enabled: role === 'ogretmen' })
  const levels = useMemo(
    () =>
      duties.data
        ? new Set(
            duties.data.data
              .filter((duty) => duty.kind === 'academic_coordinator')
              .map((duty) => duty.scopeId),
          )
        : NO_LEVELS,
    [duties.data],
  )
  return { role, membershipId: session?.membershipId, levels }
}
