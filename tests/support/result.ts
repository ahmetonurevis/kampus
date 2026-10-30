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
