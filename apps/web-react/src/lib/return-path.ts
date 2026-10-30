// Girişten sonra dönülecek adres. Yalnız uygulama içi göreli yol kabul edilir: başka köken,
// protokol göreli (`//`), ters eğik çizgi veya denetim karakteri taşıyan değer atılır (açık
// yönlendirme yok). Değer URL'de (`?donus=`) taşındığı için sayfa yenilense de korunur.
import { pageHref, type RoleKey } from './navigation.ts'

export const RETURN_PARAM = 'donus'
export const LOGIN_PATH = '/giris'

// Ayrıştırma için sabit, var olmayan bir köken; yalnız aynı kökende kalındığını denetlemeye yarar.
const BASE = 'https://kampus.invalid'

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/** Göreli yolu doğrular ve normalleştirir; uygun değilse `null`. */
export function safeRelativePath(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return null
  if (!raw.startsWith('/') || raw.startsWith('//')) return null
  // Tarayıcılar `\`'i `/` sayar (`/\evil.example`); denetim karakterleri de yolu bozabilir.
  if (raw.includes('\\') || hasControlCharacter(raw)) return null
  let url: URL
  try {
    url = new URL(raw, BASE)
  } catch {
    // Ayrıştırılamayan yol dönüş adresi olarak kullanılmaz.
    return null
  }
  // `/a/..//evil.example` gibi yollar normalleşince `//` ile başlayabilir.
  if (url.origin !== BASE || url.pathname.startsWith('//')) return null
  return `${url.pathname}${url.search}${url.hash}`
}

/** Girişten sonra gidilecek yer: aynı rolün kabuğundaysa dönüş adresi, değilse rol ana sayfası. */
export function returnPathFor(raw: unknown, role: RoleKey): string {
  const path = safeRelativePath(raw)
  return path?.startsWith(`/${role}/`) ? path : pageHref(role, { path: 'dashboard' })
}

/** Korumalı adresten giriş sayfasına: dönüş adresi sorgu parametresinde. */
export function loginHref(pathname: string, search = ''): string {
  const from = safeRelativePath(`${pathname}${search}`)
  if (!from || from === '/' || from.startsWith(LOGIN_PATH)) return LOGIN_PATH
  return `${LOGIN_PATH}?${new URLSearchParams({ [RETURN_PARAM]: from }).toString()}`
}
