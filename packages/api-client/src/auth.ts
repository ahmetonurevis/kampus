import { organizationClient } from 'better-auth/client/plugins'

/**
 * Better Auth istemcisinin platformdan bağımsız ortak yapılandırması. İstemciyi kuran
 * `createAuthClient` platforma özgüdür ve tüketicide kalır:
 *
 * - Web: `createAuthClient` (`better-auth/react`)
 * - Mobil: `createAuthClient` (`better-auth/react`) + `plugins: [...kampusAuthPlugins(), expoClient(…)]`
 *   (`@better-auth/expo/client`; oturum güvenli depoda saklanır)
 *
 * Better Auth sürümü apps/api ile aynıdır (1.7.10). Sunucudaki uç yüzeyi izin listesidir
 * (`OPEN_AUTH_PATHS`, apps/api/src/auth.ts): `useActiveOrganization`, üye/davet listeleri gibi
 * kapalı uçlara giden çağrılar 404 alır. Etkin kurum, üyelik ve rol `GET /api/v1/me` ile okunur;
 * kurum değiştirme `organization.setActive` iledir.
 */
export const AUTH_BASE_PATH = '/api/v1/auth'

/** Kurum (organization) eklentisinin istemci karşılığı; mobil kendi eklentisini bunlara ekler. */
export function kampusAuthPlugins() {
  return [organizationClient()]
}

/**
 * `createAuthClient` seçenekleri. `baseUrl` API kökü (`/api/v1/auth` öneki olmadan).
 * Aynı kaynaktan sunulan webde boş dize verilebilir.
 */
export function kampusAuthClientOptions(baseUrl: string) {
  return {
    baseURL: baseUrl,
    basePath: AUTH_BASE_PATH,
    plugins: kampusAuthPlugins(),
  }
}
