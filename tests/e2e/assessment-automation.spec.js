import { test, expect } from '@playwright/test'
import { restoreSnapshot } from '../../packages/school-core/src/lib/demo-persistence.ts'
const fixedTime = '2026-10-06T10:00:00.000Z'
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(fixedTime)
})
const stored = async (page) =>
  restoreSnapshot(await page.evaluate(() => localStorage.getItem('kampus-private-school-v1')))
const csv = 'student;booklet;answers\n2026001;A;BBBDABCDABCD'
async function importOptical(page, role = 'yonetici') {
  await page.goto(`/${role}/optik-degerlendirme`)
  await page
    .getByLabel('Optik cevap dosyası', { exact: true })
    .setInputFiles({ name: 'cevaplar.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await expect(page.getByLabel('Optik dosya içeriği', { exact: true })).toHaveValue(csv)
  await page.getByRole('button', { name: 'Sonuçları önizle', exact: true }).click()
  await page.getByRole('button', { name: 'Onayla ve sonuçları kaydet', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Değerlendirme önizlemesi', exact: true }),
  ).toHaveCount(0)
}
async function createTutor(page) {
  await importOptical(page, 'ogretmen')
  await page.getByRole('link', { name: 'Otomatik etüt planla', exact: true }).click()
  await page.getByRole('button', { name: 'Etüt planını önizle', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Etüt planı önizlemesi', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Onayla ve etütleri oluştur', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Etüt planı önizlemesi', exact: true }),
  ).toHaveCount(0)
}

test('Optik CSV dosyası önce önizlenir; hatalı aktarım kayıt değiştirmez ve kazanım ayrıntısı velide görünür', async ({
  page,
}) => {
  await page.goto('/yonetici/optik-degerlendirme')
  const before = (await stored(page)).mockResults
  await page
    .getByLabel('Optik dosya içeriği', { exact: true })
    .fill(csv + '\nunknown;A;ABCDABCDABCD')
  await page.getByRole('button', { name: 'Sonuçları önizle', exact: true }).click()
  await expect(page.locator('main [role="alert"]')).toContainText('tekil eşleşmedi')
  expect((await stored(page)).mockResults).toEqual(before)
  await page.getByLabel('Optik dosya içeriği', { exact: true }).fill(csv)
  await page.getByRole('button', { name: 'Sonuçları önizle', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Değerlendirme önizlemesi', exact: true }),
  ).toBeVisible()
  expect((await stored(page)).opticalEvaluations).toHaveLength(0)
  await page.getByRole('button', { name: 'Onayla ve sonuçları kaydet', exact: true }).click()
  expect((await stored(page)).opticalEvaluations).toHaveLength(3)
  await page.goto('/veli/deneme-sinavlari')
  await page.getByRole('button', { name: '7. Sınıf Hazırlık Denemesi 1', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Denklemler: %50 (2/4)')
  await expect(page.getByRole('dialog')).toContainText('1. soru: Yanlış')
  await page.reload()
  await expect(page.getByRole('dialog')).toContainText('Optik kazanım analizi')
})
test('Sabit alanlı DAT dosyası Windows-1254 kodlaması ve B kitapçığıyla değerlendirilir', async ({
  page,
}) => {
  await page.goto('/yonetici/optik-degerlendirme')
  await page.getByRole('button', { name: 'Profili düzenle', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('combobox', { name: 'Dosya biçimi', exact: true }).selectOption('fixed')
  await dialog.getByLabel('Atlanacak başlık satırı', { exact: true }).fill('1')
  await dialog.getByRole('button', { name: 'Profili kontrol et', exact: true }).click()
  await dialog.getByRole('button', { name: 'Onayla ve profili kaydet', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page
    .getByRole('combobox', { name: 'Karakter kodlaması', exact: true })
    .selectOption('windows-1254')
  const content = Buffer.concat([
    Buffer.from([66, 97, 254, 108, 253, 107, 10]),
    Buffer.from('2026001BDCBADCBADCBA'),
  ])
  await page
    .getByLabel('Optik cevap dosyası', { exact: true })
    .setInputFiles({ name: 'okuyucu.dat', mimeType: 'text/plain', buffer: content })
  await expect(page.getByLabel('Optik dosya içeriği', { exact: true })).toHaveValue(/Başlık/)
  await page.getByRole('button', { name: 'Sonuçları önizle', exact: true }).click()
  await page.getByRole('button', { name: 'Onayla ve sonuçları kaydet', exact: true }).click()
  const state = await stored(page)
  expect(state.opticalEvaluations).toHaveLength(3)
  expect(state.opticalEvaluations.every((r) => r.booklet === 'B' && r.correct === 4)).toBe(true)
})
test('Eksik kazanımdan etüt planı oluşturulur; tekrar çoğalmaz, öğrenci/veli takvimi ve çocuk kapsamı korunur', async ({
  page,
}) => {
  await createTutor(page)
  const state = await stored(page)
  expect(state.tutorSessions).toHaveLength(1)
  expect(state.tutorSessions[0].topic).toBe('Denklemler')
  expect(state.tutorSessions[0].studentIds).toEqual(['s1'])
  await page.getByRole('button', { name: 'Etüt planını önizle', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Onayla ve etütleri oluştur', exact: true }),
  ).toBeDisabled()
  await expect(page.getByText(/1 öğrenci\/kazanım zaten etütte/)).toBeVisible()
  await page.goto('/ogrenci/ders-programi')
  await expect(page.getByRole('button', { name: /Etüt · Matematik · Denklemler/ })).toBeVisible()
  await page.goto('/veli/otomatik-etut')
  await page.getByRole('button', { name: 'Matematik · Denklemler', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Deniz Yılmaz')
  await page.getByRole('button', { name: 'Pencereyi kapat', exact: true }).click()
  await page.getByLabel('Çocuk seç', { exact: true }).selectOption('s2')
  await expect(
    page.getByRole('button', { name: 'Matematik · Denklemler', exact: true }),
  ).toHaveCount(0)
})
test('Öğretmen etüt yoklamasını günceller; sonuç veliye yansır ve tamamlanan etüt iptal edilemez', async ({
  page,
}) => {
  await createTutor(page)
  await page.clock.setFixedTime('2026-10-07T14:00:00.000Z')
  await page.goto('/ogretmen/otomatik-etut')
  await page.getByRole('button', { name: 'Matematik · Denklemler', exact: true }).click()
  await page.getByRole('button', { name: 'Yoklama al / güncelle', exact: true }).click()
  await page
    .getByRole('dialog')
    .last()
    .getByRole('combobox', { name: 'Deniz Yılmaz', exact: true })
    .selectOption('İzinli')
  await page.getByRole('button', { name: 'Yoklamayı kaydet', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Tamamlandı')
  await expect(page.getByRole('button', { name: 'Etüdü iptal et', exact: true })).toHaveCount(0)
  await page.goto('/veli/otomatik-etut')
  await page.getByRole('button', { name: 'Matematik · Denklemler', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('İzinli')
})
test('Uygunluk saati eklenir; yeterli sürede saat yoksa yerleşmeyen grup açıklanır', async ({
  page,
}) => {
  await importOptical(page, 'ogretmen')
  await page.goto('/ogretmen/otomatik-etut?sinav=exam-7-1')
  await page.getByLabel('Etüt süresi (dakika)', { exact: true }).fill('60')
  await page.getByRole('button', { name: 'Etüt planını önizle', exact: true }).click()
  await expect(
    page.getByText('Tarih aralığında yeterli sürede öğretmen uygunluk saati yok.', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Uygunluk saati ekle', exact: true }).click()
  await page.getByLabel('Uygunluk tarihi ve saati', { exact: true }).fill('2026-10-12T16:00')
  await page.getByLabel('Uygunluk süresi (dakika)', { exact: true }).fill('60')
  await page.getByRole('button', { name: 'Uygunluk saatini kaydet', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Etüt planını önizle', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Onayla ve etütleri oluştur', exact: true }),
  ).toBeEnabled()
  const state = await stored(page)
  expect(
    state.availability.some((s) => s.date === '2026-10-12T13:00:00.000Z' && s.duration === 60),
  ).toBe(true)
})
test('Optik ve etüt modülleri bağımsız kapanır; dar ve koyu ekranda profil formu taşmaz', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/yonetici/optik-degerlendirme')
  await page.getByRole('button', { name: 'Koyu temaya geç', exact: true }).click()
  await page.getByRole('button', { name: 'Profili düzenle', exact: true }).click()
  await page.getByRole('combobox', { name: 'Dosya biçimi', exact: true }).selectOption('fixed')
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await expect(page.getByLabel('Cevap alanı uzunluğu', { exact: true })).toHaveValue('12')
  await page.getByRole('button', { name: 'Vazgeç', exact: true }).click()
  await page.goto('/yonetici/ayarlar')
  await page.getByRole('switch', { name: 'Optik Değerlendirme', exact: true }).click()
  await page.goto('/yonetici/optik-degerlendirme')
  await expect(page).toHaveURL(/yonetici\/dashboard/)
  await page.goto('/ogretmen/otomatik-etut')
  await expect(page.locator('main h1')).toContainText('Otomatik Etüt')
  await page.goto('/yonetici/ayarlar')
  await page.getByRole('switch', { name: 'Otomatik Etüt', exact: true }).click()
  await page.goto('/veli/otomatik-etut')
  await expect(page).toHaveURL(/veli\/dashboard/)
})
