import { readFile } from 'node:fs/promises'

import { pdfText } from './support/finance-pdf-text.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Ders saati hakediş dökümü (ON-075; DOM-FIN-167; IST-087; K-556…K-558). Kural dalları birim ve
// API testlerindedir (`tests/finance-hourly-lesson-payouts.test.ts`,
// `apps/api/test/finance-hourly-lesson-payouts.test.ts`); burada ders saati ücretli öğretmenin
// Ekim 2025'teki on dersinden biri iptaldir: yönetici ay özetini ve gün gün dökümü görür, CSV ve
// PDF indirir; ön büro sekmeyi görmez; yöneticinin kendi "Ders saati dökümüm" bölümü boştur. Ay
// sabittir, bütün dersler geçmiştedir; dersler testin kendi kurumuna doğrudan yazılır.

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip'
const MONTH = '2025-10'
const DAYS = ['2025-10-06', '2025-10-07', '2025-10-08', '2025-10-09', '2025-10-10']

test.describe('DOM-FIN-167: ders saati hakediş dökümü', () => {
  test('DOM-FIN-167: yönetici saat ücretli öğretmenin dökümünü görür, CSV ve PDF indirir; ön büro görmez', async ({
    api,
    loginAs,
    tenant,
  }) => {
    // İstanbul 09.00'dan başlayan günde iki ders (40 dk), öğretmen kaydı t1; salı ilk ders iptal.
    const records = DAYS.flatMap((day) =>
      [0, 1].map((period) => ({
        collection: 'schedule' as const,
        data: {
          id: `e2e-hakedis-${day}-${String(period)}`,
          classId: 'c1',
          teacherId: 't1',
          subjectId: 'mat',
          date: new Date(Date.parse(`${day}T06:00:00.000Z`) + period * 50 * 60_000).toISOString(),
          duration: 40,
          title: 'Matematik',
          room: '101',
          ...(day === '2025-10-07' && period === 0
            ? { cancelledAt: '2025-10-01T08:00:00.000Z' }
            : {}),
        },
      })),
    )
    const school = await tenant({ roles: ['ogretmen', 'onburo'], records })
    const teacher = school.user('ogretmen').name
    const manager = await api(school.user('yonetici'))
    const staff = await manager.get(
      `/api/v1/finance/pay-rate-staff?q=${encodeURIComponent(teacher)}`,
    )
    expect(staff.status).toBe(200)
    const membershipId = (staff.body as { data: { membershipId: string }[] }).data[0]?.membershipId
    expect(membershipId).toBeTruthy()
    const wage = await manager.post('/api/v1/finance/pay-rates', {
      component: 'wage',
      rateType: 'lesson_hour',
      amountCents: 50_000,
      membershipId,
      startDate: '2025-01-01',
    })
    expect(wage.status).toBe(201)
    await manager.dispose()

    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=ders-saati-hakedis`)
    const section = page.getByRole('region', { name: 'Ders saati hakediş dökümü' })
    await section.getByLabel('Ay', { exact: true }).fill(MONTH)
    const summary = section.getByRole('definition').filter({ hasText: '4.500,00' })
    await expect(summary).toBeVisible()
    const table = section.getByRole('table', { name: 'Ekim 2025 ders saati hakediş dökümü' })
    const row = table.getByRole('row', { name: new RegExp(teacher) })
    await expect(row).toContainText('Saat ya da ders saati ücretli')
    await expect(row.getByRole('cell').nth(2)).toHaveText('9')
    await expect(row.getByRole('cell').nth(3)).toHaveText('1')
    await expect(row.getByRole('cell').nth(4)).toHaveText('0')
    await expect(row).toContainText('4.500,00')

    await row.getByRole('button', { name: `${teacher} dökümünü aç` }).click()
    const detail = page.getByRole('dialog', { name: `${teacher} · ders saati dökümü` })
    await expect(detail).toContainText('9 ders, 9 ders saati · 1 iptal · 0 telafi')
    const lessons = detail.getByRole('table', { name: `${teacher} Ekim 2025 dersleri` })
    await expect(lessons.getByRole('row')).toHaveCount(11)
    await expect(lessons.getByText('İptal edildi')).toHaveCount(1)
    await expect(lessons.getByText('Ödenmez')).toHaveCount(1)
    await expect(lessons.getByText('09:00 · 40 dk · 1 ders saati').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(detail).toBeHidden()

    const csvDownload = page.waitForEvent('download')
    await section.getByRole('button', { name: 'Ders saati hakediş dökümü CSV' }).click()
    const csv = await csvDownload
    expect(csv.suggestedFilename()).toBe('ders-saati-hakedis-2025-10.csv')
    const csvText = await readFile(await csv.path(), 'utf8')
    expect(csvText.startsWith('\uFEFF"Öğretmen";"Gün"')).toBe(true)
    expect(csvText).toContain(`"${teacher}";"2025-10-06";"09:00"`)
    expect(csvText).toContain(`"${teacher} toplamı"`)

    await section.getByRole('button', { name: 'Ders saati hakediş özeti PDF' }).click()
    const preview = page.getByRole('dialog', { name: 'Ders saati hakediş dökümü · Önizleme' })
    const pdfDownload = page.waitForEvent('download')
    await preview.getByRole('button', { name: 'PDF’yi indir' }).click()
    const pdf = await pdfDownload
    expect(pdf.suggestedFilename()).toBe('ders-saati-hakedis-2025-10.pdf')
    const text = await pdfText(pdf)
    for (const expected of ['DERS SAATİ HAKEDİŞ DÖKÜMÜ', 'Ekim 2025', teacher])
      expect(text).toContain(expected)
    await page.keyboard.press('Escape')
    await expect(preview).toBeHidden()

    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)

    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`${ADMIN}?gorunum=bilgilerim`)
    const own = page.getByRole('region', { name: 'Ders saati dökümüm' })
    await own.getByLabel('Ay', { exact: true }).fill(MONTH)
    await expect(own).toContainText('Bu ay için ders saati dökümünüz yok')

    const deskPage = await loginAs(school.user('onburo'))
    await deskPage.goto(`${DESK}?gorunum=ders-saati-hakedis`)
    const tabs = deskPage.getByRole('toolbar', { name: 'Finans görünümü' })
    await expect(tabs.getByRole('button', { name: 'Ders saati hakedişi' })).toHaveCount(0)
    await expect(deskPage.getByRole('region', { name: 'Ders saati hakediş dökümü' })).toHaveCount(0)
  })
})
