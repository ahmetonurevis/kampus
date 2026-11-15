import { pdfText } from './support/finance-pdf-text.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Kıdem ve ihbar hesaplayıcı (ON-205; DOM-FIN-094). Kural dalları birim ve API testlerindedir
// (`tests/finance-severance.test.ts`, `apps/api/test/finance-severance.test.ts`); burada yönetici
// formu doldurur, dökümü görür ve PDF'i indirir; ön büro sekmeyi görmez (K-272).

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip'

test.describe('DOM-FIN-094: kıdem ve ihbar hesaplayıcı', () => {
  test('DOM-FIN-094: yönetici hesaplar, dökümü görür ve PDF indirir; ön büro sekmeyi görmez', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'] })
    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=kidem-ihbar`)
    const section = page.getByRole('region', { name: 'Kıdem/ihbar hesaplayıcı' })
    await expect(
      section.getByText('Tahmini hesaptır; bordro ya da mali müşavir hesabı yerine geçmez.'),
    ).toBeVisible()
    const form = section.getByRole('form', { name: 'Kıdem ve ihbar hesabı' })
    await form.getByRole('button', { name: 'Hesapla' }).click()
    await expect(form.getByText('Çıkış nedenini seçin.')).toBeVisible()

    await form.getByLabel('İşe giriş günü').fill('2020-03-15')
    await form.getByLabel('Çıkış günü').fill('2025-09-30')
    await form.getByLabel('Son aylık brüt ücret (₺)').fill('50.000,00')
    await form.getByLabel('Düzenli yan ödemeler (₺/ay, isteğe bağlı)').fill('5.000,00')
    await form
      .getByLabel('Çıkış nedeni')
      .selectOption({ label: 'İşveren feshi (ahlak ve iyi niyete aykırılık dışında)' })
    await form.getByRole('button', { name: 'Hesapla' }).click()

    const result = section.getByRole('region', { name: 'Tahmini sonuç' })
    const table = result.getByRole('table', { name: 'Kıdem ve ihbar dökümü' })
    await expect(table.getByRole('row', { name: /Brüt tutar/ })).toContainText('299.143,43 ₺')
    await expect(table.getByRole('row', { name: /Net tutar/ })).toContainText('383.360,36 ₺')
    await expect(result.getByText('5 yıl 6 ay 16 gün')).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await result.getByRole('button', { name: 'Kıdem ve ihbar tahmini PDF' }).click()
    const preview = page.getByRole('dialog', {
      name: 'Kıdem ve ihbar tazminatı tahmini · Önizleme',
    })
    const downloading = page.waitForEvent('download')
    await preview.getByRole('button', { name: 'PDF’yi indir' }).click()
    const file = await downloading
    expect(file.suggestedFilename()).toBe('kidem-ihbar-tahmini-2025-09-30.pdf')
    const text = await pdfText(file)
    for (const expected of ['KIDEM VE İHBAR TAHMİNİ', '299.143,43', 'bordro ya da mali müşavir'])
      expect(text).toContain(expected)
    await page.keyboard.press('Escape')
    await expect(preview).toBeHidden()

    const desk = await loginAs(school.user('onburo'))
    await desk.goto(`${DESK}?gorunum=kidem-ihbar`)
    await expect(desk.getByRole('table', { name: 'Taksit ve tahsilat listesi' })).toBeVisible()
    await expect(desk.getByRole('button', { name: 'Kıdem/ihbar hesaplayıcı' })).toHaveCount(0)
    await expect(desk.getByRole('region', { name: 'Kıdem/ihbar hesaplayıcı' })).toHaveCount(0)
  })
})
