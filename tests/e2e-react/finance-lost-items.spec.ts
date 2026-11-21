import { expect, test } from './support/fixtures.ts'
import { seedExpiredLostItem } from './support/finance-lost-items.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Kayıp eşya (ON-171; DOM-FIN-145). Kural dalları birim ve API testlerindedir
// (`tests/finance-lost-items.test.ts`, `apps/api/test/finance-lost-items.test.ts`); burada ön büro dar
// ekranda bulunan eşyayı hızlı kaydeder ve adıyla başka kişiye teslim eder (K-490), yönetici süresi
// dolan eşyayı gerekçeyle bağışlandı olarak kapatır (K-492).

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip'

test.describe('DOM-FIN-145: kayıp eşya', () => {
  test('DOM-FIN-145: ön büro dar ekranda eşyayı kaydeder ve teslim eder (K-490)', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'] })
    const page = await loginAs(school.user('onburo'))
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${DESK}?gorunum=kayip-esya`)
    const section = page.getByRole('region', { name: 'Kayıp eşya' })
    await expect(section.getByRole('button', { name: 'Ayar ve saklama' })).toHaveCount(0)

    await section.getByRole('button', { name: 'Eşya kaydet' }).click()
    const dialog = page.getByRole('dialog', { name: 'Bulunan eşyayı kaydet' })
    const form = dialog.getByRole('form', { name: 'Bulunan eşyayı kaydet' })
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(form.getByText('Eşyanın tanımı en az 2 karakter olmalı.')).toBeVisible()
    await form.getByLabel('Eşyanın tanımı').fill('Mavi suluk')
    await form.getByLabel('Kategori').selectOption({ label: 'Diğer' })
    await form.getByLabel('Bulunduğu yer').fill('Kantin')
    await form.getByLabel('Saklama yeri').fill('Ön büro dolabı')
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(dialog).toBeHidden()
    await expectNoHorizontalOverflow(page)

    await section.getByRole('button', { name: 'Mavi suluk kaydını aç' }).click()
    const panel = page.getByRole('dialog', { name: 'Bulunan eşya' })
    await expect(panel.getByText('Ön büro dolabı')).toBeVisible()
    await panel.getByRole('button', { name: 'Teslim et' }).click()
    const handover = panel.getByRole('form', { name: 'Eşyayı teslim et' })
    await handover.getByLabel('Teslim alan').selectOption({ label: 'Başka kişi' })
    await handover.getByLabel('Teslim alanın adı').fill('Ali Usta')
    await handover.getByRole('button', { name: 'Teslimi kaydet' }).click()
    await expect(panel.getByText('Ali Usta (Başka kişi)')).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Teslim et' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(section.getByText('Bekleyen eşya yok.')).toBeVisible()
  })

  test('DOM-FIN-145: yönetici süresi dolan eşyayı gerekçeyle bağışlar (K-492)', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici'] })
    await seedExpiredLostItem(school.institutionId, 'Eski mont')
    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=kayip-esya&kayip_sekme=saklama`)
    const section = page.getByRole('region', { name: 'Kayıp eşya' })
    const due = section.getByRole('row', { name: /Eski mont/ })
    await expect(due).toContainText('Saklama süresi doldu')
    await due.getByRole('button', { name: 'Eski mont için bağış ya da imha' }).click()
    const confirm = page.getByRole('dialog', { name: 'Süresi dolan eşyayı kapat' })
    await confirm.getByRole('button', { name: 'Kapat', exact: true }).click()
    await expect(confirm.getByText('Gerekçe en az 2 karakter olmalı.')).toBeVisible()
    await confirm.getByLabel('Gerekçe').fill('Okul bağış kutusu')
    await confirm.getByRole('button', { name: 'Kapat', exact: true }).click()
    await expect(confirm).toBeHidden()
    await expect(section.getByText('Saklama süresi dolan eşya yok.')).toBeVisible()
  })
})
