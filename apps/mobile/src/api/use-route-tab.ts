import { useState } from 'react'

/**
 * Sekmeli ekranın seçili sekmesi: bildirimden gelen istek (`navigation.navigate(ekran, { tab })`)
 * ekran zaten yığındayken de uygulanır. Her gezinme yeni parametre nesnesi getirir; nesne değişince
 * istenen sekme açılır, aynı nesnedeyken kullanıcının sonradan seçtiği sekme korunur. Parametresiz
 * gezinme (menü kartı) sekmeyi değiştirmez.
 */
export function useRouteTab<T extends string>(
  params: { tab?: T | undefined } | undefined,
  fallback: T,
): readonly [T, (tab: T) => void] {
  const [tab, setTab] = useState<T>(params?.tab ?? fallback)
  const [seen, setSeen] = useState(params)
  if (seen !== params) {
    setSeen(params)
    if (params?.tab) setTab(params.tab)
  }
  return [tab, setTab] as const
}
