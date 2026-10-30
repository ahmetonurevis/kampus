import { createContext, useContext } from 'react'
import type { ResolvedTheme, ThemePreference } from '../model/experience.ts'

/**
 * Ortak bileşenlerin görünüm ayarları. Demo modunda `SchoolProvider`, API modunda
 * `api/ApiApp` sağlar; böylece bileşenler okul verisine veya oturuma bağlı kalmaz.
 */
export type Appearance = {
  theme: ThemePreference
  resolvedTheme: ResolvedTheme
  reduceMotion: boolean
  setTheme: (theme: ThemePreference) => void
}

export const AppearanceContext = createContext<Appearance | null>(null)

export function useAppearance(): Appearance {
  const value = useContext(AppearanceContext)
  if (!value) throw new Error('Görünüm ayarları yalnızca uygulama kökünde sağlanır.')
  return value
}
