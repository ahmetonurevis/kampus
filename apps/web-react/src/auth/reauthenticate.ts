import type { SignInResult } from './auth-port.ts'

export const PASSWORD_REQUIRED_MESSAGE = 'Parolanızı girin.'
export const SIGN_IN_UNAVAILABLE_MESSAGE = 'Giriş şu an yapılamıyor. Lütfen tekrar deneyin.'

export type ReauthenticateResult =
  | { ok: true }
  /** `clearPassword` yanlış parolada doğrudur: parola bellekte bırakılmaz. */
  | { ok: false; message: string; clearPassword: boolean }

export interface ReauthenticateInput {
  email: string | undefined
  password: string
  /** Pencere açılırken okunan kurum; yeni oturum başka kuruma açılsa da işlem burada sürer. */
  institutionId: string | undefined
  signIn: (credentials: { email: string; password: string }) => Promise<SignInResult>
  switchInstitution: (institutionId: string) => Promise<unknown>
}

/**
 * Taze oturum için parolayı doğrular (`ReauthModal`): aynı e-postayla yeniden girer, yeni oturum en
 * eski üyeliğe açıldığından işlemin yapıldığı kuruma geri geçer. Hata mesajı Türkçe ve kullanıcıya
 * gösterilebilir; teknik ayrıntı taşımaz.
 */
export async function reauthenticate(input: ReauthenticateInput): Promise<ReauthenticateResult> {
  const { email, password } = input
  if (!email || password === '')
    return { ok: false, message: PASSWORD_REQUIRED_MESSAGE, clearPassword: false }
  try {
    const result = await input.signIn({ email, password })
    if (!result.ok) return { ok: false, message: result.message, clearPassword: true }
    if (input.institutionId) await input.switchInstitution(input.institutionId)
    return { ok: true }
  } catch {
    return { ok: false, message: SIGN_IN_UNAVAILABLE_MESSAGE, clearPassword: false }
  }
}
