// E-posta/parola girişi ve çıkış. İstemci dışarıdan verilir; testte sahte istemciyle çalışır.
import { z } from 'zod'
import {
  retryAfterSeconds,
  signInFailure,
  signInNetworkFailure,
  type AuthClientError,
  type SignInResult,
} from '@kampus/react-shared/sign-in-errors.ts'

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'E-posta adresinizi girin.')
    .pipe(z.email('Geçerli bir e-posta adresi girin.')),
  password: z.string().min(1, 'Parolanızı girin.'),
})
export type LoginInput = z.infer<typeof loginSchema>
export type LoginField = keyof LoginInput

/** Alan bazında ilk doğrulama mesajı; geçerliyse `null`. */
export function loginIssues(input: LoginInput): Partial<Record<LoginField, string>> | null {
  const result = loginSchema.safeParse(input)
  if (result.success) return null
  const issues: Partial<Record<LoginField, string>> = {}
  for (const issue of result.error.issues) {
    const field = issue.path[0]
    if ((field === 'email' || field === 'password') && !issues[field]) issues[field] = issue.message
  }
  return issues
}

/** `createAuthClient` çıktısının kullandığımız kısmı. */
export interface SignInClient {
  signIn: {
    email(input: {
      email: string
      password: string
      fetchOptions?: { onError?: (context: { response: Response }) => void }
    }): Promise<{ error: AuthClientError | null }>
  }
}

/**
 * Giriş: başarıda Better Auth oturum durumunu kendisi yeniler (Expo eklentisi çerezi güvenli
 * depoya yazar ve `$sessionSignal` yayar). Hatalar Türkçe ve tek mesajlıdır.
 */
export async function signInWithEmail(
  client: SignInClient,
  input: LoginInput,
  onTechnicalError: (error: unknown) => void,
): Promise<SignInResult> {
  // 429'da bekleme süresi yanıt başlığındadır (API `Retry-After`, Better Auth `X-Retry-After`).
  let retryAfter: number | null = null
  try {
    const result = await client.signIn.email({
      email: input.email.trim(),
      password: input.password,
      fetchOptions: {
        onError: ({ response }) => {
          retryAfter = retryAfterSeconds(
            response.headers.get('retry-after') ?? response.headers.get('x-retry-after'),
          )
        },
      },
    })
    if (result.error) return signInFailure(result.error, retryAfter)
    return { ok: true }
  } catch (error) {
    // Yanıt alınamadı (çevrimdışı, DNS, TLS); ayrıntı yalnız yerel loga.
    onTechnicalError(error)
    return signInNetworkFailure()
  }
}
