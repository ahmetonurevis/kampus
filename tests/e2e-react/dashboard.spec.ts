import { randomUUID } from 'node:crypto'

import type { Locator, Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { accounts, roles, type RoleKey } from './support/env.ts'
import { expect, test } from './support/fixtures.ts'
import { expectContentInsideCards, expectNoHorizontalOverflow } from './support/ui.ts'

// Genel Bakış (dashboard): beş rolün ekranı, sayaçların sunucu sayımıyla eşleşmesi, velide çocuk
// değişince özetin değişmesi, öğrencide ödeme bilgisinin ve isteğinin bulunmaması, 390 px'te
// taşma olmaması ve öğrenci grafiğinin gerçek yoklama kayıtlarına bağlılığı. Ders programı, son
// quiz ve SLA ihlali kartları (OG-978) API'den bağımsız hesaplanan değerlerle eşleşir; yalnız
// modül kapama testi kendi kurumuna (`tenant`) yazar, diğerleri kayıt yazmaz. Beklenen değerler API sayım ucundan okunur (ekranın kullandığı sorguyla aynı kapsam,
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

  test('IST-116: ön büro "Yeni talep" sayısı Şikayet & Talepler ?durum=Yeni toplamıdır', async ({
    page,
    loginAs,
    api,
  }) => {
    const desk = await api('onburo')
    const list = await desk.get(
      `/api/v1/collections/requests?pageSize=1&status=${encodeURIComponent('Yeni')}`,
    )
    expect(list.status).toBe(200)
    const total = (list.body as { meta: { total: number } }).meta.total
    expect(total, 'örnek veride yeni talep var').toBeGreaterThan(0)

    await loginAs('onburo')
    await openDashboard(page, 'onburo')
    await expect.poll(() => cardValue(page, 'Yeni talep').innerText()).toBe(tr(total))
    await card(page, 'Yeni talep').getByRole('link', { name: 'Yeni talep' }).click()
    await expect(page).toHaveURL(/\/onburo\/talepler\?durum=Yeni$/)
    await expect(page.getByLabel('Talep durumu')).toHaveValue('Yeni')
    await expect(page.locator('.result-count')).toContainText(`/ ${total} kayıt`)
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

/** Ayın ilk günü, `back` ay önce (`YYYY-MM-DD`). */
const monthStart = (day: string, back: number) => {
  const [year, month] = day.split('-').map(Number)
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1 - back, 1)).toISOString().slice(0, 10)
}

test.describe('Genel Bakış: API okuma süzgeçleri', () => {
  test('yönetici: bugünkü tahsilat paidAt günü, aylık tahsilat paidAt:month sayımıdır', async ({
    page,
    loginAs,
    api,
  }) => {
    const admin = await api('yonetici')
    const today = istanbulDay()
    const paidToday = await counts(
      admin,
      'invoices',
      `groupBy=status&sum=amount&dateField=paidAt&dateFrom=${today}&dateTo=${today}`,
    )
    const monthly = await counts(
      admin,
      'invoices',
      `groupBy=paidAt:month&sum=amount&dateField=paidAt&dateFrom=${monthStart(today, 5)}&dateTo=${today}`,
    )

    await loginAs('yonetici')
    await openDashboard(page, 'yonetici')
    await expect
      .poll(async () => cents(await cardValue(page, 'Bugünkü tahsilat').innerText()))
      .toBe(sumOf(paidToday, 'Ödendi'))

    const trend = page.getByRole('region', { name: 'Aylık tahsilat' })
    await expect(trend).toBeVisible()
    if (monthly.total === 0) {
      await expect(trend.getByText('Son 6 ayda tahsilat kaydı yok.')).toBeVisible()
    } else {
      await expect(trend.getByText(`Son 6 ayda ${tr(monthly.total)} taksitte toplam`)).toBeVisible()
      await expect
        .poll(async () => cents((await trend.innerText()).match(MONEY)?.[0] ?? ''))
        .toBe(monthly.sum)
      await expect(trend.locator('.trend-bars')).toHaveAttribute('aria-hidden', 'true')
    }
  })

  test('ön büro: bugünkü tahsilat paidAt günü süzgecinden gelir', async ({
    page,
    loginAs,
    api,
  }) => {
    const desk = await api('onburo')
    const today = istanbulDay()
    const paidToday = await counts(
      desk,
      'invoices',
      `groupBy=status&sum=amount&dateField=paidAt&dateFrom=${today}&dateTo=${today}`,
    )
    await loginAs('onburo')
    await openDashboard(page, 'onburo')
    await expect
      .poll(async () => cents(await cardValue(page, 'Bugünkü tahsilat').innerText()))
      .toBe(sumOf(paidToday, 'Ödendi'))
    await expect(card(page, 'Bugünkü tahsilat')).toContainText(
      `${tr(countOf(paidToday, 'Ödendi'))} taksit bugün ödendi`,
    )
  })

  test('öğretmen: notlanmamış teslim graded=false, bugünkü ders cancelled=false sayımıdır', async ({
    page,
    loginAs,
    api,
  }) => {
    const teacher = await api('ogretmen')
    const today = istanbulDay()
    const ungraded = await counts(teacher, 'submissions', 'groupBy=homeworkId&graded=false')
    const self = await teacher.get('/api/v1/collections/teachers')
    const teacherId = (self.body as { data: { id: string }[] }).data[0]?.id ?? ''
    const lessons = await teacher.get(
      `/api/v1/collections/schedule?teacherId=${teacherId}&dateFrom=${today}&dateTo=${today}&cancelled=false&pageSize=1`,
    )
    expect(lessons.status).toBe(200)
    const lessonTotal = (lessons.body as { meta: { total: number } }).meta.total

    await loginAs('ogretmen')
    await openDashboard(page, 'ogretmen')
    await expect
      .poll(() => cardValue(page, 'Notlanmamış teslim').innerText())
      .toBe(tr(ungraded.total))
    // İptal edilen ders listeye ve sayıya girmez; açıklama sunucu toplamını söyler.
    await expect(
      page.getByRole('region', { name: 'Bugünkü derslerim' }).getByText(`${lessonTotal} ders`),
    ).toBeVisible()
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

// --- Ders programı, son quiz ve SLA ihlali kartları (OG-978) ------------------------------------

type LessonRow = {
  id: string
  date: string
  title: string | null
  subjectId: string
  teacherId: string
  originalTeacherId: string | null
  room: string
  duration: number
  status: string
}
type QuizRow = {
  id: string
  title: string
  subject: string
  attempts: {
    studentId: string
    status: string
    submittedAt: string | null
    result: { score: number; correctCount: number; total: number } | null
  }[]
}

const istanbulTime = (iso: string) =>
  new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))

async function todaysLessons(client: ApiClient, classId?: string): Promise<LessonRow[]> {
  const today = istanbulDay()
  const filter = classId ? `&classId=${classId}` : ''
  const result = await client.get(
    `/api/v1/lessons?dateFrom=${today}&dateTo=${today}&pageSize=100${filter}`,
  )
  expect(result.status, 'bugünkü dersler').toBe(200)
  return (result.body as { data: LessonRow[] }).data
}

/** Seçili öğrencinin en son tamamlanan quiz denemesi (API'den, ekranın hesabından ayrı). */
async function latestAttempt(client: ApiClient, studentId: string, classId: string) {
  const result = await client.get(`/api/v1/quizzes?classId=${classId}&pageSize=100`)
  expect(result.status, 'quiz listesi').toBe(200)
  const rows = (result.body as { data: QuizRow[] }).data
  const done = rows.flatMap((quiz) =>
    quiz.attempts
      .filter(
        (attempt) =>
          attempt.studentId === studentId && attempt.status === 'completed' && attempt.result,
      )
      .map((attempt) => ({ quiz, attempt })),
  )
  done.sort(
    (a, b) => Date.parse(b.attempt.submittedAt ?? '') - Date.parse(a.attempt.submittedAt ?? ''),
  )
  return done[0]
}

async function setModule(admin: ApiClient, moduleKey: string, enabled: boolean) {
  const settings = await admin.get('/api/v1/modules')
  expect(settings.status).toBe(200)
  const { version } = (settings.body as { data: { version: number } }).data
  const response = await admin.context.patch(`/api/v1/modules/${moduleKey}`, {
    data: { enabled },
    headers: { 'if-match': `"${version}"`, 'idempotency-key': randomUUID() },
  })
  expect(response.status()).toBe(200)
}

const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true })

async function expectScheduleCard(page: Page, lessons: readonly LessonRow[]) {
  const schedule = region(page, 'Bugünkü ders programı')
  await expect(schedule).toBeVisible()
  if (lessons.length === 0) {
    await expect(schedule.getByText('Bugün dersin yok.')).toBeVisible()
    return
  }
  const sorted = lessons.toSorted((a, b) => a.date.localeCompare(b.date))
  const items = schedule.getByRole('list', { name: 'Bugünkü ders programı' }).getByRole('listitem')
  await expect(items).toHaveCount(sorted.length)
  for (const [index, lesson] of sorted.entries())
    await expect(items.nth(index).locator('time')).toHaveText(istanbulTime(lesson.date))
}

async function expectQuizCard(page: Page, latest: Awaited<ReturnType<typeof latestAttempt>>) {
  const quiz = region(page, 'Son quiz sonucu')
  await expect(quiz).toBeVisible()
  if (!latest) {
    await expect(quiz.getByText('Henüz tamamlanmış quiz yok.')).toBeVisible()
    return
  }
  const result = latest.attempt.result
  await expect(quiz.getByRole('link', { name: latest.quiz.title, exact: true })).toBeVisible()
  await expect(quiz).toContainText(`%${result?.score}`)
  await expect(quiz).toContainText(`${result?.correctCount}/${result?.total} doğru`)
}

test.describe('Genel Bakış: ders programı ve son quiz kartları', () => {
  test('öğrenci: bugünkü ders programı API ile, iptal ders görünmeden eşleşir', async ({
    page,
    loginAs,
    api,
  }) => {
    const student = await api('ogrenci')
    const lessons = await todaysLessons(student)
    await loginAs('ogrenci')
    await openDashboard(page, 'ogrenci')
    await expectCardsLoaded(page)
    await expectScheduleCard(page, lessons)
    await expect(region(page, 'Bugünkü ders programı').getByRole('link')).toHaveAttribute(
      'href',
      '/ogrenci/ders-programi',
    )
  })

  test('öğrenci: bugünkü ders satırı saat, ders, öğretmen ve derslik gösterir; iptal ders girmez', async ({
    page,
    loginAs,
    api,
  }) => {
    const student = await api('ogrenci')
    const today = istanbulDay()
    const teachers = await student.get('/api/v1/collections/teachers')
    const teacher = (teachers.body as { data: { id: string; record: { name: string } }[] }).data[0]
    expect(teacher, 'öğrenci sınıfının öğretmenini görür').toBeTruthy()
    const base = {
      version: 1,
      classId: 'c1',
      subjectId: 'math',
      title: null,
      teacherId: teacher?.id ?? '',
      originalTeacherId: null,
      duration: 40,
      cancelledAt: null,
      updatedAt: `${today}T05:00:00Z`,
    }
    // Sunucu yanıtı: bugün 10:30 (07:30Z) ve 09:00 (06:00Z) dersleri, bir iptal ders ve yarının dersi.
    await page.route(/\/api\/v1\/lessons\?/, async (route) => {
      const response = await route.fetch()
      const body = (await response.json()) as { data: unknown[]; meta: Record<string, unknown> }
      const data = [
        { ...base, id: 'l-gec', date: `${today}T07:30:00Z`, room: '21', status: 'planned' },
        { ...base, id: 'l-erken', date: `${today}T06:00:00Z`, room: '14', status: 'planned' },
        { ...base, id: 'l-iptal', date: `${today}T08:30:00Z`, room: '9', status: 'cancelled' },
        {
          ...base,
          id: 'l-yarin',
          date: `${shiftDay(today, 1)}T06:00:00Z`,
          room: '5',
          status: 'planned',
        },
      ]
      await route.fulfill({
        status: response.status(),
        json: { ...body, data, meta: { ...body.meta, total: data.length } },
      })
    })
    await loginAs('ogrenci')
    await openDashboard(page, 'ogrenci')
    const items = region(page, 'Bugünkü ders programı').getByRole('listitem')
    await expect(items).toHaveCount(2)
    await expect(items.nth(0)).toContainText('09:00')
    await expect(items.nth(0)).toContainText('Matematik')
    await expect(items.nth(0)).toContainText(`${teacher?.record.name} · Derslik 14 · 40 dk`)
    await expect(items.nth(1)).toContainText('10:30')
    await expect(items.nth(1)).toContainText('Derslik 21')
    await expect(region(page, 'Bugünkü ders programı')).not.toContainText('Derslik 9')
    await expect(region(page, 'Bugünkü ders programı')).toContainText('2 ders')
  })

  test('öğrenci: son quiz sonucu API ile eşleşir ve sonuç paneline bağlanır', async ({
    page,
    loginAs,
    api,
  }) => {
    const student = await api('ogrenci')
    const own = (await students(student))[0]
    expect(own, 'öğrenci kendi kaydını görür').toBeTruthy()
    const latest = await latestAttempt(student, own?.id ?? '', own?.record.classId ?? '')
    await loginAs('ogrenci')
    await openDashboard(page, 'ogrenci')
    await expectCardsLoaded(page)
    await expectQuizCard(page, latest)
    if (!latest) return
    await region(page, 'Son quiz sonucu').getByRole('link', { name: latest.quiz.title }).click()
    await expect(page).toHaveURL(new RegExp(`/ogrenci/soru-coz\\?quiz=${latest.quiz.id}$`))
    await expect(page.getByRole('dialog', { name: 'Quiz sonucu' })).toContainText(latest.quiz.title)
  })

  test('veli: iki çocuğun programı ve son quizi seçili çocuğa göre değişir', async ({
    page,
    loginAs,
    api,
  }) => {
    const parent = await api('veli')
    const children = await students(parent)
    const expected = await Promise.all(
      ['Deniz Yılmaz', 'Ece Yılmaz'].map(async (name) => {
        const child = children.find((row) => row.record.name === name)
        expect(child, `${name} velinin çocuğu`).toBeTruthy()
        const classId = child?.record.classId ?? ''
        return {
          name,
          id: child?.id ?? '',
          lessons: await todaysLessons(parent, classId),
          latest: await latestAttempt(parent, child?.id ?? '', classId),
        }
      }),
    )
    await loginAs('veli')
    for (const child of expected) {
      await openDashboard(page, 'veli', `?cocuk=${child.id}`)
      await expect(page.getByRole('region', { name: `${child.name} özeti` })).toBeVisible()
      await expectScheduleCard(page, child.lessons)
      await expectQuizCard(page, child.latest)
    }
    // Çocuk seçici dashboard'dan değişince kartlar yeni çocuğa göre yenilenir.
    const [first, second] = expected
    await openDashboard(page, 'veli', `?cocuk=${first?.id}`)
    await page.getByLabel('Çocuk seç').selectOption({ label: second?.name ?? '' })
    await expect(page.getByRole('region', { name: `${second?.name} özeti` })).toBeVisible()
    await expectScheduleCard(page, second?.lessons ?? [])
    await expectQuizCard(page, second?.latest)
    // Bağlantılar seçili çocukla Akademik Takip sekmelerini açar.
    await expect(region(page, 'Bugünkü ders programı').getByRole('link')).toHaveAttribute(
      'href',
      new RegExp(`/veli/akademik-takip\\?cocuk=${second?.id}&sekme=program$`),
    )
    await expect(region(page, 'Son quiz sonucu').getByRole('link').first()).toHaveAttribute(
      'href',
      new RegExp(`/veli/akademik-takip\\?cocuk=${second?.id}&sekme=quizler`),
    )
  })

  test('öğretmen ve ön büro Genel Bakışında bu kartlar yoktur', async ({ page, loginAs }) => {
    for (const role of ['ogretmen', 'onburo'] as const) {
      await loginAs(role)
      await openDashboard(page, role)
      await expectCardsLoaded(page)
      await expect(region(page, 'Son quiz sonucu')).toHaveCount(0)
      await expect(region(page, 'Bugünkü ders programı')).toHaveCount(0)
      await expect(card(page, 'SLA ihlali')).toHaveCount(0)
    }
  })

  test('modül kapalıyken kart çizilmez: ders programı academic, quiz ve SLA learning modülüne bağlıdır', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogrenci'] })
    const admin = await api(school.user('yonetici'))
    await loginAs(school.user('ogrenci'))
    await openDashboard(page, 'ogrenci')
    await expectCardsLoaded(page)
    // Kurumda ders ve quiz kaydı yok: iki kart da sakin boş durumunu gösterir.
    await expect(region(page, 'Bugünkü ders programı').getByText('Bugün dersin yok.')).toBeVisible()
    await expect(
      region(page, 'Son quiz sonucu').getByText('Henüz tamamlanmış quiz yok.'),
    ).toBeVisible()

    await setModule(admin, 'learning', false)
    await openDashboard(page, 'ogrenci')
    await expect(region(page, 'Bugünkü ders programı')).toBeVisible()
    await expect(region(page, 'Son quiz sonucu')).toHaveCount(0)

    await setModule(admin, 'learning', true)
    await setModule(admin, 'academic', false)
    await openDashboard(page, 'ogrenci')
    await expect(region(page, 'Son quiz sonucu')).toBeVisible()
    await expect(region(page, 'Bugünkü ders programı')).toHaveCount(0)
    await setModule(admin, 'academic', true)

    await loginAs(school.user('yonetici'))
    await openDashboard(page, 'yonetici')
    await expect(card(page, 'SLA ihlali')).toBeVisible()
    await setModule(admin, 'learning', false)
    await openDashboard(page, 'yonetici')
    await expectCardsLoaded(page)
    await expect(card(page, 'SLA ihlali')).toHaveCount(0)
    await setModule(admin, 'learning', true)
  })

  test('yönetici: SLA ihlali sayacı SLA Raporu "Süre aşımı" toplamıyla aynıdır ve rapora bağlanır', async ({
    page,
    loginAs,
  }) => {
    await loginAs('yonetici')
    await openDashboard(page, 'yonetici')
    await expectCardsLoaded(page)
    const sla = card(page, 'SLA ihlali')
    await expect(sla).toBeVisible()
    const value = await cardValue(page, 'SLA ihlali').innerText()
    expect(value).toMatch(/^\d+$/)

    await sla.getByRole('link', { name: 'SLA ihlali' }).click()
    await expect(page).toHaveURL(/\/yonetici\/sla-raporu$/)
    const breaches = page
      .locator('dl[aria-label="SLA özeti"] .stat-item')
      .filter({ hasText: 'Süre aşımı' })
    await expect(breaches.locator('.stat-value')).toHaveText(value)
  })
})

// --- Haberler, yanıt bekleyen sorular ve not eğilimi (OG-226) -----------------------------------

type ApiRow<T> = { id: string; record: T }
type NewsRecord = { title?: string; withdrawnAt?: string }
type QuestionRecord = { answeredAt: string | null; withdrawnAt?: string | null }
type GradeRecord = { date?: string; score: number; subjectId: string }

/** Koleksiyonun bütün satırları (ekranın hesabından ayrı, 100'lük sayfalarla). */
async function allRows<T>(client: ApiClient, collection: string, query = ''): Promise<ApiRow<T>[]> {
  const rows: ApiRow<T>[] = []
  for (let pageNumber = 1; ; pageNumber += 1) {
    const result = await client.get(
      `/api/v1/collections/${collection}?pageSize=100&page=${pageNumber}${query}`,
    )
    expect(result.status, `${collection} listesi`).toBe(200)
    const body = result.body as { data: ApiRow<T>[]; meta: { total: number } }
    rows.push(...body.data)
    if (body.data.length === 0 || rows.length >= body.meta.total) return rows
  }
}

/** Ekranın göstermesi gereken haber başlıkları: rolün ilk üç yayımlanmış (geri çekilmemiş) duyurusu. */
async function expectedNews(client: ApiClient): Promise<string[]> {
  const result = await client.get('/api/v1/collections/announcements?sort=-date&pageSize=10')
  expect(result.status, 'duyuru listesi').toBe(200)
  return (result.body as { data: ApiRow<NewsRecord>[] }).data
    .filter((row) => !row.record.withdrawnAt)
    .slice(0, 3)
    .map((row) => row.record.title ?? '')
}

const newsTitles = (page: Page) =>
  region(page, 'Kampüsten haberler')
    .getByRole('list', { name: 'Kampüsten haberler' })
    .getByRole('listitem')
    .getByRole('link')

/** Aylık not ortalamaları (Europe/Istanbul ayı), eskiden yeniye; ekranın sayım ucundan bağımsız. */
function monthlyAverages(grades: readonly ApiRow<GradeRecord>[]) {
  const months = new Map<string, number[]>()
  for (const { record } of grades) {
    if (!record.date) continue
    const month = istanbulDay(new Date(record.date)).slice(0, 7)
    months.set(month, [...(months.get(month) ?? []), record.score])
  }
  return [...months]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([month, scores]) => ({
      month,
      value: Math.round(scores.reduce((total, score) => total + score, 0) / scores.length),
    }))
}

test.describe('Genel Bakış: haberler, yanıt bekleyen sorular ve not eğilimi', () => {
  for (const role of roles) {
    test(`${role}: Kampüsten haberler rolün son duyurularını gösterir ve Duyurular'a bağlanır`, async ({
      page,
      loginAs,
      api,
    }) => {
      const expected = await expectedNews(await api(role))
      await loginAs(role)
      await openDashboard(page, role)
      await expectCardsLoaded(page)
      const news = region(page, 'Kampüsten haberler')
      await expect(news).toBeVisible()
      if (expected.length === 0) {
        await expect(news.getByText('Yayında duyuru yok.')).toBeVisible()
      } else {
        await expect(newsTitles(page)).toHaveText(expected)
        await expect(newsTitles(page).first()).toHaveAttribute(
          'href',
          new RegExp(`/${role}/duyurular\\?duyuru=`),
        )
      }
      await expect(news.getByRole('link', { name: 'Duyuruları aç' })).toHaveAttribute(
        'href',
        `/${role}/duyurular`,
      )
    })
  }

  test('haber başlığı duyuruyu sağ panelde açar', async ({ page, loginAs, api }) => {
    const [first] = await expectedNews(await api('ogrenci'))
    expect(first, 'öğrencinin en az bir duyurusu var').toBeTruthy()
    await loginAs('ogrenci')
    await openDashboard(page, 'ogrenci')
    await newsTitles(page).first().click()
    await expect(page).toHaveURL(/\/ogrenci\/duyurular\?duyuru=/)
    await expect(page.getByRole('dialog', { name: 'Duyuru' })).toContainText(first ?? '')
  })

  test('DOM-ILT-001: hedef kitle sunucuda süzülür: veli yalnız kendine hedeflenen duyuruyu görür', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogrenci', 'veli', 'ogretmen'] })
    const admin = await api(school.user('yonetici'))
    const publish = async (title: string, roles: readonly string[]) => {
      const response = await admin.context.fetch('/api/v1/announcements', {
        method: 'POST',
        data: {
          title,
          text: 'Hedef kitle sınaması için yayınlandı.',
          category: 'Bilgilendirme',
          target: { roles },
        },
        headers: { 'idempotency-key': randomUUID() },
        failOnStatusCode: false,
      })
      expect([200, 201], await response.text()).toContain(response.status())
    }
    await publish('Velilere özel toplantı', ['veli'])
    await publish('Öğrencilere özel etkinlik', ['ogrenci'])

    await loginAs(school.user('veli'))
    await openDashboard(page, 'veli')
    await expect(newsTitles(page)).toHaveText(['Velilere özel toplantı'])
    await loginAs(school.user('ogrenci'))
    await openDashboard(page, 'ogrenci')
    await expect(newsTitles(page)).toHaveText(['Öğrencilere özel etkinlik'])
    await loginAs(school.user('ogretmen'))
    await openDashboard(page, 'ogretmen')
    await expect(region(page, 'Kampüsten haberler').getByText('Yayında duyuru yok.')).toBeVisible()
    await loginAs(school.user('yonetici'))
    await openDashboard(page, 'yonetici')
    await expect(newsTitles(page)).toHaveText([
      'Öğrencilere özel etkinlik',
      'Velilere özel toplantı',
    ])
  })

  test('öğretmen: yanıt bekleyen soru sayacı ve listesi kendi kuyruğuyla eşleşir', async ({
    page,
    loginAs,
    api,
  }) => {
    const teacher = await api('ogretmen')
    const open = (await allRows<QuestionRecord>(teacher, 'questions')).filter(
      (row) => !row.record.answeredAt && !row.record.withdrawnAt,
    )
    expect(open.length, 'Selin Kaya yanıt bekleyen soruya sahip').toBeGreaterThan(0)
    // Kart sayısı sunucunun durum süzgeçli liste toplamıdır (IST-116).
    const pending = await teacher.get(
      '/api/v1/collections/questions?pageSize=1&answered=false&withdrawn=false',
    )
    expect((pending.body as { meta: { total: number } }).meta.total).toBe(open.length)
    await loginAs('ogretmen')
    await openDashboard(page, 'ogretmen')
    await expectCardsLoaded(page)
    await expect
      .poll(() => cardValue(page, 'Yanıt bekleyen soru').innerText())
      .toBe(tr(open.length))
    const list = region(page, 'Yanıt bekleyen sorular')
    await expect(list.getByRole('listitem')).toHaveCount(Math.min(3, open.length))
    await expect(list.getByRole('link', { name: 'Soru kuyruğunu aç' })).toHaveAttribute(
      'href',
      '/ogretmen/sorular',
    )
    await list.getByRole('listitem').first().getByRole('link').first().click()
    await expect(page).toHaveURL(/\/ogretmen\/sorular\?soru=/)
    await expect(page.getByRole('dialog')).toBeVisible()
  })

  test('öğretmen: soru kartları özetten gelir, soru kayıtları ayrıca çekilmez', async ({
    page,
    loginAs,
  }) => {
    const requests: string[] = []
    page.on('request', (request) => {
      if (/\/collections\/questions/.test(request.url())) requests.push(request.url())
    })
    await loginAs('ogretmen')
    await openDashboard(page, 'ogretmen')
    await expectCardsLoaded(page)
    await expect(region(page, 'Yanıt bekleyen sorular').getByRole('listitem').first()).toBeVisible()
    expect(requests).toEqual([])
  })

  test('öğrenci ve veli: not ortalaması eğilimi aylık ortalamalardan gelir, çocuğa göre değişir', async ({
    page,
    loginAs,
    api,
  }) => {
    const parent = await api('veli')
    const children = await students(parent)
    const summaries: string[] = []
    await loginAs('veli')
    for (const name of ['Deniz Yılmaz', 'Ece Yılmaz']) {
      const child = children.find((row) => row.record.name === name)
      expect(child, `${name} velinin çocuğu`).toBeTruthy()
      const months = monthlyAverages(
        await allRows<GradeRecord>(parent, 'grades', `&studentId=${child?.id}`),
      )
      expect(months.length, `${name} en az iki aylık not`).toBeGreaterThanOrEqual(2)
      await openDashboard(page, 'veli', `?cocuk=${child?.id}`)
      const trend = region(page, 'Not ortalaması eğilimi')
      await expect(trend).toBeVisible()
      await expect(trend.locator('.trend-bars')).toHaveAttribute('aria-hidden', 'true')
      const first = months[0]
      const last = months.at(-1)
      const summary = trend.getByText(/ayında .*En yüksek ay/)
      await expect(summary).toContainText(`ayında ${first?.value},`)
      await expect(summary).toContainText(`ayında ${last?.value} `)
      summaries.push(await summary.innerText())
      await expect(trend.getByRole('link', { name: 'Notları aç' })).toHaveAttribute(
        'href',
        new RegExp(`/veli/akademik-takip\\?cocuk=${child?.id}&sekme=notlar$`),
      )
    }
    expect(summaries[0], 'iki çocuğun özeti farklı').not.toBe(summaries[1])

    const student = await api('ogrenci')
    const own = (await students(student))[0]
    const months = monthlyAverages(
      await allRows<GradeRecord>(student, 'grades', `&studentId=${own?.id}`),
    )
    await loginAs('ogrenci')
    await openDashboard(page, 'ogrenci')
    await expect(region(page, 'Not ortalaması eğilimi')).toContainText(
      `ayında ${months.at(-1)?.value} `,
    )
  })

  test('veli: çocuk değişirken önceki çocuğun not özeti yeni çocuğun başlığı altında görünmez', async ({
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
    await loginAs('veli')
    await openDashboard(page, 'veli', `?cocuk=${deniz.id}`)
    const trend = region(page, 'Not ortalaması eğilimi')
    const summary = trend.getByText(/ayında .*En yüksek ay/)
    await expect(summary).toBeVisible()
    const denizSummary = await summary.innerText()

    // Ece'nin sayımı geciktirilir; bu sürede Deniz'in grafiği ve özeti ekranda kalmamalıdır.
    // (Sayım sorgusu `keepPreviousData` kullanır; kartlar çocuk değişince çoğunlukla yeniden
    // kurulur, koruma `isPlaceholderData` ile ayrıca verilir ve birim testlidir.)
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let heldRequests = 0
    await page.route(/\/collections\/grades\/counts/, async (route) => {
      if (route.request().url().includes(`studentId=${ece.id}`)) {
        heldRequests += 1
        await held
      }
      await route.continue()
    })
    await page.getByLabel('Çocuk seç').selectOption({ label: 'Ece Yılmaz' })
    await expect(page).toHaveURL(new RegExp(`[?&]cocuk=${ece.id}`))
    await expect.poll(() => heldRequests).toBeGreaterThan(0)
    await expect(trend.getByRole('status')).toContainText('Yükleniyor')
    await expect(trend.locator('.trend-bars')).toHaveCount(0)
    await expect(trend.getByText(denizSummary, { exact: true })).toHaveCount(0)

    release()
    await expect(trend.getByText(/ayında .*En yüksek ay/)).not.toHaveText(denizSummary)
    await expect(trend.locator('.trend-bars')).toHaveAttribute('aria-hidden', 'true')
  })

  test('öğretmen: sınıf branş ortalaması eğilimi kendi branşının notlarından hesaplanır', async ({
    page,
    loginAs,
    api,
  }) => {
    const teacher = await api('ogretmen')
    const own = (await allRows<{ subjectId: string }>(teacher, 'teachers'))[0]
    const months = monthlyAverages(
      (await allRows<GradeRecord>(teacher, 'grades')).filter(
        (row) => row.record.subjectId === own?.record.subjectId,
      ),
    )
    expect(months.length, 'öğretmenin branşında en az iki aylık not').toBeGreaterThanOrEqual(2)
    await loginAs('ogretmen')
    await openDashboard(page, 'ogretmen')
    const trend = region(page, 'Sınıf branş ortalaması')
    await expect(trend).toBeVisible()
    await expect(trend).toContainText(`ayında ${months[0]?.value},`)
    await expect(trend).toContainText(`ayında ${months.at(-1)?.value} `)
    await expect(trend.locator('.trend-bars')).toHaveAttribute('aria-hidden', 'true')
  })

  test('öğretmen: branşı kayıtlı değilse branş ortalaması kartı gizlenir ve tüm dersler sayılmaz', async ({
    page,
    loginAs,
  }) => {
    // Öğretmen kaydından branş çıkarılır; süzgeçsiz sayım bütün dersleri "branş ortalaması" yapardı.
    await page.route(/\/collections\/teachers\?/, async (route) => {
      const response = await route.fetch()
      const body = (await response.json()) as { data: { record: Record<string, unknown> }[] }
      const data = body.data.map((row) => {
        const record = { ...row.record }
        delete record.subjectId
        return { ...row, record }
      })
      await route.fulfill({ status: response.status(), json: { ...body, data } })
    })
    const countRequests: string[] = []
    page.on('request', (request) => {
      if (/\/collections\/grades\/counts/.test(request.url())) countRequests.push(request.url())
    })
    await loginAs('ogretmen')
    await openDashboard(page, 'ogretmen')
    await expectCardsLoaded(page)
    await expect(region(page, 'Sınıf branş ortalaması')).toHaveCount(0)
    expect(countRequests, 'not sayımı istenmez').toEqual([])
  })

  test('iki aydan az notta grafik yerine kısa metin gösterilir', async ({ page, loginAs }) => {
    // Sayım ucu tek aylık seri döndürür; gerçek kayıt yazılmaz.
    await page.route(/\/collections\/grades\/counts/, (route) =>
      route.fulfill({
        status: 200,
        json: { data: [{ value: '2026-10', count: 2, sum: 120 }], meta: { total: 2, sum: 120 } },
      }),
    )
    await loginAs('ogrenci')
    await openDashboard(page, 'ogrenci')
    await expectCardsLoaded(page)
    const trend = region(page, 'Not ortalaması eğilimi')
    await expect(trend.getByText('Eğilim için en az 2 ayın notu gerekir.')).toBeVisible()
    await expect(trend.locator('.trend-bars')).toHaveCount(0)
  })

  test('modül kapalıyken bölümler çizilmez: haberler communication, soru learning, eğilim academic', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'ogrenci'] })
    const admin = await api(school.user('yonetici'))
    await loginAs(school.user('ogretmen'))
    await openDashboard(page, 'ogretmen')
    await expectCardsLoaded(page)
    await expect(card(page, 'Yanıt bekleyen soru')).toBeVisible()
    await expect(region(page, 'Yanıt bekleyen sorular')).toBeVisible()
    await expect(region(page, 'Sınıf branş ortalaması')).toBeVisible()
    await expect(region(page, 'Kampüsten haberler')).toBeVisible()

    await setModule(admin, 'learning', false)
    await openDashboard(page, 'ogretmen')
    await expectCardsLoaded(page)
    await expect(card(page, 'Yanıt bekleyen soru')).toHaveCount(0)
    await expect(region(page, 'Yanıt bekleyen sorular')).toHaveCount(0)
    await expect(region(page, 'Sınıf branş ortalaması')).toBeVisible()
    await setModule(admin, 'learning', true)

    await setModule(admin, 'academic', false)
    await openDashboard(page, 'ogretmen')
    await expectCardsLoaded(page)
    await expect(region(page, 'Sınıf branş ortalaması')).toHaveCount(0)
    await expect(region(page, 'Yanıt bekleyen sorular')).toBeVisible()
    await setModule(admin, 'academic', true)

    await setModule(admin, 'communication', false)
    await openDashboard(page, 'ogretmen')
    await expectCardsLoaded(page)
    await expect(region(page, 'Kampüsten haberler')).toHaveCount(0)
    await loginAs(school.user('ogrenci'))
    await openDashboard(page, 'ogrenci')
    await expectCardsLoaded(page)
    await expect(region(page, 'Kampüsten haberler')).toHaveCount(0)
    await expect(region(page, 'Not ortalaması eğilimi')).toBeVisible()
    await setModule(admin, 'academic', false)
    await openDashboard(page, 'ogrenci')
    await expectCardsLoaded(page)
    await expect(region(page, 'Not ortalaması eğilimi')).toHaveCount(0)
    await setModule(admin, 'academic', true)
    await setModule(admin, 'communication', true)
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

  for (const width of [390, 320]) {
    test(`yönetici: ${width} px genişlikte büyük tutar sayaç kartının içinde kalır`, async ({
      page,
      loginAs,
    }) => {
      await page.setViewportSize({ width, height: 844 })
      await loginAs('yonetici')
      // Taksit tutarları ×1000: "27.540.000.000,00 ₺" düzeyinde en kötü durum.
      // Tutarlar tek özet ucundan gelir (`GET /dashboard`); finans bölümünün her tutarı ×1000.
      await page.route(/\/api\/v1\/dashboard(\?|$)/, async (route) => {
        const response = await route.fetch()
        const body = (await response.json()) as { data: { finance: unknown } }
        const scale = (node: unknown): void => {
          if (Array.isArray(node)) return node.forEach(scale)
          if (node === null || typeof node !== 'object') return
          const record = node as Record<string, unknown>
          for (const [key, value] of Object.entries(record)) {
            if (key === 'amount' && typeof value === 'number') record[key] = value * 1000
            else scale(value)
          }
        }
        scale(body.data.finance)
        // Gerçek yanıtın başlıkları (içerik uzunluğu, sıkıştırma) değişen gövdeyle uyuşmaz.
        await route.fulfill({ status: response.status(), json: body })
      })
      await openDashboard(page, 'yonetici')
      const cards = page.locator('.stat-card')
      await expect(cards.filter({ hasText: '27.540.000.000,00' })).toHaveCount(1)
      await expectContentInsideCards(cards)
      await expectNoHorizontalOverflow(page)
    })
  }
})

// Şube süzgeci, tahsilat dönemi ve sayaç mini grafikleri (OG-225). Beklenen değerler API sayım
// ucundan, seçili kampüsün sınıflarıyla ayrıca hesaplanır; sabit bekleme yok.
test.describe('Genel Bakış: şube süzgeci, dönem seçici ve mini grafikler', () => {
  const classQuery = (ids: readonly string[]) => ids.map((id) => `classId=${id}`).join('&')

  async function classesOf(client: ApiClient, branchId: string): Promise<string[]> {
    const rows = await allRows<{ branchId?: string }>(client, 'classes', `&branchId=${branchId}`)
    return rows.map((row) => row.id)
  }

  for (const role of ['yonetici', 'onburo'] as const) {
    test(`${role}: "Şube filtresi" kartları seçili kampüse daraltır ve adreste kalır`, async ({
      page,
      loginAs,
      api,
    }) => {
      const client = await api(role)
      const branches = await allRows<{ name: string }>(client, 'branches')
      const second = branches.find((row) => row.id === 'b2')
      expect(second, 'ikinci kampüs').toBeTruthy()
      const ids = await classesOf(client, 'b2')
      expect(ids.length).toBeGreaterThan(0)
      const invoices = await counts(
        client,
        'invoices',
        `groupBy=status&sum=amount&${classQuery(ids)}`,
      )
      const allInvoices = await counts(client, 'invoices', 'groupBy=status&sum=amount')
      expect(invoices.total, 'kampüs taksitleri kurumdan azdır').toBeLessThan(allInvoices.total)

      await loginAs(role)
      await openDashboard(page, role)
      const filter = page.getByRole('combobox', { name: 'Şube filtresi' })
      await expect(filter).toHaveValue('')
      await expect(filter.getByRole('option', { name: 'Tüm kampüsler' })).toBeAttached()
      await expect(filter.getByRole('option', { name: second?.record.name ?? '' })).toBeAttached()
      await expectCardsLoaded(page)

      await filter.selectOption({ label: second?.record.name ?? '' })
      await expect(page).toHaveURL(/[?&]sube=b2(&|$)/)
      if (role === 'yonetici') {
        const students = await counts(client, 'students', `groupBy=isActive&${classQuery(ids)}`)
        await expect
          .poll(() => cardValue(page, 'Aktif öğrenci').innerText())
          .toBe(tr(countOf(students, true)))
        const campuses = page
          .getByRole('list', { name: 'Kampüs dolulukları' })
          .getByRole('listitem')
        await expect(campuses).toHaveCount(1)
        await expect(campuses.first()).toContainText(second?.record.name ?? '')
        await expect
          .poll(async () => cents(await cardValue(page, 'Bekleyen tahsilat').innerText()))
          .toBe(sumOf(invoices, 'Gecikmiş') + sumOf(invoices, 'Yaklaşan'))
      } else {
        await expect
          .poll(() => cardValue(page, 'Gecikmiş taksit').innerText())
          .toBe(tr(countOf(invoices, 'Gecikmiş')))
        await expect
          .poll(async () =>
            cents((await card(page, 'Gecikmiş taksit').innerText()).match(MONEY)?.[0] ?? ''),
          )
          .toBe(sumOf(invoices, 'Gecikmiş'))
      }

      // Yeniden yükleme ve geri dönüş: seçim adreste korunur, "Tüm kampüsler" süzgeci kaldırır.
      await page.reload()
      await expect(filter).toHaveValue('b2')
      await filter.selectOption('')
      await expect(page).not.toHaveURL(/sube=/)
      if (role === 'yonetici') {
        const everyone = await counts(client, 'students', 'groupBy=isActive')
        await expect
          .poll(() => cardValue(page, 'Aktif öğrenci').innerText())
          .toBe(tr(countOf(everyone, true)))
      }
    })
  }

  test('bilinmeyen kampüs adreste tüm kampüsler sayılır', async ({ page, loginAs, api }) => {
    const admin = await api('yonetici')
    const everyone = await counts(admin, 'students', 'groupBy=isActive')
    await loginAs('yonetici')
    await openDashboard(page, 'yonetici', '?sube=yok-boyle-kampus')
    await expect(page.getByRole('combobox', { name: 'Şube filtresi' })).toHaveValue('')
    await expect
      .poll(() => cardValue(page, 'Aktif öğrenci').innerText())
      .toBe(tr(countOf(everyone, true)))
  })

  for (const role of ['ogretmen', 'ogrenci', 'veli'] as const) {
    test(`${role}: şube filtresi görünmez`, async ({ page, loginAs }) => {
      await loginAs(role)
      await openDashboard(page, role)
      await expectCardsLoaded(page)
      await expect(page.getByRole('combobox', { name: 'Şube filtresi' })).toHaveCount(0)
    })
  }

  test('yönetici: tahsilat grafiğinde dönem seçici son 6 ve 12 ayı gösterir, adreste kalır', async ({
    page,
    loginAs,
    api,
  }) => {
    const admin = await api('yonetici')
    const today = istanbulDay()
    const year = await counts(
      admin,
      'invoices',
      `groupBy=paidAt:month&sum=amount&dateField=paidAt&dateFrom=${monthStart(today, 11)}&dateTo=${today}`,
    )
    const half = await counts(
      admin,
      'invoices',
      `groupBy=paidAt:month&sum=amount&dateField=paidAt&dateFrom=${monthStart(today, 5)}&dateTo=${today}`,
    )
    await loginAs('yonetici')
    await openDashboard(page, 'yonetici')
    const trend = page.getByRole('region', { name: 'Aylık tahsilat' })
    const period = trend.getByRole('combobox', { name: 'Grafik dönemi' })
    await expect(period).toHaveValue('6')
    await expect(trend.getByText('Son 6 ay, ödeme tarihine göre')).toBeVisible()
    if (half.total > 0) {
      await expect(trend.getByText(`Son 6 ayda ${tr(half.total)} taksitte toplam`)).toBeVisible()
    }

    await period.selectOption('12')
    await expect(page).toHaveURL(/[?&]donem=12(&|$)/)
    await expect(trend.getByText('Son 12 ay, ödeme tarihine göre')).toBeVisible()
    if (year.total === 0) {
      await expect(trend.getByText('Son 12 ayda tahsilat kaydı yok.')).toBeVisible()
    } else {
      await expect(trend.getByText(`Son 12 ayda ${tr(year.total)} taksitte toplam`)).toBeVisible()
      await expect
        .poll(async () => cents((await trend.innerText()).match(MONEY)?.[0] ?? ''))
        .toBe(year.sum)
    }

    await page.reload()
    await expect(period).toHaveValue('12')
    await period.selectOption('6')
    await expect(page).not.toHaveURL(/donem=/)
    await expect(trend.getByText('Son 6 ay, ödeme tarihine göre')).toBeVisible()
  })

  test('yönetici: "Bu ay tahsilat" bu ayın tahsilatıdır, mini grafik son 6 ayın gerçek verisidir', async ({
    page,
    loginAs,
    api,
  }) => {
    const admin = await api('yonetici')
    const today = istanbulDay()
    const thisMonth = await counts(
      admin,
      'invoices',
      `groupBy=paidAt:month&sum=amount&dateField=paidAt&dateFrom=${monthStart(today, 0)}&dateTo=${today}`,
    )
    const half = await counts(
      admin,
      'invoices',
      `groupBy=paidAt:month&sum=amount&dateField=paidAt&dateFrom=${monthStart(today, 5)}&dateTo=${today}`,
    )
    await loginAs('yonetici')
    await openDashboard(page, 'yonetici')
    await expect
      .poll(async () => cents(await cardValue(page, 'Bu ay tahsilat').innerText()))
      .toBe(thisMonth.sum)
    const spark = card(page, 'Bu ay tahsilat').getByRole('img', { name: /^Son 6 ayın tahsilatı/ })
    if (half.total === 0) {
      await expect(spark).toHaveCount(0)
    } else {
      await expect(spark).toBeVisible()
      await expect(spark.locator('.sparkline')).toHaveAttribute('aria-hidden', 'true')
      // Etiket her ayın gerçek tutarını taşır; mini grafik süs değildir.
      const label = (await spark.getAttribute('aria-label')) ?? ''
      expect(label.split(', ')).toHaveLength(6)
    }
  })

  test('öğrenci ve veli: "Genel not ortalaması" mini grafiği aylık ortalamalardan gelir', async ({
    page,
    loginAs,
    api,
  }) => {
    for (const role of ['ogrenci', 'veli'] as const) {
      const client = await api(role)
      const own = (await students(client))[0]
      const months = monthlyAverages(
        await allRows<GradeRecord>(client, 'grades', `&studentId=${own?.id}`),
      )
      expect(months.length, `${role} en az iki aylık not`).toBeGreaterThanOrEqual(2)
      await loginAs(role)
      await openDashboard(page, role, role === 'veli' ? `?cocuk=${own?.id}` : '')
      const spark = card(page, 'Genel not ortalaması').getByRole('img', {
        name: /^Aylık not ortalaması/,
      })
      await expect(spark).toBeVisible()
      const label = (await spark.getAttribute('aria-label')) ?? ''
      expect(label.split(', ')).toHaveLength(months.length)
      expect(label).toContain(`${months.at(-1)?.value}/100`)
    }
  })
})
