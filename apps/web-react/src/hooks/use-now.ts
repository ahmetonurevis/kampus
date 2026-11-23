import { useEffect, useState } from 'react'

/**
 * Şimdiki zaman (ms); `active` iken `intervalMs` aralığıyla tazelenir (geri sayım göstergeleri).
 * Pasifken zamanlayıcı kurulmaz. Zamanlayıcı dış sistemdir; durum yalnız tık ile değişir.
 * Arka plandaki sekmede tarayıcı zamanlayıcıyı yavaşlatır ya da durdurur; sekme yeniden
 * görününce ve pencere odak alınca saat hemen okunur (süre dolmuşsa ekran beklemeden tepki verir).
 */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const refresh = () => setNow(Date.now())
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    const timer = window.setInterval(refresh, intervalMs)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', refresh)
    }
  }, [active, intervalMs])
  return now
}
