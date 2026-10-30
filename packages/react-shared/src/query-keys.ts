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
