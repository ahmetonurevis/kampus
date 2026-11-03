import { randomUUID } from 'node:crypto'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'

// Kayıt yenileme (IST-100): ücret yayımlı tarifeden ve artış tavanından hesaplanır, yenileme
// planlamak sınıfı değiştirmez, dönem geçişi ayrı işlemdir. Her yazan test kendi kurumunu kurar
// (`tenant`): s3 (Zeynep, 6-A → 7-A) devam eden ara sınıf öğrencisidir, sözleşmesi taban olur;
// s4 (Arda, 8-A → 9-A) kademe başlangıcına geçer, tavan uygulanmaz.

interface Renewal {
  id: string
  studentId: string
  status: string
  netCents: number
  academicYear: number
}
interface StudentRecord {
  classId: string
}

const RENEWALS = '/api/v1/finance/renewals'

async function renewalOf(client: ApiClient, studentId: string) {
  const result = await client.get(`${RENEWALS}?studentId=${studentId}`)
  expect(result.status).toBe(200)
  return (result.body as { data: Renewal[] }).data[0]
}

async function classOf(client: ApiClient, studentId: string) {
  const result = await client.get(`/api/v1/collections/students/${studentId}`)
  expect(result.status).toBe(200)
  return (result.body as { data: { record: StudentRecord } }).data.record.classId
}

function nextDay(offset: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(
    new Date(Date.now() + offset * 86_400_000),
  )
}

/** Kurumun yenileme yılı: güncel eğitim yılının bir sonrası. */
async function renewalYear(client: ApiClient) {
  const me = await client.get('/api/v1/me')
  expect(me.status).toBe(200)
  const year = (me.body as { data: { activeInstitution: { academicYear: number } } }).data
    .activeInstitution.academicYear
  return year + 1
}

test.describe('kayıt yenileme', () => {
  test('yönetici artış tavanı oranını girer, ücret özetini görür ve yenilemeyi planlar; sınıf değişmez', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici'],
      students: ['s3'],
      collections: ['renewals'],
      tariffYears: ['current', 'next'],
    })
    const page = await loginAs(school.user('yonetici'))
    const client = await api(school.user('yonetici'))
    const year = await renewalYear(client)
    await page.goto('/yonetici/kayit-yenileme')
    await expect(page.getByRole('heading', { name: 'Kayıt Yenileme', level: 2 })).toBeVisible()

    // Devam eden öğrencinin tavanı için yılın ÜFE/TÜFE oranı girilir (DOM-FIN-005).
    await page.getByRole('button', { name: 'Oran ekle' }).click()
    const rates = page.getByRole('dialog', { name: 'Artış tavanı oranı ekle' })
    await rates.getByLabel('Ücret yılı (başlangıç)').fill(String(year))
    await rates.getByLabel('ÜFE ortalaması (%)', { exact: true }).fill('40')
    await rates.getByLabel('TÜFE ortalaması (%)', { exact: true }).fill('30')
    await rates.getByLabel('Kaynak (TÜİK bülteni)').fill('TÜİK bülteni 53607')
    await rates.getByLabel('Bülten tarihi').fill(nextDay(-30))
    await rates.getByRole('button', { name: 'Kaydet' }).click()
    await expect(rates).toBeHidden()
    const indexes = page.getByRole('region', { name: 'Artış tavanı oranları' })
    await expect(indexes.getByText('%40').first()).toBeVisible()

    await page.getByRole('button', { name: 'Kayıt yenile' }).click()
    const form = page.getByRole('dialog', { name: 'Kayıt yenile' })
    await form.getByLabel('Öğrenci', { exact: true }).selectOption({ label: 'Zeynep Demir · 6-A' })
    await form.getByLabel('Yeni sınıf').selectOption({ label: '7-A · Kadıköy Kampüsü' })
    await form.getByLabel('Taksit sayısı').fill('6')
    await form.getByLabel('İlk taksit tarihi').fill(nextDay(30))
    await form.getByRole('button', { name: 'Kontrol et' }).click()

    const summary = form.getByRole('region', { name: 'Yeni dönem ödeme özeti' })
    await expect(summary.getByText(/^Artış tavanı: /)).toBeVisible()
    await expect(summary.getByText(/^Net eğitim bedeli: /)).toBeVisible()
    await expect(summary.getByText('6 taksit')).toBeVisible()
    const quote = await client.post(`${RENEWALS}/quote`, {
      studentId: 's3',
      targetClassId: 'c1',
      academicYear: year,
      installmentCount: 6,
    })
    expect(quote.status).toBe(200)
    const quoted = (quote.body as { data: { netCents: number; ceiling: { status: string } } }).data
    expect(quoted.ceiling.status).toBe('applied')

    await form.getByRole('button', { name: 'Onayla ve kaydet' }).click()
    await expect(form).toBeHidden()

    await expect.poll(async () => (await renewalOf(client, 's3'))?.status).toBe('Planlandı')
    expect((await renewalOf(client, 's3'))?.netCents).toBe(quoted.netCents)
    // Yenileme planlamak sınıfı değiştirmez; geçiş ayrı işlemdir.
    expect(await classOf(client, 's3')).toBe('c3')
    await page.getByLabel('Tabloda ara').fill('Zeynep Demir')
    await page.getByRole('button', { name: 'Zeynep Demir' }).click()
    const detail = page.getByRole('dialog', { name: 'Zeynep Demir' })
    await expect(detail.getByText(/^1\. taksit/)).toBeVisible()
    await expect(detail.getByText(/^Artış tavanı: /)).toBeVisible()
    await expect(detail.getByRole('button', { name: 'Dönem geçişini uygula' })).toBeVisible()
  })

  test('dönem geçişi ayrı işlemle uygulanır ve sınıfı değiştirir', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici'],
      students: ['s4'],
      collections: ['renewals'],
      tariffYears: ['current', 'next'],
    })
    const client = await api(school.user('yonetici'))
    const year = await renewalYear(client)
    const body = { studentId: 's4', targetClassId: 'c5', academicYear: year, installmentCount: 8 }
    const quote = await client.post(`${RENEWALS}/quote`, body)
    expect(quote.status).toBe(200)
    const tariffId = (quote.body as { data: { tariffId: string } }).data.tariffId
    const created = await client.post(
      RENEWALS,
      { ...body, mode: 'renew', tariffId, firstDueDate: nextDay(30) },
      { 'idempotency-key': randomUUID() },
    )
    expect(created.status).toBe(201)
    expect(await classOf(client, 's4')).toBe('c4')

    const page = await loginAs(school.user('yonetici'))
    await page.goto('/yonetici/kayit-yenileme')
    await page.getByLabel('Tabloda ara').fill('Arda Çelik')
    await page.getByRole('button', { name: 'Arda Çelik' }).click()
    await page
      .getByRole('dialog', { name: 'Arda Çelik' })
      .getByRole('button', { name: 'Dönem geçişini uygula' })
      .click()
    const confirm = page.getByRole('dialog', { name: 'Dönem geçişini uygula' })
    await confirm.getByRole('button', { name: 'Onayla ve kaydet' }).click()
    await expect(confirm).toBeHidden()

    await expect.poll(async () => classOf(client, 's4')).toBe('c5')
    expect((await renewalOf(client, 's4'))?.status).toBe('Tamamlandı')
  })

  test('veli yenileme işlemi göremez; liste kapsamına daralır', async ({ loginAs }) => {
    const page = await loginAs('veli')
    await page.goto('/veli/kayit-yenileme?cocuk=s1')
    await expect(page.getByText('Seçili çocuğunuzun kayıtları')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Kayıt yenile' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Zeynep Demir' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Artış tavanı oranları' })).toHaveCount(0)
  })
})
