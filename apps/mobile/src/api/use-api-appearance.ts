import { useCallback, useEffect, useMemo, useState } from 'react'
import { AccessibilityInfo, useColorScheme } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { resolveTheme, type ThemePreference } from '../model/experience.ts'
import { recordError } from '../store/SchoolProvider.tsx'
import type { Appearance } from '../ui/appearance.ts'
import { API_THEME_KEY, parseStoredTheme } from './stored-theme.ts'

/** API modunun görünüm ayarları: saklanan tema, sistem teması ve azaltılmış hareket. */
export function useApiAppearance(): Appearance {
  const [theme, setThemeState] = useState<ThemePreference>('light')
  const [reduceMotion, setReduceMotion] = useState(false)
  const system = useColorScheme()

  useEffect(() => {
    AsyncStorage.getItem(API_THEME_KEY)
      .then((raw) => setThemeState(parseStoredTheme(raw)))
      .catch((error: unknown) => recordError(error, 'theme-read', 'warn'))
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch((error: unknown) => recordError(error, 'reduce-motion', 'warn'))
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
    return () => motion.remove()
  }, [])

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next)
    AsyncStorage.setItem(API_THEME_KEY, next).catch((error: unknown) =>
      recordError(error, 'theme-write', 'warn'),
    )
  }, [])

  return useMemo(
    () => ({ theme, resolvedTheme: resolveTheme(theme, system), reduceMotion, setTheme }),
    [theme, system, reduceMotion, setTheme],
  )
}
