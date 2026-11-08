import type { Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Öğrenci başı maliyet ve kampüs karşılaştırması (ON-249, ON-250; DOM-FIN-065). Bölüşüm ve gelir
// dalları birim ve API testlerindedir (`tests/finance-cost-per-student.test.ts`,
// `tests/finance-campus-consolidation.test.ts`, `apps/api/test/finance-cost-reports.test.ts`);
// burada yöneticinin dönem ve anahtar seçimi, tablolar ve CSV var. Kurum: Kadıköy'de c1 ve c2
// (20 öğrenci), Beşiktaş'ta c9 (10 öğrenci).

const ADMIN_URL = '/yonetici/finans?gorunum=maliyet'
const DAY = 86_400_000

const section = (page: Page) =>
  page.getByRole('region', { name: 'Maliyet ve kampüs karşılaştırması' })
const costs = (page: Page) =>
  page.getByRole('region', { name: 'Öğrenci başı maliyet', exact: true })
const campuses = (page: Page) =>
  page.getByRole('region', { name: 'Kampüs karşılaştırması', exact: true })
const row = (scope: ReturnType<typeof costs>, text: string) =>
  scope.getByRole('row').filter({ hasText: text })

async function created(client: ApiClient, path: string, body: unknown) {
  const result = await client.post(path, body)
  expect(result.status, JSON.stringify(result.body)).toBe(201)
  return (result.body as { data: { id: string } }).data
}

/** GEN (birim) 30.000 ₺, KAD (Kadıköy) 10.000 ₺, BES (Beşiktaş) 5.000 ₺; bugünü kapsayan dönem. */
async function budget(client: ApiClient) {
  const gen = await created(client, '/api/v1/finance/cost-centers', {
    code: 'GEN',
    name: 'Genel müdürlük',
    type: 'unit',
  })
  const kad = await created(client, '/api/v1/finance/cost-centers', {
    code: 'KAD',
    name: 'Kadıköy merkezi',
    type: 'campus',
    campusId: 'b1',
  })
  const bes = await created(client, '/api/v1/finance/cost-centers', {
    code: 'BES',
    name: 'Beşiktaş merkezi',
    type: 'campus',
    campusId: 'b2',
  })
  const item = await created(client, '/api/v1/finance/budget-items', {
    code: 'P-100',
    name: 'Personel',
    kind: 'expense',
  })
  const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10)
  const period = await created(client, '/api/v1/finance/budget-periods', {
    name: 'Maliyet dönemi',
    startDate: day(-100),
    endDate: day(200),
  })
  for (const [center, amountCents] of [
    [gen, 3_000_000],
    [kad, 1_000_000],
    [bes, 500_000],
  ] as const)
    await created(client, `/api/v1/finance/budget-periods/${period.id}/lines`, {
      costCenterId: center.id,
      itemId: item.id,
      amountCents,
    })
}

test.describe('DOM-FIN-065: öğrenci başı maliyet ve kampüs karşılaştırması ekranı', () => {
  test('DOM-FIN-065: yönetici ortak gideri anahtarla paylaştırır, kampüsleri karşılaştırır ve CSV indirir', async ({
    api,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: [], classes: ['c1', 'c2', 'c9'] })
    await budget(await api(school.user('yonetici')))
    const page = await loginAs(school.user('yonetici'))
    await page.goto(ADMIN_URL)
    await expect(section(page).getByLabel('Bütçe dönemi')).toHaveValue(/.+/)

    // Öğrenci sayısına göre: GEN 2 : 1 → Kadıköy 10.000 + 20.000, Beşiktaş 5.000 + 10.000.
    await expect(row(costs(page), 'Kadıköy merkezi')).toContainText('30.000,00 ₺')
    await expect(row(costs(page), 'Kadıköy merkezi')).toContainText('1.500,00 ₺')
    await expect(row(costs(page), 'Beşiktaş merkezi')).toContainText('15.000,00 ₺')
    await expect(row(costs(page), 'Genel müdürlük')).toContainText('Birim · paylaştırıldı')

    await section(page).getByLabel('Ortak gider bölüşümü').selectOption({ label: 'Eşit' })
    await expect(row(costs(page), 'Kadıköy merkezi')).toContainText('25.000,00 ₺')
    await expect(row(costs(page), 'Beşiktaş merkezi')).toContainText('20.000,00 ₺')

    const kadikoy = row(campuses(page), 'Kadıköy Kampüsü')
    await expect(kadikoy.getByRole('cell').nth(1)).toHaveText('20')
    await expect(kadikoy).toContainText('25.000,00 ₺')
    await expect(row(campuses(page), 'Kampüsler toplamı')).toContainText('45.000,00 ₺')

    const downloading = page.waitForEvent('download')
    await campuses(page).getByRole('button', { name: 'CSV indir' }).click()
    expect((await downloading).suggestedFilename()).toMatch(/^kampus-karsilastirmasi-.+\.csv$/)
  })

  test('DOM-FIN-065: ön büro maliyet sekmesini görmez; dönemsiz kurumda yönlendirme, dar ekranda taşma yok', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'] })
    const desk = await loginAs(school.user('onburo'))
    await desk.goto('/onburo/tahsilat-takip?gorunum=maliyet')
    await expect(desk.getByRole('button', { name: 'Taksitler', exact: true })).toBeVisible()
    await expect(desk.getByRole('button', { name: 'Maliyet', exact: true })).toHaveCount(0)
    await expect(section(desk)).toHaveCount(0)

    const page = await loginAs(school.user('yonetici'))
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(ADMIN_URL)
    await expect(section(page).getByText(/Önce "Bütçe" sekmesinde/)).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
