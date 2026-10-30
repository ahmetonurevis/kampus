import { expect, type Locator, type Page } from '@playwright/test'

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

/**
 * Her satır (ya da hücre) `texts`'in hepsini içerene dek bekler; en az bir satır olmalıdır.
 * Arama, süzgeç, sıralama, sayfa ve çocuk değişince eski sayfa yeni yanıt gelene kadar ekranda
 * kalır: `for (const row of await rows.all())` bu eski satırların anlık görüntüsünü alır ve
 * son satır sayısı farklıysa kararsızlaşır. Burada anlık görüntü son durumda yeniden okunur.
 * `exact`: hücre metni (kırpılmış) `texts[0]`'a eşit olmalıdır.
 */
export async function expectEveryRow(rows: Locator, texts: string | string[], exact = false) {
  const wanted = Array.isArray(texts) ? texts : [texts]
  await expect
    .poll(async () => {
      const cells = (await rows.allTextContents()).map((cell) => cell.trim())
      if (cells.length === 0) return 'satır yok'
      const bad = cells.find((cell) =>
        exact ? cell !== wanted[0] : !wanted.every((text) => cell.includes(text)),
      )
      return bad === undefined ? 'tamam' : `uymayan satır: ${bad.slice(0, 80)}`
    })
    .toBe('tamam')
}

/**
 * Özet kartlarının içeriği kartın içinde kalır: hiçbir alt öğe kartın sağ/alt kenarını aşmaz ve
 * hiçbir öğenin kendi içeriği kırpılmaz (`scrollWidth <= clientWidth`). Sayfa düzeyindeki yatay
 * taşma testi, `overflow: hidden` ile kırpılan ya da kart dışına sızan uzun tutarı yakalamaz.
 */
export async function expectContentInsideCards(cards: Locator) {
  await expect(cards.first()).toBeVisible()
  await expect
    .poll(() =>
      cards.evaluateAll((nodes) =>
        nodes.flatMap((card) => {
          const box = card.getBoundingClientRect()
          return [card, ...card.querySelectorAll('*')].flatMap((element) => {
            const rect = element.getBoundingClientRect()
            const outside =
              rect.width > 0 && (rect.right > box.right + 0.5 || rect.left < box.left - 0.5)
            const clipped = element.scrollWidth > element.clientWidth + 1
            return outside || clipped
              ? [
                  `${(card.textContent ?? '').trim().slice(0, 40)} › ${element.tagName.toLowerCase()}`,
                ]
              : []
          })
        }),
      ),
    )
    .toEqual([])
}
