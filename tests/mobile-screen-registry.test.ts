import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { navigation } from '../packages/school-core/src/modules/full-navigation.ts'
import {
  RESERVED_SCREENS,
  apiCategories,
  apiPages,
  canOpenScreen,
  loadScreenComponent,
  screenRegistryIssues,
} from '../apps/mobile/src/api/pages.ts'
import {
  SCREEN_REGISTRY,
  type ApiScreen,
  type MenuScreen,
  type ScreenEntry,
} from '../apps/mobile/src/api/screen-registry.ts'

const ROLES = ['yonetici', 'onburo', 'ogretmen', 'ogrenci', 'veli'] as const
const ALL_OPEN: Record<string, boolean> = {}
// Testte bileşen yüklenmez; kayıt yalnız ad ve yerleşimle sınanır.
const noComponent = (): MenuScreen => {
  throw new Error('Testte bileşen yüklenmez')
}
const entry = (screen: string, pages: ScreenEntry['pages']): ScreenEntry => ({
  screen,
  getComponent: noComponent,
  pages,
})
const registry: readonly ScreenEntry[] = SCREEN_REGISTRY

/**
 * Varsayılan dışa aktarım bir bileşen olmalı: adlı fonksiyon/sınıf, `memo(`/`forwardRef(` sarması ya
 * da PascalCase bileşen adı. `export default {}` ya da küçük harfli değer geçmez.
 */
const DEFAULT_COMPONENT_EXPORT =
  /^export default (?:function [A-Z]\w*\s*\(|class [A-Z]\w*|(?:memo|forwardRef)\(|[A-Z]\w*;?\s*$)/m

describe('IST-124 mobil ekran kaydı', () => {
  test('IST-124 gerçek kayıt kurallara uyar', () => {
    assert.deepEqual(screenRegistryIssues(registry), [])
    for (const item of registry) assert.equal(typeof item.getComponent, 'function', item.screen)
  })

  test('IST-124 her kayıt var olan ve varsayılan bileşen veren ekran dosyasını yükler', () => {
    // Bileşen Node'da yüklenemez (React Native); `getComponent` kaynağındaki yol denetlenir.
    for (const item of registry) {
      const path = /require\('(\.\/screens\/[\w-]+\.tsx)'\)\.default/.exec(
        item.getComponent.toString(),
      )?.[1]
      assert.ok(
        path,
        `${item.screen}: getComponent require('./screens/<dosya>.tsx').default olmalı`,
      )
      const url = new URL(`../apps/mobile/src/api/${path}`, import.meta.url)
      assert.ok(existsSync(url), `${item.screen}: ${path} yok`)
      assert.match(readFileSync(url, 'utf8'), DEFAULT_COMPONENT_EXPORT, item.screen)
    }
  })

  test('IST-124 varsayılan dışa aktarım denetimi bileşen olmayanı geçirmez', () => {
    for (const source of [
      'export default function ParentFinance() {}',
      'export default function ParentFinance({ route }: Props) {}',
      'export default memo(ParentFinance)',
      'const A = () => null\nexport default ParentFinance',
    ])
      assert.match(source, DEFAULT_COMPONENT_EXPORT, source)
    for (const source of [
      'export default {}',
      'export default { screen: 1 }',
      'export default function () {}',
      'export default parentFinance',
      'export const ParentFinance = () => null',
    ])
      assert.doesNotMatch(source, DEFAULT_COMPONENT_EXPORT, source)
  })

  test('IST-124 ekran bileşeni bir kez yüklenir; hata saklanmaz, yeniden denenir', () => {
    const Screen = (() => null) as MenuScreen
    let calls = 0
    const ok = {
      screen: 'TestLoadOnce',
      getComponent: () => {
        calls += 1
        return Screen
      },
    }
    assert.equal(loadScreenComponent(ok), Screen)
    assert.equal(loadScreenComponent(ok), Screen)
    assert.equal(calls, 1)

    let attempts = 0
    const missing = {
      screen: 'TestMissingDefault',
      getComponent: () => {
        attempts += 1
        // `require(...).default` eksikse `undefined` döner.
        return (attempts < 3 ? undefined : Screen) as MenuScreen
      },
    }
    assert.throws(() => loadScreenComponent(missing), /varsayılan bileşen bulunamadı/)
    assert.throws(() => loadScreenComponent(missing), /varsayılan bileşen bulunamadı/)
    assert.equal(loadScreenComponent(missing), Screen)
    assert.equal(attempts, 3)

    const failing = {
      screen: 'TestRequireFails',
      getComponent: (): MenuScreen => {
        throw new Error('modül yüklenemedi')
      },
    }
    assert.throws(() => loadScreenComponent(failing), /modül yüklenemedi/)
  })

  test('IST-124 her kayıt menüye ve ekran listesine yansır, kayıt dışı sayfa görünmez', () => {
    for (const role of ROLES) {
      const expected = registry.flatMap((item) =>
        item.pages
          .filter((placement) => placement.role === role)
          .map((placement) => [placement.path, item.screen]),
      )
      const actual = apiPages({ role, modules: ALL_OPEN }).map((page) => [page.path, page.screen])
      assert.deepEqual(
        [...actual].sort(),
        [...expected].sort(),
        `${role}: menü kayıtla aynı ekranları açar`,
      )
      // Sıra kaydın değil ortak menünün sırasıdır.
      const menuOrder = navigation[role].map((page) => page.path)
      const positions = actual.map(([path]) => menuOrder.indexOf(path ?? ''))
      assert.deepEqual(
        positions,
        [...positions].sort((a, b) => a - b),
        role,
      )
    }
  })

  test('IST-124 başlık geçersiz kılması yalnız kendi rolüne uygulanır', () => {
    const studentHomework = apiPages({ role: 'ogrenci', modules: ALL_OPEN }).find(
      (page) => page.screen === 'StudentHomework',
    )
    assert.equal(studentHomework?.title, 'Ödevlerim')
    const parentAnnouncements = apiPages({ role: 'veli', modules: ALL_OPEN }).find(
      (page) => page.screen === 'Announcements',
    )
    const menuPage = navigation.veli.find((page) => page.path === 'duyurular')
    assert.equal(parentAnnouncements?.description, menuPage?.description)
  })

  test('IST-124 kapalı modülde kart, kategori ve ekran kapanır', () => {
    for (const item of registry)
      for (const placement of item.pages) {
        const page = navigation[placement.role].find((nav) => nav.path === placement.path)
        if (!page?.module) continue
        const modules = { [page.module]: false }
        const pages = apiPages({ role: placement.role, modules })
        assert.ok(!pages.some((open) => open.path === placement.path), placement.path)
        // Kategori yalnız açık sayfası kalırsa görünür.
        for (const category of apiCategories(pages))
          assert.ok(
            pages.some((open) => open.group === category.key),
            category.key,
          )
        const otherOpen = pages.some((open) => open.screen === item.screen)
        assert.equal(
          canOpenScreen({ role: placement.role, modules }, item.screen as ApiScreen),
          otherOpen,
          `${placement.role}/${placement.path}`,
        )
      }
  })

  test('IST-124 öğrenci ödeme ekranı kaydı reddedilir, veli finans kaydı geçer', () => {
    assert.deepEqual(
      screenRegistryIssues([entry('StudentPayments', [{ role: 'ogrenci', path: 'odemelerim' }])]),
      ['ogrenci/odemelerim: öğrenci ödemeleri telefonda gösterilmez'],
    )
    assert.deepEqual(
      screenRegistryIssues([entry('ParentFinance', [{ role: 'veli', path: 'finans' }])]),
      [],
    )
    // Gerçek kayıtta öğrenciye ödeme sayfası yoktur.
    assert.ok(
      !apiPages({ role: 'ogrenci', modules: ALL_OPEN }).some((page) => page.path === 'odemelerim'),
    )
  })

  test('IST-124 aynı rol + yolun ikinci kaydı ve yinelenen ekran adı reddedilir', () => {
    // Yapay kayıt: gerçek kayda yeni ekran eklendikçe beklenen ihlal listesi değişmesin.
    const grades = entry('Grades', [{ role: 'veli', path: 'akademik-takip' }])
    assert.deepEqual(
      screenRegistryIssues([
        grades,
        entry('GradesCopy', [{ role: 'veli', path: 'akademik-takip' }]),
      ]),
      ['veli/akademik-takip: iki ekrana bağlanmış (Grades, GradesCopy)'],
    )
    // Aynı ekran başka rolde de açılabilir; ikinci kayıt değil, yerleşim eklenir.
    assert.deepEqual(
      screenRegistryIssues([grades, entry('Grades', [{ role: 'ogrenci', path: 'notlarim' }])]),
      ['Grades: ekran adı iki kez kaydedilmiş'],
    )
    // Gerçek kayıttaki bir yolu ikinci kez bağlamak da reddedilir.
    assert.ok(
      screenRegistryIssues([
        ...registry,
        entry('ClassesCopy', [{ role: 'ogretmen', path: 'siniflarim' }]),
      ]).includes('ogretmen/siniflarim: iki ekrana bağlanmış (TeacherClasses, ClassesCopy)'),
    )
  })

  test('IST-124 menüde olmayan yol, ayrılmış ad ve boş yerleşim reddedilir', () => {
    assert.deepEqual(
      screenRegistryIssues([entry('Ghost', [{ role: 'veli', path: 'yok-boyle-sayfa' }])]),
      ['veli/yok-boyle-sayfa: rolün menüsünde böyle bir sayfa yok'],
    )
    assert.deepEqual(screenRegistryIssues([entry('ApiHome', [{ role: 'veli', path: 'finans' }])]), [
      'ApiHome: ayrılmış ekran adı kullanılamaz',
    ])
    assert.deepEqual(screenRegistryIssues([entry('Empty', [])]), ['Empty: menü sayfası yok'])
  })

  test('IST-124 gezinme yığını menü ekranlarını yalnız kayıttan kurar', () => {
    const source = readFileSync(
      new URL('../apps/mobile/src/api/ApiApp.tsx', import.meta.url),
      'utf8',
    )
    assert.match(source, /SCREEN_REGISTRY\.map\(/)
    const fixedNames = [...source.matchAll(/<Stack\.Screen name="([^"]+)"/g)].map(
      (match) => match[1],
    )
    assert.deepEqual(fixedNames.sort(), [...RESERVED_SCREENS].sort())
    // Ekran dosyaları elle içe aktarılmaz; kayıt `getComponent` ile yükler.
    for (const item of registry)
      assert.doesNotMatch(source, new RegExp(`from './screens/${item.screen}\\.tsx'`), item.screen)
  })
})
