import assert from 'node:assert/strict'
import test from 'node:test'
import {
  navigation,
  pageAvailableFor,
  TRIAL_RESULTS_PAGE,
} from '../packages/school-core/src/modules/full-navigation.ts'
import { navigation as demoNavigation } from '../apps/web/src/modules/navigation.js'
import type { Role } from '../packages/school-core/src/modules/navigation.ts'

const roleKeys = Object.keys(navigation) as Role[]

test('ON-279, DOM-DIL-031, DOM-YTK-080: Deneme Dersleri yalnız öğretmende, dil okulunda ve crm modülünde', () => {
  for (const role of roleKeys) {
    const pages = navigation[role].filter((page) => page.path === TRIAL_RESULTS_PAGE.path)
    if (role !== 'ogretmen') {
      assert.deepEqual(pages, [], `${role} deneme sonucu yazamaz (403)`)
      continue
    }
    assert.equal(pages.length, 1)
    const [page] = pages
    assert.ok(page)
    assert.deepEqual(
      [page.title, page.group, page.module, page.apiOnly],
      ['Deneme Dersleri', 'AKADEMİK', 'crm', true],
    )
    // Okulda deneme dersi yoktur; öğretmen aday koleksiyonuna erişemez.
    assert.equal(pageAvailableFor(page, 'school'), false)
    assert.equal(pageAvailableFor(page, 'language_school'), true)
  }
})

test('ON-279: sayfa AKADEMİK kategorisini bölmez ve dil okulu sayfalarından önce gelir; Vue demosunda yoktur', () => {
  const pages = navigation.ogretmen
  const at = pages.findIndex((page) => page.path === TRIAL_RESULTS_PAGE.path)
  const groups = pages.map((page) => page.group)
  assert.ok(at > groups.indexOf('AKADEMİK'))
  assert.ok(at <= groups.lastIndexOf('AKADEMİK'))
  assert.equal(pages[at + 1]?.path, 'kurlar')
  assert.ok(!demoNavigation.ogretmen.some((page) => page.path === TRIAL_RESULTS_PAGE.path))
})
