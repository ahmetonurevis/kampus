// Veli finans sayfalarının seçili çocuğu (ON-313; K-04, DOM-FIN-052, DOM-ILT-074). Kabuğun çocuk
// seçicisi `/me` velayet bağlantılarını gösterir; velayeti olmayan ödeyici velinin çocuğu orada
// yoktur. Finans sayfaları ödeyicisi olunan çocuğu ayrı parametreyle (`?odenen=`) seçer: kabuk
// `?cocuk=`'yu yalnız velayet listesinden kabul eder ve tanımadığı kimliği ilk çocukla değiştirir.
// Akademik sayfalar bu parametreyi okumaz; ödeyici çocuk orada hiç görünmez.
import { CHILD_SCOPED_PANEL_PARAMS } from '../../lib/child-selection.ts'

export const PAYER_CHILD_PARAM = 'odenen'

/** Ödeyici çocuk seçildiği andaki kabuk çocuğu; kabukta çocuk değişince seçim bırakılır. */
export const payerChildViewKey = (payerId: string) => `finance-payer-child:${payerId}`

/** Ödeyici çocuğa geçiş: çocuğa bağlı açık paneller kapanır, liste durumu korunur. */
export function withPayerChildSwitch(search: string, payerId: string): string {
  const params = new URLSearchParams(search)
  for (const name of CHILD_SCOPED_PANEL_PARAMS) params.delete(name)
  params.set(PAYER_CHILD_PARAM, payerId)
  return `?${params.toString()}`
}

/** Ödeyici çocuk seçimini adresten kaldırır; diğer parametreler korunur. */
export function withoutPayerChild(search: string): string {
  const params = new URLSearchParams(search)
  params.delete(PAYER_CHILD_PARAM)
  const rest = params.toString()
  return rest === '' ? '' : `?${rest}`
}

/**
 * Seçili finans çocuğu. `requested` adresteki ödeyici çocuk, `remembered` onun seçildiği andaki
 * kabuk çocuğudur (yalnız bellekte; yenilemede yoktur). Geçerli ödeyici seçimi kabuk çocuğundan
 * önce gelir; kabukta çocuk yoksa ilk ödeyici çocuk seçilir. `stale`: adresteki seçim artık
 * geçerli değil (kabukta çocuk değişti ya da kimlik ödeyici listesinde yok), adresten kalkar.
 */
export function resolveFinanceChild(input: {
  shellChild: string
  payerOnlyIds: readonly string[]
  requested: string | null
  remembered: unknown
}): { childId: string; payerOnly: boolean; stale: boolean } {
  const { shellChild, payerOnlyIds, requested, remembered } = input
  const valid =
    requested !== null &&
    payerOnlyIds.includes(requested) &&
    (remembered === undefined || remembered === shellChild)
  if (valid) return { childId: requested, payerOnly: true, stale: false }
  const stale = requested !== null
  if (shellChild) return { childId: shellChild, payerOnly: false, stale }
  const first = payerOnlyIds[0]
  return first === undefined
    ? { childId: '', payerOnly: false, stale }
    : { childId: first, payerOnly: true, stale }
}
