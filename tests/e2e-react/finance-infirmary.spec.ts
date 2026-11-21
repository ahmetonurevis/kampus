import { randomUUID } from 'node:crypto'

import { dayKey } from '../../packages/school-core/src/lib/format.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Revir ve ilaç onayı (ON-101; DOM-FIN-151). Kural dalları birim ve API testlerindedir
// (`tests/finance-infirmary.test.ts`, `apps/api/test/finance-infirmary.test.ts`); burada ön büro
// dar ekranda revir ziyareti açıp kapatır (K-508), velinin API'den açtığı ilaç talebini onaylar ve
// bugünkü listeden dozu verildi olarak kaydeder; aynı doz ikinci kez sunulmaz (K-509). Veli
// çocuğunun ziyaret özetini okur (K-510).

const DESK = '/onburo/tahsilat-takip'

test.describe('DOM-FIN-151: revir', () => {
  test('DOM-FIN-151: ziyaret açılıp kapanır; onaylı ilaç bugünkü listeden verilir (K-508, K-509)', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo', 'veli'], students: ['s1'], childIds: ['s1'] })
    const guardian = await api(school.user('veli'))
    const today = dayKey(new Date())
    const consent = await guardian.context.post('/api/v1/finance/infirmary/medication-consents', {
      data: {
        studentId: 's1',
        medicationName: 'Parol şurup',
        dose: '5 ml',
        times: ['12:30'],
        startDate: today,
        endDate: today,
      },
      headers: { 'idempotency-key': randomUUID() },
    })
    expect(consent.status()).toBe(201)

    const page = await loginAs(school.user('onburo'))
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${DESK}?gorunum=revir`)
    const section = page.getByRole('region', { name: 'Revir' })
    await expect(section.getByText('Henüz revir ziyareti yok.')).toBeVisible()

    await section.getByRole('button', { name: 'Yeni ziyaret' }).click()
    const dialog = page.getByRole('dialog', { name: 'Yeni revir ziyareti' })
    const form = dialog.getByRole('form', { name: 'Yeni revir ziyareti' })
    await form.getByLabel('Öğrenci', { exact: true }).fill('Deniz')
    await form
      .getByRole('list', { name: 'Öğrenci arama sonuçları' })
      .getByRole('button')
      .first()
      .click()
    await form.getByLabel('Şikâyet').fill('Baş ağrısı')
    await form.getByLabel('Dinlenme').check()
    await form.getByRole('button', { name: 'Ziyareti aç' }).click()
    await expect(dialog).toBeHidden()
    await expectNoHorizontalOverflow(page)

    const panel = page.getByRole('dialog', { name: 'Revir ziyareti' })
    await expect(panel.getByText('Baş ağrısı')).toBeVisible()
    const discharge = panel.getByRole('form', { name: 'Ziyareti kapat' })
    await discharge.getByLabel('Sonuç').selectOption({ label: 'Sınıfa döndü' })
    await discharge.getByRole('button', { name: 'Ziyareti kapat' }).click()
    await expect(panel.getByRole('form', { name: 'Ziyareti kapat' })).toHaveCount(0)
    await expect(panel.getByText('Sınıfa döndü')).toBeVisible()
    await page.keyboard.press('Escape')

    await section.getByRole('button', { name: /ilaç talebini onayla/ }).click()
    const give = section.getByRole('button', { name: /12:30 dozunu verildi olarak kaydet/ })
    await give.click()
    await expect(section.getByRole('list', { name: 'Bugünkü ilaçlar' })).toContainText('Verildi')
    await expect(give).toHaveCount(0)

    const summaries = await guardian.context.get('/api/v1/finance/infirmary/my-visits')
    expect(summaries.status()).toBe(200)
    const body = (await summaries.json()) as { data: { outcome: string | null }[] }
    expect(body.data.map((row) => row.outcome)).toEqual(['returned_to_class'])
  })
})
