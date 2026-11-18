import type { Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Personel maliyeti (ON-204; DOM-FIN-104). Hesap, bastırma ve kural dalları birim ve API
// testlerindedir (`tests/finance-staff-costs.test.ts`, `apps/api/test/finance-staff-costs.test.ts`);
// burada yönetici öğretmeni iki merkeze %60/%40 atar (toplam %100 uyarısı dahil, K-332), rapor
// küçük grubu gizler, kişi satırlarıyla payı ve tutarı gösterir, CSV iner (K-334); ön büro sekmeyi
// görmez. Rapor ayı bugünün İstanbul ayıdır; ücret 2025 başından yürürlüktedir.

const ADMIN = '/yonetici/finans?gorunum=personel-maliyeti'
const DESK = '/onburo/tahsilat-takip?gorunum=personel-maliyeti'

async function created(client: ApiClient, path: string, body: unknown) {
  const result = await client.post(path, body)
  expect(result.status, JSON.stringify(result.body)).toBe(201)
  return (result.body as { data: { id: string } }).data
}

/** LISE ve ORTA birim merkezleri; öğretmene 45.000 ₺ aylık brüt ücret. */
async function setup(client: ApiClient, teacher: string) {
  await created(client, '/api/v1/finance/cost-centers', {
    code: 'LISE',
    name: 'Lise',
    type: 'unit',
  })
  await created(client, '/api/v1/finance/cost-centers', {
    code: 'ORTA',
    name: 'Ortaokul',
    type: 'unit',
  })
  const staff = await client.get('/api/v1/finance/pay-rate-staff?q=' + encodeURIComponent(teacher))
  expect(staff.status).toBe(200)
  const [row] = (staff.body as { data: { membershipId: string }[] }).data
  expect(row).toBeDefined()
  await created(client, '/api/v1/finance/pay-rates', {
    component: 'wage',
    membershipId: row?.membershipId,
    rateType: 'monthly_gross',
    amountCents: 4_500_000,
    startDate: '2025-01-01',
  })
}

const report = (page: Page) =>
  page
    .getByRole('region', { name: 'Personel maliyeti' })
    .getByRole('table', { name: 'Maliyet merkezine göre personel maliyeti' })
const centerRow = (page: Page, text: string) =>
  report(page).getByRole('row').filter({ hasText: text })

test.describe('DOM-FIN-104: personel maliyeti', () => {
  test('DOM-FIN-104: yönetici öğretmeni iki merkeze yüzdeyle atar, rapor küçük grubu gizler, kişi satırları ve CSV; ön büro sekmeyi görmez', async ({
    api,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'onburo'] })
    const teacher = school.user('ogretmen').name
    await setup(await api(school.user('yonetici')), teacher)
    const page = await loginAs(school.user('yonetici'))
    await page.goto(ADMIN)
    const section = page.getByRole('region', { name: 'Personel maliyeti' })

    await expect(centerRow(page, 'Atanmamış')).toContainText('Küçük grup')
    await expect(centerRow(page, 'Kurum toplamı')).toContainText('45.000,00 ₺')

    const staffRow = section
      .getByRole('region', { name: 'Maliyet merkezi atamaları' })
      .getByRole('row', { name: new RegExp(teacher) })
    await expect(staffRow).toContainText('Atama yok')
    await staffRow
      .getByRole('button', { name: `${teacher} maliyet merkezi atamalarını aç` })
      .click()
    const person = page.getByRole('dialog', { name: 'Maliyet merkezi ataması' })
    await expect(person.getByText('Henüz atama yok.')).toBeVisible()

    await person.getByRole('button', { name: 'Yeni atama' }).click()
    const dialog = page.getByRole('dialog', { name: 'Yeni maliyet merkezi ataması' })
    const form = dialog.getByRole('form', { name: 'Maliyet merkezi ataması' })
    await form.getByLabel('1. merkez', { exact: true }).selectOption({ label: 'LISE · Lise' })
    await form.getByLabel('1. pay (%)').fill('60')
    await form.getByRole('button', { name: 'Merkez ekle' }).click()
    await form.getByLabel('2. merkez', { exact: true }).selectOption({ label: 'ORTA · Ortaokul' })
    await form.getByLabel('2. pay (%)').fill('30')
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(form.getByText('Payların toplamı %100 olmalıdır (şu an %90).')).toBeVisible()
    await form.getByLabel('2. pay (%)').fill('40')
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(dialog).toBeHidden()

    const history = person.getByRole('list', { name: 'Atamalar' })
    await expect(history.getByRole('listitem')).toHaveCount(1)
    await expect(history.getByRole('listitem').first()).toContainText('LISE %60 · ORTA %40')
    await expect(history.getByRole('listitem').first()).toContainText('Bu ay')
    await page.keyboard.press('Escape')
    await expect(person).toBeHidden()
    await expect(staffRow).toContainText('LISE %60 · ORTA %40')

    await expect(centerRow(page, 'Lise')).toContainText('Küçük grup')
    await expect(centerRow(page, 'Ortaokul')).toContainText('Küçük grup')
    await section.getByRole('button', { name: 'Kişi satırlarını göster' }).click()
    await expect(centerRow(page, 'Lise')).toContainText('27.000,00 ₺')
    await expect(centerRow(page, 'Ortaokul')).toContainText('18.000,00 ₺')
    const people = section.getByRole('table', { name: 'Kişi bazında personel maliyeti' })
    await expect(people.getByRole('row').filter({ hasText: 'LISE · Lise' })).toContainText('%60')

    const downloading = page.waitForEvent('download')
    await section.getByRole('button', { name: 'CSV indir' }).click()
    expect((await downloading).suggestedFilename()).toMatch(/^personel-maliyeti-\d{4}-\d{2}\.csv$/)

    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)

    const desk = await loginAs(school.user('onburo'))
    await desk.goto(DESK)
    const tabs = desk.getByRole('toolbar', { name: 'Finans görünümü' })
    await expect(tabs.getByRole('button', { name: 'Taksitler' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(tabs.getByRole('button', { name: 'Personel maliyeti' })).toHaveCount(0)
    await expect(desk.getByRole('region', { name: 'Personel maliyeti' })).toHaveCount(0)
  })
})
