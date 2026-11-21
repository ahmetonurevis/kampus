import { istanbulDay } from './support/commands.ts'
import { pdfText } from './support/finance-pdf-text.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// İşten ayrılış süreci (ON-180; DOM-FIN-118, K-403…K-405). Kural dalları (zimmet iadesi, avans ve
// icra, izin günü, hesap kapatma, hizmet belgesi, tamamlama) birim ve API testlerindedir
// (`tests/finance-staff-separations.test.ts`, `apps/api/test/finance-staff-separations.test.ts`);
// burada yönetici öğretmene ayrılış dosyası açar, kontrol listesini görür, izin adımını işaretler,
// eksik adımla ilişik kesemez, taslak PDF'i alır ve dosyayı iptal eder; ön büro sekmeyi görmez.

const ADMIN_URL = '/yonetici/finans?gorunum=isten-ayrilis'
const DESK_URL = '/onburo/tahsilat-takip?gorunum=isten-ayrilis'

test.describe('ON-180: işten ayrılış', () => {
  test('DOM-FIN-118: yönetici dosya açar, adımı işaretler, taslak PDF alır ve iptal eder; ön büro sekmeyi görmez', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'onburo'] })
    const teacher = school.user('ogretmen').name
    const today = istanbulDay()
    const page = await loginAs(school.user('yonetici'))
    await page.goto(ADMIN_URL)
    const section = page.getByRole('region', { name: 'İşten ayrılış' })
    await expect(section.getByText('Henüz ayrılış dosyası açılmadı.')).toBeVisible()

    await section.getByRole('button', { name: 'Yeni ayrılış dosyası' }).click()
    const dialog = page.getByRole('dialog', { name: 'Yeni ayrılış dosyası' })
    const form = dialog.getByRole('form', { name: 'Ayrılış dosyası' })
    await form.getByRole('button', { name: 'Dosyayı aç' }).click()
    await expect(form.getByText('Personel seçin.')).toBeVisible()
    await form
      .getByLabel('Personel', { exact: true })
      .selectOption({ label: `${teacher} · Öğretmen` })
    await form.getByLabel('Ayrılış günü').fill(today)
    await form.getByLabel('Ayrılış nedeni').selectOption({ label: 'İstifa' })
    await expect(form.getByLabel('SGK çıkış kodu')).toContainText('Önerilen (03)')
    await form.getByRole('button', { name: 'Dosyayı aç' }).click()
    await expect(dialog).toBeHidden()

    // Açılan dosya ayrıntısı kontrol listesini gösterir (K-404).
    const detail = page.getByRole('dialog', { name: 'Ayrılış dosyası' })
    await expect(
      detail.getByText('03 · Belirsiz süreli iş sözleşmesinin işçi tarafından feshi (istifa)'),
    ).toBeVisible()
    const checklist = detail.getByRole('list', { name: 'Kontrol listesi' })
    const asset = checklist.getByRole('listitem', { name: 'Zimmet iadesi' })
    await expect(asset).toContainText('Personele zimmetli demirbaş yok.')
    await expect(asset).toContainText('Tamamlandı')
    await expect(checklist.getByRole('listitem', { name: 'Avans ve icra kontrolü' })).toContainText(
      'Kesilecek avans ve süren icra yok.',
    )
    const leave = checklist.getByRole('listitem', { name: 'Kullanılmayan yıllık izin' })
    await expect(leave).toContainText('Bekliyor')
    await leave.getByRole('button', { name: 'Kullanılmayan yıllık izin: kontrol edildi' }).click()
    await expect(leave).toContainText('Tamamlandı')
    await expect(
      leave.getByRole('button', { name: 'Kullanılmayan yıllık izin: işareti kaldır' }),
    ).toBeVisible()
    await expect(
      checklist
        .getByRole('listitem', { name: 'Hesap kapatma' })
        .getByRole('link', { name: 'Kullanıcı hesaplarına git' }),
    ).toHaveAttribute('href', '/yonetici/ayarlar?sekme=kullanicilar')
    // Hesap ve hizmet belgesi bitmeden ilişik kesilmez.
    await expect(detail.getByRole('button', { name: 'İlişiği kes' })).toBeDisabled()
    await expect(
      detail.getByText('Önce şu adımları bitirin: Hesap kapatma, Hizmet belgesi.'),
    ).toBeVisible()

    await detail.getByRole('button', { name: 'İlişik kesme belgesi' }).click()
    const pdf = page.getByRole('dialog', { name: `İlişik kesme belgesi · ${teacher} · Önizleme` })
    const downloading = page.waitForEvent('download')
    await pdf.getByRole('button', { name: 'PDF’yi indir' }).click()
    const text = await pdfText(await downloading)
    for (const expected of [
      'İLİŞİK KESME BELGESİ',
      'TASLAK',
      teacher,
      'ilişiğin kesildiğini göstermez',
    ])
      expect(text).toContain(expected)
    await page.keyboard.press('Escape')
    await expect(pdf).toBeHidden()

    await detail.getByRole('button', { name: 'Dosyayı iptal et' }).click()
    const cancel = detail.getByRole('form', { name: 'İptal gerekçesi' })
    await cancel.getByRole('textbox', { name: 'Gerekçe' }).fill('Personel ayrılmaktan vazgeçti')
    await cancel.getByRole('button', { name: 'İptal et' }).click()
    await expect(detail.getByText('Personel ayrılmaktan vazgeçti')).toBeVisible()
    await expect(detail.getByRole('button', { name: 'İlişiği kes' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(detail).toBeHidden()
    const row = section.getByRole('row', { name: new RegExp(teacher) })
    await expect(row).toContainText('İptal edildi')
    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)

    const desk = await loginAs(school.user('onburo'))
    await desk.goto(DESK_URL)
    const tabs = desk.getByRole('toolbar', { name: 'Finans görünümü' })
    await expect(tabs.getByRole('button', { name: 'Taksitler' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(tabs.getByRole('button', { name: 'İşten ayrılış' })).toHaveCount(0)
    await expect(desk.getByRole('region', { name: 'İşten ayrılış' })).toHaveCount(0)
  })
})
