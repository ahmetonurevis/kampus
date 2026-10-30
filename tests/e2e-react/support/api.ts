import { randomInt } from 'node:crypto'
import { join } from 'node:path'

import { request, type APIRequestContext } from '@playwright/test'

import { accounts, e2e, type RoleKey } from './env.ts'

/**
 * Her tarayıcı bağlamına/API oturumuna kendi sahte istemci IP'si verilir. Giriş ucu IP başına
 * dakikada 5 denemeyle sınırlıdır; test API'si yalnız burada `TRUST_PROXY=1` ile çalıştığı için
 * `X-Forwarded-For`'un son değeri istemci IP'si olur ve testler birbirinin sınırını tüketmez.
 * Üretim yapılandırmasına dokunulmaz.
 */
export function randomIp(): string {
  return `10.${randomInt(0, 256)}.${randomInt(0, 256)}.${randomInt(1, 255)}`
}

/** Yazma isteklerinin Origin denetimini geçmesi için web kökeni de gönderilir. */
export function clientHeaders(ip: string = randomIp()): Record<string, string> {
  return { origin: e2e.webOrigin, 'x-forwarded-for': ip }
}

/** Global kurulumun yazdığı rol başına oturum önbelleği (Playwright `storageState` biçimi). */
export function storageStatePath(role: RoleKey): string {
  return join(e2e.paths.artifacts, 'auth', `${role}.json`)
}

/** Kimlik: Akademi demo rolü ya da herhangi bir seed hesabı. */
export type Principal = RoleKey | { email: string }

export function principalEmail(principal: Principal): string {
  return typeof principal === 'string' ? accounts[principal].email : principal.email
}

export const SIGN_IN_PATH = '/api/v1/auth/sign-in/email'

/** Giriş gövdesi; hem API bağlamı hem tarayıcı bağlamının `request`'i kullanır. */
export function signInRequest(principal: Principal) {
  return {
    data: { email: principalEmail(principal), password: e2e.password },
    headers: clientHeaders(),
  }
}

export interface ApiResult<T = unknown> {
  status: number
  ok: boolean
  body: T
}

/**
 * API'yi doğrudan çağırır (arayüzden geçmeden). Gövde JSON ise çözülür, değilse metin döner.
 * Test verisi kurmak ve kalıcılığı doğrulamak içindir: kurulum UI'dan yapılmaz.
 */
export async function apiRequest(
  context: APIRequestContext,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  data?: unknown,
  headers?: Record<string, string>,
): Promise<ApiResult> {
  const response = await context.fetch(path, {
    method,
    ...(data === undefined ? {} : { data }),
    ...(headers ? { headers } : {}),
    failOnStatusCode: false,
  })
  const text = await response.text()
  let body: unknown = text
  try {
    body = text === '' ? null : JSON.parse(text)
  } catch {
    // JSON olmayan gövde metin olarak kalır.
  }
  return { status: response.status(), ok: response.ok(), body }
}

export interface ApiClient {
  /** Ham bağlam: çerez ve başlıklar burada. */
  context: APIRequestContext
  get: (path: string) => Promise<ApiResult>
  /** `headers`: isteğe özel başlıklar (ör. `Idempotency-Key`). */
  post: (path: string, data?: unknown, headers?: Record<string, string>) => Promise<ApiResult>
  patch: (path: string, data?: unknown) => Promise<ApiResult>
  put: (path: string, data?: unknown) => Promise<ApiResult>
  delete: (path: string) => Promise<ApiResult>
  dispose: () => Promise<void>
}

export function wrapContext(context: APIRequestContext): ApiClient {
  return {
    context,
    get: (path) => apiRequest(context, 'GET', path),
    post: (path, data, headers) => apiRequest(context, 'POST', path, data, headers),
    patch: (path, data) => apiRequest(context, 'PATCH', path, data),
    put: (path, data) => apiRequest(context, 'PUT', path, data),
    delete: (path) => apiRequest(context, 'DELETE', path),
    dispose: () => context.dispose(),
  }
}

/**
 * Giriş yapmış API bağlamı. `principal` verilmezse oturumsuzdur. Rol için varsayılan olarak
 * paylaşılan önbellek (salt okunur kullanım); oturumu değiştiren ya da kapatan testler `fresh`
 * ile kendi oturumunu açar.
 */
export async function createApiClient(
  principal: Principal | null,
  options: { fresh?: boolean } = {},
): Promise<ApiClient> {
  const headers = clientHeaders()
  const cached = typeof principal === 'string' && !options.fresh
  const context = await request.newContext({
    baseURL: e2e.apiOrigin,
    extraHTTPHeaders: headers,
    ...(cached ? { storageState: storageStatePath(principal) } : {}),
  })
  const client = wrapContext(context)
  if (principal !== null && !cached) {
    const { data } = signInRequest(principal)
    const result = await client.post(SIGN_IN_PATH, data)
    if (!result.ok) {
      await client.dispose()
      throw new Error(`Giriş başarısız (${principalEmail(principal)}): ${result.status}`)
    }
  }
  return client
}

/** Etkin kurumu API'den değiştirir (oturumu değiştirir: yalnız `fresh` oturumla kullanın). */
export async function switchInstitutionApi(
  client: ApiClient,
  institutionId: string,
): Promise<ApiResult> {
  return client.post('/api/v1/auth/organization/set-active', { organizationId: institutionId })
}
