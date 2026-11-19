import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Kadro planı ve açık pozisyon (ON-188; DOM-FIN-126; K-433…K-435). Hesap dalları birim ve API
// testlerindedir (`tests/finance-staffing-plans.test.ts`, `apps/api/test/finance-staffing-plans.test.ts`);
// burada yönetici kendi kurumunda matematik ihtiyacını programdan elle girilene çevirir, önerilen
// saatle pozisyon açar, ilana çıkarır ve öneri sıfırlanır.

const ADMIN = '/yonetici/finans?gorunum=kadro-plani'

test.describe('DOM-FIN-126: kadro planı', () => {
  test('DOM-FIN-126: elle ihtiyaç, önerilen saatle pozisyon ve ilana çıkarma', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen'] })
    const page = await loginAs(school.user('yonetici'))
    await page.goto(ADMIN)
    const section = page.getByRole('region', { name: 'Kadro planı' })
    const table = section.getByRole('table', { name: 'Branş kadro hesabı' })
    const math = table.getByRole('row').filter({ hasText: 'Matematik' })
    await expect(math).toContainText('programdan')

    await section.getByRole('button', { name: 'Planı düzenle' }).click()
    const form = page.getByRole('form', { name: 'Kadro planı' })
    await expect(form.getByLabel('Norm (haftalık ders saati)')).toHaveValue('20')
    await form.getByLabel('Norm (haftalık ders saati)').fill('18')
    await form.getByLabel('Matematik haftalık ihtiyaç').fill('200')
    await form.getByRole('button', { name: 'Planı kaydet' }).click()
    await expect(form).toBeHidden()
    await expect(math).not.toContainText('programdan')
    await expect(math).toContainText('200')
    await expect(section.getByLabel('Kadro özeti')).toContainText('Norm18 saat')

    await math.getByRole('button', { name: 'Matematik için pozisyon aç' }).click()
    const open = page.getByRole('form', { name: 'Pozisyon aç' })
    await expect(open.getByLabel('Branş')).toHaveValue(/.+/)
    await open.getByLabel('Not (isteğe bağlı)').fill('Lise matematik')
    await open.getByRole('button', { name: 'Pozisyonu aç' }).click()
    await expect(open).toBeHidden()
    const positions = section.getByRole('table', { name: 'Açık pozisyonlar' })
    const row = positions.getByRole('row').filter({ hasText: 'Lise matematik' })
    await expect(row).toContainText('Açık')
    await expect(math).toContainText('60')

    await row.getByRole('button', { name: 'Matematik pozisyonu: İlana çıkar' }).click()
    await expect(row).toContainText('İlanda')
    await row.getByRole('button', { name: 'Matematik pozisyonu: Dolduruldu' }).click()
    await expect(row).toContainText('Dolduruldu')
    await expect(row.getByRole('button')).toHaveCount(0)

    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)
  })
})
