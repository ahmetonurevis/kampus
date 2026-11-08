import { randomUUID } from 'node:crypto'

import type { Page } from '@playwright/test'

import { seedScholarshipAward } from './support/finance-scholarship-funds.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Burs fonu ekranı (ON-259; DOM-FIN-068). Kural dalları birim ve API testlerindedir
// (`tests/finance-scholarship-funds.test.ts`, `apps/api/test/finance-scholarship-funds.test.ts`);
// burada yöneticinin fon açma, bağış girme, bursu fondan karşılama ve iptal akışı ile ön büronun
// salt okur görünümü var.

const ADMIN_URL = '/yonetici/finans?gorunum=burs-fonu'
const DESK_URL = '/onburo/tahsilat-takip?gorunum=burs-fonu'
const FUND = 'Mezunlar Burs Fonu'

const funds = (page: Page) => page.getByRole('region', { name: 'Burs fonları' })
const panel = (page: Page) => page.getByRole('dialog', { name: 'Burs fonu', exact: true })

test.describe('ON-259: burs fonu ekranı', () => {
  test('DOM-FIN-068: yönetici fon açar, bağış girer, bursu fondan karşılar ve atamayı iptal eder', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'], students: ['s1'] })
    await seedScholarshipAward({
      institutionId: school.institutionId,
      studentId: 's1',
      amountCents: 1_000_000,
    })
    const page = await loginAs(school.user('yonetici'))
    await page.goto(ADMIN_URL)
    await expect(funds(page).getByText('Henüz burs fonu yok.')).toBeVisible()

    await funds(page).getByRole('button', { name: 'Yeni fon' }).click()
    const form = page.getByRole('dialog', { name: 'Yeni burs fonu' })
    await form.getByLabel('Fon adı').fill(FUND)
    await form.getByRole('button', { name: 'Kaydet' }).click()
    // Kurum bağışçısında ad zorunludur (K-95).
    await expect(form.getByText('Bağışçının adını ya da kurum adını yazın.')).toBeVisible()
    await form.getByLabel('Kurum adı').fill('Mezunlar Derneği')
    await form.getByRole('button', { name: 'Kaydet' }).click()

    const detail = panel(page)
    await expect(detail.getByRole('heading', { name: FUND })).toBeVisible()
    await detail.getByRole('button', { name: 'Bağış ekle' }).click()
    const donation = page.getByRole('dialog', { name: 'Bağış ekle' })
    await donation.getByLabel('Tutar (₺)').fill('15.000')
    await donation.getByRole('button', { name: 'Kaydet' }).click()
    await expect(donation).toBeHidden()
    const movements = detail.getByRole('list', { name: 'Fon hareketleri' })
    await expect(movements.getByRole('listitem')).toHaveCount(1)

    await detail.getByRole('button', { name: 'Bursu fondan karşıla' }).click()
    const allocation = page.getByRole('dialog', { name: 'Bursu fondan karşıla' })
    await allocation.getByLabel('Burs ataması', { exact: true }).selectOption({ index: 1 })
    // Bursun karşılanmamış kısmını aşan tutar alan hatasıyla döner (K-96).
    await allocation.getByLabel('Fondan karşılanacak tutar (₺)').fill('12.000')
    await allocation.getByRole('button', { name: 'Kaydet' }).click()
    await expect(
      allocation.getByText('Tutar bursun fonlardan karşılanmamış kısmını aşıyor.'),
    ).toBeVisible()
    await allocation.getByLabel('Fondan karşılanacak tutar (₺)').fill('6.000')
    await allocation.getByRole('button', { name: 'Kaydet' }).click()
    await expect(allocation).toBeHidden()
    await expect(movements.getByRole('listitem')).toHaveCount(2)
    await expect(movements.getByText(/Deniz Yılmaz/)).toBeVisible()
    await expect(movements.getByText('Bakiye 9.000,00 ₺')).toBeVisible()

    // Atama iptali tutarı bakiyeye geri verir (K-97).
    await movements.getByRole('button', { name: /^Burs ataması .* iptal et$/ }).click()
    const cancel = page.getByRole('dialog', { name: 'Burs ataması iptali' })
    await cancel.getByLabel('İptal gerekçesi').fill('Yanlış öğrenci seçildi')
    await cancel.getByRole('button', { name: 'İptal et' }).click()
    await expect(cancel).toBeHidden()
    await expect(movements.getByText('İptal edildi')).toBeVisible()
    await expect(detail.getByText('15.000,00 ₺').first()).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(detail).toBeHidden()
    await expect(funds(page).getByRole('cell', { name: FUND, exact: true })).toBeVisible()
  })

  test('DOM-FIN-068: ön büro fonu salt okur görür, öğrenci adı görmez; dar ekranda taşmaz (K-98)', async ({
    loginAs,
    tenant,
    api,
  }) => {
    const school = await tenant({ roles: ['onburo'], students: ['s1'] })
    const awardId = await seedScholarshipAward({
      institutionId: school.institutionId,
      studentId: 's1',
      amountCents: 1_000_000,
    })
    const admin = await api(school.user('yonetici'))
    const made = await admin.post('/api/v1/finance/scholarship-funds', {
      name: FUND,
      donorKind: 'anonymous',
    })
    expect(made.status, 'fon').toBe(201)
    const fundId = (made.body as { data: { fund: { id: string } } }).data.fund.id
    const headers = () => ({ 'idempotency-key': randomUUID() })
    const donated = await admin.post(
      `/api/v1/finance/scholarship-funds/${fundId}/donations`,
      { amountCents: 500_000, donatedOn: new Date().toISOString().slice(0, 10), channel: 'cash' },
      headers(),
    )
    expect(donated.status, 'bağış').toBe(201)
    const allocated = await admin.post(
      `/api/v1/finance/scholarship-funds/${fundId}/allocations`,
      { awardId, amountCents: 200_000 },
      headers(),
    )
    expect(allocated.status, 'atama').toBe(201)

    const page = await loginAs(school.user('onburo'))
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(DESK_URL)
    await expect(funds(page).getByRole('button', { name: 'Yeni fon' })).toHaveCount(0)
    await funds(page)
      .getByRole('button', { name: `${FUND} fonunu aç` })
      .click()
    const detail = panel(page)
    await expect(detail.getByText('Anonim', { exact: true })).toBeVisible()
    const movements = detail.getByRole('list', { name: 'Fon hareketleri' })
    await expect(movements.getByText(/Öğrenci adı gizli/)).toBeVisible()
    await expect(movements.getByText(/Deniz Yılmaz/)).toHaveCount(0)
    await expect(detail.getByRole('button', { name: 'Bağış ekle' })).toHaveCount(0)
    await expect(detail.getByRole('button', { name: /iptal et$/ })).toHaveCount(0)
    await expectNoHorizontalOverflow(page)
  })
})
