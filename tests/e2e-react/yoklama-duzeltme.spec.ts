import { randomUUID } from 'node:crypto'

import type { Page, Request } from '@playwright/test'

import { createSeed } from '../../packages/school-core/src/data/seed.ts'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Yönetici yoklama düzeltmesi (IST-093, DOM-AKD-035): yönetici geçmiş günün yoklamasını gerekçeyle
// düzeltir; değer ve düzeltme geçmişi API'de kalır. Yoklaması alınmamış günde her öğrenci açıkça
// seçilir ve ilk yoklamada gerekçe saklanmaz. Öğretmen ve ön büro sayfayı menüde görmez, adrese de
// giremez; `academic` kapalıyken sayfa ve uç kapanır. Yazan test kendi kurumunu kurar (`tenant`:
// seed'in 6-A sınıfı c3); yoklama günleri seed'den bağımsızdır: seed'in yoklaması son ~100 günde,
// bu testlerin günleri 200 ve 201 gün öncedir ve kayıtlarını test kendisi yazar.

const CLASS_ID = 'c3'
const STATUS_LABELS: Record<string, string> = {
  present: 'Geldi',
  absent: 'Gelmedi',
  late: 'Geç geldi',
  excused: 'Mazeretli',
}

/** Europe/Istanbul günü: sunucu yoklama gününü bu saat dilimine göre yazar. */
const dayOf = (value: Date | string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date(value))
const shiftDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

/** Seed yoklamasından uzak iki gün: ilkinde kayıt var (test yazar), ikincisinde yok. */
const RECORDED_AGO = 200
const EMPTY_AGO = 201

/** 6-A'nın aktif öğrencileri (seed'den; kurum kendi kopyasını taşır). */
const classStudents = () =>
  createSeed(new Date()).students.filter((s) => s.classId === CLASS_ID && s.isActive)

/** Kayıtlı günün yoklaması: ilk öğrenci Gelmedi, diğerleri Geldi (sunucu 09:00Z öğlesini yazar). */
function recordedDayRecords(day: string) {
  return classStudents().map((student, index) => ({
    collection: 'attendance' as const,
    data: {
      id: `e2e-att-${student.id}-${day}`,
      studentId: student.id,
      classId: CLASS_ID,
      date: `${day}T09:00:00.000Z`,
      status: index === 0 ? 'absent' : 'present',
      reason: '',
    },
  }))
}

interface Row<T> {
  record: T
}
interface AttendanceRecord {
  studentId: string
  date: string
  status: string
  corrections?: { previousStatus: string; status: string; reason: string; by: string }[]
}
interface StudentRecord {
  id: string
  name: string
  classId: string
  isActive: boolean
}

async function list<T>(client: ApiClient, path: string): Promise<T[]> {
  const result = await client.get(`/api/v1/collections/${path}`)
  expect(result.status, path).toBe(200)
  return (result.body as { data: Row<T>[] }).data.map((row) => row.record)
}

async function attendanceOn(client: ApiClient, day: string) {
  const records = await list<AttendanceRecord>(
    client,
    `attendance?pageSize=100&classId=${CLASS_ID}&dateFrom=${day}&dateTo=${day}`,
  )
  return new Map(records.map((item) => [item.studentId, item]))
}

/** Menü kategorisini açar (kapalıysa); açık kategori tıklamayla kapanmasın. */
async function openMenuGroup(page: Page, name: string) {
  const group = page.getByRole('navigation', { name: 'Menü' }).getByRole('button', { name })
  if ((await group.getAttribute('aria-expanded')) === 'false') await group.click()
}

function attendancePosts(page: Page): Request[] {
  const requests: Request[] = []
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === `/api/v1/classes/${CLASS_ID}/attendance`
    )
      requests.push(request)
  })
  return requests
}

test('yönetici geçmiş günü gerekçeyle düzeltir; değer ve geçmiş kalır (DOM-AKD-035)', async ({
  page,
  loginAs,
  api,
  tenant,
}) => {
  const today = dayOf(new Date())
  const day = shiftDays(today, -RECORDED_AGO)
  const school = await tenant({
    roles: [],
    classes: [CLASS_ID],
    records: recordedDayRecords(day),
  })
  const admin = school.user('yonetici')
  await loginAs(admin)
  const client = await api(admin)
  const before = await attendanceOn(client, day)
  const students = (await list<StudentRecord>(client, 'students?pageSize=100')).filter(
    (s) => s.classId === CLASS_ID && s.isActive,
  )
  const student = students.find((s) => before.has(s.id))!
  const previous = before.get(student.id)!.status
  const next = previous === 'absent' ? 'excused' : 'absent'
  const posts = attendancePosts(page)

  // İleri tarihli adres bugüne düşer; seçici bugünden ileriyi kabul etmez.
  await page.goto(`/yonetici/yoklama-duzeltme?sinif=${CLASS_ID}&tarih=${shiftDays(today, 3)}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Yoklama Düzeltme' })).toBeVisible()
  await openMenuGroup(page, 'Yönetim')
  await expect(
    page.getByRole('navigation', { name: 'Menü' }).getByRole('link', { name: 'Yoklama Düzeltme' }),
  ).toBeVisible()
  const dayInput = page.getByLabel('Yoklama günü')
  await expect(dayInput).toHaveValue(today)
  await expect(dayInput).toHaveAttribute('max', today)

  await dayInput.fill(day)
  await expect(page).toHaveURL(new RegExp(`tarih=${day}`))
  const row = page
    .getByRole('list', { name: '6-A öğrencileri' })
    .getByRole('listitem')
    .filter({ hasText: student.name })
  await expect(row).toContainText(`Mevcut: ${STATUS_LABELS[previous]}`)
  const save = page.getByRole('button', { name: 'Düzeltmeyi kaydet' })
  await expect(save).toBeDisabled()

  await page.getByRole('radio', { name: `${student.name}: ${STATUS_LABELS[next]}` }).click()
  await expect(row).toContainText('Değişecek')
  await expect(save).toBeEnabled()

  // Gerekçesiz gönderim istemcide durur: alan hatası, istek yok.
  await save.click()
  await expect(page.getByText('Düzeltme için gerekçe yazın.')).toBeVisible()
  expect(posts).toHaveLength(0)

  const reason = 'Veli rapor getirdi'
  await page.getByLabel('Düzeltme gerekçesi').fill(reason)
  await save.click()
  await expect(page.getByText('Yoklama düzeltildi.')).toBeVisible()
  expect(posts).toHaveLength(1)
  expect(posts[0]?.headers()['if-match']).toMatch(/^"\d+"$/)

  const after = await attendanceOn(client, day)
  expect(after.size).toBe(before.size)
  expect(after.get(student.id)?.status).toBe(next)
  expect(after.get(student.id)?.corrections?.at(-1)).toMatchObject({
    previousStatus: previous,
    status: next,
    reason,
  })
  for (const [id, record] of before)
    if (id !== student.id) expect(after.get(id)?.status, id).toBe(record.status)

  const history = page.getByRole('list', { name: 'Bu günün düzeltmeleri' })
  await expect(history).toContainText(
    `${student.name}: ${STATUS_LABELS[previous]} → ${STATUS_LABELS[next]}`,
  )
  await expect(history).toContainText(`Gerekçe: ${reason}`)
  await expect(history).toContainText(admin.name)

  // Yeniden yüklenince kayıtlı değer gelir; değişiklik kalmadığı için kaydetme kapalıdır.
  await page.reload()
  await expect(row).toContainText(`Mevcut: ${STATUS_LABELS[next]}`)
  await expect(
    page.getByRole('radio', { name: `${student.name}: ${STATUS_LABELS[next]}` }),
  ).toHaveAttribute('aria-checked', 'true')
  await expect(save).toBeDisabled()

  // Dar ekranda satırlar ve geçmiş yeniden akar; yatay taşma yok.
  await page.setViewportSize({ width: 390, height: 844 })
  await expectNoHorizontalOverflow(page)
})

test('öğretmen yoklama düzeltme sayfasını menüde görmez ve adresine giremez', async ({
  page,
  loginAs,
}) => {
  await loginAs('ogretmen')
  await page.goto('/ogretmen/dashboard')
  const menu = page.getByRole('navigation', { name: 'Menü' })
  await openMenuGroup(page, 'Akademik')
  await expect(menu.getByRole('link', { name: 'Yoklama', exact: true })).toBeVisible()
  await expect(menu.getByRole('link', { name: 'Yoklama Düzeltme' })).toHaveCount(0)

  await page.goto('/yonetici/yoklama-duzeltme')
  await expect(page).toHaveURL(/\/ogretmen\/dashboard$/)
  await page.goto('/ogretmen/yoklama-duzeltme')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Bu sayfa kampüste bulunamadı.' }),
  ).toBeVisible()
})

/** Yönetici API istemcisiyle bir modülü açar/kapatır (`If-Match` ayar sürümüdür). */
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

test('yoklaması alınmamış günde her öğrenci açıkça seçilir; ilk yoklamada gerekçe saklanmaz (DOM-AKD-035)', async ({
  page,
  loginAs,
  api,
  tenant,
}) => {
  const today = dayOf(new Date())
  const day = shiftDays(today, -EMPTY_AGO)
  const school = await tenant({ roles: [], classes: [CLASS_ID] })
  const admin = school.user('yonetici')
  await loginAs(admin)
  const client = await api(admin)
  const students = classStudents()
  expect((await attendanceOn(client, day)).size, 'gün hiç alınmamış olmalı').toBe(0)
  const posts = attendancePosts(page)

  await page.goto(`/yonetici/yoklama-duzeltme?sinif=${CLASS_ID}&tarih=${day}`)
  const list = page.getByRole('list', { name: '6-A öğrencileri' })
  const rows = list.getByRole('listitem')
  await expect(rows).toHaveCount(students.length)
  await expect(
    page.getByRole('status').filter({ hasText: 'Bu gün için yoklama alınmamış' }),
  ).toContainText('İlk yoklamada gerekçe saklanmaz.')
  // Varsayılan durum yok: hiçbir seçenek seçili gelmez, her satır seçim bekler.
  await expect(list.getByRole('radio', { checked: true })).toHaveCount(0)
  await expect(list.getByText('Seçim bekliyor')).toHaveCount(students.length)
  const save = page.getByRole('button', { name: 'Düzeltmeyi kaydet' })
  const reasonField = page.getByLabel('Düzeltme gerekçesi')
  await reasonField.fill('Öğretmen yoklamayı atlamış')
  await expect(save).toBeDisabled()

  // Tek öğrenciyi seçmek yetmez; eksik satır varken kayıt kapalı kalır.
  const first = students[0]!
  const second = students[1]!
  await page.getByRole('radio', { name: `${first.name}: ${STATUS_LABELS.absent}` }).click()
  await expect(save).toBeDisabled()
  await expect(page.getByText(`${students.length - 1} öğrencinin durumu seçilmedi`)).toBeVisible()

  // Toplu eylem yalnız seçilmeyenleri Geldi yapar; verilmiş seçim korunur.
  await page.getByRole('button', { name: 'Seçilmeyenleri Geldi işaretle' }).click()
  await expect(page.getByRole('button', { name: 'Seçilmeyenleri Geldi işaretle' })).toHaveCount(0)
  await expect(
    page.getByRole('radio', { name: `${first.name}: ${STATUS_LABELS.absent}` }),
  ).toHaveAttribute('aria-checked', 'true')
  await expect(
    page.getByRole('radio', { name: `${second.name}: ${STATUS_LABELS.present}` }),
  ).toHaveAttribute('aria-checked', 'true')
  await expect(save).toBeEnabled()

  await save.click()
  await expect(page.getByText('Yoklama kaydedildi. İlk yoklamada gerekçe saklanmaz.')).toBeVisible()
  expect(posts).toHaveLength(1)

  const written = await attendanceOn(client, day)
  expect(written.size).toBe(students.length)
  expect(written.get(first.id)?.status).toBe('absent')
  for (const student of students.slice(1))
    expect(written.get(student.id)?.status, student.name).toBe('present')
  // İlk kayda gerekçe ve düzelten yazılmaz; düzeltme geçmişi boştur.
  for (const record of written.values()) expect(record.corrections ?? []).toHaveLength(0)
  await expect(page.getByText('Bu günün yoklaması düzeltilmemiş.')).toBeVisible()
  // Denetim kaydı işlemi taşır ama gerekçe metnini taşımaz (yalnız alan adları).
  const audit = await client.get('/api/v1/audit-events?pageSize=50')
  expect(audit.status).toBe(200)
  expect(JSON.stringify(audit.body)).toContain('attendance.record')
  expect(JSON.stringify(audit.body)).not.toContain('Öğretmen yoklamayı atlamış')
})

test('kirli formdan sınıf ya da gün değiştirmek ve geri gitmek onay ister', async ({
  page,
  loginAs,
  tenant,
}) => {
  const today = dayOf(new Date())
  const day = shiftDays(today, -RECORDED_AGO)
  const school = await tenant({
    roles: [],
    classes: [CLASS_ID],
    records: recordedDayRecords(day),
  })
  await loginAs(school.user('yonetici'))
  const students = classStudents()
  const student = students[1]!
  const change = page.getByRole('radio', { name: `${student.name}: ${STATUS_LABELS.late}` })
  const dialog = page.getByRole('alertdialog', { name: 'Kaydedilmemiş değişiklikler var' })
  const dayInput = page.getByLabel('Yoklama günü')

  // Temiz formda gezinmek onay istemez (geçmiş girdisi de oluşur).
  await page.goto(`/yonetici/yoklama-duzeltme?sinif=${CLASS_ID}&tarih=${shiftDays(today, -1)}`)
  await dayInput.fill(day)
  await expect(page).toHaveURL(new RegExp(`tarih=${day}`))
  await expect(dialog).toHaveCount(0)

  await change.click()
  await page.getByLabel('Düzeltme gerekçesi').fill('Geç geldi')

  // Gün değiştirme: vazgeçince adres, işaret ve gerekçe korunur.
  await dayInput.fill(shiftDays(day, -1))
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Düzenlemeye devam et' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`tarih=${day}`))
  await expect(dayInput).toHaveValue(day)
  await expect(change).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByLabel('Düzeltme gerekçesi')).toHaveValue('Geç geldi')

  // Geri gitmek de onay ister; vazgeçince yerinde kalır.
  await page.goBack()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Düzenlemeye devam et' }).click()
  await expect(page).toHaveURL(new RegExp(`tarih=${day}`))
  await expect(change).toHaveAttribute('aria-checked', 'true')

  // Değişiklikleri atınca gezinme sürer ve form sıfırlanır.
  await page.getByRole('combobox', { name: /^Sınıf/ }).selectOption('')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Değişiklikleri at' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).not.toHaveURL(/sinif=/)
  await page.goto(`/yonetici/yoklama-duzeltme?sinif=${CLASS_ID}&tarih=${day}`)
  await expect(page.getByRole('button', { name: 'Düzeltmeyi kaydet' })).toBeDisabled()
  await expect(page.getByLabel('Düzeltme gerekçesi')).toHaveValue('')
})

test('academic kapalıyken yoklama düzeltme menüden, adresten ve uçtan kapanır, açılınca döner', async ({
  loginAs,
  api,
  tenant,
}) => {
  const school = await tenant({ roles: [], classes: [CLASS_ID] })
  const adminUser = school.user('yonetici')
  const admin = await api(adminUser)
  await setModule(admin, 'academic', false)

  const page = await loginAs(adminUser)
  const menu = page.getByRole('navigation', { name: 'Menü' })
  await page.goto(`/yonetici/yoklama-duzeltme?sinif=${CLASS_ID}`)
  await expect(page).toHaveURL(/\/yonetici\/dashboard$/)
  await expect(page.getByText('Bu modül kurum ayarlarından kapatılmış.')).toBeVisible()
  await openMenuGroup(page, 'Yönetim')
  await expect(menu.getByRole('link', { name: 'Yoklama Düzeltme' })).toHaveCount(0)
  const denied = await admin.context.post(`/api/v1/classes/${CLASS_ID}/attendance`, {
    data: { date: shiftDays(dayOf(new Date()), -1), marks: {}, reason: 'Deneme' },
    headers: { 'idempotency-key': randomUUID(), 'if-match': '"1"' },
  })
  expect(denied.status()).toBe(403)
  expect(((await denied.json()) as { code: string }).code).toBe('module_disabled')

  await setModule(admin, 'academic', true)
  await page.goto(`/yonetici/yoklama-duzeltme?sinif=${CLASS_ID}`)
  await expect(page).toHaveURL(/\/yonetici\/yoklama-duzeltme/)
  await expect(page.getByRole('heading', { level: 1, name: 'Yoklama Düzeltme' })).toBeVisible()
  await openMenuGroup(page, 'Yönetim')
  await expect(menu.getByRole('link', { name: 'Yoklama Düzeltme' })).toBeVisible()
})

test('ön büro yoklama düzeltme sayfasını menüde görmez ve adresine giremez', async ({
  page,
  loginAs,
}) => {
  await loginAs('onburo')
  await page.goto('/onburo/dashboard')
  const menu = page.getByRole('navigation', { name: 'Menü' })
  for (const group of await menu.getByRole('button').all()) {
    if ((await group.getAttribute('aria-expanded')) === 'false') await group.click()
  }
  await expect(menu.getByRole('link', { name: 'Yoklama Düzeltme' })).toHaveCount(0)

  await page.goto('/yonetici/yoklama-duzeltme')
  await expect(page).toHaveURL(/\/onburo\/dashboard$/)
  await page.goto('/onburo/yoklama-duzeltme')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Bu sayfa kampüste bulunamadı.' }),
  ).toBeVisible()
})
