import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Personel ücret tanımı (ON-194; DOM-FIN-099). Kural dalları birim ve API testlerindedir
// (`tests/finance-pay-rates.test.ts`, `apps/api/test/finance-pay-rates.test.ts`); burada yönetici
// öğretmene ana ücret ve yan hak yazar, yeni ücretle öncekinin kendiliğinden kapandığını görür
// (K-304), listede tutarı maskeli görür ve açar (K-306, K-307), son tanımı iptal edip önceki
// tanımın yeniden süresiz olduğunu görür; ön büro sekmeyi görmez.

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip'

test.describe('DOM-FIN-099: ücret tanımları', () => {
  test('DOM-FIN-099: yönetici ücret ve yan hak tanımlar, yeni tanım öncekini kapatır, iptal geri alır; ön büro sekmeyi görmez', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'onburo'] })
    const teacher = school.user('ogretmen').name
    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=ucret-tanimi`)
    const section = page.getByRole('region', { name: 'Ücret tanımları' })
    const row = section.getByRole('row', { name: new RegExp(teacher) })
    await expect(row.getByText('Tanım yok')).toBeVisible()

    await row.getByRole('button', { name: `${teacher} ücret tanımlarını aç` }).click()
    const person = page.getByRole('dialog', { name: 'Personel ücreti' })
    await expect(person.getByText('Henüz ücret tanımı yok.')).toBeVisible()

    const addRate = async (fill: (form: ReturnType<typeof page.getByRole>) => Promise<void>) => {
      await person.getByRole('button', { name: 'Yeni tanım' }).click()
      const dialog = page.getByRole('dialog', { name: 'Yeni ücret tanımı' })
      const form = dialog.getByRole('form', { name: 'Ücret tanımı' })
      await fill(form)
      await form.getByRole('button', { name: 'Kaydet' }).click()
      await expect(dialog).toBeHidden()
    }

    await person.getByRole('button', { name: 'Yeni tanım' }).click()
    const first = page.getByRole('form', { name: 'Ücret tanımı' })
    await first.getByLabel('Tutar (₺)').fill('0')
    await first.getByRole('button', { name: 'Kaydet' }).click()
    await expect(
      first.getByText('Tutarı 1.234,56 biçiminde, sıfırdan büyük girin (en fazla 10.000.000 ₺).'),
    ).toBeVisible()
    await first.getByLabel('Tutar (₺)').fill('45.000,00')
    await first.getByLabel('Yürürlük başlangıcı').fill('2025-01-01')
    await first.getByRole('button', { name: 'Kaydet' }).click()
    await expect(page.getByRole('dialog', { name: 'Yeni ücret tanımı' })).toBeHidden()

    await addRate(async (form) => {
      await form.getByLabel('Tutar (₺)').fill('50.000,00')
      await form.getByLabel('Yürürlük başlangıcı').fill('2025-09-01')
    })
    await addRate(async (form) => {
      await form.getByLabel('Tanım', { exact: true }).selectOption({ label: 'Yan hak' })
      await form.getByLabel('Tür', { exact: true }).selectOption({ label: 'Yemek' })
      await form.getByLabel('Nakdi ya da ayni').selectOption({ label: 'Ayni' })
      await form.getByLabel('Vergi').selectOption({ label: 'Vergiden istisna' })
      await form.getByLabel('Tutar (₺)').fill('3.000,00')
      await form.getByLabel('Yürürlük başlangıcı').fill('2025-09-01')
    })

    const current = person.getByRole('list', { name: 'Geçerli ücret' })
    await expect(current.getByRole('listitem')).toHaveText([
      'Ana ücret · Aylık brüt: 50.000,00 ₺ (aylık)',
      'Yan hak · Yemek: 3.000,00 ₺ (aylık) · Ayni, vergiden istisna',
    ])
    const history = person.getByRole('list', { name: 'Ücret geçmişi' })
    const closed = history.getByRole('listitem', {
      name: 'Ana ücret · Aylık brüt, 1 Oca 2025 – 31 Ağu 2025',
    })
    await expect(closed.getByText('sonraki tanımla kapandı', { exact: false })).toBeVisible()
    await expect(closed.getByRole('button', { name: 'İptal et' })).toHaveCount(0)

    await person.getByLabel('Geçerli ücret günü').fill('2025-03-15')
    await expect(current.getByRole('listitem')).toHaveText([
      'Ana ücret · Aylık brüt: 45.000,00 ₺ (aylık)',
    ])
    await person.getByLabel('Geçerli ücret günü').fill('')

    const latest = history.getByRole('listitem', {
      name: 'Ana ücret · Aylık brüt, 1 Eyl 2025 itibarıyla, süresiz',
    })
    await latest.getByRole('button', { name: 'İptal et' }).click()
    const cancel = page.getByRole('dialog', { name: 'Ücret tanımını iptal et' })
    await cancel.getByRole('textbox', { name: 'Gerekçe' }).fill('Zam oranı yanlış girildi')
    await cancel.getByRole('button', { name: 'İptal et' }).click()
    await expect(cancel).toBeHidden()
    await expect(
      history.getByRole('listitem', {
        name: 'Ana ücret · Aylık brüt, 1 Oca 2025 itibarıyla, süresiz',
      }),
    ).toBeVisible()
    await expect(current.getByRole('listitem').first()).toHaveText(
      'Ana ücret · Aylık brüt: 45.000,00 ₺ (aylık)',
    )
    await page.keyboard.press('Escape')
    await expect(person).toBeHidden()

    await expect(row).toContainText('Aylık brüt · ••••')
    await expect(row).toContainText('0 ek ders · 1 yan hak')
    await section.getByRole('button', { name: 'Tutarları göster' }).click()
    await expect(row).toContainText('Aylık brüt · 45.000,00 ₺ (aylık)')
    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)

    const desk = await loginAs(school.user('onburo'))
    await desk.goto(`${DESK}?gorunum=ucret-tanimi`)
    const tabs = desk.getByRole('toolbar', { name: 'Finans görünümü' })
    await expect(tabs.getByRole('button', { name: 'Taksitler' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(tabs.getByRole('button', { name: 'Ücret tanımları' })).toHaveCount(0)
    await expect(desk.getByRole('region', { name: 'Ücret tanımları' })).toHaveCount(0)
  })
})
