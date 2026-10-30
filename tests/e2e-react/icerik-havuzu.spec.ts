import { randomUUID } from 'node:crypto'

import type { Locator, Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// İçerik havuzu (DOM-KYN-020, 025; DOM-YTK-021): öğretmen okuma parçası taslağı yazar ve onaya
// gönderir, yönetici onaylar ya da gerekçeyle reddeder. Her test kendi kurumunu kurar (`tenant`);
// sunucuda yazan işlemler seed kurumlarına dokunmaz. Ders/kazanım kataloğu yok: kazanım kodu
// serbest yazılır (TODO(katalog)).

const BODY =
  'The old lighthouse stood at the edge of the village. Every evening the keeper climbed the long ' +
  'stairs, lit the lamp and watched the sea until sunrise. Children often asked him whether he was ' +
  'afraid of the dark, and he always smiled and said that the light was his best friend.'

interface DraftOptions {
  title: string
  body?: string
  /** Telif beyanı kutusunu işaretler (varsayılan: evet). */
  declare?: boolean
}

const formDialog = (page: Page) => page.getByRole('dialog', { name: 'Yeni içerik' })
const rows = (page: Page) => page.getByRole('table', { name: 'İçerik havuzu' }).locator('tbody tr')
const toasts = (page: Page) => page.locator('[data-sonner-toast]')

/** Yeni içerik formunu okul kurumu için eksiksiz okuma parçası olarak doldurur ve kaydeder. */
async function createReadingDraft(page: Page, options: DraftOptions) {
  await page.getByRole('button', { name: 'Yeni içerik' }).click()
  const dialog = formDialog(page)
  await dialog.getByLabel('Başlık').fill(options.title)
  await dialog.getByLabel('Okuma metni').fill(options.body ?? BODY)
  await dialog.getByLabel('Ders').selectOption({ label: 'İngilizce' })
  await dialog.getByLabel('9. sınıf', { exact: true }).check()
  await dialog.getByLabel('CEFR düzeyi').selectOption('B1')
  await dialog.getByLabel('Birincil beceri').selectOption('reading')
  await dialog.getByRole('button', { name: 'Kazanım ekle' }).click()
  await dialog.getByLabel('1. kazanım kodu').fill('ENG.9.READ.1')
  await dialog.getByLabel('Menşe ve lisans').selectOption('institution_original')
  if (options.declare ?? true) await dialog.getByLabel(/Bu içeriği kullanma hakkım var/).check()
  await dialog.getByRole('button', { name: 'Taslağı kaydet' }).click()
}

/** Kaydedilen taslağın paneli açılır; "Onaya gönder" ile incelemeye alınır. */
async function submitForReview(page: Page, title: string) {
  const panel = page.getByRole('dialog', { name: title })
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: 'Onaya gönder' }).click()
  await expect(panel.getByText('İncelemede').first()).toBeVisible()
  return panel
}

interface ModuleSettings {
  data: { version: number }
}

async function closeModule(client: ApiClient, moduleKey: string) {
  const settings = await client.get('/api/v1/modules')
  expect(settings.status).toBe(200)
  const response = await client.context.patch(`/api/v1/modules/${moduleKey}`, {
    data: { enabled: false },
    headers: {
      'if-match': `"${(settings.body as ModuleSettings).data.version}"`,
      'idempotency-key': randomUUID(),
    },
  })
  expect(response.status()).toBe(200)
}

/** Menü kategorisini açar (kapalıysa); açık kategori tıklamayla kapanmasın. */
async function openLearningGroup(page: Page) {
  const group = page.getByRole('navigation', { name: 'Menü' }).getByRole('button', {
    name: /öğrenme/i,
  })
  // Menü yüklenmeden sayma yapılmasın; kategorideki bütün sayfalar kapanınca kategori de kalkar.
  await expect(
    page.getByRole('navigation', { name: 'Menü' }).getByRole('link').first(),
  ).toBeVisible()
  if ((await group.count()) === 0) return
  if ((await group.getAttribute('aria-expanded')) === 'false') await group.click()
}

const rowOf = (page: Page, title: string): Locator => rows(page).filter({ hasText: title })

test.describe('içerik havuzu: yazar ve onay akışı', () => {
  test('öğretmen taslak yazıp onaya gönderir, yönetici onaylar, içerik yayında görünür (DOM-KYN-020)', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici', 'ogretmen'] })
    const title = 'Deniz feneri okuma parçası'
    await loginAs(school.user('ogretmen'))
    await page.goto('/ogretmen/icerik-havuzu')
    await expect(page.getByRole('heading', { name: 'İçerik Havuzu', level: 1 })).toBeVisible()
    await expect(page.getByText('Henüz içerik yok.')).toBeVisible()

    await createReadingDraft(page, { title })
    await expect(toasts(page).filter({ hasText: 'Taslak kaydedildi.' })).toBeVisible()
    const panel = await submitForReview(page, title)
    await expect(panel.getByText('Okuma parçası').first()).toBeVisible()
    // Kendi onay bekleyen içeriğini onaylayamaz.
    await expect(panel.getByRole('button', { name: 'Onayla' })).toHaveCount(0)

    await loginAs(school.user('yonetici'), { fresh: true })
    await page.goto('/yonetici/icerik-havuzu')
    await expect(rowOf(page, title)).toContainText('İncelemede')
    await page.getByRole('button', { name: title, exact: true }).click()
    const adminPanel = page.getByRole('dialog', { name: title })
    await adminPanel.getByRole('button', { name: 'Onayla' }).click()
    await expect(adminPanel.getByText('Yayında').first()).toBeVisible()
    await adminPanel.getByRole('button', { name: 'Kapat' }).click()
    await expect(rowOf(page, title)).toContainText('Yayında')
  })

  test('yönetici gerekçe yazarak reddeder, öğretmen gerekçeyi görür', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici', 'ogretmen'] })
    const title = 'Reddedilecek okuma parçası'
    const reason = 'Metin B1 düzeyine göre fazla uzun; sadeleştirip yeniden gönderin.'
    await loginAs(school.user('ogretmen'))
    await page.goto('/ogretmen/icerik-havuzu')
    await createReadingDraft(page, { title })
    await submitForReview(page, title)

    await loginAs(school.user('yonetici'), { fresh: true })
    await page.goto('/yonetici/icerik-havuzu')
    await page.getByRole('button', { name: title, exact: true }).click()
    await page
      .getByRole('dialog', { name: title })
      .getByRole('button', { name: 'Reddet', exact: true })
      .click()
    const rejectDialog = page.getByRole('dialog', { name: 'İçeriği reddet' })
    // Gerekçe boşken alan altında uyarı çıkar, istek gitmez.
    await rejectDialog.getByRole('button', { name: 'Reddet', exact: true }).click()
    await expect(rejectDialog.getByLabel('Ret gerekçesi')).toHaveAttribute('aria-invalid', 'true')
    await expect(toasts(page)).toHaveCount(0)
    await rejectDialog.getByLabel('Ret gerekçesi').fill(reason)
    await rejectDialog.getByRole('button', { name: 'Reddet', exact: true }).click()
    await expect(rejectDialog).toBeHidden()
    // Reddedilen taslak yalnız yazarının görebileceği taslağa döner (DOM-KYN-052): panel kapanır.
    await expect(page.getByRole('dialog', { name: title })).toBeHidden()
    await expect(rowOf(page, title)).toHaveCount(0)

    await loginAs(school.user('ogretmen'), { fresh: true })
    await page.goto('/ogretmen/icerik-havuzu')
    await page.getByRole('button', { name: title, exact: true }).click()
    const panel = page.getByRole('dialog', { name: title })
    await expect(panel.getByRole('note', { name: 'Ret gerekçesi' })).toContainText(reason)
    // Reddedilen taslak yazarın elinde düzenlenir ve yeniden gönderilir.
    await expect(panel.getByRole('button', { name: 'Düzenle' })).toBeVisible()
  })
})

test.describe('içerik havuzu: form doğrulaması', () => {
  test('zorunlu alanlar boşken hata alanın altında görünür, toast çıkmaz', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici', 'ogretmen'] })
    await loginAs(school.user('ogretmen'))
    await page.goto('/ogretmen/icerik-havuzu')
    await page.getByRole('button', { name: 'Yeni içerik' }).click()
    const dialog = formDialog(page)
    await dialog.getByLabel(/Bu içeriği kullanma hakkım var/).check()
    await dialog.getByRole('button', { name: 'Taslağı kaydet' }).click()

    await expect(dialog.getByLabel('Başlık')).toHaveAttribute('aria-invalid', 'true')
    await expect(dialog.getByLabel('Okuma metni')).toHaveAttribute('aria-invalid', 'true')
    await expect(dialog.getByLabel('Menşe ve lisans')).toHaveAttribute('aria-invalid', 'true')
    await expect(dialog.getByText('Menşe ve lisans türünü seçin.')).toBeVisible()
    await expect(toasts(page)).toHaveCount(0)
    await expect(dialog).toBeVisible()
  })

  test('telif beyanı onaylanmadan taslak kaydedilmez (DOM-KYN-025)', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici', 'ogretmen'] })
    await loginAs(school.user('ogretmen'))
    await page.goto('/ogretmen/icerik-havuzu')
    const writes: string[] = []
    page.on('request', (request) => {
      if (request.method() !== 'GET' && request.url().includes('/resources')) {
        writes.push(request.url())
      }
    })

    await createReadingDraft(page, { title: 'Beyansız içerik', declare: false })
    const dialog = formDialog(page)
    await expect(
      dialog.getByRole('alert').filter({ hasText: 'telif beyanını onaylayın' }),
    ).toBeVisible()
    await expect(dialog).toBeVisible()
    expect(writes).toEqual([])
    await expect(page.getByText('Henüz içerik yok.')).toBeVisible()

    await dialog.getByLabel(/Bu içeriği kullanma hakkım var/).check()
    await dialog.getByRole('button', { name: 'Taslağı kaydet' }).click()
    await expect(page.getByRole('dialog', { name: 'Beyansız içerik' })).toBeVisible()
    expect(writes.length).toBeGreaterThan(0)
  })
})

test.describe('içerik havuzu: erişim', () => {
  test('öğrenci, veli ve ön büro menüde içerik havuzunu görmez, adres bulunamadı der', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici', 'onburo', 'ogrenci', 'veli'] })
    for (const role of ['ogrenci', 'veli', 'onburo'] as const) {
      await loginAs(school.user(role), { fresh: true })
      await page.goto(`/${role}/dashboard`)
      const menu = page.getByRole('navigation', { name: 'Menü' })
      await expect(menu.getByRole('link').first()).toBeVisible()
      await expect(menu.getByRole('link', { name: 'İçerik Havuzu' })).toHaveCount(0)
      await page.goto(`/${role}/icerik-havuzu`)
      await expect(
        page.getByRole('heading', { level: 1, name: 'Bu sayfa kampüste bulunamadı.' }),
      ).toBeVisible()
      await expect(page.getByRole('button', { name: 'Yeni içerik' })).toHaveCount(0)
    }
  })

  test('öğrenme modülü kapanınca menü ve adres kapanır, API 403 verir', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici', 'ogretmen'] })
    const admin = await api(school.user('yonetici'))
    const teacher = await api(school.user('ogretmen'))
    expect((await teacher.get('/api/v1/resources')).status).toBe(200)

    await loginAs(school.user('ogretmen'))
    await page.goto('/ogretmen/dashboard')
    await openLearningGroup(page)
    const link = page.getByRole('navigation', { name: 'Menü' }).getByRole('link', {
      name: 'İçerik Havuzu',
    })
    await expect(link).toBeVisible()

    await closeModule(admin, 'learning')
    await page.goto('/ogretmen/icerik-havuzu')
    await expect(page.getByText('Bu modül kurum ayarlarından kapatılmış.')).toBeVisible()
    await expect(page).toHaveURL(/\/ogretmen\/dashboard/)
    await openLearningGroup(page)
    await expect(link).toHaveCount(0)
    expect((await teacher.get('/api/v1/resources')).status).toBe(403)
  })
})

test.describe('içerik havuzu: liste', () => {
  test('arama Türkçe karakterleri katlar, süzgeç çalışır, boş durum temizlenir', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici', 'ogretmen'] })
    await loginAs(school.user('ogretmen'))
    await page.goto('/ogretmen/icerik-havuzu')
    await createReadingDraft(page, { title: 'Işık ve gölge parçası' })
    await expect(page.getByRole('dialog', { name: 'Işık ve gölge parçası' })).toBeVisible()
    await page.getByRole('button', { name: 'Kapat' }).click()
    await page.getByRole('button', { name: 'Yeni içerik' }).click()
    await formDialog(page).getByLabel('Başlık').fill('Mevsimler parçası')
    await formDialog(page).getByRole('button', { name: 'Vazgeç' }).click()
    await expect(rows(page)).toHaveCount(1)

    const search = page.getByPlaceholder('Listede ara...')
    await search.fill('isik')
    await expect(rowOf(page, 'Işık ve gölge parçası')).toBeVisible()
    await search.fill('zzzqq')
    await expect(page.getByText('Aramanızla eşleşen içerik bulunamadı.')).toBeVisible()
    await page.getByRole('button', { name: 'Aramayı ve filtreleri temizle' }).click()
    await expect(rowOf(page, 'Işık ve gölge parçası')).toBeVisible()

    await page.getByRole('button', { name: 'Filtreler' }).click()
    await page.getByLabel('Durum', { exact: true }).selectOption('published')
    await expect(page.getByText('Aramanızla eşleşen içerik bulunamadı.')).toBeVisible()
    await page.getByRole('button', { name: 'Aramayı ve filtreleri temizle' }).click()
    await page.getByLabel('Durum', { exact: true }).selectOption('draft')
    await expect(rowOf(page, 'Işık ve gölge parçası')).toContainText('Taslak')

    await page.getByRole('checkbox', { name: 'Yalnız benimkiler' }).check()
    await expect(rowOf(page, 'Işık ve gölge parçası')).toBeVisible()
  })
})

test.describe('390 px genişlik', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('içerik havuzu listesi, panel ve form yatay taşmaz', async ({ page, loginAs, tenant }) => {
    const school = await tenant({ roles: ['yonetici', 'ogretmen'] })
    await loginAs(school.user('ogretmen'))
    await page.goto('/ogretmen/icerik-havuzu')
    await createReadingDraft(page, { title: 'Dar ekran okuma parçası' })
    await expect(page.getByRole('dialog', { name: 'Dar ekran okuma parçası' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.getByRole('button', { name: 'Kapat' }).click()
    await expectNoHorizontalOverflow(page)
    await page.getByRole('button', { name: 'Yeni içerik' }).click()
    await expect(formDialog(page)).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
