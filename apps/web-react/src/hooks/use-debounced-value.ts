import { useEffect, useState } from 'react'

/**
 * Değer `delay` ms değişmeden kalınca döner (sunucu araması her tuşta istek atmasın). Zamanlayıcı
 * dış sistemdir; effect yalnız onunla eşitler. Boşaltma gecikmesiz uygulanır.
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), value === '' ? 0 : delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return settled
}
