import { useEffect, useState } from 'react'

/**
 * Şimdiki zaman (ms); `active` iken `intervalMs` aralığıyla tazelenir (geri sayım göstergeleri).
 * Pasifken zamanlayıcı kurulmaz. Zamanlayıcı dış sistemdir; durum yalnız tık ile değişir.
 */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [active, intervalMs])
  return now
}
