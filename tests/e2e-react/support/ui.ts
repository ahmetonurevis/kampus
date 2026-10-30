import { expect, type Page } from '@playwright/test'

import { accounts, e2e, type RoleKey } from './env.ts'

/** Giriş formunu arayüzden doldurur ve gönderir (yalnız giriş akışının kendisini sınayan testlerde). */
export async function submitLoginForm(page: Page, email: string, password: string) {
  await page.getByLabel('E-posta').fill(email)
  await page.getByLabel('Parola').fill(password)
  await page.getByRole('button', { name: 'Giriş yap' }).click()
}

export async function loginThroughForm(page: Page, role: RoleKey) {
  await page.goto('/giris')
  await submitLoginForm(page, accounts[role].email, e2e.password)
}

/** Sağ üstteki avatar menüsü; erişilebilir adı kullanıcı adını içerir. */
export function accountMenuButton(page: Page, name: string) {
  return page.getByRole('button', { name: `Hesap menüsü: ${name}` })
}

export async function signOutThroughMenu(page: Page, name: string) {
  await accountMenuButton(page, name).click()
  await page.getByRole('menuitem', { name: 'Oturumu kapat' }).click()
}

/** Çok kurumlu hesapta avatar menüsünden kurum değiştirir (oturumu değiştirir: `fresh` oturum kullanın). */
export async function switchInstitutionThroughMenu(page: Page, userName: string, target: string) {
  await accountMenuButton(page, userName).click()
  await page.getByRole('menuitemradio', { name: new RegExp(target) }).click()
}

/** Sayfada yatay kaydırma çıkaran öğe yoksa geçer. */
export async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(0)
}
