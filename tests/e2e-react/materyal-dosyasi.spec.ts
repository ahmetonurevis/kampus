import type { Page } from '@playwright/test'
import pg from 'pg'

import { e2e } from './support/env.ts'
import { expect, test } from './support/fixtures.ts'

// Materyal dosyası (OG-250; DOM-KYN-006, 051): öğretmen Materyal Kütüphanesi'nden içerik havuzunda
// materyal dosyası taslağı açar, PDF yükler, taslakta bir dosyayı çıkarır ve yayımlar; içerik
// öğrenciyle paylaşılınca öğrenci "Paylaşılan dosyalar" sekmesinden dosyayı açar. Kurum `tenant()`
// ile kurulur; paylaşım (bu ekranda arayüzü yok) API'den yapılır.

const pdf = (name: string) => ({
  name,
  mimeType: 'application/pdf',
  buffer: Buffer.from(
    `%PDF-1.4\n% ${name}\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n`,
    'latin1',
  ),
})
const MAIN = pdf('kesirler-calisma.pdf')
const EXTRA = pdf('kesirler-ek.pdf')

const toast = (page: Page, text: string) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text })

/**
 * E2E API'si tarayıcısız koşar (`FILE_SCANNER=off`, clamd yok): yüklenen dosya `pending` kalır;
 * test kendi kurumunun dosyalarını doğrudan `ready` yapar (taramadan geçmiş gibi;
 * `sorular.spec.ts` ile aynı).
 */
async function markFilesReady(institutionId: string): Promise<void> {
  const client = new pg.Client({ connectionString: e2e.databaseUrl })
  await client.connect()
  try {
    const result = await client.query(
      "update files set status = 'ready' where institution_id = $1 and status = 'pending'",
      [institutionId],
    )
    expect(result.rowCount).toBeGreaterThan(0)
  } finally {
    await client.end()
  }
}

interface HeadFiles {
  data: { resource: { id: string; rowVersion: number }; head: { files: { id: string }[] } }
}

test('DOM-KYN-006: öğretmen materyale PDF ekleyip yayımlar, taslakta dosya çıkarır, öğrenci açar', async ({
  page,
  loginAs,
  api,
  tenant,
}) => {
  const school = await tenant({ roles: ['ogretmen', 'ogrenci'] })
  const title = 'Kesirler çalışma kâğıdı'
  await loginAs(school.user('ogretmen'))
  await page.goto('/ogretmen/materyal-yukle')
  await page.getByRole('link', { name: 'Materyal yükle' }).click()
  await expect(page).toHaveURL(/\/ogretmen\/icerik-havuzu\?icerik-form=yeni-materyal/)

  const form = page.getByRole('dialog', { name: 'Yeni içerik' })
  await expect(form.getByLabel('İçerik türü')).toHaveValue('file')
  await form.getByLabel('Başlık').fill(title)
  await form.getByLabel('Materyal dosyaları', { exact: true }).setInputFiles([MAIN, EXTRA])
  const attached = form.getByRole('list', { name: 'Materyal dosyaları' })
  await expect(attached.getByRole('listitem')).toHaveCount(2)
  await expect(attached.getByRole('listitem').first()).toContainText(MAIN.name)
  await form.getByLabel('Ders').selectOption({ label: 'Matematik' })
  await form.getByLabel('7. sınıf', { exact: true }).check()
  await form.getByRole('button', { name: 'Kazanım ekle' }).click()
  await form.getByLabel('1. kazanım kodu').fill('MAT.7.1.1')
  await form.getByLabel('Menşe ve lisans').selectOption('institution_original')
  await form.getByLabel(/Bu içeriği kullanma hakkım var/).check()
  await markFilesReady(school.institutionId)
  await form.getByRole('button', { name: 'Taslağı kaydet' }).click()
  await expect(toast(page, 'Taslak kaydedildi.')).toBeVisible()

  const panel = page.getByRole('dialog', { name: title })
  const panelFiles = panel.getByRole('list', { name: 'Dosyalar' })
  await expect(panelFiles.getByRole('listitem')).toHaveCount(2)

  // Taslakta ikinci dosya çıkarılır; liste bütün olarak gider.
  await panel.getByRole('button', { name: 'Düzenle' }).click()
  const edit = page.getByRole('dialog', { name: 'Taslağı düzenle' })
  const editFiles = edit.getByRole('list', { name: 'Materyal dosyaları' })
  await expect(editFiles.getByRole('listitem')).toHaveCount(2)
  await edit.getByRole('button', { name: `${EXTRA.name} dosyasını kaldır`, exact: true }).click()
  await expect(editFiles.getByRole('listitem')).toHaveCount(1)
  await edit.getByLabel(/Bu içeriği kullanma hakkım var/).check()
  await edit.getByRole('button', { name: 'Değişiklikleri kaydet' }).click()
  await expect(toast(page, 'Taslak güncellendi.')).toBeVisible()
  await expect(edit).toBeHidden()
  await expect(panelFiles.getByRole('listitem')).toHaveCount(1)
  await expect(panelFiles).toContainText(MAIN.name)

  await panel.getByRole('button', { name: 'Yayımla', exact: true }).click()
  await expect(toast(page, 'İçerik yayımlandı.')).toBeVisible()
  await expect(panel.getByText('Yayında').first()).toBeVisible()

  const resourceId = new URL(page.url()).searchParams.get('icerik') ?? ''
  expect(resourceId).not.toBe('')
  const teacher = await api(school.user('ogretmen'))
  const detail = await teacher.get(`/api/v1/resources/${resourceId}`)
  expect(detail.status).toBe(200)
  const { resource, head } = (detail.body as HeadFiles).data
  expect(head.files).toHaveLength(1)
  const fileId = head.files[0]?.id ?? ''

  // Paylaşılmadan öğrenci dosyayı açamaz; öğrenciyle paylaşılınca açar (DOM-KYN-040).
  const student = await api(school.user('ogrenci'))
  expect((await student.get(`/api/v1/files/${fileId}/url`)).status).toBe(404)
  const admin = await api(school.user('yonetici'))
  const shared = await admin.post(
    `/api/v1/resources/${resourceId}/share`,
    { scope: 'students', studentIds: ['s1'] },
    { 'if-match': `"${resource.rowVersion}"` },
  )
  expect(shared.status).toBe(200)
  expect((await student.get(`/api/v1/files/${fileId}/url`)).status).toBe(200)

  await loginAs(school.user('ogrenci'), { fresh: true })
  await page.goto('/ogrenci/materyaller?sekme=paylasilan')
  await page.getByRole('button', { name: `${title} dosyalarını göster`, exact: true }).click()
  const learnerPanel = page.getByRole('dialog', { name: title })
  const learnerFiles = learnerPanel.getByRole('list', { name: 'Dosyalar' })
  await expect(learnerFiles.getByRole('listitem')).toHaveCount(1)
  // PDF `attachment` olarak iner; yeni sekme indirmeyi başlatır, adresi `about:blank` kalabilir.
  // Bu yüzden imzalı bağlantı yanıtı doğrulanır.
  const [popup, link] = await Promise.all([
    page.waitForEvent('popup'),
    page.waitForResponse((response) => response.url().includes(`/api/v1/files/${fileId}/url`)),
    learnerFiles.getByRole('button', { name: `${MAIN.name} dosyasını aç`, exact: true }).click(),
  ])
  expect(link.status()).toBe(200)
  expect(((await link.json()) as { data: { url: string } }).data.url).toContain(
    '/api/v1/files/download',
  )
  await popup.close()
})
