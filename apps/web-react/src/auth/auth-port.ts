// Oturum sözleşmesi. Uygulama yalnız bu tipleri ve `AuthPort`'u bilir; gerçek uygulama Better Auth
// istemcisidir (`better-auth-port.ts`), oturum durumu `GET /api/v1/me`'den eşlenir (`session-mapping.ts`).
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

const institutionTypeSchema = z.enum(['school', 'language_school'])

/**
 * Arayüz oturumunun tip kaynağı (`z.infer`). Çalışma anında ayrıştırılmaz; değer tipli `/me`
 * yanıtından `toSession` ile kurulur (bkz. `session-mapping.ts`).
 */
export const sessionSchema = z.object({
  user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
  role: z.enum(ROLE_KEYS),
  /** Rolün görünen adı (Veli, Öğretmen…). TODO(D1b1): sınıf/branş gibi ayrıntı `/me`'ye gelince. */
  roleSubtitle: z.string(),
  membershipId: z.string(),
  institution: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    type: institutionTypeSchema,
    /** TODO(D1b1): dönem/akademik yıl `/me`'ye eklenince zorunlu olur; yokken arayüzde boş kalır. */
    term: z.string().optional(),
  }),
  /** Kurumda açık modüller; kapalı modül menüden, route'tan ve API'den düşer. */
  modules: z.record(z.string(), z.boolean()),
  /**
   * Veli hesabının çocukları (diğer rollerde boş); görüntülenen öğrenci bunlardan seçilir.
   * TODO(D1b1): ad `GET /api/v1/collections/students/:id` okuma ucundan gelecek; yokken seçici
   * yükleniyor durumundadır, uydurma ad gösterilmez.
   */
  children: z.array(z.object({ id: z.string(), name: z.string().optional() })),
  /** Kullanıcının bütün kurum üyelikleri; birden çoksa avatar menüsünde kurum değiştirilir. */
  memberships: z.array(
    z.object({
      id: z.string(),
      institutionId: z.string(),
      institutionName: z.string(),
      institutionType: institutionTypeSchema,
      role: z.enum(ROLE_KEYS),
    }),
  ),
})
export type Session = z.infer<typeof sessionSchema>
export type SessionChild = Session['children'][number]
export type SessionMembership = Session['memberships'][number]

/**
 * Oturum durumu: `loading` Better Auth oturumu veya `/me` bekleniyor; `no-membership` kullanıcı
 * hiçbir kurumda etkin üyeliğe sahip değil; `error` `/me` okunamadı (401 dışı).
 */
export type AuthState =
  | { status: 'loading'; session: null }
  | { status: 'signed-out'; session: null }
  | { status: 'signed-in'; session: Session }
  | { status: 'no-membership'; session: null }
  | { status: 'error'; session: null }

/** Giriş hatası: `field` varsa mesaj o alanın altında, yoksa form üstünde/toast'ta gösterilir. */
export type SignInResult = { ok: true } | { ok: false; message: string; field?: 'password' }

export interface AuthPort {
  /** Başarıda oturum durumu sunucudan yeniden okunmuş olarak döner. */
  signIn(input: LoginInput): Promise<SignInResult>
  signOut(): Promise<void>
}
