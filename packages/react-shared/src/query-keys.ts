/**
 * Sorgu anahtarları etkin kurumla başlar (`['inst', institutionId, ...parçalar]`); böylece bir
 * kurumun verisi başka kurumun önbelleğiyle karışmaz ve kurum değişince topluca temizlenir.
 * Kuruma bağlı olmayan oturum verisi (`/me`) `['session', ...]` altındadır.
 */
export const INSTITUTION_KEY_ROOT = 'inst'
export const SESSION_KEY_ROOT = 'session'

export type InstitutionQueryKey = readonly [
  typeof INSTITUTION_KEY_ROOT,
  string | null,
  ...unknown[],
]
export type SessionQueryKey = readonly [typeof SESSION_KEY_ROOT, ...unknown[]]

/** `institutionId` yalnız etkin kurum henüz bilinmeyen (sorgu kapalı) durumda `null`'dır. */
export function institutionKey(
  institutionId: string | null,
  ...parts: readonly unknown[]
): InstitutionQueryKey {
  return [INSTITUTION_KEY_ROOT, institutionId, ...parts]
}

export function sessionKey(...parts: readonly unknown[]): SessionQueryKey {
  return [SESSION_KEY_ROOT, ...parts]
}

/** `GET /api/v1/me` sorgusunun anahtarı. */
export const ME_QUERY_KEY = sessionKey('me')

export function isInstitutionKey(key: readonly unknown[]): boolean {
  return key[0] === INSTITUTION_KEY_ROOT
}

/**
 * İletişim sorgularının anahtar parçaları (kurum başa `useApi*` kancalarında eklenir). Yazışma
 * kökü liste, mesaj sayfaları ve veli hesaplarını ayrı alt kollarda tutar; gönderme ve okundu
 * sonrası `['conversations']` önekiyle topluca geçersiz kılınır. Duyurular genel koleksiyon
 * anahtarlarındadır (`collectionKeyPrefix('announcements')`).
 */
export const CONVERSATIONS_KEY_ROOT = 'conversations'

export function conversationsPrefix(): readonly unknown[] {
  return [CONVERSATIONS_KEY_ROOT]
}

export function conversationListKey(filters: { studentId?: string | undefined } = {}) {
  return [CONVERSATIONS_KEY_ROOT, 'list', { studentId: filters.studentId ?? null }] as const
}

export function conversationMessagesKey(conversationId: string) {
  return [CONVERSATIONS_KEY_ROOT, 'messages', conversationId] as const
}

export function parentAccountsKey(studentId: string) {
  return [CONVERSATIONS_KEY_ROOT, 'parent-accounts', studentId] as const
}

/**
 * Uygulama içi bildirim merkezi anahtar parçaları (F6a; `GET /notifications`). Liste (imleçli
 * sayfalar tek sonsuz sorguda) süzgeçle, okunmamış sayısı ayrı alt koldadır; okundu işaretinden sonra `['notifications']`
 * önekiyle ikisi birlikte tazelenir.
 */
export const NOTIFICATIONS_KEY_ROOT = 'notifications'

export function notificationsPrefix(): readonly unknown[] {
  return [NOTIFICATIONS_KEY_ROOT]
}

export function notificationListKey(filters: { unread: boolean }) {
  return [NOTIFICATIONS_KEY_ROOT, 'list', { unread: filters.unread }] as const
}

export function unreadNotificationsKey() {
  return [NOTIFICATIONS_KEY_ROOT, 'unread-count'] as const
}
