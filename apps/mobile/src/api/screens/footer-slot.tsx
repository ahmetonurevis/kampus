import { useRef, useSyncExternalStore, type ReactNode } from 'react'

/**
 * Pencerenin sabit alt bilgisi için küçük bir yuva. Çözme bileşeni (her deneme için ayrı durumla
 * kurulur) alt bilgisini buraya yazar; pencere (`Sheet`) tek kalır ve yalnız `FooterHost`'u gösterir.
 * Yazma yalnız `FooterHost`'u çizer, pencereyi ve çözme bileşenini yeniden çizdirmez (döngü yok).
 */
export type FooterSlot = {
  set: (node: ReactNode) => void
  get: () => ReactNode
  subscribe: (listener: () => void) => () => void
}

function createFooterSlot(): FooterSlot {
  let node: ReactNode = null
  const listeners = new Set<() => void>()
  return {
    set(next) {
      node = next
      listeners.forEach((listener) => listener())
    },
    get: () => node,
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
}

export const useFooterSlot = (): FooterSlot => {
  const ref = useRef<FooterSlot | null>(null)
  ref.current ??= createFooterSlot()
  return ref.current
}

/** Yuvadaki alt bilgiyi çizer. */
export function FooterHost({ slot }: { slot: FooterSlot }) {
  return <>{useSyncExternalStore(slot.subscribe, slot.get, slot.get)}</>
}
