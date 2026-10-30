import { readFile } from 'node:fs/promises'

import type { Download, Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
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

type Row<T> = { id: string; record: T }

async function listAll<T>(client: ApiClient, path: string): Promise<Row<T>[]> {
  const response = await client.get(path)
  expect(response.status).toBe(200)
  return (response.body as { data: Row<T>[] }).data
}

/** Çalışma kâğıdı önizlemesini açar ve ortak kontrolleri yapar; sayfa görünümünü döndürür. */
async function openWorksheet(page: Page, opener: ReturnType<Page['getByRole']>) {
  await opener.click()
  const preview = page.getByRole('dialog', { name: 'Ödev çalışma kâğıdı · Önizleme' })
  await expect(preview.getByRole('img', { name: 'Ödev çalışma kâğıdı, sayfa 1' })).toBeVisible()
  const viewer = preview.getByLabel('PDF sayfa görünümü')
  await expect(viewer).toContainText('ÖDEV ÇALIŞMA KÂĞIDI')
  await expect(viewer).toContainText('Görev ve yönerge')
  await expect(viewer).toContainText('Çalışmam')
  return { preview, viewer }
}

test.describe('PDF: ödev çalışma kâğıdı', () => {
  test('öğretmen ödev panelinden açar; öğrenci alanları boştur, indirme PDF verir', async ({
    page,
    loginAs,
  }) => {
    await loginAs('ogretmen')
    await page.goto('/ogretmen/odevler?odev=hw2')
    const panel = page.getByRole('dialog', { name: 'Ödev teslim durumu' })
    const opener = panel.getByRole('button', { name: 'Çalışma kâğıdını görüntüle' })
    const { preview, viewer } = await openWorksheet(page, opener)
    await expect(viewer).toContainText('Belge no: hw2')
    await expect(viewer).toContainText('......')

    const download = await expectPdfDownload(
      page,
      preview.getByRole('button', { name: 'PDF’yi indir' }),
    )
    expect(download.suggestedFilename()).toBe('odev-hw2.pdf')
    await page.keyboard.press('Escape')
    await expect(preview).toBeHidden()
    await expect(opener).toBeFocused()
  })

  test('öğrenci kendi adıyla açar', async ({ page, loginAs, api }) => {
    const student = await api('ogrenci')
    const [homework] = await listAll<{ title: string }>(student, '/api/v1/collections/homework')
    expect(homework, 'öğrencinin sınıfında ödev').toBeTruthy()
    if (!homework) return
    await loginAs('ogrenci')
    await page.goto(`/ogrenci/odevler?odev=${homework.id}`)
    const panel = page.getByRole('dialog', { name: 'Ödev ayrıntısı' })
    const { preview, viewer } = await openWorksheet(
      page,
      panel.getByRole('button', { name: 'Çalışma kâğıdını görüntüle' }),
    )
    await expect(viewer).toContainText('Deniz Yılmaz')
    await expect(viewer).toContainText(homework.record.title)
    const download = await expectPdfDownload(
      page,
      preview.getByRole('button', { name: 'PDF’yi indir' }),
    )
    expect(download.suggestedFilename()).toBe(`odev-${homework.id}.pdf`)
  })

  test('veli yalnız seçili çocuğunun adıyla açar', async ({ page, loginAs, api }) => {
    const parent = await api('veli')
    const children = await listAll<{ name: string; classId: string }>(
      parent,
      '/api/v1/collections/students',
    )
    const ece = children.find((row) => row.record.name === 'Ece Yılmaz')
    expect(ece, 'veli çocuğu Ece').toBeTruthy()
    if (!ece) return
    const [homework] = await listAll<{ title: string }>(
      parent,
      `/api/v1/collections/homework?classId=${ece.record.classId}`,
    )
    expect(homework, 'Ece sınıfında ödev').toBeTruthy()
    if (!homework) return
    await loginAs('veli')
    await page.goto(`/veli/akademik-takip?sekme=odevler&cocuk=${ece.id}&odev=${homework.id}`)
    const panel = page.getByRole('dialog', { name: 'Ödev ayrıntısı' })
    const { viewer } = await openWorksheet(
      page,
      panel.getByRole('button', { name: 'Çalışma kâğıdını görüntüle' }),
    )
    await expect(viewer).toContainText('Ece Yılmaz')
    await expect(viewer).not.toContainText('Deniz Yılmaz')
  })

  test('ödev ekranı olmayan rollerde çalışma kâğıdı düğmesi yoktur', async ({ page, loginAs }) => {
    await loginAs('yonetici')
    await page.goto('/yonetici/finans')
    await expect(page.getByRole('main')).toBeVisible()
    await expect(page.getByRole('button', { name: /Çalışma kâğıdını/ })).toHaveCount(0)
  })
})
