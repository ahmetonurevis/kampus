// `AuthPort`'un Better Auth uygulaması. İstemci dışarıdan verilir; testte sahte istemciyle çalışır.
import {
  retryAfterSeconds,
  SIGN_IN_MESSAGES,
  signInFailure,
  type AuthClientError,
} from '@kampus/react-shared/sign-in-errors.ts'
import type { AuthPort, LoginInput, SignInResult } from './auth-port.ts'

/** `createAuthClient` (`better-auth/react`) çıktısının kullandığımız kısmı. */
export interface SignInClient {
  signIn: {
    email(input: {
      email: string
      password: string
      fetchOptions?: { onError?: (context: { response: Response }) => void }
    }): Promise<{ error: AuthClientError | null }>
  }
  signOut(): Promise<{ error: AuthClientError | null }>
}

/** Çıkış isteği sunucuda başarısız oldu; oturum açık kalmış olabilir. */
export class SignOutError extends Error {
  readonly status: number

  constructor(status: number) {
    super('Oturum kapatılamadı.')
    this.name = 'SignOutError'
    this.status = status
  }
}

export interface BetterAuthPortOptions {
  client: SignInClient
  /** Better Auth oturum durumunu sunucudan yeniden okur (bkz. `refreshAuthSession`). */
  refreshSession: () => Promise<void>
}

export function createBetterAuthPort({ client, refreshSession }: BetterAuthPortOptions): AuthPort {
  return {
    async signIn({ email, password }: LoginInput): Promise<SignInResult> {
      let result: { error: AuthClientError | null }
      // 429'da bekleme süresi yanıt başlığındadır (API `Retry-After`, Better Auth `X-Retry-After`).
      let retryAfter: number | null = null
      try {
        result = await client.signIn.email({
          email,
          password,
          fetchOptions: {
            onError: ({ response }) => {
              retryAfter = retryAfterSeconds(
                response.headers.get('retry-after') ?? response.headers.get('x-retry-after'),
              )
            },
          },
        })
      } catch (error) {
        console.error('[auth] giriş isteği başarısız', error)
        return { ok: false, message: SIGN_IN_MESSAGES.unavailable }
      }
      if (result.error) return signInFailure(result.error, retryAfter)
      // Yönlendirmeden önce oturum durumu güncellenir; aksi hâlde korumalı kabuk eski (boş)
      // durumu görüp girişe geri gönderir.
      await refreshSession()
      return { ok: true }
    },
    async signOut() {
      const { error } = await client.signOut()
      await refreshSession()
      if (error) throw new SignOutError(error.status)
    },
  }
}
