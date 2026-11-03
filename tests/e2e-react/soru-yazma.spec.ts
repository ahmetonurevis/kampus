import type { Locator, Page } from '@playwright/test'

import { expect, test } from './support/fixtures.ts'

// Soru bankası yazma ekranı (OG-068, IST-033; DOM-KYN-002, 032): öğretmen içerik havuzunda
// sıralama ve eşleştirme sorusu yazar, kaydetmeden önce oynatıcıyla önizler, yayımlar ve yeni
// sürümle düzenler. Her test kendi kurumunu kurar (`tenant`); kalıcılık API'den okunur.

const toast = (page: Page, text: string) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text })
const rows = (page: Page) => page.getByRole('table', { name: 'İçerik havuzu' }).locator('tbody tr')

interface ResourceDetail {
  data: {
    versions: { versionNumber: number; status: string }[]
    head: {
      versionNumber: number
      content: { question: { questionType: string; items?: { text: string }[] } }
      answerKey: { order?: string[] }
    }
  }
}

/** Yeni soru formunu açar, türü seçer; başlık tür değişiminden sonra yazılır. */
async function openQuestionForm(page: Page, title: string, questionType: string) {
  await page.getByRole('button', { name: 'Yeni içerik' }).click()
  const form = page.getByRole('dialog', { name: 'Yeni içerik' })
  await form.getByLabel('İçerik türü').selectOption('question')
  await form.getByLabel('Soru türü').selectOption(questionType)
  await form.getByLabel('Başlık').fill(title)
  return form
}

/** Okul kurumunun yayım etiketleri, menşe ve telif beyanı. */
async function tagAndDeclare(form: Locator) {
  await form.getByLabel('Ders').selectOption({ label: 'Matematik' })
  await form.getByLabel('7. sınıf', { exact: true }).check()
  await form.getByRole('button', { name: 'Kazanım ekle' }).click()
  await form.getByLabel('1. kazanım kodu').fill('MAT.7.1.1')
  await form.getByLabel('Menşe ve lisans').selectOption('institution_original')
  await form.getByLabel(/Bu içeriği kullanma hakkım var/).check()
}

test('IST-033: öğretmen sıralama sorusu yazar, yayımlar ve yeni sürümle düzenler (DOM-KYN-032)', async ({
  page,
  loginAs,
  api,
  tenant,
}) => {
  const school = await tenant({ roles: ['ogretmen'] })
  const title = 'Kesir işlem sırası'
  await loginAs(school.user('ogretmen'))
  await page.goto('/ogretmen/icerik-havuzu')

  const form = await openQuestionForm(page, title, 'ordering')
  await form.getByLabel('Soru kökü').fill('İşlemleri yapılış sırasına dizin.')
  await form.getByLabel('1. öğe', { exact: true }).fill('Paydaları eşitle')
  await form.getByLabel('2. öğe', { exact: true }).fill('Payları topla')
  await form.getByLabel('3. öğe', { exact: true }).fill('Sonucu sadeleştir')
  await form.getByLabel('Çözüm açıklaması').fill('Önce payda eşitlenir, sonra toplanır.')
  await tagAndDeclare(form)

  // Kaydetmeden önce oynatıcı önizlemesi: öğrencinin göreceği öğeler ve sıra düğmeleri.
  await form.getByRole('button', { name: 'Soruyu önizle' }).click()
  const preview = page.getByRole('dialog', { name: 'Soru önizlemesi' })
  await expect(preview.getByRole('listitem')).toHaveCount(3)
  await expect(
    preview.getByRole('button', { name: 'Payları topla öğesini yukarı taşı' }),
  ).toBeVisible()
  await preview.getByRole('button', { name: 'Cevabı denetle' }).click()
  await expect(preview.getByRole('status')).toHaveText('Önce soruyu cevaplayın.')
  await preview.getByRole('button', { name: 'Önizlemeyi kapat' }).click()
  await expect(preview).toBeHidden()

  await form.getByRole('button', { name: 'Taslağı kaydet' }).click()
  await expect(toast(page, 'Taslak kaydedildi.')).toBeVisible()
  const panel = page.getByRole('dialog', { name: title })
  const summary = panel.getByRole('region', { name: 'İçerik önizlemesi' })
  await expect(summary).toContainText('Sıralama')
  await expect(summary.getByRole('listitem').first()).toContainText('Paydaları eşitle')

  await panel.getByRole('button', { name: 'Yayımla', exact: true }).click()
  await expect(panel.getByText('Yayında').first()).toBeVisible()
  await panel.getByRole('button', { name: 'Yeni sürüm aç' }).click()
  await expect(toast(page, 'Yeni taslak açıldı.')).toBeVisible()
  await expect(panel.getByText('Sürüm 2', { exact: false }).first()).toBeVisible()

  await panel.getByRole('button', { name: 'Düzenle' }).click()
  const edit = page.getByRole('dialog', { name: 'Taslağı düzenle' })
  await expect(edit.getByLabel('Soru türü')).toHaveValue('ordering')
  await expect(edit.getByLabel('1. öğe', { exact: true })).toHaveValue('Paydaları eşitle')
  await edit.getByRole('button', { name: 'Öğe ekle' }).click()
  await edit.getByLabel('4. öğe', { exact: true }).fill('Tam sayılı kesre çevir')
  await edit.getByRole('button', { name: '4. öğeyi yukarı taşı' }).click()
  await expect(edit.getByLabel('3. öğe', { exact: true })).toHaveValue('Tam sayılı kesre çevir')
  await edit.getByLabel(/Bu içeriği kullanma hakkım var/).check()
  await edit.getByRole('button', { name: 'Değişiklikleri kaydet' }).click()
  await expect(toast(page, 'Taslak güncellendi.')).toBeVisible()
  await expect(edit).toBeHidden()
  await expect(summary.getByRole('listitem')).toHaveCount(4)
  await expect(summary.getByRole('listitem').nth(2)).toContainText('Tam sayılı kesre çevir')

  // Kalıcılık: yayındaki sürüm 1 değişmedi, sürüm 2 taslağı yeni sırayı taşır.
  const resourceId = new URL(page.url()).searchParams.get('icerik') ?? ''
  expect(resourceId).not.toBe('')
  const teacher = await api(school.user('ogretmen'))
  const detail = await teacher.get(`/api/v1/resources/${resourceId}`)
  expect(detail.status).toBe(200)
  const { versions, head } = (detail.body as ResourceDetail).data
  expect(versions.map((v) => [v.versionNumber, v.status])).toEqual([
    [1, 'published'],
    [2, 'draft'],
  ])
  expect(head.content.question.items?.map((item) => item.text)).toEqual([
    'Paydaları eşitle',
    'Payları topla',
    'Tam sayılı kesre çevir',
    'Sonucu sadeleştir',
  ])
  expect(head.answerKey.order).toHaveLength(4)

  await panel.getByRole('button', { name: 'Kapat' }).click()
  await expect(rows(page).filter({ hasText: title })).toContainText('Taslak')
})

test('IST-033: öğretmen eşleştirme sorusunu önizlemede doğru cevapla denetler, listede görür', async ({
  page,
  loginAs,
  tenant,
}) => {
  const school = await tenant({ roles: ['ogretmen'] })
  const title = 'Kesir ve ondalık eşleştirme'
  await loginAs(school.user('ogretmen'))
  await page.goto('/ogretmen/icerik-havuzu')

  const form = await openQuestionForm(page, title, 'matching')
  await form.getByLabel('Soru kökü').fill('Kesirleri ondalık karşılıklarıyla eşleştirin.')
  await form.getByLabel('1. öncül', { exact: true }).fill('1/2')
  await form.getByLabel('1. öncülün eşi').fill('0,5')
  await form.getByLabel('2. öncül', { exact: true }).fill('1/4')
  await form.getByLabel('2. öncülün eşi').fill('0,25')
  await form.getByRole('button', { name: 'Çeldirici ekle' }).click()
  await form.getByLabel('1. çeldirici', { exact: true }).fill('0,75')
  await form.getByLabel('Çözüm açıklaması').fill('Pay paydaya bölünür.')
  await tagAndDeclare(form)

  await form.getByRole('button', { name: 'Soruyu önizle' }).click()
  const preview = page.getByRole('dialog', { name: 'Soru önizlemesi' })
  await preview.getByLabel('1/2').selectOption({ label: '0,5' })
  await preview.getByLabel('1/4').selectOption({ label: '0,75' })
  await preview.getByRole('button', { name: 'Cevabı denetle' }).click()
  await expect(preview.getByRole('status')).toHaveText(
    'Cevap eksik ya da yanlış: 2 maddeden 1 doğru.',
  )
  await preview.getByLabel('1/4').selectOption({ label: '0,25' })
  await preview.getByRole('button', { name: 'Cevabı denetle' }).click()
  await expect(preview.getByRole('status')).toHaveText('Cevap doğru.')
  await preview.getByRole('button', { name: 'Önizlemeyi kapat' }).click()

  await form.getByRole('button', { name: 'Taslağı kaydet' }).click()
  await expect(toast(page, 'Taslak kaydedildi.')).toBeVisible()
  const panel = page.getByRole('dialog', { name: title })
  const summary = panel.getByRole('region', { name: 'İçerik önizlemesi' })
  await expect(summary).toContainText('1/2 → 0,5')
  await expect(summary).toContainText('0,75')
  await panel.getByRole('button', { name: 'Kapat' }).click()
  await expect(rows(page).filter({ hasText: title })).toContainText('Soru')
})

test('IST-033: boşluk doldurmada cevapsız boşluk alanın altında uyarır, kayıt gitmez', async ({
  page,
  loginAs,
  tenant,
}) => {
  const school = await tenant({ roles: ['ogretmen'] })
  await loginAs(school.user('ogretmen'))
  await page.goto('/ogretmen/icerik-havuzu')
  const writes: string[] = []
  page.on('request', (request) => {
    if (request.method() !== 'GET' && request.url().includes('/resources'))
      writes.push(request.url())
  })

  const form = await openQuestionForm(page, 'Kesir boşluk doldurma', 'gap_fill')
  await form.getByLabel('Soru kökü').fill('Yarım, kesir olarak')
  await form.getByRole('button', { name: 'Boşluk ekle' }).click()
  await expect(form.getByLabel('Soru kökü')).toHaveValue('Yarım, kesir olarak {{1}}')
  await tagAndDeclare(form)
  await form.getByRole('button', { name: 'Taslağı kaydet' }).click()

  const accepted = form.getByLabel('1. boşluğun kabul edilen cevapları')
  await expect(accepted).toHaveAttribute('aria-invalid', 'true')
  await expect(form.getByText('En az bir kabul edilen cevap girin.')).toBeVisible()
  expect(writes).toEqual([])

  await accepted.fill('1/2')
  await form.getByLabel('Çözüm açıklaması').fill('Bir bütünün iki eş parçasından biri.')
  await form.getByRole('button', { name: 'Taslağı kaydet' }).click()
  await expect(toast(page, 'Taslak kaydedildi.')).toBeVisible()
  await expect(
    page
      .getByRole('dialog', { name: 'Kesir boşluk doldurma' })
      .getByRole('region', { name: 'İçerik önizlemesi' }),
  ).toContainText('Yarım, kesir olarak ____')
})
