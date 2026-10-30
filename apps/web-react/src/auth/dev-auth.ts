// Geliştirme sahtesi: beş rolün kabuğunu API olmadan görmek için. Oturum yalnız bellektedir;
// sayfa yenilenince kapanır, hiçbir şey localStorage'a yazılmaz.
// TODO(D2): API istemcisi gelince silinir; yerine Better Auth tabanlı uygulama bağlanır.
import { getRole, moduleKeys, ROLE_KEYS, type RoleKey } from '../lib/navigation.ts'
import type { AuthPort, LoginInput, Session, SignInResult } from './auth-port.ts'

export const DEV_PASSWORD = 'kampus-gelistirme'
export const devEmail = (role: RoleKey) => `${role}@akademi.kampus.test`

export const DEV_ACCOUNTS = ROLE_KEYS.map((role) => ({
  role,
  email: devEmail(role),
  ...getRole(role),
}))

export function devSession(role: RoleKey, modules?: Record<string, boolean>): Session {
  const info = getRole(role)
  return {
    user: { id: `dev-${role}`, name: info.name, email: devEmail(role) },
    role,
    roleSubtitle: info.subtitle,
    institution: {
      id: 'akademi',
      name: 'Akademi Özel Okulları',
      type: 'school',
      term: '2026–2027 Eğitim Dönemi',
    },
    modules: modules ?? Object.fromEntries(moduleKeys().map((key) => [key, true])),
    // Örnek veli Ayşe Yılmaz'ın çocukları (school-core örnek verisi s1, s2).
    children:
      role === 'veli'
        ? [
            { id: 's1', name: 'Deniz Yılmaz' },
            { id: 's2', name: 'Ece Yılmaz' },
          ]
        : [],
  }
}

export function createDevAuth(): AuthPort {
  let session: Session | null = null
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const listener of listeners) listener()
  }
  return {
    getSession: () => session,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async signIn({ email, password }: LoginInput): Promise<SignInResult> {
      const account = DEV_ACCOUNTS.find((item) => item.email === email.trim().toLowerCase())
      if (!account || password !== DEV_PASSWORD)
        return { ok: false, message: 'E-posta veya parola hatalı.' }
      session = devSession(account.role)
      emit()
      return { ok: true, session }
    },
    async signOut() {
      session = null
      emit()
    },
  }
}

/** Üretim derlemesinde API bağlanana kadar giriş kapalıdır. */
export function createUnavailableAuth(): AuthPort {
  return {
    getSession: () => null,
    subscribe: () => () => undefined,
    signIn: async () => ({
      ok: false,
      message: 'Giriş hizmeti henüz kullanılamıyor. Lütfen daha sonra tekrar deneyin.',
    }),
    signOut: async () => undefined,
  }
}
