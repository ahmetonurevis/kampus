import { randomUUID } from 'node:crypto'

import type { Page, Request } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Okul iş akışı ortak sayfası (yemek menüsü, okul takvimi, kulüpler). Yazan testler kendi
// menüsünü oluşturur: core kuralı kampüs + gün başına tek menüdür, bu yüzden her test ayrı
// kampüs/gün çifti kullanır ve tohumdaki Kadıköy menülerine (bugün + 6 gün) dokunmaz.

const MEALS = '/api/v1/collections/mealMenus?pageSize=100'
const WORKFLOW_MEAL = /\/api\/v1\/workflows\/meal(\/[^/?]+)?(\?|$)/

interface Row<T> {
  id: string
  version: number
  record: T
}
interface MealRecord {
  title: string
  branchId: string
  date: string
}

/** Bugünden `days` gün sonrası (Europe/Istanbul, `YYYY-MM-DD`). */
function dayAfter(days: number): string {
  const date = new Date(Date.now() + days * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(date)
}

async function mealsTitled(client: ApiClient, title: string): Promise<Row<MealRecord>[]> {
  const result = await client.get(MEALS)
  expect(result.status).toBe(200)
  return (result.body as { data: Row<MealRecord>[] }).data.filter((row) =>
    row.record.title.startsWith(title),
  )
}

async function fillMealForm(page: Page, campus: string, day: string, title: string) {
  const form = page.getByRole('dialog', { name: 'Menü ekle' })
  await form.getByLabel('Kampüs').selectOption({ label: campus })
  await form.getByLabel('Menü günü').fill(day)
  await form.getByLabel('Yemekler').fill(title)
  await form.getByLabel('Alerjen bilgisi').fill('Yok')
  await form.getByLabel('Menü açıklaması').fill('Test menüsü.')
  await form.getByRole('button', { name: 'Kontrol et' }).click()
  await expect(form.getByRole('heading', { name: 'Kaydetmeden önce kontrol edin' })).toBeVisible()
  await expect(form.getByText(campus)).toBeVisible()
  return form
}

test.describe('okul iş akışları', () => {
  test('yönetici menü ekler, listede görür ve sürümle düzenler', async ({ loginAs, api }) => {
    const page = await loginAs('yonetici', { fresh: true })
    const client = await api('yonetici')
    const title = `E2E menü ${randomUUID().slice(0, 8)}`
    await page.goto('/yonetici/yemek-menusu')
    await expect(page.getByRole('heading', { name: 'Yemek Menüsü', level: 2 })).toBeVisible()
    await page.getByRole('button', { name: 'Menü ekle' }).click()
    const form = await fillMealForm(page, 'Beşiktaş Kampüsü', dayAfter(40), title)
    await form.getByRole('button', { name: 'Onayla ve kaydet' }).click()
    await expect(form).toBeHidden()

    await expect.poll(async () => (await mealsTitled(client, title)).length).toBe(1)
    const [created] = await mealsTitled(client, title)
    expect(created?.record.branchId).toBe('b2')

    await page.getByLabel('Tabloda ara').fill(title)
    await expect(page).toHaveURL(/[?&]q=/)
    const link = page.getByRole('button', { name: title })
    await expect(link).toBeVisible()
    await link.click()
    const detail = page.getByRole('dialog', { name: title })
    await expect(detail.getByText('Alerjenler: Yok')).toBeVisible()
    await expect(page).toHaveURL(/[?&]kayit=/)

    await detail.getByRole('button', { name: 'Menüyü düzenle' }).click()
    const edit = page.getByRole('dialog', { name: 'Menüyü düzenle' })
    await expect(edit.getByLabel('Yemekler')).toHaveValue(title)
    await edit.getByLabel('Yemekler').fill(`${title} güncel`)
    await edit.getByRole('button', { name: 'Kontrol et' }).click()
    const request = page.waitForRequest(
      (r: Request) => r.method() === 'POST' && WORKFLOW_MEAL.test(r.url()),
    )
    await edit.getByRole('button', { name: 'Onayla ve kaydet' }).click()
    expect((await request).headers()['if-match']).toBe(`"${created?.version}"`)
    await expect(edit).toBeHidden()

    await expect
      .poll(async () => (await mealsTitled(client, title))[0]?.record.title)
      .toBe(`${title} güncel`)
    const [updated] = await mealsTitled(client, title)
    expect(updated?.version).toBeGreaterThan(created?.version ?? 0)
  })

  test('onaya çift tıklama tek menü kaydı üretir', async ({ loginAs, api }) => {
    const page = await loginAs('yonetici', { fresh: true })
    const client = await api('yonetici')
    const title = `E2E çift ${randomUUID().slice(0, 8)}`
    const posts: Request[] = []
    page.on('request', (r) => {
      if (r.method() === 'POST' && WORKFLOW_MEAL.test(r.url())) posts.push(r)
    })
    await page.goto('/yonetici/yemek-menusu')
    await page.getByRole('button', { name: 'Menü ekle' }).click()
    const form = await fillMealForm(page, 'Ataşehir Kampüsü', dayAfter(41), title)
    await form.getByRole('button', { name: 'Onayla ve kaydet' }).dblclick()
    await expect(form).toBeHidden()

    await expect.poll(async () => (await mealsTitled(client, title)).length).toBe(1)
    expect(posts).toHaveLength(1)
  })

  test('öğretmen yalnız sorumlu olduğu kulübü görür', async ({ loginAs }) => {
    const page = await loginAs('ogretmen')
    await page.goto('/ogretmen/kulupler')
    await expect(page.getByText('Görev kapsamınızdaki kayıtlar')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Bilim ve Robotik' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sanat Atölyesi' })).toHaveCount(0)
    // Öğretmen kulüp açabilir; ön büro kulüp menüsünde değildir (core yetki tablosu).
    await expect(page.getByRole('button', { name: 'Kulüp oluştur' })).toBeVisible()
  })

  test('veli yalnız seçili çocuğunun kulüp kaydını görür', async ({ loginAs }) => {
    const page = await loginAs('veli')
    await page.goto('/veli/kulupler?cocuk=s2')
    await expect(page.getByText('Seçili çocuğunuzun kayıtları')).toBeVisible()
    await page.getByRole('button', { name: 'Bilim ve Robotik' }).click()
    const detail = page.getByRole('dialog', { name: 'Bilim ve Robotik' })
    const members = detail.locator('section', {
      has: page.getByRole('heading', { name: 'Üyeler' }),
    })
    await expect(members.getByText('Ece Yılmaz')).toBeVisible()
    await expect(members.getByText('Deniz Yılmaz')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Kulüp oluştur' })).toHaveCount(0)
  })

  test('dil okulunda okula özgü modülün adresi kullanıma kapalı der', async ({ loginAs }) => {
    const page = await loginAs({ email: 'ozan.er@kampus.example' })
    await page.goto('/ogretmen/hedef-plani')
    await expect(page.getByRole('heading', { name: 'Modül kullanıma kapalı' })).toBeVisible()
    await expect(page.getByText('Yönetici modül ayarlarını değiştirebilir.')).toBeVisible()
    // Menüde de yoktur: kategoriler açıldığında iki türde açık modüller görünür, hedef planı yok.
    const menu = page.getByRole('navigation').first()
    for (const group of ['Okul iş akışları', 'Okul yaşamı'])
      await menu.getByRole('button', { name: group }).click()
    await expect(menu.getByRole('link', { name: 'Okul Takvimi' })).toBeVisible()
    await expect(menu.getByRole('link', { name: 'Hedef & Gelişim Planı' })).toHaveCount(0)
  })

  test('390 px genişlikte takvim listesi ve ayrıntısı taşmaz', async ({ loginAs }) => {
    const page = await loginAs('veli')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/veli/okul-takvimi?cocuk=s1')
    await expect(page.getByRole('article').first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.getByRole('button', { name: 'Bilim müzesi gezisi' }).click()
    await expect(page.getByRole('dialog', { name: 'Bilim müzesi gezisi' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
