import { randomUUID } from 'node:crypto'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'

// Kayıt yenileme: yenileme planlama ile dönem geçişi (sınıf değişimi) ayrı işlemlerdir. Her test
// kendi öğrencisini kullanır (aynı öğrenci için aynı yıla ikinci yenileme reddedilir): s3
// (Zeynep, 6-A → 7-A) yalnız planlanır, s4 (Arda, 8-A → 9-A) geçişi uygulanır.

interface Row<T> {
  id: string
  version: number
  record: T
}
interface RenewalRecord {
  studentId: string
  status: string
  amount: number
  year: number
}
interface StudentRecord {
  classId: string
}

async function listOf<T>(client: ApiClient, collection: string): Promise<Row<T>[]> {
  const result = await client.get(`/api/v1/collections/${collection}?pageSize=100`)
  expect(result.status).toBe(200)
  return (result.body as { data: Row<T>[] }).data
}

async function renewalOf(client: ApiClient, studentId: string) {
  return (await listOf<RenewalRecord>(client, 'renewals')).find(
    (row) => row.record.studentId === studentId,
  )
}

async function classOf(client: ApiClient, studentId: string) {
  const result = await client.get(`/api/v1/collections/students/${studentId}`)
  expect(result.status).toBe(200)
  return (result.body as { data: Row<StudentRecord> }).data.record.classId
}

function nextDay(offset: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(
    new Date(Date.now() + offset * 86_400_000),
  )
}

test.describe('kayıt yenileme', () => {
  test('yönetici ücret özetini görür, yenilemeyi planlar; sınıf değişmez', async ({
    loginAs,
    api,
  }) => {
    const page = await loginAs('yonetici', { fresh: true })
    const client = await api('yonetici', { fresh: true })
    await page.goto('/yonetici/kayit-yenileme')
    await expect(page.getByRole('heading', { name: 'Kayıt Yenileme', level: 2 })).toBeVisible()
    await page.getByRole('button', { name: 'Kayıt yenile' }).click()
    const form = page.getByRole('dialog', { name: 'Kayıt yenile' })
    await form.getByLabel('Öğrenci', { exact: true }).selectOption({ label: 'Zeynep Demir · 6-A' })
    await form.getByLabel('Yeni sınıf').selectOption({ label: '7-A · Kadıköy Kampüsü' })
    await form.getByLabel('Brüt eğitim bedeli (₺)').fill('30000')
    await form.getByLabel('Burs oranı (%)').fill('10')
    await form.getByLabel('Ek indirim (₺)').fill('500')
    await form.getByLabel('Taksit sayısı').fill('6')
    await form.getByLabel('İlk taksit tarihi').fill(nextDay(30))
    // 30.000 ₺ − %10 burs (3.000 ₺) − 500 ₺ indirim = 26.500 ₺; sayı core `renewalQuote`'tan gelir.
    const summary = form.getByRole('region', { name: 'Yeni dönem ödeme özeti' })
    await expect(summary.getByText(/Net eğitim bedeli: 26\.500,00 ₺/)).toBeVisible()
    await expect(summary.getByText('6 taksit')).toBeVisible()

    await form.getByRole('button', { name: 'Kontrol et' }).click()
    await form.getByRole('button', { name: 'Onayla ve kaydet' }).click()
    await expect(form).toBeHidden()

    await expect.poll(async () => (await renewalOf(client, 's3'))?.record.status).toBe('Planlandı')
    expect((await renewalOf(client, 's3'))?.record.amount).toBe(2_650_000)
    // Yenileme planlamak sınıfı değiştirmez; geçiş ayrı işlemdir.
    expect(await classOf(client, 's3')).toBe('c3')
    await page.getByLabel('Tabloda ara').fill('Zeynep Demir')
    await page.getByRole('button', { name: 'Zeynep Demir' }).click()
    const detail = page.getByRole('dialog', { name: 'Zeynep Demir' })
    await expect(detail.getByText('1. taksit')).toBeVisible()
    await expect(detail.getByRole('button', { name: 'Dönem geçişini uygula' })).toBeVisible()
  })

  test('dönem geçişi ayrı işlemle uygulanır ve sınıfı değiştirir', async ({ loginAs, api }) => {
    const client = await api('yonetici', { fresh: true })
    // Yenileme `Idempotency-Key` zorunlu kılar; ortak istemci başlık eklemediği için doğrudan gönderilir.
    const created = await client.context.post('/api/v1/workflows/renewal', {
      headers: { 'idempotency-key': randomUUID() },
      failOnStatusCode: false,
      data: {
        studentId: 's4',
        targetClassId: 'c5',
        year: 2027,
        mode: 'renew',
        total: 28500,
        scholarship: 0,
        discount: 0,
        count: 8,
        startDate: nextDay(30),
      },
    })
    expect(created.status()).toBeLessThan(300)
    expect(await classOf(client, 's4')).toBe('c4')

    const page = await loginAs('yonetici', { fresh: true })
    await page.goto('/yonetici/kayit-yenileme')
    await page.getByLabel('Tabloda ara').fill('Arda Çelik')
    await page.getByRole('button', { name: 'Arda Çelik' }).click()
    await page
      .getByRole('dialog', { name: 'Arda Çelik' })
      .getByRole('button', { name: 'Dönem geçişini uygula' })
      .click()
    const confirm = page.getByRole('dialog', { name: 'Dönem geçişini uygula' })
    await confirm.getByRole('button', { name: 'Kontrol et' }).click()
    await confirm.getByRole('button', { name: 'Onayla ve kaydet' }).click()
    await expect(confirm).toBeHidden()

    await expect.poll(async () => classOf(client, 's4')).toBe('c5')
    expect((await renewalOf(client, 's4'))?.record.status).not.toBe('Planlandı')
  })

  test('veli yenileme işlemi göremez; liste kapsamına daralır', async ({ loginAs }) => {
    const page = await loginAs('veli')
    await page.goto('/veli/kayit-yenileme?cocuk=s1')
    await expect(page.getByText('Seçili çocuğunuzun kayıtları')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Kayıt yenile' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Zeynep Demir' })).toHaveCount(0)
  })
})
