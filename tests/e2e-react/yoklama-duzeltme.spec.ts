import type { Page, Request } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Yönetici yoklama düzeltmesi (IST-093, DOM-AKD-035): yönetici geçmiş günün yoklamasını gerekçeyle
// düzeltir; değer ve düzeltme geçmişi API'de kalır. Öğretmen sayfayı menüde görmez, adrese de
// giremez. Yazan test kendi kurumunu kurar (`tenant`: seed'in 6-A sınıfı c3 ve geçmiş yoklaması).

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

/** Sınıfın son iki haftadaki en yakın geçmiş yoklama günü ve o günün kayıtları. */
async function latestPastDay(client: ApiClient, today: string) {
  const records = await list<AttendanceRecord>(
    client,
    `attendance?pageSize=100&classId=${CLASS_ID}&dateFrom=${shiftDays(today, -14)}&dateTo=${shiftDays(today, -1)}`,
  )
  const day = records
    .map((item) => dayOf(item.date))
    .sort()
    .at(-1)
  expect(day, 'seed sınıfında geçmiş yoklama olmalı').toBeTruthy()
  return day!
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
  const school = await tenant({ roles: [], classes: [CLASS_ID] })
  const admin = school.user('yonetici')
  await loginAs(admin)
  const client = await api(admin)
  const today = dayOf(new Date())
  const day = await latestPastDay(client, today)
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
