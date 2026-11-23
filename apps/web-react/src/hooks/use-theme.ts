import { useSyncExternalStore } from 'react'
import { getTheme, setTheme, subscribeTheme, toggleTheme } from '@/lib/theme-store.ts'

export function useTheme() {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getTheme)
  return { theme, setTheme, toggleTheme }
}
