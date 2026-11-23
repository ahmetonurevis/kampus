// Kayıt ve finans listelerinin ortak tazeleme kararı (ON-321, ON-322; IST-100, IST-124). Sunucu
// sayfalı listeler önceki sayfayı yeni yanıt gelene kadar tutar (`keepPreviousData`, ON-319); bu
// sürede satırlar soluk ve meşgul gösterilir.

/** Liste sorgusunun tazeleme kararına giren durumu (TanStack Query sonucu). */
export type ListFetchState = {
  isPlaceholderData: boolean
  isFetching: boolean
  isPending: boolean
}

/**
 * Liste tazeleniyor mu: sayfa, arama ya da süzgeç değişince önceki sayfa yeni yanıt gelene kadar
 * ekranda kalır (`isPlaceholderData`); bu sürede ve aynı sayfanın arka plan tazelemesinde satırlar
 * soluk ve meşgul gösterilir. Web `fetching={isFetching && !isPending}` ile aynı karar; ilk yükleme
 * satırsızdır ve ayrı "yükleniyor" durumudur.
 */
export function listRefreshing(query: ListFetchState): boolean {
  return query.isPlaceholderData || (query.isFetching && !query.isPending)
}
