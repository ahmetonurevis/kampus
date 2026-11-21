import { useRef } from 'react'

/**
 * Tetikleyicisiz (URL veya durumla açılan) pencerede kapanınca odağı açan öğeye geri verir:
 * Radix yalnız `Trigger` bileşeniyle açılan pencerede odağı kendisi geri taşır. Açan öğe, Radix
 * odağı pencereye taşımadan hemen önce (`onOpenAutoFocus`) okunur. Öğe kapanışta DOM'da yoksa
 * (liste yeniden çizildi) odak yerinde bırakılır.
 */
export function useFocusReturn() {
  const opener = useRef<HTMLElement | null>(null)
  return {
    onOpenAutoFocus() {
      const active = document.activeElement
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null
    },
    onCloseAutoFocus(event: Event) {
      event.preventDefault()
      if (opener.current?.isConnected) opener.current.focus()
      opener.current = null
    },
  }
}
