// API modunun istemcileri: Better Auth (Expo eklentisi), tipli API istemcisi ve sorgu önbelleği.
// Yalnız API modunda yüklenir (`ApiApp`); demo modu bu dosyayı hiç çalıştırmaz.
import { Platform } from 'react-native'
import Constants from 'expo-constants'
import * as SecureStore from 'expo-secure-store'
import { createAuthClient } from 'better-auth/react'
import { expoClient } from '@better-auth/expo/client'
import { kampusAuthClientOptions } from '@kampus/api-client/auth.ts'
import { createKampusClient } from '@kampus/api-client/client.ts'
import { createKampusQueryClient } from '@kampus/react-shared/query-client.ts'
import { recordError } from '../lib/error-log.ts'
import { nativeAuthHeaders } from './session-state.ts'

/** app.json `scheme`; standart derlemede kök `kampus://` olur (API `TRUSTED_ORIGINS`). */
export const APP_SCHEME = 'kampus'
/** API çerez öneki (`advanced.cookiePrefix`, apps/api/src/auth.ts). */
const COOKIE_PREFIX = 'kampus'

/**
 * Better Auth Expo istemcisi. Yerel uygulamada oturum çerezi yalnız `expo-secure-store`'da
 * (Android Keystore) saklanır ve her istekte `Cookie` başlığıyla gönderilir; AsyncStorage'a
 * belirteç yazılmaz. Web derlemesinde eklenti devre dışıdır, oturum tarayıcının HttpOnly
 * çerezindedir.
 */
export function createApiAuthClient(baseUrl: string) {
  const options = kampusAuthClientOptions(baseUrl)
  return createAuthClient({
    ...options,
    plugins: [
      ...options.plugins,
      expoClient({
        scheme: APP_SCHEME,
        storagePrefix: COOKIE_PREFIX,
        cookiePrefix: COOKIE_PREFIX,
        storage: SecureStore,
      }),
    ],
  })
}

export type ApiAuthClient = ReturnType<typeof createApiAuthClient>

/**
 * Better Auth oturum durumunu sunucudan yeniden okur. Herhangi bir API isteği 401 alınca
 * çağrılır: oturum sunucuda bitmişse durum `null` olur ve uygulama girişe döner.
 */
export function refreshAuthSession(authClient: ApiAuthClient): Promise<void> {
  const state: unknown = authClient.$store.atoms.session?.get()
  const refetch =
    typeof state === 'object' && state !== null ? Reflect.get(state, 'refetch') : undefined
  if (typeof refetch === 'function') return Promise.resolve(refetch()).then(() => undefined)
  authClient.$store.notify('$sessionSignal')
  return Promise.resolve()
}

export function createApiClients(baseUrl: string) {
  const authClient = createApiAuthClient(baseUrl)
  const isWeb = Platform.OS === 'web'
  const apiClient = createKampusClient({
    baseUrl,
    // Yerelde çerez kavanozu yoktur; oturum güvenli depodan başlıkla gelir.
    credentials: isWeb ? 'include' : 'omit',
    ...(Constants.expoConfig?.version ? { clientVersion: Constants.expoConfig.version } : {}),
    ...(isWeb ? {} : { getHeaders: async () => nativeAuthHeaders(await authClient.getCookie()) }),
  })
  const queryClient = createKampusQueryClient({
    onUnauthenticated: () => {
      refreshAuthSession(authClient).catch((error: unknown) =>
        recordError(error, 'auth-refresh', 'warn'),
      )
    },
  })
  return { authClient, apiClient, queryClient }
}

export type ApiClients = ReturnType<typeof createApiClients>
