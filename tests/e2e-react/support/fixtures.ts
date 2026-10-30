import { readFileSync } from 'node:fs'

import { expect, test as base, type Page } from '@playwright/test'

import {
  clientHeaders,
  createApiClient,
  principalEmail,
  randomIp,
  SIGN_IN_PATH,
  signInRequest,
  storageStatePath,
  type ApiClient,
  type Principal,
} from './api.ts'

export interface LoginOptions {
  /**
   * Rol için paylaşılan önbellek yerine yeni oturum açar. Oturumu değiştiren (kurum değiştirme,
   * çıkış, parola) ya da sunucuda yazan testler bunu kullanır; paylaşılan oturum salt okunurdur.
   * Rol dışı hesaplar (`{ email }`) her zaman yeni oturum açar.
   */
  fresh?: boolean
}

interface Fixtures {
  /**
   * Testin kendi bağlamına oturum çerezini koyar ve sayfayı döndürür. Varsayılan: rol başına
   * global kurulumda alınmış oturum (giriş ucuna yük bindirmez).
   */
  loginAs: (principal: Principal, options?: LoginOptions) => Promise<Page>
  /** Doğrudan API istemcisi (test verisi kurma ve kalıcılığı doğrulama). `null`: oturumsuz. */
  api: (principal: Principal | null, options?: LoginOptions) => Promise<ApiClient>
}

export const test = base.extend<Fixtures>({
  // Her test bağlamı kendi sahte IP'sini taşır (hız sınırı kovası ayrılır; bkz. api.ts).
  // Playwright fixture bağımlılıklarını ilk parametrenin desenine bakarak çözer: boş desen şarttır.
  // eslint-disable-next-line no-empty-pattern
  extraHTTPHeaders: async ({}, use) => {
    await use(clientHeaders(randomIp()))
  },

  loginAs: async ({ context, page }, use) => {
    await use(async (principal, options = {}) => {
      if (typeof principal === 'string' && !options.fresh) {
        const state = JSON.parse(readFileSync(storageStatePath(principal), 'utf8')) as {
          cookies: Parameters<typeof context.addCookies>[0]
        }
        await context.addCookies(state.cookies)
        return page
      }
      // `context.request` tarayıcı bağlamının çerez kabını paylaşır: oturum çerezi doğrudan oraya yazılır.
      const { data, headers } = signInRequest(principal)
      const response = await context.request.post(SIGN_IN_PATH, {
        data,
        headers,
        failOnStatusCode: false,
      })
      expect(response.ok(), `giriş: ${principalEmail(principal)}`).toBe(true)
      return page
    })
  },

  // eslint-disable-next-line no-empty-pattern
  api: async ({}, use) => {
    const clients: ApiClient[] = []
    await use(async (principal, options) => {
      const client = await createApiClient(principal, options)
      clients.push(client)
      return client
    })
    await Promise.all(clients.map((client) => client.dispose()))
  },
})

export { expect }
