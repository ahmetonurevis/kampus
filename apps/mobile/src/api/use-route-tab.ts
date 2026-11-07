import { useEffect, useState } from 'react'
import {
  initialRouteTab,
  shouldConsumeRouteTab,
  syncRouteTab,
  type RouteTabParams,
} from './route-tab.ts'

/**
 * Sekmeli ekranın seçili sekmesi: bildirimden gelen istek ekran zaten yığındayken de uygulanır ve
 * `consume` ile bir kez tüketilir (ekran yeniden kurulunca bildirim sekmesine dönülmez). Karar
 * `route-tab.ts` içindedir.
 */
export function useRouteTab<T extends string>(
  params: RouteTabParams<T>,
  fallback: T,
  consume: () => void,
): readonly [T, (tab: T) => void] {
  const [state, setState] = useState(() => initialRouteTab(params, fallback))
  const current = syncRouteTab(state, params)
  if (current !== state) setState(current)
  useEffect(() => {
    if (shouldConsumeRouteTab(params)) consume()
    // `consume` her çizimde yeni işlevdir; yalnız yeni parametre nesnesi tüketilir.
  }, [params])
  return [current.tab, (tab: T) => setState({ ...current, tab })] as const
}
