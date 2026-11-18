import { readFile } from 'node:fs/promises'

import { pdfText } from './support/finance-pdf-text.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// SGK bildirge hazırlık listesi (ON-203; DOM-FIN-107). Kural dalları birim ve API testlerindedir
// (`tests/finance-sgk-preparation.test.ts`, `apps/api/test/finance-sgk-preparation.test.ts`);
// burada ücret tanımları uçtan kurulur, yönetici Ekim 2025 listesinde ay içi girişi ve taban
// uyarısını görür (K-352, K-354), öğretmene nedenli ve nedensiz eksik gün girer (K-353), CSV ve
// PDF indirir (K-355); ön büro sekmeyi görmez. Ay sabittir (2025 parametre seti: taban
// 26.005,50 ₺); gerçek güne bağlı değildir.

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip'

test.describe('DOM-FIN-107: SGK hazırlık listesi', () => {
  test('DOM-FIN-107: yönetici ay listesini görür, eksik gün girer, CSV ve PDF indirir; ön büro sekmeyi görmez', async ({
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
    for (const [name, startDate, amountCents] of [
      [teacher, '2025-01-01', 4_500_000],
      [desk, '2025-10-16', 2_000_000],
    ] as const) {
      const created = await admin.post('/api/v1/finance/pay-rates', {
        component: 'wage',
        membershipId: idOf(name),
        rateType: 'monthly_gross',
        amountCents,
        startDate,
      })
      expect(created.status).toBe(201)
    }

    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=sgk-hazirlik`)
    const section = page.getByRole('region', { name: 'SGK hazırlık listesi' })
    await expect(section.getByText('resmî bildirge değildir', { exact: false })).toBeVisible()
    await section.getByLabel('Ay', { exact: true }).fill('2025-10')
    const table = section.getByRole('table', { name: 'Ekim 2025 SGK hazırlık listesi' })
    const teacherRow = table.getByRole('row', { name: new RegExp(teacher) })
    const deskRow = table.getByRole('row', { name: new RegExp(desk) })
    await expect(teacherRow.getByRole('cell').nth(2)).toHaveText('30')
    await expect(teacherRow).toContainText('Aylık brüt 45.000,00 ₺')
    await expect(teacherRow).toContainText('45.000,00 ₺')
    await expect(deskRow).toContainText('Giriş: 16 Eki 2025 (ücret tanımı)')
    await expect(deskRow.getByRole('cell').nth(2)).toHaveText('16')
    // 20.000 ₺ × 16/30 tabanın (26.005,50 × 16/30 = 13.869,60 ₺) altında kalır.
    await expect(deskRow).toContainText('13.869,60 ₺')
    const deskWarnings = deskRow.getByRole('list', { name: `${desk} uyarıları` })
    await expect(deskWarnings.getByRole('listitem')).toHaveText([
      'Tabanın altında ücret: SGK matrahı tabana yükseltildi',
      'Ay içinde işe giriş',
    ])

    await teacherRow.getByRole('button', { name: `${teacher} eksik gün ve giriş/çıkış` }).click()
    const panel = page.getByRole('dialog', { name: 'SGK satırı' })
    const form = panel.getByRole('form', { name: 'Eksik gün ekle' })
    await form.getByLabel('Eksik gün').fill('31')
    await form.getByRole('button', { name: 'Eksik gün ekle' }).click()
    await expect(form.getByText('Eksik gün sayısını 1 ile 30 arasında girin.')).toBeVisible()
    await form.getByLabel('Eksik gün').fill('2')
    await form.getByLabel('Neden').selectOption({ label: '21 · Diğer ücretsiz izin' })
    await form.getByRole('button', { name: 'Eksik gün ekle' }).click()
    const entries = panel.getByRole('list', { name: 'Eksik gün satırları' })
    await expect(entries.getByRole('listitem')).toHaveCount(1)
    await form.getByLabel('Eksik gün').fill('1')
    await form.getByRole('button', { name: 'Eksik gün ekle' }).click()
    await expect(entries.getByRole('listitem')).toHaveCount(2)
    await expect(entries).toContainText('1 gün · neden girilmemiş')
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()

    await expect(teacherRow.getByRole('cell').nth(2)).toHaveText('27')
    await expect(teacherRow.getByRole('cell').nth(3)).toHaveText('3')
    await expect(teacherRow).toContainText('21 · Diğer ücretsiz izin')
    await expect(teacherRow).toContainText('Eksik gün nedeni girilmemiş')
    // 45.000 × 27/30 = 40.500 ₺.
    await expect(teacherRow).toContainText('40.500,00 ₺')

    const csvDownload = page.waitForEvent('download')
    await section.getByRole('button', { name: 'CSV indir' }).click()
    const csv = await csvDownload
    expect(csv.suggestedFilename()).toBe('sgk-hazirlik-listesi-2025-10.csv')
    const csvText = await readFile(await csv.path(), 'utf8')
    expect(csvText.startsWith('\uFEFF"Ad soyad";"T.C. kimlik no"')).toBe(true)
    expect(csvText).toContain(`"${teacher}";"";"Öğretmen";"";"";"";"";27;3;"21"`)
    expect(csvText).toContain('"Toplam";"";"2 personel"')

    await section.getByRole('button', { name: 'SGK hazırlık listesi PDF' }).click()
    const preview = page.getByRole('dialog', { name: 'SGK bildirge hazırlık listesi · Önizleme' })
    const pdfDownload = page.waitForEvent('download')
    await preview.getByRole('button', { name: 'PDF’yi indir' }).click()
    const pdf = await pdfDownload
    expect(pdf.suggestedFilename()).toBe('sgk-hazirlik-listesi-2025-10.pdf')
    const text = await pdfText(pdf)
    for (const expected of ['SGK HAZIRLIK LİSTESİ', 'Ekim 2025', teacher, desk])
      expect(text).toContain(expected)
    await page.keyboard.press('Escape')
    await expect(preview).toBeHidden()

    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)

    const deskPage = await loginAs(school.user('onburo'))
    await deskPage.goto(`${DESK}?gorunum=sgk-hazirlik`)
    const tabs = deskPage.getByRole('toolbar', { name: 'Finans görünümü' })
    await expect(tabs.getByRole('button', { name: 'Taksitler' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(tabs.getByRole('button', { name: 'SGK hazırlık listesi' })).toHaveCount(0)
    await expect(deskPage.getByRole('region', { name: 'SGK hazırlık listesi' })).toHaveCount(0)
  })
})
