// Oturum listesinin KVKK daraltması (IST-003, guvenlik-kvkk.md §3). Better Auth `/list-sessions`
// ham IP ve tam kullanıcı ajanı döndürür; kullanıcıya yalnız kaba cihaz özeti gerekir. IP ve
// ayrıntılı ajan (sürüm, cihaz modeli) veri en aza indirme ilkesiyle istemciye gönderilmez.

const BROWSERS: readonly [RegExp, string][] = [
  [/Kampus|Expo|okhttp|CFNetwork|Darwin\//i, 'Kampüs uygulaması'],
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\/|Chromium\//, 'Chrome'],
  [/Safari\//, 'Safari'],
]

const SYSTEMS: readonly [RegExp, string][] = [
  [/iPhone|iPad|iPod|iOS/, 'iOS'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/CrOS/, 'ChromeOS'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Linux/, 'Linux'],
]

function first(table: readonly [RegExp, string][], text: string): string | null {
  return table.find(([pattern]) => pattern.test(text))?.[1] ?? null
}

/** "Chrome · macOS" gibi kaba özet; tanınmazsa `null` (istemci "Bilinmeyen cihaz" yazar). */
export function deviceSummary(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null
  const parts = [first(BROWSERS, userAgent), first(SYSTEMS, userAgent)].filter(
    (part): part is string => part !== null,
  )
  return parts.length ? parts.join(' · ') : null
}

/** İstemciye giden oturum satırı. `token` yalnız `/revoke-session` içindir (imzasız, çerez yerine geçmez). */
export interface SessionListItem {
  id: string
  token: string
  createdAt: string
  updatedAt: string
  expiresAt: string
  device: string | null
  current: boolean
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Better Auth oturum dizisini daraltır; beklenmeyen gövde boş listeye döner. */
export function narrowSessionList(body: unknown, currentToken: string | null): SessionListItem[] {
  if (!Array.isArray(body)) return []
  return body
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      id: text(item.id),
      token: text(item.token),
      createdAt: text(item.createdAt),
      updatedAt: text(item.updatedAt),
      expiresAt: text(item.expiresAt),
      device: deviceSummary(typeof item.userAgent === 'string' ? item.userAgent : null),
      current: currentToken !== null && item.token === currentToken,
    }))
    .sort((a, b) => Number(b.current) - Number(a.current) || b.updatedAt.localeCompare(a.updatedAt))
}
