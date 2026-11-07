import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import type { Download, Page } from '@playwright/test'

import { expect, test } from './support/fixtures.ts'

// PDF belgeleri (dekont ve sözleşme): önizleme geniş pencerede açılır, indirme önizlenen aynı PDF
// Blob'unu verir, geçici adresler pencere kapanınca bırakılır. Seed: her öğrencinin ilk üç taksiti
// ödenmiş, 4.+ taksitler ödenmemiştir. Dekont testleri seed kurumunu yalnız okur; sözleşme testi
// kendi kurumunu kurar.

const ADMIN_URL = '/yonetici/finans'
const RENEWAL_URL = '/yonetici/kayit-yenileme'
const TABLE = 'Taksit ve tahsilat listesi'

declare global {
  interface Window {
    __blobUrls: { url: string; type: string }[]
    __revokedUrls: string[]
  }
}

/** `URL.createObjectURL` / `revokeObjectURL` çağrılarını kaydeder (sayfa betiklerinden önce). */
async function trackObjectUrls(page: Page) {
  await page.addInitScript(() => {
    window.__blobUrls = []
    window.__revokedUrls = []
    const create = URL.createObjectURL.bind(URL)
    const revoke = URL.revokeObjectURL.bind(URL)
    URL.createObjectURL = (object: Blob | MediaSource) => {
      const url = create(object)
      window.__blobUrls.push({ url, type: object instanceof Blob ? object.type : '' })
      return url
    }
    URL.revokeObjectURL = (url: string) => {
      window.__revokedUrls.push(url)
      revoke(url)
    }
  })
}

async function readPdf(download: Download): Promise<Buffer> {
  return readFile(await download.path())
}

/** Aranan öğrencinin taksit satırı (arama sunucuda çalışır). */
async function openList(page: Page, student: string) {
  await page.goto(ADMIN_URL)
  await page.getByLabel('Tabloda ara').fill(student)
  const table = page.getByRole('table', { name: TABLE })
  await expect(table.locator('tbody tr').first()).toContainText(student)
  return (installment: string) =>
    table.locator('tbody tr').filter({ hasText: student }).filter({ hasText: installment })
}

test.describe('PDF: dekont', () => {
  test('ödenmiş taksitte dekont açılır, önizleme görünür; indirme PDF dosyası verir', async ({
    page,
    loginAs,
  }) => {
    await trackObjectUrls(page)
    await loginAs('yonetici')
    const row = await openList(page, 'Emir Kaya')

    const opener = row('1. taksit').getByRole('button', {
      name: 'Emir Kaya 1. taksit dekontunu görüntüle',
    })
    await opener.click()

    const preview = page.getByRole('dialog', { name: 'Tahsilat dekontu · Önizleme' })
    await expect(preview).toBeVisible()
    // Geniş pencere: sağ panel değil, ekranın büyük bölümünü kaplar.
    const box = await preview.boundingBox()
    expect(box?.width ?? 0).toBeGreaterThan(900)

    await expect(preview.getByRole('img', { name: 'Tahsilat dekontu, sayfa 1' })).toBeVisible()
    await expect(preview.getByText('dekont-inv-s10-0.pdf')).toBeVisible()
    const viewer = preview.getByLabel('PDF sayfa görünümü')
    // Kanvas görüntüdür; sayfa metni ekran okuyucu için yanında bulunur.
    await expect(viewer).toContainText('TAHSİL EDİLEN TUTAR')
    await expect(viewer).toContainText('Emir Kaya')
    await expect(viewer).toContainText('Belge no: inv-s10-0')

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      preview.getByRole('button', { name: 'PDF’yi indir' }).click(),
    ])
    expect(download.suggestedFilename()).toBe('dekont-inv-s10-0.pdf')
    const bytes = await readPdf(download)
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const blobs = await page.evaluate(() => window.__blobUrls)
    expect(blobs.map((blob) => blob.type)).toContain('application/pdf')

    // Yeni sekmede aç geçici adres üretir; pencere kapanınca bütün adresler bırakılır.
    const popup = page.context().waitForEvent('page')
    await preview.getByRole('button', { name: /yeni sekmede aç/ }).click()
    await (await popup).close()
    await preview.getByRole('button', { name: 'Pencereyi kapat' }).click()
    await expect(preview).toBeHidden()
    await expect(opener).toBeFocused()
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__blobUrls.filter((blob) => !window.__revokedUrls.includes(blob.url)).length,
        ),
      )
      .toBe(0)
  })

  test('taksit detayındaki "Dekontu görüntüle" aynı önizlemeyi açar; kapanınca odak düğmeye döner', async ({
    page,
    loginAs,
  }) => {
    await loginAs('yonetici')
    const row = await openList(page, 'Emir Kaya')
    await row('2. taksit').getByRole('button', { name: 'Emir Kaya 2. taksit detayını aç' }).click()
    const detail = page.getByRole('dialog', { name: 'Taksit detayı' })
    const opener = detail.getByRole('button', { name: 'Dekontu görüntüle' })
    await opener.click()

    const preview = page.getByRole('dialog', { name: 'Tahsilat dekontu · Önizleme' })
    await expect(preview.getByRole('img', { name: 'Tahsilat dekontu, sayfa 1' })).toBeVisible()
    await expect(preview.getByLabel('PDF sayfa görünümü')).toContainText('Belge no: inv-s10-1')
    await page.keyboard.press('Escape')
    await expect(preview).toBeHidden()
    await expect(detail).toBeVisible()
    await expect(opener).toBeFocused()
  })

  test('ödenmemiş taksitte dekont düğmesi yoktur', async ({ page, loginAs }) => {
    await loginAs('yonetici')
    const row = await openList(page, 'Emir Kaya')
    const unpaid = row('6. taksit')
    await expect(unpaid.getByRole('button', { name: /tahsil et/ })).toBeVisible()
    await expect(unpaid.getByRole('button', { name: /dekont/i })).toHaveCount(0)

    await unpaid.getByRole('button', { name: 'Emir Kaya 6. taksit detayını aç' }).click()
    const detail = page.getByRole('dialog', { name: 'Taksit detayı' })
    await expect(detail).toContainText('Henüz tahsil edilmedi')
    await expect(detail.getByRole('button', { name: /Dekont/i })).toHaveCount(0)
  })
})

test.describe('PDF: sözleşme', () => {
  test('yenileme ayrıntısından sözleşme açılır; iki sayfalı PDF indirilir', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici'],
      students: ['s4'],
      collections: ['renewals'],
      tariffYears: ['current', 'next'],
    })
    const client = await api(school.user('yonetici'))
    const startDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(
      new Date(Date.now() + 30 * 86_400_000),
    )
    const created = await client.context.post('/api/v1/workflows/renewal', {
      headers: { 'idempotency-key': randomUUID() },
      failOnStatusCode: false,
      data: {
        studentId: 's4',
        targetClassId: 'c5',
        year: 2027,
        mode: 'renew',
        total: 28500,
        scholarship: 0,
        discount: 0,
        count: 8,
        startDate,
      },
    })
    expect(created.status()).toBeLessThan(300)

    await trackObjectUrls(page)
    await loginAs(school.user('yonetici'))
    await page.goto(RENEWAL_URL)
    await page.getByLabel('Tabloda ara').fill('Arda Çelik')
    await page.getByRole('button', { name: 'Arda Çelik' }).click()
    const detail = page.getByRole('dialog', { name: 'Arda Çelik' })
    const opener = detail.getByRole('button', { name: 'Yeni dönem sözleşmesi' })
    await opener.click()

    const preview = page.getByRole('dialog', { name: 'Eğitim sözleşmesi · Önizleme' })
    await expect(preview.getByRole('img', { name: 'Eğitim sözleşmesi, sayfa 1' })).toBeVisible()
    const viewer = preview.getByLabel('PDF sayfa görünümü')
    // Başlık sözleşmenin kendi adıdır (DOM-FIN-010).
    await expect(viewer).toContainText('eğitim sözleşmesi')
    await expect(viewer).toContainText('Arda Çelik')
    await expect(preview.getByRole('status').filter({ hasText: 'Sayfa 1 / 2' })).toBeVisible()

    await preview.getByRole('button', { name: 'Sonraki PDF sayfası' }).click()
    await expect(preview.getByRole('img', { name: 'Eğitim sözleşmesi, sayfa 2' })).toBeVisible()
    await expect(viewer).toContainText('Ek 1 / Ödeme planı')
    await expect(viewer).toContainText('8 taksit')

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      preview.getByRole('button', { name: 'PDF’yi indir' }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/^sozlesme-.+\.pdf$/)
    expect((await readPdf(download)).subarray(0, 5).toString('latin1')).toBe('%PDF-')

    await page.keyboard.press('Escape')
    await expect(preview).toBeHidden()
    await expect(opener).toBeFocused()
  })
})

test.describe('PDF: ders çalışma kâğıdı', () => {
  test('öğrenci materyali çalışma kâğıdı olarak açar; satır özeti açılmaz, indirme PDF verir', async ({
    page,
    loginAs,
    api,
  }) => {
    await loginAs('ogrenci')
    const client = await api('ogrenci')
    const listed = await client.get('/api/v1/collections/materials?pageSize=1')
    expect(listed.status).toBe(200)
    const material = (listed.body as { data: { id: string; record: { title: string } }[] }).data[0]
    expect(material, 'öğrencinin düzeyinde materyal').toBeTruthy()
    if (!material) return

    await page.goto('/ogrenci/materyaller')
    await page.getByLabel('Tabloda ara').fill(material.record.title)
    const opener = page.getByRole('button', {
      name: `${material.record.title} PDF olarak görüntüle`,
    })
    await opener.click()

    const preview = page.getByRole('dialog', { name: 'Ders çalışma kâğıdı · Önizleme' })
    await expect(preview.getByRole('img', { name: 'Ders çalışma kâğıdı, sayfa 1' })).toBeVisible()
    const viewer = preview.getByLabel('PDF sayfa görünümü')
    await expect(viewer).toContainText(material.record.title)
    await expect(viewer).toContainText('Çözüm ve çalışma alanı')

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      preview.getByRole('button', { name: 'PDF’yi indir' }).click(),
    ])
    expect(download.suggestedFilename()).toBe(`materyal-${material.id}.pdf`)
    expect((await readPdf(download)).subarray(0, 5).toString('latin1')).toBe('%PDF-')

    await page.keyboard.press('Escape')
    await expect(preview).toBeHidden()
    await expect(opener).toBeFocused()
    // Pencere içi tıklamalar satıra sızmaz: materyal özeti açılmamıştır.
    await expect(page.getByRole('dialog', { name: 'Materyal özeti' })).toHaveCount(0)
  })
})
