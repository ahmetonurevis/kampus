import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Yemek menüsü, besin değeri ve alerjen matrisi (ON-090, ON-149; DOM-FIN-157; IST-099). Kural
// dalları birim ve API testlerindedir (`tests/finance-meal-menus.test.ts`,
// `apps/api/test/finance-meal-menus.test.ts`); burada yönetici gelecek haftaya menü açar, pazartesi
// öğle yemeğine alerjenli ve besin değerli yemek yazar, günlük toplamı ve alerjen matrisini görür ve
// menüyü yayımlar (K-526…K-528).

const ADMIN = '/yonetici/finans'

test.describe('DOM-FIN-157: yemek menüsü', () => {
  test('DOM-FIN-157: yönetici haftalık menü açar, alerjen ve besin değeri yazar, yayımlar (K-526, K-528)', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: [], students: ['s1'] })
    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=yemek-menusu`)
    const list = page.getByRole('region', { name: 'Yemek menüsü', exact: true })
    await list.getByRole('button', { name: 'Menü aç' }).click()
    const dialog = page.getByRole('dialog', { name: 'Menü aç' })
    // Varsayılan hafta gelecek haftadır.
    await dialog.getByRole('button', { name: 'Menüyü aç' }).click()
    await expect(dialog).toBeHidden()

    const menu = page.getByRole('region', { name: /^Yemek menüsü: / })
    await expect(menu.getByText('Taslak', { exact: true })).toBeVisible()
    await menu.getByRole('button', { name: /^Pazartesi .+ Öğle yemeği düzenle$/ }).click()
    const slot = page.getByRole('dialog', { name: 'Öğün menüsü' })
    await slot.getByRole('button', { name: 'Yemek ekle' }).click()
    const first = slot.getByRole('group', { name: '1. yemek', exact: true })
    await first.getByLabel('1. yemek adı').fill('Mercimek çorbası')
    await first
      .getByRole('group', { name: '1. yemek alerjenleri' })
      .getByRole('checkbox', { name: 'Kereviz' })
      .click()
    await first.getByLabel('Enerji (kcal)').fill('180')
    await first.getByLabel('Protein (g)').fill('8,5')
    await first.getByLabel('Yağ (g)').fill('4,2')
    await first.getByLabel('Karbonhidrat (g)').fill('26')
    await slot.getByRole('button', { name: 'Yemek ekle' }).click()
    const second = slot.getByRole('group', { name: '2. yemek', exact: true })
    await second.getByLabel('2. yemek adı').fill('Yoğurt')
    await second
      .getByRole('group', { name: '2. yemek alerjenleri' })
      .getByRole('checkbox', { name: 'Süt' })
      .click()
    await slot.getByRole('button', { name: 'Öğünü kaydet' }).click()
    await expect(slot).toBeHidden()

    const monday = menu.getByRole('list', { name: /^Pazartesi .+ Öğle yemeği$/ })
    await expect(monday).toContainText('Mercimek çorbası')
    await expect(monday).toContainText('Kereviz')
    await expect(monday).toContainText('Yoğurt')
    await expect(menu.getByLabel(/^Pazartesi .+ günlük toplam$/)).toContainText(
      '180 kcal · protein 8,5 g',
    )

    await menu.getByRole('button', { name: 'Alerjen matrisi' }).click()
    const matrix = menu.getByRole('table', { name: /Alerjen matrisi/ })
    await expect(matrix.getByRole('row', { name: /Mercimek çorbası/ })).toContainText('İçerir')
    await expect(menu.getByRole('list', { name: 'Günün alerjenleri' })).toContainText(
      'Süt, Kereviz',
    )

    await menu.getByRole('button', { name: 'Yayımla' }).click()
    await expect(menu.getByText('Yayımlandı', { exact: true })).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)
  })
})
