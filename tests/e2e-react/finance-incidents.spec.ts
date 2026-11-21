import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Kaza ve yaralanma tutanağı (ON-162; DOM-FIN-146). Kural dalları birim ve API testlerindedir
// (`tests/finance-incidents.test.ts`, `apps/api/test/finance-incidents.test.ts`); burada ön büro dar
// ekranda ağır yaralanma tutanağı açar, bildirimsiz kesinleştiremez, veli bildirimini kaydedip
// kesinleştirir ve sağlık bilgisini artık görmez (K-493, K-494); yönetici tutanağı erişim
// gerekçesiyle açar, ek not yazar, PDF düğmesini görür ve açılışı sağlık erişim günlüğünde bulur
// (DOM-FIN-156, K-523…K-525).

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip'

test.describe('DOM-FIN-146: kaza tutanakları', () => {
  test('DOM-FIN-146, DOM-FIN-156: ağır olay bildirimle kesinleşir; sağlık bilgisi gerekçeyle yöneticide (K-493, K-494, K-523)', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'], students: ['s1'] })
    const desk = school.user('onburo')
    const page = await loginAs(desk)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${DESK}?gorunum=kaza-tutanaklari`)
    const section = page.getByRole('region', { name: 'Kaza tutanakları' })
    await expect(section.getByText('Henüz kaza tutanağı yok.')).toBeVisible()

    await section.getByRole('button', { name: 'Yeni tutanak' }).click()
    const dialog = page.getByRole('dialog', { name: 'Yeni kaza tutanağı' })
    const form = dialog.getByRole('form', { name: 'Yeni kaza tutanağı' })
    await form.getByLabel('Yaralanan öğrenci').fill('Deniz')
    await form
      .getByRole('list', { name: 'Öğrenci arama sonuçları' })
      .getByRole('button')
      .first()
      .click()
    await form.getByLabel('Olay yeri').fill('Spor salonu')
    await form.getByLabel('Olay türü').selectOption({ label: 'Spor' })
    await form.getByLabel('Olayın anlatımı').fill('Basketbol oynarken düştü, bileğini çarptı.')
    await form.getByLabel('Ayak ve bilek').check()
    await form.getByLabel('Şiddet').selectOption({ label: 'Ağır' })
    await form.getByLabel('Sevk').selectOption({ label: 'Hastane' })
    await form.getByLabel('Sorumlu personel').selectOption({ label: desk.name })
    await form.getByRole('button', { name: 'Taslak tutanağı aç' }).click()
    await expect(dialog).toBeHidden()
    await expectNoHorizontalOverflow(page)

    const panel = page.getByRole('dialog', { name: 'Kaza tutanağı' })
    await expect(panel.getByText('Ağır')).toBeVisible()
    await panel.getByRole('button', { name: 'Kesinleştir' }).click()
    await expect(
      page.getByText('Ağır yaralanmada veliye bildirim kaydedilmeden tutanak kesinleşmez.'),
    ).toBeVisible()
    const notice = panel.getByRole('form', { name: 'Veli bildirimini kaydet' })
    await notice.getByLabel('Kanal').selectOption({ label: 'Telefon' })
    await notice.getByRole('button', { name: 'Bildirimi kaydet' }).click()
    await expect(panel.getByRole('list', { name: 'Veli bildirimleri' })).toContainText('Telefon')
    await panel.getByRole('button', { name: 'Kesinleştir' }).click()
    await expect(panel.getByText('Kesinleşti')).toBeVisible()
    await expect(
      panel.getByText('Sağlık bilgisi kesinleşen tutanakta yalnız yönetimde görünür.'),
    ).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Tutanak PDF' })).toHaveCount(0)

    const admin = await loginAs(school.user('yonetici'))
    await admin.goto(`${ADMIN}?gorunum=kaza-tutanaklari`)
    const adminSection = admin.getByRole('region', { name: 'Kaza tutanakları' })
    await adminSection
      .getByRole('button', { name: /tutanağını aç/ })
      .first()
      .click()
    const reason = admin.getByRole('dialog', { name: 'Sağlık bilgisine erişim gerekçesi' })
    const reasonForm = reason.getByRole('form', { name: 'Erişim gerekçesi' })
    await reasonForm.getByRole('button', { name: 'Bilgiyi aç' }).click()
    await expect(reasonForm.getByText('Erişim gerekçesini seçin.')).toBeVisible()
    await reasonForm.getByLabel('Erişim gerekçesi').selectOption({ label: 'Veli görüşmesi' })
    await reasonForm.getByRole('button', { name: 'Bilgiyi aç' }).click()
    await expect(reason).toBeHidden()
    const adminPanel = admin.getByRole('dialog', { name: 'Kaza tutanağı' })
    await expect(adminPanel.getByText('Hastane')).toBeVisible()
    await expect(adminPanel.getByRole('button', { name: 'Tutanak PDF' })).toBeVisible()
    const addendum = adminPanel.getByRole('form', { name: 'Ek not yaz' })
    await addendum.getByLabel('Ek not').fill('Hastane kontrolünde kırık görülmedi.')
    await addendum.getByRole('button', { name: 'Ek notu kaydet' }).click()
    await expect(adminPanel.getByRole('list', { name: 'Ek notlar' })).toContainText(
      'Hastane kontrolünde kırık görülmedi.',
    )

    await admin.goto(`${ADMIN}?gorunum=saglik-erisim`)
    const log = admin.getByRole('region', { name: 'Sağlık erişim günlüğü' })
    // Dar ekranda satır kart olur; okuyan ve gerekçe kartın ilk bilgileridir.
    await expect(log.getByText('Veli görüşmesi').first()).toBeVisible()
    await expect(log.getByText('Tutanak hazırlama').first()).toBeVisible()
  })
})
