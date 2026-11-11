// API modunda cihazda saklanan tek tercih: tema. Belirteç ve kişisel veri AsyncStorage'a yazılmaz.
import type { ThemePreference } from '../model/experience.ts'

export const API_THEME_KEY = 'kampus-mobile-api-theme-v1'

/** Bozuk veya eski değer açık temaya döner. */
export function parseStoredTheme(raw: string | null): ThemePreference {
  return raw === 'dark' || raw === 'system' ? raw : 'light'
}
