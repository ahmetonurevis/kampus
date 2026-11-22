import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Öğretmen geri bildirimi (ON-213; DOM-FIN-159, K-532…K-534). Kural dalları birim ve API
// testlerindedir (`tests/finance-teacher-feedback.test.ts`,
// `apps/api/test/finance-teacher-feedback.test.ts`); burada yönetici dönemlik anketi açar,
// eşiği 5'in altına seçemez, yayımlar ve erken kapatır; yanıt yokken sonuç boştur. Öğrenci ve
// velinin yanıt ekranı ile öğretmenin kendi ekranı rol kabuğundadır.

const ADMIN_URL = '/yonetici/finans?gorunum=ogretmen-geri-bildirimi'
const TITLE = 'Güz öğretmen geri bildirimi'
const TERM = '2026–2027 1. dönem'

test.describe('ON-213: öğretmene yönelik öğrenci ve veli geri bildirimi', () => {
  test('DOM-FIN-159: yönetici anketi açar, yayımlar ve kapatır; yanıtsız sonuç boş', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: [] })
    const page = await loginAs(school.user('yonetici'))
    await page.goto(ADMIN_URL)
    const section = page.getByRole('region', { name: 'Öğretmen geri bildirimi' })
    await expect(section.getByText('Henüz öğretmen geri bildirim anketi yok.')).toBeVisible()
    await section.getByRole('button', { name: 'Yeni geri bildirim anketi' }).click()

    const createDialog = page.getByRole('dialog', { name: 'Yeni öğretmen geri bildirim anketi' })
    await createDialog.getByLabel('Anket başlığı').fill(TITLE)
    await createDialog.getByLabel('Dönem').fill(TERM)
    const threshold = createDialog.getByLabel('Anonimlik eşiği')
    await expect(threshold).toHaveValue('5')
    await expect(threshold.locator('option', { hasText: 'en az 4 yanıt' })).toHaveCount(0)
    await threshold.selectOption('6')
    await createDialog.getByRole('button', { name: 'Taslağı kaydet' }).click()
    await expect(createDialog).toBeHidden()

    const panel = page.getByRole('dialog', { name: 'Öğretmen geri bildirim anketi' })
    await expect(panel.getByText('Öğrenci, Veli · bütün sınıflar')).toBeVisible()
    await expect(panel.getByText('Öğretmen başına en az 6 yanıt')).toBeVisible()
    await panel.getByRole('button', { name: 'Anketi yayımla' }).click()
    await expect(panel.getByText('0 değerlendirme · 0 kişi')).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Taslağı düzenle' })).toHaveCount(0)
    await expect(panel.getByText('Henüz değerlendirme yok.')).toBeVisible()
    await panel.getByRole('button', { name: 'Anketi şimdi kapat' }).click()
    await expect(panel.getByRole('button', { name: 'Anketi şimdi kapat' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()

    const row = section.getByRole('row', { name: new RegExp(TITLE) })
    await expect(row).toContainText('Kapandı')
    await expect(row).toContainText(TERM)
    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)
  })
})
