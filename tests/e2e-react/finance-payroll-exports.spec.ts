import { readFile } from 'node:fs/promises'

import { expect, test } from './support/fixtures.ts'
import { istanbulDay } from './support/finance-refund-invoices.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Bordro programına aktarım (ON-202; DOM-FIN-105). Kural dalları birim ve API testlerindedir
// (`tests/finance-payroll-exports.test.ts`, `apps/api/test/finance-payroll-exports.test.ts`);
// burada yönetici bu ayın önizlemesinde öğretmenin ana ücretini görür, ek ders saati girer, saat ×
// ücret satırını görür ve CSV'yi indirir (K-336…K-338); ön büro sekmeyi görmez. Ay İstanbul
// gününe göre seçilir.

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip'

test.describe('DOM-FIN-105: bordro aktarımı', () => {
  test('DOM-FIN-105: yönetici ek ders saati girer, önizlemeyi görür ve CSV indirir; ön büro sekmeyi görmez', async ({
    api,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'onburo'] })
    const teacher = school.user('ogretmen').name
    const manager = await api(school.user('yonetici'))
    const staff = await manager.get(
      `/api/v1/finance/pay-rate-staff?q=${encodeURIComponent(teacher)}`,
    )
    expect(staff.status).toBe(200)
    const membershipId = (staff.body as { data: { membershipId: string }[] }).data[0]?.membershipId
    expect(membershipId).toBeTruthy()
    for (const body of [
      { component: 'wage', rateType: 'monthly_gross', amountCents: 4_500_000 },
      { component: 'lesson', rateType: 'extra', amountCents: 35_000 },
    ]) {
      const created = await manager.post('/api/v1/finance/pay-rates', {
        ...body,
        membershipId,
        startDate: '2025-01-01',
      })
      expect(created.status).toBe(201)
    }
    await manager.dispose()

    const month = istanbulDay().slice(0, 7)
    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=bordro-aktarim`)
    const section = page.getByRole('region', { name: 'Bordro aktarımı' })
    await expect(section.getByLabel('Bordro ayı')).toHaveValue(month)
    const wage = section.getByRole('row', { name: /Ana ücret · Aylık brüt/ })
    await expect(wage).toContainText(teacher)
    await expect(wage).toContainText('45.000,00 ₺')

    await section.getByRole('button', { name: 'Ek ders saati ekle' }).click()
    const dialog = page.getByRole('dialog', { name: 'Ek ders saati ekle' })
    const form = dialog.getByRole('form', { name: 'Ek ders saati' })
    await form.getByLabel('Personel', { exact: true }).selectOption({ label: teacher })
    await form.getByLabel('Ayın toplam saati').fill('0')
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(form.getByText('Saati 1 ile 400 arasında tam sayı girin.')).toBeVisible()
    await form.getByLabel('Ayın toplam saati').fill('12')
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(dialog).toBeHidden()

    const lesson = section.getByRole('row', { name: /Ek ders ücreti · Ek ders/ })
    await expect(lesson).toContainText('12 saat')
    await expect(lesson).toContainText('4.200,00 ₺')
    await expect(section.getByText('49.200,00 ₺')).toBeVisible()

    const download = page.waitForEvent('download')
    await section.getByRole('button', { name: 'CSV indir' }).click()
    const file = await download
    expect(file.suggestedFilename()).toBe(`bordro-girdi-${month}.csv`)
    const csv = await readFile(await file.path(), 'utf8')
    expect(csv.startsWith('\uFEFF"Dönem";"Personel no";"Personel"')).toBe(true)
    expect(csv).toContain(
      `"lesson.extra";"Ek ders ücreti · Ek ders";"Kazanç";"Saat";350,00;12;4200,00;`,
    )
    const history = section.getByRole('list', { name: 'Üretilen dosyalar' })
    await expect(history.getByRole('listitem')).toHaveCount(1)
    await expect(history).toContainText('2 satır · 1 personel · 49.200,00 ₺ · genel dosya')

    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)

    const desk = await loginAs(school.user('onburo'))
    await desk.goto(`${DESK}?gorunum=bordro-aktarim`)
    const tabs = desk.getByRole('toolbar', { name: 'Finans görünümü' })
    await expect(tabs.getByRole('button', { name: 'Taksitler' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(tabs.getByRole('button', { name: 'Bordro aktarımı' })).toHaveCount(0)
    await expect(desk.getByRole('region', { name: 'Bordro aktarımı' })).toHaveCount(0)
  })
})
