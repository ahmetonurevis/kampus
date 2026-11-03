// Veli ve öğrenci ekranları dar ekranda (IST-127, OG-098). `dar-ekran` projesinde 360×740'ta koşar
// (playwright.react.config.ts). Rota listesi menü kaydından türetilir: yeni menü sayfası testten
// kaçmaz. Her rota açılır; yatay taşma olmadığı, sayfa başlığının göründüğü doğrulanır ve bir ana
// etkileşim yapılır (detay, sağ panel, açılan ayrıntı). Testler salt okunurdur: seed kurumunda
// sunucuya yazan işlem yapılmaz.
import type { Locator, Page } from '@playwright/test'

import { SECURITY_PATH, SECURITY_TITLE } from '../../apps/web-react/src/lib/account-pages.ts'
import {
  navigation,
  pageAvailableFor,
} from '../../packages/school-core/src/modules/full-navigation.ts'
import { accounts } from './support/env.ts'
import { expect, test } from './support/fixtures.ts'
import { accountMenuButton, expectNoHorizontalOverflow } from './support/ui.ts'

type FamilyRole = 'ogrenci' | 'veli'
const FAMILY_ROLES: readonly FamilyRole[] = ['ogrenci', 'veli']

/**
 * Ana etkileşim. Varsayılan `panel`: listenin ilk kayıt bağlantısı sağ paneli açar. Kayıt
 * bağlantısı olmayan sayfa aşağıdaki tabloda kendi etkileşimini bildirir; bildirmezse test
 * "kayıt bağlantısı yok" diye kırılır ve yeni sayfa için etkileşim eklenir.
 */
type Interaction =
  /** Düğme (verilmezse ilk kayıt bağlantısı) sağ panel/diyalog açar; ekrana sığar, Escape kapatır. */
  | { kind: 'panel'; open?: RegExp }
  /** Düğme/bağlantı (verilmezse ilk kayıt bağlantısı) adresi değiştirir: detay aynı sayfada açılır. */
  | { kind: 'url'; open?: RegExp; link?: true; url: RegExp }
  /** Dar ekran kartının "Diğer bilgiler" ayrıntısı açılır. */
  | { kind: 'details' }
  /** Düğme açılır kapanır alanı açar (`aria-expanded`). */
  | { kind: 'expand'; open: string }
  /** Düğme seçili duruma geçer (`aria-pressed`): sekme, tema. */
  | { kind: 'press'; open: string }
  /** Veli çocuk seçicisi: Ece'ye geçilir, sayfa onun kapsamında yeniden açılır. */
  | { kind: 'child' }
  /** Boş durumdaki sayfa: menü çekmecesi açılır, ekrana sığar ve bu sayfanın bağlantısı görünür. */
  | { kind: 'menu' }
  /** Hesap sayfası: avatar menüsü açılır, ekrana sığar ve bu sayfanın öğesi görünür. */
  | { kind: 'account' }

/** Kayıt bağlantısı olmayan ya da başka ana etkileşimi olan sayfalar (`rol/yol`, yoksa `yol`). */
const INTERACTIONS: Readonly<Record<string, Interaction>> = {
  'ogrenci/dashboard': { kind: 'url', open: /^Programı aç/, link: true, url: /\/ders-programi/ },
  'veli/dashboard': {
    kind: 'url',
    open: /^Programı aç/,
    link: true,
    url: /\/akademik-takip\?.*sekme=program/,
  },
  'ogrenci/ders-programi': { kind: 'panel', open: /Matematik/ },
  'ogrenci/videolar': { kind: 'panel', open: /videosunu/ },
  'ogrenci/mesajlar': { kind: 'url', open: /Selin Kaya/, url: /yazisma=/ },
  'ogrenci/seviye-takibi': { kind: 'menu' },
  'ogrenci/izin-formlari': { kind: 'menu' },
  // Öğrenci ödemeleri telefonda gösterilmez (CLAUDE.md); boş durum çizilir. Sayfa HESABIM
  // kategorisindedir: menüde değil avatar menüsündedir.
  'ogrenci/odemelerim': { kind: 'account' },
  'sinav-analizi': { kind: 'details' },
  ayarlar: { kind: 'press', open: 'Koyu' },
  'otomatik-etut': { kind: 'expand', open: 'Filtreler' },
  [SECURITY_PATH]: { kind: 'account' },
  'veli/cocuk-secici': {
    kind: 'url',
    open: /^Ece Yılmaz akademik takibini aç/,
    link: true,
    url: /\/akademik-takip/,
  },
  'veli/ogretmen-degerlendirmeleri': { kind: 'child' },
  'veli/seviye-takibi': { kind: 'child' },
  'veli/izin-formlari': { kind: 'child' },
  'veli/devamsizlik-bildirimi': { kind: 'panel', open: /^Yeni bildirim/ },
  'veli/materyaller': { kind: 'expand', open: 'Filtreler' },
  'veli/odeme-yap': {
    kind: 'url',
    open: /^Ödeme planını görüntüleyin/,
    link: true,
    url: /\/finans/,
  },
  'veli/sozlesmeler': { kind: 'panel', open: /^Sözleşmeyi görüntüle/ },
  'veli/randevu-mesaj': { kind: 'press', open: 'Randevular' },
  'veli/kayit-yenileme': { kind: 'expand', open: 'Filtreler' },
}

type FamilyRoute = { path: string; title: string; interaction: Interaction }

/** Akademi Özel Okulları (`school`) menüsü + avatar menüsündeki Güvenlik sayfası. */
function familyRoutes(role: FamilyRole): FamilyRoute[] {
  const pages = navigation[role]
    .filter((page) => pageAvailableFor(page, 'school'))
    .map((page) => ({ path: page.path, title: page.title }))
  return [...pages, { path: SECURITY_PATH, title: SECURITY_TITLE }].map((page) => ({
    ...page,
    interaction: INTERACTIONS[`${role}/${page.path}`] ??
      INTERACTIONS[page.path] ?? { kind: 'panel' },
  }))
}

/** Katman görünür ve viewport içinde (açılış hareketi bitene dek beklenir). */
async function expectInsideViewport(page: Page, layer: Locator) {
  await expect(layer).toBeVisible()
  const viewport = page.viewportSize()
  expect(viewport).not.toBeNull()
  await expect
    .poll(async () => {
      const box = await layer.boundingBox()
      if (!box || !viewport) return 'kutu yok'
      const inside =
        box.x >= -1 &&
        box.y >= -1 &&
        box.x + box.width <= viewport.width + 1 &&
        box.y + box.height <= viewport.height + 1
      return inside ? 'içeride' : `dışarıda: ${JSON.stringify(box)}`
    })
    .toBe('içeride')
}

/**
 * Kayıt bağlantısının erişilebilir adı sayfaya göre değişir (kayıt başlığı); ortak işareti
 * DataTable/CollectionList'in `record-link` sınıfıdır (ogretmen-ogrenci-profili.spec.ts de kullanır).
 */
function firstRecordLink(page: Page): Locator {
  return page.locator('main button.record-link:visible').first()
}

async function interact(page: Page, role: FamilyRole, route: FamilyRoute) {
  const main = page.locator('main')
  const { interaction } = route
  switch (interaction.kind) {
    case 'panel': {
      const opener = interaction.open
        ? main.getByRole('button', { name: interaction.open }).first()
        : firstRecordLink(page)
      await expect(opener, 'kayıt bağlantısı yok: INTERACTIONS tablosuna ekleyin').toBeVisible()
      await opener.click()
      const panel = page.getByRole('dialog')
      await expectInsideViewport(page, panel)
      await expectNoHorizontalOverflow(page)
      await page.keyboard.press('Escape')
      await expect(panel).toBeHidden()
      return
    }
    case 'url': {
      const opener = interaction.open
        ? main.getByRole(interaction.link ? 'link' : 'button', { name: interaction.open }).first()
        : firstRecordLink(page)
      await opener.click()
      await expect(page).toHaveURL(interaction.url)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expectNoHorizontalOverflow(page)
      return
    }
    case 'details': {
      const summary = main.locator('summary', { hasText: 'Diğer bilgiler' }).first()
      await summary.click()
      await expect(main.locator('details[open]').first()).toBeVisible()
      await expectNoHorizontalOverflow(page)
      return
    }
    case 'expand': {
      const button = main.getByRole('button', { name: interaction.open, exact: true })
      await button.click()
      await expect(button).toHaveAttribute('aria-expanded', 'true')
      await expectNoHorizontalOverflow(page)
      return
    }
    case 'press': {
      const button = main.getByRole('button', { name: interaction.open, exact: true })
      await button.click()
      await expect(button).toHaveAttribute('aria-pressed', 'true')
      await expectNoHorizontalOverflow(page)
      return
    }
    case 'child': {
      await page.getByLabel('Çocuk seç').selectOption({ label: 'Ece Yılmaz' })
      await expect(page).toHaveURL(/cocuk=s2/)
      await expect(page.getByRole('heading', { level: 1, name: route.title })).toBeVisible()
      await expectNoHorizontalOverflow(page)
      return
    }
    case 'menu': {
      await page.getByRole('button', { name: 'Menüyü aç' }).click()
      const drawer = page.getByRole('dialog', { name: 'Ana gezinme' })
      await expectInsideViewport(page, drawer)
      await expect(
        drawer.getByRole('navigation', { name: 'Menü' }).getByRole('link', { name: route.title }),
      ).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(drawer).toBeHidden()
      return
    }
    case 'account': {
      await accountMenuButton(page, accounts[role].name).click()
      const menu = page.getByRole('menu')
      await expectInsideViewport(page, menu)
      await expect(menu.getByRole('menuitem', { name: route.title })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(menu).toBeHidden()
      return
    }
    default:
      return interaction satisfies never
  }
}

for (const role of FAMILY_ROLES) {
  test.describe(`${accounts[role].label} dar ekranda (IST-127)`, () => {
    for (const route of familyRoutes(role)) {
      test(`${role}/${route.path} 360 px'te taşmadan açılır ve kullanılır`, async ({ loginAs }) => {
        const page = await loginAs(role)
        await page.goto(`/${role}/${route.path}`)
        await expect(page.getByRole('heading', { level: 1, name: route.title })).toBeVisible()
        // Dar ekranda menü hamburgerdedir; sabit sidebar çizilmez.
        await expect(page.getByRole('button', { name: 'Menüyü aç' })).toBeVisible()
        await expectNoHorizontalOverflow(page)
        await interact(page, role, route)
      })
    }
  })
}

test.describe('Yatay telefon (IST-127)', () => {
  test.use({ viewport: { width: 740, height: 360 } })

  for (const [role, path] of [
    ['ogrenci', 'odevler'],
    ['veli', 'kulupler'],
  ] as const) {
    test(`${role}/${path} tablo yerine kart düzenine geçer`, async ({ loginAs }) => {
      const page = await loginAs(role)
      await page.goto(`/${role}/${path}`)
      const record = firstRecordLink(page)
      await expect(record).toBeVisible()
      // Temel bilgiler kartta, kalanlar "Diğer bilgiler" ayrıntısında; tablo çizilmez.
      await expect(page.locator('main').getByRole('table')).toHaveCount(0)
      await expect(
        page.locator('main summary', { hasText: 'Diğer bilgiler' }).first(),
      ).toBeVisible()
      await expectNoHorizontalOverflow(page)
      await record.click()
      await expectInsideViewport(page, page.getByRole('dialog'))
    })
  }

  test('menü çekmecesi bütünüyle kayar, son kategoriye inilir', async ({ loginAs }) => {
    const page = await loginAs('veli')
    await page.goto('/veli/dashboard')
    await page.getByRole('button', { name: 'Menüyü aç' }).click()
    const drawer = page.getByRole('dialog', { name: 'Ana gezinme' })
    await expectInsideViewport(page, drawer)
    const last = drawer.getByRole('button', { name: 'Okul yaşamı' })
    await last.scrollIntoViewIfNeeded()
    await expect(last).toBeInViewport()
    await expect(drawer.getByRole('button', { name: 'Oturumu kapat' })).toBeAttached()
  })
})
