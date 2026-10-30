import { test, expect } from '@playwright/test'
import { restoreSnapshot } from '../../packages/school-core/src/lib/demo-persistence.ts'
const stored = async (page) =>
  restoreSnapshot(await page.evaluate(() => localStorage.getItem('kampus-private-school-v1')))
async function save(page) {
  const count = await page.getByRole('dialog').count()
  const dialog = page.getByRole('dialog').last()
  await dialog.getByRole('button', { name: 'Kontrol et', exact: true }).click()
  await dialog.getByRole('button', { name: 'Onayla ve kaydet', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(count - 1)
}

test('Depolama doluysa yeni işlem kaydedilmez; form ve önceki kayıtlar korunur', async ({
  page,
}) => {
  await page.goto('/yonetici/rehberlik')
  const before = (await stored(page)).guidanceCases
  await page.getByRole('button', { name: 'Takip dosyası aç', exact: true }).click()
  const dialog = page.getByRole('dialog').last()
  await dialog.getByLabel('Takip başlığı', { exact: true }).fill('Kaydedilemeyen takip')
  await dialog.getByLabel('Destek planı', { exact: true }).fill('Haftalık tekrar planı.')
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === 'kampus-private-school-v1')
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      return original.call(this, key, value)
    }
  })
  await dialog.getByRole('button', { name: 'Kontrol et', exact: true }).click()
  await dialog.getByRole('button', { name: 'Onayla ve kaydet', exact: true }).click()
  await expect(
    page.getByText('Depolama alanı dolu. İşlem kaydedilmedi; yer açıp tekrar deneyin.', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(dialog).toBeVisible()
  expect((await stored(page)).guidanceCases).toEqual(before)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Kaydedilemeyen takip', exact: true })).toHaveCount(
    0,
  )
})

test('Rehberlik dosyası ve iç notlar rol geçişinde doğru görünür', async ({ page }) => {
  await page.goto('/ogretmen/rehberlik')
  await page.getByRole('button', { name: 'Takip dosyası aç', exact: true }).click()
  const dialog = page.getByRole('dialog').last()
  await dialog.getByLabel('Takip başlığı', { exact: true }).fill('Test rehberlik dosyası')
  await dialog.getByLabel('Destek planı', { exact: true }).fill('Haftada üç gün tekrar çalışması.')
  await dialog
    .getByLabel('Veli ve öğrenciyle paylaşılan not', { exact: true })
    .fill('Paylaşılan gelişim notu.')
  await dialog.getByLabel('Kurum içi not', { exact: true }).fill('Gizli kurum içi görüşme.')
  await save(page)
  await page.goto('/veli/rehberlik')
  await page.getByRole('button', { name: 'Test rehberlik dosyası', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Paylaşılan gelişim notu.')
  await expect(page.getByText('Gizli kurum içi görüşme.')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('dialog')).toContainText('Paylaşılan gelişim notu.')
})
test('Deneme CSV aktarımı çalışma görevine dönüşür; öğrenci teslimi ve öğretmen değerlendirmesi veliye yansır', async ({
  page,
}) => {
  await page.goto('/ogretmen/deneme-sinavlari')
  await page.getByRole('button', { name: 'CSV sonuç aktar', exact: true }).click()
  const csv =
    'examId;studentId;subjectId;correct;wrong;blank;weakTopics\nexam-7-1;s1;math;16;2;2;Denklemler'
  await page.getByLabel('CSV dosyası seç', { exact: true }).setInputFiles({
    name: 'deneme.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8'),
  })
  await expect(page.getByLabel('CSV içeriği', { exact: true })).toHaveValue(csv)
  await save(page)
  const state = await stored(page)
  expect(
    state.mockResults.find(
      (r) => r.examId === 'exam-7-1' && r.studentId === 's1' && r.subjectId === 'math',
    ).correct,
  ).toBe(16)
  await page.getByRole('button', { name: '7. Sınıf Hazırlık Denemesi 1', exact: true }).click()
  await page
    .getByRole('button', { name: 'Deniz Yılmaz · Matematik çalışma planı', exact: true })
    .click()
  const dialog = page.getByRole('dialog').last()
  await expect(dialog.getByLabel('Çalışılacak konular', { exact: true })).toHaveValue('Denklemler')
  await dialog
    .getByLabel('Çalışma yönergesi', { exact: true })
    .fill('Beş soru çöz ve adımlarını açıkla.')
  await save(page)
  await page.goto('/ogrenci/calisma-plani')
  await page.getByRole('button', { name: 'Matematik konu tekrarı', exact: true }).click()
  await page.getByRole('button', { name: 'Çalışmayı teslim et', exact: true }).click()
  await page
    .getByLabel('Çalışma sonucu / öğrenci notu', { exact: true })
    .fill('Beş soruyu çözüm adımlarıyla tamamladım.')
  await save(page)
  await page.goto('/ogretmen/calisma-plani')
  await page.getByRole('button', { name: 'Matematik konu tekrarı', exact: true }).click()
  await page.getByRole('button', { name: 'Çalışmayı değerlendir', exact: true }).click()
  await page.getByLabel('Öğretmen geri bildirimi', { exact: true }).fill('Çözüm adımların doğru.')
  await save(page)
  await page.goto('/veli/calisma-plani')
  await page.getByRole('button', { name: 'Matematik konu tekrarı', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Çözüm adımların doğru.')
})
test('Kayıt yenileme önizlemesi sözleşme ve taksitleri oluşturur; ayrı dönem geçişi geçmişi korur', async ({
  page,
}) => {
  await page.goto('/onburo/kayit-yenileme')
  await page.getByRole('button', { name: 'Kayıt yenile', exact: true }).click()
  const dialog = page.getByRole('dialog').last()
  await dialog.getByLabel('Yeni sınıf', { exact: true }).selectOption('c4')
  await dialog.getByLabel('Burs oranı (%)', { exact: true }).fill('10')
  await dialog.getByLabel('Ek indirim (₺)', { exact: true }).fill('500')
  await expect(dialog).toContainText('25.150,00 ₺')
  const before = await stored(page)
  await save(page)
  let state = await stored(page)
  expect(state.students[0].classId).toBe('c1')
  expect(state.invoices.length).toBe(before.invoices.length + 8)
  await page.getByRole('button', { name: 'Deniz Yılmaz', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Yeni dönem sözleşmesi', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Dönem geçişini uygula', exact: true }).click()
  await save(page)
  state = await stored(page)
  expect(state.students[0].classId).toBe('c4')
  expect(state.grades).toEqual(before.grades)
  expect(state.attendance).toEqual(before.attendance)
})
test('Veli etkinlik onayı yalnızca seçili çocuk adına kaydedilir ve yöneticiye yansır', async ({
  page,
}) => {
  await page.goto('/veli/okul-takvimi')
  await page.getByRole('button', { name: 'Bilim müzesi gezisi', exact: true }).click()
  await page.getByRole('button', { name: 'Veli onayı ver / güncelle', exact: true }).click()
  await page.getByLabel('Veli notu', { exact: true }).fill('Geziye katılabilir.')
  await save(page)
  expect((await stored(page)).eventConsents[0].studentId).toBe('s1')
  await page.goto('/yonetici/okul-takvimi')
  await page.getByRole('button', { name: 'Bilim müzesi gezisi', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Deniz Yılmaz: Onaylandı')
  await expect(page.getByRole('dialog')).toContainText('Ece Yılmaz: Onay bekliyor')
})
test('Servis durağı ve yemek alerjen güncellemesi veli ekranına yansır; kulüp kaydı kalıcıdır', async ({
  page,
}) => {
  await page.goto('/onburo/okul-servisi')
  await page.getByRole('button', { name: 'Öğrenci ata', exact: true }).click()
  await page.getByLabel('Biniş durağı', { exact: true }).selectOption('Bahariye')
  await save(page)
  await page.goto('/veli/okul-servisi')
  await page.getByRole('button', { name: 'Moda – Kadıköy', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Deniz Yılmaz · Bahariye')
  await page.goto('/onburo/yemek-menusu')
  await page.getByRole('button', { name: 'Ayrıntılar', exact: true }).first().click()
  await page.getByRole('button', { name: 'Menüyü düzenle', exact: true }).click()
  await page.getByLabel('Alerjen bilgisi', { exact: true }).fill('Süt, gluten, yumurta')
  await save(page)
  await page.goto('/veli/yemek-menusu')
  await expect(page.locator('main')).toContainText('Süt, gluten, yumurta')
  await page.goto('/ogrenci/kulupler')
  await page.getByRole('button', { name: 'Sanat Atölyesi', exact: true }).click()
  await page.getByRole('button', { name: 'Kulübe kaydol / öğrenci ekle', exact: true }).click()
  await save(page)
  await page.reload()
  await expect(page.getByRole('dialog')).toContainText('Kayıtlı')
  const state = await stored(page)
  expect(
    state.clubMemberships.filter((m) => m.clubId === 'club-art' && m.studentId === 's1'),
  ).toHaveLength(1)
})
test('Program ekleme ve çakışma kontrolü; iptal günlük programa yansımaz', async ({ page }) => {
  await page.goto('/yonetici/program-yonetimi')
  await page.getByRole('button', { name: 'Ders planla', exact: true }).click()
  await page.getByLabel('Ders başlangıcı', { exact: true }).fill('2027-03-15T10:00')
  await save(page)
  const before = await stored(page),
    lesson = before.schedule.find((l) => l.date === '2027-03-15T07:00:00.000Z')
  expect(lesson).toBeTruthy()
  await page.getByRole('button', { name: 'Ders planla', exact: true }).click()
  await page.getByLabel('Ders başlangıcı', { exact: true }).fill('2027-03-15T10:00')
  await page
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: 'Kontrol et', exact: true })
    .click()
  await page
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: 'Onayla ve kaydet', exact: true })
    .click()
  await expect(page.locator('.toast').filter({ hasText: 'bu saatte başka dersi' })).toBeVisible()
  expect((await stored(page)).schedule.length).toBe(before.schedule.length)
})
test('Yeni modül kapatılınca doğrudan erişim kapanır; dar ve koyu ekranda formlar taşmaz', async ({
  page,
}) => {
  await page.goto('/yonetici/ayarlar')
  await page.getByRole('switch', { name: 'Rehberlik & Takip', exact: true }).click()
  await page.goto('/veli/rehberlik')
  await expect(page).toHaveURL(/veli\/dashboard/)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/onburo/kayit-yenileme')
  await page.getByRole('button', { name: 'Kayıt yenile', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Vazgeç', exact: true }).click()
  await page.getByRole('button', { name: 'Koyu temaya geç', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})
