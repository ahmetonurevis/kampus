import { istanbulDay } from './support/commands.ts'
import { pdfText } from './support/finance-pdf-text.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Kurul ve zümre toplantısı tutanağı (ON-217, ON-218; DOM-FIN-132, DOM-FIN-135, K-451…K-453,
// K-460…K-462). Kural dalları birim ve API testlerindedir (`tests/finance-department-meetings.test.ts`,
// `apps/api/test/finance-department-meetings.test.ts`); burada yönetici zümre tutanağı açar, karar
// ekler, imza günüyle kesinleştirir, PDF'i indirir, termini geçmiş kararı listede görür ve takibini
// yazar; gündem şablonundan öğretmenler kurulu tutanağı açar ve geciken kararları kurul türüyle
// süzer; ön büro sekmeyi görmez. Tarihler İstanbul gününe göredir.

const ADMIN_URL = '/yonetici/finans?gorunum=kurul-toplantilari'
const DESK_URL = '/onburo/tahsilat-takip'
const DECISION = 'Ortak yazılı sınav takvimi hazırlanacak.'
const BOARD_DECISION = 'Başarısı düşük öğrenciler için destek planı hazırlanacak.'

test.describe('ON-217, ON-218: kurul ve zümre toplantısı tutanağı', () => {
  test('DOM-FIN-132: yönetici tutanağı açar, karar ekler, kesinleştirir, PDF alır ve geciken kararı izler', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'onburo'] })
    const teacher = school.user('ogretmen').name
    const manager = school.user('yonetici').name
    const page = await loginAs(school.user('yonetici'))
    await page.goto(ADMIN_URL)
    const section = page.getByRole('region', { name: 'Kurul ve zümre toplantıları' })
    await expect(section.getByText('Henüz tutanak yok.')).toBeVisible()

    await section.getByRole('button', { name: 'Yeni tutanak' }).click()
    const dialog = page.getByRole('dialog', { name: 'Yeni tutanak' })
    const form = dialog.getByRole('form', { name: 'Toplantı tutanağı' })
    await form.getByRole('button', { name: 'Tutanağı aç' }).click()
    await expect(form.getByText('Zümreyi (dersi) seçin.')).toBeVisible()
    await form.getByLabel('Zümre (ders)').selectOption({ label: 'Matematik' })
    await expect(form.getByLabel('Kurul türü')).toHaveValue('department')
    await form.getByLabel('Toplantı zamanı').selectOption({ label: 'Dönem başı' })
    await form.getByLabel('Toplantı günü').fill(istanbulDay(-10))
    await form.getByLabel('Yer').fill('Öğretmenler odası')
    await form.getByLabel('Toplantı başkanı').selectOption({ label: teacher })
    await form.getByLabel('1. madde', { exact: true }).fill('Açılış ve yoklama')
    await form.getByRole('button', { name: 'Madde ekle' }).click()
    await form.getByLabel('2. madde', { exact: true }).fill('Ortak sınav takvimi')
    await form
      .getByLabel('2. madde görüşme özeti (isteğe bağlı)')
      .fill('Sınav haftaları görüşüldü.')
    await form.getByLabel(teacher, { exact: true }).selectOption({ label: 'Katıldı' })
    await form.getByLabel(manager, { exact: true }).selectOption({ label: 'Mazeretli' })
    await form.getByRole('button', { name: 'Tutanağı aç' }).click()
    await expect(dialog).toBeHidden()

    const detail = page.getByRole('dialog', { name: 'Toplantı tutanağı' })
    await expect(detail).toContainText('Matematik zümresi · Dönem başı')
    await expect(detail.getByText('Taslak', { exact: true })).toBeVisible()
    await detail.getByRole('button', { name: 'Karar ekle' }).click()
    const decision = detail.getByRole('form', { name: 'Yeni karar' })
    await decision.getByLabel('Gündem maddesi').selectOption({ label: '2. Ortak sınav takvimi' })
    await decision.getByLabel('Sorumlu').selectOption({ label: teacher })
    await decision.getByLabel('Karar metni').fill(DECISION)
    await decision.getByLabel('Termin (isteğe bağlı)').fill(istanbulDay(-3))
    await decision.getByRole('button', { name: 'Kararı ekle' }).click()
    const item = detail.getByRole('listitem').filter({ hasText: DECISION })
    await expect(item).toContainText('2.1 · Ortak sınav takvimi')
    await expect(item).toContainText(`Sorumlu ${teacher}`)

    // Kesinleşen tutanakta karar eklenmez ve düzeltilmez; yalnız takip (K-453).
    await detail.getByRole('button', { name: 'Tutanağı kesinleştir' }).click()
    await expect(detail.getByText('Kesinleşti', { exact: true })).toBeVisible()
    await expect(detail.getByRole('button', { name: 'Karar ekle' })).toHaveCount(0)
    await expect(detail.getByRole('button', { name: 'Tutanağı düzelt' })).toHaveCount(0)
    await expect(item).toContainText('Termini geçti')
    await page.keyboard.press('Escape')
    await expect(detail).toBeHidden()

    const row = section.getByRole('row', { name: /Matematik zümresi/ })
    await expect(row).toContainText('Kesinleşti')
    await expect(row).toContainText('1 / 2 katıldı')
    await expect(row).toContainText('1 açık / 1')
    await row.getByRole('button', { name: /tutanak PDF$/ }).click()
    const pdf = page.getByRole('dialog', { name: 'Zümre toplantısı tutanağı · Önizleme' })
    const downloading = page.waitForEvent('download')
    await pdf.getByRole('button', { name: 'PDF’yi indir' }).click()
    const text = await pdfText(await downloading)
    for (const expected of ['ZÜMRE TUTANAĞI', 'Ortak sınav takvimi', teacher, 'Mazeretli'])
      expect(text).toContain(expected)
    await page.keyboard.press('Escape')
    await expect(pdf).toBeHidden()

    // Termini geçmiş açık kararlar görünümü ve takip.
    await section.getByRole('button', { name: 'Termini geçmiş kararlar' }).click()
    const late = section.getByRole('row', { name: new RegExp(DECISION) })
    await expect(late).toContainText('3 gün')
    await expect(late).toContainText(teacher)
    await late.getByRole('button', { name: `${DECISION} kararının tutanağını aç` }).click()
    await detail.getByRole('button', { name: '2.1 numaralı kararın takibi' }).click()
    const followUp = detail.getByRole('form', { name: '2.1 numaralı karar takibi' })
    await followUp.getByLabel('Karar durumu').selectOption({ label: 'Tamamlandı' })
    await followUp.getByLabel('Takip notu').fill('Takvim duyuruldu.')
    await followUp.getByRole('button', { name: 'Takibi kaydet' }).click()
    await expect(item).toContainText('Tamamlandı')
    await expect(item).toContainText('Takip: Takvim duyuruldu.')
    await page.keyboard.press('Escape')
    await expect(section.getByText('Termini geçmiş açık karar yok.')).toBeVisible()
    await expectNoHorizontalOverflow(page)

    // Ön büro sekmeyi görmez (K-451).
    const desk = await loginAs(school.user('onburo'))
    await desk.goto(`${DESK_URL}?gorunum=kurul-toplantilari`)
    await expect(desk.getByRole('region', { name: 'Kurul ve zümre toplantıları' })).toHaveCount(0)
  })

  test('DOM-FIN-135: yönetici gündem şablonu açar, öğretmenler kurulunu şablondan doldurur ve geciken kararları kurul türüyle süzer', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen'] })
    const teacher = school.user('ogretmen').name
    const page = await loginAs(school.user('yonetici'))
    await page.goto(ADMIN_URL)
    const section = page.getByRole('region', { name: 'Kurul ve zümre toplantıları' })

    // Şablon: önerilen maddelerle açılır, kurum düzenler (K-461).
    await section.getByRole('button', { name: 'Gündem şablonları' }).click()
    await expect(section.getByText('Henüz gündem şablonu yok.')).toBeVisible()
    await section.getByRole('button', { name: 'Yeni şablon' }).click()
    const templateDialog = page.getByRole('dialog', { name: 'Yeni gündem şablonu' })
    const templateForm = templateDialog.getByRole('form', { name: 'Gündem şablonu' })
    await templateForm.getByLabel('Kurul türü').selectOption({ label: 'Öğretmenler kurulu' })
    await templateForm.getByRole('button', { name: 'Önerilen maddeleri yükle' }).click()
    await expect(templateForm.getByLabel('2. şablon maddesi', { exact: true })).toHaveValue(
      'Önceki kurul kararlarının değerlendirilmesi',
    )
    await templateForm.getByLabel('Şablon adı').fill('Dönem sonu öğretmenler kurulu')
    await templateForm
      .getByLabel('3. şablon maddesi', { exact: true })
      .fill('Yıl sonu başarı değerlendirmesi')
    await templateForm.getByRole('button', { name: 'Şablonu kaydet' }).click()
    await expect(templateDialog).toBeHidden()
    const templateRow = section.getByRole('row', { name: /Dönem sonu öğretmenler kurulu/ })
    await expect(templateRow).toContainText('Öğretmenler kurulu')
    await expect(templateRow).toContainText('6 madde')

    // Öğretmenler kurulu: ders ve sınıf yok; gündem şablondan kopyalanır, sonra düzenlenir.
    await section.getByRole('button', { name: 'Yeni tutanak' }).click()
    const dialog = page.getByRole('dialog', { name: 'Yeni tutanak' })
    const form = dialog.getByRole('form', { name: 'Toplantı tutanağı' })
    await form.getByLabel('Kurul türü').selectOption({ label: 'Öğretmenler kurulu' })
    await expect(form.getByLabel('Zümre (ders)')).toHaveCount(0)
    await form
      .getByLabel('Gündem şablonu (isteğe bağlı)')
      .selectOption({ label: 'Dönem sonu öğretmenler kurulu' })
    await form.getByRole('button', { name: 'Şablondan doldur' }).click()
    await expect(form.getByLabel('3. madde', { exact: true })).toHaveValue(
      'Yıl sonu başarı değerlendirmesi',
    )
    await form.getByLabel('6. madde', { exact: true }).fill('Dilek, temenni ve kapanış')
    await form.getByLabel('Toplantı zamanı').selectOption({ label: 'Dönem sonu' })
    await form.getByLabel('Toplantı günü').fill(istanbulDay(-8))
    await form.getByLabel('Yer').fill('Konferans salonu')
    await form.getByLabel('Toplantı başkanı').selectOption({ label: teacher })
    await form.getByLabel(teacher, { exact: true }).selectOption({ label: 'Katıldı' })
    await form.getByRole('button', { name: 'Tutanağı aç' }).click()
    await expect(dialog).toBeHidden()

    const detail = page.getByRole('dialog', { name: 'Toplantı tutanağı' })
    await expect(detail).toContainText('Öğretmenler kurulu · Dönem sonu')
    await expect(detail).toContainText('Dilek, temenni ve kapanış')
    await detail.getByRole('button', { name: 'Karar ekle' }).click()
    const decision = detail.getByRole('form', { name: 'Yeni karar' })
    await decision
      .getByLabel('Gündem maddesi')
      .selectOption({ label: '3. Yıl sonu başarı değerlendirmesi' })
    await decision.getByLabel('Sorumlu').selectOption({ label: teacher })
    await decision.getByLabel('Karar metni').fill(BOARD_DECISION)
    await decision.getByLabel('Termin (isteğe bağlı)').fill(istanbulDay(-2))
    await decision.getByRole('button', { name: 'Kararı ekle' }).click()
    await expect(detail.getByRole('listitem').filter({ hasText: BOARD_DECISION })).toContainText(
      '3.1',
    )
    await detail.getByRole('button', { name: 'Tutanağı kesinleştir' }).click()
    await expect(detail.getByText('Kesinleşti', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(detail).toBeHidden()

    await section.getByRole('button', { name: 'Tutanaklar', exact: true }).click()
    const row = section.getByRole('row', { name: /Öğretmenler kurulu/ })
    await expect(row).toContainText('Dönem sonu')
    await row.getByRole('button', { name: /tutanak PDF$/ }).click()
    const pdf = page.getByRole('dialog', { name: 'Öğretmenler kurulu tutanağı · Önizleme' })
    const downloading = page.waitForEvent('download')
    await pdf.getByRole('button', { name: 'PDF’yi indir' }).click()
    const download = await downloading
    expect(download.suggestedFilename()).toBe(`ogretmenler-kurulu-tutanagi-${istanbulDay(-8)}.pdf`)
    expect(await pdfText(download)).toContain('ÖĞRETMENLER KURULU TUTANAĞI')
    await page.keyboard.press('Escape')
    await expect(pdf).toBeHidden()

    // Termini geçmiş kararlar kurul türüyle süzülür (K-462).
    await section.getByRole('button', { name: 'Termini geçmiş kararlar' }).click()
    const late = section.getByRole('row', { name: new RegExp(BOARD_DECISION) })
    await expect(late).toContainText('Öğretmenler kurulu')
    await expect(late).toContainText('2 gün')
    await section.getByRole('button', { name: 'Filtreler', exact: true }).click()
    await section.getByLabel('Kurul', { exact: true }).selectOption({ label: 'Zümre toplantısı' })
    await expect(section.getByText('Termini geçmiş açık karar yok.')).toBeVisible()
    await section.getByLabel('Kurul', { exact: true }).selectOption({ label: 'Öğretmenler kurulu' })
    await expect(late).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
