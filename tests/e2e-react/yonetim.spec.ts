import { readFile } from 'node:fs/promises'

import type { Download, Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { expectEveryRow, expectNoHorizontalOverflow } from './support/ui.ts'

// Yönetici okuma ekranları (Kampüsler & Sınıflar, Eğitim Kadrosu). Paylaşılan yönetici oturumu
// salt okunurdur; hiçbir test kayıt yazmaz. Seed: 3 kampüs, 24 sınıf (kampüs başına 8), 48 öğretmen
// (kampüs başına 16, 16 branş × 3). Sayfa boyutu 8.

const CLASSES_URL = '/yonetici/subeler'
const STAFF_URL = '/yonetici/personel'
const CLASS_TABLE = 'Sınıflar ve ders atamaları'
const STAFF_TABLE = 'Branş öğretmenleri'
const KADIKOY = 'Kadıköy Kampüsü'

const tableOf = (page: Page, name: string) => page.getByRole('table', { name })
/** Başlık satırı hariç gövde satırları. */
const bodyRows = (page: Page, name: string) => tableOf(page, name).locator('tbody tr')
const resultCount = (page: Page) => page.locator('.result-count')

/** Mobil kayıt kartları; üstteki özet kartları (`.stat-card`) sayılmaz. */
const recordCards = (page: Page) => page.locator('article:not(.stat-card)')
const statValue = (page: Page, name: string) =>
  page.getByRole('article', { name, exact: true }).locator('.stat-value')

/** Aktif kayıt sayısı: ekranın kullandığı sunucu sayımıyla aynı sorgu, testte ayrıca okunur. */
async function activeTotal(client: ApiClient, collection: string): Promise<number> {
  const result = await client.get(
    `/api/v1/collections/${collection}/counts?groupBy=isActive&isActive=true`,
  )
  expect(result.status, `${collection} sayımı`).toBe(200)
  return (result.body as { meta: { total: number } }).meta.total
}

async function readCsv(download: Download): Promise<string[][]> {
  const path = await download.path()
  const text = await readFile(path, 'utf8')
  expect(text.charCodeAt(0), 'UTF-8 BOM').toBe(0xfeff)
  return text
    .slice(1)
    .split('\r\n')
    .map((line) => line.split(';').map((cell) => cell.replace(/^"|"$/g, '')))
}

async function downloadList(page: Page): Promise<string[][]> {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Listeyi indir' }).click()
  return readCsv(await pending)
}

test.describe('yönetici: Kampüsler & Sınıflar', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs('yonetici')
  })

  test('kampüs kartları ve sınıf listesi API verisiyle açılır', async ({ page }) => {
    await page.goto(CLASSES_URL)
    await expect(
      page.getByRole('heading', { level: 1, name: 'Kampüsler & Sınıflar' }),
    ).toBeVisible()

    const campuses = page.getByRole('list', { name: 'Kampüsler' }).getByRole('listitem')
    await expect(campuses).toHaveCount(3)
    await expect(campuses.first().getByRole('heading', { level: 2 })).toHaveText(KADIKOY)

    await expect(page.getByText('24 kayıt · 5–12. sınıf düzeyleri')).toBeVisible()
    await expect(bodyRows(page, CLASS_TABLE)).toHaveCount(8)
    await expect(resultCount(page)).toContainText('1–8 / 24 kayıt')
  })

  test('özet kartları aktif kampüs, sınıf ve öğrenci sayısını sunucu sayımıyla gösterir', async ({
    page,
    api,
  }) => {
    const admin = await api('yonetici')
    const students = await activeTotal(admin, 'students')
    await page.goto(CLASSES_URL)
    await expect(page.getByRole('region', { name: 'Kampüs ve sınıf özeti' })).toBeVisible()
    await expect(statValue(page, 'Aktif kampüs')).toHaveText('3')
    await expect(statValue(page, 'Aktif sınıf')).toHaveText('24')
    await expect(statValue(page, 'Aktif öğrenci')).toHaveText(students.toLocaleString('tr-TR'))
    expect(students).toBeGreaterThan(0)

    // Kartlar sayfanın süzgeçlerinden bağımsız genel toplamdır (Vue ile aynı).
    await page.getByLabel('Tabloda ara').fill('7-A')
    await expect(resultCount(page)).not.toContainText('/ 24 kayıt')
    await expect(statValue(page, 'Aktif sınıf')).toHaveText('24')
    await expectNoHorizontalOverflow(page)
  })

  test('IST-028: arama sunucuda süzer, adrese yazılmaz; yenilemede arama silinir, sıralama kalır', async ({
    page,
  }) => {
    await page.goto(CLASSES_URL)
    await expect(bodyRows(page, CLASS_TABLE)).toHaveCount(8)

    const header = tableOf(page, CLASS_TABLE).getByRole('columnheader', { name: /Kampüs/ })
    await header.getByRole('button').click()
    await expect(page).toHaveURL(/[?&]sirala=branch/)
    await page.getByLabel('Tabloda ara').fill('7-A')
    await expect(resultCount(page)).not.toContainText('/ 24 kayıt')
    const rows = bodyRows(page, CLASS_TABLE)
    await expect(rows.first()).toContainText('7-A')
    await expectEveryRow(rows, '7-A')
    await expect(page).not.toHaveURL(/[?&]q=/)

    // Yenileme sıralamayı adresten kurar; arama yalnız bellekteydi, kaybolur (ADR 0009).
    await page.reload()
    await expect(header).toHaveAttribute('aria-sort', 'ascending')
    await expect(page.getByLabel('Tabloda ara')).toHaveValue('')
    await expect(resultCount(page)).toContainText('/ 24 kayıt')

    await page.getByLabel('Tabloda ara').fill('yok-boyle-bir-sinif')
    await expect(page.getByText('Aramanızla eşleşen kayıt bulunamadı.')).toBeVisible()
    await page.getByRole('button', { name: 'Aramayı ve filtreleri temizle' }).first().click()
    await expect(bodyRows(page, CLASS_TABLE)).toHaveCount(8)
    await expect(page).not.toHaveURL(/[?&]q=/)
  })

  test('IST-028: eski bağlantıdaki q bir kez okunur ve geçmişe girdi eklemeden adresten silinir', async ({
    page,
  }) => {
    await page.goto(`${CLASSES_URL}?sayfa=2`)
    await expect(resultCount(page)).toContainText('9–16 / 24 kayıt')
    await page.goto(`${CLASSES_URL}?q=7-A`)
    await expect(page.getByLabel('Tabloda ara')).toHaveValue('7-A')
    await expect(page).not.toHaveURL(/[?&]q=/)
    await expectEveryRow(bodyRows(page, CLASS_TABLE), '7-A')

    // `replace` ile silindiği için geri, q'lu adrese değil önceki girdiye (2. sayfa) döner.
    await page.goBack()
    await expect(page).toHaveURL(/[?&]sayfa=2/)
    await expect(page).not.toHaveURL(/[?&]q=/)
    await expect(resultCount(page)).toContainText('9–16 / 24 kayıt')
  })

  test('boş sonuçta tek temizleme düğmesi çıkar; süzgeç yokken hiç çıkmaz', async ({ page }) => {
    await page.goto(CLASSES_URL)
    const clear = page.getByRole('button', { name: 'Aramayı ve filtreleri temizle' })
    await expect(bodyRows(page, CLASS_TABLE)).toHaveCount(8)
    await expect(clear).toHaveCount(0)

    await page.getByLabel('Tabloda ara').fill('yok-boyle-bir-sinif')
    await expect(page.getByText('Aramanızla eşleşen kayıt bulunamadı.')).toBeVisible()
    await expect(clear).toHaveCount(1)

    await clear.click()
    await expect(bodyRows(page, CLASS_TABLE)).toHaveCount(8)
    await expect(clear).toHaveCount(0)
  })

  test('arama kampüs adıyla sınıf bulur; kampüs sütunu kampüs adına göre sıralanır', async ({
    page,
  }) => {
    await page.goto(CLASSES_URL)
    // Arama, ilk liste yanıtı gelip ekran yerleştikten sonra yazılır; böylece beklenen sayı
    // yalnız aramanın yanıtını ölçer (yükte ilk yanıt gecikirse iki istek üst üste binmez).
    await expect(resultCount(page)).toContainText('1–8 / 24 kayıt')
    await page.getByLabel('Tabloda ara').fill('kadikoy')
    await expect(resultCount(page)).toContainText('1–8 / 8 kayıt')
    await expect(page).not.toHaveURL(/[?&]q=/)
    await expectEveryRow(bodyRows(page, CLASS_TABLE), KADIKOY)

    await page.getByRole('button', { name: 'Aramayı ve filtreleri temizle' }).first().click()
    await expect(resultCount(page)).toContainText('/ 24 kayıt')
    const header = tableOf(page, CLASS_TABLE).getByRole('columnheader', { name: /Kampüs/ })
    await header.getByRole('button').click()
    await expect(header).toHaveAttribute('aria-sort', 'ascending')
    await expect(page).toHaveURL(/[?&]sirala=branch/)
    // Alfabetik ilk kampüs Ataşehir'dir (Beşiktaş, Kadıköy sonra).
    await expect(bodyRows(page, CLASS_TABLE).first()).toContainText('Ataşehir Kampüsü')
  })

  test('sayfalama ilerler; kampüs filtresi sayfayı 1e döndürür', async ({ page }) => {
    await page.goto(CLASSES_URL)
    await expect(resultCount(page)).toContainText('1–8 / 24 kayıt')

    await page.getByRole('button', { name: 'Sonraki sayfa' }).click()
    await expect(page).toHaveURL(/[?&]sayfa=2/)
    await expect(resultCount(page)).toContainText('9–16 / 24 kayıt')
    await expect(page.getByRole('button', { name: '2. sayfa' })).toHaveAttribute(
      'aria-current',
      'page',
    )

    await page.getByLabel('Kampüs filtresi').selectOption({ label: KADIKOY })
    await expect(page).toHaveURL(/[?&]kampus=/)
    await expect(page).not.toHaveURL(/[?&]sayfa=/)
    await expect(resultCount(page)).toContainText('1–8 / 8 kayıt')
    await expectEveryRow(bodyRows(page, CLASS_TABLE), KADIKOY)

    await page.getByRole('button', { name: 'Aramayı ve filtreleri temizle' }).click()
    await expect(resultCount(page)).toContainText('1–8 / 24 kayıt')
    await expect(page).not.toHaveURL(/[?&]kampus=/)
  })

  test('sınıf düzeyi filtresi Filtreler panelinden uygulanır ve kaldırılır', async ({ page }) => {
    await page.goto(CLASSES_URL)
    await page.getByRole('button', { name: 'Sonraki sayfa' }).click()
    await expect(page).toHaveURL(/[?&]sayfa=2/)

    await page.getByRole('button', { name: 'Filtreler' }).click()
    await page.getByLabel('Sınıf düzeyi').selectOption({ label: '7. Sınıf' })
    await expect(page).toHaveURL(/[?&]duzey=7/)
    await expect(page).not.toHaveURL(/[?&]sayfa=/)
    await expect(resultCount(page)).toContainText('1–3 / 3 kayıt')
    await expectEveryRow(bodyRows(page, CLASS_TABLE), '7-')

    await page.getByRole('button', { name: 'Sınıf düzeyi filtresini kaldır' }).click()
    await expect(resultCount(page)).toContainText('/ 24 kayıt')
  })

  test('Arşiv sekmesi sunucuda isActive=false ister; adres korunur, Aktif kayıtlar geri döner', async ({
    page,
  }) => {
    // Seed'de arşivlenmiş kampüs/sınıf yoktur: arşiv boş, aktif liste 24 kayıttır.
    const request = page.waitForRequest(
      (item) =>
        item.url().includes('/collections/classes') && item.url().includes('isActive=false'),
    )
    await page.goto(`${CLASSES_URL}?durum=arsiv`)
    await request
    await expect(page.getByRole('button', { name: 'Arşiv', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(page.getByText('0 arşiv kaydı · 5–12. sınıf düzeyleri')).toBeVisible()
    await expect(page.getByText('Arşivde kampüs yok')).toBeVisible()

    // Temizle arama ve filtreleri siler, sekmeyi değil.
    await page.getByLabel('Tabloda ara').fill('zz-yok')
    await page.getByRole('button', { name: 'Aramayı ve filtreleri temizle' }).first().click()
    await expect(page).toHaveURL(/[?&]durum=arsiv/)

    await page.getByRole('button', { name: 'Aktif kayıtlar' }).click()
    await expect(page).not.toHaveURL(/[?&]durum=/)
    await expect(resultCount(page)).toContainText('1–8 / 24 kayıt')
    await expect(page.getByRole('list', { name: 'Kampüsler' }).getByRole('listitem')).toHaveCount(3)
  })

  test('sınıf özeti URLde açılır, geri ve ileri paneli kapatıp açar', async ({ page }) => {
    await page.goto(CLASSES_URL)
    await page.getByLabel('Tabloda ara').fill('7-A')
    await expect(bodyRows(page, CLASS_TABLE).first()).toContainText('7-A')

    const opener = tableOf(page, CLASS_TABLE)
      .getByRole('button', { name: '7-A', exact: true })
      .first()
    await opener.click()
    const dialog = page.getByRole('dialog', { name: 'Sınıf özeti' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('7-A').first()).toBeVisible()
    await expect(page).toHaveURL(/[?&]sinif=/)

    await page.goBack()
    await expect(dialog).toBeHidden()
    await expect(page).not.toHaveURL(/[?&]sinif=/)
    // Liste bağlamı (arama) geri gidişte korunur.
    await expect(page.getByLabel('Tabloda ara')).toHaveValue('7-A')

    await page.goForward()
    await expect(dialog).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(page).not.toHaveURL(/[?&]sinif=/)
  })

  test('klavyeyle açılan sınıf özeti Escape ile kapanır ve odak düğmeye döner', async ({
    page,
  }) => {
    // Başvuru verisi (öğrenci sayıları) tablo çizildikten sonra gelsin: geç yanıtla sayfa yeniden
    // çizilince satır hücreleri yeniden kurulmamalı, odak düğmede kalmalı.
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => (release = resolve))
    await page.route('**/api/v1/collections/students/counts?*', async (route) => {
      await held
      await route.continue()
    })
    await page.goto(CLASSES_URL)
    const opener = page.getByRole('button', { name: '7-A özeti' }).first()
    const row = bodyRows(page, CLASS_TABLE).filter({ has: opener })
    await expect(row).toContainText('0 / 24')
    await opener.focus()
    release()
    await expect(row).toContainText('10 / 24')
    await expect(opener).toBeFocused()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Sınıf özeti' })
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
    await expect(page).not.toHaveURL(/[?&]ogretmen=/)
  })

  test('kampüs özeti kartından açılır ve doğrudan bağlantıyla yüklenir', async ({ page }) => {
    await page.goto(CLASSES_URL)
    await page.getByRole('button', { name: `${KADIKOY} özeti` }).click()
    const dialog = page.getByRole('dialog', { name: 'Kampüs özeti' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(KADIKOY).first()).toBeVisible()
    await expect(page).toHaveURL(/[?&]kampus-ozet=/)

    // Bağlantıyla gelinen panel: kapatmak parametreyi siler, listeden çıkmaz.
    const link = page.url()
    await page.goto('about:blank')
    await page.goto(link)
    await expect(page.getByRole('dialog', { name: 'Kampüs özeti' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Kampüs özeti' })).toBeHidden()
    await expect(page).toHaveURL(/\/yonetici\/subeler$/)
  })

  test('CSV tüm sonuçları indirir; filtre uygulanınca yalnız filtrelenmiş satırları', async ({
    page,
  }) => {
    await page.goto(CLASSES_URL)
    await expect(bodyRows(page, CLASS_TABLE)).toHaveCount(8)

    const all = await downloadList(page)
    // CSV ekrandaki sütunları izler; "Ortalama" sunucu ölçüsünden gelir (IST-010).
    expect(all[0]).toEqual([
      'Sınıf',
      'Kampüs',
      'Sınıf danışmanı',
      'Öğrenci / Kontenjan',
      'Branş',
      'Ortalama',
    ])
    // Görünen yalnız ilk sayfa (8 satır) olsa da dosya 24 sınıfın tamamıdır.
    expect(all).toHaveLength(1 + 24)

    await page.getByLabel('Kampüs filtresi').selectOption({ label: KADIKOY })
    await expect(resultCount(page)).toContainText('/ 8 kayıt')
    const filtered = await downloadList(page)
    expect(filtered).toHaveLength(1 + 8)
    for (const row of filtered.slice(1)) expect(row[1]).toBe(KADIKOY)
  })

  test('390 px genişlikte yatay taşma yok, kart ve ayrıntılar açılır', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(CLASSES_URL)
    await expect(recordCards(page).first()).toBeVisible()
    await expect(recordCards(page)).toHaveCount(8)
    await expectNoHorizontalOverflow(page)

    await page.getByText('Diğer bilgiler').first().click()
    await expectNoHorizontalOverflow(page)

    await page.getByRole('button', { name: 'Filtreler' }).click()
    await expect(page.getByLabel('Kampüs filtresi')).toBeVisible()
    await page.getByLabel('Kampüs filtresi').selectOption({ label: KADIKOY })
    await expect(recordCards(page)).toHaveCount(8)
    await expectNoHorizontalOverflow(page)
  })
})

test.describe('yönetici: Eğitim Kadrosu', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs('yonetici')
  })

  test('öğretmen listesi API verisiyle açılır ve ada göre sıralanır', async ({ page }) => {
    await page.goto(STAFF_URL)
    await expect(page.getByRole('heading', { level: 1, name: 'Eğitim Kadrosu' })).toBeVisible()
    await expect(page.getByText('48 kayıt · İletişim, branş ve görev bilgileri')).toBeVisible()
    await expect(bodyRows(page, STAFF_TABLE)).toHaveCount(8)
    await expect(resultCount(page)).toContainText('1–8 / 48 kayıt')

    const header = tableOf(page, STAFF_TABLE).getByRole('columnheader', { name: /Öğretmen/ })
    await expect(header).toHaveAttribute('aria-sort', 'none')
    await header.getByRole('button').click()
    await expect(header).toHaveAttribute('aria-sort', 'ascending')
    await expect(page).toHaveURL(/[?&]sirala=name/)
    await header.getByRole('button').click()
    await expect(header).toHaveAttribute('aria-sort', 'descending')
    await expect(page).toHaveURL(/[?&]yon=azalan/)
  })

  test('özet kartları aktif kadro, ders branşı ve öğrenci sayısını sunucu sayımıyla gösterir', async ({
    page,
    api,
  }) => {
    const admin = await api('yonetici')
    const students = await activeTotal(admin, 'students')
    await page.goto(STAFF_URL)
    await expect(page.getByRole('region', { name: 'Eğitim kadrosu özeti' })).toBeVisible()
    await expect(statValue(page, 'Aktif eğitim kadrosu')).toHaveText('48')
    await expect(statValue(page, 'Ders branşı')).toHaveText('16')
    await expect(statValue(page, 'Aktif öğrenci')).toHaveText(students.toLocaleString('tr-TR'))
    await expectNoHorizontalOverflow(page)
  })

  test('Arşiv sekmesi öğretmenlerde isActive=false ister ve Aktif kayıtlara dönülür', async ({
    page,
  }) => {
    await page.goto(STAFF_URL)
    await expect(resultCount(page)).toContainText('1–8 / 48 kayıt')
    const request = page.waitForRequest(
      (item) =>
        item.url().includes('/collections/teachers') && item.url().includes('isActive=false'),
    )
    await page.getByRole('button', { name: 'Arşiv', exact: true }).click()
    await request
    await expect(page).toHaveURL(/[?&]durum=arsiv/)
    await expect(page.getByText('0 arşiv kaydı · İletişim, branş ve görev bilgileri')).toBeVisible()

    await page.getByRole('button', { name: 'Aktif kayıtlar' }).click()
    await expect(resultCount(page)).toContainText('1–8 / 48 kayıt')
  })

  test('arama kampüs adıyla öğretmen bulur; kampüs sütunu bağlı alandan gelir', async ({
    page,
  }) => {
    await page.goto(STAFF_URL)
    await expect(resultCount(page)).toContainText('1–8 / 48 kayıt')
    await page.getByLabel('Tabloda ara').fill('kadikoy')
    await expect(resultCount(page)).toContainText('1–8 / 16 kayıt')
    await expect(page).not.toHaveURL(/[?&]q=/)
    await expectEveryRow(bodyRows(page, STAFF_TABLE), KADIKOY)
  })

  test('kampüs ve branş filtreleri birleşir, sayfa 1e döner', async ({ page }) => {
    await page.goto(STAFF_URL)
    await page.getByRole('button', { name: 'Sonraki sayfa' }).click()
    await expect(page).toHaveURL(/[?&]sayfa=2/)

    await page.getByLabel('Kampüs filtresi').selectOption({ label: KADIKOY })
    await expect(page).toHaveURL(/[?&]kampus=/)
    await expect(page).not.toHaveURL(/[?&]sayfa=/)
    await expect(resultCount(page)).toContainText('1–8 / 16 kayıt')

    await page.getByRole('button', { name: 'Sonraki sayfa' }).click()
    await expect(resultCount(page)).toContainText('9–16 / 16 kayıt')
    await expect(page.getByRole('button', { name: 'Sonraki sayfa' })).toBeDisabled()

    await page.getByLabel('Branş filtresi').selectOption({ label: 'Matematik' })
    await expect(page).toHaveURL(/[?&]brans=/)
    await expect(page).not.toHaveURL(/[?&]sayfa=/)
    await expect(resultCount(page)).toContainText('1–1 / 1 kayıt')
    const row = bodyRows(page, STAFF_TABLE).first()
    await expect(row).toContainText('Matematik')
    await expect(row).toContainText(KADIKOY)

    await page.getByRole('button', { name: 'Aramayı ve filtreleri temizle' }).click()
    await expect(resultCount(page)).toContainText('/ 48 kayıt')
    await expect(page).not.toHaveURL(/[?&](kampus|brans)=/)
  })

  test('arama öğretmeni bulur; bulunamayınca boş durum gösterilir', async ({ page }) => {
    await page.goto(STAFF_URL)
    await expect(resultCount(page)).toContainText('1–8 / 48 kayıt')
    await page.getByLabel('Tabloda ara').fill('Selin Kaya')
    await expect(bodyRows(page, STAFF_TABLE).first()).toContainText('Selin Kaya')

    await page.getByLabel('Tabloda ara').fill('zzzz-yok')
    await expect(page.getByText('Aramanızla eşleşen kayıt bulunamadı.')).toBeVisible()
  })

  test('öğretmen özeti URLde açılır; geri paneli kapatır, ileri açar', async ({ page }) => {
    await page.goto(STAFF_URL)
    await expect(resultCount(page)).toContainText('1–8 / 48 kayıt')
    await page.getByLabel('Tabloda ara').fill('Selin Kaya')
    const opener = tableOf(page, STAFF_TABLE)
      .getByRole('button', { name: 'Selin Kaya özeti' })
      .first()
    await opener.click()
    const dialog = page.getByRole('dialog', { name: 'Öğretmen özeti' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Selin Kaya').first()).toBeVisible()
    await expect(page).toHaveURL(/[?&]ogretmen=/)

    await page.goBack()
    await expect(dialog).toBeHidden()
    await expect(page.getByLabel('Tabloda ara')).toHaveValue('Selin Kaya')
    await page.goForward()
    await expect(dialog).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(page).not.toHaveURL(/[?&]ogretmen=/)
  })

  test('CSV filtrelenmiş tüm öğretmenleri içerir', async ({ page }) => {
    await page.goto(STAFF_URL)
    await expect(bodyRows(page, STAFF_TABLE)).toHaveCount(8)

    const all = await downloadList(page)
    expect(all[0]?.slice(0, 3)).toEqual(['Öğretmen', 'Branş', 'Kampüs'])
    expect(all).toHaveLength(1 + 48)

    await page.getByLabel('Kampüs filtresi').selectOption({ label: KADIKOY })
    await expect(resultCount(page)).toContainText('/ 16 kayıt')
    const filtered = await downloadList(page)
    expect(filtered).toHaveLength(1 + 16)
    for (const row of filtered.slice(1)) expect(row[2]).toBe(KADIKOY)
  })

  test('390 px genişlikte yatay taşma yok ve filtreler panelde', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(STAFF_URL)
    await expect(recordCards(page)).toHaveCount(8)
    await expectNoHorizontalOverflow(page)

    await page.getByText('Diğer bilgiler').first().click()
    await expectNoHorizontalOverflow(page)

    await page.getByRole('button', { name: 'Filtreler' }).click()
    await page.getByLabel('Branş filtresi').selectOption({ label: 'Matematik' })
    await expect(recordCards(page)).toHaveCount(3)
    await expectNoHorizontalOverflow(page)
  })
})

test.describe('yönetim ekranları: yetki', () => {
  test('öğretmen yönetim sayfasına giremez', async ({ page, loginAs }) => {
    await loginAs('ogretmen')
    await page.goto(CLASSES_URL)
    await expect(page).not.toHaveURL(/\/yonetici\/subeler/)
  })
})
