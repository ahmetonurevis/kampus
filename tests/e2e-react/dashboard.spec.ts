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
