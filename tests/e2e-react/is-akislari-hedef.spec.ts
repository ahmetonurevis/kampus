import { randomUUID } from 'node:crypto'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'

// Hedef & gelişim planı: kurala özgü senaryolar. Yazan her test kendi kurumunu kurar (`tenant`);
// tohum kaydı goal-s1-math o kurumda açık matematik hedefidir.

const GOALS = '/api/v1/collections/studentGoals?pageSize=100'

interface Row<T> {
  id: string
  version: number
  record: T
}
interface GoalRecord {
  studentId: string
  subjectId: string
  title: string
  status: string
  feedback: string
  comments: { actor: string; text: string }[]
}

async function allGoals(client: ApiClient): Promise<Row<GoalRecord>[]> {
  const result = await client.get(GOALS)
  expect(result.status).toBe(200)
  return (result.body as { data: Row<GoalRecord>[] }).data
}

async function goalsTitled(client: ApiClient, title: string): Promise<Row<GoalRecord>[]> {
  return (await allGoals(client)).filter((row) => row.record.title.startsWith(title))
}

function day(offset: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(
    new Date(Date.now() + offset * 86_400_000),
  )
}

test.describe('hedef ve gelişim planı', () => {
  test('öğrenci hedefi onay bekler; yönetici gerekçesiz reddedemez, onaylar', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['ogrenci', 'yonetici'],
      collections: ['studentGoals', 'mockExams', 'mockResults'],
    })
    const student = await loginAs(school.user('ogrenci'))
    const admin = await api(school.user('yonetici'))
    const title = `E2E hedef ${randomUUID().slice(0, 8)}`
    await student.goto('/ogrenci/hedef-plani')
    await student.getByRole('button', { name: 'Hedef belirle' }).click()
    const form = student.getByRole('dialog', { name: 'Hedef belirle' })
    await form.getByLabel('Hedef kapsamı').selectOption({ label: 'Fen Bilimleri' })
    await form.getByLabel('Hedef başlığı').fill(title)
    await form.getByLabel('Hedef net').fill('15')
    await form.getByLabel('Hedefin nedeni / öğrenci notu').fill('Test hedefi.')
    await form.getByRole('button', { name: 'Kontrol et' }).click()
    await form.getByRole('button', { name: 'Onayla ve kaydet' }).click()
    await expect(form).toBeHidden()

    await expect
      .poll(async () => (await goalsTitled(admin, title))[0]?.record.status)
      .toBe('Onay bekliyor')
    // Öğrenci kendi hedefini değerlendiremez.
    await student.getByLabel('Tabloda ara').fill(title)
    await student.getByRole('button', { name: title }).click()
    const ownDetail = student.getByRole('dialog', { name: title })
    await expect(ownDetail.getByText('Öğretmen veya yönetici onayı bekleniyor.')).toBeVisible()
    await expect(ownDetail.getByRole('button', { name: 'Hedefi değerlendir' })).toHaveCount(0)

    const page = await loginAs(school.user('yonetici'))
    await page.goto('/yonetici/hedef-plani')
    await page.getByLabel('Tabloda ara').fill(title)
    await page.getByRole('button', { name: title }).click()
    await page
      .getByRole('dialog', { name: title })
      .getByRole('button', { name: 'Hedefi değerlendir' })
      .click()
    const review = page.getByRole('dialog', { name: 'Hedefi değerlendir' })
    await review.getByLabel('Karar').selectOption({ label: 'Reddet' })
    await review.getByRole('button', { name: 'Kontrol et' }).click()
    await expect(review.getByText('Reddetme gerekçesini yazın.')).toBeVisible()
    expect((await goalsTitled(admin, title))[0]?.record.status).toBe('Onay bekliyor')

    await review.getByLabel('Karar').selectOption({ label: 'Onayla' })
    await review.getByRole('button', { name: 'Kontrol et' }).click()
    await review.getByRole('button', { name: 'Onayla ve kaydet' }).click()
    await expect(review).toBeHidden()
    await expect.poll(async () => (await goalsTitled(admin, title))[0]?.record.status).toBe('Aktif')
  })

  test('aynı öğrenci ve kapsam için ikinci açık hedef reddedilir', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['ogrenci', 'yonetici'],
      collections: ['studentGoals', 'mockExams', 'mockResults'],
    })
    const student = await loginAs(school.user('ogrenci'))
    const admin = await api(school.user('yonetici'))
    await student.goto('/ogrenci/hedef-plani')
    await student.getByRole('button', { name: 'Hedef belirle' }).click()
    const form = student.getByRole('dialog', { name: 'Hedef belirle' })
    // Tohumda Deniz'in açık matematik hedefi var.
    await form.getByLabel('Hedef kapsamı').selectOption({ label: 'Matematik' })
    await form.getByLabel('Hedef başlığı').fill('E2E yinelenen hedef')
    await form.getByLabel('Hedef net').fill('18')
    await form.getByRole('button', { name: 'Kontrol et' }).click()
    await form.getByRole('button', { name: 'Onayla ve kaydet' }).click()
    await expect(
      student.getByText('Bu kapsam için açık bir hedef zaten var. Önce mevcut hedefi kapatın.'),
    ).toBeVisible()
    await expect(form).toBeVisible()
    expect(await goalsTitled(admin, 'E2E yinelenen hedef')).toHaveLength(0)
  })

  test('veli hedefe yalnız yorum ekler', async ({ loginAs, api, tenant }) => {
    const school = await tenant({
      roles: ['veli', 'yonetici'],
      collections: ['studentGoals', 'mockExams', 'mockResults'],
    })
    const admin = await api(school.user('yonetici'))
    const title = `E2E veli hedef ${randomUUID().slice(0, 8)}`
    const created = await admin.post('/api/v1/workflows/goal', {
      studentId: 's1',
      subjectId: 'turkish',
      title,
      targetNet: 14,
      deadline: day(30),
      motivation: '',
    })
    expect(created.status).toBeLessThan(300)

    const page = await loginAs(school.user('veli'))
    await page.goto('/veli/hedef-plani?cocuk=s1')
    await expect(page.getByRole('button', { name: 'Hedef belirle' })).toHaveCount(0)
    await page.getByLabel('Tabloda ara').fill(title)
    await page.getByRole('button', { name: title }).click()
    const detail = page.getByRole('dialog', { name: title })
    await expect(detail.getByRole('button', { name: 'Yorum ekle' })).toBeVisible()
    await expect(detail.getByRole('button', { name: 'Hedefi değerlendir' })).toHaveCount(0)
    await expect(detail.getByRole('button', { name: 'Hedefi kapat' })).toHaveCount(0)
    await detail.getByRole('button', { name: 'Yorum ekle' }).click()
    const form = page.getByRole('dialog', { name: 'Yorum ekle' })
    const comment = `Evde destek oluyoruz ${randomUUID().slice(0, 6)}`
    await form.getByLabel('Yorumunuz').fill(comment)
    await form.getByRole('button', { name: 'Kontrol et' }).click()
    await form.getByRole('button', { name: 'Onayla ve kaydet' }).click()
    await expect(form).toBeHidden()
    await expect
      .poll(async () => (await goalsTitled(admin, title))[0]?.record.comments.at(-1))
      .toMatchObject({ actor: 'veli', text: comment })
    expect((await goalsTitled(admin, title))[0]?.record.status).toBe('Aktif')
  })
})
