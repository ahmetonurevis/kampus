import { randomUUID } from 'node:crypto'

import type { Request } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'

// Deneme sınavları: CSV sonuç aktarımı. Yazan testler kendi denemesini API'den açar ve yalnız
// ona sonuç yazar; tohumdaki exam-7-1/exam-7-2 sonuçlarına dokunulmaz.

const RESULTS = '/api/v1/collections/mockResults?pageSize=100'
const IMPORT = /\/api\/v1\/workflows\/exam-import(\?|$)/
const EXAM_DATA = ['mockExams', 'mockResults'] as const
const HEADER = 'examId;studentId;subjectId;correct;wrong;blank;weakTopics'

interface Row<T> {
  id: string
  version: number
  record: T
}
interface ResultRecord {
  examId: string
  studentId: string
  subjectId: string
  correct: number
  wrong: number
  blank: number
}

function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date())
}

async function createExam(client: ApiClient, title: string): Promise<string> {
  const result = await client.post('/api/v1/workflows/exam', {
    title,
    type: 'Okul denemesi',
    grade: 7,
    wrongPenalty: 4,
    date: today(),
    subjectIds: ['math'],
  })
  expect(result.status).toBeLessThan(300)
  const id = (result.body as { data: { entity: { id: string } | null } }).data.entity?.id
  expect(id).toBeTruthy()
  return id ?? ''
}

async function resultsOf(client: ApiClient, examId: string): Promise<Row<ResultRecord>[]> {
  const result = await client.get(RESULTS)
  expect(result.status).toBe(200)
  return (result.body as { data: Row<ResultRecord>[] }).data.filter(
    (row) => row.record.examId === examId,
  )
}

test.describe('deneme sınavları', () => {
  test('yönetici CSV dosyasını aktarır; çift tıklama tek kez yazar', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici'], students: ['s1'], collections: EXAM_DATA })
    const page = await loginAs(school.user('yonetici'))
    const client = await api(school.user('yonetici'))
    const examId = await createExam(client, `E2E deneme ${randomUUID().slice(0, 8)}`)
    const posts: Request[] = []
    page.on('request', (r) => {
      if (r.method() === 'POST' && IMPORT.test(r.url())) posts.push(r)
    })

    await page.goto('/yonetici/deneme-sinavlari')
    await expect(page.getByRole('heading', { name: 'Deneme Sınavları', level: 2 })).toBeVisible()
    await page.getByRole('button', { name: 'CSV sonuç aktar' }).click()
    const form = page.getByRole('dialog', { name: 'CSV sonuç aktar' })
    const download = page.waitForEvent('download')
    await form.getByRole('button', { name: 'CSV şablonunu indir' }).click()
    expect((await download).suggestedFilename()).toBe('deneme-sonuc-sablonu.csv')
    await expect(form.getByText('1 sonuç satırı okundu.')).toBeVisible()

    await form.getByLabel('CSV dosyası seç').setInputFiles({
      name: 'sonuclar.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(`${HEADER}\n${examId};s1;math;12;5;3;Denklemler\n`, 'utf8'),
    })
    await expect(form.getByLabel('CSV içeriği')).toHaveValue(new RegExp(examId))
    await expect(form.getByText('1 sonuç satırı okundu.')).toBeVisible()
    await form.getByRole('button', { name: 'Kontrol et' }).click()
    await form.getByRole('button', { name: 'Onayla ve kaydet' }).dblclick()
    await expect(form).toBeHidden()

    await expect.poll(async () => (await resultsOf(client, examId)).length).toBe(1)
    const [saved] = await resultsOf(client, examId)
    expect(saved?.record).toMatchObject({ studentId: 's1', subjectId: 'math', correct: 12 })
    expect(posts).toHaveLength(1)
    expect(posts[0]?.headers()['idempotency-key']).toBeTruthy()
  })

  test('şablona uymayan CSV ön kontrolde bildirilir ve hiçbir sonuç yazılmaz', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici'], students: ['s1'], collections: EXAM_DATA })
    const page = await loginAs(school.user('yonetici'))
    const client = await api(school.user('yonetici'))
    const examId = await createExam(client, `E2E bozuk ${randomUUID().slice(0, 8)}`)

    await page.goto('/yonetici/deneme-sinavlari')
    await page.getByRole('button', { name: 'CSV sonuç aktar' }).click()
    const form = page.getByRole('dialog', { name: 'CSV sonuç aktar' })
    await form.getByLabel('CSV dosyası seç').setInputFiles({
      name: 'sonuclar.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(`ad;puan\n${examId};12\n`, 'utf8'),
    })
    await expect(form.getByText('CSV başlıkları örnek şablonla aynı olmalıdır.')).toBeVisible()
    await form.getByRole('button', { name: 'Kontrol et' }).click()
    await form.getByRole('button', { name: 'Onayla ve kaydet' }).click()
    await expect(
      page.getByText('CSV başlıkları örnek şablonla aynı olmalıdır.').first(),
    ).toBeVisible()
    await expect(form).toBeVisible()
    expect(await resultsOf(client, examId)).toHaveLength(0)
  })

  test('denemenin ayrıntısından tek sonuç girilir (kayıt kimliği gönderilmez)', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici'], students: ['s1'], collections: EXAM_DATA })
    const page = await loginAs(school.user('yonetici'))
    const client = await api(school.user('yonetici'))
    const title = `E2E tekil ${randomUUID().slice(0, 8)}`
    const examId = await createExam(client, title)

    await page.goto('/yonetici/deneme-sinavlari')
    await page.getByLabel('Tabloda ara').fill(title)
    await page.getByRole('button', { name: title }).click()
    await page
      .getByRole('dialog', { name: title })
      .getByRole('button', { name: 'Sonuç gir' })
      .click()
    const form = page.getByRole('dialog', { name: 'Ders sonucu gir' })
    // Deneme ayrıntıdan açıldığı için seçili gelir; öğrenci 7. sınıf düzeyinden seçilir.
    await expect(form.getByLabel('Deneme')).toHaveValue(examId)
    await form.getByLabel('Öğrenci', { exact: true }).selectOption({ label: 'Deniz Yılmaz' })
    await form.getByLabel('Doğru').fill('10')
    await form.getByLabel('Yanlış').fill('4')
    await form.getByLabel('Boş').fill('6')
    await form.getByRole('button', { name: 'Kontrol et' }).click()
    await form.getByRole('button', { name: 'Onayla ve kaydet' }).click()
    await expect(form).toBeHidden()
    await expect.poll(async () => (await resultsOf(client, examId)).length).toBe(1)
    expect((await resultsOf(client, examId))[0]?.record).toMatchObject({
      studentId: 's1',
      correct: 10,
      wrong: 4,
      blank: 6,
    })
  })

  test('veli denemeleri görür ama oluşturma ve aktarım işlemi sunulmaz', async ({ loginAs }) => {
    const page = await loginAs('veli')
    await page.goto('/veli/deneme-sinavlari?cocuk=s1')
    await expect(page.getByText('Seçili çocuğunuzun kayıtları')).toBeVisible()
    await expect(page.getByRole('button', { name: '7. Sınıf Hazırlık Denemesi 1' })).toBeVisible()
    for (const name of ['Deneme oluştur', 'Sonuç gir', 'CSV sonuç aktar'])
      await expect(page.getByRole('button', { name })).toHaveCount(0)
  })
})
