// React Query `focusManager`'ı mobilde uygulamanın öne gelmesine bağlar. Varsayılan dinleyici
// tarayıcı `visibilitychange` olayıdır; React Native'de tetiklenmez, bu yüzden uygulama arka
// plandan dönünce bayat sorgular (bildirim sayısı, listeler) tazelenmezdi. Saf: `AppState` ve
// `focusManager` parametredir (React Native'e bağlanmadan Node'da sınanır).

export type AppStateLike = {
  addEventListener: (type: 'change', listener: (state: string) => void) => { remove: () => void }
}

export type FocusManagerLike = {
  setEventListener: (setup: (handleFocus: (focused?: boolean) => void) => () => void) => void
}

/** `active` odak, diğer her durum (`background`, `inactive`) odak dışıdır. */
export function isAppFocused(state: string): boolean {
  return state === 'active'
}

/** Odak dinleyicisini kurar. Tazeleme yalnız odağa dönüşte ve taze süresi (30 sn) geçmiş sorgular içindir. */
export function bindAppStateFocus(focusManager: FocusManagerLike, appState: AppStateLike): void {
  focusManager.setEventListener((handleFocus) => {
    const subscription = appState.addEventListener('change', (state) => {
      handleFocus(isAppFocused(state))
    })
    return () => subscription.remove()
  })
}
