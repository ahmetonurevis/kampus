import { istanbulDay } from './support/commands.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Programdan ek ders önerisi (ON-195; DOM-FIN-165; K-550…K-552). Kural dalları birim ve API
// testlerindedir (`tests/finance-lesson-hour-suggestions.test.ts`,
// `apps/api/test/finance-lesson-hour-suggestions.test.ts`); burada yönetici geçen ayın önerisini
// görür (öğretmenin bir haftada 20 dersi → 15 maaş karşılığı, 5 ek ders), dökümü açar, öneriyi tek
// tıkla elle girişe aktarır, sonra gerekçeyle düzeltir. Geçen ay seçilir: bütün dersleri geçmiştir.
// Dersler testin kendi kurumuna doğrudan yazılır (geçmiş ders API'den planlanamaz).

const ADMIN = '/yonetici/finans'

/** Geçen ay (`YYYY-AA`) ve o ayın 8–14'ü arasındaki pazartesiden başlayan beş iş günü. */
function lastMonthWeek(): { month: string; days: string[] } {
  const [year, month] = istanbulDay().split('-').map(Number) as [number, number]
  const first = new Date(Date.UTC(year, month - 2, 8))
  const monday = new Date(first)
  monday.setUTCDate(first.getUTCDate() + ((8 - first.getUTCDay()) % 7))
  const days = Array.from({ length: 5 }, (_, index) => {
    const day = new Date(monday)
    day.setUTCDate(monday.getUTCDate() + index)
    return day.toISOString().slice(0, 10)
  })
  return { month: first.toISOString().slice(0, 7), days }
}

test.describe('DOM-FIN-165: programdan ek ders önerisi', () => {
  test('DOM-FIN-165: yönetici önerinin dökümünü görür, öneriyi aktarır ve gerekçeyle düzeltir', async ({
    api,
    loginAs,
    tenant,
  }) => {
    const { month, days } = lastMonthWeek()
    // İstanbul 09.00'dan başlayan günde dört ders (40 dk), öğretmen kaydı t1.
    const records = days.flatMap((day) =>
      [0, 1, 2, 3].map((period) => ({
        collection: 'schedule' as const,
        data: {
          id: `e2e-ders-${day}-${String(period)}`,
          classId: 'c1',
          teacherId: 't1',
          subjectId: 'mat',
          date: new Date(Date.parse(`${day}T06:00:00.000Z`) + period * 50 * 60_000).toISOString(),
          duration: 40,
          title: 'Matematik',
          room: '101',
        },
      })),
    )
    const school = await tenant({ roles: ['ogretmen'], records })
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
      rateType: 'monthly_gross',
      amountCents: 4_500_000,
      membershipId,
      startDate: '2025-01-01',
    })
    expect(wage.status).toBe(201)
    await manager.dispose()

    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=bordro-aktarim`)
    const section = page.getByRole('region', { name: 'Bordro aktarımı' })
    await section.getByLabel('Bordro ayı').fill(month)
    const panel = section.getByRole('region', { name: 'Programdan hesapla' })
    await expect(panel.getByLabel('Maaş karşılığı haftalık ders saati')).toHaveValue('15')
    const row = panel.getByRole('row', { name: new RegExp(teacher) })
    await expect(row).toContainText('20 saat')
    await expect(row).toContainText('5 saat')
    await expect(row).toContainText('Girilmedi')
    await expect(row).toContainText('−5')

    await panel.getByRole('button', { name: `${teacher} dökümünü aç` }).click()
    const detail = page.getByRole('dialog', { name: new RegExp(`${teacher} · .* dökümü`) })
    await expect(detail).toContainText('Önerilen ek ders 5 saat.')
    await expect(detail.getByRole('region', { name: 'Haftalar' })).toContainText(
      '20 saat · 15 maaş karşılığı · 5 ek ders (bu aya 5)',
    )
    await expect(detail.getByText('09:00 · Matematik · 7-A · 1 ders saati').first()).toBeVisible()
    await expect(detail.getByText(/Sayıldı · 1 ek ders/).first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(detail).toBeHidden()

    await panel.getByRole('button', { name: `${teacher} önerisini aktar` }).click()
    await expect(panel.getByRole('button', { name: `${teacher} önerisini aktar` })).toHaveCount(0)
    await expect(row).not.toContainText('Girilmedi')
    await expect(row).not.toContainText('−5')
    const lesson = section.getByRole('row', { name: /Ek ders ücreti · Ek ders/ })
    await expect(lesson).toContainText('5 saat')
    const sheet = section.getByRole('region', { name: 'Ek ders çizelgesi onayı' })
    await expect(sheet.getByRole('list', { name: 'Öğretmen teyitleri' })).toContainText(teacher)

    await panel.getByRole('button', { name: `${teacher} saatini düzeltip aktar` }).click()
    const correct = page.getByRole('dialog', { name: 'Saati düzeltip aktar' })
    await correct.getByLabel('Aktarılacak saat').fill('6')
    await correct.getByRole('button', { name: 'Aktar' }).click()
    await expect(correct.getByText('Öneriden farklı saat için gerekçe yazın.')).toBeVisible()
    await correct.getByLabel('Gerekçe').fill('Gezi günü dersi programa girilmedi')
    await correct.getByRole('button', { name: 'Aktar' }).click()
    await expect(correct).toBeHidden()
    await expect(row).toContainText('6 saat')
    await expect(row).toContainText('+1')
    await expect(lesson).toContainText('6 saat')

    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)
  })
})
