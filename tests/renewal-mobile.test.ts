import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { renewalRow, type RenewalListItem } from '../packages/react-shared/src/renewal-model.ts'
import { EMPTY_LIST_STATE } from '../apps/mobile/src/api/list-state.ts'
import { screenRegistryIssues } from '../apps/mobile/src/api/pages.ts'
import {
  canOpenRenewals,
  RENEWAL_STATUS_OPTIONS,
  renewalListItem,
  renewalListQuery,
} from '../apps/mobile/src/api/renewal-mobile.ts'
import { listRefreshing } from '../apps/mobile/src/api/finance-list.ts'
import { RENEWALS_SCREEN } from '../apps/mobile/src/api/renewal-screen.ts'
import { SCREEN_REGISTRY, type ScreenEntry } from '../apps/mobile/src/api/screen-registry.ts'

const modules = (patch: Record<string, boolean> = {}) => ({
  renewal: true,
  finance: true,
  ...patch,
})

describe('mobil kayıt yenileme (ON-122)', () => {
  test('ON-122 kayıt satırı kurallara uyar: yönetici ve ön büro, veli yok', () => {
    const entries: readonly ScreenEntry[] = [...SCREEN_REGISTRY, RENEWALS_SCREEN]
    const unique = entries.filter(
      (entry, at) => entries.findIndex((item) => item.screen === entry.screen) === at,
    )
    assert.deepEqual(screenRegistryIssues(unique), [])
    assert.deepEqual(
      RENEWALS_SCREEN.pages.map((page) => `${page.role}/${page.path}`),
      ['yonetici/kayit-yenileme', 'onburo/kayit-yenileme'],
    )
  })

  test('ON-122 kayıt satırı var olan ve varsayılan bileşen veren ekran dosyasını yükler', () => {
    const path = /require\('(\.\/screens\/[\w-]+\.tsx)'\)\.default/.exec(
      RENEWALS_SCREEN.getComponent.toString(),
    )?.[1]
    assert.ok(path)
    const url = new URL(`../apps/mobile/src/api/${path}`, import.meta.url)
    assert.ok(existsSync(url))
    assert.match(readFileSync(url, 'utf8'), /^export default function StaffRenewals\(/m)
  })

  test('DOM-YTK-040, DOM-YTK-012: renewal ve finance modülü açıkken yalnız personele açılır', () => {
    assert.equal(canOpenRenewals({ role: 'yonetici', modules: modules() }), true)
    assert.equal(canOpenRenewals({ role: 'onburo', modules: modules() }), true)
    assert.equal(canOpenRenewals({ role: 'onburo', modules: modules({ renewal: false }) }), false)
    assert.equal(canOpenRenewals({ role: 'onburo', modules: modules({ finance: false }) }), false)
    assert.equal(canOpenRenewals({ role: 'veli', modules: modules() }), false)
    assert.equal(canOpenRenewals({ role: 'ogretmen', modules: modules() }), false)
  })

  test('IST-100: liste sorgusu arama ve durumu sunucuya verir; kısa arama ve bilinmeyen durum gitmez', () => {
    assert.deepEqual(renewalListQuery(EMPTY_LIST_STATE, ''), { page: 1, pageSize: 10 })
    assert.deepEqual(renewalListQuery({ search: '', index: 1, filter: 'Planlandı' }, ' Deniz '), {
      page: 2,
      pageSize: 10,
      q: 'Deniz',
      status: 'Planlandı',
    })
    assert.deepEqual(
      renewalListQuery({ search: '', index: 0, filter: 'uydurma' }, 'D'),
      renewalListQuery(EMPTY_LIST_STATE, ''),
    )
    assert.deepEqual(
      RENEWAL_STATUS_OPTIONS.map((option) => option.value),
      ['', 'Planlandı', 'Tamamlandı', 'Mezun', 'İptal'],
    )
  })

  test('DOM-KAY-020: liste satırı dönem, sınıf geçişi ve net bedeli taşır', () => {
    const item = {
      id: 'ren-1',
      version: 1,
      createdAt: '2026-06-01T09:00:00.000Z',
      studentId: 'st-1',
      studentName: 'Ece Yılmaz',
      fromClassId: 'c-12a',
      fromClassName: '12-A',
      targetClassId: null,
      targetClassName: null,
      academicYear: 2027,
      mode: 'graduate',
      status: 'Planlandı',
      netCents: 0,
      tuitionCents: null,
      discountCents: null,
      scholarshipCents: null,
      contractId: null,
      activatedAt: null,
    } as RenewalListItem
    assert.deepEqual(renewalListItem(renewalRow(item)), {
      title: 'Ece Yılmaz',
      subtitle: '2027–2028 · 12-A → Mezuniyet',
      eyebrow: '0,00 ₺',
      status: 'Planlandı',
      label: 'Ece Yılmaz, 2027–2028, 12-A → Mezuniyet, Planlandı, ayrıntıyı aç',
    })
  })

  test('ON-321, IST-100: önceki sayfa yer tutucuyken ve tazelenirken liste soluk; ilk yüklemede değil', () => {
    const state = (patch: Partial<Parameters<typeof listRefreshing>[0]> = {}) => ({
      isPlaceholderData: false,
      isFetching: false,
      isPending: false,
      ...patch,
    })
    // Sayfa, arama ya da süzgeç değişti: eski satırlar yeni yanıt gelene kadar soluk kalır (ON-319).
    assert.equal(listRefreshing(state({ isPlaceholderData: true, isFetching: true })), true)
    // Aynı sayfanın arka plan tazelemesi de web gibi soluk gösterilir.
    assert.equal(listRefreshing(state({ isFetching: true })), true)
    // İlk yükleme satırsızdır, "yükleniyor" durumu ayrıca gösterilir.
    assert.equal(listRefreshing(state({ isPending: true, isFetching: true })), false)
    assert.equal(listRefreshing(state()), false)
  })

  test('ON-321: ekran tazelenen satırları soluk ve meşgul işaretler, tazelemeyi duyurur', () => {
    const url = new URL('../apps/mobile/src/api/screens/renewal-list.tsx', import.meta.url)
    const source = readFileSync(url, 'utf8')
    assert.match(source, /listRefreshing\(renewals\)/)
    assert.match(source, /accessibilityState=\{\{ busy: refreshing \}\}/)
    assert.match(source, /opacity: refreshing \? /)
    assert.match(source, /accessibilityLiveRegion="polite"/)
  })
})
