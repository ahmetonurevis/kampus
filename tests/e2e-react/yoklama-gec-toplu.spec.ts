import type { Page, Request } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'

// Yoklamada geç gelme dakikası, toplu işaretleme ve geçmişte tarih aralığı (OG-042, IST-093;
// DOM-AKD-036). Yazan test kendi kurumunu kurar (`tenant`); öğretmen 6-A'nın (c3) bugünkü
// yoklamasını alır. Kalıcılık API sorgusuyla doğrulanır; aralık beklentileri API'den okunur.

const COLLECTIONS = '/api/v1/collections'
const CLASS_NAME = '6-A'
const CLASS_ID = 'c3'
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format()

interface AttendanceRecord {
  studentId: string
  status: string
  date: string
  lateMinutes?: number
}

async function attendance(client: ApiClient, query: string): Promise<AttendanceRecord[]> {
  const rows: AttendanceRecord[] = []
  for (let page = 1; ; page++) {
    const result = await client.get(
      `${COLLECTIONS}/attendance?pageSize=100&page=${page}&classId=${CLASS_ID}${query}`,
    )
    expect(result.status, query).toBe(200)
    const body = result.body as { data: { record: AttendanceRecord }[]; meta: { total: number } }
    rows.push(...body.data.map((row) => row.record))
    if (rows.length >= body.meta.total || body.data.length === 0) return rows
  }
}

async function students(client: ApiClient) {
  const result = await client.get(`${COLLECTIONS}/students?pageSize=100`)
  expect(result.status).toBe(200)
  const rows = (
    result.body as {
      data: { record: { id: string; name: string; classId: string; isActive: boolean } }[]
    }
  ).data
  return rows.map((row) => row.record).filter((s) => s.classId === CLASS_ID && s.isActive)
}

/** Bugünün kayıtları: öğrenci kimliği → kayıt. */
async function todays(client: ApiClient) {
  const day = today()
  const rows = await attendance(client, `&dateFrom=${day}&dateTo=${day}`)
  return new Map(rows.map((row) => [row.studentId, row]))
}

function attendancePosts(page: Page): Request[] {
  const requests: Request[] = []
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new RegExp(`/api/v1/classes/${CLASS_ID}/attendance$`).test(new URL(request.url()).pathname)
    )
      requests.push(request)
  })
  return requests
}

const save = (page: Page) => page.getByRole('button', { name: 'Yoklamayı kaydet' })
const row = (page: Page, name: string) => page.getByRole('checkbox', { name: `${name} seç` })
const status = (page: Page, name: string, label: string) =>
  page.getByRole('radio', { name: `${name}: ${label}` })
const resultCount = (page: Page) => page.locator('.result-count')
const minutes = (page: Page, name: string) => page.getByLabel(`${name} geç kalma süresi (dakika)`)

test.describe('öğretmen: geç gelme ve toplu işaretleme', () => {
  test('seçili satırlara toplu geç geldi, dakika kaydedilir; tümünü geldi dakikayı kaldırır, kayıt yinelenmez', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen'], classes: [CLASS_ID] })
    await loginAs(school.user('ogretmen'))
    const client = await api(school.user('ogretmen'))
    const list = await students(client)
    expect(list.length).toBeGreaterThan(3)
    const [a, b, c] = list
    const posts = attendancePosts(page)

    await page.goto('/ogretmen/yoklama')
    await page.getByLabel('Yoklama alınacak sınıf').selectOption({ label: CLASS_NAME })
    // Seçim yokken toplu durum düğmeleri kapalıdır.
    await expect(
      page.getByRole('button', { name: 'Seçilenleri geç geldi işaretle' }),
    ).toBeDisabled()
    await row(page, a!.name).click()
    await row(page, b!.name).click()
    await expect(page.getByText('2 öğrenci seçili', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Seçilenleri geç geldi işaretle' }).click()
    await expect(status(page, a!.name, 'Geç geldi')).toHaveAttribute('aria-checked', 'true')
    await expect(status(page, b!.name, 'Geç geldi')).toHaveAttribute('aria-checked', 'true')
    await expect(status(page, c!.name, 'Geldi')).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByText(/2 geç geldi/)).toBeVisible()
    // Dakika alanı yalnız geç gelen satırda çıkar.
    await expect(minutes(page, c!.name)).toHaveCount(0)
    await minutes(page, a!.name).fill('12')

    await save(page).click()
    await expect(
      page.locator('main').getByRole('status').filter({ hasText: 'Yoklama kaydedildi.' }),
    ).toBeVisible()
    let stored = await todays(client)
    expect(stored.size).toBe(list.length)
    expect([stored.get(a!.id)?.status, stored.get(a!.id)?.lateMinutes]).toEqual(['late', 12])
    expect([stored.get(b!.id)?.status, stored.get(b!.id)?.lateMinutes]).toEqual(['late', undefined])
    expect(stored.get(c!.id)?.status).toBe('present')

    // Sayfa yenilenince kayıtlı dakika alana gelir.
    await page.reload()
    await page.getByLabel('Yoklama alınacak sınıf').selectOption({ label: CLASS_NAME })
    await expect(minutes(page, a!.name)).toHaveValue('12')

    // Tümünü geldi işaretle: aynı gün kayıt yinelenmez, dakika kayıttan kalkar.
    await page.getByRole('button', { name: 'Tümünü geldi işaretle' }).click()
    await save(page).click()
    await expect(
      page.locator('main').getByRole('status').filter({ hasText: 'Yoklama güncellendi.' }),
    ).toBeVisible()
    stored = await todays(client)
    expect(stored.size).toBe(list.length)
    for (const record of stored.values()) {
      expect(record.status).toBe('present')
      expect(record.lateMinutes).toBeUndefined()
    }
    expect(posts).toHaveLength(2)
  })

  test('geçersiz dakika istek atılmadan satırda uyarılır; ders süresini aşan değeri sunucu reddeder', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen'], classes: [CLASS_ID] })
    await loginAs(school.user('ogretmen'))
    const client = await api(school.user('ogretmen'))
    const [a] = await students(client)
    const posts = attendancePosts(page)

    await page.goto('/ogretmen/yoklama')
    await page.getByLabel('Yoklama alınacak sınıf').selectOption({ label: CLASS_NAME })
    await status(page, a!.name, 'Geç geldi').click()
    await minutes(page, a!.name).fill('0')
    await save(page).click()
    const invalid = page
      .getByRole('alert')
      .filter({ hasText: 'Geç kalma süresi en az 1 dakika olmalıdır.' })
    await expect(invalid).toBeVisible()
    expect(posts).toHaveLength(0)
    expect((await todays(client)).size).toBe(0)

    // Sunucu üst sınırı (ders süresi) denetler; kayıt yazılmaz.
    await minutes(page, a!.name).fill('999')
    // Değer düzelince eski alan hatası kalkar (gönderimden önce).
    await expect(invalid).toBeHidden()
    await save(page).click()
    await expect(page.getByText(/Geç kalma süresi 1 ile \d+ dakika arasında/)).toBeVisible()
    expect(posts).toHaveLength(1)
    expect((await todays(client)).size).toBe(0)
  })
})

test.describe('öğretmen: yoklama geçmişi tarih aralığı', () => {
  test('aralık sunucuda süzülür, adreste kalır; ters ve 1 yıldan uzun aralık uyarılır', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen'], classes: [CLASS_ID] })
    await loginAs(school.user('ogretmen'))
    const client = await api(school.user('ogretmen'))
    const all = await attendance(client, '')
    const days = [...new Set(all.map((record) => record.date.slice(0, 10)))].sort()
    expect(days.length).toBeGreaterThan(3)
    const from = days[1]!
    const to = days[days.length - 2]!
    const inRange = await attendance(client, `&dateFrom=${from}&dateTo=${to}`)
    expect(inRange.length).toBeGreaterThan(0)
    expect(inRange.length).toBeLessThan(all.length)
    // Sunucu aralığı iki ucu dahil süzer; sayı yerel süzgeçle aynıdır.
    expect(inRange.length).toBe(
      all.filter((record) => record.date.slice(0, 10) >= from && record.date.slice(0, 10) <= to)
        .length,
    )

    await page.goto('/ogretmen/yoklama')
    await page.getByLabel('Yoklama başlangıç tarihi').fill(from)
    await page.getByLabel('Yoklama bitiş tarihi').fill(to)
    await expect(page).toHaveURL(new RegExp(`[?&]baslangic=${from}`))
    await expect(page).toHaveURL(new RegExp(`[?&]bitis=${to}`))
    await expect(resultCount(page)).toContainText(`/ ${inRange.length} kayıt`)

    // Adres yenilenince ve doğrudan açılınca aralık korunur.
    await page.reload()
    await expect(page.getByLabel('Yoklama başlangıç tarihi')).toHaveValue(from)
    await expect(page.getByLabel('Yoklama bitiş tarihi')).toHaveValue(to)
    await expect(resultCount(page)).toContainText(`/ ${inRange.length} kayıt`)

    // Bitiş başlangıçtan önce: uyarı çıkar, aralık uygulanmaz.
    await page.getByLabel('Yoklama bitiş tarihi').fill(days[0]!)
    await expect(
      page.getByRole('alert').filter({ hasText: 'Bitiş günü başlangıç gününden önce olamaz.' }),
    ).toBeVisible()
    // 1 yıldan uzun aralık.
    await page.getByLabel('Yoklama başlangıç tarihi').fill('2024-01-01')
    await page.getByLabel('Yoklama bitiş tarihi').fill('2025-06-01')
    await expect(
      page.getByRole('alert').filter({ hasText: 'Tarih aralığı en fazla 1 yıl olabilir.' }),
    ).toBeVisible()

    // Sunucu aynı kuralları 400 ve Türkçe alan mesajıyla uygular.
    for (const [query, message] of [
      [`dateFrom=${to}&dateTo=${from}`, 'Bitiş günü başlangıç gününden önce olamaz.'],
      ['dateFrom=2024-01-01&dateTo=2025-06-01', 'Tarih aralığı en fazla 1 yıl olabilir.'],
    ] as const) {
      const response = await client.get(`${COLLECTIONS}/attendance?${query}`)
      expect(response.status, query).toBe(400)
      expect(JSON.stringify(response.body)).toContain(message)
    }
  })
})
