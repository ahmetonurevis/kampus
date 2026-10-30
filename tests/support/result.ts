/**
 * İş akışı sonucu birleşim tipidir (nesne, sayı, `true`); testler alanları okuyabilsin diye
 * nesne olduğu doğrulanıp verilen alan şekline daraltılır.
 */
export function resultOf<T extends object = Record<string, unknown>>(value: unknown): T {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`Nesne sonucu bekleniyordu: ${String(value)}`)
  }
  return value as T
}

/** Sonucun türünü doğrulamadan daraltır; yalnız sonucu hiç okunmayabilen çağrılar için. */
export function narrow<T>(value: unknown): T {
  return value as T
}

/** Kayıt alanı metin olmalıdır; değilse test hemen başarısız olur. */
export function stringOf(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError(`Metin bekleniyordu: ${String(value)}`)
  return value
}
