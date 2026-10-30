import { randomUUID } from 'node:crypto'

import type { Browser, Page } from '@playwright/test'

import {
  clientHeaders,
  randomIp,
  SIGN_IN_PATH,
  signInRequest,
  type ApiClient,
  type Principal,
} from './support/api.ts'
import { e2e } from './support/env.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// İletişim ekranları: duyurular ve birebir yazışma. İki tarafı olan akışlarda ikinci kişi ayrı
// tarayıcı bağlamında açılır (`openAs`). Her test kendi kurumunu kurar (`tenant`: Selin Kaya
// öğretmen, Deniz Yılmaz öğrenci, Ayşe Yılmaz veli, kurum yöneticisi); veri kurulumu API'den,
// sınanan davranış arayüzden yapılır.

const ANNOUNCEMENT_TITLE = 'Müze gezisi bilgilendirmesi'
const ANNOUNCEMENT_TEXT = 'Cuma günü müze gezisi var; öğrenciler formalarıyla gelsin.'
const FIRST_MESSAGE = 'Deniz bu hafta ödevini zamanında teslim etti, teşekkürler.'
const PARENT_REPLY = 'Teşekkür ederiz, evde de takip ediyoruz.'

interface Opened {
  page: Page
}

/** İkinci kişinin oturumu: kendi çerez kabı ve sahte IP'siyle ayrı tarayıcı bağlamı. */
async function openAs(browser: Browser, principal: Principal): Promise<Opened> {
  const context = await browser.newContext({
    baseURL: e2e.webOrigin,
    extraHTTPHeaders: clientHeaders(randomIp()),
    viewport: { width: 1440, height: 1000 },
  })
  const { data, headers } = signInRequest(principal)
  const response = await context.request.post(SIGN_IN_PATH, {
    data,
    headers,
    failOnStatusCode: false,
  })
  expect(response.ok(), 'ikinci kişinin girişi').toBe(true)
  return { page: await context.newPage() }
}

/** Komut ucuna `Idempotency-Key` ile gönderir ve oluşan kaydın kimliğini verir. */
async function command(client: ApiClient, path: string, data: unknown): Promise<string> {
  const response = await client.context.fetch(path, {
    method: 'POST',
    data,
    headers: { 'idempotency-key': randomUUID() },
    failOnStatusCode: false,
  })
  expect([200, 201], `${path}: ${await response.text()}`).toContain(response.status())
  const body = (await response.json()) as { data: { entity: { id: string } } }
  return body.data.entity.id
}

const publishAnnouncement = (client: ApiClient, title = ANNOUNCEMENT_TITLE) =>
  command(client, '/api/v1/announcements', {
    title,
    text: ANNOUNCEMENT_TEXT,
    category: 'Etkinlik',
    target: { classIds: ['c1'], roles: ['veli'] },
  })

const startConversation = (client: ApiClient, audience: 'student' | 'parent') =>
  command(client, '/api/v1/conversations', {
    studentId: 's1',
    audience,
    text: FIRST_MESSAGE,
  })

const announcementLink = (page: Page, title = ANNOUNCEMENT_TITLE) =>
  page.getByRole('button', { name: `${title} duyurusunu aç` })
const announcementRow = (page: Page, title = ANNOUNCEMENT_TITLE) =>
  page.getByRole('row').filter({ has: announcementLink(page, title) })
const detail = (page: Page) => page.getByRole('dialog', { name: 'Duyuru' })

test.describe('duyurular', () => {
  test('öğretmen duyuru yayınlar, veli açınca okundu sayısı artar', async ({
    page,
    browser,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici', 'ogretmen', 'ogrenci', 'veli'],
      students: ['s1'],
    })
    await loginAs(school.user('ogretmen'))
    await page.goto('/ogretmen/duyurular')
    await page.getByRole('button', { name: 'Yeni duyuru' }).click()
    const form = page.getByRole('dialog', { name: 'Yeni duyuru' })
    await form.getByLabel('Başlık').fill(ANNOUNCEMENT_TITLE)
    await form.getByLabel('Kategori').selectOption('Etkinlik')
    await form.getByLabel('Duyuru metni').fill(ANNOUNCEMENT_TEXT)
    await form.getByRole('checkbox', { name: '7-A', exact: true }).check()
    await form.getByRole('button', { name: 'Yayınla' }).click()
    await expect(form).toBeHidden()
    await expect(announcementRow(page)).toContainText('Etkinlik')
    await expect(announcementRow(page)).toContainText('0 / 1')

    // Veli: duyuru okunmamış görünür; açınca okundu yazılır ve durum düşer.
    const parent = await openAs(browser, school.user('veli'))
    await parent.page.goto('/veli/duyurular')
    await expect(announcementRow(parent.page)).toContainText('Okunmadı')
    await announcementLink(parent.page).click()
    await expect(detail(parent.page).getByText(ANNOUNCEMENT_TEXT)).toBeVisible()
    await parent.page.keyboard.press('Escape')
    await expect(detail(parent.page)).toBeHidden()
    await expect(announcementRow(parent.page)).toContainText('Yayında')

    // Yayınlayan: okundu sayısı yalnız ona gelir.
    await page.reload()
    await announcementLink(page).click()
    await expect(detail(page).getByText('1 / 1')).toBeVisible()
    // Alıcıya okundu oranı hiç gösterilmez.
    await announcementLink(parent.page).click()
    await expect(detail(parent.page).getByText('Okundu')).toHaveCount(0)
  })

  test('geri çekilen duyuruda alıcı yalnız işareti görür, metin görünmez', async ({
    page,
    browser,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici', 'ogretmen', 'ogrenci', 'veli'],
      students: ['s1'],
    })
    await publishAnnouncement(await api(school.user('ogretmen')))
    await loginAs(school.user('ogretmen'))
    await page.goto('/ogretmen/duyurular')
    await announcementLink(page).click()
    await detail(page).getByRole('button', { name: 'Geri çek' }).click()
    const reason = page.getByRole('dialog', { name: 'Duyuruyu geri çek' })
    await reason.getByLabel('Geri çekme gerekçesi').fill('Tarih değişti, yeni duyuru yayınlanacak.')
    await reason.getByRole('button', { name: 'Geri çek' }).click()
    await expect(reason).toBeHidden()
    await expect(detail(page).getByText('Geri çekildi').first()).toBeVisible()

    const parent = await openAs(browser, school.user('veli'))
    await parent.page.goto('/veli/duyurular')
    await expect(announcementRow(parent.page)).toContainText('Geri çekildi')
    await announcementLink(parent.page).click()
    await expect(detail(parent.page).getByText('Geri çekildi').first()).toBeVisible()
    await expect(parent.page.getByText(ANNOUNCEMENT_TEXT)).toHaveCount(0)
  })
})

test.describe('mesajlar', () => {
  test('öğretmen veliyle yazışma başlatır, veli yanıtlar ve okunmamış rozeti değişir', async ({
    page,
    browser,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici', 'ogretmen', 'ogrenci', 'veli'],
      students: ['s1'],
    })
    await loginAs(school.user('ogretmen'))
    await page.goto('/ogretmen/mesajlar')
    await page.getByRole('button', { name: 'Yeni yazışma' }).click()
    const panel = page.getByRole('dialog', { name: 'Yeni yazışma' })
    await panel.getByLabel('Öğrenci').selectOption({ label: 'Deniz Yılmaz' })
    await panel.getByLabel('Kiminle yazışacaksınız?').selectOption({ label: 'Ayşe Yılmaz (veli)' })
    await panel.getByLabel('İlk mesajınız').fill(FIRST_MESSAGE)
    await panel.getByRole('button', { name: 'Yazışmayı başlat' }).click()
    await expect(panel).toBeHidden()
    const teacherLog = page.getByRole('log', { name: 'Mesaj akışı' })
    await expect(teacherLog.getByText(FIRST_MESSAGE)).toBeVisible()
    // DOM-ILT-014: özel nitelikli bilgi uyarısı yazma alanında sabittir.
    await expect(page.getByRole('note').filter({ hasText: 'Sağlık durumu' })).toBeVisible()

    // Veli: okunmamış rozeti görünür, akışı açınca kalkar; yanıt gönderir.
    const parent = await openAs(browser, school.user('veli'))
    await parent.page.goto('/veli/randevu-mesaj')
    const parentRow = parent.page.getByRole('button', { name: /Selin Kaya/ })
    await expect(parentRow).toContainText('1 okunmamış mesaj')
    await parentRow.click()
    await expect(parent.page.getByRole('log', { name: 'Mesaj akışı' })).toContainText(FIRST_MESSAGE)
    await expect(parentRow).not.toContainText('okunmamış mesaj')
    await parent.page.getByLabel('Mesajınız').fill(PARENT_REPLY)
    await parent.page.getByRole('button', { name: 'Gönder' }).click()
    await expect(parent.page.getByRole('log', { name: 'Mesaj akışı' })).toContainText(PARENT_REPLY)
    await expect(parent.page.getByLabel('Mesajınız')).toHaveValue('')

    // Öğretmen: seçili yazışma olmadan listeyi açınca yeni mesaj okunmamış rozetiyle gelir; açınca
    // okundu olur ve veli "Okundu" görür.
    await page.goto('/ogretmen/mesajlar')
    const teacherRow = page.getByRole('button', { name: /Ayşe Yılmaz \(veli\)/ })
    await expect(teacherRow).toContainText('1 okunmamış mesaj')
    await teacherRow.click()
    await expect(page.getByRole('log', { name: 'Mesaj akışı' })).toContainText(PARENT_REPLY)
    await expect(teacherRow).not.toContainText('okunmamış mesaj')
    await parent.page.reload()
    await parent.page.getByRole('button', { name: /Selin Kaya/ }).click()
    await expect(
      parent.page
        .getByRole('log', { name: 'Mesaj akışı' })
        .getByRole('listitem')
        .filter({ hasText: PARENT_REPLY }),
    ).toContainText('Okundu')
  })

  test('yönetici gerekçesiz açamaz, gerekçeyle açar; veli yazışmasına erişim yoktur', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici', 'ogretmen', 'ogrenci', 'veli'],
      students: ['s1'],
    })
    const teacher = await api(school.user('ogretmen'))
    const studentChat = await startConversation(teacher, 'student')
    await startConversation(teacher, 'parent')
    const admin = await api(school.user('yonetici'))
    // Erişim açılmadan içerik sunucudan da kapalıdır.
    const closed = await admin.get(`/api/v1/conversations/${studentChat}/messages`)
    expect(closed.status).toBe(404)

    await loginAs(school.user('yonetici'))
    await page.goto('/yonetici/mesajlar')
    await expect(page.getByText('Yazışmaların üst verisini görmek için')).toBeVisible()
    await page.getByLabel('Öğrenci', { exact: true }).selectOption({ label: 'Deniz Yılmaz' })
    const studentRow = page.getByRole('button', { name: /Öğrenci–öğretmen/ })
    await expect(studentRow).toContainText('İçerik kapalı')
    await expect(page.getByText(FIRST_MESSAGE)).toHaveCount(0)

    await studentRow.click()
    await page.getByRole('button', { name: 'Gerekçeyle aç' }).click()
    const dialog = page.getByRole('dialog', { name: 'Yazışmayı gerekçeyle aç' })
    await dialog.getByLabel('Erişim gerekçesi').fill('kısa')
    await dialog.getByRole('button', { name: 'Erişimi aç' }).click()
    await expect(dialog.getByText('Gerekçe en az 10 karakter olmalıdır.')).toBeVisible()
    expect((await admin.get(`/api/v1/conversations/${studentChat}/messages`)).status).toBe(404)

    await dialog.getByLabel('Erişim gerekçesi').fill('Veli şikayeti incelemesi, dosya no 2026-41.')
    await dialog.getByRole('button', { name: 'Erişimi aç' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('timer')).toContainText(/Kalan süre:\s*(29|30):\d\d/)
    await expect(page.getByRole('log', { name: 'Mesaj akışı' })).toContainText(FIRST_MESSAGE)
    // Yönetici yazmaz: yazma alanı yoktur.
    await expect(page.getByLabel('Mesajınız')).toHaveCount(0)

    // Veli yazışması yalnız üst veridir; gerekçeyle aç düğmesi gösterilmez.
    await page.getByRole('button', { name: /Veli yazışması/ }).click()
    await expect(page.getByText('Veli yazışmaları yönetici erişimine kapalıdır')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Gerekçeyle aç' })).toHaveCount(0)
  })

  test('dar ekranda liste ile yazışma ayrı görünümdür', async ({ page, loginAs, api, tenant }) => {
    const school = await tenant({
      roles: ['yonetici', 'ogretmen', 'ogrenci', 'veli'],
      students: ['s1'],
    })
    await startConversation(await api(school.user('ogretmen')), 'parent')
    await page.setViewportSize({ width: 390, height: 800 })
    await loginAs(school.user('veli'))
    await page.goto('/veli/randevu-mesaj')

    const list = page.getByRole('navigation', { name: 'Yazışma listesi' })
    await page.getByRole('button', { name: /Selin Kaya/ }).click()
    await expect(page.getByRole('log', { name: 'Mesaj akışı' })).toContainText(FIRST_MESSAGE)
    await expect(list).toBeHidden()
    await expectNoHorizontalOverflow(page)

    await page.getByRole('button', { name: 'Listeye dön' }).click()
    await expect(list).toBeVisible()
    await expect(page.getByRole('log', { name: 'Mesaj akışı' })).toHaveCount(0)
    await expectNoHorizontalOverflow(page)
  })
})
