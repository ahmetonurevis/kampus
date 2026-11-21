import { expect, test } from './support/fixtures.ts'
import { markFilesReady, pdf } from './support/materials.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Özlük belgeleri (ON-173; DOM-FIN-113). Kural dalları birim ve API testlerindedir
// (`tests/finance-staff-documents.test.ts`, `apps/api/test/finance-staff-documents.test.ts`);
// burada yönetici öğretmenin eksik zorunlu belgelerini görür, dosyalı eski adli sicil kaydı girer
// (süresi geçti), bugünkü kayıtla eskisinin yerine geçtiğini görür (K-373) ve takip listesinde
// izler; ön büro adli sicil türünü seçemez ve dosyasını açamaz, yalnız tür ve tarihi görür (K-374).

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip'
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format()

test.describe('DOM-FIN-113: özlük belgeleri', () => {
  test('DOM-FIN-113: yönetici adli sicil kaydeder, yenisi eskisinin yerine geçer; ön büro özel nitelikli dosyayı açamaz', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'onburo'] })
    const teacher = school.user('ogretmen').name
    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=ozluk-belgeleri`)
    const section = page.getByRole('region', { name: 'Özlük belgeleri' })
    await expect(
      section
        .getByRole('list', { name: 'Belge uyarıları' })
        .getByText(/personelin zorunlu belgesi eksik/),
    ).toBeVisible()
    const row = section.getByRole('row', { name: new RegExp(teacher) })
    await expect(row).toContainText(
      'Diploma / mezuniyet belgesi, Sağlık raporu, Adli sicil kaydı, Kimlik fotokopisi',
    )

    await row.getByRole('button', { name: `${teacher} özlük belgelerini aç` }).click()
    const person = page.getByRole('dialog', { name: 'Personel özlük belgeleri' })
    await expect(person.getByText('Henüz belge kaydı yok.')).toBeVisible()

    await person.getByRole('button', { name: 'Yeni belge' }).click()
    const dialog = page.getByRole('dialog', { name: 'Yeni özlük belgesi' })
    const form = dialog.getByRole('form', { name: 'Özlük belgesi' })
    await form.getByLabel('Belge türü').selectOption({ label: 'Adli sicil kaydı' })
    await expect(
      form.getByText('Özel nitelikli belgeye not yazılmaz', { exact: false }),
    ).toBeVisible()
    await form.getByLabel('Belge tarihi').fill('2020-01-01')
    await form
      .getByLabel('Belge dosyası (isteğe bağlı)', { exact: true })
      .setInputFiles(pdf('adli-sicil.pdf'))
    await expect(
      form.getByRole('list', { name: 'Belge dosyası' }).getByRole('listitem'),
    ).toHaveCount(1)
    await markFilesReady(school.institutionId)
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(dialog).toBeHidden()

    const documents = person.getByRole('list', { name: 'Özlük belgeleri' })
    const old = documents.getByRole('listitem', { name: 'Adli sicil kaydı, 1 Oca 2020 tarihli' })
    await expect(old).toContainText('Süresi geçti')
    await expect(old).toContainText('Özel nitelikli')
    await expect(old.getByRole('button', { name: 'Adli sicil kaydı dosyasını aç' })).toBeVisible()

    await person.getByRole('button', { name: 'Yeni belge' }).click()
    await form.getByLabel('Belge türü').selectOption({ label: 'Adli sicil kaydı' })
    await form.getByLabel('Belge tarihi').fill(today())
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(dialog).toBeHidden()
    await expect(old).toContainText('Yerine yenisi geçti')
    await expect(documents.getByRole('listitem')).toHaveCount(2)
    await expect(documents.getByRole('listitem').first()).toContainText('Geçerli')
    await page.keyboard.press('Escape')
    await expect(person).toBeHidden()

    await section
      .getByRole('toolbar', { name: 'Özlük görünümü' })
      .getByRole('button', {
        name: 'Geçerlilik takibi',
      })
      .click()
    await expect(
      section.getByRole('row', { name: new RegExp(`${teacher}.*Adli sicil kaydı`) }),
    ).toContainText('Geçerli')
    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)

    const desk = await loginAs(school.user('onburo'))
    await desk.goto(`${DESK}?gorunum=ozluk-belgeleri`)
    const deskSection = desk.getByRole('region', { name: 'Özlük belgeleri' })
    await expect(deskSection.getByRole('button', { name: 'Belge türleri' })).toHaveCount(0)
    // Dar ekranda tablo kart olarak çizilir; düğme adı satırdan bağımsızdır.
    await deskSection.getByRole('button', { name: `${teacher} özlük belgelerini aç` }).click()
    const deskPerson = desk.getByRole('dialog', { name: 'Personel özlük belgeleri' })
    const restricted = deskPerson
      .getByRole('list', { name: 'Özlük belgeleri' })
      .getByRole('listitem', { name: 'Adli sicil kaydı, 1 Oca 2020 tarihli' })
    await expect(restricted).toContainText('Dosyayı yalnız yönetici açar.')
    await expect(restricted.getByRole('button')).toHaveCount(0)
    await deskPerson.getByRole('button', { name: 'Yeni belge' }).click()
    const deskForm = desk.getByRole('form', { name: 'Özlük belgesi' })
    await expect(deskForm.getByLabel('Belge türü').getByRole('option')).toHaveText([
      'Diploma / mezuniyet belgesi',
      'Sertifika / kurs belgesi',
      'Kimlik fotokopisi',
      'Diğer',
    ])
  })
})
