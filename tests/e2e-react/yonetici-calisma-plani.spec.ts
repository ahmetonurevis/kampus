import { randomUUID } from 'node:crypto'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'

// OG-076: yönetici çalışma planı duman testi. Öğrenci planı öğretmen onayına açar; yönetici
// görevi doğrudan verir (durum "Onaylandı") ve plana teslim/onay düğmeleri sunulmaz. Kurulum
// kurum başınadır (`tenant`); yazan test seed kurumuna dokunmaz.

const TASKS = '/api/v1/collections/studyTasks?pageSize=100'
const SEED_TITLE = 'Denklem tekrar çalışması'

interface TaskRow {
  record: {
    studentId: string
    title: string
    status: string
    subjectId: string
    topic: string
    minutes: number
  }
}

async function tasksTitled(client: ApiClient, title: string): Promise<TaskRow[]> {
  const result = await client.get(TASKS)
  expect(result.status).toBe(200)
  return (result.body as { data: TaskRow[] }).data.filter((row) =>
    row.record.title.startsWith(title),
  )
}

test.describe('yönetici: çalışma planı', () => {
  test('yönetici kurum genelini görür, görevi doğrudan onaylı verir; öğrenci aynı görevi teslime hazır görür', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici', 'ogretmen', 'ogrenci'],
      students: ['s1', 's2'],
      collections: ['studyTasks'],
    })
    const client = await api(school.user('yonetici'))
    const page = await loginAs(school.user('yonetici'))
    await page.goto('/yonetici/calisma-plani')
    await expect(page.getByRole('heading', { name: 'Çalışma Planı', level: 1 })).toBeVisible()
    // Kurum kapsamı: tohumdaki iki öğrencinin görevi de listelenir.
    await expect(page.getByText(/^2 kayıt/)).toBeVisible()
    await expect(page.getByRole('button', { name: SEED_TITLE })).toHaveCount(2)

    const title = `E2E yönetici görevi ${randomUUID().slice(0, 8)}`
    await page.getByRole('button', { name: 'Çalışma görevi ekle' }).click()
    const form = page.getByRole('dialog', { name: 'Çalışma görevi ekle' })
    await form.getByLabel('Öğrenci', { exact: true }).selectOption({ label: 'Deniz Yılmaz · 7-A' })
    await form.getByLabel('Çalışılacak konular').fill('Oran orantı')
    await form.getByLabel('Görev başlığı').fill(title)
    await form.getByLabel('Çalışma yönergesi').fill('Çalışma kâğıdındaki altı soruyu çöz.')
    await form.getByRole('button', { name: 'Kontrol et' }).click()
    await form.getByRole('button', { name: 'Onayla ve kaydet' }).click()
    await expect(form).toBeHidden()

    // Yönetici verdiği görev onay beklemez; sunucuda kalıcıdır.
    await expect
      .poll(async () => (await tasksTitled(client, title))[0]?.record)
      .toMatchObject({ studentId: 's1', status: 'Onaylandı', subjectId: 'math', minutes: 30 })

    await page.reload()
    await page.getByLabel('Tabloda ara').fill(title)
    await page.getByRole('button', { name: title }).click()
    const detail = page.getByRole('dialog', { name: title })
    await expect(detail.getByText('Çalışma kâğıdındaki altı soruyu çöz.')).toBeVisible()
    // Teslim öğrenciye, onay öğretmene özeldir: yöneticide bu düğmeler yoktur.
    for (const name of ['Çalışmayı teslim et', 'Planı onayla', 'Çalışmayı değerlendir'])
      await expect(detail.getByRole('button', { name })).toHaveCount(0)

    // Öğrenci aynı görevi görür ve teslim edebilir; kardeş öğrencinin görevi ona görünmez.
    await loginAs(school.user('ogrenci'))
    await page.goto('/ogrenci/calisma-plani')
    await page.getByLabel('Tabloda ara').fill(title)
    await page.getByRole('button', { name: title }).click()
    await expect(
      page
        .getByRole('dialog', { name: title })
        .getByRole('button', { name: 'Çalışmayı teslim et' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Pencereyi kapat' }).click()
    await page.getByLabel('Tabloda ara').fill(SEED_TITLE)
    await expect(page.getByRole('button', { name: SEED_TITLE })).toHaveCount(1)
  })
})
