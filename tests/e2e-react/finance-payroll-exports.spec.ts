import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { expect, test } from './support/fixtures.ts'
import { istanbulDay } from './support/finance-refund-invoices.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Bordro programına aktarım (ON-202, ON-343; DOM-FIN-105). Kural dalları birim ve API
// testlerindedir (`tests/finance-payroll-exports.test.ts`, `apps/api/test/finance-payroll-exports.test.ts`);
// burada yönetici bu ayın önizlemesinde öğretmenin ana ücretini ve avans taksitini (DOM-FIN-101,
// K-392) görür, ek ders saati girer; saat "onay bekliyor"dur, çizelgeyi öğretmen kontrolüne
// gönderir, öğretmen teyidini kaydeder ve müdür onayı verir (DOM-FIN-120, K-409…K-411); onaydan
// sonra saat × ücret satırını görür, saat eklenemez ve CSV'yi indirir (K-336…K-338); ön büro
// sekmeyi görmez. Ay İstanbul gününe göre seçilir.

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip'

test.describe('DOM-FIN-105: bordro aktarımı', () => {
  test('DOM-FIN-105: DOM-FIN-120: yönetici ek ders saati girer, çizelgeyi onaylatır, avans kesintisini ve önizlemeyi görür, CSV indirir; ön büro sekmeyi görmez', async ({
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
    const month = istanbulDay().slice(0, 7)
    const advance = await manager.post(
      '/api/v1/finance/staff-advances',
      {
        membershipId,
        amountCents: 200_000,
        givenDate: istanbulDay(),
        paymentMethod: 'cash',
        installmentCount: 2,
        firstMonth: month,
      },
      { 'idempotency-key': randomUUID() },
    )
    expect(advance.status, JSON.stringify(advance.body)).toBe(201)
    await manager.dispose()

    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=bordro-aktarim`)
    const section = page.getByRole('region', { name: 'Bordro aktarımı' })
    await expect(section.getByLabel('Bordro ayı')).toHaveValue(month)
    const wage = section.getByRole('row', { name: /Ana ücret · Aylık brüt/ })
    await expect(wage).toContainText(teacher)
    await expect(wage).toContainText('45.000,00 ₺')
    const deduction = section.getByRole('row', { name: /Kesinti · Avans taksiti \(1\/2\)/ })
    await expect(deduction).toContainText('Taksit 1/2')
    await expect(deduction).toContainText('-1.000,00 ₺')

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
    await expect(lesson).toContainText('Onay bekliyor')

    // Çizelge onayı (DOM-FIN-120): gönder, öğretmen adına teyit, müdür onayı.
    const sheet = section.getByRole('region', { name: 'Ek ders çizelgesi onayı' })
    await expect(sheet).toContainText('Taslak')
    await sheet.getByRole('button', { name: 'Öğretmen kontrolüne gönder' }).click()
    await expect(sheet).toContainText('Öğretmen kontrolünde')
    await expect(sheet.getByRole('button', { name: 'Müdür onayı ver' })).toBeDisabled()
    await sheet.getByRole('button', { name: `${teacher} teyidini kaydet` }).click()
    const confirmDialog = page.getByRole('dialog', { name: 'Öğretmen teyidi' })
    await confirmDialog.getByLabel('Kanal').selectOption({ label: 'Telefon' })
    await confirmDialog.getByRole('button', { name: 'Kaydet' }).click()
    await expect(confirmDialog).toBeHidden()
    const teachers = sheet.getByRole('list', { name: 'Öğretmen teyitleri' })
    await expect(teachers).toContainText('Teyit edildi')
    await expect(teachers).toContainText('Telefon')
    await sheet.getByRole('button', { name: 'Müdür onayı ver' }).click()
    const approveDialog = page.getByRole('dialog', { name: /ek ders çizelgesini onayla/ })
    await approveDialog.getByRole('button', { name: 'Onayla ve kilitle' }).click()
    await expect(approveDialog).toBeHidden()
    await expect(sheet).toContainText('Müdür onaylı (kilitli)')
    await expect(sheet.getByRole('button', { name: 'Çizelgeyi yeniden aç' })).toBeVisible()
    await expect(section.getByRole('button', { name: 'Ek ders saati ekle' })).toBeDisabled()
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
    expect(csv).toContain(
      `"deduction.advance";"Kesinti · Avans taksiti (1/2)";"Kesinti";"Aylık";;;1000,00;`,
    )
    const history = section.getByRole('list', { name: 'Üretilen dosyalar' })
    await expect(history.getByRole('listitem')).toHaveCount(1)
    await expect(history).toContainText(
      '3 satır · 1 personel · 49.200,00 ₺ · kesinti 1.000,00 ₺ · genel dosya',
    )

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
