import { randomUUID } from 'node:crypto'

import type { Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
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

async function weekHasRoom(page: Page, path: string, monday: string, room: string) {
  await page.goto(`${path}?hafta=${monday}`)
  await expect(page.getByRole('list', { name: 'Haftalık ders programı' })).toBeVisible()
  return (await page.getByRole('button', { name: /dk/ }).filter({ hasText: room }).count()) > 0
}

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
})
