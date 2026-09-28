import { test, expect } from '@playwright/test'
import { restoreSnapshot } from '../../apps/web/src/lib/demo-persistence.js'

const stored = async (page) =>
  restoreSnapshot(await page.evaluate(() => localStorage.getItem('kampus-private-school-v1')))

test('İşlem sütunu sağda görünür; uzun sınıf listesi klavyeyle açılır', async ({ page }) => {
  await page.goto('/yonetici/personel')
  const edit = page.getByRole('button', { name: 'Selin Kaya düzenle' })
  await expect(edit).toBeInViewport()
  const sticky = page.locator('tbody .sticky-actions').first()
  expect(await sticky.evaluate((el) => getComputedStyle(el).position)).toBe('sticky')
  const compact = page.locator('.compact-list').first()
  await expect(compact.getByRole('button')).toHaveText('+6 sınıf')
  await compact.getByRole('button').focus()
  await page.keyboard.press('Enter')
  await expect(compact).toContainText('12-A')
  await page.keyboard.press('Enter')
  await expect(compact.locator('.compact-list-more')).toHaveCount(0)
})

test('Aday detayından geri dönünce filtre, sıralama, sayfa ve konum korunur', async ({ page }) => {
  await page.goto('/onburo/adaylar')
  await page.getByRole('button', { name: 'Filtreler', exact: true }).click()
  await page.getByLabel('Şube', { exact: true }).selectOption('Kadıköy Kampüsü')
  await page.getByRole('button', { name: 'Aday öğrenci', exact: true }).click()
  await page.getByRole('button', { name: 'Sonraki sayfa' }).click()
  await expect(page.locator('.pagination [aria-current]')).toHaveText('2')
  const name = await page.locator('tbody .person-cell strong').first().innerText()
  const details = page.locator('tbody .sticky-actions a').first()
  await details.scrollIntoViewIfNeeded()
  const scroll = await page.evaluate(() => scrollY)
  await details.click()
  await expect(page.locator('main h1')).toHaveText(name)
  await page.goBack()
  await expect(page.locator('.pagination [aria-current]')).toHaveText('2')
  await expect(page.getByLabel('Şube', { exact: true })).toHaveValue('Kadıköy Kampüsü')
  await expect(page.locator('thead th').first()).toHaveAttribute('aria-sort', 'ascending')
  await expect(page.locator('tbody .person-cell strong').first()).toHaveText(name)
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(scroll, -1)
  await page.reload()
  await expect(page.locator('.pagination [aria-current]')).toHaveText('2')
  await expect(page.getByLabel('Şube', { exact: true })).toHaveValue('Kadıköy Kampüsü')
})

test('Kaydırılan tabloda başlık sabit kalır; detaydan dönüş ve yenileme konumu korur', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto('/onburo/adaylar')
  await page.getByLabel('Sayfa başına kayıt').selectOption('16')
  const region = page.locator('.data-table .table-scroll')
  await region.evaluate((element) => element.scrollTo({ top: 360, left: 100 }))
  await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBe(360)
  const regionBox = await region.boundingBox()
  const headerBox = await region.locator('thead th').first().boundingBox()
  expect(Math.abs(headerBox.y - regionBox.y)).toBeLessThan(2)

  const row = region.locator('tbody tr').nth(8)
  const name = await row.locator('.person-cell strong').innerText()
  const details = row.locator('.sticky-actions a')
  await details.scrollIntoViewIfNeeded()
  const position = await region.evaluate((element) => ({
    top: element.scrollTop,
    left: element.scrollLeft,
  }))
  expect(position.top).toBeGreaterThan(0)
  await details.click()
  await expect(page.locator('main h1')).toHaveText(name)
  await page.goBack()
  await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBe(position.top)
  await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBe(position.left)
  await page.reload()
  await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBe(position.top)
  await page.getByRole('button', { name: 'Sonraki sayfa' }).click()
  await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBe(0)
  await region.evaluate((element) => (element.scrollTop = 180))
  await page.getByLabel('Tabloda ara').fill('Deniz')
  await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBe(0)
  await expect(page.locator('.pagination [aria-current]')).toHaveText('1')
})

test('Hazır ödeme filtreleri çocuklar arasında karışmaz ve sıfırlanabilir', async ({ page }) => {
  await page.goto('/veli/finans')
  await page.getByRole('button', { name: 'Geciken ödemeler', exact: true }).click()
  await expect(page.getByLabel('Ödeme durumu')).toHaveValue('Gecikmiş')
  await page.getByLabel('Çocuk seç', { exact: true }).selectOption('s2')
  await expect(page.getByLabel('Ödeme durumu')).toHaveValue('all')
  await expect(page.locator('tbody')).toContainText('Ece Yılmaz')
  await page.getByLabel('Çocuk seç', { exact: true }).selectOption('s1')
  await expect(page.getByLabel('Ödeme durumu')).toHaveValue('Gecikmiş')
  await expect(page.locator('tbody')).not.toContainText('Ece Yılmaz')
  await page.getByRole('button', { name: 'Aramayı ve filtreleri temizle', exact: true }).click()
  await expect(page.getByLabel('Ödeme durumu')).toHaveValue('all')
})

test('Mobil taksit kartı tutar ve durumu gösterir, seçilen taksidi ödeme ekranına taşır', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/veli/finans')
  await expect(page.locator('.data-table table')).toHaveCount(0)
  const card = page.locator('.mobile-record').filter({ hasText: '5. taksit' })
  await expect(card).toContainText('24.500,00 ₺')
  await expect(card).toContainText('Yaklaşan')
  const expected = (await stored(page)).invoices.find(
    (i) => i.studentId === 's1' && i.installment === 5,
  )
  await card.getByRole('link', { name: 'Öde', exact: true }).click()
  await expect(page.getByLabel('Ödenecek taksit')).toHaveValue(expected.id)
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
})

test('Sınıf adımları alan hatalarını gösterir, yalnızca son onayda kayıt oluşturur', async ({
  page,
}) => {
  await page.goto('/yonetici/subeler')
  const before = (await stored(page)).classes.length
  await page.getByRole('button', { name: 'Sınıf ekle', exact: true }).click()
  await page.getByRole('button', { name: 'Devam et', exact: true }).click()
  await expect(page.getByLabel('Derslik', { exact: true })).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByLabel('Derslik', { exact: true })).toBeFocused()
  await page.getByLabel('Derslik', { exact: true }).fill('UX-401')
  await page.getByRole('button', { name: 'Devam et', exact: true }).click()
  await page.getByLabel('Matematik öğretmeni', { exact: true }).selectOption('')
  await page.getByRole('button', { name: 'Devam et', exact: true }).click()
  await expect(page.getByLabel('Matematik öğretmeni', { exact: true })).toBeFocused()
  await page.getByLabel('Matematik öğretmeni', { exact: true }).selectOption('t1')
  await page.getByRole('button', { name: 'Devam et', exact: true }).click()
  await expect(page.locator('.review-grid')).toContainText('UX-401')
  expect((await stored(page)).classes).toHaveLength(before)
  await page.getByRole('button', { name: 'Geri', exact: true }).click()
  await expect(page.getByLabel('Matematik öğretmeni', { exact: true })).toHaveValue('t1')
  await page.getByRole('button', { name: 'Devam et', exact: true }).click()
  await page.getByRole('button', { name: 'Kaydet', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect((await stored(page)).classes).toHaveLength(before + 1)
})

test('Kesin kayıt ödeme adımı hatalı tutarı engeller ve geri dönüşte bilgiyi korur', async ({
  page,
}) => {
  await page.goto('/onburo/kayit-islemleri')
  const before = (await stored(page)).students.length
  await page.getByRole('button', { name: 'Devam et', exact: true }).click()
  await expect(page.getByLabel('Aday öğrenci', { exact: true })).toBeFocused()
  const candidate = (await stored(page)).prospects.find((p) => !p.studentId)
  await page.getByLabel('Aday öğrenci', { exact: true }).selectOption(candidate.id)
  await page.getByRole('button', { name: 'Devam et', exact: true }).click()
  await page.getByLabel('Toplam eğitim bedeli (₺)').fill('0')
  await page.getByRole('button', { name: 'Devam et', exact: true }).click()
  await expect(page.getByText('Tutar en az 100 ₺ olmalıdır.', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Toplam eğitim bedeli (₺)')).toBeFocused()
  await page.getByLabel('Toplam eğitim bedeli (₺)').fill('123456')
  await page.getByRole('button', { name: 'Devam et', exact: true }).click()
  await expect(page.locator('.review-grid')).toContainText('123.456,00 ₺')
  expect((await stored(page)).students).toHaveLength(before)
  await page.getByRole('button', { name: 'Geri', exact: true }).click()
  await expect(page.getByLabel('Toplam eğitim bedeli (₺)')).toHaveValue('123456')
})

test('Mobil portal menüsü klavye ile açılır; gruplar katlanır ve kapalı modül menüde görünmez', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/ogrenci/dashboard')
  const menuButton = page.getByRole('button', { name: 'Menüyü aç', exact: true })
  await menuButton.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Menüyü kapat' })).toBeFocused()
  const group = page.getByRole('button', { name: 'Derslerim', exact: true })
  await group.click()
  await expect(group).toHaveAttribute('aria-expanded', 'true')
  await expect(
    page.locator('.sidebar').getByRole('link', { name: 'Ders Videoları', exact: true }),
  ).toBeVisible()
  await group.click()
  await expect(
    page.locator('.sidebar').getByRole('link', { name: 'Ders Videoları', exact: true }),
  ).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(menuButton).toBeFocused()
  await page.goto('/yonetici/ayarlar')
  await page.getByRole('switch', { name: 'Dijital öğrenme' }).click()
  await page.goto('/ogrenci/dashboard')
  await menuButton.click()
  await expect(page.locator('.sidebar').getByRole('link', { name: 'Ödevlerim' })).toHaveCount(0)
  await expect(page.locator('.sidebar').getByRole('link', { name: 'Ders Videoları' })).toHaveCount(
    0,
  )
})

test('PDF önizleme hatasında yeniden deneme, yazdırma, iptal ve URL temizliği', async ({
  page,
}) => {
  const downloads = []
  page.on('download', (file) => downloads.push(file))
  await page.route('**/fonts/NotoSans-Regular.ttf', (route) =>
    route.fulfill({ status: 503, body: '' }),
  )
  await page.goto('/veli/dekontlar')
  await page.getByRole('button', { name: 'Dekont', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: /Önizleme/ })
  await expect(
    dialog.getByText('Belge hazırlanamadı. Lütfen yeniden deneyin.', { exact: true }),
  ).toBeVisible()
  await page.unroute('**/fonts/NotoSans-Regular.ttf')
  await dialog.getByRole('button', { name: 'Yeniden dene' }).click()
  await expect(dialog.locator('.pdf-viewport')).toHaveAttribute('aria-busy', 'false')
  await expect(dialog.locator('.pdf-viewport .sr-only')).toContainText('Deniz Yılmaz')
  const paintedPixels = await dialog.locator('canvas').evaluate((canvas) => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let count = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 230 && data[i + 1] < 230 && data[i + 2] < 230 && data[i + 3] > 0) count++
    }
    return count
  })
  expect(paintedPixels).toBeGreaterThan(1000)
  const url = await dialog.locator('a[target="_blank"]').getAttribute('href')
  expect(
    await page.evaluate(async (url) => (await fetch(url)).headers.get('content-type'), url),
  ).toBe('application/pdf')
  await page.evaluate(() => {
    const open = window.open.bind(window)
    window.open = (...args) => {
      const popup = open(...args)
      popup.print = () => {
        popup.pdfPrintCalled = true
      }
      return popup
    }
  })
  const popupPromise = page.waitForEvent('popup')
  await dialog.getByRole('button', { name: 'Yazdır', exact: true }).click()
  const popup = await popupPromise
  await expect.poll(() => popup.evaluate(() => window.pdfPrintCalled)).toBe(true)
  await expect(popup.locator('img')).toHaveCount(1)
  expect(await popup.locator('img').evaluate((image) => image.naturalWidth)).toBeGreaterThan(1000)
  await popup.close()
  expect(downloads).toHaveLength(0)
  await dialog.getByRole('button', { name: 'Pencereyi kapat' }).click()
  expect(
    await page.evaluate(async (url) => {
      try {
        await fetch(url)
        return false
      } catch {
        return true
      }
    }, url),
  ).toBe(true)
  await expect(page.getByRole('button', { name: 'Dekont', exact: true }).first()).toBeFocused()
})

test('Mobil PDF önizlemede çok sayfalı sözleşme gezilir ve yakınlaştırma pencereyi taşırmaz', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/veli/sozlesmeler')
  await page.getByRole('button', { name: 'Sözleşmeyi görüntüle' }).click()
  const dialog = page.getByRole('dialog', { name: /Önizleme/ })
  await expect(dialog.locator('.pdf-viewport')).toHaveAttribute('aria-busy', 'false')
  await expect(dialog.locator('.pdf-page-controls')).toContainText('Sayfa 1 / 2')
  await expect(dialog.getByRole('button', { name: 'Önceki PDF sayfası' })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Sonraki PDF sayfası' }).click()
  await expect(dialog.locator('.pdf-viewport .sr-only')).toContainText('Ek 1 / Ödeme planı')
  await expect(dialog.locator('.pdf-page-controls')).toContainText('Sayfa 2 / 2')
  await expect(dialog.getByRole('button', { name: 'Sonraki PDF sayfası' })).toBeDisabled()
  await dialog.getByLabel('PDF yakınlaştırma').selectOption('2')
  await expect(dialog.locator('.pdf-viewport')).toHaveAttribute('aria-busy', 'false')
  expect(
    await dialog.locator('.pdf-viewport').evaluate((el) => el.scrollWidth > el.clientWidth),
  ).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await dialog.getByLabel('PDF yakınlaştırma').selectOption('1')
  await dialog.getByRole('button', { name: 'Önceki PDF sayfası' }).click()
  await expect(dialog.locator('.pdf-viewport .sr-only')).toContainText('EĞİTİM SÖZLEŞMESİ')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})
