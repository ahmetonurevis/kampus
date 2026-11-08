import { randomUUID } from 'node:crypto'

import type { Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Banka hareketi eşleştirme (IST-115, ON-099; DOM-FIN-069). Ayrıştırma, puanlama, kısmi/fazla ödeme,
// kapalı gün ve eşzamanlılık dalları birim, API ve PG testlerindedir (`tests/finance-bank-*.test.ts`,
// `apps/api/test/finance-bank-matching.test.ts`, `apps/api/test/finance/pg-bank-matching.test.ts`);
// burada yönetici ekstreyi yükler, öneriyi onaylayınca tahsilat oluşur, ilgisiz hareketi yoksayar.
// Kurum: Deniz Yılmaz (s1, velisi Ayşe Yılmaz), 4–8. taksitleri açık, 24.500 ₺.

const URL = '/yonetici/finans?gorunum=banka'
const DAY = 86_400_000

const toast = (page: Page, text: string) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text })
const section = (page: Page) => page.getByRole('region', { name: 'Banka eşleştirme' })

/** İstanbul gününe göre birkaç gün önce (`GG.AA.YYYY`): gelecek gün olmasın. */
function daysAgo(days: number) {
  const [year, month, day] = new Date(Date.now() - days * DAY)
    .toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' })
    .split('-')
  return `${day ?? ''}.${month ?? ''}.${year ?? ''}`
}

async function bankAccount(client: ApiClient) {
  const result = await client.post(
    '/api/v1/bank-accounts',
    {
      bankName: 'Örnek Bankası',
      iban: 'TR33 0006 1005 1978 6457 8413 26',
      accountHolder: 'Akademi Özel Okulları',
    },
    { 'idempotency-key': randomUUID() },
  )
  expect(result.status, JSON.stringify(result.body)).toBe(201)
}

const statement = () => ({
  name: 'ekstre.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from(
    [
      'Hesap Hareketleri;;;;',
      'Tarih;Açıklama;Tutar;Bakiye;Dekont No',
      `${daysAgo(3)};EFT AYSE YILMAZ DENIZ YILMAZ TAKSIT;24.500,00;124.500,00;E2E-EFT-1`,
      `${daysAgo(3)};MASRAF;-12,50;124.487,50;E2E-MSR-1`,
      `${daysAgo(2)};KIRA GELIRI;5.000,00;129.487,50;E2E-KIRA-1`,
    ].join('\n'),
  ),
})

test.describe('DOM-FIN-069: banka eşleştirme ekranı', () => {
  test('IST-115: yönetici ekstreyi yükler, öneriyi onaylayınca tahsilat oluşur; ilgisiz hareketi yoksayar', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: [], students: ['s1'] })
    const client = await api(school.user('yonetici'))
    await bankAccount(client)
    await loginAs(school.user('yonetici'))
    await page.goto(URL)
    await expect(section(page).getByText('Eşleşmeyi bekleyen hareket yok.')).toBeVisible()

    await section(page).getByRole('button', { name: 'Ekstre yükle' }).click()
    const dialog = page.getByRole('dialog', { name: 'Banka ekstresi yükle' })
    await dialog.getByLabel('Banka hesabı').selectOption({ label: 'Örnek Bankası · 1326' })
    await dialog.getByLabel('Ekstre dosyası').setInputFiles(statement())
    await dialog.getByRole('button', { name: 'Önizle' }).click()
    const summary = dialog.getByText(/gelen hareket aktarılacak/)
    await expect(summary).toContainText('2 gelen hareket aktarılacak')
    await expect(summary).toContainText('1 giden hareket alınmaz')
    await dialog.getByRole('button', { name: '2 hareketi aktar' }).click()
    await expect(toast(page, '2 hareket aktarıldı')).toBeVisible()

    // Aktarım tahsilat oluşturmaz (IST-115 kabul ölçütü).
    const before = await client.get('/api/v1/payments?studentId=s1&pageSize=100')
    const paidBefore = (before.body as { meta: { total: number } }).meta.total

    const deniz = section(page).getByRole('row').filter({ hasText: 'DENIZ YILMAZ' })
    await expect(deniz).toContainText('Deniz Yılmaz · 4. taksit')
    await expect(deniz).toContainText('Yüksek güven')
    await deniz.getByRole('button', { name: /hareketi eşleştir$/ }).click()
    const panel = page.getByRole('dialog', { name: 'Banka hareketini eşleştir' })
    await panel.getByRole('radio', { name: /Deniz Yılmaz/ }).check()
    await panel.getByRole('button', { name: 'Onayla ve tahsil et' }).click()
    await expect(toast(page, 'Tahsilat kaydedildi')).toBeVisible()
    await expect(deniz).toHaveCount(0)

    await expect
      .poll(async () => {
        const result = await client.get('/api/v1/payments?studentId=s1&pageSize=100')
        const body = result.body as {
          data: { reference: string; method: string; amountCents: number }[]
        }
        return body.data.find((payment) => payment.reference === 'E2E-EFT-1') ?? null
      })
      .toMatchObject({ method: 'Banka havalesi', amountCents: 2_450_000 })
    const after = await client.get('/api/v1/payments?studentId=s1&pageSize=100')
    expect((after.body as { meta: { total: number } }).meta.total).toBe(paidBefore + 1)

    const rent = section(page).getByRole('row').filter({ hasText: 'KIRA GELIRI' })
    await rent.getByRole('button', { name: /hareketi eşleştir$/ }).click()
    await panel.getByRole('button', { name: 'Yoksay' }).click()
    await panel.getByLabel('Yoksayma gerekçesi').fill('Kira geliri')
    await panel.getByRole('button', { name: 'Hareketi yoksay' }).click()
    await expect(toast(page, 'Hareket yoksayıldı.')).toBeVisible()
    await expect(rent).toHaveCount(0)

    await section(page).getByLabel('Durum').selectOption({ label: 'Eşleşti' })
    await expect(section(page).getByRole('row').filter({ hasText: 'DENIZ YILMAZ' })).toContainText(
      'Eşleşti',
    )
  })

  test('DOM-FIN-069, K-105: ön büro sekmeyi görmez; dar ekranda taşma yok', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'] })
    const desk = await loginAs(school.user('onburo'))
    await desk.goto('/onburo/tahsilat-takip?gorunum=banka')
    await expect(desk.getByRole('button', { name: 'Taksitler', exact: true })).toBeVisible()
    await expect(desk.getByRole('button', { name: 'Banka eşleştirme', exact: true })).toHaveCount(0)

    const page = await loginAs(school.user('yonetici'))
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(URL)
    await expect(section(page).getByRole('button', { name: 'Ekstre yükle' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
