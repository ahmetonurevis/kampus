import { expect, test } from './support/fixtures.ts'
import { markFilesReady, pdf } from './support/materials.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Politika onayları (ON-190; DOM-FIN-127). Kural dalları birim ve API testlerindedir
// (`tests/finance-policy-acknowledgements.test.ts`,
// `apps/api/test/finance-policy-acknowledgements.test.ts`); burada yönetici PDF'li belge yayımlar,
// öğretmen adına ıslak imzalı onay kaydeder ve öğretmen onaylamayanlardan çıkar (K-437); ön büro
// belge yayımlayamaz, personel başına eksik onayları görür (K-438).

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip'

test.describe('DOM-FIN-127: politika onayları', () => {
  test('DOM-FIN-127: yönetici belge yayımlar, personel adına onay kaydeder; ön büro eksikleri görür', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'onburo'] })
    const teacher = school.user('ogretmen').name
    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=politika-onaylari`)
    const section = page.getByRole('region', { name: 'Politika onayları' })
    await expect(section.getByText('Henüz politika belgesi yayımlanmadı.')).toBeVisible()

    await section.getByRole('button', { name: 'Yeni belge' }).click()
    const dialog = page.getByRole('dialog', { name: 'Yeni politika belgesi' })
    const form = dialog.getByRole('form', { name: 'Politika belgesi' })
    await form.getByLabel('Belge adı').fill('İş güvenliği talimatı')
    await form.getByLabel('Belge türü').selectOption({ label: 'İş güvenliği' })
    await form
      .getByLabel('Belge dosyası (PDF)', { exact: true })
      .setInputFiles(pdf('is-guvenligi.pdf'))
    await expect(
      form.getByRole('list', { name: 'Belge dosyası' }).getByRole('listitem'),
    ).toHaveCount(1)
    await markFilesReady(school.institutionId)
    await form.getByRole('button', { name: 'Yayımla' }).click()
    await expect(dialog).toBeHidden()

    const row = section.getByRole('row', { name: /İş güvenliği talimatı/ })
    await expect(row).toContainText(/0 \/ \d+ \(%0\)/)
    await row.getByRole('button', { name: 'İş güvenliği talimatı onaylarını aç' }).click()
    const panel = page.getByRole('dialog', { name: 'Politika belgesi' })
    const pending = panel.getByRole('list', { name: 'Onaylamayan personel' })
    await expect(pending.getByText(teacher)).toBeVisible()
    await pending.getByRole('button', { name: `${teacher} için onay kaydet` }).click()
    const ackDialog = page.getByRole('dialog', { name: 'Okundu onayı kaydet' })
    await ackDialog.getByLabel('Kanal').selectOption({ label: 'E-posta ile onay' })
    await ackDialog.getByRole('button', { name: 'Onayı kaydet' }).click()
    await expect(ackDialog).toBeHidden()
    await expect(pending.getByText(teacher)).toHaveCount(0)
    await panel.getByRole('button', { name: 'Onaylayanlar' }).click()
    await expect(panel.getByRole('list', { name: 'Onaylayan personel' })).toContainText(
      'E-posta ile onay',
    )
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await expect(row).toContainText(/1 \/ \d+/)
    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)

    const desk = await loginAs(school.user('onburo'))
    await desk.goto(
      `${DESK}?gorunum=politika-onaylari&politika_sekme=personel&politika_personel_eksik=true`,
    )
    const deskSection = desk.getByRole('region', { name: 'Politika onayları' })
    await expect(deskSection.getByRole('button', { name: 'Yeni belge' })).toHaveCount(0)
    // Dar ekranda satırlar kart olarak çizilir; metinle aranır.
    await expect(deskSection.getByText(school.user('onburo').name, { exact: true })).toBeVisible()
    await expect(deskSection.getByText('İş güvenliği talimatı (Sürüm 1)').first()).toBeVisible()
    await expect(deskSection.getByText(teacher, { exact: true })).toHaveCount(0)
  })
})
