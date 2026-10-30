import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import type { Download, Page, Request } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Finans & Tahsilat (yönetici /finans, ön büro /tahsilat-takip). Seed: 240 öğrenci × 8 taksit =
// 1920 taksit; her öğrencinin ilk üç taksiti ödenmiş, 5.–8. taksitlerin vadesi ileridedir.
// Testler paralel koşar: ödeme yapan her test kendi öğrencisinin ileri vadeli taksidini öder;
// listeyi sayan testler bu öğrencilere ve ileri vadeli taksit sayısına dayanmaz.

const ADMIN_URL = '/yonetici/finans'
const FRONT_OFFICE_URL = '/onburo/tahsilat-takip'
const TABLE = 'Taksit ve tahsilat listesi'
const PAY_PATH = /\/api\/v1\/invoices\/[^/]+\/pay$/

const tableOf = (page: Page) => page.getByRole('table', { name: TABLE })
const bodyRows = (page: Page) => tableOf(page).locator('tbody tr')
const resultCount = (page: Page) => page.locator('.result-count')
const paymentDialog = (page: Page) => page.getByRole('dialog', { name: 'Tahsilat kaydet' })

type InvoiceRecord = { paidAt: string | null; method: string | null; studentId: string }

async function invoice(client: ApiClient, id: string): Promise<InvoiceRecord> {
  const result = await client.get(`/api/v1/collections/invoices/${id}`)
  expect(result.status, `taksit ${id}`).toBe(200)
  return (result.body as { data: { record: InvoiceRecord } }).data.record
}

/** Arayüzden geçmeden ödeme (başka bir kullanıcının aynı anda tahsilatı). */
async function payThroughApi(client: ApiClient, id: string, method: string) {
  const response = await client.context.fetch(`/api/v1/invoices/${id}/pay`, {
    method: 'POST',
    data: { method },
    headers: { 'idempotency-key': randomUUID() },
    failOnStatusCode: false,
  })
  expect(response.status(), 'API ödemesi').toBe(200)
}

/** Sayfadaki ödeme isteklerini sayar (çift gönderim denetimi). */
function recordPayments(page: Page): Request[] {
  const requests: Request[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && PAY_PATH.test(new URL(request.url()).pathname))
      requests.push(request)
  })
  return requests
}

async function readCsv(download: Download): Promise<string[][]> {
  const text = await readFile(await download.path(), 'utf8')
  expect(text.charCodeAt(0), 'UTF-8 BOM').toBe(0xfeff)
  return text
    .slice(1)
    .split('\r\n')
    .map((line) => line.split(';').map((cell) => cell.replace(/^"|"$/g, '')))
}

test.describe('Finans: tahsilat', () => {
  test('yönetici taksidi tahsil eder; satır ve kayıt "Ödendi" olur', async ({
    page,
    loginAs,
    api,
  }) => {
    await loginAs('yonetici', { fresh: true })
    const client = await api('yonetici')
    expect((await invoice(client, 'inv-s10-5')).paidAt).toBeNull()
    const payments = recordPayments(page)

    await page.goto(ADMIN_URL)
    await page.getByLabel('Tabloda ara').fill('Emir Kaya')
    await expect(page).toHaveURL(/[?&]q=Emir/)
    const row = bodyRows(page).filter({ hasText: '6. taksit' })
    await expect(row).toContainText('Emir Kaya')
    await expect(row).toContainText('Yaklaşan')

    await row.getByRole('button', { name: 'Emir Kaya 6. taksiti tahsil et' }).click()
    const dialog = paymentDialog(page)
    await expect(dialog).toBeVisible()
    await expect(page).toHaveURL(/[?&]tahsilat=inv-s10-5/)
    await expect(dialog).toContainText('Emir Kaya · 6. taksit')
    await dialog.getByLabel('Ödeme yöntemi').selectOption('Nakit')
    await dialog.getByRole('button', { name: 'Tahsilatı kaydet' }).click()

    await expect(page.getByText('Tahsilat kaydedildi.')).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(page).not.toHaveURL(/[?&]tahsilat=/)
    await expect(row).toContainText('Ödendi')
    await expect(row.getByRole('button', { name: /tahsil et/ })).toHaveCount(0)

    const stored = await invoice(client, 'inv-s10-5')
    expect(stored.paidAt).not.toBeNull()
    expect(stored.method).toBe('Nakit')
    expect(payments).toHaveLength(1)
    expect(payments[0]?.headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('çift tıklama ve art arda gönderim tek ödeme isteği atar', async ({
    page,
    loginAs,
    api,
  }) => {
    await loginAs('yonetici', { fresh: true })
    const client = await api('yonetici')
    const payments = recordPayments(page)

    await page.goto(`${ADMIN_URL}?tahsilat=inv-s11-5`)
    const dialog = paymentDialog(page)
    const submit = dialog.getByRole('button', { name: 'Tahsilatı kaydet' })
    await submit.dblclick()
    await expect(page.getByText('Tahsilat kaydedildi.')).toBeVisible()
    await expect(dialog).toBeHidden()
    expect(payments).toHaveLength(1)
    expect((await invoice(client, 'inv-s11-5')).paidAt).not.toBeNull()

    // Düğme kilidinden bağımsız: aynı tikte iki gönderim (Enter + tıklama) yine tek istektir.
    await page.goto(`${ADMIN_URL}?tahsilat=inv-s11-6`)
    await expect(submit).toBeEnabled()
    await dialog.locator('form').evaluate((form: HTMLFormElement) => {
      form.requestSubmit()
      form.requestSubmit()
    })
    await expect(dialog).toBeHidden()
    expect(payments).toHaveLength(2)
    expect(payments[0]?.headers()['idempotency-key']).not.toBe(
      payments[1]?.headers()['idempotency-key'],
    )
    expect((await invoice(client, 'inv-s11-6')).paidAt).not.toBeNull()
  })

  test('başkası aynı taksidi ödediyse 409: Türkçe mesaj, liste tazelenir, ikinci ödeme yok', async ({
    page,
    loginAs,
    api,
  }) => {
    await loginAs('yonetici', { fresh: true })
    const client = await api('yonetici', { fresh: true })

    await page.goto(ADMIN_URL)
    await page.getByLabel('Tabloda ara').fill('İpek Güneş')
    const row = bodyRows(page).filter({ hasText: '6. taksit' })
    await expect(row).toContainText('Yaklaşan')
    await row.getByRole('button', { name: 'İpek Güneş 6. taksiti tahsil et' }).click()
    const dialog = paymentDialog(page)
    await expect(dialog.getByLabel('Ödeme yöntemi')).toBeVisible()

    // Form açıkken ön büroda başka biri tahsil etti; ekrandaki liste eski.
    await payThroughApi(client, 'inv-s13-5', 'Kredi kartı')
    await dialog.getByRole('button', { name: 'Tahsilatı kaydet' }).click()

    await expect(page.getByText('Bu taksit zaten ödenmiş. Liste güncellendi.')).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(row).toContainText('Ödendi')
    // Kayıt ilk ödemenin yöntemini korur: ikinci ödeme yazılmadı.
    expect((await invoice(client, 'inv-s13-5')).method).toBe('Kredi kartı')
  })

  test('ön büro Tahsilat Takibi sayfasından ödeme alır', async ({ page, loginAs, api }) => {
    await loginAs('onburo', { fresh: true })
    const client = await api('onburo')

    await page.goto(FRONT_OFFICE_URL)
    await expect(page.getByRole('heading', { level: 1, name: 'Tahsilat Takibi' })).toBeVisible()
    await page.getByLabel('Tabloda ara').fill('Ege Öztürk')
    const row = bodyRows(page).filter({ hasText: '6. taksit' })
    await row.getByRole('button', { name: 'Ege Öztürk 6. taksit detayını aç' }).click()

    const detail = page.getByRole('dialog', { name: 'Taksit detayı' })
    await expect(detail).toContainText('Henüz tahsil edilmedi')
    await detail.getByRole('button', { name: 'Tahsil et' }).click()
    const dialog = paymentDialog(page)
    await dialog.getByLabel('Ödeme yöntemi').selectOption('Kredi kartı')
    await dialog.getByRole('button', { name: 'Tahsilatı kaydet' }).click()

    await expect(dialog).toBeHidden()
    // İç içe panel: tahsilat kapanınca taksit detayı güncel haliyle açık kalır.
    await expect(detail).toContainText('Ödendi')
    await expect(detail).toContainText('Kredi kartı')
    await expect(detail.getByRole('button', { name: 'Tahsil et' })).toHaveCount(0)
    expect((await invoice(client, 'inv-s12-5')).method).toBe('Kredi kartı')
  })

  test('öğretmenin menüsünde finans yok; rota ve uçlar kapalı', async ({ page, loginAs, api }) => {
    await loginAs('ogretmen')
    await page.goto('/ogretmen/dashboard')
    const menu = page.getByRole('navigation', { name: 'Menü' })
    await expect(menu.getByRole('link', { name: 'Genel Bakış' })).toBeVisible()
    await expect(menu.getByRole('link', { name: /Finans|Tahsilat/ })).toHaveCount(0)

    await page.goto('/ogretmen/finans')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Bu sayfa kampüste bulunamadı.' }),
    ).toBeVisible()
    await page.goto(ADMIN_URL)
    await expect(page).toHaveURL(/\/ogretmen\/dashboard$/)

    const client = await api('ogretmen')
    expect((await client.get('/api/v1/collections/invoices')).status).toBe(403)
  })
})

type StatusCounts = { data: { value: string | null; sum?: number }[]; meta: { sum?: number } }

/** Kartın kuruş değeri: "24.500,00 ₺" biçimindeki metnin rakamları. */
const cents = (text: string | null) => Number((text ?? '').replace(/\D/g, ''))

test.describe('Finans: liste', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs('yonetici')
  })

  test('toplam kartları API toplamıyla eşleşir', async ({ page, api }) => {
    const client = await api('yonetici')
    await page.goto(ADMIN_URL)
    const cards = page.getByLabel('Kurum geneli ödeme toplamları')
    const card = (name: string) => cards.locator('div').filter({ hasText: name }).locator('dd')

    // Paralel testler tahsilat yazabildiği için API her denemede yeniden okunur; ikisi yakınsar.
    await expect
      .poll(async () => {
        const result = await client.get(
          '/api/v1/collections/invoices/counts?groupBy=status&sum=amount',
        )
        expect(result.status).toBe(200)
        const { data, meta } = result.body as StatusCounts
        const sumOf = (status: string) => data.find((group) => group.value === status)?.sum ?? 0
        const total = meta.sum ?? 0
        const expected = [total, sumOf('Ödendi'), total - sumOf('Ödendi'), sumOf('Gecikmiş')]
        const shown = await Promise.all(
          ['Toplam eğitim bedeli', 'Tahsil edilen', 'Kalan bakiye', 'Gecikmiş tutar'].map(
            async (name) => cents(await card(name).textContent()),
          ),
        )
        return JSON.stringify(shown) === JSON.stringify(expected)
          ? 'eşit'
          : `${JSON.stringify(shown)} != ${JSON.stringify(expected)}`
      })
      .toBe('eşit')
    // Seed: 1920 taksit × 24.500,00 TL; tutar kuruş olarak toplanır.
    expect(cents(await card('Toplam eğitim bedeli').textContent())).toBeGreaterThanOrEqual(
      1920 * 2_450_000,
    )
  })

  test('durum filtresi sunucuda sayfalanır; ikinci sayfa aynı durumu verir', async ({ page }) => {
    const requests: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname === '/api/v1/collections/invoices') requests.push(url.search)
    })
    await page.goto(`${ADMIN_URL}?durum=yaklasan`)
    await expect(resultCount(page)).toContainText('1–8 /')
    const firstPage = await bodyRows(page).allTextContents()
    expect(firstPage).toHaveLength(8)

    await page.getByRole('button', { name: 'Sonraki sayfa' }).click()
    await expect(page).toHaveURL(/[?&]sayfa=2/)
    await expect(resultCount(page)).toContainText('9–16 /')
    await expect(bodyRows(page)).toHaveCount(8)
    for (const row of await bodyRows(page).all()) await expect(row).toContainText('Yaklaşan')
    expect(await bodyRows(page).allTextContents()).not.toEqual(firstPage)

    // Süzme sunucuda: istekler status taşır ve her sayfa 8 satırlıktır (tüm taksitler çekilmez).
    const listed = requests.filter((search) => search.includes('status='))
    expect(listed.length).toBeGreaterThanOrEqual(2)
    for (const search of listed) {
      const params = new URLSearchParams(search)
      expect(params.get('status')).toBe('Yaklaşan')
      expect(params.get('pageSize')).toBe('8')
    }
  })

  test('öğrenci adı sütunu sunucuda sıralanır', async ({ page }) => {
    await page.goto(ADMIN_URL)
    const header = tableOf(page).getByRole('columnheader', { name: /Öğrenci/ })
    await header.getByRole('button').click()
    await expect(header).toHaveAttribute('aria-sort', 'ascending')
    await expect(page).toHaveURL(/[?&]sirala=studentName/)
    const names = async () =>
      (await bodyRows(page).locator('.person-cell strong').allTextContents()).map((name) =>
        name.trim(),
      )
    await expect.poll(async () => (await names()).length).toBe(8)
    const ascending = await names()
    expect(ascending).toEqual([...ascending].sort((a, b) => a.localeCompare(b, 'tr')))

    await header.getByRole('button').click()
    await expect(header).toHaveAttribute('aria-sort', 'descending')
    await expect(page).toHaveURL(/[?&]yon=azalan/)
    await expect
      .poll(async () => {
        const descending = await names()
        return descending.length === 8 && descending[0] !== ascending[0]
      })
      .toBe(true)
    const descending = await names()
    expect(descending).toEqual([...descending].sort((a, b) => b.localeCompare(a, 'tr')))
  })

  test('arama öğrenci adı, okul numarası ve sınıf adıyla bulur', async ({ page }) => {
    await page.goto(ADMIN_URL)
    await page.getByLabel('Tabloda ara').fill('Deniz Yılmaz')
    await expect(resultCount(page)).toContainText('1–8 / 8 kayıt')
    for (const row of await bodyRows(page).all()) await expect(row).toContainText('Deniz Yılmaz')

    // Okul numarası ve sınıf adı da sunucuda aranır; aksan ve büyük/küçük harf duyarsız.
    await page.getByLabel('Tabloda ara').fill('2026001')
    await expect(resultCount(page)).toContainText('1–8 / 8 kayıt')
    for (const row of await bodyRows(page).all()) await expect(row).toContainText('Deniz Yılmaz')
    await page.getByLabel('Tabloda ara').fill('deniz yilmaz')
    await expect(resultCount(page)).toContainText('/ 8 kayıt')
    await page.getByLabel('Tabloda ara').fill('7-a')
    await expect(page).toHaveURL(/[?&]q=7-a/)
    await expect(resultCount(page)).not.toContainText('/ 8 kayıt')
    await expect(bodyRows(page).first()).toContainText('7-A')
  })

  test('liste API verisiyle açılır, vadeye göre sıralı ve sayfalıdır', async ({ page }) => {
    await page.goto(ADMIN_URL)
    await expect(page.getByRole('heading', { level: 1, name: 'Finans & Tahsilat' })).toBeVisible()
    await expect(page.getByText('1920 kayıt · Kurum genelinde ödeme hareketleri')).toBeVisible()
    await expect(bodyRows(page)).toHaveCount(8)
    await expect(resultCount(page)).toContainText('1–8 / 1920 kayıt')
    await expect(bodyRows(page).first()).toContainText('1. taksit')

    await page.getByRole('button', { name: 'Sonraki sayfa' }).click()
    await expect(page).toHaveURL(/[?&]sayfa=2/)
    await expect(resultCount(page)).toContainText('9–16 / 1920 kayıt')

    const header = tableOf(page).getByRole('columnheader', { name: /Tutar/ })
    await header.getByRole('button').click()
    await expect(header).toHaveAttribute('aria-sort', 'ascending')
    await expect(page).toHaveURL(/[?&]sirala=amount/)
    await expect(page).not.toHaveURL(/[?&]sayfa=/)
    await expect(bodyRows(page).first()).toContainText('24.500,00 ₺')
  })

  test('arama öğrenciyi bulur; durum filtresi sayfayı 1e döndürür ve URLde kalır', async ({
    page,
  }) => {
    await page.goto(ADMIN_URL)
    await page.getByRole('button', { name: 'Sonraki sayfa' }).click()
    await expect(page).toHaveURL(/[?&]sayfa=2/)

    await page.getByLabel('Ödeme durumu').selectOption({ label: 'Yaklaşan' })
    await expect(page).toHaveURL(/[?&]durum=yaklasan/)
    await expect(page).not.toHaveURL(/[?&]sayfa=/)
    await expect(bodyRows(page)).toHaveCount(8)
    for (const row of await bodyRows(page).all()) await expect(row).toContainText('Yaklaşan')

    await page.getByLabel('Tabloda ara').fill('Deniz Yılmaz')
    await expect(page).toHaveURL(/[?&]q=Deniz/)
    await page.getByLabel('Ödeme durumu').selectOption({ label: 'Ödendi' })
    await expect(resultCount(page)).toContainText('1–3 / 3 kayıt')
    for (const row of await bodyRows(page).all()) {
      await expect(row).toContainText('Deniz Yılmaz')
      await expect(row).toContainText('Ödendi')
    }

    // Yenileme ve geri/ileri durumu korur.
    await page.reload()
    await expect(page.getByLabel('Tabloda ara')).toHaveValue('Deniz Yılmaz')
    await expect(page.getByLabel('Ödeme durumu')).toHaveValue('odendi')
    await expect(resultCount(page)).toContainText('1–3 / 3 kayıt')

    await page.getByRole('button', { name: 'Aramayı ve filtreleri temizle' }).first().click()
    await expect(resultCount(page)).toContainText('/ 1920 kayıt')
    await expect(page).not.toHaveURL(/[?&](q|durum)=/)

    await page.getByLabel('Tabloda ara').fill('zzzz-yok')
    await expect(page.getByText('Aramanızla eşleşen kayıt bulunamadı.')).toBeVisible()
  })

  test('taksit detayı URLde açılır; geri kapatır, ileri açar', async ({ page }) => {
    await page.goto(ADMIN_URL)
    await page.getByLabel('Tabloda ara').fill('Deniz Yılmaz')
    await page.getByRole('button', { name: 'Deniz Yılmaz 1. taksit detayını aç' }).click()
    const detail = page.getByRole('dialog', { name: 'Taksit detayı' })
    await expect(detail).toContainText('Ödendi')
    await expect(detail).toContainText('7-A · 1. taksit')
    await expect(detail.getByRole('button', { name: 'Tahsil et' })).toHaveCount(0)
    await expect(page).toHaveURL(/[?&]detay=inv-s1-0/)

    await page.goBack()
    await expect(detail).toBeHidden()
    await expect(page.getByLabel('Tabloda ara')).toHaveValue('Deniz Yılmaz')
    await page.goForward()
    await expect(detail).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(detail).toBeHidden()
  })

  test('CSV filtrelenmiş bütün sonucu içerir', async ({ page }) => {
    await page.goto(`${ADMIN_URL}?q=Deniz+Y%C4%B1lmaz&durum=odendi`)
    await expect(resultCount(page)).toContainText('/ 3 kayıt')

    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Raporu indir' }).click()
    const csv = await readCsv(await pending)
    expect(csv[0]).toEqual(['Öğrenci', 'Taksit', 'Vade tarihi', 'Tutar', 'Durum'])
    expect(csv).toHaveLength(1 + 3)
    for (const row of csv.slice(1)) {
      expect(row[0]).toBe('Deniz Yılmaz')
      expect(row[3]).toBe('24.500,00 ₺')
      expect(row[4]).toBe('Ödendi')
    }
  })

  test('390 px genişlikte yatay taşma yok; kart, filtre ve panel açılır', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(ADMIN_URL)
    await expect(page.getByRole('article')).toHaveCount(8)
    await expectNoHorizontalOverflow(page)

    await page.getByRole('button', { name: 'Filtreler' }).click()
    await page.getByLabel('Ödeme durumu').selectOption({ label: 'Yaklaşan' })
    await expect(page.getByRole('article').first()).toContainText('Yaklaşan')
    await expectNoHorizontalOverflow(page)

    await page.goto(`${ADMIN_URL}?tahsilat=inv-s1-7`)
    await expect(paymentDialog(page).getByLabel('Ödeme yöntemi')).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
