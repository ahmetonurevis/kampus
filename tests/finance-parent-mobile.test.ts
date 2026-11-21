import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { ApiError } from '../packages/api-client/src/errors.ts'
import { EMPTY_LIST_STATE } from '../apps/mobile/src/api/list-state.ts'
import {
  canOpenParentFinance,
  familyInvoiceQuery,
  isFinanceOutOfScope,
  pageSlice,
  PARENT_FINANCE_PATH,
  PARENT_RECEIPTS_PATH,
} from '../apps/mobile/src/api/finance-parent.ts'
import {
  PARENT_FINANCE_SCREEN,
  PARENT_RECEIPTS_SCREEN,
} from '../apps/mobile/src/api/finance-screen.ts'
import { screenRegistryIssues } from '../apps/mobile/src/api/pages.ts'
import { SCREEN_REGISTRY, type ScreenEntry } from '../apps/mobile/src/api/screen-registry.ts'

const apiError = (status: number, code: string) =>
  new ApiError({ status, code, message: 'Sunucu iletisi' })

describe('ON-078 IST-124 mobil veli finans', () => {
  test('IST-124 ekranlar yalnız velide ve finans modülü açıkken açılır', () => {
    for (const path of [PARENT_FINANCE_PATH, PARENT_RECEIPTS_PATH] as const) {
      assert.equal(canOpenParentFinance({ role: 'veli', modules: {} }, path), true, path)
      assert.equal(
        canOpenParentFinance({ role: 'veli', modules: { finance: false } }, path),
        false,
        path,
      )
      // Öğrenci ödemeleri telefonda gösterilmez; görevlinin finans ekranı ayrıdır.
      for (const role of ['ogrenci', 'ogretmen', 'yonetici', 'onburo'] as const)
        assert.equal(canOpenParentFinance({ role, modules: {} }, path), false, `${role}/${path}`)
    }
  })

  test('DOM-FIN-052 taksit sorgusu seçili çocuğa daralır, durum ve sayfa sunucuya gider', () => {
    assert.deepEqual(familyInvoiceQuery('s1', EMPTY_LIST_STATE), {
      page: 1,
      pageSize: 10,
      sort: ['dueDate', 'id'],
      filters: { studentId: 's1' },
    })
    assert.deepEqual(
      familyInvoiceQuery('s1', { ...EMPTY_LIST_STATE, index: 2, filter: 'gecikmis' }),
      {
        page: 3,
        pageSize: 10,
        sort: ['dueDate', 'id'],
        filters: { studentId: 's1', status: 'Gecikmiş' },
      },
    )
    // Bilinmeyen süzgeç sunucuya gönderilmez.
    assert.deepEqual(familyInvoiceQuery('s1', { ...EMPTY_LIST_STATE, filter: 'x' }).filters, {
      studentId: 's1',
    })
  })

  test('DOM-FIN-052 kapsam dışı öğrenci boş durumdur, kapalı modül ve ağ hatası değildir', () => {
    assert.equal(isFinanceOutOfScope(apiError(404, 'not_found')), true)
    assert.equal(isFinanceOutOfScope(apiError(403, 'forbidden')), true)
    assert.equal(isFinanceOutOfScope(apiError(403, 'module_disabled')), false)
    assert.equal(isFinanceOutOfScope(apiError(500, 'internal_error')), false)
    assert.equal(isFinanceOutOfScope(apiError(0, 'network_error')), false)
  })

  test('IST-124 istemci sayfası listeyi sayfa boyuyla böler', () => {
    const items = Array.from({ length: 23 }, (_, index) => index)
    assert.deepEqual(pageSlice(items, 0), items.slice(0, 10))
    assert.deepEqual(pageSlice(items, 2), [20, 21, 22])
    assert.deepEqual(pageSlice(items, 3), [])
  })
})

describe('ON-078 IST-124 mobil ekran kaydı satırları', () => {
  const entries: readonly ScreenEntry[] = [PARENT_FINANCE_SCREEN, PARENT_RECEIPTS_SCREEN]

  test('IST-124 satırlar kayda eklenince kurallara uyar; yalnız velide', () => {
    const merged = [...SCREEN_REGISTRY, ...entries]
    const unique = merged.filter(
      (entry, at) => merged.findIndex((item) => item.screen === entry.screen) === at,
    )
    assert.deepEqual(screenRegistryIssues(unique), [])
    assert.deepEqual(
      entries.flatMap((entry) => entry.pages.map((page) => `${page.role}/${page.path}`)),
      ['veli/finans', 'veli/dekontlar'],
    )
  })

  test('IST-124 satırlar var olan ve varsayılan bileşen veren ekran dosyalarını yükler', () => {
    const expected = [
      ['./screens/finance-parent.tsx', 'ParentFinance'],
      ['./screens/finance-parent-receipts.tsx', 'ParentReceipts'],
    ] as const
    entries.forEach((entry, at) => {
      const path = /require\('(\.\/screens\/[\w-]+\.tsx)'\)\.default/.exec(
        entry.getComponent.toString(),
      )?.[1]
      const [file, component] = expected[at]!
      assert.equal(path, file)
      assert.equal(entry.screen, component)
      const url = new URL(`../apps/mobile/src/api/${file}`, import.meta.url)
      assert.ok(existsSync(url))
      assert.match(
        readFileSync(url, 'utf8'),
        new RegExp(`^export default function ${component}\\(`, 'm'),
      )
    })
  })

  test('ON-322, IST-124: taksit listesi tazelenirken önceki sayfa soluk ve meşgul, tazeleme duyurulur', () => {
    const url = new URL('../apps/mobile/src/api/screens/finance-parent.tsx', import.meta.url)
    const source = readFileSync(url, 'utf8')
    // Kayıt Yenileme listesiyle (ON-321) aynı karar ve gösterge.
    assert.match(source, /const refreshing = listRefreshing\(list\)/)
    assert.match(source, /accessibilityState=\{\{ busy: refreshing \}\}/)
    assert.match(source, /opacity: refreshing \? /)
    assert.match(source, /accessibilityLiveRegion="polite"/)
    assert.match(source, /'Taksitler güncelleniyor…'/)
  })

  test('ON-323, ON-078: dekont listesi tazelenirken satırlar soluk ve meşgul, tazeleme duyurulur', () => {
    const url = new URL(
      '../apps/mobile/src/api/screens/finance-parent-receipts.tsx',
      import.meta.url,
    )
    const source = readFileSync(url, 'utf8')
    assert.match(source, /const refreshing = listRefreshing\(payments\)/)
    assert.match(source, /accessibilityState=\{\{ busy: refreshing \}\}/)
    assert.match(source, /opacity: refreshing \? /)
    assert.match(source, /accessibilityLiveRegion="polite"/)
    assert.match(source, /'Tahsilatlar güncelleniyor…'/)
  })
})
