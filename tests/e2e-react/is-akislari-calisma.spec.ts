import { randomUUID } from 'node:crypto'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'

// Çalışma planı: öğrenci planı öğretmen onayına açar, onaylanınca teslim eder; veli yalnız
// seçili çocuğun görevlerini görür. Yazan test kendi kurumunu kurar (`tenant`); veli okuma testi
// tohum kurumunda study-s2 görevini okur.

const TASKS = '/api/v1/collections/studyTasks?pageSize=100'

interface Row<T> {
  id: string
  version: number
  record: T
}
interface TaskRecord {
  studentId: string
  title: string
  status: string
  completionNote: string
}

async function tasksTitled(client: ApiClient, title: string): Promise<Row<TaskRecord>[]> {
  const result = await client.get(TASKS)
  expect(result.status).toBe(200)
  return (result.body as { data: Row<TaskRecord>[] }).data.filter((row) =>
    row.record.title.startsWith(title),
  )
}

test.describe('çalışma planı', () => {
  test('öğrenci planı açar, öğretmen onaylar, öğrenci teslim eder', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici', 'ogrenci', 'ogretmen'],
      collections: ['studyTasks'],
    })
    const client = await api(school.user('yonetici'))
    const title = `E2E çalışma ${randomUUID().slice(0, 8)}`
    const page = await loginAs(school.user('ogrenci'))
    await page.goto('/ogrenci/calisma-plani')
    await expect(page.getByRole('heading', { name: 'Çalışma Planı', level: 2 })).toBeVisible()
    await page.getByRole('button', { name: 'Çalışma görevi ekle' }).click()
    const form = page.getByRole('dialog', { name: 'Çalışma görevi ekle' })
    await form.getByLabel('Çalışılacak konular').fill('Denklemler')
    await form.getByLabel('Görev başlığı').fill(title)
    await form.getByLabel('Çalışma yönergesi').fill('Beş soru çöz.')
    await form.getByRole('button', { name: 'Kontrol et' }).click()
    await form.getByRole('button', { name: 'Onayla ve kaydet' }).click()
    await expect(form).toBeHidden()
    await expect
      .poll(async () => (await tasksTitled(client, title))[0]?.record.status)
      .toBe('Onay bekliyor')

    // Onaylanmadan teslim edilemez; öğrenci planı kendisi onaylayamaz.
    await page.getByLabel('Tabloda ara').fill(title)
    await page.getByRole('button', { name: title }).click()
    const own = page.getByRole('dialog', { name: title })
    await expect(own.getByRole('button', { name: 'Çalışmayı teslim et' })).toHaveCount(0)
    await expect(own.getByRole('button', { name: 'Planı onayla' })).toHaveCount(0)

    await loginAs(school.user('ogretmen'))
    await page.goto('/ogretmen/calisma-plani')
    await page.getByLabel('Tabloda ara').fill(title)
    await page.getByRole('button', { name: title }).click()
    await page
      .getByRole('dialog', { name: title })
      .getByRole('button', { name: 'Planı onayla' })
      .click()
    const review = page.getByRole('dialog', { name: 'Planı onayla' })
    await review.getByLabel('Öğretmen geri bildirimi').fill('Uygun plan.')
    await review.getByRole('button', { name: 'Kontrol et' }).click()
    await review.getByRole('button', { name: 'Onayla ve kaydet' }).click()
    await expect(review).toBeHidden()
    await expect
      .poll(async () => (await tasksTitled(client, title))[0]?.record.status)
      .toBe('Onaylandı')

    await loginAs(school.user('ogrenci'))
    await page.goto('/ogrenci/calisma-plani')
    await page.getByLabel('Tabloda ara').fill(title)
    await page.getByRole('button', { name: title }).click()
    await page
      .getByRole('dialog', { name: title })
      .getByRole('button', { name: 'Çalışmayı teslim et' })
      .click()
    const submit = page.getByRole('dialog', { name: 'Çalışmayı teslim et' })
    await submit.getByLabel('Çalışma sonucu / öğrenci notu').fill('Sorular tamamlandı.')
    await submit.getByRole('button', { name: 'Kontrol et' }).click()
    await submit.getByRole('button', { name: 'Onayla ve kaydet' }).click()
    await expect(submit).toBeHidden()
    await expect
      .poll(async () => (await tasksTitled(client, title))[0]?.record.status)
      .toBe('Değerlendirme bekliyor')
  })

  test('veli yalnız seçili çocuğun görevini görür ve görev ekleyemez', async ({ loginAs }) => {
    const page = await loginAs('veli')
    await page.goto('/veli/calisma-plani?cocuk=s2')
    await expect(page.getByText('Seçili çocuğunuzun kayıtları')).toBeVisible()
    await expect(page.getByText(/^1 kayıt/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Çalışma görevi ekle' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Denklem tekrar çalışması' }).click()
    const detail = page.getByRole('dialog', { name: 'Denklem tekrar çalışması' })
    await expect(detail.getByRole('button', { name: 'Çalışmayı teslim et' })).toHaveCount(0)
    await expect(detail.getByRole('button', { name: 'Planı onayla' })).toHaveCount(0)
  })
})
