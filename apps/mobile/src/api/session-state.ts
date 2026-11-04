// API modunun saf oturum yardımcıları: Better Auth durumu + `GET /api/v1/me` → uygulama durumu.
// Kapsam sunucuda uygulanır; buradaki eşleme yalnız yönlendirme, menü ve görünüm içindir.
import { isApiError } from '@kampus/api-client/errors.ts'
import type { components } from '@kampus/api-client/schema.d.ts'
import type { SessionStatus } from '@kampus/react-shared/session-status.ts'

export type Me = components['schemas']['Me']
export type MemberRole = NonNullable<Me['activeMembership']>['role']
export type MemberInstitution = Me['memberships'][number]

export type MobileSession = {
  user: Me['user']
  role: MemberRole
  membershipId: string
  institution: { id: string; name: string; type: NonNullable<Me['activeInstitution']>['type'] }
  /** Kurumda açık modüller; `/me` bütün modülleri listeler. */
  modules: Record<string, boolean>
  /** Veli hesabının bağlı çocuklarının kayıt kimlikleri (diğer rollerde boş). */
  childIds: string[]
  /** Öğrenci hesabının kendi öğrenci kaydı (rıza, konuşma kaydı); diğer rollerde `null`. */
  studentId: string | null
  memberships: MemberInstitution[]
}

/**
 * `loading` Better Auth oturumu veya `/me` bekleniyor; `no-membership` hiçbir kurumda etkin
 * üyelik yok; `error` `/me` okunamadı (401 dışı: ağ yok, sunucu hatası).
 */
export type ApiAuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; session: MobileSession }
  | { status: 'no-membership' }
  | { status: 'error'; message: string }

const ME_FAILED_MESSAGE = 'Hesap bilgileri alınamadı. Lütfen tekrar deneyin.'

/** Üyelik bağlantılarından öğrencinin kendi kayıt kimliği (web `SpeakingRecorder` ile aynı kaynak). */
export function ownStudentId(links: readonly { kind: string; recordId: string }[]): string | null {
  return links.find((link) => link.kind === 'student')?.recordId ?? null
}

export function toMobileSession(me: Me): MobileSession | null {
  const institution = me.activeInstitution
  const membership = me.activeMembership
  if (!institution || !membership) return null
  return {
    user: me.user,
    role: membership.role,
    membershipId: membership.id,
    institution: { id: institution.id, name: institution.name, type: institution.type },
    modules: institution.enabledModules,
    childIds:
      membership.role === 'veli'
        ? membership.links.filter((link) => link.kind === 'child').map((link) => link.recordId)
        : [],
    studentId: ownStudentId(membership.links),
    memberships: me.memberships,
  }
}

export function apiAuthState(
  sessionStatus: SessionStatus,
  me: { data: Me | undefined; error: unknown },
): ApiAuthState {
  if (sessionStatus === 'loading') return { status: 'loading' }
  if (sessionStatus === 'unauthenticated') return { status: 'signed-out' }
  // `/me` 401 verdiyse oturum sunucuda bitmiştir; Better Auth durumu yenilenene kadar beklenmez.
  if (isApiError(me.error) && me.error.status === 401) return { status: 'signed-out' }
  if (me.data) {
    const session = toMobileSession(me.data)
    return session ? { status: 'signed-in', session } : { status: 'no-membership' }
  }
  if (me.error) {
    // `ApiError` mesajı Türkçe ve teknik ayrıntısızdır (ağ hatası dahil); diğerleri genel mesaj.
    return { status: 'error', message: isApiError(me.error) ? me.error.message : ME_FAILED_MESSAGE }
  }
  return { status: 'loading' }
}

export type SettledStatus = Exclude<ApiAuthState['status'], 'loading'>

/**
 * Açık oturum kullanıcı çıkış yapmadan kapandıysa (süre doldu, başka cihazdan sonlandırıldı,
 * bir istek 401 aldı) giriş ekranında bildirilir. `loading` ara durumu yok sayılır.
 */
export function sessionExpired(
  previous: SettledStatus | null,
  next: ApiAuthState['status'],
  intentionalSignOut: boolean,
): boolean {
  return previous === 'signed-in' && next === 'signed-out' && !intentionalSignOut
}

/**
 * Oturum kapsamı anahtarı: kullanıcı, kurum veya rol değişince değişir. Gezinme yığını ve
 * bellekteki görünüm durumu (seçili çocuk, liste) bu anahtarla sıfırlanır; eski kurumun
 * ekranı veya seçimi yeni kurumda kalmaz.
 */
export function sessionScopeKey(session: Pick<MobileSession, 'user' | 'institution' | 'role'>) {
  return `${session.user.id}:${session.institution.id}:${session.role}`
}

/** Seçili çocuk hâlâ bu hesabın çocuğuysa korunur, değilse ilk çocuk; çocuk yoksa boş. */
export function resolveChild(childIds: readonly string[], selected: string | null): string {
  if (selected !== null && childIds.includes(selected)) return selected
  return childIds[0] ?? ''
}

/** Modül anahtarı yoksa (`null`) sayfa her zaman açıktır; listede olmayan modül açık sayılır. */
export function isModuleOpen(modules: Record<string, boolean>, module: string | null): boolean {
  return module === null || modules[module] !== false
}

/** Yerel istemcide güvenli depodaki çerez başlığı; boşsa başlık eklenmez. */
export function nativeAuthHeaders(cookie: string): Record<string, string> {
  return cookie ? { cookie } : {}
}

/** Kurum seçici: etkin kurum işaretli, ad sırasıyla (Türkçe). */
export function institutionChoices(session: MobileSession) {
  return [...session.memberships]
    .sort((left, right) => left.institutionName.localeCompare(right.institutionName, 'tr'))
    .map((membership) => ({
      ...membership,
      active: membership.institutionId === session.institution.id,
    }))
}
