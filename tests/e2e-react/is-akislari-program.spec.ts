import { randomUUID } from 'node:crypto'

import type { Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'

// Program yönetimi: yazan test kendi kurumunu kurar (`tenant`, ders kaydı yok) ve uzak bir haftaya
// kendi dersini planlar. Tohumdaki ~1440 ders kaydı okuma testinde (öğretmen) kullanılır.

interface Row<T> {
  id: string
  version: number
  record: T
}
interface LessonRecord {
  room: string
  cancelledAt?: string | null
}

/** Bugünden `days` gün sonrası: `YYYY-MM-DD` ve o haftanın pazartesisi. */
function farDay(days: number): { day: string; monday: string } {
  const date = new Date(Date.now() + days * 86_400_000)
  const key = (value: Date) => value.toISOString().slice(0, 10)
  const shift = (date.getUTCDay() + 6) % 7
  return { day: key(date), monday: key(new Date(date.getTime() - shift * 86_400_000)) }
}

async function lessonsInRoom(client: ApiClient, room: string): Promise<Row<LessonRecord>[]> {
  const found: Row<LessonRecord>[] = []
  for (let page = 1; ; page++) {
    const result = await client.get(`/api/v1/collections/schedule?pageSize=100&page=${page}`)
    expect(result.status).toBe(200)
    const body = result.body as { data: Row<LessonRecord>[] }
    found.push(...body.data.filter((row) => row.record.room === room))
    if (body.data.length < 100) return found
  }
}

async function weekHasRoom(page: Page, monday: string, room: string): Promise<boolean> {
  await page.goto(`/ogrenci/ders-programi?hafta=${monday}`)
  await expect(page.getByRole('list', { name: 'Haftalık ders programı' })).toBeVisible()
  return (await page.getByRole('button', { name: /dk/ }).filter({ hasText: room }).count()) > 0
}

test.describe('program yönetimi', () => {
  test('yönetici ders planlar, iptal eder; iptal ders programlarda görünmez', async ({
    loginAs,
    api,
    tenant,
  }) => {
    // Kurumda ders kaydı yoktur (tohum programı gerekmez); 7-A öğrencisi (s1) programı izler.
    const school = await tenant({ roles: ['yonetici', 'ogrenci'] })
    const admin = school.user('yonetici')
    const student = school.user('ogrenci')
    const page = await loginAs(admin)
    const client = await api(admin)
    const room = `E2E-${randomUUID().slice(0, 6)}`
    const { day, monday } = farDay(120)
    await page.goto('/yonetici/program-yonetimi')
    await expect(page.getByRole('heading', { name: 'Program Yönetimi', level: 2 })).toBeVisible()
    await page.getByRole('button', { name: 'Ders planla' }).click()
    const form = page.getByRole('dialog', { name: 'Ders planla' })
    await form.getByLabel('Sınıf').selectOption({ label: '7-A · Kadıköy Kampüsü' })
    await form.getByLabel('Ders', { exact: true }).selectOption({ label: 'Matematik' })
    await form.getByLabel('Öğretmen').selectOption({ index: 1 })
    await form.getByLabel('Ders başlangıcı').fill(`${day}T09:00`)
    await form.getByLabel('Süre (dakika)').fill('40')
    await form.getByLabel('Derslik').fill(room)
    await form.getByRole('button', { name: 'Kontrol et' }).click()
    await form.getByRole('button', { name: 'Onayla ve kaydet' }).click()
    await expect(form).toBeHidden()
    await expect.poll(async () => (await lessonsInRoom(client, room)).length).toBe(1)

    // Öğrenci (7-A) planlanan dersi kendi haftalık programında görür. Tek tarayıcı bağlamı
    // olduğundan oturum sırayla değiştirilir.
    await loginAs(student)
    await expect.poll(() => weekHasRoom(page, monday, room)).toBe(true)

    await loginAs(admin)
    await page.goto('/yonetici/program-yonetimi')
    await page.getByLabel('Tabloda ara').fill(room)
    await page.getByRole('button', { name: 'Matematik' }).click()
    await page
      .getByRole('dialog', { name: 'Matematik' })
      .getByRole('button', { name: 'Dersi iptal et' })
      .click()
    const cancel = page.getByRole('dialog', { name: 'Dersi iptal et' })
    await cancel.getByRole('button', { name: 'Kontrol et' }).click()
    await cancel.getByRole('button', { name: 'Onayla ve kaydet' }).click()
    await expect(cancel).toBeHidden()
    await expect
      .poll(async () => (await lessonsInRoom(client, room))[0]?.record.cancelledAt)
      .toBeTruthy()

    // Yönetim listesinde iptal kaydı korunur; günlük programda ders yoktur.
    await expect(page.getByText('İptal', { exact: true }).first()).toBeVisible()
    await loginAs(student)
    await expect.poll(() => weekHasRoom(page, monday, room)).toBe(false)
  })

  test('öğretmen yalnız kendi derslerini yönetir ama ders planlayamaz', async ({ loginAs }) => {
    const page = await loginAs('ogretmen')
    await page.goto('/ogretmen/program-yonetimi')
    await expect(page.getByText('Görev kapsamınızdaki kayıtlar')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Ders planla' })).toHaveCount(0)
    await expect(page.getByText(/^\d+ kayıt/)).toBeVisible()
  })
})
