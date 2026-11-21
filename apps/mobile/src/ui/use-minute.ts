import { useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { useIsFocused } from '@react-navigation/native'

export function useMinute(): number {
  const minute = () => Math.floor(Date.now() / 60000)
  const [now, setNow] = useState(minute)
  const focused = useIsFocused()
  useEffect(() => {
    if (!focused) return
    const refresh = () => setNow(minute())
    refresh()
    const timer = setInterval(refresh, 60000)
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh()
    })
    return () => {
      clearInterval(timer)
      subscription.remove()
    }
  }, [focused])
  return now
}
