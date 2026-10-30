// Oturum arayüzü. Uygulama yalnız bu sözleşmeyi bilir; gerçek uygulama API istemcisiyle gelir.
// TODO(D2): `packages/api-client` + `packages/react-shared` (Better Auth istemcisi) hazır olunca
// bu arayüzün gerçek uygulaması yazılır ve geliştirme sahtesi kaldırılır.
import { z } from 'zod'
import { ROLE_KEYS } from '../lib/navigation.ts'

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'E-posta adresinizi girin.')
    .pipe(z.email('Geçerli bir e-posta adresi girin.')),
  password: z.string().min(1, 'Parolanızı girin.').min(8, 'Parola en az 8 karakter olmalı.'),
})
export type LoginInput = z.infer<typeof loginSchema>

export const sessionSchema = z.object({
  user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
  role: z.enum(ROLE_KEYS),
  roleSubtitle: z.string(),
  institution: z.object({
    id: z.string(),
    name: z.string(),
    type: z.enum(['school', 'language_school']),
    term: z.string(),
  }),
  /** Kurumda açık modüller; kapalı modül menüden, route'tan ve API'den düşer. */
  modules: z.record(z.string(), z.boolean()),
})
export type Session = z.infer<typeof sessionSchema>

export type SignInResult = { ok: true; session: Session } | { ok: false; message: string }

export interface AuthPort {
  /** Geçerli oturum; yoksa null. */
  getSession(): Session | null
  /** Oturum değişimini dinler; dinlemeyi bırakan fonksiyon döner. */
  subscribe(listener: () => void): () => void
  signIn(input: LoginInput): Promise<SignInResult>
  signOut(): Promise<void>
}
