// Better Auth giriş hatasından kullanıcı mesajı (web ve mobil). Sunucu metni gösterilmez; mesaj
// durum ve koddan burada üretilir (teknik ayrıntı yalnız loga). Hesabın varlığı belli edilmez:
// bilinmeyen e-posta ile yanlış parola aynı mesajı alır.

/** Better Auth istemcisinin `error` nesnesinin kullandığımız kısmı. */
export interface AuthClientError {
  status: number
  code?: string | undefined
}

/** Giriş sonucu: `field` varsa mesaj o alanın altında, yoksa form üstünde gösterilir. */
export type SignInResult = { ok: true } | { ok: false; message: string; field?: 'password' }
export type SignInFailure = Extract<SignInResult, { ok: false }>

export const SIGN_IN_MESSAGES = {
  invalid: 'E-posta veya parola hatalı.',
  locked: 'Hesabınızla şu an giriş yapılamıyor. Kurum yöneticinizle iletişime geçin.',
  rateLimited: 'Çok fazla giriş denemesi yapıldı. Lütfen biraz bekleyip tekrar deneyin.',
  unavailable: 'Giriş şu an yapılamıyor. Lütfen tekrar deneyin.',
  network: 'Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip yeniden deneyin.',
} as const

/** Hesabın kilitli, askıda veya doğrulanmamış olduğunu bildiren Better Auth kodları. */
const LOCKED_CODES: ReadonlySet<string> = new Set([
  'BANNED_USER',
  'USER_BANNED',
  'ACCOUNT_LOCKED',
  'EMAIL_NOT_VERIFIED',
])

/** `Retry-After` saniye ya da HTTP tarihi olabilir; geçersizse `null`. */
export function retryAfterSeconds(
  header: string | null | undefined,
  now = Date.now(),
): number | null {
  if (!header) return null
  const trimmed = header.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  const date = Date.parse(trimmed)
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - now) / 1000))
}

function rateLimitMessage(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return SIGN_IN_MESSAGES.rateLimited
  const wait = seconds < 60 ? `${seconds} saniye` : `${Math.ceil(seconds / 60)} dakika`
  return `Çok fazla giriş denemesi yapıldı. Lütfen ${wait} sonra tekrar deneyin.`
}

export function signInFailure(
  error: AuthClientError,
  retryAfter: number | null = null,
): SignInFailure {
  // Better Auth istemcisi ağ hatasını bazı ortamlarda `status: 0` ile döndürür.
  if (error.status === 0) return { ok: false, message: SIGN_IN_MESSAGES.network }
  if (error.status === 429) return { ok: false, message: rateLimitMessage(retryAfter) }
  if (error.code && LOCKED_CODES.has(error.code))
    return { ok: false, message: SIGN_IN_MESSAGES.locked }
  if (error.status === 401 || error.code === 'INVALID_EMAIL_OR_PASSWORD')
    return { ok: false, field: 'password', message: SIGN_IN_MESSAGES.invalid }
  // Biçim hatası (400) istemci şemasından kaçtıysa da kimlik hatası gibi tek mesaj verilir.
  if (error.status === 400)
    return { ok: false, field: 'password', message: SIGN_IN_MESSAGES.invalid }
  return { ok: false, message: SIGN_IN_MESSAGES.unavailable }
}

/** İstek hiç yanıt almadan fırlatıldıysa (çevrimdışı, DNS, TLS) ağ hatası mesajı. */
export function signInNetworkFailure(): SignInFailure {
  return { ok: false, message: SIGN_IN_MESSAGES.network }
}
