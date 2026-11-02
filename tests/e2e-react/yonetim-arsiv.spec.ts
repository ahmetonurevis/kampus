import { randomUUID } from 'node:crypto'

import type { Locator, Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'

// Dolu arşiv senaryosu (IST-010; CLAUDE.md "Kampüs/sınıf/kadro arşivi"): bağlı kayıtları olan
// sınıf, öğretmen ve kampüs arşivlenirken aktarım hedefi seçilir; uygun olmayan hedefin core
// mesajı seçimin altında görünür ve hiçbir kayıt değişmez; arşivden geri almak aktarılanları geri
// taşımaz. Her test kendi kurumunu kurar (seed kimlikleri: 7-A c1 Kadıköy, 7-B c9 Beşiktaş, 7-C
// c17 Ataşehir; Selin Kaya t1 matematik, Aylin Özer t17 matematik Beşiktaş). Kalıcılık API'den.

const COLLECTIONS = '/api/v1/collections'
const CLASSES_URL = '/yonetici/subeler'
const STAFF_URL = '/yonetici/personel'

interface Row<T> {
  id: string
  version: number
  record: T
}
interface ActiveRecord {
  id: string
  isActive: boolean
}
interface StudentRecord extends ActiveRecord {
  classId: string
}
interface AssignmentRecord {
  id: string
  classId: string
  teacherId: string
}
interface ClassRecord extends ActiveRecord {
  branchId: string
  teacherId: string
}

async function list<T>(client: ApiClient, path: string): Promise<Row<T>[]> {
  const result = await client.get(`${COLLECTIONS}/${path}`)
  expect(result.status, path).toBe(200)
  return (result.body as { data: Row<T>[] }).data
}

async function one<T>(client: ApiClient, path: string): Promise<Row<T>> {
  const result = await client.get(`${COLLECTIONS}/${path}`)
  expect(result.status, path).toBe(200)
  return (result.body as { data: Row<T> }).data
}

const studentsOf = async (client: ApiClient, classId: string) =>
  (await list<StudentRecord>(client, `students?classId=${classId}&pageSize=100`)).filter(
    (row) => row.record.isActive,
  )

/** Arşiv penceresindeki bağlı kayıt özeti paragrafı. */
const dependents = (dialog: Locator) =>
  dialog.getByRole('paragraph').filter({ hasText: 'Bağlı aktif kayıtlar:' })

const toast = (page: Page, text: string | RegExp) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text })

test.describe('yönetici: dolu arşiv (IST-010)', () => {
  test('öğrencili sınıf başka sınıfa aktarılarak arşivlenir; yetersiz kontenjan alanda görünür', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici'], classes: ['c1', 'c9'] })
    const client = await api(school.user('yonetici'))
    const moving = await studentsOf(client, 'c1')
    expect(moving).toHaveLength(10)
    // 7-B'de 10 öğrenci var; kontenjan 12'ye inince 7-A'nın 10 öğrencisi sığmaz.
    const target = await one<ClassRecord>(client, 'classes/c9')
    const patched = await client.context.fetch('/api/v1/classes/c9', {
      method: 'PATCH',
      data: { capacity: 12 },
      headers: { 'if-match': `"${target.version}"`, 'idempotency-key': randomUUID() },
      failOnStatusCode: false,
    })
    expect(patched.status(), 'kontenjan kurulumu').toBe(200)

    await loginAs(school.user('yonetici'))
    await page.goto(CLASSES_URL)
    await page.getByLabel('Tabloda ara').fill('7-A')
    await page.getByRole('button', { name: '7-A arşivle' }).click()
    const dialog = page.getByRole('dialog', { name: 'Kaydı arşivle' })
    await expect(dependents(dialog)).toContainText('10 öğrenci')
    const select = dialog.getByLabel('Aktarım hedefi')
    await expect(select.locator('option').first()).toHaveText('Aktarım hedefi seçin')
    // Yalnız aynı düzeydeki aktif sınıflar, boş yeriyle.
    await expect(select.locator('option')).toHaveText([
      'Aktarım hedefi seçin',
      '7-B · Beşiktaş Kampüsü · 2 boş yer',
      '7-C · Ataşehir Kampüsü · 24 boş yer',
    ])

    await select.selectOption('c9')
    await dialog.getByRole('button', { name: 'Arşivlemeyi tamamla' }).click()
    await expect(page.locator('#arsiv-hedef-hata')).toHaveText(
      'Hedef sınıfta tüm öğrenciler için yeterli kontenjan yok.',
    )
    await expect(select).toBeFocused()
    await expect(toast(page, /kontenjan/)).toHaveCount(0)
    await expect(dialog).toBeVisible()
    expect((await one<ClassRecord>(client, 'classes/c1')).record.isActive).toBe(true)
    expect(await studentsOf(client, 'c1')).toHaveLength(10)

    await select.selectOption('c17')
    await dialog.getByRole('button', { name: 'Arşivlemeyi tamamla' }).click()
    await expect(toast(page, '7-A arşivlendi. 10 öğrenci 7-C hedefine aktarıldı.')).toBeVisible()
    await expect(dialog).toBeHidden()
    expect((await one<ClassRecord>(client, 'classes/c1')).record.isActive).toBe(false)
    const moved = await studentsOf(client, 'c17')
    expect(moved.map((row) => row.id).sort()).toEqual(moving.map((row) => row.id).sort())
    expect(await studentsOf(client, 'c9')).toHaveLength(10)
  })

  test('branş ataması olan öğretmen arşivlenir, görevleri aktarılır; arşivden geri alınır', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici'], classes: ['c1'] })
    const client = await api(school.user('yonetici'))
    const lessons = await list<AssignmentRecord>(client, 'assignments?teacherId=t1&pageSize=100')
    expect(lessons).toHaveLength(8)
    const advised = (await list<ClassRecord>(client, 'classes?pageSize=100')).filter(
      (row) => row.record.teacherId === 't1',
    )
    expect(advised).toHaveLength(4)

    await loginAs(school.user('yonetici'))
    await page.goto(STAFF_URL)
    await page.getByLabel('Tabloda ara').fill('Selin Kaya')
    await page.getByRole('button', { name: 'Selin Kaya arşivle' }).click()
    const dialog = page.getByRole('dialog', { name: 'Kaydı arşivle' })
    await expect(dependents(dialog)).toContainText('8 ders ataması, 4 sınıf danışmanlığı')
    const select = dialog.getByLabel('Aktarım hedefi')
    // Yalnız aynı branştaki (matematik) aktif öğretmenler.
    await expect(select.locator('option')).toHaveText([
      'Aktarım hedefi seçin',
      'Aylin Özer · Beşiktaş Kampüsü',
      'Aylin Güler · Ataşehir Kampüsü',
    ])

    // Hedefsiz: branş kuralı seçimin altında, kayıt değişmez.
    await dialog.getByRole('button', { name: 'Arşivlemeyi tamamla' }).click()
    await expect(page.locator('#arsiv-hedef-hata')).toHaveText(
      'Aynı branştan aktif bir öğretmen seçerek görevleri devredin.',
    )
    await expect(toast(page, /arşivlendi/)).toHaveCount(0)
    expect((await one<ActiveRecord>(client, 'teachers/t1')).record.isActive).toBe(true)

    await select.selectOption('t17')
    await dialog.getByRole('button', { name: 'Arşivlemeyi tamamla' }).click()
    const done = toast(page, 'Selin Kaya arşivlendi.')
    // Sayım sırası sunucunun değişiklik sırasıdır; parçalar ayrı denetlenir.
    await expect(done).toContainText('8 ders ataması')
    await expect(done).toContainText('4 sınıf')
    await expect(done).toContainText('Aylin Özer hedefine aktarıldı.')
    await expect(dialog).toBeHidden()
    expect((await one<ActiveRecord>(client, 'teachers/t1')).record.isActive).toBe(false)
    const handed = await list<AssignmentRecord>(client, 'assignments?teacherId=t17&pageSize=100')
    for (const lesson of lessons)
      expect(
        handed.some((row) => row.id === lesson.id),
        lesson.id,
      ).toBe(true)
    for (const row of advised)
      expect((await one<ClassRecord>(client, `classes/${row.id}`)).record.teacherId).toBe('t17')

    // Arşiv sekmesinden geri al; devredilen görevler Aylin Özer'de kalır.
    await page
      .getByRole('toolbar', { name: 'Kayıt durumu' })
      .getByRole('button', { name: 'Arşiv' })
      .click()
    await expect(page.getByText('aktarılan öğrenci ve görevler geri taşınmaz')).toBeVisible()
    await page.getByRole('button', { name: 'Selin Kaya geri al' }).click()
    await expect(toast(page, 'Selin Kaya yeniden etkinleştirildi.')).toContainText('geri taşınmaz')
    expect((await one<ActiveRecord>(client, 'teachers/t1')).record.isActive).toBe(true)
    expect(await list<AssignmentRecord>(client, 'assignments?teacherId=t1&pageSize=100')).toEqual(
      [],
    )
    expect((await one<ClassRecord>(client, 'classes/c1')).record.teacherId).toBe('t17')
  })

  test('kampüs arşivinde sınıf ve öğretmenler hedef kampüse geçer; kampüs geri alınır', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici'], classes: ['c17'] })
    const client = await api(school.user('yonetici'))
    const ownClasses = (await list<ClassRecord>(client, 'classes?branchId=b3&pageSize=100')).filter(
      (row) => row.record.isActive,
    )
    expect(ownClasses).toHaveLength(8)

    await loginAs(school.user('yonetici'))
    await page.goto(CLASSES_URL)
    await page.getByRole('button', { name: 'Ataşehir Kampüsü arşivle' }).click()
    const dialog = page.getByRole('dialog', { name: 'Kaydı arşivle' })
    await expect(dependents(dialog)).toContainText('8 sınıf, 10 öğrenci, 16 öğretmen')
    await dialog.getByRole('button', { name: 'Arşivlemeyi tamamla' }).click()
    await expect(page.locator('#arsiv-hedef-hata')).toHaveText(
      'Sınıf ve öğretmenlerin aktarılacağı aktif kampüsü seçin.',
    )
    expect((await one<ActiveRecord>(client, 'branches/b3')).record.isActive).toBe(true)

    await dialog.getByLabel('Aktarım hedefi').selectOption({ label: 'Kadıköy Kampüsü' })
    await dialog.getByRole('button', { name: 'Arşivlemeyi tamamla' }).click()
    const done = toast(page, 'Ataşehir Kampüsü arşivlendi.')
    await expect(done).toContainText('8 sınıf')
    await expect(done).toContainText('16 öğretmen')
    await expect(done).toContainText('Kadıköy Kampüsü hedefine aktarıldı.')
    expect((await one<ActiveRecord>(client, 'branches/b3')).record.isActive).toBe(false)
    for (const row of ownClasses)
      expect((await one<ClassRecord>(client, `classes/${row.id}`)).record.branchId).toBe('b1')

    await page
      .getByRole('toolbar', { name: 'Kayıt durumu' })
      .getByRole('button', { name: 'Arşiv' })
      .click()
    await page.getByRole('button', { name: 'Ataşehir Kampüsü geri al' }).click()
    await expect(toast(page, 'Ataşehir Kampüsü yeniden etkinleştirildi.')).toBeVisible()
    expect((await one<ActiveRecord>(client, 'branches/b3')).record.isActive).toBe(true)
    // Aktarılan sınıflar Kadıköy'de kalır.
    expect((await one<ClassRecord>(client, 'classes/c17')).record.branchId).toBe('b1')
  })
})
