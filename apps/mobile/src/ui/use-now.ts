import { useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { useIsFocused } from '@react-navigation/native'

/**
 * Şimdiki an; ekran odaktayken `intervalMs` aralığıyla ve uygulama öne gelince tazelenir (teslim
 * süresi dolan görevin durumu ekran açıkken güncellenir). Web `useNow` karşılığı.
 */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date())
  const focused = useIsFocused()
  useEffect(() => {
    if (!focused) return
    const refresh = () => setNow(new Date())
    refresh()
    const timer = setInterval(refresh, intervalMs)
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh()
    })
    return () => {
      clearInterval(timer)
      subscription.remove()
    }
  }, [focused, intervalMs])
  return now
}
