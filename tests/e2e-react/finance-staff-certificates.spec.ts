import { istanbulDay } from './support/commands.ts'
import { pdfText } from './support/finance-pdf-text.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Personel çalışma ve hizmet belgesi (ON-175; DOM-FIN-106, K-340…K-343). Kural dalları birim ve
// API testlerindedir (`tests/finance-staff-certificates.test.ts`,
// `apps/api/test/finance-staff-certificates.test.ts`; hizmet belgesi ve ücret dahil); burada
// yönetici öğretmene çalışma belgesi düzenler, listede kimlik numarasını görmez, PDF'te görür,
// belgeyi iptal eder; ön büro sekmeyi görmez.

const ADMIN_URL = '/yonetici/finans?gorunum=personel-belgesi'
const DESK_URL = '/onburo/tahsilat-takip?gorunum=personel-belgesi'
const TCKN = '10000000146'

test.describe('ON-175: personel belgeleri', () => {
  test('DOM-FIN-106: yönetici çalışma belgesi düzenler, PDF alır ve iptal eder; ön büro sekmeyi görmez', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'onburo'] })
    const teacher = school.user('ogretmen').name
    const page = await loginAs(school.user('yonetici'))
    await page.goto(ADMIN_URL)
    const section = page.getByRole('region', { name: 'Personel belgeleri' })
    await expect(section.getByText('Henüz personel belgesi düzenlenmedi.')).toBeVisible()

    await section.getByRole('button', { name: 'Yeni belge' }).click()
    const dialog = page.getByRole('dialog', { name: 'Yeni personel belgesi' })
    const form = dialog.getByRole('form', { name: 'Personel belgesi' })
    await form.getByRole('button', { name: 'Belgeyi düzenle' }).click()
    await expect(form.getByText('Personel seçin.')).toBeVisible()
    await form
      .getByLabel('Personel', { exact: true })
      .selectOption({ label: `${teacher} · Öğretmen` })
    // Tür personelin durumundan, görev rolden önerilir (K-340).
    await expect(form.getByLabel('Belge türü')).toHaveValue('employment')
    await expect(form.getByLabel('Görev')).toHaveValue('Öğretmen')
    await form.getByLabel('Görev').fill('İngilizce öğretmeni')
    await form.getByLabel('İşe giriş günü').fill('2021-09-01')
    await form.getByLabel('T.C. kimlik no (isteğe bağlı)').fill(TCKN)
    await form.getByLabel('Muhatap (isteğe bağlı)').fill('X Bankası Kadıköy Şubesi Müdürlüğüne')
    // Ücret tanımı yokken ücret istenirse sunucu reddeder; hata ücret alanında görünür (K-342).
    await form.getByLabel('Ücret bilgisini belgeye yaz').check()
    await form.getByRole('button', { name: 'Belgeyi düzenle' }).click()
    await expect(form.getByText(/Bugün yürürlükte ana ücret tanımı yok/)).toBeVisible()
    await form.getByLabel('Ücret bilgisini belgeye yaz').uncheck()
    await form.getByRole('button', { name: 'Belgeyi düzenle' }).click()
    await expect(dialog).toBeHidden()

    const number = `PB-${istanbulDay().slice(0, 4)}-1`
    const row = section.getByRole('row', { name: new RegExp(number) })
    await expect(row).toContainText(teacher)
    await expect(row).toContainText('Çalışma belgesi')
    await expect(row).toContainText('Geçerli')
    // Liste kimlik numarası taşımaz (K-343).
    await expect(section.getByText(TCKN)).toHaveCount(0)

    await row.getByRole('button', { name: `${number} PDF` }).click()
    const pdf = page.getByRole('dialog', { name: `Çalışma belgesi ${number} · Önizleme` })
    const downloading = page.waitForEvent('download')
    await pdf.getByRole('button', { name: 'PDF’yi indir' }).click()
    const text = await pdfText(await downloading)
    for (const expected of [
      'ÇALIŞMA BELGESİ',
      number,
      teacher,
      TCKN,
      'İngilizce öğretmeni',
      'X BANKASI KADIKÖY ŞUBESİ MÜDÜRLÜĞÜNE',
    ])
      expect(text).toContain(expected)
    await page.keyboard.press('Escape')
    await expect(pdf).toBeHidden()

    await row.getByRole('button', { name: `${number} belgesini iptal et` }).click()
    const cancel = page.getByRole('dialog', { name: 'Personel belgesini iptal et' })
    await cancel.getByRole('textbox', { name: 'Gerekçe' }).fill('Görev yanlış yazıldı')
    await cancel.getByRole('button', { name: 'İptal et' }).click()
    await expect(cancel).toBeHidden()
    await expect(row).toContainText('İptal edildi')
    await expect(row.getByRole('button', { name: `${number} belgesini iptal et` })).toHaveCount(0)
    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)

    const desk = await loginAs(school.user('onburo'))
    await desk.goto(DESK_URL)
    const tabs = desk.getByRole('toolbar', { name: 'Finans görünümü' })
    await expect(tabs.getByRole('button', { name: 'Taksitler' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(tabs.getByRole('button', { name: 'Personel belgeleri' })).toHaveCount(0)
    await expect(desk.getByRole('region', { name: 'Personel belgeleri' })).toHaveCount(0)
  })
})
