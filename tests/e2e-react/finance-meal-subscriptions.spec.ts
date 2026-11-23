import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Yemek aboneliği ve gün iptali (ON-150; DOM-FIN-164; IST-099). Kural dalları birim ve API
// testlerindedir (`tests/finance-meal-subscriptions.test.ts`,
// `apps/api/test/finance-meal-subscriptions.test.ts`); burada yönetici vejetaryen öğle yemeği
// aboneliği açar, ilk yemek gününü iptal eder ve günlük mutfak sayısında ikinci yemek gününü görür
// (K-547…K-549).

const ADMIN = '/yonetici/finans'

/** Bugün (Europe/Istanbul): abonelik yarın başlar, günler buna göre seçilir. */
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format()

/** Bugünden sonraki ilk iki hafta içi gün (YYYY-MM-DD). */
function nextWeekdays(from: string, count: number): string[] {
  const days: string[] = []
  const date = new Date(`${from}T12:00:00.000Z`)
  while (days.length < count) {
    date.setUTCDate(date.getUTCDate() + 1)
    const weekday = date.getUTCDay()
    if (weekday !== 0 && weekday !== 6) days.push(date.toISOString().slice(0, 10))
  }
  return days
}

test.describe('DOM-FIN-164: yemek aboneliği', () => {
  test('DOM-FIN-164: yönetici abonelik açar, gün iptal eder ve günlük sayımı görür (K-547, K-548, K-549)', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: [], students: ['s1'] })
    const [first, second] = nextWeekdays(today(), 2)
    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=yemek-aboneligi`)
    const section = page.getByRole('region', { name: 'Yemek aboneliği', exact: true })
    await section.getByRole('button', { name: 'Abonelik ekle' }).click()
    const dialog = page.getByRole('dialog', { name: 'Abonelik ekle' })
    await dialog.getByLabel('Öğrenci').fill('Deniz')
    await dialog.getByRole('button', { name: 'Deniz Yılmaz' }).click()
    await dialog.getByLabel('Diyet türü').selectOption({ label: 'Vejetaryen' })
    // Varsayılan: yarından okul yılı sonuna, hafta içi.
    await dialog.getByRole('button', { name: 'Aboneliği kaydet' }).click()
    await expect(dialog).toBeHidden()

    await expect(section.getByRole('row', { name: /Deniz Yılmaz/ })).toContainText('Vejetaryen')
    await section.getByRole('button', { name: 'Deniz Yılmaz aboneliğini aç' }).click()
    const panel = page.getByRole('dialog', { name: 'Yemek aboneliği' })
    const days = panel.getByRole('list', { name: 'Yemek günleri' })
    await days.getByRole('checkbox').first().click()
    await panel.getByRole('button', { name: 'Seçili günleri iptal et' }).click()
    await expect(panel.getByRole('list', { name: 'İptal edilen günler' })).toContainText('Okul')
    await expect(days.getByRole('button', { name: /iptalini geri al$/ })).toBeVisible()
    await page.keyboard.press('Escape')

    await page
      .getByRole('toolbar', { name: 'Yemek aboneliği görünümü' })
      .getByRole('button', { name: 'Günlük sayım' })
      .click()
    const sheet = page.getByRole('region', { name: 'Günlük yemek sayısı' })
    await sheet.getByLabel('Gün').fill(first ?? '')
    const lunch = sheet.getByRole('row', { name: /^Öğle yemeği/ }).first()
    // Kesim geçtiyse okulun iptali geç iptaldir; ikisinde de yemek düşülür.
    await expect(lunch).toContainText(/1 (geç )?iptal/)
    await sheet.getByLabel('Gün').fill(second ?? '')
    await expect(sheet.getByRole('row', { name: /^Öğle yemeği/ }).first()).toContainText('—')
    await expect(
      sheet
        .getByRole('row', { name: /^Öğle yemeği/ })
        .first()
        .getByRole('cell')
        .nth(0),
    ).toHaveText('1')
    await expect(sheet.getByRole('button', { name: 'Yazdır' })).toBeEnabled()
    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)
  })
})
