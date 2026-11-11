import { randomUUID } from 'node:crypto'

import type { Page } from '@playwright/test'

import { apiRequest, type ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'

// Ders programı ve yedek görevlendirme (IST-094; DOM-YTK-068, DOM-YTK-069): yazan test kendi
// kurumunu kurar (ders kaydı yok) ve uzak bir güne kendi derslerini planlar. Kural dalları API ve
// birim testlerindedir; burada ekranın uçlara bağlandığı ve rol görünümleri sınanır.

interface Lesson {
  id: string
  version: number
  teacherId: string
  originalTeacherId: string | null
  status: string
  cancelReason?: string | null
  substitutions?: unknown[]
}

/** Seed'de 7-A'nın kampüsünde ikinci matematik öğretmeni yoktur; yedek adayı olarak eklenir. */
const SUBSTITUTE = {
  id: 'e2e-t-yedek',
  name: 'Yedek Öğretmen Nil Ak',
  subjectId: 'math',
  subject: 'Matematik',
  branchId: 'b1',
  email: 'nil.ak@example.test',
  phone: '05550000099',
  attendanceRate: 0,
  homeworkRate: 0,
  isActive: true,
  deletedAt: null,
  guidanceCounselor: false,
}

/** Bugünden `days` gün sonrası (Europe/Istanbul günü) ve o haftanın pazartesisi. */
function farDay(days: number): { day: string; monday: string } {
  const date = new Date(Date.now() + days * 86_400_000)
  const key = (value: Date) => value.toISOString().slice(0, 10)
  const shift = (date.getUTCDay() + 6) % 7
  return { day: key(date), monday: key(new Date(date.getTime() - shift * 86_400_000)) }
}

async function planLesson(
  client: ApiClient,
  body: { teacherId: string; date: string; room: string },
): Promise<Lesson> {
  const result = await client.post(
    '/api/v1/lessons',
    { classId: 'c1', subjectId: 'math', duration: 40, ...body },
    { 'idempotency-key': randomUUID() },
  )
  expect(result.status).toBe(201)
  return (result.body as { data: Lesson }).data
}

async function lessonsInRoom(client: ApiClient, day: string, room: string): Promise<Lesson[]> {
  const result = await client.get(
    `/api/v1/lessons?dateFrom=${day}&dateTo=${day}&room=${encodeURIComponent(room)}&cancelled=all`,
  )
  expect(result.status).toBe(200)
  return (result.body as { data: Lesson[] }).data
}

async function getLesson(
  client: ApiClient,
  id: string,
): Promise<Lesson & { room: string; duration: number }> {
  const result = await client.get(`/api/v1/lessons/${id}`)
  expect(result.status).toBe(200)
  return (result.body as { data: Lesson & { room: string; duration: number } }).data
}

/** Dersi başka bir kullanıcı gibi API'den değiştirir (sürüm artar). */
async function patchLesson(client: ApiClient, id: string, body: Record<string, unknown>) {
  const current = await getLesson(client, id)
  const result = await apiRequest(client.context, 'PATCH', `/api/v1/lessons/${id}`, body, {
    'idempotency-key': randomUUID(),
    'if-match': `"${current.version}"`,
  })
  expect(result.status).toBe(200)
}

async function postLessonCommand(
  client: ApiClient,
  id: string,
  command: 'cancel' | 'substitute',
  body: Record<string, unknown>,
) {
  const current = await getLesson(client, id)
  const result = await apiRequest(
    client.context,
    'POST',
    `/api/v1/lessons/${id}/${command}`,
    body,
    {
      'idempotency-key': randomUUID(),
      'if-match': `"${current.version}"`,
    },
  )
  expect(result.status).toBe(200)
}

async function weekHasRoom(page: Page, path: string, monday: string, room: string) {
  await page.goto(`${path}?hafta=${monday}`)
  await expect(page.getByRole('list', { name: 'Haftalık ders programı' })).toBeVisible()
  return (await page.getByRole('button', { name: /dk/ }).filter({ hasText: room }).count()) > 0
}

/** Programdaki etüt kaydı (seed'de etüt yoktur; plan ucunun üreteceği biçimde doğrudan konur). */
function tutorRecord(
  id: string,
  over: { studentIds: string[]; topic: string; room: string; date: string; status?: string },
) {
  const stamp = new Date().toISOString()
  return {
    collection: 'tutorSessions' as const,
    data: {
      id,
      examId: 'exam-7-1',
      branchId: 'b1',
      grade: 7,
      subjectId: 'math',
      topic: over.topic,
      studentIds: over.studentIds,
      scores: over.studentIds.map((studentId) => ({ studentId, percent: 25 })),
      teacherId: 't1',
      date: over.date,
      duration: 30,
      room: over.room,
      roomClassId: 'c1',
      capacity: 6,
      status: over.status ?? 'Planlandı',
      attendance: {},
      threshold: 70,
      createdAt: stamp,
      updatedAt: stamp,
    },
  }
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

const weekList = (page: Page) => page.getByRole('list', { name: 'Haftalık ders programı' })

test.describe('ders programı', () => {
  test('yönetici ders ekler, çakışma alanda görünür, yedek atar; öğretmen gerekçeyi görmez', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici', 'ogretmen'],
      records: [{ collection: 'teachers', data: SUBSTITUTE }],
    })
    const admin = school.user('yonetici')
    const client = await api(admin)
    const room = `E2E-${randomUUID().slice(0, 6)}`
    const { day, monday } = farDay(120)
    // 7-A'nın 09:00 dersi önceden vardır (Selin Kaya, t1).
    await planLesson(client, { teacherId: 't1', date: `${day}T06:00:00.000Z`, room: `${room}-0` })

    const page = await loginAs(admin)
    await page.goto(`/yonetici/program-yonetimi?gorunum=gun&gun=${day}`)
    await expect(page.getByRole('heading', { name: 'Program Yönetimi', level: 1 })).toBeVisible()
    await page.getByRole('button', { name: 'Ders planla' }).click()
    const form = page.getByRole('dialog', { name: 'Ders planla' })
    await form.getByLabel('Sınıf').selectOption({ label: '7-A · Kadıköy Kampüsü' })
    await form.getByLabel('Ders', { exact: true }).selectOption({ label: 'Matematik' })
    await form.getByLabel('Öğretmen').selectOption({ label: SUBSTITUTE.name })
    await form.getByLabel('Ders başlangıcı').fill(`${day}T09:00`)
    await form.getByLabel('Süre (dakika)').fill('40')
    await form.getByLabel('Derslik').fill(room)
    await form.getByRole('button', { name: 'Dersi planla' }).click()
    // Sınıfın aynı saatte dersi var: sunucunun mesajı başlangıç alanının altında, form korunur.
    await expect(form.getByText('Sınıfın bu saatte başka dersi var.')).toBeVisible()
    await expect(form.getByLabel('Ders başlangıcı')).toHaveAttribute('aria-invalid', 'true')
    await expect(form.getByLabel('Derslik')).toHaveValue(room)
    await form.getByLabel('Ders başlangıcı').fill(`${day}T11:00`)
    await form.getByRole('button', { name: 'Dersi planla' }).click()
    await expect(form).toBeHidden()
    await expect.poll(async () => (await lessonsInRoom(client, day, room)).length).toBe(1)

    // Yedek: panelden, gerekçe zorunlu.
    await page
      .getByRole('list', { name: 'Günlük ders programı' })
      .getByRole('button')
      .filter({ hasText: room })
      .filter({ hasText: '11:00' })
      .click()
    const panel = page.getByRole('dialog', { name: 'Ders ayrıntısı' })
    await panel.getByRole('button', { name: 'Yedek öğretmen ata' }).click()
    const substitute = page.getByRole('dialog', { name: 'Yedek öğretmen ata' })
    await substitute
      .getByLabel('Yedek öğretmen', { exact: true })
      .selectOption({ label: 'Selin Kaya' })
    await substitute.getByRole('button', { name: 'Yedeği ata' }).click()
    await expect(substitute.getByLabel('Görevlendirme gerekçesi')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await substitute.getByLabel('Görevlendirme gerekçesi').fill('Nil Hoca seminerde.')
    await substitute.getByRole('button', { name: 'Yedeği ata' }).click()
    await expect(substitute).toBeHidden()
    await expect(panel.getByText('Yedek: Selin Kaya')).toBeVisible()
    await expect(panel.getByText('Nil Hoca seminerde.')).toBeVisible()
    await expect.poll(async () => (await lessonsInRoom(client, day, room))[0]?.teacherId).toBe('t1')

    // Öğretmen (yedek Selin Kaya) dersi programında görür; gerekçe ne ekranda ne yanıtta var.
    const teacher = school.user('ogretmen')
    await loginAs(teacher)
    await page.goto(`/ogretmen/ders-programi?hafta=${monday}`)
    const card = page
      .getByRole('list', { name: 'Haftalık ders programı' })
      .getByRole('button')
      .filter({ hasText: room })
      .filter({ hasText: '11:00' })
    await expect(card).toContainText('Yedek: Selin Kaya')
    await card.click()
    const teacherPanel = page.getByRole('dialog', { name: 'Ders ayrıntısı' })
    await expect(teacherPanel.getByText('Yedek atandı')).toBeVisible()
    await expect(teacherPanel.getByText('Nil Hoca seminerde.')).toHaveCount(0)
    await expect(teacherPanel.getByRole('button', { name: 'Yedek öğretmen ata' })).toHaveCount(0)
    const teacherClient = await api(teacher)
    const seen = await lessonsInRoom(teacherClient, day, room)
    expect(seen).toHaveLength(1)
    expect(seen[0]).not.toHaveProperty('substitutions')
    expect(JSON.stringify(seen)).not.toContain('seminerde')
  })

  test('yönetici gerekçeyle iptal eder; iptal edilen ders günlük programdan çıkar', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici', 'ogrenci'] })
    const admin = school.user('yonetici')
    const student = school.user('ogrenci')
    const client = await api(admin)
    const room = `E2E-${randomUUID().slice(0, 6)}`
    const { day, monday } = farDay(130)
    await planLesson(client, { teacherId: 't1', date: `${day}T07:00:00.000Z`, room })

    // Öğrenci (7-A) dersi haftalık programında görür.
    const page = await loginAs(student)
    await expect.poll(() => weekHasRoom(page, '/ogrenci/ders-programi', monday, room)).toBe(true)

    await loginAs(admin)
    await page.goto(`/yonetici/program-yonetimi?gorunum=gun&gun=${day}`)
    const daily = page.getByRole('list', { name: 'Günlük ders programı' })
    await daily.getByRole('button').filter({ hasText: room }).click()
    await page
      .getByRole('dialog', { name: 'Ders ayrıntısı' })
      .getByRole('button', { name: 'Dersi iptal et' })
      .click()
    const cancel = page.getByRole('dialog', { name: 'Dersi iptal et' })
    await cancel.getByLabel('İptal gerekçesi').fill('Okul gezisi nedeniyle ders yapılmayacak.')
    // Kirli form kapatılırken onay ister; "Düzenlemeye devam et" formu korur.
    await cancel.getByRole('button', { name: 'Vazgeç' }).click()
    const confirm = page.getByRole('alertdialog', { name: 'Kaydedilmemiş değişiklikler var' })
    await confirm.getByRole('button', { name: 'Düzenlemeye devam et' }).click()
    await expect(cancel.getByLabel('İptal gerekçesi')).toHaveValue(
      'Okul gezisi nedeniyle ders yapılmayacak.',
    )
    await cancel.getByRole('button', { name: 'Dersi iptal et' }).click()
    await expect(cancel).toBeHidden()
    await expect
      .poll(async () => (await lessonsInRoom(client, day, room))[0]?.status)
      .toBe('cancelled')
    expect((await lessonsInRoom(client, day, room))[0]?.cancelReason).toBe(
      'Okul gezisi nedeniyle ders yapılmayacak.',
    )

    // Yönetimde iptal varsayılan olarak gizli; "İptalleri göster" ile iptal kaydı görünür.
    await page.keyboard.press('Escape')
    await expect(daily.getByRole('button').filter({ hasText: room })).toHaveCount(0)
    await page.getByLabel('İptalleri göster').check()
    // Süzgeç parametresi (`iptal=goster`) iptal penceresini açmaz.
    await expect(page.getByRole('dialog', { name: 'Dersi iptal et' })).toHaveCount(0)
    await expect(daily.getByRole('button').filter({ hasText: room })).toContainText('İptal edildi')

    await loginAs(student)
    await expect.poll(() => weekHasRoom(page, '/ogrenci/ders-programi', monday, room)).toBe(false)
  })

  test('öğretmen program yönetimini salt okur', async ({ loginAs }) => {
    const page = await loginAs('ogretmen')
    await page.goto('/ogretmen/program-yonetimi?gorunum=liste')
    await expect(page.getByText('Asıl ya da yedek olduğunuz dersler')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Ders planla' })).toHaveCount(0)
    await expect(page.getByLabel('İptalleri göster')).toHaveCount(0)
    await expect(page.getByRole('table', { name: 'Ders listesi' })).toBeVisible()
    // Kapsamı kendi dersleridir: tohumdaki Selin Kaya dersleri listede görünür.
    const rows = page.getByRole('table', { name: 'Ders listesi' }).getByRole('row')
    await expect(rows.filter({ hasText: 'Selin Kaya' }).first()).toBeVisible()
  })

  test('düzenlerken ders başkasınca değişirse girdi korunur, çakışan alan gösterilir (IST-077)', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici'] })
    const admin = school.user('yonetici')
    const client = await api(admin)
    const room = `E2E-${randomUUID().slice(0, 6)}`
    const { day } = farDay(140)
    const lesson = await planLesson(client, {
      teacherId: 't1',
      date: `${day}T06:00:00.000Z`,
      room,
    })
    const page = await loginAs(admin)
    const editUrl = `/yonetici/program-yonetimi?gorunum=gun&gun=${day}&ders-form=${lesson.id}`
    const form = page.getByRole('dialog', { name: 'Dersi düzenle' })

    // 1) Başka alanı başkası değiştirdi: form kilitlenmez, sürüm gönderimde taze okunur ve
    // başkasının değişikliği (süre) eski değere geri yazılmaz.
    await page.goto(editUrl)
    await expect(form.getByLabel('Derslik')).toHaveValue(room)
    await form.getByLabel('Derslik').fill(`${room}-B`)
    await patchLesson(client, lesson.id, { duration: 50 })
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(form).toBeHidden()
    await expect
      .poll(async () => {
        const saved = await getLesson(client, lesson.id)
        return `${saved.room}|${saved.duration}`
      })
      .toBe(`${room}-B|50`)

    // 2) Aynı alanı başkası da değiştirdi: kayıt gönderilmez, iki değer gösterilir, girdi
    // korunur; yeniden kaydetmek kullanıcının değerini yazar.
    await page.goto(editUrl)
    await form.getByLabel('Derslik').fill(`${room}-C`)
    await patchLesson(client, lesson.id, { room: `${room}-D` })
    await form.getByRole('button', { name: 'Kaydet' }).click()
    const notice = form.getByRole('alert').filter({ hasText: 'başkası tarafından da' })
    await expect(notice).toContainText(
      `Derslik: kayıtlı değer ${room}-D, sizin girdiğiniz ${room}-C`,
    )
    await expect(form.getByLabel('Derslik')).toHaveValue(`${room}-C`)
    expect((await getLesson(client, lesson.id)).room).toBe(`${room}-D`)
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(form).toBeHidden()
    await expect.poll(async () => (await getLesson(client, lesson.id)).room).toBe(`${room}-C`)

    // 3) Okuma ile yazma arasında değişiklik (gerçek 409): uyarı çıkar, girdi korunur, yeniden
    // kaydetmek güncel sürümle yazar ve başkasının süresini ezmez.
    await page.goto(editUrl)
    await form.getByLabel('Derslik').fill(`${room}-E`)
    let raced = false
    await page.route(`**/api/v1/lessons/${lesson.id}`, async (route) => {
      if (route.request().method() === 'PATCH' && !raced) {
        raced = true
        await patchLesson(client, lesson.id, { duration: 60 })
      }
      await route.continue()
    })
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(
      form.getByRole('alert').filter({ hasText: 'başka biri tarafından değişti' }),
    ).toBeVisible()
    await expect(form.getByLabel('Derslik')).toHaveValue(`${room}-E`)
    expect((await getLesson(client, lesson.id)).room).toBe(`${room}-C`)
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(form).toBeHidden()
    await expect
      .poll(async () => {
        const saved = await getLesson(client, lesson.id)
        return `${saved.room}|${saved.duration}`
      })
      .toBe(`${room}-E|60`)
  })

  test('açık form ders iptal edilince kapanmaz; sunucu reddi formda görünür', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici'] })
    const admin = school.user('yonetici')
    const client = await api(admin)
    const room = `E2E-${randomUUID().slice(0, 6)}`
    const { day } = farDay(150)
    const lesson = await planLesson(client, {
      teacherId: 't1',
      date: `${day}T06:00:00.000Z`,
      room,
    })
    const page = await loginAs(admin)
    await page.goto(`/yonetici/program-yonetimi?gorunum=gun&gun=${day}&ders-form=${lesson.id}`)
    const form = page.getByRole('dialog', { name: 'Dersi düzenle' })
    await form.getByLabel('Derslik').fill(`${room}-X`)
    await postLessonCommand(client, lesson.id, 'cancel', { reason: 'Okul gezisi.' })
    await form.getByRole('button', { name: 'Kaydet' }).click()
    // Ders iptal edildi: form kapanmaz, girdi kalır, sunucunun 422 mesajı formda görünür.
    await expect(form.getByText('İptal edilmiş ders değiştirilemez.').first()).toBeVisible()
    await expect(form.getByLabel('Derslik')).toHaveValue(`${room}-X`)
    await expect(form.getByRole('alert').filter({ hasText: 'Girdiniz korundu' })).toBeVisible()
    expect((await getLesson(client, lesson.id)).room).toBe(room)
  })

  test('veli programında iptal görünmez, yedek "Yedek: …" olarak görünür', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici', 'veli'],
      records: [{ collection: 'teachers', data: SUBSTITUTE }],
    })
    const admin = school.user('yonetici')
    const client = await api(admin)
    const suffix = randomUUID().slice(0, 6)
    const cancelledRoom = `E2E-IP-${suffix}`
    const substitutedRoom = `E2E-YD-${suffix}`
    const { day, monday } = farDay(160)
    const cancelled = await planLesson(client, {
      teacherId: 't1',
      date: `${day}T07:00:00.000Z`,
      room: cancelledRoom,
    })
    await postLessonCommand(client, cancelled.id, 'cancel', { reason: 'Okul gezisi.' })
    const substituted = await planLesson(client, {
      teacherId: SUBSTITUTE.id,
      date: `${day}T09:00:00.000Z`,
      room: substitutedRoom,
    })
    await postLessonCommand(client, substituted.id, 'substitute', {
      teacherId: 't1',
      reason: 'Nil Hoca seminerde.',
    })

    const page = await loginAs(school.user('veli'))
    await page.goto(`/veli/akademik-takip?sekme=program&hafta=${monday}`)
    const week = page.getByRole('list', { name: 'Haftalık ders programı' })
    const card = week.getByRole('button').filter({ hasText: substitutedRoom })
    await expect(card).toContainText('Yedek: Selin Kaya')
    await expect(week.getByRole('button').filter({ hasText: cancelledRoom })).toHaveCount(0)
    await expect(page.getByText('Nil Hoca seminerde.')).toHaveCount(0)
  })

  test('programda kazanım etütleri: öğretmen, öğrenci ve veli kendi kapsamını görür (IST-096)', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const suffix = randomUUID().slice(0, 6)
    const { day, monday } = farDay(170)
    const at = `${day}T12:00:00.000Z`
    const own = { room: `ET-A-${suffix}`, topic: `Denklemler ${suffix}` }
    const other = { room: `ET-B-${suffix}`, topic: `Oran ${suffix}` }
    const sibling = { room: `ET-D-${suffix}`, topic: `Kesirler ${suffix}` }
    const cancelled = { room: `ET-C-${suffix}`, topic: `Iptal ${suffix}` }
    const school = await tenant({
      roles: ['ogretmen', 'ogrenci', 'veli'],
      students: ['s1', 's2', 's3'],
      records: [
        tutorRecord(`etut-a-${suffix}`, { ...own, studentIds: ['s1', 's3'], date: at }),
        tutorRecord(`etut-b-${suffix}`, { ...other, studentIds: ['s3'], date: at }),
        tutorRecord(`etut-d-${suffix}`, { ...sibling, studentIds: ['s2'], date: at }),
        tutorRecord(`etut-c-${suffix}`, {
          ...cancelled,
          studentIds: ['s1'],
          date: at,
          status: 'İptal',
        }),
      ],
    })

    // Öğretmen: kendi etütlerinin hepsi, iptal hariç; panelde öğrenci listesi vardır.
    const page = await loginAs(school.user('ogretmen'))
    await page.goto(`/ogretmen/ders-programi?hafta=${monday}`)
    const week = weekList(page)
    const card = week.getByRole('button').filter({ hasText: own.room })
    await expect(card).toContainText('Etüt · Matematik · ' + own.topic)
    await expect(card).toContainText(`2 öğrenci · Derslik ${own.room}`)
    await expect(card.getByText('Etüt', { exact: true })).toBeVisible()
    await expect(week.getByRole('button').filter({ hasText: other.room })).toHaveCount(1)
    await expect(week.getByRole('button').filter({ hasText: sibling.room })).toHaveCount(1)
    await expect(week.getByRole('button').filter({ hasText: cancelled.room })).toHaveCount(0)
    await card.click()
    const teacherPanel = page.getByRole('dialog', { name: 'Etüt ayrıntısı' })
    await expect(teacherPanel).toContainText('Matematik')
    await expect(teacherPanel).toContainText(own.topic)
    await expect(teacherPanel).toContainText('Selin Kaya')
    await expect(teacherPanel).toContainText(own.room)
    await expect(teacherPanel.getByText('Öğrenci sayısı')).toBeVisible()
    await expect(teacherPanel.getByRole('heading', { name: 'Öğrenciler' })).toBeVisible()
    await expect(teacherPanel.getByText('Deniz Yılmaz')).toBeVisible()

    // Öğrenci (Deniz): yalnız kendi etüdü, grup arkadaşı sayılmaz; panelde öğrenci listesi yok.
    const studentPage = await loginAs(school.user('ogrenci'))
    await studentPage.goto(`/ogrenci/ders-programi?hafta=${monday}`)
    const studentWeek = weekList(studentPage)
    const studentCard = studentWeek.getByRole('button').filter({ hasText: own.room })
    await expect(studentCard).toContainText(`1 öğrenci · Derslik ${own.room}`)
    for (const hidden of [other.room, sibling.room, cancelled.room])
      await expect(studentWeek.getByRole('button').filter({ hasText: hidden })).toHaveCount(0)
    await studentCard.click()
    const studentPanel = studentPage.getByRole('dialog', { name: 'Etüt ayrıntısı' })
    await expect(studentPanel).toContainText(own.topic)
    await expect(studentPanel.getByText('Öğrenci sayısı')).toBeVisible()
    await expect(studentPanel.getByRole('heading', { name: 'Öğrenciler' })).toHaveCount(0)
    await expect(studentPanel.getByText('Zeynep Demir')).toHaveCount(0)
    // Sunucu kapsamı: yanıtta grup arkadaşının kimliği ve başkasının etüdü yoktur (iptal geçmişi
    // sunucuda kalır, program göstermez).
    const studentApi = await api(school.user('ogrenci'))
    const read = await studentApi.get('/api/v1/collections/tutorSessions?pageSize=100')
    const rows = (read.body as { data: { record: { room: string; studentIds: string[] } }[] }).data
    expect(rows.map((row) => row.record.room).sort()).toEqual([own.room, cancelled.room].sort())
    for (const row of rows) expect(row.record.studentIds).toEqual(['s1'])

    // Veli: seçili çocuğun etüdü; çocuk değişince diğer çocuğunki.
    const parentPage = await loginAs(school.user('veli'))
    await parentPage.goto(`/veli/akademik-takip?sekme=program&hafta=${monday}&cocuk=s1`)
    const parentWeek = weekList(parentPage)
    await expect(parentWeek.getByRole('button').filter({ hasText: own.room })).toContainText(
      '1 öğrenci',
    )
    for (const hidden of [other.room, sibling.room, cancelled.room])
      await expect(parentWeek.getByRole('button').filter({ hasText: hidden })).toHaveCount(0)
    await parentPage.goto(`/veli/akademik-takip?sekme=program&hafta=${monday}&cocuk=s2`)
    await expect(parentWeek.getByRole('button').filter({ hasText: sibling.room })).toHaveCount(1)
    await expect(parentWeek.getByRole('button').filter({ hasText: own.room })).toHaveCount(0)
  })

  test('etüt modülü kapanınca etütler programdan çıkar, dersler kalır (IST-096)', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const suffix = randomUUID().slice(0, 6)
    const { day, monday } = farDay(180)
    const tutoring = { room: `ET-M-${suffix}`, topic: `Cebir ${suffix}` }
    const lessonRoom = `E2E-${suffix}`
    const school = await tenant({
      roles: ['ogrenci'],
      students: ['s1'],
      records: [
        tutorRecord(`etut-m-${suffix}`, {
          ...tutoring,
          studentIds: ['s1'],
          date: `${day}T12:00:00.000Z`,
        }),
      ],
    })
    const admin = await api(school.user('yonetici'))
    await planLesson(admin, { teacherId: 't1', date: `${day}T06:00:00.000Z`, room: lessonRoom })

    const page = await loginAs(school.user('ogrenci'))
    await page.goto(`/ogrenci/ders-programi?hafta=${monday}`)
    const week = weekList(page)
    await expect(week.getByRole('button').filter({ hasText: tutoring.room })).toBeVisible()
    await expect(week.getByRole('button').filter({ hasText: lessonRoom })).toBeVisible()

    await setModule(admin, 'tutoring', false)
    await page.goto(`/ogrenci/ders-programi?hafta=${monday}`)
    await expect(week.getByRole('button').filter({ hasText: lessonRoom })).toBeVisible()
    await expect(week.getByRole('button').filter({ hasText: tutoring.room })).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
  })

  test('öğretmen adres parametresiyle ders formunu açamaz', async ({ loginAs }) => {
    const page = await loginAs('ogretmen')
    for (const param of ['ders-form=yeni', 'ders-yedek=x', 'ders-iptal=x', 'ders-form=x']) {
      await page.goto(`/ogretmen/program-yonetimi?gorunum=liste&${param}`)
      await expect(page.getByRole('heading', { name: 'Program Yönetimi', level: 1 })).toBeVisible()
      await expect(page.getByRole('table', { name: 'Ders listesi' })).toBeVisible()
      await expect(page.getByRole('dialog')).toHaveCount(0)
    }
  })
})
