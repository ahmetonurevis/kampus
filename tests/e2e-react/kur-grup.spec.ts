import { randomUUID } from 'node:crypto'

import { expect, test } from './support/fixtures.ts'

// IST-076, IST-077; DOM-DIL-005, -006, -008, -040, -042, DOM-YTK-027: dil okulu kur ve grup
// ekranları. Kur ve grup modüle değil kurum türüne bağlıdır; okulda menüde yoktur, adresi 404'tür.
// Ayrıntılı kural taraması birim/API testlerindedir (`apps/web-react/tests/group-rows.test.ts`,
// `course-rows.test.ts`, `apps/api/test/language-groups.test.ts`).

const COURSE = 'E2E Genel İngilizce A1'

test('IST-076, IST-077, DOM-DIL-042: yönetici kur tanımlar, etkinleştirir, grup planlar; çakışma ve asgari sayı hatası görünür', async ({
  loginAs,
  tenant,
}) => {
  const school = await tenant({ type: 'language_school', roles: ['ogretmen'] })
  const page = await loginAs(school.user('yonetici'))
  const teacher = school.user('ogretmen').name

  await page.goto('/yonetici/kurlar')
  await expect(page.getByRole('heading', { level: 1, name: 'Kurlar' })).toBeVisible()
  await expect(
    page.getByRole('navigation', { name: 'Menü' }).getByRole('link', { name: 'Kurlar' }),
  ).toBeVisible()

  // Kur tanımla: haftada bir 90 dakikalık oturum (2 ders saati), en az 2 kişiyle açılır.
  await page.getByRole('button', { name: 'Kur tanımla' }).click()
  const courseForm = page.getByRole('form', { name: 'Kur tanımla' })
  await courseForm.getByLabel('Kur adı').fill(COURSE)
  await courseForm.getByLabel('Toplam ders saati').fill('24')
  await courseForm.getByLabel('Haftalık ders saati').fill('2')
  await courseForm.getByLabel('Ders süresi').selectOption('90')
  await courseForm.getByLabel('Asgari açılış (kişi)').fill('2')
  await courseForm.getByRole('button', { name: 'Kaydet' }).click()
  await expect(page.getByText('Kur taslak olarak kaydedildi.')).toBeVisible()

  await page.getByRole('button', { name: `${COURSE} özeti` }).click()
  const coursePanel = page.getByRole('dialog', { name: 'Kur özeti' })
  await coursePanel.getByRole('button', { name: 'Etkinleştir' }).click()
  await expect(page.getByText(`${COURSE} etkinleştirildi.`)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(coursePanel).toHaveCount(0)

  // Grup planla: öğretmen Pazartesi 18.00'de A1 Akşam grubunda.
  await page.goto('/yonetici/gruplar')
  await expect(page.getByRole('heading', { level: 1, name: 'Gruplar' })).toBeVisible()
  async function planGroup(name: string) {
    await page.getByRole('button', { name: 'Grup planla' }).click()
    const form = page.getByRole('form', { name: 'Grup planla' })
    await expect(form.getByLabel('Kur')).toHaveValue(/.+/)
    await form.getByLabel('Grup adı').fill(name)
    await form.getByLabel('Öğretmen').selectOption({ label: teacher })
    await form.getByLabel('Derslik').fill('204')
    await form.getByLabel('1. oturum günü').selectOption({ label: 'Pazartesi' })
    await form.getByLabel('1. oturum saati').fill('18:00')
    await form.getByRole('button', { name: 'Kaydet' }).click()
    return form
  }
  await planGroup('A1 Akşam')
  await expect(page.getByText('Grup planlandı.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'A1 Akşam özeti' })).toBeVisible()

  // Aynı öğretmen aynı gün ve saatte ikinci gruba atanamaz: hata Öğretmen alanında görünür.
  const second = await planGroup('A1 Akşam 2')
  await expect(second.getByLabel('Öğretmen')).toHaveAttribute('aria-invalid', 'true')
  await expect(
    second.getByText(/Öğretmenin .* saatinde "A1 Akşam" grubunda dersi var\./),
  ).toBeVisible()
  await second.getByRole('button', { name: 'Vazgeç' }).click()
  // Kirli form kapatılırken onay sorulur (use-discard-guard).
  await page
    .getByRole('alertdialog', { name: 'Kaydedilmemiş değişiklikler var' })
    .getByRole('button', { name: 'Değişiklikleri at' })
    .click()
  await expect(page.getByRole('form', { name: 'Grup planla' })).toHaveCount(0)

  // Kursiyeri olmayan grup açılmaz: asgari sayı hatası bildirilir, grup planlı kalır.
  await page.getByRole('button', { name: 'A1 Akşam özeti' }).click()
  const groupPanel = page.getByRole('dialog', { name: 'Grup özeti' })
  await expect(groupPanel.getByText('Planlandı')).toBeVisible()
  await groupPanel.getByRole('button', { name: 'Grubu aç' }).click()
  await expect(
    page.getByText('Grup, kurun asgari açılış sayısına ulaşmadan açılamaz.'),
  ).toBeVisible()
  await expect(groupPanel.getByRole('button', { name: 'Grubu aç' })).toBeVisible()
})

test('DOM-DIL-008: okul kurumunda Kurlar ve Gruplar menüde yoktur, adresleri Sayfa bulunamadı verir', async ({
  loginAs,
  tenant,
}) => {
  const school = await tenant({ roles: [] })
  const page = await loginAs(school.user('yonetici'))
  const menu = page.getByRole('navigation', { name: 'Menü' })
  await page.goto('/yonetici/dashboard')
  await expect(menu).toBeVisible()
  // Kapalı kategorileri açar: bağlantılar ancak açık kategoride DOM'dadır.
  const collapsed = menu.locator('button[aria-expanded="false"]')
  while ((await collapsed.count()) > 0) await collapsed.first().click()
  await expect(menu.getByRole('link', { name: 'Eğitim Kadrosu' })).toBeVisible()
  await expect(menu.getByRole('link', { name: 'Kurlar' })).toHaveCount(0)
  await expect(menu.getByRole('link', { name: 'Gruplar' })).toHaveCount(0)

  for (const path of ['/yonetici/kurlar', '/yonetici/gruplar']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: 'Bu sayfa kampüste bulunamadı.' })).toBeVisible()
    await expect(page).toHaveTitle(/Sayfa bulunamadı/)
  }
})

test('DOM-YTK-027: koordinatör olmayan öğretmen kur ve grup yazma işlemlerini görmez, API 403 verir', async ({
  loginAs,
  api,
  tenant,
}) => {
  const school = await tenant({ type: 'language_school', roles: ['ogretmen'] })
  const page = await loginAs(school.user('ogretmen'))

  await page.goto('/ogretmen/kurlar')
  await expect(page.getByRole('heading', { level: 1, name: 'Kurlar' })).toBeVisible()
  await expect(page.getByText('Henüz kur tanımlanmadı.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Kur tanımla' })).toHaveCount(0)

  await page.goto('/ogretmen/gruplar')
  await expect(page.getByRole('heading', { level: 1, name: 'Gruplar' })).toBeVisible()
  await expect(page.getByText('Henüz grup planlanmadı.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Grup planla' })).toHaveCount(0)

  const teacherApi = await api(school.user('ogretmen'))
  const denied = await teacherApi.post(
    '/api/v1/courses',
    {
      name: 'Yetkisiz kur',
      level: 'A1',
      totalHours: 24,
      weeklyHours: 2,
      minLearners: 2,
      maxLearners: 12,
    },
    { 'idempotency-key': randomUUID() },
  )
  expect(denied.status, JSON.stringify(denied.body)).toBe(403)
})
