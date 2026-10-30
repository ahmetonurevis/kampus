import { accounts, roles } from './support/env.ts'
import { expect, test } from './support/fixtures.ts'
import {
  loginThroughForm,
  signOutThroughMenu,
  submitLoginForm,
  accountMenuButton,
} from './support/ui.ts'

const ROLE_PANEL: Record<(typeof roles)[number], string> = {
  yonetici: 'Yönetici Paneli',
  onburo: 'Ön Büro & Satış Paneli',
  ogretmen: 'Öğretmen Paneli',
  ogrenci: 'Öğrenci Paneli',
  veli: 'Veli Paneli',
}

test.describe('giriş ve çıkış', () => {
  for (const role of roles) {
    test(`${role}: giriş, rol ana sayfası, çıkış`, async ({ page }) => {
      const { name } = accounts[role]
      await loginThroughForm(page, role)

      // Veli adresine seçili çocuk `?cocuk=` ile tamamlanır (RoleShell).
      await expect(page).toHaveURL(new RegExp(`/${role}/dashboard(\\?cocuk=[^&]+)?$`))
      await expect(page.getByRole('heading', { level: 1, name: 'Genel Bakış' })).toBeVisible()
      await expect(page.getByText(ROLE_PANEL[role])).toBeVisible()
      await expect(accountMenuButton(page, name)).toBeVisible()

      await signOutThroughMenu(page, name)
      // Bilinçli çıkışta dönüş adresi (`?donus=`) olmaz.
      await expect(page).toHaveURL(/\/giris$/)
      await expect(page.getByRole('button', { name: 'Giriş yap' })).toBeVisible()

      // Oturum gerçekten kapandı: korumalı adres yeniden girişe götürür.
      await page.goto(`/${role}/dashboard`)
      await expect(page).toHaveURL(/\/giris\?donus=/)
    })
  }

  test('yanlış parola Türkçe hata gösterir ve girişte kalır', async ({ page }) => {
    await page.goto('/giris')
    await submitLoginForm(page, accounts.ogrenci.email, 'Yanlis-Parola-2026!')

    await expect(page.getByText('E-posta veya parola hatalı.')).toBeVisible()
    await expect(page).toHaveURL(/\/giris$/)
    await expect(page.getByRole('button', { name: 'Giriş yap' })).toBeEnabled()
  })

  test('boş form alan hatalarını gösterir', async ({ page }) => {
    await page.goto('/giris')
    await page.getByRole('button', { name: 'Giriş yap' }).click()
    await expect(page).toHaveURL(/\/giris$/)
    await expect(page.getByLabel('E-posta')).toHaveAttribute('aria-invalid', 'true')
  })
})
