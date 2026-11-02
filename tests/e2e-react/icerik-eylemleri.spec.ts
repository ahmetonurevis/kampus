import type { Page } from '@playwright/test'

import { expect, test } from './support/fixtures.ts'
import { pdf, publishMaterial } from './support/materials.ts'

// İçerik havuzu kaynak eylemleri (OG-217; DOM-KYN-025, 040, 050, 051): öğretmen yayındaki
// içeriğini ders verdiği sınıfla paylaşır ve kopyalar; telif bildirimi yapar, yönetici bildirilen
// içeriği gerekçeyle kaldırır. Kurulum API'den (`tenant()`, `publishMaterial`); öğretmen Selin
// Kaya A şubelerinde ders verir, B ve C şubelerinde vermez.

const rows = (page: Page) => page.getByRole('table', { name: 'İçerik havuzu' }).locator('tbody tr')
const toasts = (page: Page) => page.locator('[data-sonner-toast]')

async function openPanel(page: Page, title: string) {
  await page.getByRole('button', { name: title, exact: true }).first().click()
  const panel = page.getByRole('dialog', { name: title })
  await expect(panel).toBeVisible()
  return panel
}

async function moreActions(page: Page, panel: ReturnType<Page['getByRole']>) {
  await panel.getByRole('button', { name: 'Diğer işlemler' }).click()
  return page.getByRole('menu')
}

test('DOM-KYN-040, DOM-KYN-050: öğretmen içeriğini sınıfıyla paylaşır ve kopyalar; kopya taslak başlar', async ({
  page,
  loginAs,
  api,
  tenant,
}) => {
  const school = await tenant({ roles: ['yonetici', 'ogretmen'] })
  const title = 'Kesirler çalışma kâğıdı'
  const teacher = await api(school.user('ogretmen'))
  const material = await publishMaterial(teacher, school.institutionId, {
    title,
    file: pdf('kesirler.pdf'),
    gradeLevel: 7,
  })

  await loginAs(school.user('ogretmen'))
  await page.goto('/ogretmen/icerik-havuzu')
  const panel = await openPanel(page, title)
  await expect(panel.getByText('Yalnız ben')).toBeVisible()

  await panel.getByRole('button', { name: 'Paylaş', exact: true }).click()
  const share = page.getByRole('dialog', { name: 'İçeriği paylaş' })
  await share.getByLabel('Paylaşım kapsamı').selectOption('classes')
  const classes = share.getByRole('group', { name: 'Sınıf ve gruplar' })
  // Yalnız ders verdiği sınıflar listelenir; 7-B'de ders vermez.
  await expect(classes.getByLabel('7-A')).toBeVisible()
  await expect(classes.getByLabel('7-B')).toHaveCount(0)
  // Sınıf seçilmeden kaydedilmez, hata grubun altında görünür.
  await share.getByRole('button', { name: 'Paylaşımı kaydet' }).click()
  await expect(classes.getByRole('alert')).toHaveText('En az bir sınıf seçin.')
  await classes.getByLabel('7-A').check()
  await share.getByRole('button', { name: 'Paylaşımı kaydet' }).click()
  await expect(share).toBeHidden()
  await expect(toasts(page).filter({ hasText: 'Paylaşım güncellendi.' })).toBeVisible()
  await expect(panel.getByText('Sınıf/grup')).toBeVisible()
  const stored = await teacher.get(`/api/v1/resources/${material.resourceId}`)
  expect(stored.status).toBe(200)
  expect(
    (stored.body as { data: { resource: { sharedClassIds: string[] } } }).data.resource
      .sharedClassIds,
  ).toEqual(['c1'])

  const menu = await moreActions(page, panel)
  // Kaldırma yalnız yöneticinindir.
  await expect(menu.getByRole('menuitem', { name: 'Kaldır' })).toHaveCount(0)
  await menu.getByRole('menuitem', { name: 'Kopyala' }).click()
  await expect(toasts(page).filter({ hasText: 'Kopya oluşturuldu' })).toBeVisible()
  // Kopyanın paneli açılır: taslak ve yalnız sahibine açık.
  await expect(page).not.toHaveURL(new RegExp(`icerik=${material.resourceId}`))
  const copy = page.getByRole('dialog', { name: title })
  await expect(copy.getByText('Taslak').first()).toBeVisible()
  await expect(copy.getByText('Yalnız ben')).toBeVisible()
  await copy.getByRole('button', { name: 'Kapat' }).click()
  await expect.poll(() => rows(page).filter({ hasText: title }).count()).toBe(2)
})

test('DOM-KYN-025, DOM-KYN-051: öğretmen telif bildirimi yapar, yönetici gerekçeyle kaldırır', async ({
  page,
  loginAs,
  api,
  tenant,
}) => {
  const school = await tenant({ roles: ['yonetici', 'ogretmen'] })
  const title = 'Yayınevi sayfası taraması'
  const teacher = await api(school.user('ogretmen'))
  const material = await publishMaterial(teacher, school.institutionId, {
    title,
    file: pdf('tarama.pdf'),
    gradeLevel: 7,
  })

  await loginAs(school.user('ogretmen'))
  await page.goto('/ogretmen/icerik-havuzu')
  const panel = await openPanel(page, title)
  await (await moreActions(page, panel)).getByRole('menuitem', { name: 'Telif bildirimi' }).click()
  const report = page.getByRole('dialog', { name: 'Telif bildirimi' })
  // Gerekçe boşken istek gitmez, alan geçersiz işaretlenir.
  await report.getByRole('button', { name: 'Bildir' }).click()
  await expect(report.getByLabel('Bildirim gerekçesi')).toHaveAttribute('aria-invalid', 'true')
  await report.getByLabel('Bildirim gerekçesi').fill('Yayınevi kitabından izinsiz taranmış sayfa.')
  await report.getByRole('button', { name: 'Bildir' }).click()
  await expect(report).toBeHidden()
  await expect(toasts(page).filter({ hasText: 'Telif bildirimi alındı' })).toBeVisible()
  await expect(panel.getByText('İncelemede').first()).toBeVisible()

  await loginAs(school.user('yonetici'), { fresh: true })
  await page.goto('/yonetici/icerik-havuzu')
  await expect(rows(page).filter({ hasText: title })).toContainText('İncelemede')
  const adminPanel = await openPanel(page, title)
  // Bildirilen içeriği yönetici yeniden yayına alabilir ya da kaldırır.
  await expect(adminPanel.getByRole('button', { name: 'Onayla' })).toBeVisible()
  await (await moreActions(page, adminPanel)).getByRole('menuitem', { name: 'Kaldır' }).click()
  const removal = page.getByRole('dialog', { name: 'İçeriği kaldır' })
  await removal.getByLabel('Kaldırma gerekçesi').fill('Telif ihlali doğrulandı; içerik kaldırıldı.')
  await removal.getByRole('button', { name: 'Kaldır', exact: true }).click()
  await expect(removal).toBeHidden()
  await expect(toasts(page).filter({ hasText: 'İçerik kaldırıldı.' })).toBeVisible()
  await expect(adminPanel).toBeHidden()
  await expect(rows(page).filter({ hasText: title })).toHaveCount(0)

  const admin = await api(school.user('yonetici'))
  const stored = await admin.get(`/api/v1/resources/${material.resourceId}`)
  // Başlık ve gerekçe kalır, içerik silinir (DOM-KYN-051).
  expect(stored.status).toBe(200)
  const head = (
    stored.body as { data: { head: { status: string; content: unknown; removalReason: string } } }
  ).data.head
  expect(head).toMatchObject({
    status: 'removed',
    content: null,
    removalReason: 'Telif ihlali doğrulandı; içerik kaldırıldı.',
  })
})
