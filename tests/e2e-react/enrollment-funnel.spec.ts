import { expect, test } from './support/fixtures.ts'

// ON-052, DOM-KAY-040: Kayıt Raporları sayfasında dönem hunisi ve danışman kırılımı
// (`GET /api/v1/prospects/funnel`). Kanal tablosu ve aşama hunisi okuma-sayfalari.spec.ts'tedir.
const REPORTS_URL = '/yonetici/kayit-raporlari'

test.describe('yönetici: dönem hunisi', () => {
  test('okulda huni aday, görüşme ve kesin kayıt adımlarıdır; danışman tablosu gelir', async ({
    page,
    loginAs,
  }) => {
    await loginAs('yonetici')
    await page.goto(REPORTS_URL)
    const section = page.getByRole('region', { name: 'Dönem hunisi' })
    await expect(section.getByText(/Açılan aday: \d+ · kesin kayda dönüşüm/)).toBeVisible()
    const steps = section.getByRole('list', { name: 'Dönem hunisi adımları' }).getByRole('listitem')
    await expect(steps).toHaveCount(3)
    await expect(steps.first()).toContainText('Aday')
    await expect(steps.last()).toContainText('Kesin kayıt')
    await expect(
      section.getByRole('table', { name: 'Danışman bazlı dönüşüm' }).getByRole('row'),
    ).not.toHaveCount(0)
  })

  test('bitiş başlangıçtan önceyse alan uyarır; geleceğe aralıkta aday yoktur', async ({
    page,
    loginAs,
  }) => {
    await loginAs('yonetici')
    await page.goto(REPORTS_URL)
    const section = page.getByRole('region', { name: 'Dönem hunisi' })
    await section.getByLabel('Başlangıç').fill('2030-02-01')
    await section.getByLabel('Bitiş').fill('2030-01-01')
    await expect(section.getByRole('alert')).toHaveText(
      'Bitiş günü başlangıç gününden önce olamaz.',
    )
    await section.getByLabel('Bitiş').fill('2030-03-01')
    await expect(section.getByText('Bu aralıkta açılmış aday yok.')).toBeVisible()
  })
})
