import { randomUUID } from 'node:crypto'

import type { Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { accounts } from './support/env.ts'
import { expect, test } from './support/fixtures.ts'
import { expectEveryRow, expectNoHorizontalOverflow } from './support/ui.ts'

// Ayarlar → Kullanıcı & Yetkiler ve İşlem Geçmişi (yalnız yönetici; DOM-YTK-053). Her test kendi
// kurumunu kurar (`tenant`): kullanıcı sayısı ve işlem kayıtları başka testten etkilenmez.

const USERS_URL = '/yonetici/ayarlar?sekme=kullanicilar'
const ACTIVITY_URL = '/yonetici/ayarlar?sekme=gecmis'
const MODULE_ACTION = 'Modül açıldı veya kapatıldı'

const usersTable = (page: Page) => page.getByRole('table', { name: 'Kurum kullanıcıları' })
const resultCount = (page: Page) => page.locator('.result-count')
const auditTable = (page: Page) => page.getByRole('table', { name: 'Kurum işlem geçmişi' })

/** Yönetici adına bir işlem üretir: modül kapatır (ayar sürümü 1'den başlar). */
async function closeMeals(client: ApiClient) {
  const response = await client.context.patch('/api/v1/modules/meals', {
    data: { enabled: false },
    headers: { 'if-match': '"1"', 'idempotency-key': randomUUID() },
  })
  expect(response.status()).toBe(200)
}

test.describe('ayarlar: kullanıcılar ve işlem geçmişi', () => {
  test('yönetici yalnız kendi kurumunun kullanıcılarını görür ve rol süzgeciyle daraltır', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici', 'ogretmen', 'ogrenci', 'veli'] })
    const other = await tenant({ roles: ['yonetici', 'veli'] })
    const page = await loginAs(school.user('yonetici'))

    await page.goto(USERS_URL)
    await expect(page.getByRole('heading', { name: 'Kurum kullanıcıları' })).toBeVisible()
    await expect(page.getByText('4 kullanıcı')).toBeVisible()
    for (const role of ['yonetici', 'ogretmen', 'ogrenci', 'veli'] as const) {
      await expect(usersTable(page).getByText(school.user(role).email)).toBeVisible()
    }
    // Başka kurumun hesabı bu listede yoktur.
    await expect(usersTable(page).getByText(other.user('veli').email)).toHaveCount(0)

    await page.getByLabel('Rol filtresi').selectOption('veli')
    await expect(page).toHaveURL(/[?&]kul-rol=veli/)
    await expect(page.getByText('1 kullanıcı')).toBeVisible()
    await expectEveryRow(usersTable(page).locator('tbody tr td:nth-child(2)'), 'Veli', true)
    await expect(usersTable(page).getByText(accounts.veli.name)).toBeVisible()

    // Süzgeç adresten yeniden kurulur ve temizlenince liste eski haline döner.
    await page.reload()
    await expect(page.getByLabel('Rol filtresi')).toHaveValue('veli')
    await page.getByRole('button', { name: 'Aramayı ve filtreleri temizle' }).click()
    await expect(page.getByText('4 kullanıcı')).toBeVisible()

    // Arama sunucuda yapılır; kısa metin süzmez.
    await page.getByLabel('Tabloda ara').fill(school.user('ogretmen').email)
    await expect(page.getByText('1 kullanıcı')).toBeVisible()
    await expectEveryRow(usersTable(page).locator('tbody tr'), accounts.ogretmen.name)
  })

  test('kullanıcı ayrıntısı sağ panelde açılır ve işlem geçmişine bağlanır', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici', 'ogrenci'] })
    const page = await loginAs(school.user('yonetici'))
    await closeMeals(await api(school.user('yonetici'), { fresh: true }))

    await page.goto(USERS_URL)
    await page.getByRole('button', { name: `${accounts.ogrenci.name} ayrıntısı` }).click()
    const panel = page.getByRole('dialog', { name: 'Kullanıcı ayrıntısı' })
    await expect(panel.getByText(school.user('ogrenci').email)).toBeVisible()
    await expect(page).toHaveURL(/[?&]kullanici=/)
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)

    // Yöneticinin panelinden "İşlem geçmişini gör": yapan süzgeci kurulur, yalnız onun kayıtları gelir.
    await page.getByRole('button', { name: `${accounts.yonetici.name} ayrıntısı` }).click()
    await panel.getByRole('link', { name: 'İşlem geçmişini gör' }).click()
    await expect(page).toHaveURL(/[?&]sekme=gecmis/)
    await expect(page).toHaveURL(/[?&]gecmis-yapan=/)
    await expect(page.getByRole('button', { name: /Yapan filtresini kaldır/ })).toBeVisible()
    await expectEveryRow(
      auditTable(page).locator('tbody tr td:nth-child(4)'),
      accounts.yonetici.name,
    )
    await expect(auditTable(page).getByText(MODULE_ACTION)).toBeVisible()
  })

  test('yönetici modül kapatır; işlem geçmişinde yapan kişiyle görünür, giriş olayı yoktur', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici', 'ogrenci'] })
    // İki giriş: yönetici ve öğrenci (kimlik olayları üretir).
    await loginAs(school.user('ogrenci'), { fresh: true })
    const page = await loginAs(school.user('yonetici'), { fresh: true })
    const admin = await api(school.user('yonetici'), { fresh: true })
    await closeMeals(admin)

    await page.goto(ACTIVITY_URL)
    const rows = auditTable(page).locator('tbody tr')
    await expectEveryRow(rows, [MODULE_ACTION, accounts.yonetici.name])
    await expect(rows).toHaveCount(1)
    await expect(resultCount(page)).toContainText('/ 1 kayıt')
    // Giriş/çıkış/parola olayları işlem geçmişinde ve API yanıtında yer almaz (güvenlik kaydı).
    await expect(page.getByText(/auth\.|Giriş yapıldı|Oturum/)).toHaveCount(0)
    const result = await admin.get('/api/v1/audit-events?pageSize=100')
    expect(result.status).toBe(200)
    expect(JSON.stringify(result.body)).not.toContain('auth.')

    // Satırdan ayrıntı paneli: işlem adı, varlık ve alan adı; değer yok.
    await rows.first().getByRole('button', { name: MODULE_ACTION, exact: true }).click()
    const panel = page.getByRole('dialog', { name: 'İşlem kaydı' })
    await expect(panel.getByText('module.set')).toBeVisible()
    await expect(panel.getByText('enabledModules')).toBeVisible()
    await expect(panel.getByText(accounts.yonetici.name)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)

    // Varlık türü süzgeci ve gün süzgeci: gelecekteki gün boş sonuç verir.
    await page.getByLabel('Varlık türü filtresi').selectOption('module')
    await expect(rows).toHaveCount(1)
    await page.getByLabel('Varlık türü filtresi').selectOption('invoices')
    await expect(page.getByText('Bu süzgeçlere uyan işlem kaydı yok.')).toBeVisible()
    // Boş sonuç durumunda iki temizle düğmesi bulunur (araç çubuğu ve boş durum); araç çubuğunu kullan.
    await page
      .locator('.toolbar-filters')
      .getByRole('button', { name: 'Aramayı ve filtreleri temizle' })
      .click()
    await expect(rows).toHaveCount(1)
    await page.getByLabel('Başlangıç günü').fill('2099-01-01')
    await expect(page.getByText('Bu süzgeçlere uyan işlem kaydı yok.')).toBeVisible()
    // Başlangıç bitişten sonraysa sunucuya gitmez, Türkçe uyarı çıkar.
    await page.getByLabel('Bitiş günü').fill('2098-01-01')
    await expect(page.getByText('Başlangıç günü bitiş gününden sonra olamaz.')).toBeVisible()
  })

  test('yönetici olmayan roller sekmeleri görmez, uçlar 403 verir', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici', 'ogretmen', 'ogrenci', 'veli'] })
    for (const role of ['ogrenci', 'veli'] as const) {
      const page = await loginAs(school.user(role))
      await page.goto(`/${role}/ayarlar?sekme=kullanicilar`)
      await expect(page.getByRole('heading', { name: 'Ayarlar', level: 1 })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Kullanıcı & Yetkiler' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'İşlem Geçmişi' })).toHaveCount(0)
      await expect(page.getByRole('table')).toHaveCount(0)
      await expect(page.getByRole('switch')).toHaveCount(0)
      // Bildirim tercihi için depo yok; sayfa bunu açıkça söyler. Tema düğmeleri korunur.
      await expect(page.getByText(/Bildirim tercihleri bildirim merkeziyle gelecek/)).toBeVisible()
      await page.getByRole('button', { name: 'Koyu', exact: true }).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
      await page.getByRole('button', { name: 'Açık', exact: true }).click()
      await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark')
    }
    for (const role of ['ogretmen', 'ogrenci', 'veli'] as const) {
      const client = await api(school.user(role))
      expect((await client.get('/api/v1/institution-members')).status, role).toBe(403)
      expect((await client.get('/api/v1/audit-events')).status, role).toBe(403)
    }
    // Öğretmen yönetici sayfasını adresten açsa da sekmeler gelmez.
    const teacher = await loginAs(school.user('ogretmen'))
    await teacher.goto(USERS_URL)
    await expect(teacher.getByRole('button', { name: 'Kullanıcı & Yetkiler' })).toHaveCount(0)
    await expect(teacher.getByRole('table')).toHaveCount(0)
  })

  test('390 px genişlikte iki sekme de yatay taşmaz', async ({ loginAs, api, tenant }) => {
    const school = await tenant({ roles: ['yonetici', 'ogretmen', 'ogrenci', 'veli'] })
    await closeMeals(await api(school.user('yonetici'), { fresh: true }))
    const page = await loginAs(school.user('yonetici'))
    await page.setViewportSize({ width: 390, height: 844 })

    await page.goto(USERS_URL)
    await expect(page.getByText('4 kullanıcı')).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.goto(ACTIVITY_URL)
    await expect(resultCount(page)).toContainText('/ 1 kayıt')
    await expectNoHorizontalOverflow(page)
  })
})
