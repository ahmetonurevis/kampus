// Geçmiş girdisinin `state` değerini liste/panel yazımlarında korur. Profil gibi sayfalara
// başka bir sayfadan `state.from` ("Listeye dön" adresi) ile gelinir; tablo araması, sıralaması,
// sayfa değişimi ya da panel açma aynı girdiyi yeniden yazar ve `state` verilmezse silerdi.

/** Sağ panelin kendi işaretçisi (`use-detail-panel`): yalnız paneli açan girdide anlamlıdır. */
export const PANEL_MARKER = 'detailPanel'

/**
 * Geçerli girdinin `state` değerini yeni yazım için döndürür. Düz nesne değilse `undefined`; panel
 * işaretçisi taşınmaz (liste durumu değişince panel "bu sayfadan açıldı" sayılmaz).
 */
export function keptHistoryState(state: unknown): Record<string, unknown> | undefined {
  if (typeof state !== 'object' || state === null || Array.isArray(state)) return undefined
  const rest = { ...(state as Record<string, unknown>) }
  delete rest[PANEL_MARKER]
  return Object.keys(rest).length > 0 ? rest : undefined
}
