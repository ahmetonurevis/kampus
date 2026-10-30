import assert from 'node:assert/strict'
import test from 'node:test'
import { navigation } from '../packages/school-core/src/modules/full-navigation.ts'
import { navigation as baseNavigation } from '../packages/school-core/src/modules/navigation.ts'
import { navigation as demoNavigation } from '../apps/web/src/modules/navigation.js'
import type { Role } from '../packages/school-core/src/modules/navigation.ts'

const roleKeys = Object.keys(baseNavigation) as Role[]

test('İletişim sayfaları her rolde modül `communication` altında ve İLETİŞİM kategorisinde', () => {
  const expected: Record<Role, string[]> = {
    yonetici: ['duyurular', 'mesajlar'],
    onburo: ['duyurular'],
    ogretmen: ['duyurular', 'mesajlar'],
    ogrenci: ['duyurular', 'mesajlar'],
    veli: ['duyurular', 'randevu-mesaj'],
  }
  for (const role of roleKeys) {
    for (const path of expected[role]) {
      const page = navigation[role].find((p) => p.path === path)
      assert.ok(page, `${role}/${path} menüde yok`)
      assert.equal(page.module, 'communication', `${role}/${path} modülü`)
      assert.equal(page.group, 'İLETİŞİM', `${role}/${path} kategorisi`)
    }
  }
})

test('Her yol rol içinde tek kez geçer; hesap grubu varsa iletişim ondan önce gelir', () => {
  for (const role of roleKeys) {
    const paths = navigation[role].map((p) => p.path)
    assert.equal(new Set(paths).size, paths.length, `${role} yinelenen yol`)
  }
  // Hesap grubu olan rolde API'li iletişim sayfaları ondan önce eklenir; yoksa sona.
  for (const role of roleKeys) {
    const pages = navigation[role]
    const account = pages.findIndex((p) => p.group === 'HESABIM')
    const lastApiOnly = pages.findLastIndex((p) => p.apiOnly)
    if (account >= 0 && lastApiOnly >= 0) assert.ok(lastApiOnly < account, role)
  }
})

test('Temel menüde zaten olan iletişim sayfaları apiOnly işaretlenmez', () => {
  for (const role of ['ogrenci', 'veli'] as const)
    assert.ok(
      navigation[role].every((p) => !p.apiOnly),
      `${role}`,
    )
  assert.deepEqual(
    navigation.ogretmen.filter((p) => p.apiOnly).map((p) => p.path),
    ['duyurular', 'mesajlar'],
  )
})

test('Vue demosu apiOnly sayfaları almaz ve temel menü + okul iş akışlarını korur', () => {
  for (const role of roleKeys) {
    assert.ok(demoNavigation[role].every((p) => !p.apiOnly))
    assert.deepEqual(
      demoNavigation[role].map((p) => p.path),
      navigation[role].filter((p) => !p.apiOnly).map((p) => p.path),
    )
    for (const base of baseNavigation[role])
      assert.ok(
        demoNavigation[role].some((p) => p.path === base.path),
        `${role}/${base.path} demoda kayboldu`,
      )
  }
  assert.ok(!demoNavigation.yonetici.some((p) => p.path === 'duyurular'))
})
