import { pdfText } from './support/finance-pdf-text.ts'
import { expect, test } from './support/fixtures.ts'

// Yetişkin kursiyerin "Sözleşmelerim" bölümü (IST-082; docs/domain/finans.md DOM-FIN-059). Test
// kendi dil okulunu kurar: s1 (Deniz Yılmaz) 18 yaşını doldurmuş kursiyerdir. Seed sözleşmesi
// `contract-s1` imzasız, sekiz taksitlidir (24.500 TL, üçü ödenmiş). Yaş ve kapsam dalları API ve
// birim testlerindedir. PDF metni dil okulunun "kursiyer" terimini taşır (ON-320, DOM-KAY-012).

test.describe('IST-082 yetişkin kursiyer: Sözleşmelerim', () => {
  test('DOM-FIN-059, DOM-KAY-012: yetişkin kursiyer sözleşmesini görür, PDF kursiyer terimiyle açılır', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const academy = await tenant({
      type: 'language_school',
      roles: ['ogrenci'],
      birthDates: { s1: '1996-05-14' },
    })
    await loginAs(academy.user('ogrenci'))
    await page.goto('/ogrenci/odemelerim')
    const section = page.getByRole('region', { name: 'Sözleşmelerim' })
    const card = section.getByRole('listitem')
    await expect(card).toHaveCount(1)
    await expect(card).toContainText('Sürüm 1')
    await expect(card).toContainText('Kurum imzası bekleniyor')
    await expect(card).toContainText('8 taksit · 196.000,00 ₺ · 3 ödendi')
    await expect(card.getByText('Sıradaki vade')).toBeVisible()
    // Salt okunur: onay düğmesi yoktur.
    await expect(section.getByRole('button', { name: /onayla/i })).toHaveCount(0)

    await card.getByRole('button', { name: /Sürüm 1 sözleşmeyi görüntüle/ }).click()
    const preview = page.getByRole('dialog', { name: 'Eğitim sözleşmesi · Önizleme' })
    await expect(preview.getByRole('img', { name: /sayfa 1/ })).toBeVisible()
    await expect(preview.getByText('sozlesme-contract-s1.pdf')).toBeVisible()

    // ON-320: sözleşme şablonu kurum türünü alır; dil okulunda taraf kursiyerdir, okul metni yoktur.
    const downloading = page.waitForEvent('download')
    await preview.getByRole('button', { name: 'PDF’yi indir' }).click()
    const text = await pdfText(await downloading)
    expect(text).toContain('Taraflar ve kursiyer bilgileri')
    expect(text).toContain('Kursiyer numarası / Sınıf')
    expect(text).not.toContain('Okul numarası / Sınıf')
    expect(text).not.toContain('öğrenci bilgileri')
  })
})
