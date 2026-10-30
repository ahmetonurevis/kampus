import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}

/** Sekme görünür mü; görünmeyen sekmede animasyonlar durdurulur. */
export function useDocumentVisible(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => !document.hidden,
    () => true,
  )
}
