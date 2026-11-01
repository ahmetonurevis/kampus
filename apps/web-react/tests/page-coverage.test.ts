import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  INSTITUTION_TYPES,
  MODULE_INSTITUTION_TYPES,
  type ModuleKey,
} from '@kampus/school-core/modules/collection-modules.ts'
import { ROLE_KEYS, rolePages, type RoleKey } from '../src/lib/navigation.ts'
import { isMigratedPage } from '../src/lib/page-coverage.ts'

/**
 * React'te henüz yer tutucu olan menü sayfaları (`rol/yol`). Liste yalnız küçülebilir: sayfa
 * taşınınca buradan silinir, yeni menü sayfası React karşılığı olmadan eklenirse test kırılır.
 * Ayrıntı ve öncelik: docs/sayfalar.md "React'te henüz yer tutucu".
 */
const KNOWN_PLACEHOLDERS: readonly string[] = ['onburo/kayit-islemleri']

/** Kurum türünde bulunan menü sayfaları: modülü o türde açılabilen ya da modülsüz olanlar. */
function pagesFor(role: RoleKey, type: (typeof INSTITUTION_TYPES)[number]) {
  return rolePages(role).filter((page) => {
    if (!page.module) return true
    const types: readonly string[] | undefined = MODULE_INSTITUTION_TYPES[page.module as ModuleKey]
    assert.ok(types, `bilinmeyen modül: ${page.module} (${role}/${page.path})`)
    return types.includes(type)
  })
}

for (const type of INSTITUTION_TYPES) {
  test(`${type}: menüdeki her sayfanın React karşılığı vardır ya da bilinen yer tutucudur`, () => {
    const unknown: string[] = []
    for (const role of ROLE_KEYS)
      for (const page of pagesFor(role, type)) {
        const key = `${role}/${page.path}`
        if (!isMigratedPage(role, page.path) && !KNOWN_PLACEHOLDERS.includes(key)) unknown.push(key)
      }
    assert.deepEqual(
      unknown,
      [],
      'Bu menü sayfalarının React karşılığı yok; sayfayı page-registry kaydına ekleyin (yer tutucu izin listesine eklemeyin).',
    )
  })
}

test('izin listesi güncel kalır: taşınan ya da menüden kalkan sayfa listeden silinir', () => {
  const stale = KNOWN_PLACEHOLDERS.filter((key) => {
    const [role, path] = key.split('/') as [RoleKey, string]
    const page = rolePages(role).find((candidate) => candidate.path === path)
    return !page || isMigratedPage(role, path)
  })
  assert.deepEqual(stale, [])
  assert.equal(new Set(KNOWN_PLACEHOLDERS).size, KNOWN_PLACEHOLDERS.length)
})
