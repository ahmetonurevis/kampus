import { randomUUID } from 'node:crypto'

import { pdfText } from './support/finance-pdf-text.ts'
import { expect, test } from './support/fixtures.ts'

// Ücret hesap pusulası (ON-201; DOM-FIN-119, K-406…K-408). Kural dalları birim ve API
// testlerindedir (`tests/finance-payroll-payslips.test.ts`, `apps/api/test/finance-payroll-payslips.test.ts`,
// `apps/web-react/tests/finance-payroll-payslip-pdf.test.ts`); burada ücret tanımları ve Ocak 2026
// kayıtlı hesabı uçtan kurulur, yönetici "Bordro hesabı" sekmesinde satırdan tek pusulayı ve
// başlıktan ayın bütün pusulalarını PDF olarak indirir. Ay sabittir (2026 platform seti).

const ADMIN = '/yonetici/finans'

test.describe('DOM-FIN-119: ücret hesap pusulası', () => {
  test('DOM-FIN-119: yönetici kayıtlı hesaptan tek pusulayı ve ayın bütün pusulalarını PDF indirir', async ({
    api,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'onburo'] })
    const teacher = school.user('ogretmen').name
    const desk = school.user('onburo').name
    const admin = await api(school.user('yonetici'))
    const staff = await admin.get('/api/v1/finance/pay-rate-staff?pageSize=100')
    const people = (staff.body as { data: { membershipId: string; name: string }[] }).data
    const idOf = (name: string) => people.find((item) => item.name === name)?.membershipId ?? ''
    for (const [name, amountCents] of [
      [teacher, 15_000_000],
      [desk, 3_303_000],
    ] as const) {
      const created = await admin.post('/api/v1/finance/pay-rates', {
        component: 'wage',
        membershipId: idOf(name),
        rateType: 'monthly_gross',
        amountCents,
        startDate: '2026-01-01',
      })
      expect(created.status).toBe(201)
    }

    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=bordro-hesabi`)
    const section = page.getByRole('region', { name: 'Bordro hesabı' })
    await section.getByLabel('Ay', { exact: true }).fill('2026-01')
    const table = section.getByRole('table', { name: 'Ocak 2026 bordro hesabı' })
    const deskRow = table.getByRole('row', { name: new RegExp(desk) })
    // Kayıtlı hesap yokken pusula düğmesi yoktur (K-406).
    await expect(deskRow).toContainText('28.075,50 ₺')
    await expect(deskRow.getByRole('button', { name: `${desk} ücret hesap pusulası` })).toHaveCount(
      0,
    )

    const saved = await admin.post(
      '/api/v1/finance/payroll-runs/2026-01/calculate',
      { previousRunId: null },
      { 'idempotency-key': randomUUID() },
    )
    expect(saved.status).toBe(201)
    await page.reload()
    await section.getByLabel('Ay', { exact: true }).fill('2026-01')
    await expect(section.getByText('Kayıtlı hesap 1. revizyon', { exact: false })).toBeVisible()

    await deskRow.getByRole('button', { name: `${desk} ücret hesap pusulası` }).click()
    const preview = page.getByRole('dialog', { name: 'Ücret hesap pusulası · Önizleme' })
    const single = page.waitForEvent('download')
    await preview.getByRole('button', { name: 'PDF’yi indir' }).click()
    const singleText = await pdfText(await single)
    for (const expected of [
      'ÜCRET HESAP PUSULASI',
      'Ocak 2026',
      desk,
      '33.030,00 ₺',
      '28.075,50 ₺',
      'Onaylanmadı',
    ])
      expect(singleText).toContain(expected)
    expect(singleText).not.toContain(teacher)
    expect(singleText).not.toContain('İşveren maliyeti')
    await page.keyboard.press('Escape')
    await expect(preview).toBeHidden()

    await section.getByRole('button', { name: 'Ocak 2026 bütün ücret hesap pusulaları' }).click()
    const all = page.waitForEvent('download')
    await preview.getByRole('button', { name: 'PDF’yi indir' }).click()
    const allDownload = await all
    expect(allDownload.suggestedFilename()).toBe('bordro-pusulalari-2026-01.pdf')
    const allText = await pdfText(allDownload)
    for (const expected of [desk, teacher, '111.698,53 ₺']) expect(allText).toContain(expected)
    await page.keyboard.press('Escape')
    await expect(preview).toBeHidden()
  })
})
