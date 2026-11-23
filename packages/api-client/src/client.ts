import createClient, { type Client, type Middleware } from 'openapi-fetch'

import { apiErrorFromResponse, isApiError, networkApiError } from './errors.ts'
import type { paths } from './schema.d.ts'

export type KampusClient = Client<paths>

export interface KampusClientOptions {
  /**
   * API kökü (ör. `https://api.kampus.example`); `/api/v1` öneki yol şemasında zaten vardır.
   * Aynı kaynaktan sunuluyorsa boş dize.
   */
  baseUrl: string
  /** Web'de `include` (çerez oturumu), mobilde `omit` (oturum `getHeaders` ile gelir). */
  credentials: 'include' | 'omit' | 'same-origin'
  /** Test veya çatı için `fetch` yerine geçen işlev. */
  fetch?: typeof globalThis.fetch
  /** Mobil için `X-Client-Version`; sunucu desteklenmeyen sürüme 426 döner. */
  clientVersion?: string
  /** İstek başına eklenecek başlıklar (ör. mobilde Better Auth Expo istemcisinin `Cookie`'si). */
  getHeaders?: () => Record<string, string> | Promise<Record<string, string>>
  /** `X-Request-Id` üretici; yoksa `crypto.randomUUID` (varsa) kullanılır. */
  requestId?: () => string | undefined
}

function defaultRequestId(): string | undefined {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : undefined
}

/**
 * Hata dönüşümü ve başlık ara katmanı. Başarısız yanıtlar ve ağ hataları `ApiError` olarak
 * fırlatılır; böylece TanStack Query ve çağıranlar tek hata türüyle çalışır.
 *
 * CSRF için özel başlık yoktur: API, tarayıcının kendiliğinden gönderdiği `Origin` ve
 * `Sec-Fetch-Site` başlıklarını denetler (apps/api/src/plugins/csrf.ts). İstemci bu başlıkları
 * kurmaz veya taklit etmez; mobil yerel istemci `Origin` göndermediği için etkilenmez.
 */
function createMiddleware(options: KampusClientOptions): Middleware {
  const requestId = options.requestId ?? defaultRequestId
  return {
    async onRequest({ request }) {
      if (options.clientVersion !== undefined) {
        request.headers.set('X-Client-Version', options.clientVersion)
      }
      const id = requestId()
      if (id !== undefined && !request.headers.has('X-Request-Id')) {
        request.headers.set('X-Request-Id', id)
      }
      if (options.getHeaders) {
        for (const [name, value] of new Headers(await options.getHeaders())) {
          request.headers.set(name, value)
        }
      }
    },
    async onResponse({ response }) {
      if (response.ok) return
      // Gövde okunamıyorsa (boş, HTML) zarf yoktur; `apiErrorFromResponse` genel hata üretir.
      const body: unknown = await response
        .clone()
        .json()
        .catch(() => undefined)
      throw apiErrorFromResponse(response.status, body, response.headers.get('X-Request-Id'))
    },
    onError({ error }) {
      // İptal (AbortController, sorgu iptali) ağ hatası değildir; olduğu gibi geçer.
      if (isApiError(error) || (error instanceof Error && error.name === 'AbortError')) return
      return networkApiError(error)
    },
  }
}

/**
 * Tipli API istemcisi (`openapi-fetch`). Uç başına fonksiyon yoktur:
 * `client.GET('/api/v1/me')`, `client.POST('/api/v1/…', { body })`. Hatalar `ApiError` fırlatır.
 */
export function createKampusClient(options: KampusClientOptions): KampusClient {
  const client = createClient<paths>({
    baseUrl: options.baseUrl,
    credentials: options.credentials,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  })
  client.use(createMiddleware(options))
  return client
}

/**
 * Çağrı sonucundan `data`'yı çıkarır. Başarısız yanıt ara katmanda `ApiError` fırlattığı için
 * `error` normalde boştur; yine de gelirse aynı hata türüne çevrilir. Gövdesiz başarıda (204)
 * `undefined` döner.
 */
export function unwrap<TData>(result: {
  data?: TData
  error?: unknown
  response: Response
}): TData {
  if (result.error !== undefined) {
    throw apiErrorFromResponse(
      result.response.status,
      result.error,
      result.response.headers.get('X-Request-Id'),
    )
  }
  // `data` yalnız gövdesiz başarıda (204) tanımsızdır; çağıran bu uçta `void` bekler.
  return result.data as TData
}
