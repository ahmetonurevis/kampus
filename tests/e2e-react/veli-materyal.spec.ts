import { expect, test } from './support/fixtures.ts'
import { pdf, publishSharedMaterial } from './support/materials.ts'

// Veli materyal sayfası (OG-982; DOM-KYN-006, 041): öğretmen Deniz'in (7-A) ve Ece'nin (5-A)
// sınıflarına ayrı birer materyal dosyası paylaşır; veli `/veli/materyaller`'de çocuğunu seçer,
// yalnız o çocuğa paylaşılan materyali görür ve dosyasını açar. Kurulum API'den (`tenant()`).

const DENIZ = { title: 'Kesirler çalışma kâğıdı', file: pdf('kesirler-7.pdf') }
const ECE = { title: 'Doğal sayılar özeti', file: pdf('dogal-sayilar-5.pdf') }

test('DOM-KYN-041: veli çocuğunu seçer, ona paylaşılan materyal dosyasını açar; öbür çocuğun materyali görünmez', async ({
  page,
  loginAs,
  api,
  tenant,
}) => {
  const school = await tenant({ roles: ['ogretmen', 'veli'] })
  const teacher = await api(school.user('ogretmen'))
  const deniz = await publishSharedMaterial(teacher, school.institutionId, {
    ...DENIZ,
    gradeLevel: 7,
    classIds: ['c1'],
  })
  await publishSharedMaterial(teacher, school.institutionId, {
    ...ECE,
    gradeLevel: 5,
    classIds: ['c2'],
  })

  await loginAs(school.user('veli'))
  await page.goto('/veli/materyaller?cocuk=s1')
  await expect(page.getByRole('heading', { name: 'Materyaller', level: 1 })).toBeVisible()
  const section = page.getByRole('region', { name: 'Paylaşılan dosyalar' })
  await expect(section.getByText('1 paylaşılan materyal')).toBeVisible()
  const open = (title: string) =>
    page.getByRole('button', { name: `${title} dosyalarını göster`, exact: true })
  await expect(open(DENIZ.title)).toBeVisible()
  await expect(open(ECE.title)).toHaveCount(0)
  // Salt okunur: yükleme ve paylaşma düğmesi yok.
  await expect(page.getByRole('button', { name: /yükle|paylaş/i })).toHaveCount(0)

  await open(DENIZ.title).click()
  const panel = page.getByRole('dialog', { name: DENIZ.title })
  const files = panel.getByRole('list', { name: 'Dosyalar' })
  await expect(files.getByRole('listitem')).toHaveCount(1)
  // PDF `attachment` olarak iner; imzalı bağlantı yanıtı doğrulanır (materyal-dosyasi.spec.ts).
  const [popup, link] = await Promise.all([
    page.waitForEvent('popup'),
    page.waitForResponse((response) =>
      response.url().includes(`/api/v1/files/${deniz.fileId}/url`),
    ),
    files.getByRole('button', { name: `${DENIZ.file.name} dosyasını aç`, exact: true }).click(),
  ])
  expect(link.status()).toBe(200)
  await popup.close()
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()

  // Çocuk değişince liste o çocuğa daralır: Deniz'in materyali Ece'de görünmez.
  await page.getByLabel('Çocuk seç').selectOption({ label: 'Ece Yılmaz' })
  await expect(page).toHaveURL(/[?&]cocuk=s2/)
  await expect(open(ECE.title)).toBeVisible()
  await expect(open(DENIZ.title)).toHaveCount(0)
  await expect(section.getByText('1 paylaşılan materyal')).toBeVisible()
})
