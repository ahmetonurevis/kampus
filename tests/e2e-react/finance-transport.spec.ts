import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Servis güzergâhı ve kulüpler (ON-098; DOM-FIN-142; IST-099). Kural dalları birim ve API
// testlerindedir (`tests/finance-transport.test.ts`, `tests/finance-clubs.test.ts`,
// `apps/api/test/finance-transport.test.ts`, `apps/api/test/finance-clubs.test.ts`); burada ön büro
// araç ve güzergâh açıp öğrenciyi durağa atar (telefon maskeli, kapasite dolu; K-481, K-482),
// yönetici kulüp açar, üye ekler ve yoklama alır (aynı gün yinelenmez; K-483).

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip'

test.describe('DOM-FIN-142: servis ve kulüpler', () => {
  test('DOM-FIN-142: ön büro araç ve güzergâh açar, öğrenciyi durağa atar (K-481, K-482)', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'], students: ['s1', 's2'] })
    const page = await loginAs(school.user('onburo'))
    await page.goto(`${DESK}?gorunum=servis&servis_sekme=araclar`)
    const section = page.getByRole('region', { name: 'Servis' })
    await section.getByRole('button', { name: 'Araç ekle' }).click()
    const vehicleDialog = page.getByRole('dialog', { name: 'Araç ekle' })
    const vehicleForm = vehicleDialog.getByRole('form', { name: 'Araç ekle' })
    await vehicleForm.getByLabel('Plaka').fill('34 kmp 101')
    await vehicleForm.getByLabel('Kapasite').fill('1')
    await vehicleForm.getByLabel('Sürücü adı soyadı').fill('Ali Sürücü')
    await vehicleForm.getByLabel('Sürücü telefonu').fill('0532 123 45 67')
    await vehicleForm.getByRole('button', { name: 'Aracı kaydet' }).click()
    await expect(vehicleDialog).toBeHidden()
    const vehicleRow = section.getByRole('row', { name: /34 KMP 101/ })
    await expect(vehicleRow).toContainText('0532 *** ** 67')
    await expect(section.getByText('05321234567')).toHaveCount(0)

    await section.getByRole('button', { name: 'Güzergâhlar', exact: true }).click()
    await section.getByRole('button', { name: 'Güzergâh ekle' }).click()
    const routeDialog = page.getByRole('dialog', { name: 'Güzergâh ekle' })
    const routeForm = routeDialog.getByRole('form', { name: 'Güzergâh ekle' })
    await routeForm.getByLabel('Güzergâh adı').fill('Moda hattı')
    await routeForm.getByLabel('Araç').selectOption({ label: '34 KMP 101 · 1 kişilik' })
    await routeForm.getByLabel('1. durak adı ya da semt').fill('Moda')
    await routeForm.getByLabel('Saat').first().fill('07:10')
    await routeForm.getByRole('button', { name: 'Durak ekle' }).click()
    await routeForm.getByLabel('2. durak adı ya da semt').fill('Bahariye')
    await routeForm.getByLabel('Saat').nth(1).fill('07:25')
    await routeForm.getByRole('button', { name: 'Güzergâhı kaydet' }).click()
    await expect(routeDialog).toBeHidden()

    await section.getByRole('button', { name: 'Moda hattı güzergâhını aç' }).click()
    const panel = page.getByRole('dialog', { name: 'Servis güzergâhı' })
    await expect(panel.getByText('0532 *** ** 67')).toBeVisible()
    const assign = panel.getByRole('form', { name: 'Öğrenciyi durağa ata' })
    await assign.getByLabel('Atanacak öğrenci').fill('Deniz')
    await assign.getByRole('button', { name: 'Deniz Yılmaz' }).click()
    await assign.getByLabel('Durak').selectOption({ label: 'Bahariye · 07:25' })
    await assign.getByRole('button', { name: 'Ata' }).click()
    const assigned = panel.getByRole('list', { name: 'Atanan öğrenciler' })
    await expect(assigned).toContainText('Deniz Yılmaz · Bahariye 07:25')
    await expect(panel.getByText('Araç kapasitesi dolu.')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(section.getByRole('row', { name: /Moda hattı/ })).toContainText('1/1')
  })

  test('DOM-FIN-142: yönetici kulüp açar, üye ekler ve yoklamayı bir kez alır (K-483)', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen'], students: ['s1', 's2'] })
    const page = await loginAs(school.user('yonetici'))
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${ADMIN}?gorunum=kulupler`)
    const section = page.getByRole('region', { name: 'Kulüpler' })
    await section.getByRole('button', { name: 'Kulüp ekle' }).click()
    const dialog = page.getByRole('dialog', { name: 'Kulüp ekle' })
    const form = dialog.getByRole('form', { name: 'Kulüp ekle' })
    await form.getByLabel('Kulüp adı').fill('Bilim ve Robotik')
    await form.getByLabel('Sorumlu öğretmen').selectOption({ index: 1 })
    await form.getByLabel('Kontenjan').fill('1')
    await form.getByLabel('Gün').selectOption({ label: 'Çarşamba' })
    await form.getByLabel('Başlangıç').fill('15:30')
    await form.getByLabel('Bitiş').fill('16:30')
    await form.getByRole('button', { name: 'Kulübü kaydet' }).click()
    await expect(dialog).toBeHidden()
    await expectNoHorizontalOverflow(page)

    await section.getByRole('button', { name: 'Bilim ve Robotik kulübünü aç' }).click()
    const panel = page.getByRole('dialog', { name: 'Kulüp' })
    const add = panel.getByRole('form', { name: 'Kulübe üye ekle' })
    await add.getByLabel('Eklenecek öğrenci').fill('Deniz')
    await add.getByRole('button', { name: 'Deniz Yılmaz' }).click()
    await add.getByRole('button', { name: 'Üye ekle' }).click()
    await expect(panel.getByRole('list', { name: 'Kulüp üyeleri' })).toContainText('Deniz Yılmaz')
    await expect(panel.getByText('Kontenjan dolu.')).toBeVisible()

    const attendance = panel.getByRole('form', { name: 'Kulüp yoklaması' })
    await attendance.getByLabel('Deniz Yılmaz').selectOption({ label: 'İzinli' })
    await attendance.getByRole('button', { name: 'Yoklamayı kaydet' }).click()
    const sessions = panel.getByRole('list', { name: 'Kulüp oturumları' })
    await expect(sessions).toContainText('0 geldi · 0 gelmedi · 1 izinli')
    await panel
      .getByRole('form', { name: 'Kulüp yoklaması' })
      .getByRole('button', { name: 'Yoklamayı kaydet' })
      .click()
    await expect(panel.getByText('Bu günün yoklaması zaten alınmış.')).toBeVisible()
  })
})
