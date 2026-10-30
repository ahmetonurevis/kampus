// Better Auth giriş hatasından kullanıcı mesajı. Sunucu metni gösterilmez; mesaj durum ve
// koddan burada üretilir (teknik ayrıntı yalnız loga).
import type { SignInResult } from './auth-port.ts'

/** Better Auth istemcisinin `error` nesnesinin kullandığımız kısmı. */
export interface AuthClientError {
  status: number
  code?: string | undefined
}

export const SIGN_IN_MESSAGES = {
  invalid: 'E-posta veya parola hatalı.',
  unavailable: 'Giriş şu an yapılamıyor. Lütfen tekrar deneyin.',
} as const

export function signInFailure(error: AuthClientError): Extract<SignInResult, { ok: false }> {
  if (error.status === 401 || error.code === 'INVALID_EMAIL_OR_PASSWORD')
    return { ok: false, field: 'password', message: SIGN_IN_MESSAGES.invalid }
  return { ok: false, message: SIGN_IN_MESSAGES.unavailable }
}
