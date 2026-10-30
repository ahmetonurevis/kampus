import { createHash } from 'node:crypto'

/**
 * Anahtar sırasından bağımsız JSON: aynı içerikli iki gövde aynı özeti verir. Dizi sırası
 * anlamlıdır ve korunur.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (typeof value === 'object' && value !== null)
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(Reflect.get(value, key))]),
    )
  return value
}

/**
 * İstek özeti (api-tasarimi.md §7): metot + yol + kanonik gövdenin SHA-256'sı (hex). Gövdenin
 * kendisi saklanmaz; yalnız aynı anahtarla gelen ikinci isteğin aynı olup olmadığı anlaşılır.
 */
export function requestFingerprint(method: string, url: string, body: unknown): string {
  const payload = JSON.stringify([method.toUpperCase(), url, canonical(body ?? null)])
  return createHash('sha256').update(payload).digest('hex')
}
