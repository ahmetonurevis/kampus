import { pdfText } from './support/finance-pdf-text.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// İş teklifi ve işe başlama listesi (ON-179; DOM-FIN-121). Kural dalları birim ve API testlerindedir
// (`tests/finance-staff-onboarding.test.ts`, `apps/api/test/finance-staff-onboarding.test.ts`);
// burada yönetici teklif hazırlar, mektubu PDF olarak indirir (e-posta yok, K-412), gönderir ve
// kabulü kaydeder; işe başlama listesi açılır, kaynağı olmayan adım işaretlenemez, davetle açılmış
// ön büro hesabı bağlanır (IST-007) ve oryantasyon adımı işaretlenir (K-413); ön büro sekmeyi görmez.

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip'

test.describe('DOM-FIN-121: işe başlama', () => {
  test('DOM-FIN-121: teklif, mektup, kabul, hesap bağlama ve adım işareti; ön büro sekmeyi görmez', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'] })
    const desk = school.user('onburo').name
    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=ise-baslama`)
    const section = page.getByRole('region', { name: 'İşe başlama' })
    await expect(section.getByText('Henüz iş teklifi yok.')).toBeVisible()

    await section.getByRole('button', { name: 'Yeni teklif' }).click()
    const form = page.getByRole('form', { name: 'İş teklifi' })
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(form.getByText('Adayın adını yazın.')).toBeVisible()
    await form.getByLabel('Adayın adı').fill('Ece Aday')
    await form.getByLabel('Pozisyon').fill('Ön büro görevlisi')
    await form.getByLabel('Rol').selectOption({ label: 'Ön büro' })
    await form.getByLabel('Ücret önerisi (₺)').fill('35.000,00')
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(page.getByRole('dialog', { name: 'Yeni iş teklifi' })).toBeHidden()

    const panel = page.getByRole('dialog', { name: 'İş teklifi' })
    await expect(panel.getByRole('heading', { name: /Ece Aday/ })).toContainText('Taslak')
    await panel.getByRole('button', { name: 'Ece Aday teklif mektubu PDF' }).click()
    const pdf = page.getByRole('dialog', { name: 'İş teklif mektubu · Önizleme' })
    const downloading = page.waitForEvent('download')
    await pdf.getByRole('button', { name: 'PDF’yi indir' }).click()
    const text = await pdfText(await downloading)
    for (const expected of [
      'İŞ TEKLİF MEKTUBU',
      'TASLAK',
      'Ece Aday',
      'Ön büro görevlisi',
      '35.000,00',
    ])
      expect(text).toContain(expected)
    await page.keyboard.press('Escape')
    await expect(pdf).toBeHidden()

    await panel.getByRole('button', { name: 'Gönderildi' }).click()
    await page
      .getByRole('form', { name: 'Gönderildi olarak işaretle' })
      .getByRole('button', { name: 'Kaydet' })
      .click()
    await expect(panel.getByRole('heading', { name: /Ece Aday/ })).toContainText('Gönderildi')
    await panel.getByRole('button', { name: 'Kabul edildi' }).click()
    await page
      .getByRole('form', { name: 'Kabulü kaydet' })
      .getByRole('button', { name: 'Kaydet' })
      .click()
    await expect(panel.getByRole('heading', { name: /Ece Aday/ })).toContainText('Kabul edildi')

    const steps = panel.getByRole('list', { name: 'İşe başlama adımları' })
    const pay = steps.getByRole('listitem', { name: 'Ücret tanımı girildi' })
    await expect(pay.getByText('Önce personel hesabını bağlayın.')).toBeVisible()
    await expect(
      pay.getByRole('button', { name: 'Ücret tanımı girildi: tamamlandı' }),
    ).toBeDisabled()

    const account = panel.getByRole('form', { name: 'Personel hesabı' })
    await account.getByLabel('Personel hesabı (Ön büro)').selectOption({ label: desk })
    await account.getByRole('button', { name: 'Hesabı bağla' }).click()
    await expect(account).toContainText(`Bağlı hesap: ${desk}`)
    const accountStep = steps.getByRole('listitem', { name: 'Personel hesabı açıldı ve bağlandı' })
    await expect(accountStep.getByText('Tamamlandı', { exact: true })).toBeVisible()
    await expect(pay.getByRole('button', { name: 'Teklifteki ücreti aktar' })).toBeVisible()

    const orientation = steps.getByRole('listitem', { name: 'İş sağlığı ve güvenliği eğitimi' })
    await orientation
      .getByRole('button', { name: 'İş sağlığı ve güvenliği eğitimi: tamamlandı' })
      .click()
    await page
      .getByRole('form', { name: 'Adımı tamamla' })
      .getByRole('button', { name: 'Tamamlandı' })
      .click()
    await expect(page.getByRole('dialog', { name: 'Adımı tamamla' })).toBeHidden()
    await expect(orientation.getByText('Tamamlandı', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()

    // Hesap bağlanınca listede personel kaydındaki ad görünür.
    const row = section.getByRole('row', { name: new RegExp(desk) })
    await expect(row).toContainText('Kabul edildi')
    await expect(row).toContainText('2/10 zorunlu adım')
    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)

    const deskPage = await loginAs(school.user('onburo'))
    await deskPage.goto(`${DESK}?gorunum=ise-baslama`)
    const tabs = deskPage.getByRole('toolbar', { name: 'Finans görünümü' })
    await expect(tabs.getByRole('button', { name: 'Taksitler' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(tabs.getByRole('button', { name: 'İşe başlama' })).toHaveCount(0)
    await expect(deskPage.getByRole('region', { name: 'İşe başlama' })).toHaveCount(0)
  })
})
