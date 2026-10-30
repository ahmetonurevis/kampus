import { randomUUID } from 'node:crypto'

import type { Page, Request } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Akademik yazma ekranları: öğretmen (Selin Kaya) yoklama alır, resmî not girer ve düzeltir.
// Selin 8 sınıfta Matematik okutur (5-A c2, 6-A c3, 7-A c1, 8-A c4, 9-A … 12-A); 7-B (c9) kapsamı
// dışındadır. Yazan her test kendi kurumunu kurar (`tenant`: seed ile aynı sınıf/öğrenci kimlikleri,
// ayrı kurum); yoklama ve not kayıtları gün + tür bazında tekil olduğundan tekrar koşu ve paralel
// testler birbirinin kaydına çarpmaz. Kalıcılık her testte API sorgusuyla doğrulanır.

const COLLECTIONS = '/api/v1/collections'
const FOREIGN_CLASS_NAME = '7-B'
/** Selin'in okuyamadığı başka branşın notu (7-B öğrencisi). */
const FOREIGN_GRADE = 'g-s5-0-1'
const ATTENDANCE_PATH = (classId: string) => new RegExp(`/api/v1/classes/${classId}/attendance$`)

/** Bugün (Europe/Istanbul): sunucu da yoklama ve not gününü bu saat dilimine göre yazar. */
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format()

interface Row<T> {
  id: string
  version: number
  record: T
}
interface StudentRecord {
  id: string
  name: string
  classId: string
  isActive: boolean
}
interface AttendanceRecord {
  studentId: string
  status: string
}
interface GradeRecord {
  studentId: string
  score: number
  assessmentType?: string
  corrections?: { previousScore: number; score: number; reason: string }[]
}

async function list<T>(client: ApiClient, path: string): Promise<Row<T>[]> {
  const result = await client.get(`${COLLECTIONS}/${path}`)
  expect(result.status, path).toBe(200)
  return (result.body as { data: Row<T>[] }).data
}

/** Sınıfın aktif öğrencileri (okul numarası sırasıyla; ekrandaki sıra budur). */
async function classStudents(client: ApiClient, classId: string): Promise<StudentRecord[]> {
  const students = await list<StudentRecord>(client, 'students?pageSize=100')
  return students.map((row) => row.record).filter((s) => s.classId === classId && s.isActive)
}

async function attendanceOf(client: ApiClient, classId: string) {
  const day = today()
  const rows = await list<AttendanceRecord>(
    client,
    `attendance?pageSize=100&classId=${classId}&dateFrom=${day}&dateTo=${day}`,
  )
  return new Map(rows.map((row) => [row.record.studentId, row.record.status]))
}

async function gradesOf(client: ApiClient, studentId: string) {
  return list<GradeRecord>(client, `grades?pageSize=100&studentId=${studentId}`)
}

/** Arayüzden geçmeden resmî not (kurulum); 201 döner ve yeni kaydın kimliğini verir. */
async function createGrade(
  client: ApiClient,
  input: { studentId: string; assessmentType: string; score: number },
): Promise<string> {
  const response = await client.context.fetch('/api/v1/grades', {
    method: 'POST',
    data: { subjectId: 'math', term: 1, date: today(), topic: '', ...input },
    headers: { 'idempotency-key': randomUUID() },
    failOnStatusCode: false,
  })
  expect(response.status(), 'not oluşturma').toBe(201)
  return ((await response.json()) as { data: { entity: { id: string } } }).data.entity.id
}

async function patchGrade(client: ApiClient, id: string, version: number, score: number) {
  const response = await client.context.fetch(`/api/v1/grades/${id}`, {
    method: 'PATCH',
    data: { score, reason: 'Başka bir sekmeden düzeltme' },
    headers: { 'if-match': `"${version}"` },
    failOnStatusCode: false,
  })
  expect(response.status(), 'API düzeltmesi').toBe(200)
}

/** Sayfadaki yoklama gönderimlerini sayar (çift gönderim denetimi). */
function recordAttendancePosts(page: Page, classId: string): Request[] {
  const requests: Request[] = []
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      ATTENDANCE_PATH(classId).test(new URL(request.url()).pathname)
    )
      requests.push(request)
  })
  return requests
}

const attendanceSelect = (page: Page) => page.getByLabel('Yoklama alınacak sınıf')
const mark = (page: Page, student: string, label: string) =>
  page.getByRole('radio', { name: `${student}: ${label}` })
const saveButton = (page: Page) => page.getByRole('button', { name: 'Yoklamayı kaydet' })

test.describe('öğretmen: yoklama alma', () => {
  test('yoklama kaydedilir ve kalıcıdır; aynı gün ikinci gönderim günceller', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen'], classes: ['c3'] })
    await loginAs(school.user('ogretmen'))
    const client = await api(school.user('ogretmen'))
    const students = await classStudents(client, 'c3')
    expect(students.length).toBeGreaterThan(2)
    const [first, second] = students
    expect(await attendanceOf(client, 'c3')).toHaveProperty('size', 0)

    await page.goto('/ogretmen/yoklama')
    await attendanceSelect(page).selectOption({ label: '6-A' })
    // Varsayılan "Geldi"; hiçbir şey dokunulmadan önce herkes işaretlidir.
    await expect(mark(page, first!.name, 'Geldi')).toHaveAttribute('aria-checked', 'true')
    await mark(page, first!.name, 'Gelmedi').click()
    await mark(page, second!.name, 'Geç geldi').click()
    await expect(mark(page, first!.name, 'Gelmedi')).toHaveAttribute('aria-checked', 'true')
    await expect(mark(page, first!.name, 'Geldi')).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByText(/1 gelmedi · 1 geç geldi/)).toBeVisible()

    await saveButton(page).click()
    await expect(page.getByRole('status').filter({ hasText: 'Yoklama kaydedildi.' })).toBeVisible()
    await expect(
      page.getByText('Bu sınıfın bugünkü yoklaması kayıtlı; gönderim kaydı günceller.'),
    ).toBeVisible()

    const stored = await attendanceOf(client, 'c3')
    expect(stored.size).toBe(students.length)
    expect(stored.get(first!.id)).toBe('absent')
    expect(stored.get(second!.id)).toBe('late')
    expect(stored.get(students[2]!.id)).toBe('present')

    // İkinci gönderim: kayıt yinelenmez, güncellenir; ekran "güncellendi" der.
    await mark(page, first!.name, 'Mazeretli').click()
    await saveButton(page).click()
    await expect(page.getByRole('status').filter({ hasText: 'Yoklama güncellendi.' })).toBeVisible()
    const updated = await attendanceOf(client, 'c3')
    expect(updated.size).toBe(students.length)
    expect(updated.get(first!.id)).toBe('excused')
    expect(updated.get(second!.id)).toBe('late')

    // Yoklama geçmişi bugünkü kaydı gösterir (liste tazelendi).
    await page.getByLabel('Yoklama tarihi').fill(today())
    await page.getByLabel('Yoklama sınıfı').selectOption({ label: '6-A' })
    await expect(
      page.getByRole('table', { name: 'Yoklama geçmişi' }).locator('tbody tr').first(),
    ).toBeVisible()
  })

  test('çift tıklama tek yoklama isteği atar', async ({ page, loginAs, api, tenant }) => {
    const school = await tenant({ roles: ['ogretmen'], classes: ['c2'] })
    await loginAs(school.user('ogretmen'))
    const client = await api(school.user('ogretmen'))
    const students = await classStudents(client, 'c2')
    const posts = recordAttendancePosts(page, 'c2')

    await page.goto('/ogretmen/yoklama')
    await attendanceSelect(page).selectOption({ label: '5-A' })
    await mark(page, students[0]!.name, 'Gelmedi').click()
    await saveButton(page).dblclick()
    await expect(page.getByRole('status').filter({ hasText: 'Yoklama kaydedildi.' })).toBeVisible()
    expect(posts).toHaveLength(1)
    expect(posts[0]?.headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/)
    expect(posts[0]?.headers()['if-match']).toMatch(/^"\d+"$/)

    const stored = await attendanceOf(client, 'c2')
    expect(stored.size).toBe(students.length)
    expect(stored.get(students[0]!.id)).toBe('absent')

    // Düğme kilidinden bağımsız: aynı tikte iki gönderim de tek istektir.
    await page.getByRole('form', { name: '5-A yoklaması' }).evaluate((form: HTMLFormElement) => {
      form.requestSubmit()
      form.requestSubmit()
    })
    await expect(page.getByRole('status').filter({ hasText: 'Yoklama güncellendi.' })).toBeVisible()
    expect(posts).toHaveLength(2)
  })

  test('yalnız klavyeyle işaretlenir ve gönderilir; sınıf seçeneklerinde kapsam dışı sınıf yok', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen'], classes: ['c4'] })
    await loginAs(school.user('ogretmen'))
    const client = await api(school.user('ogretmen'))
    const students = await classStudents(client, 'c4')

    await page.goto('/ogretmen/yoklama')
    await expect(attendanceSelect(page).locator('option')).toHaveCount(9)
    const options = await attendanceSelect(page).locator('option').allTextContents()
    expect(options).toContain('8-A')
    expect(options).not.toContain(FOREIGN_CLASS_NAME)
    expect(options).toHaveLength(9) // "Sınıf seçin" + ders verilen 8 sınıf

    await attendanceSelect(page).focus()
    await attendanceSelect(page).selectOption({ label: '8-A' })
    // Grubun odağı Tab ile gelir; ok tuşları gruptaki işaretler arasında gezer, Boşluk seçer.
    const target = mark(page, students[0]!.name, 'Mazeretli')
    await target.focus()
    await page.keyboard.press('Space')
    await expect(target).toHaveAttribute('aria-checked', 'true')
    await expect(
      page.getByRole('radiogroup', { name: `${students[0]!.name} yoklama durumu` }),
    ).toBeVisible()

    await saveButton(page).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('status').filter({ hasText: 'Yoklama kaydedildi.' })).toBeVisible()
    expect((await attendanceOf(client, 'c4')).get(students[0]!.id)).toBe('excused')
  })

  test('sınıf seçilmeden liste ve gönderim yoktur', async ({ page, loginAs }) => {
    await loginAs('ogretmen')
    await page.goto('/ogretmen/yoklama')
    await expect(page.getByText('Öğrenci listesi için bir sınıf seçin.')).toBeVisible()
    await expect(saveButton(page)).toHaveCount(0)
  })
})

test.describe('öğretmen: not girişi ve düzeltme', () => {
  const NOTES_URL = '/ogretmen/siniflarim?sekme=notlar'

  test('öğretmen not girer; kayıt kalıcıdır ve listede görünür', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen'], classes: ['c4'] })
    await loginAs(school.user('ogretmen'))
    const client = await api(school.user('ogretmen'))
    const [student] = await classStudents(client, 'c4')

    await page.goto(NOTES_URL)
    await page.getByRole('button', { name: 'Not gir' }).click()
    const dialog = page.getByRole('dialog', { name: 'Not gir' })
    await expect(page).toHaveURL(/[?&]notgir=yeni/)
    // Öğrenci ve ders sınıf seçilene kadar kapalıdır; kapsam dışı sınıf sunulmaz.
    await expect(dialog.getByLabel('Öğrenci')).toBeDisabled()
    await expect(dialog.getByLabel('Sınıf').locator('option')).toHaveCount(9)
    const classes = await dialog.getByLabel('Sınıf').locator('option').allTextContents()
    expect(classes).not.toContain(FOREIGN_CLASS_NAME)

    // Boş gönderim: Türkçe alan hataları, istek yok.
    await dialog.getByRole('button', { name: 'Notu kaydet' }).click()
    await expect(dialog.getByText('Bir kayıt seçin.').first()).toBeVisible()

    await dialog.getByLabel('Sınıf').selectOption({ label: '8-A' })
    await expect(dialog.getByLabel('Ders')).toHaveValue('math')
    await dialog.getByLabel('Değerlendirme türü').selectOption({ label: 'proje' })
    await dialog.getByLabel('Öğrenci').selectOption({ label: student!.name })
    await dialog.getByLabel('Puan (0-100)').fill('140')
    await dialog.getByRole('button', { name: 'Notu kaydet' }).click()
    await expect(dialog.getByText('Puan 0 ile 100 arasında olmalıdır.')).toBeVisible()
    await dialog.getByLabel('Puan (0-100)').fill('88')
    await dialog.getByLabel('Kazanım / Konu (isteğe bağlı)').fill('Üslü sayılar')
    await dialog.getByRole('button', { name: 'Notu kaydet' }).click()

    await expect(page.getByText('Not kaydedildi.')).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(page).not.toHaveURL(/notgir=/)

    const stored = (await gradesOf(client, student!.id)).filter(
      (row) => row.record.assessmentType === 'proje',
    )
    expect(stored).toHaveLength(1)
    expect(stored[0]?.record.score).toBe(88)

    // Aynı gün aynı türde ikinci not 409 `grade_duplicate`: Türkçe mesaj, ikinci kayıt yok.
    await page.getByRole('button', { name: 'Not gir' }).click()
    await dialog.getByLabel('Sınıf').selectOption({ label: '8-A' })
    await dialog.getByLabel('Değerlendirme türü').selectOption({ label: 'proje' })
    await dialog.getByLabel('Öğrenci').selectOption({ label: student!.name })
    await dialog.getByLabel('Puan (0-100)').fill('50')
    await dialog.getByRole('button', { name: 'Notu kaydet' }).click()
    await expect(
      page.getByText('Bu öğrenciye aynı gün aynı türde not zaten girilmiş.'),
    ).toBeVisible()
    expect(
      (await gradesOf(client, student!.id)).filter((row) => row.record.assessmentType === 'proje'),
    ).toHaveLength(1)
  })

  test('düzeltme gerekçe ister; başarıda puan ve geçmiş kalıcıdır', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen'], classes: ['c3'] })
    await loginAs(school.user('ogretmen'))
    const client = await api(school.user('ogretmen'))
    const [student] = await classStudents(client, 'c3')
    const gradeId = await createGrade(client, {
      studentId: student!.id,
      assessmentType: 'performans',
      score: 60,
    })
    const patches: Request[] = []
    page.on('request', (request) => {
      if (request.method() === 'PATCH') patches.push(request)
    })

    await page.goto(`${NOTES_URL}&not=${gradeId}`)
    const dialog = page.getByRole('dialog', { name: 'Not ayrıntısı' })
    await expect(dialog).toContainText('60/100')
    const form = dialog.getByRole('form', { name: 'Notu düzelt' })
    await form.getByLabel('Yeni puan (0-100)').fill('72')
    await form.getByRole('button', { name: 'Düzeltmeyi kaydet' }).click()
    await expect(form.getByText('Düzeltme için gerekçe yazın.')).toBeVisible()
    expect(patches).toHaveLength(0)

    await form.getByLabel('Düzeltme gerekçesi').fill('Puan yanlış girilmişti')
    await form.getByRole('button', { name: 'Düzeltmeyi kaydet' }).click()
    await expect(page.getByText('Not düzeltildi.')).toBeVisible()
    await expect(dialog.getByRole('listitem').filter({ hasText: '60/100 → 72/100' })).toBeVisible()
    expect(patches).toHaveLength(1)
    expect(patches[0]?.headers()['if-match']).toMatch(/^"\d+"$/)

    const [stored] = (await gradesOf(client, student!.id)).filter((row) => row.id === gradeId)
    expect(stored?.record.score).toBe(72)
    expect(stored?.record.corrections).toEqual([
      expect.objectContaining({ previousScore: 60, score: 72, reason: 'Puan yanlış girilmişti' }),
    ])
  })

  test('eski sürümle düzeltme 409 verir: "kayıt değişti", kayıt tazelenir, ekran yazmaz', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen'], classes: ['c3'] })
    await loginAs(school.user('ogretmen'))
    const client = await api(school.user('ogretmen'))
    const students = await classStudents(client, 'c3')
    const student = students[1]!
    const gradeId = await createGrade(client, {
      studentId: student.id,
      assessmentType: 'performans',
      score: 55,
    })

    await page.goto(`${NOTES_URL}&not=${gradeId}`)
    const dialog = page.getByRole('dialog', { name: 'Not ayrıntısı' })
    const form = dialog.getByRole('form', { name: 'Notu düzelt' })
    await expect(dialog).toContainText('55/100')
    await form.getByLabel('Yeni puan (0-100)').fill('65')
    await form.getByLabel('Düzeltme gerekçesi').fill('Ekrandaki sürümle düzeltme')

    // Form açıkken başka bir oturum notu değiştirdi: ekrandaki sürüm eski.
    const [current] = (await gradesOf(client, student.id)).filter((row) => row.id === gradeId)
    await patchGrade(client, gradeId, current!.version, 77)

    await form.getByRole('button', { name: 'Düzeltmeyi kaydet' }).click()
    await expect(page.getByText(/Kayıt değişti/)).toBeVisible()
    // Panel güncel puanı gösterir; yazılan gerekçe formda kalır, ekran 65'i yazmamıştır.
    await expect(dialog.getByRole('listitem').filter({ hasText: '55/100 → 77/100' })).toBeVisible()
    await expect(form.getByLabel('Düzeltme gerekçesi')).toHaveValue('Ekrandaki sürümle düzeltme')
    const [stored] = (await gradesOf(client, student.id)).filter((row) => row.id === gradeId)
    expect(stored?.record.score).toBe(77)
    expect(stored?.record.corrections).toHaveLength(1)
  })

  test('başka branşın notu bulunamadı: ekran "bulunamadı" der, düzeltme formu yok, API 404 verir', async ({
    page,
    loginAs,
    api,
  }) => {
    await loginAs('ogretmen')
    const client = await api('ogretmen')

    await page.goto(`${NOTES_URL}&not=${FOREIGN_GRADE}`)
    await expect(
      page.getByRole('dialog', { name: 'Not ayrıntısı' }).getByText(/Kayıt bulunamadı/),
    ).toBeVisible()
    await expect(page.getByRole('form', { name: 'Notu düzelt' })).toHaveCount(0)

    const response = await client.context.fetch(`/api/v1/grades/${FOREIGN_GRADE}`, {
      method: 'PATCH',
      data: { score: 90, reason: 'Yetkisiz deneme' },
      headers: { 'if-match': '"1"' },
      failOnStatusCode: false,
    })
    expect(response.status()).toBe(404)
    expect(((await response.json()) as { code: string }).code).toBe('not_found')
  })
})

test.describe('yazma düğmesi yalnız öğretmende', () => {
  test('öğrenci ve veli not/yoklama yazma düğmesi görmez', async ({ page, loginAs }) => {
    await loginAs('ogrenci')
    await page.goto('/ogrenci/notlarim')
    await expect(page.getByRole('heading', { level: 2, name: 'Notlar' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Not gir' })).toHaveCount(0)
    await page.goto('/ogrenci/devamsizlik')
    await expect(page.getByRole('heading', { level: 2, name: 'Katılım geçmişi' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Yoklama al' })).toHaveCount(0)

    // Öğretmen sayfaları öğrenci için kapalıdır.
    await page.goto('/ogretmen/yoklama')
    await expect(page).toHaveURL(/\/ogrenci\/dashboard$/)

    await loginAs('veli', { fresh: true })
    await page.goto('/veli/akademik-takip')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Not gir' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Yoklamayı kaydet' })).toHaveCount(0)
    await page.goto('/ogretmen/yoklama')
    await expect(page).toHaveURL(/\/veli\/dashboard/)
  })

  test('ön büro menüde yazma ekranı görmez; rota kapalı, yazma uçları 403', async ({
    page,
    loginAs,
    api,
  }) => {
    await loginAs('onburo')
    await page.goto('/onburo/dashboard')
    const menu = page.getByRole('navigation', { name: 'Menü' })
    await expect(menu.getByRole('link', { name: /Yoklama|Sınıflarım/ })).toHaveCount(0)
    await page.goto('/ogretmen/yoklama')
    await expect(page).toHaveURL(/\/onburo\/dashboard$/)

    const client = await api('onburo')
    const attendance = await client.post('/api/v1/classes/c3/attendance', {
      date: today(),
      marks: {},
    })
    expect(attendance.status).toBe(403)
    const grade = await client.context.fetch('/api/v1/grades', {
      method: 'POST',
      data: {
        studentId: 's1',
        subjectId: 'math',
        term: 1,
        assessmentType: 'sinav',
        date: today(),
        score: 70,
      },
      headers: { 'idempotency-key': randomUUID() },
      failOnStatusCode: false,
    })
    expect(grade.status()).toBe(403)
  })
})

test.describe('390 px genişlik', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('yoklama alma ve not girişi yatay taşma çıkarmaz', async ({ page, loginAs }) => {
    await loginAs('ogretmen')
    await page.goto('/ogretmen/yoklama')
    await expectNoHorizontalOverflow(page)
    await attendanceSelect(page).selectOption({ label: '7-A' })
    await expect(page.getByRole('radio', { name: /: Geldi$/ }).first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
    // Her işaret en az 24×24 px (WCAG 2.2 AA hedef boyutu).
    const box = await page
      .getByRole('radio', { name: /: Mazeretli$/ })
      .first()
      .boundingBox()
    expect(box?.height).toBeGreaterThanOrEqual(24)
    expect(box?.width).toBeGreaterThanOrEqual(24)

    await page.goto('/ogretmen/siniflarim?sekme=notlar')
    await page.getByRole('button', { name: 'Not gir' }).click()
    const dialog = page.getByRole('dialog', { name: 'Not gir' })
    await dialog.getByLabel('Sınıf').selectOption({ label: '7-A' })
    await expect(dialog.getByLabel('Ders')).toHaveValue('math')
    await expectNoHorizontalOverflow(page)

    await page.goto('/ogretmen/siniflarim?sekme=notlar&not=g-s1-0-0')
    await expect(page.getByRole('form', { name: 'Notu düzelt' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
