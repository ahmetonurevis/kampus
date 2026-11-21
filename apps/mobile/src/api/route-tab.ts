// Sekmeli ekranın gezinme parametresinden sekme seçimi (saf karar; kanca `use-route-tab.ts`).
// Bildirim ekranı `navigation.navigate(ekran, { tab })` ile açar; her gezinme yeni parametre nesnesi
// getirir. Parametre bir kez uygulanır: ekran onu tüketince `{ tab: undefined }` yazar, böylece
// ekran yeniden kurulsa ("Yeniden dene") sekme bildirim değerine geri dönmez.

export type RouteTabParams<T extends string> = { tab?: T | undefined } | undefined

export type RouteTabState<T extends string> = {
  /** Gösterilen sekme. */
  tab: T
  /** Son işlenen parametre nesnesi (kimlik karşılaştırılır). */
  seen: RouteTabParams<T>
}

export function initialRouteTab<T extends string>(
  params: RouteTabParams<T>,
  fallback: T,
): RouteTabState<T> {
  return { tab: params?.tab ?? fallback, seen: params }
}

/**
 * Yeni parametre nesnesi geldiyse ve sekme istiyorsa o sekme açılır (aynı sekme istense de, kullanıcı
 * başka sekmeye geçmiş olabilir). Aynı nesnede kullanıcının seçimi korunur; sekmesiz parametre
 * (menü kartı, tüketilmiş parametre) sekmeye dokunmaz.
 */
export function syncRouteTab<T extends string>(
  state: RouteTabState<T>,
  params: RouteTabParams<T>,
): RouteTabState<T> {
  if (state.seen === params) return state
  return { tab: params?.tab ?? state.tab, seen: params }
}

/** Parametredeki sekme uygulandı ve temizlenmeli mi. */
export const shouldConsumeRouteTab = <T extends string>(params: RouteTabParams<T>): boolean =>
  params?.tab !== undefined
