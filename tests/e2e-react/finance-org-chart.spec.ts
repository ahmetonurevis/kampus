import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Organizasyon şeması (ON-187; DOM-FIN-129, K-442…K-444). Kural dalları birim ve API
// testlerindedir (`tests/finance-org-chart.test.ts`, `apps/api/test/finance-org-chart.test.ts`);
// burada yönetici birim ağacını kurar, pozisyon açar, öğretmeni atar, birimi ve pozisyonu
// düzeltip taşır, boş pozisyonu kaldırır; şema 390 px'te taşmaz, ön büro sekmeyi görmez.

const ADMIN_URL = '/yonetici/finans?gorunum=organizasyon'
const DESK_URL = '/onburo/tahsilat-takip?gorunum=organizasyon'

test.describe('ON-187: organizasyon şeması', () => {
  test('DOM-FIN-129: yönetici birim ağacını, pozisyonları ve atamayı yönetir; dar ekranda taşma yok', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'onburo'] })
    const teacher = school.user('ogretmen').name
    const page = await loginAs(school.user('yonetici'))
    await page.goto(ADMIN_URL)
    const section = page.getByRole('region', { name: 'Organizasyon' })
    await expect(section.getByText('Henüz birim yok.')).toBeVisible()
    const dialog = page.getByRole('dialog')

    // Kök ve alt birim.
    await section.getByRole('button', { name: 'Yeni birim' }).click()
    const unitForm = dialog.getByRole('form', { name: 'Birim' })
    await unitForm.getByRole('button', { name: 'Birimi ekle' }).click()
    await expect(unitForm.getByText('Birim adı en az 2 karakter olmalı.')).toBeVisible()
    await unitForm.getByLabel('Birim adı').fill('Okul müdürlüğü')
    await unitForm.getByRole('button', { name: 'Birimi ekle' }).click()
    await expect(dialog).toBeHidden()
    await section.getByRole('button', { name: 'Okul müdürlüğü altına birim ekle' }).click()
    await unitForm.getByLabel('Birim adı').fill('Matematik zümresi')
    await unitForm.getByLabel('Tür').selectOption({ label: 'Akademik zümre' })
    await unitForm.getByRole('button', { name: 'Birimi ekle' }).click()
    await expect(dialog).toBeHidden()
    const children = section.getByRole('list', { name: 'Okul müdürlüğü alt birimleri' })
    await expect(children).toContainText('Matematik zümresi')
    await expect(children).toContainText('Akademik zümre')

    // Pozisyonlar ve raporlama hattı.
    await section.getByRole('button', { name: 'Okul müdürlüğü birimine pozisyon aç' }).click()
    const positionForm = dialog.getByRole('form', { name: 'Pozisyon' })
    await positionForm.getByLabel('Unvan').fill('Okul müdürü')
    await positionForm.getByRole('button', { name: 'Pozisyonu aç' }).click()
    await expect(dialog).toBeHidden()
    await section.getByRole('button', { name: 'Matematik zümresi birimine pozisyon aç' }).click()
    await positionForm.getByLabel('Unvan').fill('Matematik öğretmeni')
    await positionForm.getByLabel('Kadro sayısı').fill('2')
    await positionForm
      .getByLabel('Raporladığı pozisyon (isteğe bağlı)')
      .selectOption({ label: 'Okul müdürü (Okul müdürlüğü)' })
    await positionForm.getByRole('button', { name: 'Pozisyonu aç' }).click()
    await expect(dialog).toBeHidden()
    const mathPositions = section.getByRole('list', { name: 'Matematik zümresi pozisyonları' })
    await expect(mathPositions).toContainText('0 / 2 kadro')
    await expect(mathPositions).toContainText('Raporladığı: Okul müdürü')

    // Atama ve boş pozisyonlar.
    await section
      .getByRole('button', { name: 'Matematik öğretmeni pozisyonuna personel ata' })
      .click()
    const assignForm = dialog.getByRole('form', { name: 'Personel ata' })
    await assignForm.getByLabel('Personel').selectOption({ label: `${teacher} · Öğretmen` })
    await assignForm.getByRole('button', { name: 'Ata' }).click()
    await expect(dialog).toBeHidden()
    await expect(
      section.getByRole('list', { name: 'Matematik öğretmeni görevlileri' }),
    ).toContainText(teacher)
    await expect(mathPositions).toContainText('1 / 2 kadro')
    const vacancies = section.getByRole('list', { name: 'Boş pozisyonlar' })
    await expect(vacancies).toContainText(
      'Matematik öğretmeni · Okul müdürlüğü › Matematik zümresi · 1 boş',
    )
    await expect(vacancies).toContainText('Okul müdürü · Okul müdürlüğü · 1 boş')

    // Pozisyon düzeltme: kadro 3; müdür kendisine raporlayan pozisyona raporlayamaz (seçenek yok).
    await section.getByRole('button', { name: 'Matematik öğretmeni pozisyonunu düzelt' }).click()
    await positionForm.getByLabel('Kadro sayısı').fill('3')
    await positionForm.getByRole('button', { name: 'Kaydet' }).click()
    await expect(dialog).toBeHidden()
    await expect(mathPositions).toContainText('1 / 3 kadro')
    await section.getByRole('button', { name: 'Okul müdürü pozisyonunu düzelt' }).click()
    await expect(
      positionForm
        .getByLabel('Raporladığı pozisyon (isteğe bağlı)')
        .getByRole('option', { name: /Matematik öğretmeni/ }),
    ).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    // Birim düzeltme ve taşıma: yeni kök birim; zümre onun altına taşınır, kendi altı seçilemez.
    await section.getByRole('button', { name: 'Yeni birim' }).click()
    await unitForm.getByLabel('Birim adı').fill('Akademik birimler')
    await unitForm.getByRole('button', { name: 'Birimi ekle' }).click()
    await expect(dialog).toBeHidden()
    await section.getByRole('button', { name: 'Matematik zümresi birimini düzelt' }).click()
    const parent = unitForm.getByLabel('Üst birim')
    await expect(parent.getByRole('option', { name: /Matematik zümresi/ })).toHaveCount(0)
    await unitForm.getByLabel('Birim adı').fill('Matematik')
    await parent.selectOption({ label: 'Akademik birimler' })
    await unitForm.getByRole('button', { name: 'Kaydet' }).click()
    await expect(dialog).toBeHidden()
    await expect(
      section.getByRole('list', { name: 'Akademik birimler alt birimleri' }),
    ).toContainText('Matematik')
    await expect(section.getByRole('list', { name: 'Okul müdürlüğü alt birimleri' })).toHaveCount(0)

    // Raporlayan pozisyon varken müdür kaldırılamaz; boş yardımcı pozisyonu kaldırılır.
    await section.getByRole('button', { name: 'Okul müdürü pozisyonunu kaldır' }).click()
    await dialog.getByRole('button', { name: 'Kaldır' }).click()
    await expect(
      page.getByText('Bu pozisyona raporlayan pozisyonlar var', { exact: false }),
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await section.getByRole('button', { name: 'Okul müdürlüğü birimine pozisyon aç' }).click()
    await positionForm.getByLabel('Unvan').fill('Müdür yardımcısı')
    await positionForm.getByRole('button', { name: 'Pozisyonu aç' }).click()
    await expect(dialog).toBeHidden()
    await section.getByRole('button', { name: 'Müdür yardımcısı pozisyonunu kaldır' }).click()
    await dialog.getByRole('button', { name: 'Kaldır' }).click()
    await expect(dialog).toBeHidden()
    await expect(section.getByText('Müdür yardımcısı')).toHaveCount(0)

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(section.getByRole('list', { name: 'Organizasyon şeması' })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    // Ön büroda sekme yok; adres taksitlere düşer (K-444).
    const desk = await loginAs(school.user('onburo'))
    await desk.goto(DESK_URL)
    const tabs = desk.getByRole('toolbar', { name: 'Finans görünümü' })
    await expect(tabs.getByRole('button', { name: 'Taksitler' })).toBeVisible()
    await expect(tabs.getByRole('button', { name: 'Organizasyon' })).toHaveCount(0)
    await expect(desk.getByRole('region', { name: 'Organizasyon' })).toHaveCount(0)
  })
})
