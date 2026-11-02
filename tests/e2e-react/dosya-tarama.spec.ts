import { randomUUID } from 'node:crypto'

import type { Page, Route } from '@playwright/test'
import pg from 'pg'

import type { ApiClient } from './support/api.ts'
import { e2e } from './support/env.ts'
import { expect, test } from './support/fixtures.ts'

// Yüklenen dosyanın güvenlik taramasını bekleme (OG-987; IST-027; ADR 0003 karar 8, DOM-AKD-072).
// E2E API'si tarayıcısız koşar (`FILE_SCANNER=off`): yüklenen dosya `pending` kalır ve veritabanı
// tetikleyicisi bir dosyayı sonradan `processing`'e almaya izin vermez. Tarayıcı açık API'nin
// davranışı üretim koduna kapı açmadan, ağ katmanında taklit edilir: yükleme ve dosya okuma
// istekleri gerçek sunucuya gider, tarama sürerken yanıttaki durum `processing` yazılır (sunucuda
// dosya `pending`'dir, bağlama yine 422 alır). Tarama bitince test sonucu veritabanına yazar (temiz
// dosya `ready`, zararlı dosya `rejected`) ve okuma yanıtı olduğu gibi geçer: `rejected` dosyada
// yükleyen 422 `file_rejected` alır.

const STUDENT_HOMEWORK = '/ogrenci/odevler'

const PDF = {
  name: 'cevaplar.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'latin1'),
}

async function setFileStatus(fileId: string, status: 'ready' | 'rejected') {
  const client = new pg.Client({ connectionString: e2e.databaseUrl })
  await client.connect()
  try {
    const result = await client.query(
      "update files set status = $2 where id = $1 and status = 'pending'",
      [fileId, status],
    )
    expect(result.rowCount).toBe(1)
  } finally {
    await client.end()
  }
}

const FILE_PATH = /^\/api\/v1\/files\/([^/]+)$/

/**
 * Tarayıcı açık API taklidi. Yüklenen dosyaların kimlikleri sırayla `ids`'e düşer; `finish`
 * taramayı bitirir (sonucu veritabanına yazar, okuma yanıtını serbest bırakır).
 */
async function scanUploads(page: Page) {
  const ids: string[] = []
  const scanning = new Set<string>()
  /** Gerçek yanıtı alır; dosya taranıyorsa durumu `processing` yazılmış hâliyle döner. */
  const forward = async (route: Route) => {
    const response = await route.fetch()
    const body = (await response.json()) as { data?: { id: string; status: string } }
    if (route.request().method() === 'POST' && response.status() === 201 && body.data) {
      ids.push(body.data.id)
      scanning.add(body.data.id)
    }
    if (!body.data || !scanning.has(body.data.id)) return route.fulfill({ response })
    return route.fulfill({
      response,
      json: { ...body, data: { ...body.data, status: 'processing' } },
    })
  }
  await page.route(
    (url) => url.pathname === '/api/v1/files',
    (route) => (route.request().method() === 'POST' ? forward(route) : route.continue()),
  )
  await page.route(
    (url) => FILE_PATH.test(url.pathname),
    async (route) => {
      const id = FILE_PATH.exec(new URL(route.request().url()).pathname)?.[1] ?? ''
      if (route.request().method() !== 'GET' || !scanning.has(id)) return route.continue()
      return forward(route)
    },
  )
  return {
    ids,
    finish: async (fileId: string, status: 'ready' | 'rejected') => {
      await setFileStatus(fileId, status)
      scanning.delete(fileId)
    },
  }
}

async function assignHomework(teacher: ApiClient, title: string): Promise<{ id: string }> {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(
    new Date(Date.now() + 3 * 86_400_000),
  )
  const result = await teacher.post(
    '/api/v1/homework',
    {
      classId: 'c1',
      subjectId: 'math',
      title,
      description: 'Ders kitabı 42. sayfa.',
      dueDate: new Date(`${day}T17:00:00+03:00`).toISOString(),
    },
    { 'idempotency-key': randomUUID() },
  )
  expect(result.status, JSON.stringify(result.body)).toBe(201)
  return (result.body as { data: { id: string } }).data
}

async function submissionFiles(teacher: ApiClient, homeworkId: string): Promise<string[][]> {
  const result = await teacher.get(`/api/v1/homework/${homeworkId}`)
  expect(result.status).toBe(200)
  const { submissions } = (result.body as { data: { submissions: { fileIds: string[] }[] } }).data
  return submissions.map((submission) => submission.fileIds)
}

async function openSubmitForm(page: Page, title: string) {
  await page.goto(STUDENT_HOMEWORK)
  const row = page.getByRole('table', { name: 'Ödevlerim' }).locator('tbody tr')
  await row.getByRole('button', { name: `${title} ayrıntısını aç` }).click()
  return page
    .getByRole('dialog', { name: 'Ödev ayrıntısı' })
    .getByRole('form', { name: 'Ödevi teslim et' })
}

test.describe('Dosya güvenlik taraması: ödev teslimi', () => {
  test('taranan dosyada teslim kilitli kalır, tarama bitince dosyayla teslim edilir (IST-027, DOM-AKD-072)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'ogrenci'] })
    const teacher = await api(school.user('ogretmen'))
    const homework = await assignHomework(teacher, 'Taranan dosyalı ödev')
    await loginAs(school.user('ogrenci'))
    const scan = await scanUploads(page)
    const form = await openSubmitForm(page, 'Taranan dosyalı ödev')

    await form.getByLabel('Açıklama').fill('Çözümler ekte.')
    await form.getByLabel('Dosya ekle').setInputFiles(PDF)
    const attached = form.getByRole('list', { name: 'Eklenen dosyalar' })
    await expect(attached.getByRole('listitem')).toHaveCount(1)
    await expect(attached).toContainText('Taranıyor…')
    const submit = form.getByRole('button', { name: 'Teslim et' })
    await expect(submit).toBeDisabled()
    await expect(
      form.getByRole('status').filter({ hasText: 'güvenlik taramasında' }),
    ).toBeAttached()
    expect(await submissionFiles(teacher, homework.id)).toHaveLength(0)

    // Tarama temiz bitti: yoklama dosyayı hazır görür, satır sakinleşir ve teslim açılır.
    expect(scan.ids).toHaveLength(1)
    await scan.finish(scan.ids[0] as string, 'ready')
    await expect(attached).not.toContainText('Taranıyor…')
    await expect(submit).toBeEnabled()
    await expect(
      form.getByRole('status').filter({ hasText: 'Dosya güvenlik taramasından geçti.' }),
    ).toBeAttached()
    await submit.click()
    await expect(page.getByText('Ödev teslim edildi.')).toBeVisible()
    expect(await submissionFiles(teacher, homework.id)).toEqual([[scan.ids[0]]])
  })

  test('taramada reddedilen dosyada Türkçe ileti çıkar; dosya kaldırılınca teslim açılır (IST-027)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'ogrenci'] })
    const teacher = await api(school.user('ogretmen'))
    const homework = await assignHomework(teacher, 'Reddedilen dosyalı ödev')
    await loginAs(school.user('ogrenci'))
    const scan = await scanUploads(page)
    const form = await openSubmitForm(page, 'Reddedilen dosyalı ödev')

    await form.getByLabel('Açıklama').fill('Dosyam ekte.')
    await form.getByLabel('Dosya ekle').setInputFiles(PDF)
    const attached = form.getByRole('list', { name: 'Eklenen dosyalar' })
    await expect(attached).toContainText('Taranıyor…')
    await scan.finish(scan.ids[0] as string, 'rejected')

    await expect(attached).toContainText(
      'Dosya güvenlik taramasından geçmedi. Başka bir dosya yükleyin.',
    )
    const submit = form.getByRole('button', { name: 'Teslim et' })
    await expect(submit).toBeDisabled()

    await attached.getByRole('button', { name: `${PDF.name} dosyasını kaldır` }).click()
    await expect(attached).toHaveCount(0)
    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(page.getByText('Ödev teslim edildi.')).toBeVisible()
    expect(await submissionFiles(teacher, homework.id)).toEqual([[]])
  })
})
