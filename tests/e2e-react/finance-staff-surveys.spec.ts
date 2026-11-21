import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Personel memnuniyet anketi (ON-191; DOM-FIN-143, K-484…K-486). Kural dalları birim ve API
// testlerindedir (`tests/finance-staff-surveys.test.ts`, `apps/api/test/finance-staff-surveys.test.ts`);
// burada yönetici anketi açıp yayımlar, ön büro kendi ekranından bir kez yanıtlar, yönetici
// katılım oranını görür; anket kapanmadığı için sonuç gizli kalır ve cevap görünmez.

const ADMIN_URL = '/yonetici/finans?gorunum=personel-anketleri'
const DESK_URL = '/onburo/tahsilat-takip?gorunum=personel-anketleri'
const TITLE = 'Güz memnuniyet anketi'
const ANSWER = 'Öğle arası nöbet çizelgesi erken paylaşılsın'

test.describe('ON-191: anonim personel memnuniyet anketi', () => {
  test('DOM-FIN-143: yönetici anketi yayımlar, ön büro bir kez yanıtlar, sonuç kapanana kadar gizli', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'onburo'] })

    const page = await loginAs(school.user('yonetici'))
    await page.goto(ADMIN_URL)
    const managed = page.getByRole('region', { name: 'Personel anketleri' })
    await expect(managed.getByText('Henüz personel anketi yok.')).toBeVisible()
    await managed.getByRole('button', { name: 'Yeni anket' }).click()
    const createDialog = page.getByRole('dialog', { name: 'Yeni personel anketi' })
    await createDialog.getByLabel('Anket başlığı').fill(TITLE)
    await createDialog.getByLabel('1. soru', { exact: true }).fill('İş yükümü dengeli buluyorum')
    await createDialog.getByRole('button', { name: 'Taslağı kaydet' }).click()
    await expect(createDialog).toBeHidden()

    const panel = page.getByRole('dialog', { name: 'Personel anketi' })
    await expect(panel.getByText('Bütün personel · 3 kişi')).toBeVisible()
    await panel.getByRole('button', { name: 'Anketi yayımla' }).click()
    await expect(panel.getByText('Katılım 0 / 3 (%0)')).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Yeni sürüm aç' })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Taslağı düzenle' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()

    // Ön büro kendi ekranından yanıtlar (K-485).
    await loginAs(school.user('onburo'))
    await page.goto(DESK_URL)
    const mine = page.getByRole('region', { name: 'Yanıtlayacağım anketler' })
    await mine.getByRole('button', { name: `${TITLE} anketini yanıtla` }).click()
    const answer = page.getByRole('form', { name: `${TITLE} yanıtı` })
    await answer.getByRole('button', { name: 'Yanıtı gönder' }).click()
    await expect(answer.getByText('Bu soru zorunlu.').first()).toBeVisible()
    await answer.getByLabel('İş yükümü dengeli buluyorum').selectOption('4')
    await answer.getByLabel(/tavsiye eder misiniz/).selectOption('9')
    await answer.getByLabel(/Eklemek istedikleriniz/).fill(ANSWER)
    await answer.getByRole('button', { name: 'Yanıtı gönder' }).click()
    await expect(answer).toBeHidden()
    await expect(mine.getByText('Yanıtlandı')).toBeVisible()
    await expect(mine.getByRole('button', { name: `${TITLE} anketini yanıtla` })).toHaveCount(0)
    // Ön büro anket yönetimini görmez.
    await expect(page.getByRole('region', { name: 'Personel anketleri' })).toHaveCount(0)

    // Yönetici yalnız katılım oranını görür; sonuç kapanana kadar gizlidir (K-486).
    await loginAs(school.user('yonetici'))
    await page.goto(ADMIN_URL)
    const row = managed.getByRole('row', { name: new RegExp(TITLE) })
    await expect(row).toContainText('Katılım 1 / 3 (%33,3)')
    await row.getByRole('button', { name: `${TITLE} anketini aç` }).click()
    await expect(
      panel.getByText('Sonuçlar anket kapanınca gösterilir (şu an 1 yanıt).'),
    ).toBeVisible()
    await expect(panel.getByText(ANSWER)).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)
  })
})
