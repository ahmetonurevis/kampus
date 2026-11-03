import { randomUUID } from 'node:crypto'

import type { Page } from '@playwright/test'

import { accounts } from './support/env.ts'
import { expect, test } from './support/fixtures.ts'

// Ayarlar → Kullanıcı & Yetkiler: personel daveti, davet iptali, rol değiştirme ve
// pasifleştirme (IST-007, DOM-YTK-070). Her test kendi kurumunu kurar (`tenant`); yönetici yeni
// oturumla girer (işlemler taze oturum ister).

const USERS_URL = '/yonetici/ayarlar?sekme=kullanicilar'
const usersTable = (page: Page) => page.getByRole('table', { name: 'Kurum kullanıcıları' })
const invitations = (page: Page) => page.getByRole('region', { name: 'Bekleyen davetler' })

test.describe('personel daveti ve hesap işlemleri (DOM-YTK-070)', () => {
  test('DOM-YTK-070: yönetici personel davet eder, bekleyen daveti görür ve iptal eder', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici'] })
    const page = await loginAs(school.user('yonetici'), { fresh: true })
    const email = `personel-${randomUUID().slice(0, 8)}@kampus.example`

    await page.goto(USERS_URL)
    await expect(page.getByText('1 kullanıcı')).toBeVisible()
    await page.getByRole('button', { name: 'Personel davet et' }).click()
    const panel = page.getByRole('dialog', { name: 'Personel davet et' })
    const form = panel.getByRole('form', { name: 'Personel davet et' })

    // İstemci doğrulaması: geçersiz e-posta alanda Türkçe.
    await form.getByLabel('Ad soyad').fill('Mert Ak')
    await form.getByLabel('E-posta').fill('gecersiz')
    await form.getByRole('button', { name: 'Davet et' }).click()
    await expect(form.getByText('Geçerli bir e-posta adresi girin.')).toBeVisible()

    await form.getByLabel('E-posta').fill(email)
    await form.getByLabel('Öğretmen kaydı').selectOption({ label: 'Ahmet Yıldırım' })
    await form.getByRole('button', { name: 'Davet et' }).click()
    await expect(page.getByText('Mert Ak davet edildi.', { exact: false })).toBeVisible()
    await expect(panel).toHaveCount(0)

    await expect(page.getByText('2 kullanıcı')).toBeVisible()
    await expect(usersTable(page).getByText(email)).toBeVisible()
    await expect(invitations(page).getByText(email, { exact: false })).toBeVisible()

    // Aynı e-posta yeniden davet edilemez: hata alanda.
    await page.getByRole('button', { name: 'Personel davet et' }).click()
    await form.getByLabel('Ad soyad').fill('Mert Ak')
    await form.getByLabel('E-posta').fill(email)
    await form.getByLabel('Rol').selectOption('onburo')
    await form.getByRole('button', { name: 'Davet et' }).click()
    await expect(form.getByText('Bu e-posta adresi kurumda zaten kayıtlı.')).toBeVisible()
    await form.getByRole('button', { name: 'Vazgeç' }).click()

    await invitations(page).getByRole('button', { name: 'Mert Ak davetini iptal et' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Daveti iptal et' })
    await dialog.getByRole('button', { name: 'Daveti iptal et' }).click()
    await expect(page.getByText('Mert Ak daveti iptal edildi.')).toBeVisible()
    await expect(invitations(page)).toHaveCount(0)
    await expect(page.getByText('1 kullanıcı')).toBeVisible()
    await expect(usersTable(page).getByText(email)).toHaveCount(0)
  })

  test('DOM-YTK-070: yönetici rol değiştirir, hesabı pasifleştirir ve geri alır', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici', 'ogretmen'] })
    const page = await loginAs(school.user('yonetici'), { fresh: true })

    await page.goto(USERS_URL)
    // Kendi hesabında işlem yok.
    await page.getByRole('button', { name: `${accounts.yonetici.name} ayrıntısı` }).click()
    const panel = page.getByRole('dialog', { name: 'Kullanıcı ayrıntısı' })
    await expect(panel.getByRole('heading', { name: accounts.yonetici.name })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Hesabı pasifleştir' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: `${accounts.ogretmen.name} ayrıntısı` }).click()
    await panel.getByLabel('Rol').selectOption('onburo')
    await panel.getByRole('button', { name: 'Rolü değiştir' }).click()
    await expect(page.getByText(`${accounts.ogretmen.name} rolü değiştirildi.`)).toBeVisible()
    // Liste tazelenir; panel güncel satırı gösterir (tablo panel açıkken erişilebilirlik ağacında gizli).
    await expect(panel.getByRole('paragraph').filter({ hasText: 'Ön Büro & Satış' })).toBeVisible()

    await panel.getByRole('button', { name: 'Hesabı pasifleştir' }).click()
    await page
      .getByRole('alertdialog', { name: 'Hesabı pasifleştir' })
      .getByRole('button', { name: 'Pasifleştir' })
      .click()
    await expect(page.getByText(`${accounts.ogretmen.name} hesabı pasifleştirildi.`)).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Hesabı etkinleştir' })).toBeVisible()
    await expect(panel.getByText('Pasif', { exact: true })).toBeVisible()

    await panel.getByRole('button', { name: 'Hesabı etkinleştir' }).click()
    await expect(page.getByText(`${accounts.ogretmen.name} hesabı etkinleştirildi.`)).toBeVisible()
    await expect(panel.getByText('Etkin', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(
      usersTable(page).getByRole('row', { name: new RegExp(accounts.ogretmen.name) }),
    ).toContainText('Ön Büro')
  })
})
