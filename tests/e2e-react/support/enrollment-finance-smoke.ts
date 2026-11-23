import { expect, type Locator, type Page } from '@playwright/test'

import { expectNoHorizontalOverflow } from './ui.ts'

// Kayıt ve finans duman testlerinin (ON-047, ON-048) ortak yardımcıları. Duman testi kural
// dallarını yinelemez (ayrıntılı testler adaylar/kayit-islemleri/finans/odemeler-aile/
// is-akislari-yenileme/contract-approval spec'lerindedir): sayfa açılır, temel liste yüklenir,
// konsolda hata ve yatay taşma olmaz.

/**
 * Sözleşmesi gereği 4xx dönen ve arayüzün olağan durum olarak işlediği istekler. Tarayıcı bunları
 * yine konsola yazar; liste dar tutulur, her satır gerekçesini taşır.
 * - `GET /consent-texts/:purpose` metni yayımlanmamış amaçta 404 `consent_text_not_found` verir;
 *   kesin kayıt rıza notu bunu "metni yok" diye gösterir (DOM-YTK-057, DOM-YTK-058).
 */
const EXPECTED_FAILURES: readonly RegExp[] = [/status of 404 .*\/api\/v1\/consent-texts\/[a-z_]+$/]

/**
 * Sayfanın konsol hatalarını ve yakalanmamış istisnalarını toplar. Dizi testin sonunda boş
 * olmalıdır (`expect(errors).toEqual([])`); 4xx/5xx yanıtları da tarayıcıda konsol hatası
 * olarak düştüğü için başarısız istek de yakalanır.
 */
export function watchConsole(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    // Başarısız istekte konsol metni yalnız durumu söyler; kaynak adresi `location`'dadır.
    const source = message.location().url
    if (EXPECTED_FAILURES.some((pattern) => pattern.test(`${message.text()} ${source}`))) return
    errors.push(`${new URL(page.url()).pathname} › ${message.text()} › ${source}`)
  })
  page.on('pageerror', (error) => errors.push(`${page.url()} › ${error.message}`))
  return errors
}

export interface SmokePage {
  /** Rol önekli adres (`/onburo/adaylar`). */
  path: string
  /** Sayfanın birinci düzey başlığı (menü başlığı). */
  heading: string | RegExp
  /** Temel içeriğin yüklendiğini gösteren öğe (ör. tablonun ilk dolu satırı). */
  ready: (page: Page) => Locator
}

/** Sayfaları sırayla açar: başlık, temel liste ve yatay taşma denetlenir. */
export async function sweepPages(page: Page, pages: readonly SmokePage[]) {
  for (const item of pages) {
    await page.goto(item.path)
    await expect(
      page.getByRole('heading', { level: 1, name: item.heading }),
      item.path,
    ).toBeVisible()
    await expect(item.ready(page), `${item.path}: temel içerik`).toBeVisible()
    await expectNoHorizontalOverflow(page)
  }
}

/** Adlı tablonun, verilen metni taşıyan ilk gövde satırı (yükleme iskeleti metin taşımaz). */
export const tableRow = (page: Page, table: string, text: string | RegExp = /\S/) =>
  page
    .getByRole('table', { name: table, exact: true })
    .locator('tbody tr')
    .filter({ hasText: text })
    .first()

export const toast = (page: Page, text: string) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text })

/** Menüde verilen sayfaların hiçbiri yoktur (rolün görmediği alan). */
export async function expectMenuWithout(page: Page, links: readonly string[]) {
  const menu = page.getByRole('navigation', { name: 'Menü' })
  await expect(menu.getByRole('link', { name: 'Genel Bakış' })).toBeVisible()
  for (const name of links)
    await expect(menu.getByRole('link', { name, exact: true }), name).toHaveCount(0)
}

/** `days` gün sonrasının İstanbul günü (`YYYY-MM-DD`); tarih alanına yazılır. */
export const istanbulDay = (days: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(
    new Date(Date.now() + days * 86_400_000),
  )
