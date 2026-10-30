import { randomUUID } from 'node:crypto'

import type { Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'

// Ayarlar → Kurum & Modüller (DOM-YTK-040, DOM-YTK-042). Her test kendi kurumunu kurar (`tenant`);
// modül ayarı kuruma özgü olduğu için seed kurumlarına dokunulmaz.

const MEALS = 'Yemek Menüsü'

interface ModuleSettings {
  data: { version: number; modules: { key: string; enabled: boolean }[] }
}

async function settingsOf(client: ApiClient): Promise<ModuleSettings['data']> {
  const result = await client.get('/api/v1/modules')
  expect(result.status).toBe(200)
  return (result.body as ModuleSettings).data
}

/** Başka bir yönetici oturumunun modül değiştirmesi (ayar sürümünü artırır). */
async function closeViaApi(client: ApiClient, moduleKey: string, version: number) {
  const response = await client.context.patch(`/api/v1/modules/${moduleKey}`, {
    data: { enabled: false },
    headers: { 'if-match': `"${version}"`, 'idempotency-key': randomUUID() },
  })
  expect(response.status()).toBe(200)
}

/** Menü kategorisini açar (kapalıysa); açık kategori tıklamayla kapanmasın. */
async function openMenuGroup(page: Page, name: string) {
  const group = page.getByRole('navigation', { name: 'Menü' }).getByRole('button', { name })
  if ((await group.getAttribute('aria-expanded')) === 'false') await group.click()
}

test.describe('kurum modülleri', () => {
  test('yönetici modülü kapatır, menüden ve adresten kaybolur; yeniden açınca geri gelir', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici'] })
    const page = await loginAs(school.user('yonetici'))
    const admin = await api(school.user('yonetici'))
    const menu = page.getByRole('navigation', { name: 'Menü' })

    await page.goto('/yonetici/ayarlar')
    await expect(page.getByRole('button', { name: 'Kurum & Modüller' })).toBeVisible()
    const toggle = page.getByRole('switch', { name: MEALS })
    await expect(toggle).toBeChecked()
    await openMenuGroup(page, 'Okul yaşamı')
    await expect(menu.getByRole('link', { name: MEALS })).toBeVisible()

    // Kapatma onay ister; vazgeçmek hiçbir şeyi değiştirmez.
    await toggle.click()
    const confirm = page.getByRole('dialog', { name: `${MEALS} modülünü kapat` })
    await expect(
      confirm.getByText('Modül kapanınca menü ve sayfaları gizlenir, veriler silinmez.'),
    ).toBeVisible()
    await confirm.getByRole('button', { name: 'Vazgeç' }).click()
    await expect(confirm).toHaveCount(0)
    await expect(toggle).toBeChecked()
    expect((await settingsOf(admin)).version).toBe(1)

    await toggle.click()
    await confirm.getByRole('button', { name: 'Modülü kapat' }).click()
    await expect(page.getByText(`${MEALS} modülü kapatıldı.`)).toBeVisible()
    await expect(toggle).not.toBeChecked()
    // Menü sayfa yenilenmeden güncellenir (oturumdaki enabledModules tazelendi).
    await expect(menu.getByRole('link', { name: MEALS })).toHaveCount(0)
    const closed = await settingsOf(admin)
    expect(closed.version).toBe(2)
    expect(closed.modules.find((item) => item.key === 'meals')?.enabled).toBe(false)
    expect((await admin.get('/api/v1/collections/mealMenus')).status).toBe(403)

    // Doğrudan adres kapalı modülü açmaz.
    await page.goto('/yonetici/yemek-menusu')
    await expect(page.getByRole('heading', { name: 'Modül kullanıma kapalı' })).toBeVisible()
    await page.goto('/yonetici/ayarlar')

    await page.getByRole('switch', { name: MEALS }).click()
    await expect(page.getByText(`${MEALS} modülü açıldı.`)).toBeVisible()
    await expect(page.getByRole('switch', { name: MEALS })).toBeChecked()
    await openMenuGroup(page, 'Okul yaşamı')
    await expect(menu.getByRole('link', { name: MEALS })).toBeVisible()
    expect((await admin.get('/api/v1/collections/mealMenus')).status).toBe(200)
    await page.goto('/yonetici/yemek-menusu')
    await expect(page.getByRole('heading', { name: 'Modül kullanıma kapalı' })).toHaveCount(0)
  })

  test('başka yönetici araya girerse 409: Türkçe mesaj gösterilir, liste yenilenir', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici'] })
    const page = await loginAs(school.user('yonetici'))
    const other = await api(school.user('yonetici'), { fresh: true })

    await page.goto('/yonetici/ayarlar')
    await expect(page.getByRole('switch', { name: MEALS })).toBeChecked()
    // Ekran sürüm 1'i bilir; araya giren değişiklik sürümü 2 yapar.
    await closeViaApi(other, 'clubs', 1)

    await page.getByRole('switch', { name: MEALS }).click()
    await page
      .getByRole('dialog', { name: `${MEALS} modülünü kapat` })
      .getByRole('button', { name: 'Modülü kapat' })
      .click()
    await expect(page.getByText(/başka biri değiştirdi/)).toBeVisible()
    // Hiçbir şey yazılmadı; liste başkasının değişikliğini gösterir.
    await expect(page.getByRole('switch', { name: 'Kulüpler & Sosyal Gelişim' })).not.toBeChecked()
    await expect(page.getByRole('switch', { name: MEALS })).toBeChecked()
    const current = await settingsOf(other)
    expect(current.version).toBe(2)
    expect(current.modules.find((item) => item.key === 'meals')?.enabled).toBe(true)
  })

  test('yönetici olmayan kullanıcı bölümü ve API ucunu göremez', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici', 'onburo', 'ogrenci'] })
    for (const role of ['onburo', 'ogrenci'] as const) {
      const page = await loginAs(school.user(role))
      await page.goto(`/${role}/ayarlar`)
      await expect(page.getByRole('switch')).toHaveCount(0)
      await expect(page.getByText('Modül yönetimi')).toHaveCount(0)
      expect((await (await api(school.user(role))).get('/api/v1/modules')).status).toBe(403)
    }
  })
})
