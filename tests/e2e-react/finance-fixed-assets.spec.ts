import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Demirbaş ekranı (ON-235; DOM-FIN-085). Kural dalları birim ve API testlerindedir
// (`tests/finance-fixed-assets.test.ts`, `apps/api/test/finance-fixed-assets.test.ts`); burada
// yönetici etiketi boş bırakıp demirbaş kaydeder (DB-<yıl>-<sıra>, K-185), durumunu değiştirir ve
// gerekçeyle hurdaya ayırır (K-188); ön büro sekmeyi görmez (K-189).

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip'

test.describe('DOM-FIN-085: demirbaş ekranı', () => {
  test('DOM-FIN-085: yönetici demirbaş kaydeder, arızalı işaretler ve hurdaya ayırır; ön büro sekmeyi görmez', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'] })
    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=demirbas`)
    const assets = page.getByRole('region', { name: 'Demirbaşlar' })
    await expect(assets.getByText('Henüz demirbaş yok.')).toBeVisible()

    await assets.getByRole('button', { name: 'Yeni demirbaş' }).click()
    const form = page.getByRole('dialog', { name: 'Yeni demirbaş' })
    await form.getByLabel('Ad', { exact: true }).fill('Akıllı tahta')
    await form.getByLabel('Kategori').selectOption({ label: 'Görsel-işitsel cihaz' })
    await form.getByLabel('Kampüs (isteğe bağlı)').selectOption({ label: 'Kadıköy Kampüsü' })
    await form.getByLabel('Konum').fill('2. kat 5-A sınıfı')
    await form.getByLabel('Alım değeri (₺, KDV hariç)').fill('0')
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(
      form.getByText('Alım değerini 1.234,56 biçiminde, sıfırdan büyük girin.'),
    ).toBeVisible()
    await form.getByLabel('Alım değeri (₺, KDV hariç)').fill('45.000,00')
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(form).toBeHidden()

    const panel = page.getByRole('dialog', { name: 'Demirbaş' })
    await expect(
      panel.getByRole('heading', { name: /^DB-\d{4}-0001 · Akıllı tahta$/ }),
    ).toBeVisible()
    await expect(panel.getByText('45.000,00 ₺')).toBeVisible()
    await expect(panel.getByText('Kadıköy Kampüsü')).toBeVisible()
    await panel.getByRole('button', { name: 'Düzenle' }).click()
    const edit = page.getByRole('dialog', { name: 'Demirbaşı düzenle' })
    await edit.getByLabel('Durum').selectOption({ label: 'Arızalı' })
    await edit.getByRole('button', { name: 'Kaydet' }).click()
    await expect(edit).toBeHidden()
    await expect(panel.getByText('Arızalı', { exact: true })).toBeVisible()

    const scrap = panel.getByRole('form', { name: 'Hurdaya ayırma' })
    await scrap.getByLabel('Gerekçe').fill('Ekran kırık, onarılamaz')
    await scrap.getByRole('button', { name: 'Hurdaya ayır' }).click()
    await expect(panel.getByText('Hurdaya ayrıldı', { exact: true })).toBeVisible()
    await expect(panel.getByText('Ekran kırık, onarılamaz')).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Düzenle' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(
      assets.getByRole('row', { name: /DB-\d{4}-0001/ }).getByText('Hurdaya ayrıldı'),
    ).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)

    const desk = await loginAs(school.user('onburo'))
    await desk.goto(`${DESK}?gorunum=demirbas`)
    const tabs = desk.getByRole('toolbar', { name: 'Finans görünümü' })
    await expect(tabs.getByRole('button', { name: 'Taksitler' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(tabs.getByRole('button', { name: 'Demirbaşlar' })).toHaveCount(0)
    await expect(desk.getByRole('region', { name: 'Demirbaşlar' })).toHaveCount(0)
  })
})
