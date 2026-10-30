import { DomainError } from '@kampus/school-core/lib/errors.ts'

/**
 * Hatadan kullanıcıya gösterilecek Türkçe mesajı seçer: Zod sorunu varsa ilk mesajı,
 * iş kuralı reddinde (`DomainError`) kural mesajını, diğer hatalarda teknik ayrıntı
 * göstermeden verilen genel mesajı döndürür.
 */
export function userErrorMessage(error: unknown, fallback: string): string {
  const issues: unknown =
    typeof error === 'object' && error !== null && 'issues' in error ? error.issues : undefined
  const first: unknown = Array.isArray(issues) ? issues[0] : undefined
  const issue =
    typeof first === 'object' && first !== null && 'message' in first ? first.message : undefined
  if (typeof issue === 'string' && issue) return issue
  return error instanceof DomainError ? error.message : fallback
}
