import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('Tablo sayfalaması, bileşik finans filtreleri ve CSV aynı sonuç kümesini kullanır', async ({
  page,
}) => {
  await page.goto('/yonetici/finans')
  const table = page.locator('.data-table')
  await expect(table.locator('tbody tr')).toHaveCount(8)
  await table.getByRole('button', { name: 'Sonraki sayfa' }).click()
  await expect(table.locator('.pagination [aria-current="page"]')).toHaveText('2')
  await table.getByLabel('Sayfa başına kayıt').selectOption('16')
  await expect(table.locator('tbody tr')).toHaveCount(16)
  await expect(table.locator('.pagination [aria-current="page"]')).toHaveText('1')
  await table.getByRole('button', { name: 'Filtreler', exact: true }).click()
  await table.getByLabel('Kampüs', { exact: true }).selectOption('Kadıköy Kampüsü')
  await expect(table.locator('.result-count')).toContainText('/ 640 kayıt')
  await table.getByLabel('Tutar (₺) en az').fill('24500')
  await table.getByLabel('Tutar (₺) en çok').fill('24500')
  await table.getByLabel('Sınıf', { exact: true }).selectOption('7-A')
  await expect(table.locator('.result-count')).toContainText('/ 80 kayıt')
  await table.getByRole('button', { name: 'Sonraki sayfa' }).click()
  await table.getByLabel('Ödeme durumu').selectOption('Ödendi')
  await expect(table.locator('.pagination [aria-current="page"]')).toHaveText('1')
  const expected = Number(
    (await table.locator('.result-count').innerText()).match(/\/ (\d+) kayıt/)[1],
  )
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Raporu indir' }).click()
  const csv = await readFile(await (await downloadPromise).path(), 'utf8')
  const lines = csv.trim().split('\r\n')
  expect(lines).toHaveLength(expected + 1)
  for (const line of lines.slice(1)) {
    expect(line).toContain('"24.500,00 ₺"')
    expect(line).toContain('"Ödendi"')
  }
  await table.getByRole('button', { name: 'Aramayı ve filtreleri temizle', exact: true }).click()
  await expect(table.locator('.result-count')).toContainText('/ 1920 kayıt')
  await table.getByLabel('Tabloda ara').fill('Deniz Yılmaz')
  await expect(table.locator('.result-count')).toContainText('/ 8 kayıt')
  await table.getByRole('button', { name: 'Taksit', exact: true }).click()
  await expect(table.locator('tbody tr').first()).toContainText('1. taksit')
  await table.getByRole('button', { name: 'Taksit', exact: true }).click()
  await expect(table.locator('tbody tr').first()).toContainText('8. taksit')
})

test('Kart sayfalaması filtre değişiminde başa döner; sıfır sonuçtan temizleme ile çıkılır', async ({
  page,
}) => {
  await page.goto('/ogrenci/materyaller')
  await expect(page.locator('.document-card')).toHaveCount(6)
  const first = await page.locator('.document-card h2').first().innerText()
  await page.getByRole('button', { name: 'Sonraki sayfa' }).click()
  await expect(page.locator('.pagination [aria-current="page"]')).toHaveText('2')
  await expect(page.locator('.document-card h2').first()).not.toHaveText(first)
  await page.getByLabel('Materyal dersi').selectOption('math')
  await expect(page.locator('.pagination [aria-current="page"]')).toHaveText('1')
  await page.getByRole('button', { name: 'Sonraki sayfa' }).click()
  await page.getByLabel('Materyal seviyesi').selectOption('7. Sınıf')
  await expect(page.locator('.document-card')).toHaveCount(1)
  await expect(page.locator('.pagination [aria-current="page"]')).toHaveText('1')
  await page.getByLabel('Materyal ara').fill('eşleşmeyen başlık')
  await expect(page.locator('.result-count')).toContainText('0–0 / 0 kayıt')
  await expect(page.getByRole('button', { name: 'Sonraki sayfa' })).toBeDisabled()
  await page
    .locator('.empty-page')
    .getByRole('button', { name: 'Aramayı ve filtreleri temizle' })
    .click()
  await expect(page.locator('.result-count')).toContainText('/ 92 kayıt')
  await page.getByLabel('Sayfa başına kayıt').selectOption('12')
  await expect(page.locator('.document-card')).toHaveCount(12)
})

test('Tarih ve puan aralığı birlikte çalışır; geçersiz aralık açıklanır ve temizlenir', async ({
  page,
}) => {
  await page.goto('/ogrenci/notlarim')
  await page.getByRole('button', { name: 'Filtreler', exact: true }).click()
  await page.getByLabel('Puan en az').fill('70')
  await page.getByLabel('Puan en çok').fill('90')
  const scores = await page
    .locator('tbody tr')
    .evaluateAll((rows) => rows.map((row) => Number(row.cells[4].textContent.match(/\d+/)[0])))
  expect(scores.length).toBeGreaterThan(0)
  expect(scores.every((score) => score >= 70 && score <= 90)).toBe(true)
  await page.getByLabel('Tarih başlangıç').fill('2026-10-01')
  await page.getByLabel('Tarih bitiş').fill('2026-09-01')
  await expect(page.getByText('Başlangıç değeri bitişten büyük olamaz.')).toBeVisible()
  await expect(page.locator('.result-count')).toContainText('0–0 / 0 kayıt')
  await page.getByRole('button', { name: 'Tarih filtresini kaldır' }).click()
  await expect(page.locator('.empty-cell')).toHaveCount(0)
  await page.getByRole('button', { name: 'Filtreleri temizle', exact: true }).click()
  await expect(page.getByLabel('Puan en az')).toHaveValue('')
})

test('Her PDF bağlantısı ilgili belgeyi indirir; ödev çalışma kâğıdı da erişilebilirdir', async ({
  page,
}) => {
  async function download(button, filePattern) {
    await button.click()
    const preview = page.getByRole('dialog', { name: /Önizleme/ })
    await expect(preview.locator('.pdf-viewport')).toHaveAttribute('aria-busy', 'false')
    await expect(preview.locator('canvas')).toBeVisible()
    const pending = page.waitForEvent('download')
    await preview.getByRole('button', { name: 'PDF’yi indir', exact: true }).click()
    const file = await pending
    expect(file.suggestedFilename()).toMatch(filePattern)
    const bytes = await readFile(await file.path())
    expect(bytes.subarray(0, 4).toString()).toBe('%PDF')
    expect(bytes.length).toBeGreaterThan(10000)
    await preview.getByRole('button', { name: 'Pencereyi kapat' }).click()
  }
  await page.goto('/veli/dekontlar')
  await download(page.getByRole('button', { name: 'Dekont', exact: true }).first(), /^dekont-/)
  await page.goto('/veli/sozlesmeler')
  await download(page.getByRole('button', { name: 'Sözleşmeyi görüntüle' }), /^sozlesme-/)
  await download(page.getByRole('button', { name: 'Ödeme belgesini görüntüle' }), /^taksit-plani-/)
  await page.goto('/ogrenci/odevler')
  await download(page.getByRole('button', { name: 'Çalışma kâğıdını görüntüle' }).first(), /^odev-/)
  await page.goto('/ogrenci/materyaller')
  await download(page.locator('.document-card').first().getByRole('button'), /\.pdf$/)
  await page.goto('/ogretmen/odevler')
  await page.getByRole('button', { name: 'Değerlendir', exact: true }).first().click()
  await download(
    page.getByRole('dialog').getByRole('button', { name: /Değerlendirme formunu görüntüle/ }),
    /^degerlendirme-/,
  )
})

test('Mobil ve koyu temada açık filtreler, klavye ile sayfalama ve yatay taşma kontrolü', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  for (const route of [
    '/yonetici/finans',
    '/yonetici/personel',
    '/ogrenci/notlarim',
    '/ogrenci/materyaller',
    '/ogrenci/soru-sor',
    '/onburo/adaylar',
    '/veli/duyurular',
  ]) {
    await page.goto(route)
    const filters = page.getByRole('button', { name: 'Filtreler', exact: true }).first()
    await filters.click()
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true)
    const next = page.getByRole('button', { name: 'Sonraki sayfa' }).first()
    if (await next.isEnabled()) {
      const size = Number(await page.getByLabel('Sayfa başına kayıt').first().inputValue())
      await next.focus()
      await page.keyboard.press('Enter')
      await expect(page.locator('.result-count').first()).toContainText(`${size + 1}–`)
      await expect(page.locator('.page-number')).toHaveCount(0)
    }
  }
  await page.goto('/yonetici/finans')
  const rememberedFilters = page.getByRole('button', { name: 'Filtreler', exact: true })
  if ((await rememberedFilters.getAttribute('aria-expanded')) !== 'true')
    await rememberedFilters.click()
  await page.getByRole('button', { name: 'Koyu temaya geç' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByLabel('Vade tarihi başlangıç')).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
})
