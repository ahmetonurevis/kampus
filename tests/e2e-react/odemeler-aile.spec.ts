import { randomUUID } from 'node:crypto'

import type { Page } from '@playwright/test'

import { expect, test } from './support/fixtures.ts'
import { expectEveryRow, expectNoHorizontalOverflow } from './support/ui.ts'

// Veli ve öğrenci ödeme sayfaları (DOM-FIN-052, docs/domain/finans.md): veli çocuklarının taksitlerini görür ve
// ödenmiş taksitte dekont açar, çevrim içi ödeme yapamaz; öğrenci masaüstünde kendi taksitlerini
// salt okunur görür, telefonda görmez. Seed: her öğrenci 8 taksit; Deniz (s1) 24.500 TL ve 3
// ödenmiş, Ece (s2) 27.000 TL ve 4 ödenmiş taksit taşır. Paylaşılan oturumlar salt okunurdur;
// hiçbir test kayıt yazmaz.

const NOT_FOUND = /Kayıt bulunamadı/
const COLLECTIONS = '/api/v1/collections'
/** Başka öğrencinin (s5) taksidi; veli bu kapsamda değildir. */
const FOREIGN_INVOICE = 'inv-s5-0'
const PLAN_TABLE = 'Taksit listesi'
const RECEIPT_TABLE = 'Ödeme dekontları'

const rowsOf = (page: Page, table: string) =>
  page.getByRole('table', { name: table, exact: true }).locator('tbody tr')
const summary = (page: Page) => page.getByLabel('Öğrenci özeti', { exact: true })
const child = (page: Page) => page.getByLabel('Çocuk seç')

test.describe('DOM-FIN-052 veli: Finans, Dekontlar ve Ödeme Yap', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs('veli')
  })

  test('veli iki çocuğu arasında geçer; taksitler, tutarlar ve dekontlar değişir', async ({
    page,
  }) => {
    await page.goto('/veli/finans')
    await expect(page).toHaveURL(/[?&]cocuk=s1/)
    await expect(summary(page)).toContainText('Deniz Yılmaz')
    const plan = rowsOf(page, PLAN_TABLE)
    await expect(plan).toHaveCount(8)
    await expectEveryRow(plan, '24.500,00')
    // Ödenmişte "Ödendi" ve dekont, ödenmemişte kalan tutar; ödenmişte ödeme düğmesi yoktur.
    await expect(plan.filter({ hasText: 'Ödendi' })).toHaveCount(3)
    await expect(page.getByRole('button', { name: /dekontunu görüntüle/ })).toHaveCount(3)
    const stats = page.getByLabel('Ödeme özeti', { exact: true })
    await expect(stats).toContainText('196.000,00') // 8 × 24.500
    await expect(stats).toContainText('73.500,00') // ödenen: 3 taksit
    await expect(stats).toContainText('122.500,00') // kalan: 5 taksit

    await child(page).selectOption({ label: 'Ece Yılmaz' })
    await expect(page).toHaveURL(/[?&]cocuk=s2/)
    await expect(summary(page)).toContainText('Ece Yılmaz')
    await expect(summary(page)).not.toContainText('Deniz')
    await expectEveryRow(rowsOf(page, PLAN_TABLE), '27.000,00')
    await expect(rowsOf(page, PLAN_TABLE).filter({ hasText: 'Ödendi' })).toHaveCount(4)
    await expect(stats).toContainText('216.000,00') // 8 × 27.000
    await expect(stats).toContainText('108.000,00') // ödenen: 4 taksit

    // Dekontlar yalnız ödenmiş taksitleri listeler; çocuk değişince adreste kalır.
    await page.goto('/veli/dekontlar?cocuk=s2')
    await expect(rowsOf(page, RECEIPT_TABLE)).toHaveCount(4)
    await expectEveryRow(rowsOf(page, RECEIPT_TABLE), 'Ödendi')
    await child(page).selectOption({ label: 'Deniz Yılmaz' })
    await expect(page).toHaveURL(/[?&]cocuk=s1/)
    await expect(rowsOf(page, RECEIPT_TABLE)).toHaveCount(3)
  })

  test('ödenmiş taksitte dekont açılır', async ({ page }) => {
    await page.goto('/veli/dekontlar?cocuk=s1')
    await page.getByRole('button', { name: '1. taksit dekontunu görüntüle' }).click()
    const preview = page.getByRole('dialog', { name: 'Tahsilat dekontu · Önizleme' })
    await expect(preview).toBeVisible()
    await expect(preview.getByRole('img', { name: 'Tahsilat dekontu, sayfa 1' })).toBeVisible()
    await expect(preview.getByText('dekont-inv-s1-0.pdf')).toBeVisible()
  })

  test('durum süzgeci sunucuda uygulanır; taksit ayrıntısı panelde açılır', async ({ page }) => {
    await page.goto('/veli/finans?cocuk=s1')
    const plan = rowsOf(page, PLAN_TABLE)
    await expect(plan).toHaveCount(8)
    await page.getByLabel('Ödeme durumu', { exact: true }).selectOption('odendi')
    await expect(page).toHaveURL(/durum=odendi/)
    await expect(plan).toHaveCount(3)
    await expectEveryRow(plan, 'Ödendi')

    await page.getByRole('button', { name: '2. taksit detayını aç' }).click()
    const detail = page.getByRole('dialog', { name: 'Taksit detayı' })
    await expect(detail).toContainText('Deniz Yılmaz')
    await expect(detail).toContainText('2. taksit')
    await expect(detail.getByRole('button', { name: 'Dekontu görüntüle' })).toBeVisible()
    // Ödeme düğmesi yoktur (invoice.pay yalnız yönetici ve ön büro).
    await expect(detail.getByRole('button', { name: /tahsil|ödeme yap/i })).toHaveCount(0)
  })

  test('çevrim içi ödeme yoktur: düğme yok, okulla iletişim bilgisi ve API 403', async ({
    page,
    api,
  }) => {
    await page.goto('/veli/finans?cocuk=s1')
    await expect(rowsOf(page, PLAN_TABLE)).toHaveCount(8)
    await expect(page.getByRole('button', { name: /tahsil et|ödeme yap|öde$/i })).toHaveCount(0)
    await expect(page.getByRole('main').getByRole('link', { name: /ödeme yap/i })).toHaveCount(0)
    await page.getByRole('link', { name: /okulla iletişime geçin/i }).click()
    await expect(page).toHaveURL(/\/veli\/odeme-yap/)
    await expect(page.getByRole('heading', { name: 'Ödemeler okulda kaydedilir' })).toBeVisible()
    const next = page.getByLabel('Sıradaki taksit', { exact: true })
    await expect(next).toContainText('4. taksit')
    await expect(page.getByRole('link', { name: 'Okulla iletişime geçin' })).toHaveAttribute(
      'href',
      /\/veli\/randevu-mesaj/,
    )

    const client = await api('veli')
    const response = await client.context.fetch('/api/v1/payments', {
      method: 'POST',
      data: { studentId: 's1', amountCents: 100, method: 'Banka havalesi', reference: 'E2E-VELI' },
      headers: { 'idempotency-key': randomUUID() },
      failOnStatusCode: false,
    })
    expect(response.status()).toBe(403)
  })

  test('başka öğrencinin taksidi görünmez: adres 404 ve "Kayıt bulunamadı"', async ({
    page,
    api,
  }) => {
    await page.goto(`/veli/finans?cocuk=s1&detay=${FOREIGN_INVOICE}`)
    await expect(
      page.getByRole('dialog', { name: 'Taksit detayı' }).getByText(NOT_FOUND),
    ).toBeVisible()
    const client = await api('veli')
    expect((await client.get(`${COLLECTIONS}/invoices/${FOREIGN_INVOICE}`)).status).toBe(404)
    // Çocuğu olmayan öğrenci adresle seçilemez; ilk çocuğa dönülür.
    await page.goto('/veli/finans?cocuk=s5')
    await expect(page).toHaveURL(/[?&]cocuk=s1/)
    await expect(summary(page)).toContainText('Deniz Yılmaz')
  })

  test('DOM-FIN-025: burslu çocuğun belgelerinde taahhütname sunulmaz', async ({ page }) => {
    await page.route('**/api/v1/collections/contracts**', async (route) => {
      const response = await route.fetch()
      const body = (await response.json()) as { data: Record<string, unknown>[] }
      for (const row of body.data)
        row.record = {
          ...(row.record as object),
          scholarship: { programId: 'test-program', amountCents: 100 },
        }
      await route.fulfill({ response, json: body })
    })
    await page.goto('/veli/sozlesmeler?cocuk=s2')
    await expect(page.getByRole('heading', { name: 'Özel okul eğitim sözleşmesi' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Taksit taahhütnamesi' })).toHaveCount(0)
  })

  test('IST-107: veli cari ekstreyi görür ve PDF indirir; dekontlar sayfasında ekstre yoktur', async ({
    page,
  }) => {
    await page.goto('/veli/finans?cocuk=s1')
    const section = page.getByRole('region', { name: 'Cari ekstre' })
    await expect(section.getByRole('table', { name: 'Hesap hareketleri' })).toContainText(
      '1. taksit',
    )
    await expect(section.getByRole('button', { name: 'Filtreler' })).toHaveCount(0)
    const downloading = page.waitForEvent('download')
    await section.getByRole('button', { name: 'Ekstreyi indir' }).click()
    expect((await downloading).suggestedFilename()).toBe('cari-ekstre-s1.pdf')
    await expect(page.getByText('PDF belgeniz indirildi.')).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.goto('/veli/dekontlar?cocuk=s1')
    await expect(page.getByRole('heading', { name: 'Ödeme dekontları' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Cari ekstre' })).toHaveCount(0)
  })

  test('Sözleşmeler seçili çocuğun belgelerini listeler; 390 px yatay taşmaz', async ({ page }) => {
    await page.goto('/veli/sozlesmeler?cocuk=s2')
    await expect(summary(page)).toContainText('Ece Yılmaz')
    await expect(page.getByRole('heading', { name: 'Özel okul eğitim sözleşmesi' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Taksit taahhütnamesi' })).toBeVisible()
    await page.getByRole('button', { name: 'Sözleşmeyi görüntüle' }).click()
    const preview = page.getByRole('dialog', { name: 'Eğitim sözleşmesi · Önizleme' })
    await expect(preview.getByText('sozlesme-contract-s2.pdf')).toBeVisible()
    await page.keyboard.press('Escape')

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/veli/finans?cocuk=s1')
    await expect(page.getByRole('button', { name: '1. taksit detayını aç' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})

test.describe('DOM-FIN-052 öğrenci: Ödemelerim', () => {
  test('masaüstünde kendi taksitlerini salt okunur görür', async ({ page, loginAs }) => {
    await loginAs('ogrenci')
    await page.goto('/ogrenci/odemelerim')
    const table = rowsOf(page, 'Ödemelerim')
    await expect(table).toHaveCount(8)
    await expectEveryRow(table, '24.500,00')
    await expect(page.getByText('Salt okunur')).toBeVisible()
    await expect(page.getByRole('button', { name: /tahsil|ödeme yap/i })).toHaveCount(0)
    await expect(page.getByRole('main').getByRole('link', { name: /ödeme yap/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /dekontunu görüntüle/ })).toHaveCount(3)
  })

  test('390 px telefonda ödeme içeriği gösterilmez ve veri okunmaz', async ({ page, loginAs }) => {
    await loginAs('ogrenci')
    const reads: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith(`${COLLECTIONS}/invoices`))
        reads.push(request.url())
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/ogrenci/odemelerim')
    await expect(
      page.getByRole('heading', { name: 'Ödemeler telefonda gösterilmez' }),
    ).toBeVisible()
    await expect(page.getByText('bilgisayardan veya tabletten')).toBeVisible()
    await expect(page.getByRole('table')).toHaveCount(0)
    await expect(page.getByText('24.500,00')).toHaveCount(0)
    await expectNoHorizontalOverflow(page)
    expect(reads).toEqual([])
  })
})
