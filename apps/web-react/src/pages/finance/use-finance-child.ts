import { use, useMemo } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import {
  payerOnlyChildren,
  type PayerChildView,
} from '@kampus/react-shared/finance-payer-children.ts'
import { useFinancePayerChildren } from '@kampus/react-shared/use-finance-payer-children.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { ViewScopeContext } from '@/layout/view-scope.ts'
import { withChildNames, withChildSwitch } from '@/lib/child-selection.ts'
import { readView, writeView } from '@/lib/view-memory.ts'
import {
  PAYER_CHILD_PARAM,
  payerChildViewKey,
  resolveFinanceChild,
  withoutPayerChild,
  withPayerChildSwitch,
} from './finance-child.ts'

export type FinanceChildOption = { id: string; name?: string; payerOnly: boolean }

const NO_PAYER: readonly PayerChildView[] = []

/**
 * Veli finans sayfalarının seçili çocuğu (ON-313; K-04, DOM-FIN-052, DOM-ILT-074): kabuğun
 * velayet listesi ile ödeyicisi olunan çocuklar (`GET /finance/payer-children`). Ödeyici çocuk
 * yalnız burada seçilir; kapsam sunucudadır. Ödeyici çocuk yoksa seçim kabuğunkidir ve ek seçici
 * çizilmez. Velayet adları kabukla aynı sorgudan gelir (ek istek yok).
 */
export function useFinanceChild() {
  const { session } = useAuth()
  const shellChild = use(ViewScopeContext)
  const [params] = useSearchParams()
  const { search } = useLocation()
  const navigate = useNavigate()
  const isParent = session?.role === 'veli'
  const payer = useFinancePayerChildren({ enabled: isParent })
  const students = useCoreAll('students', {}, { enabled: isParent })
  const own = session?.children
  const ownNamed = useMemo(
    () => withChildNames(own ?? [], students.data?.map((row) => row.record) ?? []),
    [own, students.data],
  )
  const extra = useMemo(
    () =>
      payerOnlyChildren(
        ownNamed.map((child) => child.id),
        payer.data?.data ?? NO_PAYER,
      ),
    [ownNamed, payer.data],
  )
  const requested = params.get(PAYER_CHILD_PARAM)
  const resolved = resolveFinanceChild({
    shellChild,
    payerOnlyIds: extra.map((child) => child.id),
    requested,
    remembered: requested === null ? undefined : readView(payerChildViewKey(requested)),
  })
  // Ödeyici listesi gelmeden adresteki seçim ya da (velayetli çocuk yokken) ilk çocuk bilinmez.
  const needsPayer = isParent && (requested !== null || !shellChild)
  const waiting = needsPayer && payer.isPending
  const options: FinanceChildOption[] = [
    ...ownNamed.map((child) => ({ ...child, payerOnly: false })),
    ...extra.map((child) => ({ id: child.id, name: child.name, payerOnly: true })),
  ]

  function selectChild(next: string) {
    if (next === resolved.childId) return
    const toPayer = extra.some((child) => child.id === next)
    if (toPayer) writeView(payerChildViewKey(next), shellChild)
    const target = toPayer
      ? withPayerChildSwitch(search, next)
      : withoutPayerChild(withChildSwitch(search, next))
    void Promise.resolve(navigate({ search: target }, { preventScrollReset: true })).catch(
      (error: unknown) => console.error('[finans çocuğu] seçim yazılamadı', error),
    )
  }

  return {
    status: waiting ? 'loading' : needsPayer && payer.error ? 'error' : 'ready',
    error: payer.error,
    retry: () => void payer.refetch(),
    childId: resolved.childId,
    payerChild: resolved.payerOnly
      ? extra.find((child) => child.id === resolved.childId)
      : undefined,
    /** Adresteki geçersiz ödeyici seçimi kaldırılmış arama dizgisi; geçerliyse `null`. */
    cleanSearch: payer.data !== undefined && resolved.stale ? withoutPayerChild(search) : null,
    /** Ek seçici yalnız ödeyicisi olunan çocuk varken gösterilir. */
    options: extra.length > 0 ? options : [],
    selectChild,
  } as const
}
