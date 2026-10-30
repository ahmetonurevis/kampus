import type { Locator, Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { accounts, roles, type RoleKey } from './support/env.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Genel Bakış (dashboard): beş rolün ekranı, sayaçların sunucu sayımıyla eşleşmesi, velide çocuk
// değişince özetin değişmesi, öğrencide ödeme bilgisinin ve isteğinin bulunmaması, 390 px'te
// taşma olmaması ve öğrenci grafiğinin gerçek yoklama kayıtlarına bağlılığı. Hiçbir test kayıt
// yazmaz. Beklenen değerler API sayım ucundan okunur (ekranın kullandığı sorguyla aynı kapsam,
// ama testte ayrıca hesaplanır). Sayaç yeni yanıt gelene kadar eski değeri gösterebileceği için
// değerler `expect.poll` ile beklenir; sabit bekleme kullanılmaz.

type Group = { value: string | number | boolean | null; count: number; sum?: number }
type Counts = { groups: Group[]; total: number; sum: number }

const PANELS: Record<RoleKey, string> = {
  yonetici: 'Kurum özeti',
  onburo: 'Tahsilat özeti',
  ogretmen: 'Sınıf özeti',
  ogrenci: 'Özetim',
  // Velide bölge adı seçili çocuğun adını taşır.
  veli: ' özeti',
}

const tr = (value: number) => value.toLocaleString('tr-TR')

/** Europe/Istanbul gün anahtarı (`YYYY-MM-DD`). */
const istanbulDay = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(now)

const shiftDay = (day: string, days: number) => {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const mondayOf = (day: string) => {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay()
  return shiftDay(day, -((weekday + 6) % 7))
}

/** `1.234,50 ₺` metninden kuruş. */
const MONEY = /[\d.]+,\d{2} ₺/
const cents = (text: string) =>
  Math.round(Number(text.replace(/[^\d,]/g, '').replace(',', '.')) * 100)

async function counts(client: ApiClient, collection: string, query: string): Promise<Counts> {
  const result = await client.get(`/api/v1/collections/${collection}/counts?${query}`)
  expect(result.status, `${collection} sayımı`).toBe(200)
  const body = result.body as { data: Group[]; meta: { total: number; sum?: number } }
  return { groups: body.data, total: body.meta.total, sum: body.meta.sum ?? 0 }
}

const groupOf = (value: Counts, key: string | boolean) =>
  value.groups.find((group) => String(group.value) === String(key))
const countOf = (value: Counts, key: string | boolean) => groupOf(value, key)?.count ?? 0
const sumOf = (value: Counts, key: string | boolean) => groupOf(value, key)?.sum ?? 0

const card = (page: Page, name: string) => page.getByRole('article', { name, exact: true })
const cardValue = (page: Page, name: string): Locator => card(page, name).locator('.stat-value')

async function openDashboard(page: Page, role: RoleKey, search = '') {
  await page.goto(`/${role}/dashboard${search}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Genel Bakış' })).toBeVisible()
  const panel = PANELS[role]
  await expect(
    role === 'veli'
      ? page.getByRole('region', { name: new RegExp(`${panel}$`) })
      : page.getByRole('region', { name: panel, exact: true }),
  ).toBeVisible()
}

/** Bütün sayaç kartları yüklenene kadar (iskelet ve hata kalmayana kadar) bekler. */
async function expectCardsLoaded(page: Page) {
  const cards = page.getByRole('article')
  await expect.poll(() => cards.count()).toBeGreaterThan(0)
  await expect(page.locator('.stat-card .animate-pulse')).toHaveCount(0)
  await expect(
    page.locator('.stat-card').getByRole('button', { name: 'Yeniden dene' }),
  ).toHaveCount(0)
  // Liste kartlarının yüklenme bildirimi de kalkmalı.
  await expect(page.getByRole('status').filter({ hasText: 'Yükleniyor' })).toHaveCount(0)
}

test.describe('Genel Bakış: beş rol', () => {
  for (const role of roles) {
    test(`${role}: ekran açılır, sayaçlar yüklenir`, async ({ page, loginAs }) => {
      await loginAs(role)
      await openDashboard(page, role)
      await expectCardsLoaded(page)
      await expect(page.getByText(accounts[role].name).first()).toBeVisible()
    })
  }
})

test.describe('Genel Bakış: sayaçlar API sayımıyla eşleşir', () => {
  test('yönetici: aktif öğrenci, sınıf, öğretmen ve bekleyen tahsilat', async ({
    page,
    loginAs,
    api,
  }) => {
    const admin = await api('yonetici')
    const students = await counts(admin, 'students', 'groupBy=isActive')
    const classes = await counts(admin, 'classes', 'groupBy=isActive')
    const teachers = await counts(admin, 'teachers', 'groupBy=isActive')
    const invoices = await counts(admin, 'invoices', 'groupBy=status&sum=amount')

    await loginAs('yonetici')
    await openDashboard(page, 'yonetici')
    await expect
      .poll(() => cardValue(page, 'Aktif öğrenci').innerText())
      .toBe(tr(countOf(students, true)))
    await expect
      .poll(() => cardValue(page, 'Aktif sınıf').innerText())
      .toBe(tr(countOf(classes, true)))
    await expect
      .poll(() => cardValue(page, 'Öğretmen kadrosu').innerText())
      .toBe(tr(countOf(teachers, true)))
    await expect
      .poll(async () => cents(await cardValue(page, 'Bekleyen tahsilat').innerText()))
      .toBe(sumOf(invoices, 'Gecikmiş') + sumOf(invoices, 'Yaklaşan'))
  })

  test('ön büro: taksit sayıları, tutarları ve aday sayısı', async ({ page, loginAs, api }) => {
    const desk = await api('onburo')
    const invoices = await counts(desk, 'invoices', 'groupBy=status&sum=amount')
    const prospects = await desk.get('/api/v1/collections/prospects/counts?groupBy=stage')

    await loginAs('onburo')
    await openDashboard(page, 'onburo')
    await expect
      .poll(() => cardValue(page, 'Gecikmiş taksit').innerText())
      .toBe(tr(countOf(invoices, 'Gecikmiş')))
    await expect
      .poll(() => cardValue(page, 'Yaklaşan taksit').innerText())
      .toBe(tr(countOf(invoices, 'Yaklaşan')))
    await expect
      .poll(async () =>
        cents((await card(page, 'Gecikmiş taksit').innerText()).match(MONEY)?.[0] ?? ''),
      )
      .toBe(sumOf(invoices, 'Gecikmiş'))
    if (prospects.status === 200) {
      const body = prospects.body as { data: Group[]; meta: { total: number } }
      const expected = body.data.find((group) => group.value === 'Yeni aday')?.count ?? 0
      await expect
        .poll(() => cardValue(page, 'Görüşme bekleyen aday').innerText())
        .toBe(tr(expected))
    } else {
      // Aday modülü kapalıysa kart hiç çizilmez.
      await expect(card(page, 'Görüşme bekleyen aday')).toHaveCount(0)
    }
  })

  test('öğretmen: öğrenci, sınıf ve bugün gelmeyen sayısı kendi kapsamındadır', async ({
    page,
    loginAs,
    api,
  }) => {
    const teacher = await api('ogretmen')
    const today = istanbulDay()
    const students = await counts(teacher, 'students', 'groupBy=isActive')
    const classes = await counts(teacher, 'classes', 'groupBy=isActive')
    const absent = await counts(
      teacher,
      'attendance',
      `groupBy=status&dateFrom=${today}&dateTo=${today}`,
    )

    await loginAs('ogretmen')
    await openDashboard(page, 'ogretmen')
    await expect
      .poll(() => cardValue(page, 'Öğrencilerim').innerText())
      .toBe(tr(countOf(students, true)))
    await expect
      .poll(() => cardValue(page, 'Sınıflarım').innerText())
      .toBe(tr(countOf(classes, true)))
    await expect
      .poll(() => cardValue(page, 'Bugün gelmeyen').innerText())
      .toBe(tr(countOf(absent, 'absent')))
  })
})

type Student = { name: string; classId: string }
type Row<T> = { id: string; record: T }

async function students(client: ApiClient): Promise<Row<Student>[]> {
  const result = await client.get('/api/v1/collections/students?pageSize=100')
  expect(result.status).toBe(200)
  return (result.body as { data: Row<Student>[] }).data
}

/** Bir öğrencinin ekranda görünmesi gereken not ortalaması ve devamsızlık metni. */
async function childSummary(client: ApiClient, studentId: string) {
  const grades = await counts(
    client,
    'grades',
    `groupBy=subjectId&sum=score&studentId=${studentId}`,
  )
  const attendance = await counts(client, 'attendance', `groupBy=status&studentId=${studentId}`)
  return {
    average: grades.total > 0 ? `${Math.round(grades.sum / grades.total)}/100` : '—',
    absence: `${tr(countOf(attendance, 'absent'))} gün`,
  }
}

test.describe('Genel Bakış: veli', () => {
  test('çocuk değişince not ortalaması ve devamsızlık seçili çocuğa göre değişir', async ({
    page,
    loginAs,
    api,
  }) => {
    const parent = await api('veli')
    const children = await students(parent)
    const deniz = children.find((row) => row.record.name === 'Deniz Yılmaz')
    const ece = children.find((row) => row.record.name === 'Ece Yılmaz')
    expect(deniz && ece, 'veli iki çocuk').toBeTruthy()
    if (!deniz || !ece) return
    const first = await childSummary(parent, deniz.id)
    const second = await childSummary(parent, ece.id)
    expect(first, 'iki çocuğun özeti ayrışır').not.toEqual(second)

    await loginAs('veli')
    await openDashboard(page, 'veli', `?cocuk=${deniz.id}`)
    await expect(page.getByLabel('Çocuk seç')).toHaveValue(deniz.id)
    await expect(page.getByRole('region', { name: 'Deniz Yılmaz özeti' })).toBeVisible()
    await expect.poll(() => cardValue(page, 'Genel not ortalaması').innerText()).toBe(first.average)
    await expect.poll(() => cardValue(page, 'Devamsızlık').innerText()).toBe(first.absence)

    await page.getByLabel('Çocuk seç').selectOption({ label: 'Ece Yılmaz' })
    await expect(page).toHaveURL(new RegExp(`[?&]cocuk=${ece.id}`))
    await expect(page.getByRole('region', { name: 'Ece Yılmaz özeti' })).toBeVisible()
    await expect
      .poll(() => cardValue(page, 'Genel not ortalaması').innerText())
      .toBe(second.average)
    await expect.poll(() => cardValue(page, 'Devamsızlık').innerText()).toBe(second.absence)

    // Veli çocuğunun bakiyesini görür.
    await expect(card(page, 'Güncel bakiye')).toBeVisible()
  })
})

test.describe('Genel Bakış: öğrenci', () => {
  test('ödeme bilgisi gösterilmez ve ödeme isteği atılmaz', async ({ page, loginAs }) => {
    const invoiceRequests: string[] = []
    page.on('request', (request) => {
      if (/\/collections\/invoices/.test(request.url())) invoiceRequests.push(request.url())
    })
    await loginAs('ogrenci')
    await openDashboard(page, 'ogrenci')
    await expectCardsLoaded(page)

    await expect(card(page, 'Güncel bakiye')).toHaveCount(0)
    await expect(card(page, 'Bekleyen tahsilat')).toHaveCount(0)
    await expect(page.getByText('₺')).toHaveCount(0)
    expect(invoiceRequests, 'öğrenci için taksit isteği atılmamalı').toEqual([])
  })

  test('haftalık devamsızlık grafiği gerçek yoklama kayıtlarına bağlıdır', async ({
    page,
    loginAs,
    api,
  }) => {
    const student = await api('ogrenci')
    const own = (await students(student))[0]
    expect(own, 'öğrenci kendi kaydını görür').toBeTruthy()
    const monday = mondayOf(istanbulDay())
    const window = `dateFrom=${shiftDay(monday, -49)}&dateTo=${shiftDay(monday, 6)}`
    const absent = countOf(
      await counts(student, 'attendance', `groupBy=status&studentId=${own?.id}&${window}`),
      'absent',
    )

    await loginAs('ogrenci')
    await openDashboard(page, 'ogrenci')
    const trend = page.getByRole('region', { name: 'Haftalık devamsızlık' })
    await expect(trend).toBeVisible()
    if (absent > 0) {
      await expect(trend.getByText(`Son 8 haftada toplam ${absent} gün devamsızlık.`)).toBeVisible()
      await expect(trend.locator('.trend-bars svg')).toHaveCount(1)
      // Grafik görsel destektir: ekran okuyucudan gizli, bilgi metin özetindedir.
      await expect(trend.locator('.trend-bars')).toHaveAttribute('aria-hidden', 'true')
    } else {
      await expect(trend.getByText('Son 8 haftada devamsızlık kaydı yok.')).toBeVisible()
      await expect(trend.locator('.trend-bars')).toHaveCount(0)
    }
  })
})

test.describe('Genel Bakış: dar ekran', () => {
  for (const role of roles) {
    test(`${role}: 390 px genişlikte yatay taşma olmaz`, async ({ page, loginAs }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await loginAs(role)
      await openDashboard(page, role)
      await expectCardsLoaded(page)
      await expectNoHorizontalOverflow(page)
    })
  }
})
