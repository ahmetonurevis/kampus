import { randomUUID } from 'node:crypto'

import type { Locator, Page } from '@playwright/test'

import { money } from '../../packages/school-core/src/lib/format.ts'
import type { ApiClient } from './support/api.ts'
import { seedPackageTariff } from './support/finance-terms.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Paket satışı ekranı (IST-078; DOM-DIL-050, -051; DOM-FIN-013; K-07, K-19). Kural dalları birim ve
// API testlerindedir (`tests/finance-packages.test.ts`, `apps/api/test/finance-packages.test.ts`,
// `apps/web-react/tests/finance-package-forms.test.ts`); burada rol başına akış ve dar ekran var.

const ADMIN_URL = '/yonetici/finans?gorunum=paket'
const DESK_URL = '/onburo/tahsilat-takip?gorunum=paket'
const WITHDRAWALS_URL = '/yonetici/finans?gorunum=ayrilis'
const PACKAGE = '40 saatlik paket'
const HOURS_BODY = { kind: 'hours', name: PACKAGE, lessonHours: 40, validityDays: 180 }
const HOURLY = 50_000

const catalog = (page: Page) => page.getByRole('region', { name: 'Paket tanımları' })
const salesList = (page: Page) => page.getByRole('region', { name: 'Paket satışları' })
const saleDialog = (page: Page) => page.getByRole('dialog', { name: 'Paket sat' })
const salePanel = (page: Page) => page.getByRole('dialog', { name: 'Paket satışı ayrıntısı' })
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

async function languageSchool(
  tenant: Parameters<Parameters<typeof test>[2]>[0]['tenant'],
  roles: Parameters<Parameters<Parameters<typeof test>[2]>[0]['tenant']>[0]['roles'],
) {
  const school = await tenant({ type: 'language_school', roles, students: ['s1'] })
  await seedPackageTariff(school.institutionId)
  return school
}

async function createPackage(client: ApiClient, body: unknown = HOURS_BODY): Promise<string> {
  const made = await client.post('/api/v1/finance/packages', body)
  expect(made.status, 'paket tanımı').toBe(201)
  return (made.body as { data: { id: string } }).data.id
}

/** Arayüzden geçmeden satış: veli ve öğrenci ekranı yalnız sonucu okur. */
async function sellThroughApi(client: ApiClient, packageId: string, studentId = 's1') {
  const body = { packageId, studentId, installmentCount: 3 }
  const quote = await client.post('/api/v1/finance/package-sales/quote', body)
  expect(quote.status, 'önizleme').toBe(200)
  const sale = await client.post(
    '/api/v1/finance/package-sales',
    {
      ...body,
      tariffId: (quote.body as { data: { tariffId: string } }).data.tariffId,
      firstDueDate: day(7),
    },
    { 'idempotency-key': randomUUID() },
  )
  expect(sale.status, 'satış').toBe(201)
}

async function fillSale(dialog: Locator, count: string) {
  await dialog.getByLabel('Öğrenci').selectOption('s1')
  await dialog.getByLabel('Paket', { exact: true }).selectOption({ index: 1 })
  await dialog.getByLabel('Taksit sayısı').selectOption(count)
}

test.describe('IST-078: paket satışı ekranı', () => {
  test('DOM-DIL-050: yönetici paket tanımlar, düzenler, arar, süzer ve arşivler', async ({
    loginAs,
    tenant,
  }) => {
    const school = await languageSchool(tenant, [])
    const page = await loginAs(school.user('yonetici'))
    await page.goto(ADMIN_URL)
    await expect(catalog(page).getByText('Henüz paket tanımlanmadı.')).toBeVisible()

    await catalog(page).getByRole('button', { name: 'Yeni paket' }).click()
    const form = page.getByRole('dialog', { name: 'Yeni paket' })
    // Ders saati boşken alan hatası Türkçe görünür, kayıt yazılmaz.
    await form.getByLabel('Paket adı').fill(PACKAGE)
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(form.getByLabel('Ders saati')).toHaveAttribute('aria-invalid', 'true')
    await expect(form.getByText('Ders saatini girin.')).toBeVisible()
    await form.getByLabel('Ders saati').fill('40')
    await form.getByLabel(/Kullanım süresi/).fill('180')
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(page.getByText('Paket tanımlandı.')).toBeVisible()
    const row = catalog(page).getByRole('row', { name: new RegExp(PACKAGE) })
    await expect(row.getByText('180 gün')).toBeVisible()
    await expect(row.getByText('Tarifeden')).toBeVisible()

    // Aynı ad sunucudan alan hatası olarak döner.
    await catalog(page).getByRole('button', { name: 'Yeni paket' }).click()
    await form.getByLabel('Paket adı').fill(PACKAGE)
    await form.getByLabel('Ders saati').fill('10')
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(form.getByText('Bu adla etkin bir paket var.')).toBeVisible()
    await form.getByRole('button', { name: 'Vazgeç' }).click()

    await catalog(page)
      .getByRole('button', { name: `${PACKAGE} paketini düzenle` })
      .click()
    const edit = page.getByRole('dialog', { name: 'Paketi düzenle' })
    await expect(edit.getByLabel('Paket türü', { exact: true })).toBeDisabled()
    await edit.getByLabel(/İlan altı saat ücreti/).fill('450,50')
    await edit.getByRole('button', { name: 'Kaydet' }).click()
    await expect(page.getByText('Paket güncellendi.')).toBeVisible()
    await expect(row.getByText(money(45_050))).toBeVisible()

    await catalog(page).getByRole('button', { name: 'Filtreler', exact: true }).click()
    await catalog(page).getByLabel('Paket türü', { exact: true }).selectOption('private')
    await expect(catalog(page).getByText('Bu aramayla eşleşen paket yok.')).toBeVisible()
    await catalog(page).getByLabel('Paket türü', { exact: true }).selectOption('hours')
    await expect(row).toBeVisible()

    await catalog(page)
      .getByRole('button', { name: `${PACKAGE} paketini arşivle` })
      .click()
    const archive = page.getByRole('dialog', { name: 'Paketi arşivle' })
    await archive.getByRole('button', { name: 'Arşivle' }).click()
    await expect(page.getByText(`${PACKAGE} arşivlendi.`)).toBeVisible()
    await expect(row).toHaveCount(0)
  })

  test('DOM-FIN-013, K-19: yönetici önizleyip satar, koşul indirimi görünür, süreyi uzatır', async ({
    api,
    loginAs,
    tenant,
  }) => {
    const school = await languageSchool(tenant, [])
    const client = await api(school.user('yonetici'))
    await createPackage(client)
    const page = await loginAs(school.user('yonetici'))
    await page.goto(ADMIN_URL)

    await salesList(page).getByRole('button', { name: 'Paket sat', exact: true }).click()
    const dialog = saleDialog(page)
    await expect(dialog.getByLabel('Taksit sayısı').locator('option')).toHaveText([
      'Peşin · tek ödeme',
      'Süreli · 2 taksit · %3 indirim',
      'Süreli · 3 taksit · %3 indirim',
      'Süreli · 4 taksit · %3 indirim',
    ])
    await expect(dialog.getByText(/burs/i)).toHaveCount(0)

    // Öğrenci ve paket seçilmeden önizleme açılmaz.
    await dialog.getByRole('button', { name: 'Ücreti göster' }).click()
    await expect(dialog.getByText('Öğrenci seçin.')).toBeVisible()

    await fillSale(dialog, '1')
    await expect(dialog.getByRole('checkbox', { name: 'Peşin ödeme' })).toBeVisible()
    await dialog.getByLabel('Taksit sayısı').selectOption('3')
    await expect(dialog.getByRole('checkbox', { name: 'Peşin ödeme' })).toHaveCount(0)
    await dialog.getByRole('checkbox', { name: 'Kitap ve kırtasiye' }).check()
    await dialog.getByRole('button', { name: 'Ücreti göster' }).click()

    const quote = dialog.getByRole('definition')
    const gross = 40 * HOURLY
    const termDiscount = 60_000
    await expect(quote.getByText(money(gross), { exact: true })).toBeVisible()
    await expect(quote.getByText(`− ${money(termDiscount)}`)).toBeVisible()
    await expect(quote.getByText(money(gross - termDiscount), { exact: true })).toBeVisible()
    await expect(quote.getByText('Süreli · 3 taksit · %3 indirim')).toBeVisible()
    await expect(dialog.getByRole('list').locator('li')).toHaveCount(3)

    // Düzenlemeye dönülür, seçimler korunur; önizleme kayıt yazmamıştır.
    await dialog.getByRole('button', { name: 'Bilgileri düzenle' }).click()
    await expect(dialog.getByLabel('Taksit sayısı')).toHaveValue('3')
    await expect(dialog.getByRole('checkbox', { name: 'Kitap ve kırtasiye' })).toBeChecked()
    const before = await client.get('/api/v1/finance/package-sales?page=1&pageSize=20')
    expect((before.body as { meta: { total: number } }).meta.total).toBe(0)
    await dialog.getByRole('button', { name: 'Ücreti göster' }).click()
    await dialog.getByRole('button', { name: 'Satışı onayla' }).click()

    await expect(page.getByText('Paket satışı kaydedildi. Sözleşme onay bekliyor.')).toBeVisible()
    const panel = salePanel(page)
    await expect(panel.getByText('40 saat').first()).toBeVisible()
    await expect(panel.getByRole('list', { name: 'Satışın taksitleri' }).locator('li')).toHaveCount(
      4,
    )
    expect(page.url()).toContain('paket-satis=')

    await panel.getByRole('button', { name: 'Süreyi uzat' }).click()
    const extend = page.getByRole('dialog', { name: 'Son kullanma tarihini uzat' })
    await extend.getByLabel('Yeni son kullanma').fill(day(1))
    await extend.getByLabel('Gerekçe').fill('Kursiyer talebi')
    await extend.getByRole('button', { name: 'Süreyi uzat' }).click()
    await expect(
      extend.getByText('Yeni son kullanma tarihi mevcut tarihten sonra olmalı', { exact: false }),
    ).toBeVisible()
    await extend.getByLabel('Yeni son kullanma').fill(day(400))
    await extend.getByRole('button', { name: 'Süreyi uzat' }).click()
    await expect(page.getByText('Son kullanma tarihi uzatıldı.')).toBeVisible()

    await panel.getByRole('link', { name: 'Sözleşmeyi aç' }).click()
    await expect(page.getByRole('dialog', { name: /sözleşme/i }).first()).toBeVisible()
    await client.dispose()
  })

  test('K-07: ön büro satar ama paket tanımlayamaz', async ({ api, loginAs, tenant }) => {
    const school = await languageSchool(tenant, ['onburo'])
    const admin = await api(school.user('yonetici'))
    await createPackage(admin)
    await admin.dispose()
    const page = await loginAs(school.user('onburo'))
    await page.goto(DESK_URL)

    await expect(catalog(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Yeni paket' })).toHaveCount(0)
    await salesList(page).getByRole('button', { name: 'Paket sat', exact: true }).click()
    const dialog = saleDialog(page)
    await fillSale(dialog, '2')
    await dialog.getByRole('button', { name: 'Ücreti göster' }).click()
    await dialog.getByRole('button', { name: 'Satışı onayla' }).click()
    await expect(page.getByText('Paket satışı kaydedildi. Sözleşme onay bekliyor.')).toBeVisible()
    await expect(salePanel(page).getByRole('button', { name: 'Süreyi uzat' })).toBeVisible()
  })

  test('IST-114, DOM-FIN-057: yönetici paket saat raporunu dönemle görür, CSV indirir; ön büroda rapor yok', async ({
    api,
    loginAs,
    tenant,
  }) => {
    const school = await languageSchool(tenant, ['onburo'])
    const admin = await api(school.user('yonetici'))
    await sellThroughApi(admin, await createPackage(admin))
    const listed = (await admin.get('/api/v1/finance/package-sales')).body as {
      data: { id: string; version: number }[]
    }
    const sale = listed.data[0]
    if (!sale) throw new Error('satış bulunamadı')
    const used = await admin.post(
      `/api/v1/finance/package-sales/${sale.id}/set-used-hours`,
      { usedHours: 12, reason: 'Devam çizelgesine göre' },
      { 'if-match': `"${String(sale.version)}"` },
    )
    expect(used.status, 'kullanılan saat').toBe(200)
    await admin.dispose()

    const page = await loginAs(school.user('yonetici'))
    await page.goto(ADMIN_URL)
    const report = page.getByRole('region', { name: 'Paket saat raporu' })
    const totals = report.getByLabel('Dönem toplamları')
    await expect(totals.getByText('40 saat')).toBeVisible()
    await expect(totals.getByText('12 saat')).toBeVisible()
    await expect(totals.getByText('28 saat')).toBeVisible()
    await expect(report.getByRole('table', { name: 'Aylık döküm' })).toBeVisible()
    await expect(report.getByRole('table', { name: 'Satış bazında paket saatleri' })).toBeVisible()

    const download = page.waitForEvent('download')
    await report.getByRole('button', { name: 'Rapor dosyası' }).click()
    expect((await download).suggestedFilename()).toMatch(/^paket-saat-raporu-.+\.csv$/)
    await expect(page.getByText('Dosya indirildi.')).toBeVisible()

    // Ters dönem istek göndermeden alan altında reddedilir.
    await report.getByLabel('Dönem başlangıcı').fill('2099-01-02')
    await report.getByLabel('Dönem bitişi').fill('2099-01-01')
    await expect(report.getByRole('alert')).toHaveText('Dönem başlangıcı bitişinden sonra olamaz.')
    await expect(report.getByRole('button', { name: 'Rapor dosyası' })).toBeDisabled()

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 })
      await expect(report.getByRole('heading', { name: 'Paket saat raporu' })).toBeVisible()
      await expectNoHorizontalOverflow(page)
    }

    await loginAs(school.user('onburo'))
    await page.goto(DESK_URL)
    await expect(salesList(page)).toBeVisible()
    await expect(page.getByRole('region', { name: 'Paket saat raporu' })).toHaveCount(0)
  })

  test('K-21, DOM-DIL-051, DOM-FIN-040: ön büro saati girer; yönetici uyarıyı ve tutarı görüp onaylar', async ({
    api,
    loginAs,
    tenant,
  }) => {
    const school = await languageSchool(tenant, ['onburo'])
    const admin = await api(school.user('yonetici'))
    await sellThroughApi(admin, await createPackage(admin))
    const student = (await admin.get('/api/v1/collections/students/s1')).body as {
      data: { record: { name: string } }
    }
    const name = student.data.record.name

    // Saat girilmeden yöneticinin önizlemesi açık uyarı verir; onay işaretsiz açılmaz.
    const page = await loginAs(school.user('yonetici'))
    await page.goto(WITHDRAWALS_URL)
    await page.getByRole('button', { name: 'Ayrılış başlat' }).click()
    const start = page.getByRole('dialog', { name: 'Ayrılış başlat' })
    await start.getByLabel('Öğrenci', { exact: true }).selectOption({ label: name })
    await start.getByLabel('Dönem başlangıcı').fill('2026-09-07')
    await start.getByRole('button', { name: 'Hesabı göster' }).click()
    await expect(start.getByRole('alert')).toContainText('Kullanılan saat girilmedi')
    await expect(start.getByRole('button', { name: 'Ayrılışı onayla' })).toBeDisabled()
    await start.getByRole('button', { name: 'Bilgileri düzenle' }).click()
    await start.getByRole('button', { name: 'Hesabı göster' }).click()
    await expect(start.getByRole('checkbox', { name: /iade tutarını inceledim/ })).not.toBeChecked()

    // Ön büro saati girer; aşım alanda, gerekçesiz giriş formda reddedilir.
    await loginAs(school.user('onburo'))
    await page.goto(DESK_URL)
    await salesList(page)
      .getByRole('button', { name: /satış ayrıntısını aç/ })
      .first()
      .click()
    const panel = salePanel(page)
    await expect(panel.getByRole('note')).toContainText('Kullanılan saat girilmedi')
    await panel.getByRole('button', { name: 'Kullanılan saati gir' }).click()
    const used = page.getByRole('dialog', { name: 'Kullanılan saati gir' })
    await used.getByLabel('Kullanılan toplam saat').fill('41')
    await used.getByRole('button', { name: 'Kaydet' }).click()
    await expect(used.getByText('Gerekçeyi yazın.')).toBeVisible()
    await used.getByLabel('Gerekçe').fill('Devam çizelgesine göre')
    await used.getByRole('button', { name: 'Kaydet' }).click()
    await expect(used.getByText('Kullanılan saat alınan saati aşamaz.')).toBeVisible()
    await used.getByLabel('Kullanılan toplam saat').fill('12')
    await used.getByRole('button', { name: 'Kaydet' }).click()
    await expect(page.getByText('Kullanılan saat kaydedildi.')).toBeVisible()
    await expect(panel.getByRole('note')).toHaveCount(0)
    await expect(panel.getByText('12 saat')).toBeVisible()
    await expect(panel.getByText('28 saat')).toBeVisible()
    // Ön büro ayrılış başlatamaz (DOM-FIN-052, K-21).
    await page.goto('/onburo/tahsilat-takip?gorunum=ayrilis')
    await expect(page.getByRole('button', { name: 'Ayrılış başlat' })).toHaveCount(0)

    // Yönetici yeni hesabı görür, tutarı onaylar.
    await loginAs(school.user('yonetici'))
    await page.goto(WITHDRAWALS_URL)
    await page.getByRole('button', { name: 'Ayrılış başlat' }).click()
    await start.getByLabel('Öğrenci', { exact: true }).selectOption({ label: name })
    await start.getByLabel('Dönem başlangıcı').fill('2026-09-07')
    await start.getByRole('button', { name: 'Hesabı göster' }).click()
    await expect(start.getByRole('alert')).toHaveCount(0)
    await expect(start).toContainText('Kullanım (12 / 40 ders saati, kayıttan)')
    await start.getByRole('checkbox', { name: /iade tutarını inceledim/ }).check()
    await start.getByRole('button', { name: 'Ayrılışı onayla' }).click()
    await expect(page.getByText('Ayrılış kaydedildi.')).toBeVisible()
    await admin.dispose()
  })

  test('K-07, DOM-DIL-051: veli kalan saati görür, satın alma düğmesi yoktur', async ({
    api,
    loginAs,
    tenant,
  }) => {
    const school = await languageSchool(tenant, ['veli'])
    const admin = await api(school.user('yonetici'))
    await sellThroughApi(admin, await createPackage(admin))
    await admin.dispose()
    const page = await loginAs(school.user('veli'))
    await page.goto('/veli/finans?cocuk=s1')

    const section = page.getByRole('region', { name: 'Satın alınan paketler' })
    await expect(section.getByRole('heading', { name: PACKAGE })).toBeVisible()
    await expect(section.getByRole('definition').filter({ hasText: '40 saat' })).toHaveCount(2)
    await expect(section.getByText('0 saat', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Paket sat', exact: true })).toHaveCount(0)

    // Velinin öteki çocuğunda paket yok.
    await page.goto('/veli/finans?cocuk=s2')
    await expect(
      section.getByText('Henüz satın alınmış paket yok.', { exact: false }),
    ).toBeVisible()

    // Dar ekranda bölüm taşmaz.
    await page.goto('/veli/finans?cocuk=s1')
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 })
      await expect(section.getByRole('heading', { name: PACKAGE })).toBeVisible()
      await expectNoHorizontalOverflow(page)
    }
  })

  test('IST-078: öğrenci kendi paketini görür', async ({ api, loginAs, tenant }) => {
    const school = await languageSchool(tenant, ['ogrenci'])
    const admin = await api(school.user('yonetici'))
    await sellThroughApi(admin, await createPackage(admin))
    await admin.dispose()
    const page = await loginAs(school.user('ogrenci'))
    await page.goto('/ogrenci/odemelerim')
    const section = page.getByRole('region', { name: 'Satın alınan paketler' })
    await expect(section.getByRole('heading', { name: PACKAGE })).toBeVisible()
    await expect(section.getByRole('definition').filter({ hasText: '40 saat' })).toHaveCount(2)
  })

  test('DOM-YTK-012: okul kurumunda paket sekmesi yoktur, adresi taksitlere düşer', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['veli'] })
    const page = await loginAs(school.user('yonetici'))
    await page.goto(ADMIN_URL)
    await expect(page.getByRole('heading', { name: 'Taksit ve tahsilat listesi' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sözleşmeler' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Paketler' })).toHaveCount(0)
    await expect(salesList(page)).toHaveCount(0)
  })

  test('Dar ekran: bölümler, satış penceresi ve ayrıntı 390 ve 320 px taşmaz', async ({
    api,
    loginAs,
    tenant,
  }) => {
    const school = await languageSchool(tenant, [])
    const client = await api(school.user('yonetici'))
    await sellThroughApi(client, await createPackage(client))
    await client.dispose()
    const page = await loginAs(school.user('yonetici'))
    await page.goto(ADMIN_URL)

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 })
      await expect(
        salesList(page).getByRole('button', { name: 'Paket sat', exact: true }),
      ).toBeVisible()
      await expectNoHorizontalOverflow(page)
      await expect(catalog(page).getByRole('button', { name: 'Yeni paket' })).toBeVisible()
      await expectNoHorizontalOverflow(page)

      await salesList(page).getByRole('button', { name: 'Paket sat', exact: true }).click()
      await expectNoHorizontalOverflow(page)
      await fillSale(saleDialog(page), '3')
      await saleDialog(page).getByRole('button', { name: 'Ücreti göster' }).click()
      await expect(
        saleDialog(page).getByRole('heading', { name: 'Ücret önizlemesi' }),
      ).toBeVisible()
      await expectNoHorizontalOverflow(page)
      await page.keyboard.press('Escape')
      await expect(saleDialog(page)).toHaveCount(0)

      await salesList(page)
        .getByRole('button', { name: /satış ayrıntısını aç/ })
        .first()
        .click()
      await expect(salePanel(page).getByText('Satın alınan')).toBeVisible()
      await expectNoHorizontalOverflow(page)
      await page.keyboard.press('Escape')
      await expect(salePanel(page)).toHaveCount(0)
    }
  })
})
