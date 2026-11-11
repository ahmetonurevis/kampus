import { useCallback, useMemo } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import type { Session } from '@/auth/auth-port.ts'
import { PageHeading } from '@/components/PageHeading.tsx'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { keptHistoryState } from '@/lib/history-state.ts'
import { RoleDashboard } from './RoleDashboard.tsx'
import { ALL_BRANCHES, BRANCH_PARAM, branchValue } from './dashboard-filter-model.ts'

type Props = {
  session: Session
  role: 'yonetici' | 'onburo'
  now: Date
  title: string
  description: string
}

/**
 * Yönetici ve ön büro Genel Bakışı: başlıkta "Şube filtresi" (Vue `Dashboard.vue` `isStaff`), gövde
 * seçili kampüsün özeti. Seçim adreste (`?sube=`) tutulur, varsayılan tüm kampüsler. Kurum ve rol
 * kapsamı sunucudadır; süzgeç yalnız özeti seçili kampüsün sınıflarına daraltır (`branchId`).
 * Adresteki kampüs listede yoksa (arşivli, kapsam dışı, bozuk bağlantı) tüm kampüsler gösterilir.
 */
export function StaffDashboard({ session, role, now, title, description }: Props) {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const branches = useCoreAll('branches')
  const options = useMemo(
    () =>
      (branches.data ?? [])
        .filter((row) => row.record.isActive !== false)
        .map((row) => ({ id: row.id, name: row.record.name })),
    [branches.data],
  )
  const requested = params.get(BRANCH_PARAM)
  const branchId = branchValue(
    requested,
    options.map((option) => option.id),
  )
  const setBranch = useCallback(
    (value: string) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          if (value === ALL_BRANCHES) next.delete(BRANCH_PARAM)
          else next.set(BRANCH_PARAM, value)
          return next
        },
        { replace: true, preventScrollReset: true, state: keptHistoryState(location.state) },
      ),
    [setParams, location.state],
  )
  return (
    <>
      <PageHeading
        title={title}
        description={description}
        actions={
          <NativeSelect
            aria-label="Şube filtresi"
            value={branchId}
            onChange={(event) => setBranch(event.target.value)}
            className="min-h-9 text-sm"
          >
            <NativeSelectOption value={ALL_BRANCHES}>Tüm kampüsler</NativeSelectOption>
            {options.map((option) => (
              <NativeSelectOption key={option.id} value={option.id}>
                {option.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        }
      />
      <RoleDashboard
        session={session}
        role={role}
        now={now}
        branchId={branchId}
        // Adresteki kampüs doğrulanana kadar özet beklenir: "tümü" isteği boşuna atılmaz.
        enabled={!(requested !== null && branches.isPending)}
      />
    </>
  )
}
