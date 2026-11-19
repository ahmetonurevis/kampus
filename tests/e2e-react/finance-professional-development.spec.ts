import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Mesleki gelişim kataloğu (ON-214; DOM-FIN-125, K-430…K-432). Kural dalları birim ve API
// testlerindedir (`tests/finance-professional-development.test.ts`,
// `apps/api/test/finance-professional-development.test.ts`); burada yönetici eğitimi taslak ekler,
// yayına alır, öğretmeni atar ve katıldı işaretler; ön büro yayındaki eğitimi ve katılımcısını
// yalnız okur.

const ADMIN_URL = '/yonetici/finans?gorunum=mesleki-gelisim'
const DESK_URL = '/onburo/tahsilat-takip?gorunum=mesleki-gelisim'
const NAME = 'Okuma becerisi öğretimi'

test.describe('ON-214: mesleki gelişim kataloğu', () => {
  test('DOM-FIN-125: yönetici eğitimi yayına alır, öğretmeni atar ve katıldı işaretler; ön büro okur', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'onburo'] })
    const teacher = school.user('ogretmen').name
    const page = await loginAs(school.user('yonetici'))
    await page.goto(ADMIN_URL)
    const section = page.getByRole('region', { name: 'Mesleki gelişim' })
    await expect(section.getByText('Katalogda henüz eğitim yok.')).toBeVisible()

    await section.getByRole('button', { name: 'Yeni eğitim' }).click()
    const dialog = page.getByRole('dialog', { name: 'Yeni eğitim' })
    const form = dialog.getByRole('form', { name: 'Eğitim' })
    await form.getByRole('button', { name: 'Taslak olarak ekle' }).click()
    await expect(form.getByText('Eğitim adını en az 2 karakterle yazın.')).toBeVisible()
    await form.getByLabel('Eğitim adı').fill(NAME)
    await form.getByLabel('Tür').selectOption({ label: 'Seminer' })
    await form.getByLabel('Sağlayıcı').fill('Öğretmen Akademisi')
    await form.getByLabel('Süre (saat)').fill('6')
    await form.getByLabel('Sürekli açık (tarih aralığı yok)').check()
    await form.getByLabel('Çevrim içi bağlantı (isteğe bağlı)').fill('https://egitim.ornek.test')
    await form.getByLabel('Öğretmen').check()
    await form.getByLabel('Kişi başı ücret, TL (isteğe bağlı)').fill('1.250,50')
    await form.getByLabel('Kontenjan (isteğe bağlı)').fill('10')
    await form.getByRole('button', { name: 'Taslak olarak ekle' }).click()
    await expect(dialog).toBeHidden()

    const row = section.getByRole('row', { name: new RegExp(NAME) })
    await expect(row).toContainText('Taslak')
    await expect(row).toContainText('Sürekli')
    await expect(row).toContainText('1.250,50')
    await row.getByRole('button', { name: `${NAME} eğitimini yayına al` }).click()
    await expect(row).toContainText('Yayında')

    await row.getByRole('button', { name: `${NAME} katılımcıları` }).click()
    const roster = page.getByRole('dialog', { name: `${NAME} katılımcıları` })
    await expect(roster.getByText('Henüz atanan personel yok.')).toBeVisible()
    const enroll = roster.getByRole('form', { name: 'Personel ata' })
    await enroll.getByLabel('Personel').selectOption({ label: `${teacher} · Öğretmen` })
    await enroll.getByLabel('Kaynak').selectOption({ label: 'Katılım isteği' })
    await enroll.getByRole('button', { name: 'Ata' }).click()
    const attendance = roster.getByRole('form', { name: `${teacher} katılımı` })
    await expect(attendance).toBeVisible()
    await attendance.getByLabel('Durum').selectOption({ label: 'Katıldı' })
    await attendance.getByLabel('Katılım saati').fill('5,5')
    await attendance.getByRole('button', { name: 'Kaydet' }).click()
    const item = roster.getByRole('listitem').filter({ hasText: teacher })
    await expect(item).toContainText('Katıldı')
    await expect(item).toContainText('5,5 saat')
    await page.keyboard.press('Escape')
    await expect(row).toContainText('1 / 10')
    await expectNoHorizontalOverflow(page)

    // Ön büro yayındaki eğitimi ve katılımcıyı görür, yazma düğmesi görmez (K-430).
    const desk = await loginAs(school.user('onburo'))
    await desk.goto(DESK_URL)
    const deskSection = desk.getByRole('region', { name: 'Mesleki gelişim' })
    const deskRow = deskSection.getByRole('row', { name: new RegExp(NAME) })
    await expect(deskRow).toContainText('Yayında')
    await expect(deskSection.getByRole('button', { name: 'Yeni eğitim' })).toHaveCount(0)
    await expect(deskRow.getByRole('button', { name: `${NAME} eğitimini arşivle` })).toHaveCount(0)
    await deskRow.getByRole('button', { name: `${NAME} katılımcıları` }).click()
    const deskRoster = desk.getByRole('dialog', { name: `${NAME} katılımcıları` })
    await expect(deskRoster.getByRole('listitem').filter({ hasText: teacher })).toContainText(
      'Katıldı',
    )
    await expect(deskRoster.getByRole('form', { name: 'Personel ata' })).toHaveCount(0)
  })
})
