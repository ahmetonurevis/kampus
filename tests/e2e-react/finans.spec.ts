import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import type { Download, Locator, Page, Request } from '@playwright/test'

import { readWorkbook } from '../../apps/api/test/support/finance-workbook.ts'
import type { ApiClient } from './support/api.ts'
import { e2e } from './support/env.ts'
import { pdfText } from './support/finance-pdf-text.ts'
import { seedScholarshipContract, seedStudentPayerContract } from './support/finance-terms.ts'
import { expect, test } from './support/fixtures.ts'
import {
  expectContentInsideCards,
  expectEveryRow,
  expectNoHorizontalOverflow,
} from './support/ui.ts'

// Finans & Tahsilat (yönetici /finans, ön büro /tahsilat-takip). Seed: 240 öğrenci × 8 taksit =
// 1920 taksit; her öğrencinin ilk üç taksiti ödenmiş, 5.–8. taksitlerin vadesi ileridedir.
// Liste testleri seed kurumunu yalnız okur. Ödeme yapan her test kendi kurumunu kurar (öğrenci ve
// taksit kimlikleri seed ile aynı, kurum ayrı): tekrar koşuda ve paralel testte taksit hâlâ ödenmemiştir.

const ADMIN_URL = '/yonetici/finans'
const FRONT_OFFICE_URL = '/onburo/tahsilat-takip'
const TABLE = 'Taksit ve tahsilat listesi'
const PAY_PATH = /\/api\/v1\/payments$/

const tableOf = (page: Page) => page.getByRole('table', { name: TABLE })
const bodyRows = (page: Page) => tableOf(page).locator('tbody tr')
const resultCount = (page: Page) => page.locator('.result-count')
const fillReference = (dialog: Locator, value = `E2E-${randomUUID()}`) =>
  dialog.getByLabel('İşlem referansı').fill(value)
const paymentDialog = (page: Page) => page.getByRole('dialog', { name: 'Tahsilat kaydet' })

type InvoiceRecord = {
  paidAt: string | null
  method: string | null
  studentId: string
  amount: number
}

async function invoice(client: ApiClient, id: string): Promise<InvoiceRecord> {
  const result = await client.get(`/api/v1/collections/invoices/${id}`)
  expect(result.status, `taksit ${id}`).toBe(200)
  return (result.body as { data: { record: InvoiceRecord } }).data.record
}

/** Arayüzden geçmeden ödeme (başka bir kullanıcının aynı anda tahsilatı). */
async function payThroughApi(client: ApiClient, id: string, method: string) {
  const record = await invoice(client, id)
  const response = await client.context.fetch('/api/v1/payments', {
    method: 'POST',
    data: {
      studentId: record.studentId,
      amountCents: record.amount,
      method,
      reference: `E2E-${randomUUID()}`,
      invoiceId: id,
    },
    headers: { 'idempotency-key': randomUUID() },
    failOnStatusCode: false,
  })
  expect(response.status(), 'API ödemesi').toBe(201)
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
    tenant,
  }) => {
    const school = await tenant({ roles: [], students: ['s10'] })
    await loginAs(school.user('yonetici'))
    const client = await api(school.user('yonetici'))
    expect((await invoice(client, 'inv-s10-5')).paidAt).toBeNull()
    const payments = recordPayments(page)

    await page.goto(ADMIN_URL)
    await page.getByLabel('Tabloda ara').fill('Emir Kaya')
    // Arama metni adreste beklenmez (ADR 0009); etkisi kutu değeri ve süzülmüş satırlarla görülür.
    await expect(page.getByLabel('Tabloda ara')).toHaveValue('Emir Kaya')
    await expectEveryRow(bodyRows(page), 'Emir Kaya')
    const row = bodyRows(page).filter({ hasText: '6. taksit' })
    await expect(row).toContainText('Emir Kaya')
    await expect(row).toContainText('Yaklaşan')

    await row.getByRole('button', { name: 'Emir Kaya 6. taksiti tahsil et' }).click()
    const dialog = paymentDialog(page)
    await expect(dialog).toBeVisible()
    await expect(page).toHaveURL(/[?&]tahsilat=inv-s10-5/)
    await expect(dialog).toContainText('Emir Kaya · 6. taksit')
    await dialog.getByLabel('Ödeme yöntemi').selectOption('Senet')
    await expect(dialog.getByLabel('Senet numarası')).toBeVisible()
    await dialog.getByLabel('Ödeme yöntemi').selectOption('Banka havalesi')
    await fillReference(dialog)
    await dialog.getByRole('button', { name: 'Tahsilatı kaydet' }).click()

    await expect(page.getByText('Tahsilat kaydedildi.')).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(page).not.toHaveURL(/[?&]tahsilat=/)
    await expect(row).toContainText('Ödendi')
    await expect(row.getByRole('button', { name: /tahsil et/ })).toHaveCount(0)

    const stored = await invoice(client, 'inv-s10-5')
    expect(stored.paidAt).not.toBeNull()
    expect(stored.method).toBe('Banka havalesi')
    expect(payments).toHaveLength(1)
    expect(payments[0]?.headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('çift tıklama ve art arda gönderim tek ödeme isteği atar', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: [], students: ['s11'] })
    await loginAs(school.user('yonetici'))
    const client = await api(school.user('yonetici'))
    const payments = recordPayments(page)

    await page.goto(`${ADMIN_URL}?tahsilat=inv-s11-5`)
    const dialog = paymentDialog(page)
    const submit = dialog.getByRole('button', { name: 'Tahsilatı kaydet' })
    await fillReference(dialog)
    await submit.dblclick()
    await expect(page.getByText('Tahsilat kaydedildi.')).toBeVisible()
    await expect(dialog).toBeHidden()
    expect(payments).toHaveLength(1)
    expect((await invoice(client, 'inv-s11-5')).paidAt).not.toBeNull()

    // Düğme kilidinden bağımsız: aynı tikte iki gönderim (Enter + tıklama) yine tek istektir.
    await page.goto(`${ADMIN_URL}?tahsilat=inv-s11-6`)
    await expect(submit).toBeEnabled()
    await fillReference(dialog)
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
    tenant,
  }) => {
    const school = await tenant({ roles: [], students: ['s13'] })
    await loginAs(school.user('yonetici'))
    const client = await api(school.user('yonetici'))

    await page.goto(ADMIN_URL)
    await page.getByLabel('Tabloda ara').fill('İpek Güneş')
    const row = bodyRows(page).filter({ hasText: '6. taksit' })
    await expect(row).toContainText('Yaklaşan')
    await row.getByRole('button', { name: 'İpek Güneş 6. taksiti tahsil et' }).click()
    const dialog = paymentDialog(page)
    await expect(dialog.getByLabel('Ödeme yöntemi')).toBeVisible()

    // Form açıkken ön büroda başka biri tahsil etti; ekrandaki liste eski.
    await payThroughApi(client, 'inv-s13-5', 'Kredi kartı')
    await fillReference(dialog)
    await dialog.getByRole('button', { name: 'Tahsilatı kaydet' }).click()

    await expect(page.getByText('Bu taksit zaten ödenmiş. Liste güncellendi.')).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(row).toContainText('Ödendi')
    // Kayıt ilk ödemenin yöntemini korur: ikinci ödeme yazılmadı.
    expect((await invoice(client, 'inv-s13-5')).method).toBe('Kredi kartı')
  })

  test('DOM-FIN-030: kısmi tahsilat taksiti açık bırakır, panel kalan tutarı gösterir', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: [], students: ['s14'] })
    await loginAs(school.user('yonetici'))
    const client = await api(school.user('yonetici'))

    await page.goto(`${ADMIN_URL}?tahsilat=inv-s14-5`)
    const dialog = paymentDialog(page)
    const amount = dialog.getByLabel('Tutar (₺)')
    const total = (await invoice(client, 'inv-s14-5')).amount
    await expect(amount).toHaveValue(/,\d{2}$/)
    await amount.fill('abc')
    await fillReference(dialog)
    await dialog.getByRole('button', { name: 'Tahsilatı kaydet' }).click()
    await expect(dialog.getByText(/biçiminde girin/)).toBeVisible()

    await amount.fill('100,50')
    await fillReference(dialog)
    await dialog.getByRole('button', { name: 'Tahsilatı kaydet' }).click()
    await expect(page.getByText('Tahsilat kaydedildi.')).toBeVisible()
    expect((await invoice(client, 'inv-s14-5')).paidAt).toBeNull()

    // Liste kısmi durumu, kartlar kısmi tutarı gösterir.
    await page.goto(ADMIN_URL)
    await page.getByLabel('Tabloda ara').fill('s14')
    await expect(page.getByLabel('Kurum geneli ödeme toplamları')).toContainText('Tahsil edilen')
    const totals = (await client.get('/api/v1/finance/totals')).body as {
      data: { paidCents: number }
    }
    expect(totals.data.paidCents % 100).toBe(50)

    await page.goto(`${ADMIN_URL}?tahsilat=inv-s14-5`)
    await expect(dialog.getByText(/Ödenen .*Kalan/)).toBeVisible()
    const remaining = total - 10_050
    await expect(amount).toHaveValue(
      `${String(Math.floor(remaining / 100))},${String(remaining % 100).padStart(2, '0')}`,
    )
    await fillReference(dialog)
    await dialog.getByRole('button', { name: 'Tahsilatı kaydet' }).click()
    await expect(page.getByText('Tahsilat kaydedildi.')).toBeVisible()
    expect((await invoice(client, 'inv-s14-5')).paidAt).not.toBeNull()
  })

  test('DOM-FIN-035, ON-113: gecikmiş taksitte Hatırlat bildirim yazar, düğme Hatırlatıldı olur', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const late = 'e2e-inv-gecikmis'
    const school = await tenant({
      roles: [],
      students: ['s17'],
      records: [
        {
          collection: 'invoices' as const,
          data: {
            id: late,
            studentId: 's17',
            installment: 9,
            amount: 100_000,
            // Taksit tablosu vadeyi 09:00 UTC ister (`invoice-store.ts`).
            dueDate: `${new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10)}T09:00:00.000Z`,
            paidAt: null,
            method: null,
            reminderAt: null,
          },
        },
      ],
    })
    await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN_URL}?durum=gecikmis`)
    const row = bodyRows(page).filter({ hasText: '9. taksit' })
    const button = row.getByRole('button', { name: /9\. taksit: Hatırlat/ })
    await expect(button).toHaveText('Hatırlat')
    await button.click()
    await expect(page.getByText('Hatırlatma veliye gönderildi.')).toBeVisible()
    await expect(button).toHaveText('Hatırlatıldı')
    await expect(button).toBeDisabled()
    const client = await api(school.user('yonetici'))
    const stored = await client.get(`/api/v1/collections/invoices/${late}`)
    const record = (stored.body as { data: { record: { reminderAt: string | null } } }).data.record
    expect(record.reminderAt).not.toBeNull()
  })

  test('DOM-FIN-031: kullanılmış referans alanda gösterilir, form açık kalır', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: [], students: ['s15'] })
    await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN_URL}?tahsilat=inv-s15-5`)
    const dialog = paymentDialog(page)
    await fillReference(dialog, 'E2E-AYNI-REF')
    await dialog.getByRole('button', { name: 'Tahsilatı kaydet' }).click()
    await expect(page.getByText('Tahsilat kaydedildi.')).toBeVisible()

    await page.goto(`${ADMIN_URL}?tahsilat=inv-s15-6`)
    await fillReference(dialog, 'E2E-AYNI-REF')
    await dialog.getByRole('button', { name: 'Tahsilatı kaydet' }).click()
    await expect(dialog.getByText('Bu işlem referansı daha önce kaydedilmiş.')).toBeVisible()
    await expect(dialog).toBeVisible()
  })

  test('DOM-FIN-032: nakit varsayılan kapalı; yönetici açınca formda görünür, referans istemez', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: [], students: ['s16'] })
    await loginAs(school.user('yonetici'))
    const client = await api(school.user('yonetici'))

    await page.goto(`${ADMIN_URL}?tahsilat=inv-s16-5`)
    const dialog = paymentDialog(page)
    const method = dialog.getByLabel('Ödeme yöntemi')
    await expect(method).toBeVisible()
    await expect(method.getByRole('option', { name: 'Nakit' })).toHaveCount(0)

    // Ödeme ayarı "Kurum & Modüller"in altında değil, kendi sekmesindedir; seçim adreste kalır.
    await page.goto('/yonetici/ayarlar')
    const toggle = page.getByRole('switch', { name: 'Nakit tahsilat' })
    await expect(page.getByRole('button', { name: 'Kurum & Modüller' })).toBeVisible()
    await expect(toggle).toHaveCount(0)
    await page.getByRole('button', { name: 'Ödeme & Banka' }).click()
    await expect(page).toHaveURL(/[?&]sekme=odeme(&|$)/)
    await expect(toggle).not.toBeChecked()
    await toggle.click()
    const confirm = page.getByRole('dialog', { name: 'Nakit tahsilatı aç' })
    await expect(confirm).toContainText('ÖÖKY md. 55/3')
    await confirm.getByRole('button', { name: 'Nakit tahsilatı aç' }).click()
    await expect(page.getByText('Nakit tahsilat açıldı.')).toBeVisible()
    await expect(toggle).toBeChecked()

    await page.goto(`${ADMIN_URL}?tahsilat=inv-s16-5`)
    await method.selectOption('Nakit')
    await expect(dialog.getByLabel('İşlem referansı')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Tahsilatı kaydet' }).click()
    await expect(page.getByText('Tahsilat kaydedildi.')).toBeVisible()
    expect((await invoice(client, 'inv-s16-5')).method).toBe('Nakit')
  })

  test('DOM-FIN-032: yönetici hesap ekler, tahsilat hesaba bağlanır, MEBBİS işareti listeden süzülür', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: [], students: ['s16'] })
    await loginAs(school.user('yonetici'))

    await page.goto('/yonetici/ayarlar?sekme=odeme')
    const accountForm = page.getByRole('form', { name: 'Banka hesabı ekle' })
    await accountForm.getByLabel('Banka adı').fill('Örnek Bankası')
    await accountForm.getByLabel('IBAN').fill('TR33 0006 1005 1978 6457 8413 27')
    await accountForm.getByLabel('Hesap sahibi').fill('Akademi Özel Okulları')
    await accountForm.getByRole('button', { name: 'Hesabı ekle' }).click()
    await expect(accountForm.getByText('Geçerli bir IBAN girin.')).toBeVisible()
    await accountForm.getByLabel('IBAN').fill('TR33 0006 1005 1978 6457 8413 26')
    await accountForm.getByRole('button', { name: 'Hesabı ekle' }).click()
    await expect(page.getByText('Banka hesabı eklendi.')).toBeVisible()
    await expect(
      page.getByRole('list', { name: 'Banka hesapları' }).getByText('TR330006100519786457841326', {
        exact: false,
      }),
    ).toBeVisible()

    await page.goto(`${ADMIN_URL}?tahsilat=inv-s16-5`)
    const dialog = paymentDialog(page)
    await expect(dialog.getByLabel('Banka hesabı')).toHaveValue(/.+/)
    await fillReference(dialog)
    await dialog.getByRole('button', { name: 'Tahsilatı kaydet' }).click()
    await expect(page.getByText('Tahsilat kaydedildi.')).toBeVisible()

    await page.goto(`${ADMIN_URL}?gorunum=tahsilatlar`)
    const table = page.getByRole('table', { name: 'Tahsilat geçmişi' })
    await expect(table.getByText('Örnek Bankası · 1326')).toBeVisible()
    await page.getByLabel('MEBBİS durumu').selectOption('pending')
    await expect(table.getByText('İşlenmedi')).toBeVisible()
    await table.getByRole('button', { name: /MEBBİS işaretini değiştir/ }).click()
    await expect(table.getByText('İşlenmedi')).toHaveCount(0)
    await page.getByLabel('MEBBİS durumu').selectOption('all')
    await expect(table.getByRole('button', { name: /MEBBİS işaretini değiştir/ })).toHaveText(
      'İşareti kaldır',
    )
  })

  test('ON-036, DOM-FIN-030: tahsilat geçmişi ödeme yöntemine göre sunucuda süzülür', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: [], students: ['s19'] })
    const client = await api(school.user('yonetici'))
    await payThroughApi(client, 'inv-s19-5', 'Kredi kartı')
    await payThroughApi(client, 'inv-s19-6', 'Banka havalesi')
    const requests: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname === '/api/v1/payments') requests.push(url.search)
    })
    await loginAs(school.user('yonetici'))

    await page.goto(`${ADMIN_URL}?gorunum=tahsilatlar`)
    const table = page.getByRole('table', { name: 'Tahsilat geçmişi' })
    const rows = table.locator('tbody tr')
    await expect(table).toContainText('Kredi kartı')
    await expect(table).toContainText('Banka havalesi')
    await page.getByLabel('Ödeme yöntemi').selectOption({ label: 'Kredi kartı' })
    await expectEveryRow(rows, 'Kredi kartı')
    await page.getByLabel('Ödeme yöntemi').selectOption({ label: 'Banka havalesi' })
    await expectEveryRow(rows, 'Banka havalesi')
    expect(
      requests.some((search) => new URLSearchParams(search).get('method') === 'Kredi kartı'),
    ).toBe(true)

    await page.getByLabel('Ödeme yöntemi').selectOption({ label: 'Tüm yöntemler' })
    await expect(table).toContainText('Kredi kartı')
    await expect(table).toContainText('Banka havalesi')
  })

  test('ON-118: tahsilat geçmişi ödeme gününe göre sunucuda süzülür; ters aralık uyarır', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: [], students: ['s19'] })
    const client = await api(school.user('yonetici'))
    await payThroughApi(client, 'inv-s19-5', 'Kredi kartı')
    const day = (offset: number) =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(
        Date.now() + offset * 24 * 60 * 60 * 1000,
      )
    await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN_URL}?gorunum=tahsilatlar`)
    const table = page.getByRole('table', { name: 'Tahsilat geçmişi' })
    await expect(table).toContainText('Kredi kartı')

    await page.getByLabel('Ödeme günü (başlangıç)').fill(day(1))
    await expect(table).not.toContainText('Kredi kartı')
    await page.getByLabel('Ödeme günü (başlangıç)').fill(day(0))
    await expect(table).toContainText('Kredi kartı')
    await page.getByLabel('Ödeme günü (bitiş)').fill(day(-1))
    await expect(page.getByRole('alert').filter({ hasText: 'Bitiş günü' })).toBeVisible()
  })

  test('ON-118: ayrılış ve iade listesi öğrenci adıyla aranır ve iade durumuyla süzülür', async ({
    page,
    loginAs,
  }) => {
    await loginAs('yonetici')
    await page.goto(`${ADMIN_URL}?gorunum=ayrilis`)
    const table = page.getByRole('table', { name: 'Ayrılış ve iade kayıtları' })
    await expect(table).toBeVisible()
    const requests: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname === '/api/v1/withdrawals') requests.push(url.search)
    })
    await page.getByLabel('İade durumu').selectOption({ label: 'Ödendi' })
    await expect
      .poll(() => requests.some((q) => new URLSearchParams(q).get('refundStatus') === 'paid'))
      .toBe(true)
    await page.getByLabel('Tabloda ara').fill('zzzz-yok')
    await expect
      .poll(() => requests.some((q) => new URLSearchParams(q).get('q') === 'zzzz-yok'))
      .toBe(true)
    await expect(page.getByText('Aramanızla eşleşen kayıt bulunamadı.')).toBeVisible()
  })

  test('DOM-FIN-033: yönetici tahsilatı gerekçeyle iptal eder, taksit açılır, satır kalır', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'], students: ['s17'] })
    await loginAs(school.user('yonetici'))
    const client = await api(school.user('yonetici'))
    await payThroughApi(client, 'inv-s17-5', 'Kredi kartı')

    await page.goto(`${ADMIN_URL}?gorunum=tahsilatlar`)
    const table = page.getByRole('table', { name: 'Tahsilat geçmişi' })
    await expect(table).toContainText('Geçerli')
    await page.getByRole('button', { name: /numaralı tahsilatı iptal et/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Tahsilatı iptal et' })
    await dialog.getByRole('button', { name: 'Tahsilatı iptal et' }).click()
    await expect(dialog.getByText(/gerekçesi en az 5/)).toBeVisible()
    await dialog.getByLabel('İptal gerekçesi').fill('Yanlış öğrenciye girildi')
    await dialog.getByRole('button', { name: 'Tahsilatı iptal et' }).click()
    await expect(page.getByText('Tahsilat iptal edildi.')).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(table).toContainText('İptal edildi')
    await expect(page.getByRole('button', { name: /numaralı tahsilatı iptal et/ })).toHaveCount(0)
    expect((await invoice(client, 'inv-s17-5')).paidAt).toBeNull()
  })

  test('DOM-FIN-052: ön büro tahsilat geçmişini görür, iptal düğmesi yoktur', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'], students: ['s18'] })
    const client = await api(school.user('yonetici'))
    await payThroughApi(client, 'inv-s18-5', 'Kredi kartı')
    await loginAs(school.user('onburo'))
    await page.goto('/onburo/tahsilat-takip?gorunum=tahsilatlar')
    await expect(page.getByRole('table', { name: 'Tahsilat geçmişi' })).toContainText('Geçerli')
    await expect(page.getByRole('button', { name: /numaralı tahsilatı iptal et/ })).toHaveCount(0)
  })

  test('DOM-FIN-025: yönetici burs programı açar, bildirim gününü işler; ön büro yalnız görür', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici', 'onburo'], students: [] })
    await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN_URL}?gorunum=burs`)
    await page.getByRole('button', { name: 'Yeni burs programı' }).click()
    const form = page.getByRole('dialog', { name: 'Yeni burs programı' })
    // Eksik alanlar form hatası verir, istek atılmaz.
    await form.getByRole('button', { name: 'Programı aç' }).click()
    await expect(form.getByText('Burslu sayısını girin.')).toBeVisible()
    await form.getByLabel('Program adı').fill('Başarı Bursu')
    await form.getByLabel('Burs şartları').fill('Sınav puanı 90 ve üstü.')
    await form
      .getByLabel('Kesilme koşulları')
      .fill('Disiplin cezası alan öğrencinin bursu kesilir.')
    await form.getByLabel('Burslu sayısı').fill('2')
    await form.getByLabel('Oran (%)').fill('25')
    await form.getByRole('button', { name: 'Programı aç' }).click()
    await expect(page.getByText('Burs programı açıldı.')).toBeVisible()
    const table = page.getByRole('table', { name: 'Burs programları' })
    const row = table.locator('tbody tr').filter({ hasText: 'Başarı Bursu' })
    await expect(row).toContainText('%25')
    await expect(row).toContainText('0 / 2')
    await expect(row).toContainText('Bildirilmedi')
    await page.getByRole('button', { name: 'Başarı Bursu bildirim gününü işle' }).click()
    const dialog = page.getByRole('dialog', { name: 'Bildirim gününü işle' })
    await dialog.getByRole('button', { name: 'Kaydet' }).click()
    await expect(page.getByText('Bildirim günü işlendi.')).toBeVisible()
    await expect(row).not.toContainText('Bildirilmedi')
    await expect(
      page.getByRole('button', { name: 'Başarı Bursu bildirim gününü işle' }),
    ).toHaveCount(0)
    await page.context().clearCookies()
    await loginAs(school.user('onburo'))
    await page.goto(`${FRONT_OFFICE_URL}?gorunum=burs`)
    await expect(page.getByRole('table', { name: 'Burs programları' })).toContainText(
      'Başarı Bursu',
    )
    await expect(page.getByRole('button', { name: 'Yeni burs programı' })).toHaveCount(0)
  })

  test('DOM-FIN-013: yönetici peşin ve süreli koşulu ilan eder; görüntülemede görünür, koşulsuz yayım reddedilir', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'], students: ['s19'] })
    await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN_URL}?gorunum=tarife`)
    await page.getByRole('button', { name: 'Yeni tarife' }).click()
    const editor = page.getByRole('dialog', { name: 'Yeni tarife' })
    await editor.getByLabel('Tutar (₺)', { exact: true }).fill('300.000,00')
    await editor.getByLabel('MEBBİS onaylı tutar (₺)').fill('300.000,00')
    // Koşul satırları dar ekranda taşmaz; satırlar tek sütuna iner.
    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await editor.getByRole('button', { name: '1. ödeme koşulunu kaldır' }).click()
    await editor.getByRole('button', { name: '1. ödeme koşulunu kaldır' }).click()
    await editor.getByRole('button', { name: 'Taslağı kaydet' }).click()
    await expect(page.getByText('Tarife kaydedildi.')).toBeVisible()
    await page.getByRole('button', { name: /tarifesini yayımla/ }).click()
    const publish = page.getByRole('dialog', { name: 'Tarifeyi yayımla' })
    await publish.getByRole('button', { name: 'Tarifeyi yayımla' }).click()
    await expect(
      page.getByText('Tarifede peşin ya da süreli en az bir ödeme koşulu ilan edilmelidir.'),
    ).toBeVisible()
    await publish.getByRole('button', { name: 'Vazgeç' }).click()

    await page.getByRole('button', { name: /taslağını düzenle/ }).click()
    const draft = page.getByRole('dialog', { name: 'Tarife taslağını düzenle' })
    await draft.getByRole('button', { name: 'Koşul ekle' }).click()
    await draft.getByLabel('1. koşul en çok taksit').fill('4')
    await draft.getByLabel('1. koşul fiyat farkı').selectOption('percent')
    await draft.getByLabel('1. koşul indirim değeri').fill('3')
    await draft.getByRole('button', { name: 'Taslağı kaydet' }).click()
    await expect(page.getByText('Tarife kaydedildi.').last()).toBeVisible()
    await page.getByRole('button', { name: /tarifesini yayımla/ }).click()
    await publish.getByRole('button', { name: 'Tarifeyi yayımla' }).click()
    await expect(page.getByText('Tarife yayımlandı.')).toBeVisible()

    await page.getByRole('button', { name: /tarifesini görüntüle/ }).click()
    const view = page.getByRole('dialog', { name: /tarifesi$/ })
    await expect(view.getByRole('list', { name: 'İlan edilen ödeme koşulları' })).toHaveText(
      'Süreli · 2–4 taksit · %3 indirim',
    )
  })

  test('DOM-FIN-002: yönetici tarife taslağı açar ve yayımlar; yayımlanan düzenlenemez; ön büro yalnız görür', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'], students: ['s19'] })
    await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN_URL}?gorunum=tarife`)
    await page.getByRole('button', { name: 'Yeni tarife' }).click()
    const editor = page.getByRole('dialog', { name: 'Yeni tarife' })
    await editor.getByRole('button', { name: 'Taslağı kaydet' }).click()
    await expect(editor.getByText(/biçiminde girin/).first()).toBeVisible()
    await editor.getByLabel('Tutar (₺)', { exact: true }).fill('300.000,00')
    await editor.getByLabel('MEBBİS onaylı tutar (₺)').fill('299.999,99')
    const overAnnounced = editor.getByText('Tutar, MEBBİS onaylı tutarı aşıyor.')
    await expect(overAnnounced).toBeVisible()
    await editor.getByLabel('MEBBİS onaylı tutar (₺)').fill('300.000,00')
    await expect(overAnnounced).toHaveCount(0)
    await editor.getByRole('button', { name: 'Taslağı kaydet' }).click()
    await expect(page.getByText('Tarife kaydedildi.')).toBeVisible()

    const table = page.getByRole('table', { name: 'Ücret tarifeleri' })
    await expect(table).toContainText('Taslak')
    await page.getByRole('button', { name: /tarifesini yayımla/ }).click()
    const publish = page.getByRole('dialog', { name: 'Tarifeyi yayımla' })
    await publish.getByRole('button', { name: 'Tarifeyi yayımla' }).click()
    await expect(page.getByText('Tarife yayımlandı.')).toBeVisible()
    await expect(table).toContainText('Yayında')
    await expect(page.getByRole('button', { name: /taslağını düzenle/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /yeni sürüm aç/ })).toBeVisible()

    // ON-055: yayımlanmış tarife sonraki eğitim yılının taslağını başlatır; ilan tutarı boş gelir.
    const year = Number(
      await table
        .locator('tbody tr')
        .first()
        .locator('td')
        .first()
        .innerText()
        .then((text) => text.match(/\d{4}/)?.[0] ?? '0'),
    )
    await page.getByRole('button', { name: /sonraki eğitim yılına taşı/ }).click()
    const nextYear = page.getByRole('dialog', { name: 'Sonraki yıl tarifesi' })
    await expect(nextYear.getByLabel('MEBBİS onaylı tutar (₺)')).toHaveValue('')
    await expect(nextYear.getByLabel('Tutar (₺)', { exact: true })).toHaveValue('300000,00')
    await nextYear.getByRole('button', { name: 'Taslağı kaydet' }).click()
    // Hızlı koşuda ilk taslağın aynı metinli bildirimi henüz kapanmamış olabilir.
    await expect(page.getByText('Tarife kaydedildi.').last()).toBeVisible()
    await expect(nextYear).toBeHidden()
    await expect(table).toContainText(String(year + 1))
    await expect(table).toContainText('Taslak')

    await loginAs(school.user('onburo'))
    await page.goto('/onburo/tahsilat-takip?gorunum=tarife')
    await expect(page.getByRole('table', { name: 'Ücret tarifeleri' })).toContainText('Yayında')
    await expect(page.getByRole('button', { name: 'Yeni tarife' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /yeni sürüm aç/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /sonraki eğitim yılına taşı/ })).toHaveCount(0)
    await page
      .getByRole('button', { name: /tarifesini görüntüle/ })
      .first()
      .click()
    await expect(page.getByRole('dialog')).toContainText('Öğrenim ücreti')
  })

  test('ON-024: yönetici dosya sütunlarını eşler, dosya yeni başlıkla iner; ön büroda düğme yok', async ({
    page,
    loginAs,
    tenant,
    api,
  }) => {
    const school = await tenant({ roles: ['onburo'], students: ['s21'] })
    const client = await api(school.user('yonetici'))
    await payThroughApi(client, 'inv-s21-5', 'Kredi kartı')
    await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN_URL}?gorunum=aktarim`)
    await page.getByRole('button', { name: 'Dosya sütunları' }).click()
    const dialog = page.getByRole('dialog', { name: 'Dosya sütunları' })
    await dialog.getByLabel('Tahsilat dosyası 1. sütun başlığı').fill('')
    await dialog.getByRole('button', { name: 'Kaydet' }).click()
    await expect(dialog.getByText('Sütun başlığını girin.')).toBeVisible()
    await dialog.getByLabel('Tahsilat dosyası 1. sütun başlığı').fill('Fiş Tarihi')
    await dialog.getByLabel('Tarih biçimi').selectOption('tr')
    await dialog.getByRole('button', { name: 'Kaydet' }).click()
    await expect(page.getByText('Dosya sütunları kaydedildi.')).toBeVisible()

    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Tahsilat dosyası' }).click()
    const body = await readFile(await (await downloading).path(), 'utf8')
    expect(body).toContain('"Fiş Tarihi"')
    expect(body).toMatch(/"\d{2}\.\d{2}\.\d{4}"/)

    await loginAs(school.user('onburo'))
    await page.goto('/onburo/tahsilat-takip?gorunum=aktarim')
    await expect(page.getByLabel('Dönem toplamları').or(page.getByRole('main'))).toBeVisible()
    await expect(page.getByRole('button', { name: 'Dosya sütunları' })).toHaveCount(0)
  })

  test('IST-111 ON-085: yıl sonu mutabakatı toplamı, tutmayan öğrenci ve dosya; ön büroda yok', async ({
    page,
    loginAs,
    tenant,
  }) => {
    // Seed taksitlerinin ilk üçü tahsilat kaydı olmadan ödenmiştir: eğitim yılında tutmayan satırdır.
    const school = await tenant({ roles: ['onburo'], students: ['s22'] })
    await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN_URL}?gorunum=aktarim`)
    const section = page.getByRole('region', { name: 'Yıl sonu mutabakatı' })
    await expect(section.getByLabel('Mutabakat toplamları')).toContainText('Kapanış')
    await expect(section.getByLabel('Mutabakat toplamları')).toContainText('Açılış aktarımı')
    await expect(section.getByRole('status').first()).toBeVisible()

    const table = section.getByRole('table', { name: 'Öğrenci bazında mutabakat' })
    await expect(table.getByRole('columnheader', { name: 'Açılış aktarımı' })).toBeVisible()
    await section.getByLabel('Gösterilecek öğrenciler').selectOption('mismatch')
    await expect
      .poll(async () => (await table.getByText('Tutuyor', { exact: true }).count()) === 0)
      .toBe(true)

    const downloading = page.waitForEvent('download')
    await section.getByRole('button', { name: 'Mutabakat dosyası' }).click()
    const file = await downloading
    expect(file.suggestedFilename()).toMatch(/^mutabakat-\d{4}\.csv$/)
    const body = await readFile(await file.path(), 'utf8')
    expect(body.charCodeAt(0)).toBe(0xfeff)
    expect(body).toContain('"Beklenen kapanış (₺)"')
    expect(body).toContain('"Açılış aktarımı (₺)"')

    await loginAs(school.user('onburo'))
    await page.goto('/onburo/tahsilat-takip?gorunum=aktarim')
    await expect(page.getByRole('heading', { name: 'Muhasebe aktarımı' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Yıl sonu mutabakatı' })).toHaveCount(0)
  })

  test('ON-094: yönetici hazır şablonu uygular; Excel dosyası profilin sütunlarıyla iner', async ({
    page,
    loginAs,
    tenant,
    api,
  }) => {
    const school = await tenant({ roles: [], students: ['s23'] })
    const client = await api(school.user('yonetici'))
    await payThroughApi(client, 'inv-s23-5', 'Kredi kartı')
    const amount = (await invoice(client, 'inv-s23-5')).amount

    await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN_URL}?gorunum=aktarim`)
    await page.getByRole('button', { name: 'Dosya sütunları' }).click()
    const dialog = page.getByRole('dialog', { name: 'Dosya sütunları' })
    await dialog.getByLabel('Hazır sütun şablonu').selectOption({ label: 'Kısa liste' })
    await dialog.getByRole('button', { name: 'Şablonu uygula' }).click()
    await expect(dialog.getByLabel('Tahsilat dosyası 2. sütun başlığı')).toHaveValue('Ad soyad')
    await expect(dialog.getByLabel('Tahsilat dosyası 4. sütun başlığı')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Kaydet' }).click()
    await expect(page.getByText('Dosya sütunları kaydedildi.')).toBeVisible()

    await page.getByLabel('Dosya biçimi').selectOption('xlsx')
    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Tahsilat dosyası' }).click()
    const file = await downloading
    expect(file.suggestedFilename()).toMatch(/^tahsilatlar-.*\.xlsx$/)
    const workbook = readWorkbook(await readFile(await file.path()))
    expect(workbook.row(1)).toEqual(['Tarih', 'Ad soyad', 'Tutar'])
    expect(workbook.hasFormula).toBe(false)
    expect(workbook.cells.get('C2')).toMatchObject({
      type: 'n',
      value: amount / 100,
      format: '#,##0.00',
    })
    expect(workbook.cells.get('B2')).toMatchObject({ type: 's', format: '@' })
  })

  test('IST-111: dönem toplamı dosya toplamına eşittir; dosya yöneticiye iner, ön büro indiremez', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'], students: ['s20'] })
    const client = await api(school.user('yonetici'))
    await payThroughApi(client, 'inv-s20-5', 'Kredi kartı')
    const amount = (await invoice(client, 'inv-s20-5')).amount

    await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN_URL}?gorunum=aktarim`)
    const totals = page
      .getByRole('list', { name: 'Dönem toplamları' })
      .or(page.getByLabel('Dönem toplamları'))
    await expect(totals).toContainText('1 hareket')
    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Tahsilat dosyası' }).click()
    const file = await downloading
    expect(file.suggestedFilename()).toMatch(/^tahsilatlar-.*\.csv$/)
    const body = await readFile(await file.path(), 'utf8')
    expect(body.charCodeAt(0)).toBe(0xfeff)
    const cents = String(amount % 100).padStart(2, '0')
    expect(body).toContain(`;${String(Math.floor(amount / 100))},${cents}`)

    await loginAs(school.user('onburo'))
    await page.goto('/onburo/tahsilat-takip?gorunum=aktarim')
    await expect(page.getByLabel('Dönem toplamları')).toContainText('1 hareket')
    await expect(page.getByRole('button', { name: 'Tahsilat dosyası' })).toHaveCount(0)
  })

  test('DOM-FIN-041, DOM-KAY-012: yönetici hesabı önizler, ayrılışı onaylar, iadeyi öder; ön büro yalnız görür', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'], students: ['s21'] })
    const client = await api(school.user('yonetici'))
    await loginAs(school.user('yonetici'))
    const student = (await client.get('/api/v1/collections/students/s21')).body as {
      data: { record: { name: string; parentId: string; isActive: boolean } }
    }
    const { name, parentId } = student.data.record
    const parent = (await client.get(`/api/v1/collections/parents/${parentId}`)).body as {
      data: { record: { name: string } }
    }

    await page.goto(`${ADMIN_URL}?gorunum=ayrilis`)
    await page.getByRole('button', { name: 'Ayrılış başlat' }).click()
    const dialog = page.getByRole('dialog', { name: 'Ayrılış başlat' })
    await dialog.getByRole('button', { name: 'Hesabı göster' }).click()
    await expect(dialog.getByLabel('Öğrenci')).toHaveAttribute('aria-invalid', 'true')

    await dialog.getByLabel('Öğrenci').selectOption({ label: name })
    await dialog.getByLabel('Dönem başlangıcı').fill('2026-09-07')
    await dialog.getByLabel('Görülen gün veya ders saati').fill('1')
    // Okulda gidilen yer ve ödenen ücret okul sözleriyle yazılır (DOM-KAY-012, ON-323).
    await expect(dialog.getByLabel('Gittiği okul (varsa)')).toBeVisible()
    await dialog.getByRole('button', { name: 'Hesabı göster' }).click()
    await expect(dialog.getByText('Hesap önizlemesi')).toBeVisible()
    await expect(dialog).toContainText('Hak edilen')
    await expect(dialog).toContainText('Ödenen öğrenim ücreti')
    // Önizleme kayıt yazmaz.
    const before = (await client.get('/api/v1/collections/students/s21')).body as typeof student
    expect(before.data.record.isActive).toBe(true)

    await dialog.getByRole('button', { name: 'Ayrılışı onayla' }).click()
    await expect(page.getByText('Ayrılış kaydedildi.')).toBeVisible()
    await expect(dialog).toBeHidden()
    const after = (await client.get('/api/v1/collections/students/s21')).body as typeof student
    expect(after.data.record.isActive).toBe(false)

    const table = page.getByRole('table', { name: 'Ayrılış ve iade kayıtları' })
    await expect(table).toContainText(name)
    await expect(table).toContainText('Ödenecek')
    await page.getByRole('button', { name: `${name} hesap dökümünü görüntüle` }).click()
    await expect(page.getByRole('dialog', { name: 'Hesap dökümü' })).toContainText('Hesap tabanı')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: `${name} iade kırılımını görüntüle` }).click()
    await expect(page.getByRole('dialog', { name: /İade hesap kırılımı/ })).toBeVisible()
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: `${name} iadesini ödenmiş işaretle` }).click()
    const refund = page.getByRole('dialog', { name: 'İadeyi öde' })
    await refund.getByLabel('IBAN').fill('TR330006100519786457841326')
    await refund.getByLabel('Hesap sahibi').fill('Başka Kişi')
    await refund.getByRole('button', { name: 'Ödendi olarak kaydet' }).click()
    await expect(refund.getByText('Hesap sahibi sözleşmedeki ödeyici olmalıdır.')).toBeVisible()
    await refund.getByLabel('Hesap sahibi').fill(parent.data.record.name)

    // Oturum eskidiyse parola sorulur ve işlem tekrarlanır (guvenlik-kvkk.md).
    let stale = true
    await page.route('**/api/v1/withdrawals/*/pay-refund', async (route) => {
      if (!stale) return route.continue()
      stale = false
      return route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'reauthentication_required',
          message: 'Bu işlem için parolanızı yeniden girmeniz gerekiyor.',
          requestId: 'e2e',
        }),
      })
    })
    await refund.getByRole('button', { name: 'Ödendi olarak kaydet' }).click()
    const reauth = page.getByRole('dialog', { name: 'Parolanızı doğrulayın' })
    await reauth.getByLabel('Parola').fill(e2e.password)
    await reauth.getByRole('button', { name: 'Doğrula ve devam et' }).click()
    await expect(page.getByText('İade ödendi olarak kaydedildi.')).toBeVisible()
    await expect(table).toContainText('Ödendi')
    await expect(table).not.toContainText('TR330006100519786457841326')

    await loginAs(school.user('onburo'))
    await page.goto('/onburo/tahsilat-takip?gorunum=ayrilis')
    await expect(page.getByRole('table', { name: 'Ayrılış ve iade kayıtları' })).toContainText(name)
    await expect(page.getByRole('button', { name: 'Ayrılış başlat' })).toHaveCount(0)
  })

  test('DOM-FIN-040, K-06: önizleme öğrenim sözleşmesini ve paket satışını ayrı ayrı gösterir', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      type: 'language_school',
      roles: [],
      students: ['s21'],
      tariffYears: ['current'],
    })
    const client = await api(school.user('yonetici'))
    const made = await client.post('/api/v1/finance/packages', {
      kind: 'hours',
      name: '40 saatlik paket',
      lessonHours: 40,
    })
    expect(made.status, 'paket').toBe(201)
    const packageId = (made.body as { data: { id: string } }).data.id
    const quote = await client.post('/api/v1/finance/package-sales/quote', {
      packageId,
      studentId: 's21',
      installmentCount: 2,
    })
    expect(quote.status, 'satış önizlemesi').toBe(200)
    const sold = await client.post(
      '/api/v1/finance/package-sales',
      {
        packageId,
        studentId: 's21',
        installmentCount: 2,
        tariffId: (quote.body as { data: { tariffId: string } }).data.tariffId,
        firstDueDate: '2026-12-01',
      },
      { 'idempotency-key': randomUUID() },
    )
    expect(sold.status, 'paket satışı').toBe(201)
    const student = (await client.get('/api/v1/collections/students/s21')).body as {
      data: { record: { name: string } }
    }

    await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN_URL}?gorunum=ayrilis`)
    await page.getByRole('button', { name: 'Ayrılış başlat' }).click()
    const dialog = page.getByRole('dialog', { name: 'Ayrılış başlat' })
    await dialog.getByLabel('Öğrenci').selectOption({ label: student.data.record.name })
    await dialog.getByLabel('Dönem başlangıcı').fill('2026-09-07')
    await dialog.getByLabel('Görülen gün veya ders saati').fill('1')
    await dialog.getByRole('button', { name: 'Hesabı göster' }).click()

    await expect(dialog.getByText('Yürürlükteki 2 sözleşme hesaba girdi.')).toBeVisible()
    const packageLine = dialog.getByRole('region', {
      name: 'Dil kursu paket sözleşmesi: 40 saatlik paket',
    })
    await expect(packageLine).toContainText('Kullanım (0 / 40 ders saati, kayıttan)')
    await expect(packageLine).toContainText('İade edilen kalan saat')
    await expect(dialog.getByRole('region', { name: 'Toplam' })).toContainText('Kalan borç')
    await expect(dialog).toContainText('paketlerin kalan saati iade edilmiş yazılır')

    // K-21: paket içeren ayrılışta yönetici tutarı işaretlemeden onay açılmaz.
    await expect(dialog.getByRole('button', { name: 'Ayrılışı onayla' })).toBeDisabled()
    await dialog.getByRole('checkbox', { name: /iade tutarını inceledim/ }).check()
    await dialog.getByRole('button', { name: 'Ayrılışı onayla' }).click()
    await expect(page.getByText('Ayrılış kaydedildi.')).toBeVisible()
    await page
      .getByRole('button', { name: `${student.data.record.name} hesap dökümünü görüntüle` })
      .click()
    await expect(
      page.getByRole('dialog', { name: 'Hesap dökümü' }).getByRole('region', {
        name: 'Dil kursu paket sözleşmesi: 40 saatlik paket',
      }),
    ).toBeVisible()
    await page.keyboard.press('Escape')
    const sale = (
      (await client.get('/api/v1/finance/package-sales?studentId=s21')).body as {
        data: { remainingHours: number }[]
      }
    ).data[0]
    expect(sale?.remainingHours).toBe(0)
  })

  test('K-12, DOM-FIN-040: ödeyiciler farklıysa önizleme söyler, karar ister; iade seçilen ödeyiciye yazılır', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: [], students: ['s21'] })
    await seedStudentPayerContract({
      institutionId: school.institutionId,
      studentId: 's21',
      contractId: 'contract-e2e-ogrenci',
      title: 'Öğrenci ödeyicili sözleşme',
    })
    const client = await api(school.user('yonetici'))
    const student = (await client.get('/api/v1/collections/students/s21')).body as {
      data: { record: { name: string; parentId: string } }
    }
    const { name, parentId } = student.data.record
    const parent = (await client.get(`/api/v1/collections/parents/${parentId}`)).body as {
      data: { record: { name: string } }
    }

    await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN_URL}?gorunum=ayrilis`)
    await page.getByRole('button', { name: 'Ayrılış başlat' }).click()
    const dialog = page.getByRole('dialog', { name: 'Ayrılış başlat' })
    await dialog.getByLabel('Öğrenci', { exact: true }).selectOption({ label: name })
    await dialog.getByLabel('Dönem başlangıcı').fill('2026-09-07')
    await dialog.getByLabel('Görülen gün veya ders saati').fill('1')
    await dialog.getByRole('button', { name: 'Hesabı göster' }).click()

    await expect(dialog.getByText('Hesaba giren sözleşmelerin ödeyicileri farklı.')).toBeVisible()
    await expect(dialog.getByRole('region', { name: 'Öğrenci ödeyicili sözleşme' })).toContainText(
      name,
    )
    // Karar verilmeden onay sunucuya gitmez.
    await dialog.getByRole('button', { name: 'Ayrılışı onayla' }).click()
    await expect(dialog.getByText('İadeyi alacak ödeyiciyi seçin.')).toBeVisible()
    await expect(dialog.getByText('Karar gerekçesini yazın.')).toBeVisible()
    const unchanged = (await client.get('/api/v1/collections/students/s21')).body as {
      data: { record: { isActive: boolean } }
    }
    expect(unchanged.data.record.isActive).toBe(true)

    await dialog.getByLabel('İadeyi alacak ödeyici').selectOption({ value: 'guardian' })
    await dialog.getByLabel('Karar gerekçesi').fill('Tahsilat velinin hesabından yapıldı')
    await dialog.getByRole('button', { name: 'Ayrılışı onayla' }).click()
    await expect(page.getByText('Ayrılış kaydedildi.')).toBeVisible()

    await page.getByRole('button', { name: `${name} hesap dökümünü görüntüle` }).click()
    const breakdown = page.getByRole('dialog', { name: 'Hesap dökümü' })
    await expect(breakdown).toContainText('İadeyi alacak ödeyici')
    await expect(breakdown).toContainText('Tahsilat velinin hesabından yapıldı')
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: `${name} iadesini ödenmiş işaretle` }).click()
    const refund = page.getByRole('dialog', { name: 'İadeyi öde' })
    await refund.getByLabel('IBAN').fill('TR330006100519786457841326')
    await refund.getByLabel('Hesap sahibi').fill(name)
    await refund.getByRole('button', { name: 'Ödendi olarak kaydet' }).click()
    await expect(refund.getByText('Hesap sahibi sözleşmedeki ödeyici olmalıdır.')).toBeVisible()
    await refund.getByLabel('Hesap sahibi').fill(parent.data.record.name)
    await refund.getByRole('button', { name: 'Ödendi olarak kaydet' }).click()
    await expect(page.getByText('İade ödendi olarak kaydedildi.')).toBeVisible()
  })

  test('DOM-FIN-050, -052: tahsilat dekontu PDF açılır; veli kendi tahsilatını ve dekontunu görür', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['veli'], students: ['s1'] })
    const client = await api(school.user('yonetici'))
    await payThroughApi(client, 'inv-s1-5', 'Kredi kartı')

    await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN_URL}?gorunum=tahsilatlar`)
    await page.getByRole('button', { name: /numaralı dekontu görüntüle/ }).click()
    await expect(page.getByRole('dialog', { name: /Tahsilat dekontu/ })).toBeVisible()
    await expect(page.getByRole('dialog', { name: /Tahsilat dekontu/ })).toContainText('2026-')

    await loginAs(school.user('veli'))
    await page.goto('/veli/finans')
    await expect(page.getByRole('heading', { name: 'Tahsilat geçmişi' })).toBeVisible()
    await page.getByRole('button', { name: /numaralı dekontu görüntüle/ }).click()
    await expect(page.getByRole('dialog', { name: /Tahsilat dekontu/ })).toBeVisible()
  })

  test('ön büro Tahsilat Takibi sayfasından ödeme alır', async ({ page, loginAs, api, tenant }) => {
    const school = await tenant({ roles: ['onburo'], students: ['s12'] })
    await loginAs(school.user('onburo'))
    const client = await api(school.user('onburo'))

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
    await fillReference(dialog)
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

  test('ON-036, DOM-YTK-040: finans modülü kapalıyken menü, adresler, pano kartları ve uçlar kapanır', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['veli'] })
    const admin = await api(school.user('yonetici'))
    const settings = await admin.get('/api/v1/modules')
    expect(settings.status).toBe(200)
    const { version } = (settings.body as { data: { version: number } }).data
    const closed = await admin.context.patch('/api/v1/modules/finance', {
      data: { enabled: false },
      headers: { 'if-match': `"${String(version)}"`, 'idempotency-key': randomUUID() },
    })
    expect(closed.status()).toBe(200)

    await loginAs(school.user('yonetici'))
    await page.goto(ADMIN_URL)
    await expect(page).toHaveURL(/\/yonetici\/dashboard$/)
    await expect(page.getByText('Bu modül kurum ayarlarından kapatılmış.')).toBeVisible()
    const menu = page.getByRole('navigation', { name: 'Menü' })
    await expect(menu.getByRole('link', { name: 'Finans & Tahsilat' })).toHaveCount(0)
    await expect(page.getByRole('article', { name: 'Tahsilat oranı', exact: true })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Yaklaşan ödemeler & takip' })).toHaveCount(0)
    const denied = await admin.get('/api/v1/payments')
    expect(denied.status).toBe(403)
    expect((denied.body as { code: string }).code).toBe('module_disabled')

    const parent = await api(school.user('veli'))
    expect((await parent.get('/api/v1/collections/invoices')).status).toBe(403)
  })
})

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

    // Kartlar kendi yanıtından gelir; API her denemede yeniden okunur ve ikisi yakınsayana dek beklenir.
    await expect
      .poll(async () => {
        const result = await client.get('/api/v1/finance/totals')
        expect(result.status).toBe(200)
        const { data } = result.body as {
          data: {
            totalCents: number
            paidCents: number
            remainingCents: number
            overdueCents: number
          }
        }
        const expected = [data.totalCents, data.paidCents, data.remainingCents, data.overdueCents]
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

  test('IST-116: pano "Gecikmiş tutar" Finans toplamıyla aynıdır, kampüs seçilince çizilmez', async ({
    page,
    api,
  }) => {
    const client = await api('yonetici')
    await page.goto('/yonetici/dashboard')
    const card = page.getByRole('article', { name: 'Gecikmiş tutar', exact: true })
    await expect
      .poll(async () => {
        const result = await client.get('/api/v1/finance/totals')
        expect(result.status).toBe(200)
        const { data } = result.body as { data: { overdueCents: number } }
        const shown = cents(await card.locator('.stat-value').textContent())
        return shown === data.overdueCents ? 'eşit' : `${shown} != ${data.overdueCents}`
      })
      .toBe('eşit')

    // Uç kurum genelidir: seçili kampüsün rakamı sanılmasın diye kart çizilmez.
    await page.goto('/yonetici/dashboard?sube=b2')
    await expect(page.getByRole('article', { name: 'Bekleyen tahsilat' })).toBeVisible()
    await expect(card).toHaveCount(0)
  })

  test('ON-036: pano "Tahsilat oranı" ödenen tutarın ödeme planına oranıdır, kampüse daralır', async ({
    page,
    api,
  }) => {
    const client = await api('yonetici')
    /** Sunucu sayımından beklenen oran: ödenmiş taksit tutarı / ödeme planı toplamı. */
    async function expectedRate(query = ''): Promise<string> {
      const result = await client.get(
        `/api/v1/collections/invoices/counts?groupBy=status&sum=amount${query}`,
      )
      expect(result.status).toBe(200)
      const body = result.body as {
        data: { value: string | null; sum?: number }[]
        meta: { sum?: number }
      }
      const total = body.meta.sum ?? 0
      const paid = body.data.find((group) => group.value === 'Ödendi')?.sum ?? 0
      return total > 0 ? `%${String(Math.round((paid / total) * 100))}` : '—'
    }
    const value = () =>
      page
        .getByRole('article', { name: 'Tahsilat oranı', exact: true })
        .locator('.stat-value')
        .innerText()

    await page.goto('/yonetici/dashboard')
    const card = page.getByRole('article', { name: 'Tahsilat oranı', exact: true })
    await expect(card).toContainText('Tüm ödeme planına göre')
    await expect
      .poll(async () => {
        const [shown, expected] = [await value(), await expectedRate()]
        return shown === expected ? 'eşit' : `${shown} != ${expected}`
      })
      .toBe('eşit')

    // Kampüs seçilince oran o kampüsün sınıflarındaki taksitlerden hesaplanır.
    const classes = await client.get('/api/v1/collections/classes?pageSize=100&branchId=b2')
    const ids = (classes.body as { data: { id: string }[] }).data.map((row) => row.id)
    await page.goto('/yonetici/dashboard?sube=b2')
    await expect
      .poll(async () => {
        const expected = await expectedRate(ids.map((id) => `&classId=${id}`).join(''))
        const shown = await value()
        return shown === expected ? 'eşit' : `${shown} != ${expected}`
      })
      .toBe('eşit')

    await card.getByRole('link', { name: 'Tahsilat oranı' }).click()
    await expect(page).toHaveURL(/\/yonetici\/finans\?durum=odendi/)
  })

  test('ON-036: pano "Yaklaşan ödemeler & takip" vadesi en erken dört ödenmemiş taksittir', async ({
    page,
    api,
  }) => {
    const client = await api('yonetici')
    const result = await client.get(
      `/api/v1/collections/invoices?page=1&pageSize=4&sort=dueDate,id&status=${encodeURIComponent('Gecikmiş')}&status=${encodeURIComponent('Yaklaşan')}`,
    )
    expect(result.status).toBe(200)
    const expected = (result.body as { data: { joined?: { studentName?: string } }[] }).data.map(
      (row) => row.joined?.studentName ?? '—',
    )
    expect(expected).toHaveLength(4)

    await page.goto('/yonetici/dashboard')
    const section = page.getByRole('region', { name: 'Yaklaşan ödemeler & takip' })
    const items = section.getByRole('list', { name: 'Öncelikli tahsilatlar' }).getByRole('listitem')
    await expect(items).toHaveCount(4)
    for (const [index, name] of expected.entries()) {
      await expect(items.nth(index)).toContainText(name)
      await expect(items.nth(index)).toContainText(/Gecikmiş|Yaklaşan|Kısmi ödendi/)
    }
    await section.getByRole('link', { name: 'Tümünü gör' }).click()
    await expect(page).toHaveURL(/\/yonetici\/finans$/)
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
    // Önceki sayfa yeni yanıt gelene kadar ekranda kalır; ikinci sayfanın satırları gelene kadar bekle.
    await expect
      .poll(async () => {
        const rows = await bodyRows(page).allTextContents()
        return (
          rows.length === 8 &&
          rows.every((row) => row.includes('Yaklaşan')) &&
          JSON.stringify(rows) !== JSON.stringify(firstPage)
        )
      })
      .toBe(true)

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
    // URL hemen değişir ama önceki sayfa yeni yanıt gelene kadar ekranda kalır; sıralı listeyi bekle.
    const sortedAscending = (list: string[]) =>
      list.length === 8 &&
      list.every((name, index) => index === 0 || list[index - 1]!.localeCompare(name, 'tr') <= 0)
    await expect.poll(async () => sortedAscending(await names())).toBe(true)
    const ascending = await names()

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
    await expectEveryRow(bodyRows(page), 'Deniz Yılmaz')

    // Okul numarası ve sınıf adı da sunucuda aranır; aksan ve büyük/küçük harf duyarsız.
    await page.getByLabel('Tabloda ara').fill('2026001')
    await expect(resultCount(page)).toContainText('1–8 / 8 kayıt')
    await expectEveryRow(bodyRows(page), 'Deniz Yılmaz')
    await page.getByLabel('Tabloda ara').fill('deniz yilmaz')
    await expect(resultCount(page)).toContainText('/ 8 kayıt')
    await page.getByLabel('Tabloda ara').fill('7-a')
    await expect(page.getByLabel('Tabloda ara')).toHaveValue('7-a')
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

    // Okul numarası bağlı alandan gelir ve sunucuda sıralanır.
    const number = tableOf(page).getByRole('columnheader', { name: /Okul no/ })
    await number.getByRole('button').click()
    await expect(number).toHaveAttribute('aria-sort', 'ascending')
    await expect(page).toHaveURL(/[?&]sirala=studentNumber/)
    await expect(bodyRows(page).first()).toContainText('2026001')
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
    await expectEveryRow(bodyRows(page), 'Yaklaşan')

    await page.getByLabel('Tabloda ara').fill('Deniz Yılmaz')
    await expect(page.getByLabel('Tabloda ara')).toHaveValue('Deniz Yılmaz')
    await page.getByLabel('Ödeme durumu').selectOption({ label: 'Ödendi' })
    await expect(resultCount(page)).toContainText('1–3 / 3 kayıt')
    await expectEveryRow(bodyRows(page), ['Deniz Yılmaz', 'Ödendi'])

    // Başka sayfaya gidip geri dönmek aramayı ve süzgeci geri getirir (ADR 0009: arama bellekte).
    await page
      .getByRole('navigation', { name: 'Menü' })
      .getByRole('link', { name: 'Genel Bakış' })
      .click()
    await expect(page).toHaveURL(/\/yonetici\/dashboard$/)
    await page.goBack()
    await expect(page.getByLabel('Tabloda ara')).toHaveValue('Deniz Yılmaz')
    await expect(page.getByLabel('Ödeme durumu')).toHaveValue('odendi')
    await expect(resultCount(page)).toContainText('1–3 / 3 kayıt')
    await page.goForward()
    await expect(page).toHaveURL(/\/yonetici\/dashboard$/)
    await page.goBack()
    await expect(page.getByLabel('Tabloda ara')).toHaveValue('Deniz Yılmaz')
    await expect(resultCount(page)).toContainText('1–3 / 3 kayıt')

    // Yenileme süzgeci korur; arama metninin yenilemede kalması beklenmez (ADR 0009).
    await page.reload()
    await expect(page.getByLabel('Ödeme durumu')).toHaveValue('odendi')
    await expectEveryRow(bodyRows(page), 'Ödendi')

    await page.getByRole('button', { name: 'Aramayı ve filtreleri temizle' }).first().click()
    await expect(resultCount(page)).toContainText('/ 1920 kayıt')
    await expect(page).not.toHaveURL(/[?&](q|durum)=/)

    await page.getByLabel('Tabloda ara').fill('zzzz-yok')
    await expect(page.getByText('Aramanızla eşleşen kayıt bulunamadı.')).toBeVisible()
  })

  test('ON-109: sekme değişimi taksit süzgecini ve sayfasını sıfırlamaz; öteki sekmeye taşınmaz', async ({
    page,
  }) => {
    await page.goto(`${ADMIN_URL}?durum=yaklasan`)
    await page.getByRole('button', { name: 'Sonraki sayfa' }).click()
    await expect(page).toHaveURL(/[?&]sayfa=2/)
    await expect(resultCount(page)).toContainText('9–16 /')

    const tabs = page.getByRole('toolbar', { name: 'Finans görünümü' })
    await tabs.getByRole('button', { name: 'Tahsilat geçmişi' }).click()
    await expect(page).toHaveURL(/[?&]gorunum=tahsilatlar/)
    await expect(page).not.toHaveURL(/[?&](durum|sayfa)=/)
    await expect(page.getByRole('heading', { name: 'Tahsilat geçmişi' })).toBeVisible()

    await tabs.getByRole('button', { name: 'Taksitler' }).click()
    await expect(page).toHaveURL(/[?&]durum=yaklasan/)
    await expect(page).toHaveURL(/[?&]sayfa=2/)
    await expect(page.getByLabel('Ödeme durumu')).toHaveValue('yaklasan')
    await expect(resultCount(page)).toContainText('9–16 /')
    await expectEveryRow(bodyRows(page), 'Yaklaşan')

    // Süzgeç değişince sayfa yine başa döner.
    await page.getByLabel('Ödeme durumu').selectOption({ label: 'Ödendi' })
    await expect(page).not.toHaveURL(/[?&]sayfa=/)
    await expect(resultCount(page)).toContainText('1–8 /')
  })

  test('ON-036: hazır ödeme filtreleri durum süzgecidir; seçili çip işaretli, adres taşır', async ({
    page,
  }) => {
    await page.goto(ADMIN_URL)
    const presets = page.getByRole('group', { name: 'Hazır ödeme filtreleri' })
    const chip = (name: string) => presets.getByRole('button', { name, exact: true })
    await expect(chip('Tüm ödemeler')).toHaveAttribute('aria-pressed', 'true')

    await chip('Yaklaşan taksitler').click()
    await expect(page).toHaveURL(/[?&]durum=yaklasan/)
    await expect(chip('Yaklaşan taksitler')).toHaveAttribute('aria-pressed', 'true')
    await expect(chip('Tüm ödemeler')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByLabel('Ödeme durumu')).toHaveValue('yaklasan')
    await expectEveryRow(bodyRows(page), 'Yaklaşan')

    await chip('Ödenenler').click()
    await expect(page).toHaveURL(/[?&]durum=odendi/)
    await expectEveryRow(bodyRows(page), 'Ödendi')
    // Açılır seçimden değişen durum çipe yansır.
    await page.getByLabel('Ödeme durumu').selectOption({ label: 'Yaklaşan' })
    await expect(chip('Yaklaşan taksitler')).toHaveAttribute('aria-pressed', 'true')

    await chip('Tüm ödemeler').click()
    await expect(page).not.toHaveURL(/[?&]durum=/)
    await expect(resultCount(page)).toContainText('/ 1920 kayıt')
  })

  test('ON-036: kampüs, sınıf ve tahsilat tarihi süzgeci sunucuda uygulanır; CSV aynı sonucu içerir', async ({
    page,
  }) => {
    const requests: URLSearchParams[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname === '/api/v1/collections/invoices') requests.push(url.searchParams)
    })
    await page.goto(ADMIN_URL)
    await page.getByRole('button', { name: 'Filtreler', exact: true }).click()

    // Seed: Beşiktaş Kampüsü (b2) sınıfları "-B" ile biter; taksitte kampüs yoktur, sınıfa çevrilir.
    await page.getByLabel('Kampüs', { exact: true }).selectOption({ label: 'Beşiktaş Kampüsü' })
    await expect(page).toHaveURL(/[?&]kampus=b2/)
    await expectEveryRow(bodyRows(page).locator('.person-cell small'), '-B')
    await expect
      .poll(() => requests.some((params) => params.getAll('classId').length === 8))
      .toBe(true)

    await page.getByLabel('Sınıf', { exact: true }).selectOption({ label: '7-B' })
    await expect(page).toHaveURL(/[?&]sinif=c9/)
    await expectEveryRow(bodyRows(page).locator('.person-cell small'), '7-B', true)

    // Tahsilat tarihi aralığı ödenmemiş taksiti dışarıda bırakır (paidAt günü).
    const totalOf = async () =>
      Number(((await resultCount(page).textContent()) ?? '').match(/\/ (\d+) kayıt/)?.[1])
    const classTotal = await totalOf()
    await page.getByLabel('Tahsilat tarihi başlangıç').fill('2000-01-01')
    // Eski sayfa yeni yanıta kadar ekranda kalır; sayaç süzülmüş toplama geçene kadar beklenir.
    await expect.poll(totalOf).toBeLessThan(classTotal)
    await expectEveryRow(bodyRows(page), 'Ödendi')
    await expect
      .poll(() =>
        requests.some(
          (params) =>
            params.get('dateField') === 'paidAt' && params.get('dateFrom') === '2000-01-01',
        ),
      )
      .toBe(true)
    const shown = await totalOf()
    expect(shown).toBeGreaterThan(0)

    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Raporu indir' }).click()
    const csv = (await readCsv(await pending)).filter((row) => row.length > 1)
    expect(csv).toHaveLength(1 + shown)
    for (const row of csv.slice(1)) expect(row[5]).toBe('Ödendi')

    // Kampüs ve sınıf adreste kalır; yenilemede süzgeç korunur.
    await page.reload()
    await expect(page).toHaveURL(/[?&]kampus=b2/)
    await expectEveryRow(bodyRows(page).locator('.person-cell small'), '7-B', true)
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
    expect(csv[0]).toEqual(['Öğrenci', 'Okul no', 'Taksit', 'Vade tarihi', 'Tutar', 'Durum'])
    expect(csv).toHaveLength(1 + 3)
    for (const row of csv.slice(1)) {
      expect(row[0]).toBe('Deniz Yılmaz')
      expect(row[1]).toBe('2026001')
      expect(row[4]).toBe('24.500,00 ₺')
      expect(row[5]).toBe('Ödendi')
    }
  })

  for (const width of [1440, 390, 320]) {
    test(`${width} px genişlikte büyük tutarlar toplam kartının içinde kalır`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      // Gerçek yanıtın tutarları ×1000: "51.840.000.000,00 ₺" düzeyinde en kötü durum.
      await page.route(/\/api\/v1\/finance\/totals$/, async (route) => {
        const response = await route.fetch()
        const body = (await response.json()) as { data: Record<string, number> }
        for (const key of Object.keys(body.data)) body.data[key] = (body.data[key] ?? 0) * 1000
        // Gerçek yanıtın başlıkları (içerik uzunluğu, sıkıştırma) değişen gövdeyle uyuşmaz.
        await route.fulfill({ status: response.status(), json: body })
      })
      await page.goto(ADMIN_URL)
      const totals = page.getByLabel('Kurum geneli ödeme toplamları')
      await expect(totals).toContainText('51.840.000.000,00')
      await expectContentInsideCards(totals.locator(':scope > div'))
      await expectNoHorizontalOverflow(page)
    })
  }

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

  for (const [view, table] of [
    ['tahsilatlar', 'Tahsilat geçmişi'],
    ['tarife', 'Ücret tarifeleri'],
    ['ayrilis', 'Ayrılış ve iade kayıtları'],
    ['gunsonu', 'Gün sonu'],
  ] as const)
    test(`320 ve 390 px genişlikte ${view} sekmesi yatay taşmaz`, async ({ page }) => {
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 })
        await page.goto(`${ADMIN_URL}?gorunum=${view}`)
        await expect(
          page.getByRole('heading', { name: table.split(' ')[0] ?? table }).first(),
        ).toBeVisible()
        await expectNoHorizontalOverflow(page)
      }
    })

  test('320 px genişlikte muhasebe aktarımı yatay taşmaz', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 })
    await page.goto(`${ADMIN_URL}?gorunum=aktarim`)
    await expect(page.getByRole('heading', { name: 'Muhasebe aktarımı' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Yıl sonu mutabakatı' })).toBeVisible()
    await expect(page.getByLabel('Mutabakat toplamları')).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})

// ON-294 (#31, OG-098): veli Ödeme Yap sayfasındaki bağlantılar dar ekranda metin satırı kadar
// (17 px) kalıyordu; dokunma hedefi en az 24 px olmalı (WCAG 2.2, 2.5.8). Seed oturumu salt okunur.
test.describe('Finans: veli Ödeme Yap', () => {
  test('360 px genişlikte iletişim ve ödeme planı bağlantıları en az 24 px yüksektir', async ({
    page,
    loginAs,
  }) => {
    await loginAs('veli')
    await page.setViewportSize({ width: 360, height: 740 })
    await page.goto('/veli/odeme-yap?cocuk=s1')
    await expect(page.getByRole('heading', { name: 'Ödemeler okulda kaydedilir' })).toBeVisible()
    for (const name of ['Okulla iletişime geçin', 'Ödeme planını görüntüleyin']) {
      const link = page.getByRole('main').getByRole('link', { name, exact: true })
      await expect(link).toBeVisible()
      const box = await link.boundingBox()
      expect(box?.height ?? 0, name).toBeGreaterThanOrEqual(24)
    }
    await expectNoHorizontalOverflow(page)
  })
})

// ON-038: tahsilat ve tarife retlerinin ekrandaki yeri. Kural core ve API testlerindedir; burada
// iletinin hangi alanda göründüğü ve kaydın yazılmadığı kanıtlanır. Her test kendi kurumunu kurar.
test.describe('Finans: sunucu retleri', () => {
  test('DOM-FIN-025: burslu öğrenciden senet alınmaz; ileti Ödeme yöntemi alanında, taksit açık kalır', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: [], students: ['s20'] })
    // Burs tarifeli sözleşmeye bağlıdır; sözleşme taksit tablolarına core biçiminde girer (ON-046f).
    await seedScholarshipContract({
      institutionId: school.institutionId,
      studentId: 's20',
      contractId: 'e2e-burs-sozlesme',
      amountCents: 1_000_000,
      scholarshipCents: 500_000,
    })
    await loginAs(school.user('yonetici'))
    const client = await api(school.user('yonetici'))
    await page.goto(`${ADMIN_URL}?tahsilat=inv-s20-5`)
    const dialog = paymentDialog(page)
    const method = dialog.getByLabel('Ödeme yöntemi')
    await method.selectOption('Senet')
    await dialog.getByLabel('Senet numarası').fill(`E2E-SENET-${randomUUID()}`)
    await dialog.getByRole('button', { name: 'Tahsilatı kaydet' }).click()

    await expect(dialog.getByText('Burslu öğrenciden senet alınamaz.')).toBeVisible()
    await expect(method).toHaveAttribute('aria-invalid', 'true')
    await expect(dialog).toBeVisible()
    expect((await invoice(client, 'inv-s20-5')).paidAt).toBeNull()
  })

  test('DOM-FIN-032: form açıkken nakit kapatılırsa ileti Ödeme yöntemi alanında, tahsilat yazılmaz', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: [], students: ['s21'] })
    await loginAs(school.user('yonetici'))
    const client = await api(school.user('yonetici'))
    await setCashPayments(client, true)
    await page.goto(`${ADMIN_URL}?tahsilat=inv-s21-5`)
    const dialog = paymentDialog(page)
    const method = dialog.getByLabel('Ödeme yöntemi')
    await method.selectOption('Nakit')

    // Başka bir yönetici nakdi kapattı; açık formdaki seçenek eski ayarı gösteriyor.
    await setCashPayments(client, false)
    await dialog.getByRole('button', { name: 'Tahsilatı kaydet' }).click()

    await expect(dialog.getByText('Bu kurumda nakit tahsilat kapalıdır.')).toBeVisible()
    await expect(method).toHaveAttribute('aria-invalid', 'true')
    expect((await invoice(client, 'inv-s21-5')).paidAt).toBeNull()
  })

  test('DOM-FIN-002: MEBBİS onaylı tutarı aşan taslak yayımlanmaz; ileti görünür, tarife taslak kalır', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: [], students: ['s19'] })
    const client = await api(school.user('yonetici'))
    const academicYear = new Date().getFullYear()
    const draft = await client.post(
      '/api/v1/fee-tariffs',
      {
        academicYear,
        items: [
          {
            kind: 'tuition',
            level: null,
            amountCents: 30_000_000,
            unit: 'year',
            vatBasisPoints: 1000,
            vatEffectiveDate: `${String(academicYear)}-01-01`,
            announcedAmountCents: 29_999_999,
          },
        ],
      },
      { 'idempotency-key': randomUUID() },
    )
    expect(draft.status, JSON.stringify(draft.body)).toBe(201)

    await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN_URL}?gorunum=tarife`)
    const table = page.getByRole('table', { name: 'Ücret tarifeleri' })
    await expect(table).toContainText('Taslak')
    await page.getByRole('button', { name: /tarifesini yayımla/ }).click()
    const publish = page.getByRole('dialog', { name: 'Tarifeyi yayımla' })
    await publish.getByRole('button', { name: 'Tarifeyi yayımla' }).click()

    await expect(page.getByText('Ücret, MEBBİS onaylı tutarı aşamaz.')).toBeVisible()
    await expect(publish).toBeVisible()
    await expect(page.getByText('Tarife yayımlandı.')).toHaveCount(0)
    await publish.getByRole('button', { name: 'Vazgeç' }).click()
    await expect(table).toContainText('Taslak')
    await expect(table).not.toContainText('Yayında')
  })
})

test.describe('Finans: gün sonu', () => {
  const dayPanel = (page: Page) => page.getByRole('group', { name: 'Gün kapanışı' })

  /** Arayüzden geçmeden nakit tahsilat; yanıt durumu döner (kapalı günde 422). */
  async function payCash(client: ApiClient, studentId: string, amountCents: number) {
    const response = await client.context.fetch('/api/v1/payments', {
      method: 'POST',
      data: { studentId, amountCents, method: 'Nakit' },
      headers: { 'idempotency-key': randomUUID() },
      failOnStatusCode: false,
    })
    return { status: response.status(), body: (await response.json()) as { code?: string } }
  }

  test('IST-113, DOM-FIN-036: ön büro kasayı sayar, farkı açıklar ve kapatır; kapalı güne tahsilat girilemez', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'], students: ['s21'] })
    const admin = await api(school.user('yonetici'))
    await setCashPayments(admin, true)
    expect((await payCash(admin, 's21', 30_000)).status).toBe(201)
    await payThroughApi(admin, 'inv-s21-5', 'Kredi kartı')

    await loginAs(school.user('onburo'))
    await page.goto(`${FRONT_OFFICE_URL}?gorunum=gunsonu`)
    const methods = page.getByRole('table', { name: 'Ödeme yöntemine göre gün özeti' })
    await expect(methods.getByRole('row', { name: /Nakit/ })).toContainText('300,00')
    await expect(page.getByRole('table', { name: 'Günün tahsilatları' })).toContainText('Nakit')
    await expect(dayPanel(page)).toContainText('Açık')

    await dayPanel(page).getByRole('button', { name: 'Günü kapat' }).click()
    const dialog = page.getByRole('dialog', { name: 'Günü kapat' })
    await dialog.getByLabel('Sayılan nakit (₺)').fill('250,00')
    await expect(dialog.getByText(/50,00 ₺ eksik/)).toBeVisible()
    await dialog.getByRole('button', { name: 'Günü kapat' }).click()
    await expect(dialog.getByText('Kasa farkını açıklayın.')).toBeVisible()
    await dialog.getByLabel('Açıklama').fill('Para üstü eksik verildi')
    await dialog.getByRole('button', { name: 'Günü kapat' }).click()
    await expect(page.getByText('Gün kapatıldı.')).toBeVisible()
    await expect(dialog).toBeHidden()

    const panel = dayPanel(page)
    await expect(panel).toContainText('Kapatıldı')
    await expect(panel).toContainText('Para üstü eksik verildi')
    await expect(panel).toContainText(/50,00 ₺ eksik/)
    // Yeniden açma yöneticinindir (DOM-FIN-052).
    await expect(panel.getByRole('button', { name: 'Günü yeniden aç' })).toHaveCount(0)
    await expect(panel.getByRole('button', { name: 'Günü kapat' })).toHaveCount(0)

    const denied = await payCash(admin, 's21', 1_000)
    expect(denied.status).toBe(422)
    expect(denied.body.code).toBe('finance_day_closed')
    await expectNoHorizontalOverflow(page)
  })

  test('DOM-FIN-036: yönetici gerekçeyle yeniden açar, eski kapanış kayıtta kalır; PDF tıklamada yüklenir', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: [], students: ['s22'] })
    const pdfCode: string[] = []
    page.on('request', (request) => {
      if (/jspdf/i.test(request.url())) pdfCode.push(request.url())
    })
    await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN_URL}?gorunum=gunsonu`)
    await dayPanel(page).getByRole('button', { name: 'Günü kapat' }).click()
    const dialog = page.getByRole('dialog', { name: 'Günü kapat' })
    // Nakit kapalı ve hareketsiz gün: kasa sayımı istenmez (DOM-FIN-032).
    await expect(dialog.getByLabel('Sayılan nakit (₺)')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Günü kapat' }).click()
    await expect(page.getByText('Gün kapatıldı.')).toBeVisible()
    await expect(dayPanel(page)).toContainText('Kapatıldı')

    expect(pdfCode, 'jsPDF tıklamadan önce yüklenmez').toEqual([])
    await page.getByRole('button', { name: 'Gün sonu PDF' }).click()
    const preview = page.getByRole('dialog', { name: 'Gün sonu raporu · Önizleme' })
    const downloading = page.waitForEvent('download')
    await preview.getByRole('button', { name: 'PDF’yi indir' }).click()
    expect((await downloading).suggestedFilename()).toMatch(/^gun-sonu-\d{4}-\d{2}-\d{2}\.pdf$/)
    expect(pdfCode.length, 'jsPDF tıklamada yüklenir').toBeGreaterThan(0)
    await page.keyboard.press('Escape')
    await expect(preview).toBeHidden()
    await expect(page.getByRole('button', { name: 'Gün sonu PDF' })).toBeFocused()

    await dayPanel(page).getByRole('button', { name: 'Günü yeniden aç' }).click()
    const reopen = page.getByRole('dialog', { name: 'Günü yeniden aç' })
    await reopen.getByRole('button', { name: 'Günü yeniden aç' }).click()
    await expect(reopen.getByText(/gerekçesi en az 5/)).toBeVisible()
    await reopen.getByLabel('Yeniden açma gerekçesi').fill('Sayım yanlış girildi')
    await reopen.getByRole('button', { name: 'Günü yeniden aç' }).click()
    await expect(page.getByText('Gün yeniden açıldı.')).toBeVisible()
    await expect(dayPanel(page)).toContainText('Açık')
    await expect(page.getByRole('heading', { name: 'Önceki kapanışlar' })).toBeVisible()
    await expect(page.getByText(/Gerekçe: Sayım yanlış girildi/)).toBeVisible()
  })

  test('IST-113, DOM-KAY-012: dil okulunda gün sonu PDF tablosu tahsilatı kursiyer adıyla yazar', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const academy = await tenant({ type: 'language_school', roles: [], students: ['s23'] })
    await payThroughApi(await api(academy.user('yonetici')), 'inv-s23-5', 'Kredi kartı')

    await loginAs(academy.user('yonetici'))
    await page.goto(`${ADMIN_URL}?gorunum=gunsonu`)
    await expect(page.getByRole('table', { name: 'Günün tahsilatları' })).toContainText(
      'Kredi kartı',
    )
    await page.getByRole('button', { name: 'Gün sonu PDF' }).click()
    const preview = page.getByRole('dialog', { name: 'Gün sonu raporu · Önizleme' })
    const downloading = page.waitForEvent('download')
    await preview.getByRole('button', { name: 'PDF’yi indir' }).click()
    // ON-321: şablon kurum türünü alır; dil okulunda kişi sütunu "Kursiyer"dir, okul metni yoktur.
    const text = await pdfText(await downloading)
    expect(text).toContain('Tahsilatlar')
    expect(text).toContain('Kursiyer')
    expect(text).not.toContain('Öğrenci')
  })
})

/** Nakit tahsilat ayarını API'den değiştirir (başka bir yöneticinin işlemi). */
async function setCashPayments(client: ApiClient, enabled: boolean) {
  const current = await client.get('/api/v1/payment-settings')
  expect(current.status).toBe(200)
  const { version } = (current.body as { data: { version: number } }).data
  const result = await client.context.patch('/api/v1/payment-settings', {
    data: { cashPaymentsEnabled: enabled },
    headers: { 'if-match': `"${String(version)}"`, 'idempotency-key': randomUUID() },
    failOnStatusCode: false,
  })
  expect(result.status(), await result.text()).toBe(200)
}
