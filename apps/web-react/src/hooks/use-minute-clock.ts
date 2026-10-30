import { useEffect, useState } from 'react'

/**
 * Güncel an (ISO), dakikada bir tazelenir. Çizim sırasında saat okunmaz (bileşenler saf kalır);
 * saate bağlı görünüm (ör. "yoklama başladı mı") dakika hassasiyetiyle güncel kalır.
 */
export function useMinuteClock(intervalMs = 60_000): string {
  const [now, setNow] = useState(() => new Date().toISOString())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date().toISOString()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
