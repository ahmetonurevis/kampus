import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import type { Download, Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { expectEveryRow, expectNoHorizontalOverflow } from './support/ui.ts'

// Okuma sayfaları (W17): öğretmen Sınıf Analizi, yönetici Risk Altındaki Öğrenciler ve Kayıt
// Raporları. Üçü de yalnız okur; paylaşılan seed oturumları salt okunurdur. Seed: Selin 8 sınıfa
// bakar (24 sınıfın 8'i); 240 öğrenciden 47'si risk eşiğini aşar (Deniz Yılmaz 61 puan, 8 ders
// devamsızlık: yüksek risk); 30 aday, 5 kanal (kanal başına 6), 4 kesin kayıt (kanal başına en
// çok 1; Telefon'da yok). Beklenen değerler kapsamı uygulayan API'den ya da bu bilinen seed
// değerlerinden gelir. Boş durum ve modül kapatma testleri kendi kurumunu kurar.

const COLLECTIONS = '/api/v1/collections'
const RISK_URL = '/yonetici/risk-listesi'
const RISK_TABLE = 'Risk altındaki öğrenciler'
const CLASS_ANALYSIS_URL = '/ogretmen/sinif-analizi'
const REPORTS_URL = '/yonetici/kayit-raporlari'
const SOURCES_TABLE = 'Kanal bazlı dönüşüm'
const NO_GRADES = 'Bu ders için konu bazlı not kaydı yok.'
const NO_PROSPECTS = 'Henüz aday kaydı yok.'
const NO_RISK = 'Risk eşiğini aşan öğrenci yok.'
const MODULE_CLOSED = 'Bu modül kurum ayarlarından kapatılmış.'
const FOREIGN_CLASS = 'c9'

const tableOf = (page: Page, name: string) => page.getByRole('table', { name })
const bodyRows = (page: Page, name: string) => tableOf(page, name).locator('tbody tr')
const resultCount = (page: Page) => page.locator('.result-count')
const search = (page: Page) => page.getByLabel('Tabloda ara')

interface CollectionPage {
  data: { id: string; record: Record<string, unknown> }[]
  meta: { total: number }
}

async function listAll(client: ApiClient, collection: string, query = '') {
  const records: Record<string, unknown>[] = []
  for (let page = 1; ; page++) {
    const result = await client.get(
      `${COLLECTIONS}/${collection}?pageSize=100&page=${page}${query}`,
    )
    expect(result.status, `${collection} sayfa ${page}`).toBe(200)
    const body = result.body as CollectionPage
    records.push(...body.data.map((row) => row.record))
    if (records.length >= body.meta.total || body.data.length === 0) return records
  }
}

async function readCsv(download: Download): Promise<string[][]> {
  const text = await readFile(await download.path(), 'utf8')
  expect(text.charCodeAt(0), 'UTF-8 BOM').toBe(0xfeff)
  return text
    .slice(1)
    .split('\r\n')
    .filter((line) => line !== '')
    .map((line) => line.split(';').map((cell) => cell.replace(/^"|"$/g, '')))
}

async function downloadReport(page: Page): Promise<string[][]> {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Raporu indir' }).click()
  return readCsv(await pending)
}

interface ModuleSettings {
  data: { version: number }
}

/** Yönetici adına modülü kapatır (kurum ayarının sürümü okunur, `If-Match` ile gönderilir). */
async function closeModule(client: ApiClient, moduleKey: string) {
  const settings = await client.get('/api/v1/modules')
  expect(settings.status).toBe(200)
  const response = await client.context.patch(`/api/v1/modules/${moduleKey}`, {
    data: { enabled: false },
    headers: {
      'if-match': `"${(settings.body as ModuleSettings).data.version}"`,
      'idempotency-key': randomUUID(),
    },
  })
  expect(response.status()).toBe(200)
}

const round = (values: number[]) =>
  values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0

test.describe('öğretmen: Sınıf Analizi', () => {
  test('yalnız ders verdiği sınıflar seçilir; ders başarısı o sınıfın notlarından hesaplanır', async ({
    page,
    loginAs,
    api,
  }) => {
    await loginAs('ogretmen')
    await page.goto(CLASS_ANALYSIS_URL)
    await expect(page.getByRole('heading', { name: 'Sınıf Analizi', level: 1 })).toBeVisible()

    // Kapsamı sunucu uygular: yönetici 24 sınıf görür, Selin'in seçicisinde yalnız kendi 8 sınıfı var.
    const admin = await api('yonetici')
    expect(await listAll(admin, 'classes')).toHaveLength(24)
    const teacher = await api('ogretmen')
    const own = await listAll(teacher, 'classes')
    expect(own).toHaveLength(8)
    const classSelect = page.getByLabel('Sınıf seç')
    await expect(classSelect.locator('option')).toHaveCount(8)
    const classId = await classSelect.inputValue()
    expect(own.map((item) => item.id)).toContain(classId)
    await expect(classSelect.locator(`option[value="${FOREIGN_CLASS}"]`)).toHaveCount(0)

    // Ders çubukları ve genel başarı, API'nin verdiği sınıf notlarının ortalamalarıdır.
    const grades = await listAll(teacher, 'grades', `&classId=${classId}`)
    const bySubject = new Map<string, number[]>()
    for (const grade of grades) {
      const scores = bySubject.get(String(grade.subjectId)) ?? []
      scores.push(Number(grade.score))
      bySubject.set(String(grade.subjectId), scores)
    }
    expect(bySubject.size).toBeGreaterThan(0)
    const bars = page.getByRole('list', { name: 'Ders başarıları' }).getByRole('listitem')
    await expect(bars).toHaveCount(bySubject.size)
    const overall = round([...bySubject.values()].map(round))
    await expect(page.getByLabel('Başarı özeti', { exact: true })).toContainText(`${overall}/100`)
    await expect(page.getByRole('heading', { name: 'Ders bazlı başarı' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Aylık başarı eğilimi' })).toBeVisible()
  })

  test('sınıf ve ders seçimi adreste durur; ders seçince konu analizi gelir, sınıf değişince ders sıfırlanır', async ({
    page,
    loginAs,
  }) => {
    await loginAs('ogretmen')
    await page.goto(CLASS_ANALYSIS_URL)
    const classSelect = page.getByLabel('Sınıf seç')
    await expect(classSelect.locator('option')).toHaveCount(8)

    await page.getByLabel('Analiz dersi').selectOption({ index: 1 })
    await expect(page).toHaveURL(/[?&]ders=/)
    await expect(page.getByRole('heading', { name: /· Konu analizi/ })).toBeVisible()

    const first = await classSelect.inputValue()
    await classSelect.selectOption({ index: 1 })
    const second = await classSelect.inputValue()
    expect(second).not.toBe(first)
    await expect(page).toHaveURL(new RegExp(`[?&]sinif=${second}`))
    await expect(page).not.toHaveURL(/[?&]ders=/)
    await expect(page.getByRole('heading', { name: 'Ders bazlı başarı' })).toBeVisible()

    // Adres paylaşılabilir: sınıf yeniden yüklemede korunur.
    await page.reload()
    await expect(classSelect).toHaveValue(second)
  })

  test('kapsam dışı sınıf adresi seçilmez ve notları sunucudan gelmez', async ({
    page,
    loginAs,
    api,
  }) => {
    await loginAs('ogretmen')
    await page.goto(`${CLASS_ANALYSIS_URL}?sinif=${FOREIGN_CLASS}`)
    const classSelect = page.getByLabel('Sınıf seç')
    await expect(classSelect.locator('option')).toHaveCount(8)
    await expect(classSelect).not.toHaveValue(FOREIGN_CLASS)
    await expect(page.getByRole('list', { name: 'Ders başarıları' })).toBeVisible()

    const teacher = await api('ogretmen')
    expect(await listAll(teacher, 'grades', `&classId=${FOREIGN_CLASS}`)).toHaveLength(0)
    expect((await teacher.get(`${COLLECTIONS}/classes/${FOREIGN_CLASS}`)).status).toBe(404)
  })

  test('notu olmayan sınıf boş durum gösterir', async ({ page, loginAs, tenant }) => {
    const school = await tenant({ roles: ['ogretmen'] })
    await loginAs(school.user('ogretmen'))
    await page.goto(CLASS_ANALYSIS_URL)
    await expect(page.getByLabel('Sınıf seç').locator('option').first()).toBeAttached()
    await expect(page.getByText(NO_GRADES)).toBeVisible()
    await expect(page.getByText('Eğilim için not kaydı yok.')).toBeVisible()
    await expect(page.getByLabel('Başarı özeti', { exact: true })).toContainText('—')
  })

  test('başka roller sayfayı açamaz; akademik modül kapanınca sayfa ve notlar kapanır', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    await loginAs('ogrenci')
    await page.goto(CLASS_ANALYSIS_URL)
    await expect(page).toHaveURL(/\/ogrenci\/dashboard$/)
    await loginAs('veli')
    await page.goto(CLASS_ANALYSIS_URL)
    await expect(page).toHaveURL(/\/veli\/dashboard(\?|$)/)

    const school = await tenant({ roles: ['ogretmen'] })
    const admin = await api(school.user('yonetici'))
    const teacher = await api(school.user('ogretmen'))
    expect((await teacher.get(`${COLLECTIONS}/grades`)).status).toBe(200)
    await closeModule(admin, 'academic')
    await loginAs(school.user('ogretmen'))
    await page.goto(CLASS_ANALYSIS_URL)
    await expect(page.getByText(MODULE_CLOSED)).toBeVisible()
    await expect(page).toHaveURL(/\/ogretmen\/dashboard/)
    expect((await teacher.get(`${COLLECTIONS}/grades`)).status).toBe(403)
  })
})

test.describe('yönetici: Risk Altındaki Öğrenciler', () => {
  test('liste ve özet sayıları API verisiyle açılır; Deniz yüksek riskli görünür', async ({
    page,
    loginAs,
  }) => {
    await loginAs('yonetici')
    const guidance: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('guidanceCases')) guidance.push(request.url())
    })
    await page.goto(RISK_URL)
    await expect(
      page.getByRole('heading', { name: 'Risk Altındaki Öğrenciler', level: 1 }),
    ).toBeVisible()
    await expect(resultCount(page)).toContainText('1–8 / 47 kayıt')
    const summary = page.getByLabel('Risk özeti', { exact: true })
    await expect(summary).toContainText('Takip edilen öğrenci')
    await expect(summary).toContainText('47')
    await expect(summary).toContainText('6 ders / 65 puan')

    const deniz = bodyRows(page, RISK_TABLE).filter({ hasText: 'Deniz Yılmaz' })
    await expect(deniz).toHaveCount(1)
    await expect(deniz).toContainText('61/100')
    await expect(deniz).toContainText('8 ders')
    await expect(deniz).toContainText('Yüksek risk')
    // Risk listesi yalnız not ve yoklamadan beslenir; rehberlik dosyası hiç istenmez (DOM-YTK-020).
    expect(guidance).toEqual([])
  })

  test('arama ve risk durumu filtresi sonucu daraltır; temizleyince liste döner', async ({
    page,
    loginAs,
  }) => {
    await loginAs('yonetici')
    await page.goto(RISK_URL)
    await expect(resultCount(page)).toContainText('/ 47 kayıt')

    await search(page).fill('Deniz Yılmaz')
    await expect(resultCount(page)).toContainText('1–1 / 1 kayıt')
    await expectEveryRow(bodyRows(page, RISK_TABLE), 'Deniz Yılmaz')

    await search(page).fill('zzzz-yok')
    await expect(page.getByText('Aramanızla eşleşen kayıt bulunamadı.')).toBeVisible()
    await page.getByRole('button', { name: 'Aramayı ve filtreleri temizle' }).first().click()
    await expect(resultCount(page)).toContainText('/ 47 kayıt')

    await page.getByRole('button', { name: 'Filtreler' }).click()
    await page.getByLabel('Risk durumu').selectOption({ label: 'Takip önerilir' })
    await expectEveryRow(bodyRows(page, RISK_TABLE), 'Takip önerilir')
    await expect(bodyRows(page, RISK_TABLE).filter({ hasText: 'Deniz Yılmaz' })).toHaveCount(0)
  })

  test('satırdan sağ panel açılır, geri düğmesi kapatır; panel rehberlik verisi içermez', async ({
    page,
    loginAs,
  }) => {
    await loginAs('yonetici')
    const guidance: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('guidanceCases')) guidance.push(request.url())
    })
    await page.goto(RISK_URL)
    await search(page).fill('Deniz Yılmaz')
    await page.getByRole('button', { name: 'Deniz Yılmaz özetini aç' }).click()
    const dialog = page.getByRole('dialog', { name: 'Öğrenci özeti' })
    await expect(dialog.getByRole('heading', { name: 'Deniz Yılmaz' })).toBeVisible()
    await expect(page).toHaveURL(/[?&]ogrenci=s1/)
    await expect(dialog).toContainText('61/100')
    await expect(dialog).toContainText('8 ders')
    await expect(dialog).toContainText('Yüksek risk')
    await expect(dialog.getByText('8 ders devamsızlık · Not ortalaması 61/100')).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Ders bazında ortalama' })).toBeVisible()
    await expect(dialog.getByText(/rehberlik|iç not/i)).toHaveCount(0)

    await page.goBack()
    await expect(dialog).toBeHidden()
    await page.goForward()
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    expect(guidance).toEqual([])
  })

  test('rapor CSV tüm filtrelenmiş sonucu içerir, yalnız görünen sayfayı değil', async ({
    page,
    loginAs,
  }) => {
    await loginAs('yonetici')
    await page.goto(RISK_URL)
    await expect(resultCount(page)).toContainText('/ 47 kayıt')
    const all = await downloadReport(page)
    expect(all[0]).toEqual([
      'Öğrenci',
      'Okul numarası',
      'Sınıf',
      'Şube',
      'Ortalama',
      'Devamsızlık',
      'Risk durumu',
    ])
    expect(all).toHaveLength(1 + 47)
    const deniz = all.find((row) => row[0] === 'Deniz Yılmaz')
    expect(deniz?.[4]).toBe('61/100')
    expect(deniz?.[5]).toBe('8')
    expect(deniz?.[6]).toBe('Yüksek risk')

    await page.getByRole('button', { name: 'Filtreler' }).click()
    await page.getByLabel('Risk durumu').selectOption({ label: 'Takip önerilir' })
    await expect(resultCount(page)).not.toContainText('/ 47 kayıt')
    const watched = await downloadReport(page)
    expect(watched.length).toBeGreaterThan(9)
    expect(watched.length).toBeLessThan(all.length)
    for (const row of watched.slice(1)) expect(row[6]).toBe('Takip önerilir')
  })

  test('risk eşiğini aşan öğrenci yoksa boş durum gösterilir', async ({
    page,
    loginAs,
    tenant,
  }) => {
    // Ece (s2) eşiklerin altındadır: kurumda yalnız o varken liste boştur.
    const school = await tenant({ roles: ['yonetici'], students: ['s2'] })
    await loginAs(school.user('yonetici'))
    await page.goto(RISK_URL)
    await expect(page.getByText(NO_RISK)).toBeVisible()
    await expect(page.getByLabel('Risk özeti', { exact: true })).toContainText(
      'Takip edilen öğrenci',
    )
    await expect(page.getByLabel('Risk özeti', { exact: true }).locator('dd').first()).toHaveText(
      '0',
    )
  })

  test('rol kapsamı: diğer roller sayfayı açamaz, ön büro not ve yoklama sayımına erişemez', async ({
    page,
    loginAs,
    api,
  }) => {
    for (const [role, home] of [
      ['onburo', /\/onburo\/dashboard$/],
      ['ogretmen', /\/ogretmen\/dashboard$/],
      ['veli', /\/veli\/dashboard(\?|$)/],
    ] as const) {
      await loginAs(role)
      await page.goto(RISK_URL)
      await expect(page).toHaveURL(home)
    }
    const frontOffice = await api('onburo')
    expect((await frontOffice.get(`${COLLECTIONS}/grades/counts?groupBy=studentId`)).status).toBe(
      403,
    )
    expect(
      (await frontOffice.get(`${COLLECTIONS}/attendance/counts?groupBy=studentId`)).status,
    ).toBe(403)
  })

  test('akademik modül kapanınca sayfa ve sayım uçları kapanır', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici'], students: ['s1'] })
    const admin = await api(school.user('yonetici'))
    expect((await admin.get(`${COLLECTIONS}/attendance/counts?groupBy=studentId`)).status).toBe(200)
    await closeModule(admin, 'academic')
    await loginAs(school.user('yonetici'))
    await page.goto(RISK_URL)
    await expect(page.getByText(MODULE_CLOSED)).toBeVisible()
    await expect(page).toHaveURL(/\/yonetici\/dashboard/)
    expect((await admin.get(`${COLLECTIONS}/attendance/counts?groupBy=studentId`)).status).toBe(403)
  })
})

test.describe('yönetici: Kayıt Raporları', () => {
  test('aday hunisi aşama sayımından, kanal tablosu aday kayıtlarından gelir', async ({
    page,
    loginAs,
  }) => {
    await loginAs('yonetici')
    await page.goto(REPORTS_URL)
    await expect(page.getByRole('heading', { name: 'Kayıt Raporları', level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Adaydan öğrenciye' })).toBeVisible()
    await expect(page.getByText('30 aday')).toBeVisible()

    const steps = page.getByRole('list', { name: 'Aday aşamaları' }).getByRole('listitem')
    await expect(steps).toHaveCount(6)
    await expect(steps.filter({ hasText: 'Kayıt oldu' })).toContainText('4')
    await expect(steps.filter({ hasText: 'Kayıt oldu' })).toContainText('Adayların %13')

    await expect(bodyRows(page, SOURCES_TABLE)).toHaveCount(5)
    const phone = bodyRows(page, SOURCES_TABLE).filter({ hasText: 'Telefon' })
    await expect(phone).toContainText('6')
    await expect(phone).toContainText('%0')
    const web = bodyRows(page, SOURCES_TABLE).filter({ hasText: 'Web sitesi' })
    await expect(web).toContainText('%17')
  })

  test('kanal araması sonucu daraltır; eşleşme yoksa boş sonuç, temizleyince tablo döner', async ({
    page,
    loginAs,
  }) => {
    await loginAs('yonetici')
    await page.goto(REPORTS_URL)
    await expect(bodyRows(page, SOURCES_TABLE)).toHaveCount(5)

    await search(page).fill('Telefon')
    await expect(resultCount(page)).toContainText('1–1 / 1 kayıt')
    await expectEveryRow(bodyRows(page, SOURCES_TABLE), 'Telefon')

    await search(page).fill('zzzz-yok')
    await expect(page.getByText('Aramanızla eşleşen kayıt bulunamadı.')).toBeVisible()
    await page.getByRole('button', { name: 'Aramayı ve filtreleri temizle' }).first().click()
    await expect(bodyRows(page, SOURCES_TABLE)).toHaveCount(5)
  })

  test('rapor CSV filtrelenmiş tüm kanal satırlarını içerir', async ({ page, loginAs }) => {
    await loginAs('yonetici')
    await page.goto(REPORTS_URL)
    await expect(bodyRows(page, SOURCES_TABLE)).toHaveCount(5)
    const all = await downloadReport(page)
    expect(all[0]).toEqual(['Kanal', 'Aday sayısı', 'Kesin kayıt', 'Dönüşüm oranı'])
    expect(all).toHaveLength(6)
    expect(all.slice(1).reduce((sum, row) => sum + Number(row[1]), 0)).toBe(30)
    expect(all.slice(1).reduce((sum, row) => sum + Number(row[2]), 0)).toBe(4)

    await search(page).fill('Telefon')
    await expect(resultCount(page)).toContainText('/ 1 kayıt')
    const filtered = await downloadReport(page)
    expect(filtered).toHaveLength(2)
    expect(filtered[1]?.[0]).toBe('Telefon')
  })

  test('aday kaydı yoksa huni ve tablo boş durum gösterir', async ({ page, loginAs, tenant }) => {
    const school = await tenant({ roles: ['yonetici'], students: [] })
    await loginAs(school.user('yonetici'))
    await page.goto(REPORTS_URL)
    await expect(page.getByText(NO_PROSPECTS)).toHaveCount(2)
    await expect(page.getByRole('list', { name: 'Aday aşamaları' })).toHaveCount(0)
  })

  test('rol kapsamı: yönetici dışı roller sayfayı açamaz, öğretmen aday verisine erişemez', async ({
    page,
    loginAs,
    api,
  }) => {
    for (const [role, home] of [
      ['onburo', /\/onburo\/dashboard$/],
      ['ogretmen', /\/ogretmen\/dashboard$/],
      ['ogrenci', /\/ogrenci\/dashboard$/],
    ] as const) {
      await loginAs(role)
      await page.goto(REPORTS_URL)
      await expect(page).toHaveURL(home)
    }
    const teacher = await api('ogretmen')
    expect((await teacher.get(`${COLLECTIONS}/prospects`)).status).toBe(403)
    expect((await teacher.get(`${COLLECTIONS}/prospects/counts?groupBy=stage`)).status).toBe(403)
  })

  test('CRM modülü kapanınca sayfa ve aday uçları kapanır', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici'], students: [] })
    const admin = await api(school.user('yonetici'))
    expect((await admin.get(`${COLLECTIONS}/prospects/counts?groupBy=stage`)).status).toBe(200)
    await closeModule(admin, 'crm')
    await loginAs(school.user('yonetici'))
    await page.goto(REPORTS_URL)
    await expect(page.getByText(MODULE_CLOSED)).toBeVisible()
    await expect(page).toHaveURL(/\/yonetici\/dashboard/)
    expect((await admin.get(`${COLLECTIONS}/prospects/counts?groupBy=stage`)).status).toBe(403)
  })
})

test.describe('390 px genişlik', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('sınıf analizi, risk listesi ve kayıt raporları yatay taşmaz', async ({ page, loginAs }) => {
    await loginAs('ogretmen')
    await page.goto(CLASS_ANALYSIS_URL)
    await expect(page.getByRole('list', { name: 'Ders başarıları' })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await loginAs('yonetici', { fresh: true })
    await page.goto(RISK_URL)
    await expect(page.getByText('Deniz Yılmaz').first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.getByRole('button', { name: 'Deniz Yılmaz özetini aç' }).first().click()
    await expect(page.getByRole('dialog', { name: 'Öğrenci özeti' })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.goto(REPORTS_URL)
    await expect(page.getByRole('list', { name: 'Aday aşamaları' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
