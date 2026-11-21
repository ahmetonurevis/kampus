import { accounts, e2e } from './support/env.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow, submitLoginForm } from './support/ui.ts'

test.describe('korumalı rotalar ve sayfa durumları', () => {
  test('oturumsuz korumalı rota girişe ?donus= ile yönlendirir, girişten sonra geri döner', async ({
    page,
  }) => {
    await page.goto('/ogretmen/ders-programi')
    await expect(page).toHaveURL(/\/giris\?donus=%2Fogretmen%2Fders-programi$/)

    await submitLoginForm(page, accounts.ogretmen.email, e2e.password)

    await expect(page).toHaveURL(/\/ogretmen\/ders-programi$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Ders Programım' })).toBeVisible()
  })

  test('başka rolün adresi girişten sonra kendi ana sayfasına gider', async ({ page }) => {
    await page.goto('/yonetici/finans')
    await expect(page).toHaveURL(/\/giris\?donus=%2Fyonetici%2Ffinans$/)

    await submitLoginForm(page, accounts.ogrenci.email, e2e.password)

    await expect(page).toHaveURL(/\/ogrenci\/dashboard$/)
  })

  test('oturumlu kullanıcı kendi rolünün sayfasını doğrudan açar', async ({ page, loginAs }) => {
    await loginAs('yonetici')
    await page.goto('/yonetici/finans')
    await expect(page.getByRole('heading', { level: 1, name: 'Finans & Tahsilat' })).toBeVisible()
  })

  test('bilinmeyen adres 404 sayfasını gösterir', async ({ page }) => {
    await page.goto('/yok-boyle-bir-sayfa/ve-alt-yol')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Bu sayfa kampüste bulunamadı.' }),
    ).toBeVisible()
    await page.getByRole('link', { name: 'Ana sayfaya dön' }).click()
    await expect(page).toHaveURL(/\/giris$/)
  })

  test('oturumlu kullanıcıda rol içi bilinmeyen sayfa 404 gösterir', async ({ page, loginAs }) => {
    await loginAs('veli')
    await page.goto('/veli/olmayan-sayfa')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Bu sayfa kampüste bulunamadı.' }),
    ).toBeVisible()
  })

  test.describe('390 px genişlik', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('giriş sayfasında yatay taşma yok', async ({ page }) => {
      await page.goto('/giris')
      await expect(page.getByRole('button', { name: 'Giriş yap' })).toBeVisible()
      await expectNoHorizontalOverflow(page)
    })

    test('404 sayfasında yatay taşma yok', async ({ page }) => {
      await page.goto('/yok-boyle-bir-sayfa')
      await expect(page.getByRole('link', { name: 'Ana sayfaya dön' })).toBeVisible()
      await expectNoHorizontalOverflow(page)
    })

    for (const role of ['yonetici', 'veli'] as const) {
      test(`${role} ana sayfasında yatay taşma yok`, async ({ page, loginAs }) => {
        await loginAs(role)
        await page.goto(`/${role}/dashboard`)
        await expect(page.getByRole('heading', { level: 1, name: 'Genel Bakış' })).toBeVisible()
        await expectNoHorizontalOverflow(page)
      })
    }
  })
})
