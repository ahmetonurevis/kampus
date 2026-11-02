import { randomUUID } from 'node:crypto'

import type { Page } from '@playwright/test'

import { COORDINATOR_DUTY_MESSAGES } from '../../packages/react-shared/src/use-coordinator-duties.ts'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// IST-005, DOM-YTK-027: yönetici zümre başkanı (okul) ve akademik koordinatör (dil okulu) görevini
// verir ve kaldırır. Kural taraması birim ve API testlerindedir
// (`apps/web-react/tests/coordinator-duty-rows.test.ts`, `apps/api/test/coordinator-duties.test.ts`).

const PAGE_TITLE = 'Zümre & Koordinatörler'

/** Menü kategorisini açar (kapalıysa); açık kategori tıklamayla kapanmasın. */
async function openMenuGroup(page: Page, name: string) {
  const group = page.getByRole('navigation', { name: 'Menü' }).getByRole('button', { name })
  if ((await group.getAttribute('aria-expanded')) === 'false') await group.click()
}

async function openDutiesPage(page: Page) {
  await page.goto('/yonetici/dashboard')
  await openMenuGroup(page, 'Yönetim')
  await page
    .getByRole('navigation', { name: 'Menü' })
    .getByRole('link', { name: PAGE_TITLE })
    .click()
  await expect(page.getByRole('heading', { level: 1, name: PAGE_TITLE })).toBeVisible()
}

async function teacherMembershipId(admin: ApiClient, name: string): Promise<string> {
  const result = await admin.get('/api/v1/institution-members?role=ogretmen&pageSize=100')
  expect(result.status).toBe(200)
  const members = (result.body as { data: { id: string; name: string }[] }).data
  const member = members.find((item) => item.name === name)
  expect(member, `öğretmen üyeliği: ${name}`).toBeDefined()
  return member?.id ?? ''
}

async function assignViaApi(admin: ApiClient, membershipId: string, scopeId: string) {
  const result = await admin.post(
    '/api/v1/coordinator-duties',
    { membershipId, scopeId },
    { 'idempotency-key': randomUUID() },
  )
  expect(result.status, JSON.stringify(result.body)).toBe(201)
  return (result.body as { data: { id: string; rowVersion: number } }).data
}

async function dutyCount(admin: ApiClient): Promise<number> {
  const result = await admin.get('/api/v1/coordinator-duties')
  expect(result.status).toBe(200)
  return (result.body as { meta: { total: number } }).meta.total
}

async function setModule(admin: ApiClient, moduleKey: string, enabled: boolean) {
  const settings = await admin.get('/api/v1/modules')
  expect(settings.status).toBe(200)
  const { version } = (settings.body as { data: { version: number } }).data
  const response = await admin.context.patch(`/api/v1/modules/${moduleKey}`, {
    data: { enabled },
    headers: { 'if-match': `"${version}"`, 'idempotency-key': randomUUID() },
  })
  expect(response.status()).toBe(200)
}

test('IST-005, DOM-YTK-027: yönetici öğretmene zümre başkanlığı verir; ders branştan gelir, ikinci aynı görev ve başka branş alanda reddedilir, onayla kaldırılır', async ({
  loginAs,
  api,
  tenant,
}) => {
  const school = await tenant({ roles: ['ogretmen'] })
  const adminUser = school.user('yonetici')
  const admin = await api(adminUser)
  const teacher = school.user('ogretmen').name
  const page = await loginAs(adminUser)
  await openDutiesPage(page)
  await expect(page.getByText('Henüz zümre başkanı atanmadı.')).toBeVisible()

  // Öğretmen seçilince kadro branşı dersi önceden seçer (okulda kapsam ders).
  await page.getByRole('button', { name: 'Zümre başkanı ata' }).click()
  const form = page.getByRole('form', { name: 'Zümre başkanı ata' })
  await form.getByLabel('Öğretmen').selectOption({ label: teacher })
  await expect(form.getByLabel('Ders')).toHaveValue('math')
  await form.getByRole('button', { name: 'Görevi ver' }).click()
  await expect(page.getByText('Zümre başkanı görevi verildi.')).toBeVisible()
  await expect(form).toHaveCount(0)
  const row = page.getByRole('row', { name: new RegExp(`${teacher}.*Matematik`) })
  await expect(row).toBeVisible()
  await expect(row).toContainText('Zümre başkanı')
  expect(await dutyCount(admin)).toBe(1)

  // Aynı kapsamda ikinci atama reddedilir (coordinator_duty_exists); hata Ders alanının altındadır.
  await page.getByRole('button', { name: 'Zümre başkanı ata' }).click()
  const again = page.getByRole('form', { name: 'Zümre başkanı ata' })
  await again.getByLabel('Öğretmen').selectOption({ label: teacher })
  await again.getByRole('button', { name: 'Görevi ver' }).click()
  await expect(again.getByLabel('Ders')).toHaveAttribute('aria-invalid', 'true')
  await expect(again.getByText('Bu görev öğretmene zaten verilmiş.')).toBeVisible()
  // Gönderim sürerken alanlar kilitlidir; odak gönderim bitince hatalı alana gelir.
  await expect(again.getByLabel('Ders')).toBeFocused()
  expect(await dutyCount(admin)).toBe(1)

  // Öğretmenin branşı dışındaki ders reddedilir (duty_outside_branch).
  await again.getByLabel('Ders').selectOption({ label: 'Fizik' })
  await again.getByRole('button', { name: 'Görevi ver' }).click()
  await expect(
    again.getByText('Zümre başkanlığı öğretmenin kendi branşında verilir.'),
  ).toBeVisible()
  await expect(again.getByLabel('Ders')).toHaveAttribute('aria-invalid', 'true')
  await expect(again.getByLabel('Ders')).toBeFocused()
  expect(await dutyCount(admin)).toBe(1)
  await again.getByRole('button', { name: 'Vazgeç' }).click()
  await expect(again).toHaveCount(0)

  // Kaldırma onaylıdır; vazgeçmek görevi değiştirmez.
  await page.getByRole('button', { name: `${teacher} Matematik görevini kaldır` }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Görevi kaldır' })
  await confirm.getByRole('button', { name: 'Vazgeç' }).click()
  await expect(confirm).toHaveCount(0)
  expect(await dutyCount(admin)).toBe(1)
  await page.getByRole('button', { name: `${teacher} Matematik görevini kaldır` }).click()
  await confirm.getByRole('button', { name: 'Görevi kaldır' }).click()
  await expect(page.getByText('Zümre başkanı görevi kaldırıldı.')).toBeVisible()
  await expect(row).toHaveCount(0)
  await expect(page.getByText('Henüz zümre başkanı atanmadı.')).toBeVisible()
  expect(await dutyCount(admin)).toBe(0)
})

test('DOM-YTK-027: görev başka yerden kaldırıldıysa kaldırma Türkçe uyarı verir ve liste tazelenir', async ({
  loginAs,
  api,
  tenant,
}) => {
  const school = await tenant({ roles: ['ogretmen'] })
  const adminUser = school.user('yonetici')
  const admin = await api(adminUser)
  const teacher = school.user('ogretmen').name
  const duty = await assignViaApi(admin, await teacherMembershipId(admin, teacher), 'math')

  const page = await loginAs(adminUser)
  await openDutiesPage(page)
  const row = page.getByRole('row', { name: new RegExp(`${teacher}.*Matematik`) })
  await expect(row).toBeVisible()
  await page.getByRole('button', { name: `${teacher} Matematik görevini kaldır` }).click()

  // Pencere açıkken başka bir oturum görevi kaldırır; onay artık eskimiş görevedir.
  const removed = await admin.context.delete(`/api/v1/coordinator-duties/${duty.id}`, {
    headers: { 'if-match': `"${duty.rowVersion}"`, 'idempotency-key': randomUUID() },
  })
  expect(removed.status()).toBe(200)
  await page
    .getByRole('alertdialog', { name: 'Görevi kaldır' })
    .getByRole('button', { name: 'Görevi kaldır' })
    .click()
  await expect(page.getByText('Görev veya öğretmen bulunamadı.')).toBeVisible()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(row).toHaveCount(0)
  await expect(page.getByText('Henüz zümre başkanı atanmadı.')).toBeVisible()
})

test('DOM-YTK-027: görev sürümü eskidiyse kaldırma 409 ile reddedilir, pencere kapanır ve liste tazelenir', async ({
  loginAs,
  api,
  tenant,
}) => {
  const school = await tenant({ roles: ['ogretmen'] })
  const adminUser = school.user('yonetici')
  const admin = await api(adminUser)
  const teacher = school.user('ogretmen').name
  await assignViaApi(admin, await teacherMembershipId(admin, teacher), 'math')

  const page = await loginAs(adminUser)
  await openDutiesPage(page)
  const row = page.getByRole('row', { name: new RegExp(`${teacher}.*Matematik`) })
  await expect(row).toBeVisible()

  // Ekrandaki görev eskimiş sürümle gider: sunucu gerçekten 409 `version_conflict` döndürür.
  await page.route('**/api/v1/coordinator-duties/*', async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue()
    return route.continue({ headers: { ...route.request().headers(), 'if-match': '"99"' } })
  })
  const refreshed = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/coordinator-duties') &&
      response.request().method() === 'GET',
  )
  await page.getByRole('button', { name: `${teacher} Matematik görevini kaldır` }).click()
  await page
    .getByRole('alertdialog', { name: 'Görevi kaldır' })
    .getByRole('button', { name: 'Görevi kaldır' })
    .click()
  await expect(page.getByText(COORDINATOR_DUTY_MESSAGES.version_conflict)).toBeVisible()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await refreshed
  // Görev sunucuda durur (arşivlenmedi) ve liste tazelenmiş hâliyle görünür.
  await expect(row).toBeVisible()
  expect(await dutyCount(admin)).toBe(1)
})

test('IST-005, DOM-YTK-027: dil okulunda alanlar koordinatör ve seviye dilindedir; seviye süzgeci çalışır, seviyesiz gönderim alanda reddedilir', async ({
  loginAs,
  api,
  tenant,
}) => {
  const school = await tenant({ type: 'language_school', roles: ['ogretmen'] })
  const adminUser = school.user('yonetici')
  const admin = await api(adminUser)
  const teacher = school.user('ogretmen').name
  const membershipId = await teacherMembershipId(admin, teacher)
  const page = await loginAs(adminUser)
  await openDutiesPage(page)
  await expect(page.getByText('Henüz akademik koordinatör atanmadı.')).toBeVisible()

  await page.getByRole('button', { name: 'Koordinatör ata' }).click()
  const form = page.getByRole('form', { name: 'Akademik koordinatör ata' })
  await expect(form.getByLabel('Seviye')).toBeVisible()
  await expect(form.getByLabel('Ders')).toHaveCount(0)
  // Dil okulunda branştan önceden seçim yoktur; seviye açıkça seçilir.
  await form.getByLabel('Öğretmen').selectOption({ label: teacher })
  await expect(form.getByLabel('Seviye')).toHaveValue('')
  await form.getByRole('button', { name: 'Görevi ver' }).click()
  await expect(form.getByText('Ders veya seviye seçin.')).toBeVisible()
  await form.getByLabel('Seviye').selectOption({ label: 'B1+' })
  await form.getByRole('button', { name: 'Görevi ver' }).click()
  await expect(page.getByText('Akademik koordinatör görevi verildi.')).toBeVisible()
  await expect(page.getByRole('row', { name: new RegExp(`${teacher}.*B1\\+`) })).toBeVisible()

  // Başka seviyeler API'den verilir; seviye süzgeci yalnız seçileni gösterir.
  await assignViaApi(admin, membershipId, 'A1')
  await assignViaApi(admin, membershipId, 'C1')
  await page.reload()
  const rows = page.getByRole('region', { name: /Kayıt tablosu/ }).getByRole('row')
  await expect(rows).toHaveCount(4)
  await page.getByRole('button', { name: /Filtre/ }).click()
  await page.getByLabel('Seviye', { exact: true }).selectOption({ label: 'A1' })
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(1)).toContainText('A1')

  // Dar ekranda sayfa yatay taşmaz (tablo kartlara döner).
  await page.setViewportSize({ width: 390, height: 800 })
  await expectNoHorizontalOverflow(page)
})

test('DOM-YTK-027: yönetici olmayan rol sayfayı menüde görmez, adresle açamaz ve API 403 verir', async ({
  loginAs,
  api,
  tenant,
}) => {
  const school = await tenant({ roles: ['ogretmen'] })
  const page = await loginAs(school.user('ogretmen'))
  await page.goto('/ogretmen/dashboard')
  await openMenuGroup(page, 'Akademik')
  await expect(
    page.getByRole('navigation', { name: 'Menü' }).getByRole('link', { name: PAGE_TITLE }),
  ).toHaveCount(0)

  // Yönetici adresi öğretmeni ana sayfasına döndürür; öğretmen adresi sayfa bulunamadı verir.
  await page.goto('/yonetici/koordinator-gorevleri')
  await expect(page).toHaveURL(/\/ogretmen\/dashboard$/)
  await page.goto('/ogretmen/koordinator-gorevleri')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Bu sayfa kampüste bulunamadı.' }),
  ).toBeVisible()

  const admin = await api(school.user('yonetici'))
  const membershipId = await teacherMembershipId(admin, school.user('ogretmen').name)
  const teacherApi = await api(school.user('ogretmen'))
  const denied = await teacherApi.post(
    '/api/v1/coordinator-duties',
    { membershipId, scopeId: 'math' },
    { 'idempotency-key': randomUUID() },
  )
  expect(denied.status).toBe(403)
  expect(await dutyCount(admin)).toBe(0)
})

test('IST-009: academic kapalıyken görev atama sayfası menüden ve adresten kapanır, açılınca döner', async ({
  loginAs,
  api,
  tenant,
}) => {
  const school = await tenant({ roles: [] })
  const adminUser = school.user('yonetici')
  const admin = await api(adminUser)
  await setModule(admin, 'academic', false)

  const page = await loginAs(adminUser)
  const menu = page.getByRole('navigation', { name: 'Menü' })
  await page.goto('/yonetici/koordinator-gorevleri')
  await expect(page).toHaveURL(/\/yonetici\/dashboard$/)
  await expect(page.getByText('Bu modül kurum ayarlarından kapatılmış.')).toBeVisible()
  await openMenuGroup(page, 'Yönetim')
  await expect(menu.getByRole('link', { name: PAGE_TITLE })).toHaveCount(0)

  await setModule(admin, 'academic', true)
  await page.goto('/yonetici/koordinator-gorevleri')
  await expect(page.getByRole('heading', { level: 1, name: PAGE_TITLE })).toBeVisible()
  await openMenuGroup(page, 'Yönetim')
  await expect(menu.getByRole('link', { name: PAGE_TITLE })).toBeVisible()
})
