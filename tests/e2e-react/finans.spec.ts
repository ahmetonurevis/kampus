import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import type { Download, Locator, Page, Request } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { e2e } from './support/env.ts'
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
    await expect(page).toHaveURL(/[?&]q=Emir/)
    const row = bodyRows(page).filter({ hasText: '6. taksit' })
    await expect(row).toContainText('Emir Kaya')
    await expect(row).toContainText('Yaklaşan')

    await row.getByRole('button', { name: 'Emir Kaya 6. taksiti tahsil et' }).click()
    const dialog = paymentDialog(page)
    await expect(dialog).toBeVisible()
    await expect(page).toHaveURL(/[?&]tahsilat=inv-s10-5/)
    await expect(dialog).toContainText('Emir Kaya · 6. taksit')
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

    await page.goto('/yonetici/ayarlar')
    const toggle = page.getByRole('switch', { name: 'Nakit tahsilat' })
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

    await page.goto('/yonetici/ayarlar')
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
    await editor.getByLabel('MEBBİS onaylı tutar (₺)').fill('300.000,00')
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

    await loginAs(school.user('onburo'))
    await page.goto('/onburo/tahsilat-takip?gorunum=tarife')
    await expect(page.getByRole('table', { name: 'Ücret tarifeleri' })).toContainText('Yayında')
    await expect(page.getByRole('button', { name: 'Yeni tarife' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /yeni sürüm aç/ })).toHaveCount(0)
    await page.getByRole('button', { name: /tarifesini görüntüle/ }).click()
    await expect(page.getByRole('dialog')).toContainText('Öğrenim ücreti')
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

  test('DOM-FIN-041: yönetici hesabı önizler, ayrılışı onaylar, iadeyi öder; ön büro yalnız görür', async ({
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
    await dialog.getByRole('button', { name: 'Hesabı göster' }).click()
    await expect(dialog.getByText('Hesap önizlemesi')).toBeVisible()
    await expect(dialog).toContainText('Hak edilen')
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
    await expect(page).toHaveURL(/[?&]q=Deniz/)
    await page.getByLabel('Ödeme durumu').selectOption({ label: 'Ödendi' })
    await expect(resultCount(page)).toContainText('1–3 / 3 kayıt')
    await expectEveryRow(bodyRows(page), ['Deniz Yılmaz', 'Ödendi'])

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
    await expectNoHorizontalOverflow(page)
  })
})
