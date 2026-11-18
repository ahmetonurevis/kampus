import { readFile } from 'node:fs/promises'

import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Bordro hesabı (ON-198; DOM-FIN-115). Kural dalları birim ve API testlerindedir
// (`tests/finance-payroll-calc.test.ts`, `apps/api/test/finance-payroll-runs.test.ts`); burada
// ücret tanımları uçtan kurulur, yönetici Ocak 2026 hesabında asgari ücretli ve yüksek ücretli
// satırı görür (K-387, K-388), ayrıntı panelini açar, matrah devri girer, hesabı kaydeder (K-391)
// ve CSV indirir; ön büro sekmeyi görmez. Ay sabittir (2026 platform seti); gerçek güne bağlı değildir.

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip'

test.describe('DOM-FIN-115: bordro hesabı', () => {
  test('DOM-FIN-115: yönetici ayı hesaplar, ayrıntıyı görür, devir girer, kaydeder ve CSV indirir; ön büro sekmeyi görmez', async ({
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
    await expect(section.getByText('mali müşavir doğrulaması', { exact: false })).toBeVisible()
    await section.getByLabel('Ay', { exact: true }).fill('2026-01')
    const table = section.getByRole('table', { name: 'Ocak 2026 bordro hesabı' })
    const deskRow = table.getByRole('row', { name: new RegExp(desk) })
    const teacherRow = table.getByRole('row', { name: new RegExp(teacher) })
    // Asgari ücretli: net 28.075,50 ₺, vergi istisnayla sıfır.
    await expect(deskRow).toContainText('33.030,00 ₺')
    await expect(deskRow).toContainText('28.075,50 ₺')
    // 150.000 ₺: net 111.698,53 ₺ (GV 19.125 − 4.211,33; DV 1.138,50 − 250,70).
    await expect(teacherRow).toContainText('111.698,53 ₺')
    await expect(section.getByText('Bu ayın kayıtlı hesabı yok.')).toBeVisible()

    await teacherRow.getByRole('button', { name: `${teacher} bordro ayrıntısı` }).click()
    const panel = page.getByRole('dialog', { name: 'Bordro ayrıntısı' })
    await expect(panel.getByRole('region', { name: 'Vergi' })).toContainText('19.125,00 ₺')
    const form = panel.getByRole('form', { name: 'Matrah devri ekle' })
    await form.getByLabel('Devralınan matrah (₺)').fill('abc')
    await form.getByRole('button', { name: 'Devri kaydet' }).click()
    await expect(form.getByText('Matrahı 1.234,56 biçiminde', { exact: false })).toBeVisible()
    await form.getByLabel('Devralınan matrah (₺)').fill('190.000')
    await form.getByRole('button', { name: 'Devri kaydet' }).click()
    await expect(panel.getByText('Devralınan matrah 190.000,00 ₺')).toBeVisible()
    // Devirle bütün matrah %20 dilimine düşer: 127.500 × %20 = 25.500 ₺.
    await expect(panel.getByRole('region', { name: 'Vergi' })).toContainText('25.500,00 ₺')
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()

    await section.getByRole('button', { name: 'Hesabı kaydet' }).click()
    await expect(section.getByText('Kayıtlı hesap 1. revizyon', { exact: false })).toBeVisible()
    await expect(section.getByRole('button', { name: 'Yeniden hesapla ve kaydet' })).toBeEnabled()

    const csvDownload = page.waitForEvent('download')
    await section.getByRole('button', { name: 'Kayıtlı hesabı indir' }).click()
    const csv = await csvDownload
    expect(csv.suggestedFilename()).toBe('bordro-hesabi-2026-01-kayitli.csv')
    const csvText = await readFile(await csv.path(), 'utf8')
    expect(csvText.startsWith('﻿"Ad soyad";"Hesaplandı"')).toBe(true)
    expect(csvText).toContain(`"${desk}";"Evet";30;33030,00;`)

    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)

    const deskPage = await loginAs(school.user('onburo'))
    await deskPage.goto(`${DESK}?gorunum=bordro-hesabi`)
    const tabs = deskPage.getByRole('toolbar', { name: 'Finans görünümü' })
    await expect(tabs.getByRole('button', { name: 'Taksitler' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(tabs.getByRole('button', { name: 'Bordro hesabı' })).toHaveCount(0)
  })
})
