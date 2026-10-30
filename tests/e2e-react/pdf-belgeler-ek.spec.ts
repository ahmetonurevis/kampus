import { readFile } from 'node:fs/promises'

import type { Download, Page } from '@playwright/test'

import { expect, test } from './support/fixtures.ts'

// PDF belgeleri 2: taksit taahhütnamesi, ödev çalışma kâğıdı ve ödev değerlendirme formu.
// Altyapı (önizleme, geniş pencere, geçici adresler) `pdf-belgeler.spec.ts`'te sınanır; burada her
// belgenin açılışı, içeriği, indirmesi ve yetkisiz rolde düğmenin yokluğu denenir. Seed kurumları
// yalnız okunur.

async function readPdf(download: Download): Promise<Buffer> {
  return readFile(await download.path())
}

/** İndirme `%PDF` ile başlayan dosya verir; Blob türü `application/pdf` olmalıdır. */
async function expectPdfDownload(page: Page, button: ReturnType<Page['getByRole']>) {
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()])
  const bytes = await readPdf(download)
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  return download
}

test.describe('PDF: taksit taahhütnamesi', () => {
  test('taksit detayından açılır; özet bandı ve taksit takvimi görünür, indirme PDF verir', async ({
    page,
    loginAs,
  }) => {
    await page.addInitScript(() => {
      const types: string[] = []
      Object.assign(window, { __pdfTypes: types })
      const create = URL.createObjectURL.bind(URL)
      URL.createObjectURL = (object: Blob | MediaSource) => {
        if (object instanceof Blob) types.push(object.type)
        return create(object)
      }
    })
    await loginAs('yonetici')
    await page.goto('/yonetici/finans')
    await page.getByLabel('Tabloda ara').fill('Emir Kaya')
    const table = page.getByRole('table', { name: 'Taksit ve tahsilat listesi' })
    await expect(table.locator('tbody tr').first()).toContainText('Emir Kaya')
    await table
      .locator('tbody tr')
      .filter({ hasText: '6. taksit' })
      .getByRole('button', { name: 'Emir Kaya 6. taksit detayını aç' })
      .click()

    const detail = page.getByRole('dialog', { name: 'Taksit detayı' })
    const opener = detail.getByRole('button', { name: 'Taksit taahhütnamesi' })
    await opener.click()

    const preview = page.getByRole('dialog', { name: 'Taksit taahhütnamesi · Önizleme' })
    await expect(preview.getByRole('img', { name: 'Taksit taahhütnamesi, sayfa 1' })).toBeVisible()
    const viewer = preview.getByLabel('PDF sayfa görünümü')
    await expect(viewer).toContainText('TOPLAM BEDEL')
    await expect(viewer).toContainText('KALAN BAKİYE')
    await expect(viewer).toContainText('Taksit takvimi')
    await expect(viewer).toContainText('Emir Kaya')
    await expect(viewer).toContainText('Belge no: plan-s10')

    const download = await expectPdfDownload(
      page,
      preview.getByRole('button', { name: 'PDF’yi indir' }),
    )
    expect(download.suggestedFilename()).toBe('taksit-plani-s10.pdf')
    expect(await page.evaluate(() => Reflect.get(window, '__pdfTypes') as string[])).toContain(
      'application/pdf',
    )

    await page.keyboard.press('Escape')
    await expect(preview).toBeHidden()
    await expect(opener).toBeFocused()
  })

  for (const [role, path] of [
    ['ogrenci', '/ogrenci/odemelerim'],
    ['veli', '/veli/finans'],
    ['ogretmen', '/ogretmen/dashboard'],
  ] as const)
    test(`${role} rolünde taksit taahhütnamesi düğmesi yoktur`, async ({ page, loginAs }) => {
      await loginAs(role)
      await page.goto(path)
      await expect(page.getByRole('main')).toBeVisible()
      await expect(page.getByRole('button', { name: /taahhüt/i })).toHaveCount(0)
    })
})
