import { randomUUID } from 'node:crypto'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'

// Rehberlik takibi: iç not yalnız rehberlik görevli öğretmene döner (DOM-YTK-020). Kapsamı
// sunucu uygular; ekran ayrıca süzmez, alan yoksa bölümü de çizmez. Tohumdaki guidance-s1 ve
// guidance-s2 yalnız okunur; yazan test kendi dosyasını açar.

const CASES = '/api/v1/collections/guidanceCases?pageSize=100'

interface Row<T> {
  id: string
  version: number
  record: T
}
interface CaseRecord {
  title: string
  sharedNote: string
  internalNote?: string
}

async function casesTitled(client: ApiClient, title: string): Promise<Row<CaseRecord>[]> {
  const result = await client.get(CASES)
  expect(result.status).toBe(200)
  return (result.body as { data: Row<CaseRecord>[] }).data.filter((row) =>
    row.record.title.startsWith(title),
  )
}

const SEED_TITLE = 'Matematik çalışma alışkanlığı'
const SEED_INTERNAL = 'İlk görüşmede çalışma ortamı ve zaman yönetimi konuşuldu.'

test.describe('rehberlik ve takip', () => {
  test('yönetici takip dosyasını görür ama iç notu görmez', async ({ loginAs, api }) => {
    const page = await loginAs('yonetici')
    await page.goto('/yonetici/rehberlik')
    await expect(page.getByRole('heading', { name: 'Rehberlik & Takip', level: 2 })).toBeVisible()
    await page.getByRole('button', { name: SEED_TITLE }).click()
    const detail = page.getByRole('dialog', { name: SEED_TITLE })
    await expect(detail.getByText('Paylaşılan destek planı')).toBeVisible()
    await expect(detail.getByText('Kısa ve düzenli tekrarlar')).toBeVisible()
    await expect(detail.getByText('Kurum içi görüşme notları')).toHaveCount(0)
    await expect(detail.getByText(SEED_INTERNAL)).toHaveCount(0)
    await expect(detail.getByRole('button', { name: 'Görüşme / sonuç kaydet' })).toHaveCount(0)
    // Sunucu yanıtında iç not alanı hiç yoktur.
    const [row] = await casesTitled(await api('yonetici'), SEED_TITLE)
    expect(row?.record).not.toHaveProperty('internalNote')
  })

  test('rehberlik görevli öğretmen iç notu görür ve yazar', async ({ loginAs, api }) => {
    const page = await loginAs('ogretmen', { fresh: true })
    const client = await api('ogretmen', { fresh: true })
    await page.goto('/ogretmen/rehberlik')
    await page.getByRole('button', { name: SEED_TITLE }).click()
    const detail = page.getByRole('dialog', { name: SEED_TITLE })
    await expect(detail.getByText('Kurum içi görüşme notları')).toBeVisible()
    await expect(detail.getByText(SEED_INTERNAL)).toBeVisible()
    await page.keyboard.press('Escape')

    const title = `E2E takip ${randomUUID().slice(0, 8)}`
    const internal = `İç not ${randomUUID().slice(0, 6)}`
    await page.getByRole('button', { name: 'Takip dosyası aç' }).click()
    const form = page.getByRole('dialog', { name: 'Takip dosyası aç' })
    await form.getByLabel('Öğrenci', { exact: true }).selectOption({ label: 'Ece Yılmaz · 5-A' })
    await form.getByLabel('Takip başlığı').fill(title)
    await form.getByLabel('Destek planı').fill('Haftalık görüşme.')
    await form.getByLabel('Veli ve öğrenciyle paylaşılan not').fill('Birlikte izliyoruz.')
    await form.getByLabel('Kurum içi not').fill(internal)
    await form.getByRole('button', { name: 'Kontrol et' }).click()
    await form.getByRole('button', { name: 'Onayla ve kaydet' }).click()
    await expect(form).toBeHidden()
    await expect
      .poll(async () => (await casesTitled(client, title))[0]?.record.internalNote)
      .toBe(internal)

    // Yönetici aynı dosyayı görür; iç not ne yanıtta ne ekranda vardır.
    const admin = await api('yonetici', { fresh: true })
    await expect.poll(async () => (await casesTitled(admin, title)).length).toBe(1)
    expect((await casesTitled(admin, title))[0]?.record).not.toHaveProperty('internalNote')
  })

  test('veli yalnız seçili çocuğunun paylaşılan notunu görür', async ({ loginAs }) => {
    const page = await loginAs('veli')
    await page.goto('/veli/rehberlik?cocuk=s1')
    await page.getByRole('button', { name: SEED_TITLE }).click()
    const detail = page.getByRole('dialog', { name: SEED_TITLE })
    await expect(detail.getByText('Kısa ve düzenli tekrarlar')).toBeVisible()
    await expect(detail.getByText('Kurum içi görüşme notları')).toHaveCount(0)
    await expect(detail.getByText(SEED_INTERNAL)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Okula uyum takibi' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Takip dosyası aç' })).toHaveCount(0)
  })
})
