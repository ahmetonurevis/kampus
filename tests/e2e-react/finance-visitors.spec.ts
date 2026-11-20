import { expect, test } from './support/fixtures.ts'
import { seedExpiredVisitor } from './support/finance-visitors.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Ziyaretçi kaydı (ON-166; DOM-FIN-141). Kural dalları birim ve API testlerindedir
// (`tests/finance-visitors.test.ts`, `apps/api/test/finance-visitors.test.ts`); burada yönetici kart
// havuzunu kurar, ön büro dar ekranda aydınlatma işaretiyle giriş yapar (K-478), kartı almadan çıkışı
// kaydeder ve kartı sonra iade alır (K-479); yönetici süresi dolan kaydı anonimleştirir (K-480).

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip'

test.describe('DOM-FIN-141: ziyaretçiler', () => {
  test('DOM-FIN-141: ön büro dar ekranda giriş ve çıkış yapar, kartı sonra iade alır (K-478, K-479)', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'] })
    const admin = await loginAs(school.user('yonetici'))
    await admin.goto(`${ADMIN}?gorunum=ziyaretciler&ziyaretci_sekme=saklama`)
    const adminSection = admin.getByRole('region', { name: 'Ziyaretçiler' })
    const settings = adminSection.getByRole('form', { name: 'Ziyaretçi kaydı ayarı' })
    await settings.getByLabel('Kart havuzu').fill('Z1, Z2')
    await settings.getByLabel('Geçerli aydınlatma metni sürümü').fill('2026/1')
    await settings.getByRole('button', { name: 'Ayarı kaydet' }).click()
    await expect(adminSection.getByText(/2\/2 kart boşta/)).toBeVisible()

    const page = await loginAs(school.user('onburo'))
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${DESK}?gorunum=ziyaretciler`)
    const section = page.getByRole('region', { name: 'Ziyaretçiler' })
    await expect(section.getByRole('button', { name: 'Ayar ve saklama' })).toHaveCount(0)

    await section.getByRole('button', { name: 'Ziyaretçi girişi' }).click()
    const dialog = page.getByRole('dialog', { name: 'Ziyaretçi girişi' })
    const form = dialog.getByRole('form', { name: 'Ziyaretçi girişi' })
    await form.getByLabel('Ad soyad').fill('Mert Tedarikçi')
    await form.getByLabel('Ziyaret amacı').selectOption({ label: 'Tedarikçi' })
    await form.getByLabel('Telefon (isteğe bağlı)').fill('0532 123 45 67')
    await form.getByLabel('Ziyaretçi kartı').selectOption({ label: 'Z1' })
    await expect(form.getByLabel('Gösterilen aydınlatma metni sürümü')).toHaveValue('2026/1')
    await form.getByRole('button', { name: 'Girişi kaydet' }).click()
    await expect(
      form.getByText('Aydınlatma metni gösterilmeden ziyaretçi kaydedilemez.'),
    ).toBeVisible()
    await form.getByLabel('Aydınlatma metni ziyaretçiye gösterildi').check()
    await form.getByRole('button', { name: 'Girişi kaydet' }).click()
    await expect(dialog).toBeHidden()
    await expectNoHorizontalOverflow(page)

    await section.getByRole('button', { name: 'Mert Tedarikçi çıkışını kaydet' }).click()
    const leave = page.getByRole('dialog', { name: 'Ziyaretçi çıkışı' })
    await leave.getByRole('button', { name: 'Kart alınmadı' }).click()
    await expect(leave).toBeHidden()
    await expect(section.getByText('İçeride ziyaretçi yok.')).toBeVisible()

    await section.getByRole('button', { name: 'Kartlar', exact: true }).click()
    await section.getByRole('button', { name: 'Mert Tedarikçi kartını iade al' }).click()
    await expect(section.getByText('Ziyaretçide kalan kart yok.')).toBeVisible()

    await section.getByRole('button', { name: 'Kayıtlar', exact: true }).click()
    await section.getByRole('button', { name: 'Mert Tedarikçi kaydını aç' }).click()
    const panel = page.getByRole('dialog', { name: 'Ziyaret kaydı' })
    await expect(panel.getByText('0532 *** ** 67')).toBeVisible()
    await expect(panel.getByText('Z1 · iade edildi')).toBeVisible()
    await expect(panel.getByText('Sürüm 2026/1 gösterildi')).toBeVisible()
  })

  test('DOM-FIN-141: yönetici saklama süresi dolan kaydı anonimleştirir (K-480)', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici'] })
    await seedExpiredVisitor(school.institutionId, 'Eski Ziyaretçi')
    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=ziyaretciler&ziyaretci_sekme=saklama`)
    const section = page.getByRole('region', { name: 'Ziyaretçiler' })
    const due = section.getByRole('row', { name: /Eski Ziyaretçi/ })
    await expect(due).toContainText('Tedarikçi')
    await due.getByRole('button', { name: 'Eski Ziyaretçi kaydını anonimleştir' }).click()
    const confirm = page.getByRole('dialog', { name: 'Ziyaret kaydını anonimleştir' })
    await confirm.getByRole('button', { name: 'Anonimleştir' }).click()
    await expect(confirm).toBeHidden()
    await expect(section.getByText('Saklama süresi dolan kayıt yok.')).toBeVisible()
  })
})
