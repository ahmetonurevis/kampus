// Uygulama modu: `EXPO_PUBLIC_API_URL` verilmişse API modu, verilmemişse çevrimdışı demo.
// Değer derlemede pakete gömülür; sır taşımaz (yalnız API kökü).

export type AppMode =
  | { kind: 'demo' }
  | { kind: 'api'; url: string }
  /** Değer verilmiş ama kullanılamıyor; demo sessizce açılmaz, yapılandırma hatası gösterilir. */
  | { kind: 'invalid' }

// Şema + ana bilgisayar (+ port) + isteğe bağlı yol. Kullanıcı bilgisi, sorgu ve parça kabul
// edilmez: kök adres `/api/v1/...` yollarının önüne eklenir.
const API_URL_PATTERN = /^(https?):\/\/([a-z0-9.-]+|\[[0-9a-f:.]+\])(:\d{1,5})?(\/[^\s?#@]*)?$/i

/** API kökünü doğrular ve sondaki eğik çizgileri atar; geçersizse `null`. */
export function parseApiUrl(raw: string): string | null {
  const value = raw.trim()
  const match = API_URL_PATTERN.exec(value)
  if (!match) return null
  const port = match[3] ? Number(match[3].slice(1)) : null
  if (port !== null && (port < 1 || port > 65535)) return null
  return value.replace(/\/+$/, '')
}

export function resolveAppMode(raw: string | undefined): AppMode {
  if (raw === undefined || raw.trim() === '') return { kind: 'demo' }
  const url = parseApiUrl(raw)
  return url ? { kind: 'api', url } : { kind: 'invalid' }
}

// Expo yalnız doğrudan `process.env.EXPO_PUBLIC_*` erişimini derlemede değiştirir.
export const appMode: AppMode = resolveAppMode(process.env.EXPO_PUBLIC_API_URL)
