import assert from 'node:assert/strict'
import test from 'node:test'
import {
  navigation,
  pageAvailableFor,
} from '../packages/school-core/src/modules/full-navigation.ts'
import { navigation as baseNavigation } from '../packages/school-core/src/modules/navigation.ts'
import { navigation as demoNavigation } from '../apps/web/src/modules/navigation.js'
import {
  API_ACADEMIC_PAGES,
  API_COMMUNICATION_PAGES,
  API_LANGUAGE_SCHOOL_PAGES,
  API_LEARNING_PAGES,
} from '../packages/school-core/src/platform/navigation.ts'
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
    ['kurlar', 'gruplar', 'icerik-havuzu', 'duyurular', 'mesajlar'],
  )
})

test('Kur ve grup sayfaları yalnız dil okulunda, personelde ve kategorisinin sonunda (IST-076, IST-077)', () => {
  const expected: Record<Role, string | null> = {
    yonetici: 'YÖNETİM',
    onburo: 'KAYIT & SATIŞ',
    ogretmen: 'AKADEMİK',
    ogrenci: null,
    veli: null,
  }
  for (const role of roleKeys) {
    const pages = navigation[role]
    for (const path of ['kurlar', 'gruplar']) {
      const page = pages.find((p) => p.path === path)
      if (expected[role] === null) {
        assert.equal(page, undefined, `${role}/${path}`)
        continue
      }
      assert.ok(page, `${role}/${path}`)
      assert.equal(page.group, expected[role])
      assert.equal(page.module, null)
      assert.equal(page.apiOnly, true)
      assert.deepEqual(page.institutionTypes, ['language_school'])
      assert.equal(pageAvailableFor(page, 'school'), false)
      assert.equal(pageAvailableFor(page, 'language_school'), true)
    }
    const groups = pages.map((p) => p.group)
    for (const group of new Set(groups))
      assert.equal(
        groups.lastIndexOf(group) - groups.indexOf(group) + 1,
        groups.filter((g) => g === group).length,
        `${role} ${group} kategorisi bölünmedi`,
      )
  }
  // Okul kurumunda kur ve grup dışındaki her sayfa açıktır.
  for (const role of roleKeys)
    assert.ok(
      navigation[role].every(
        (p) => p.path === 'kurlar' || p.path === 'gruplar' || pageAvailableFor(p, 'school'),
      ),
      role,
    )
})

test('İçerik Havuzu yalnız yönetici ve öğretmende, learning modülüne bağlı ve ÖĞRENME kategorisindedir (DOM-YTK-021)', () => {
  for (const role of roleKeys) {
    const page = navigation[role].find((p) => p.path === 'icerik-havuzu')
    if (role !== 'yonetici' && role !== 'ogretmen') {
      assert.equal(page, undefined, `${role} içerik havuzunu görmemeli`)
      continue
    }
    assert.ok(page, `${role} menüsünde yok`)
    assert.equal(page.module, 'learning')
    assert.equal(page.group, 'ÖĞRENME')
    assert.equal(page.apiOnly, true)
    // Kategori sürekli kalır: aynı gruptaki sayfalar yan yana durur.
    const groups = navigation[role].map((p) => p.group)
    const first = groups.indexOf('ÖĞRENME')
    assert.equal(
      groups.lastIndexOf('ÖĞRENME') - first + 1,
      groups.filter((g) => g === 'ÖĞRENME').length,
    )
  }
  const teacher = navigation.ogretmen.map((p) => p.path)
  assert.equal(teacher[teacher.indexOf('sorular') + 1], 'icerik-havuzu')
  const admin = navigation.yonetici.map((p) => p.path)
  assert.ok(admin.indexOf('icerik-havuzu') < admin.indexOf('kayit-raporlari'))
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

test('Platform sayfaları temel menüde bulunmaz ve her biri birleşik menüde tek kez yer alır', () => {
  for (const role of roleKeys) {
    const base = new Set(baseNavigation[role].map((p) => p.path))
    for (const page of [
      ...API_COMMUNICATION_PAGES[role],
      ...API_LEARNING_PAGES[role],
      ...API_ACADEMIC_PAGES[role],
      ...API_LANGUAGE_SCHOOL_PAGES[role],
    ]) {
      const copies = navigation[role].filter((p) => p.path === page.path)
      assert.ok(!base.has(page.path), `${role}/${page.path} temel menüde de var`)
      assert.equal(copies.length, 1, `${role}/${page.path}`)
    }
  }
})

test('Yoklama Düzeltme yalnız yöneticide, academic modülünde ve YÖNETİM kategorisinin sonundadır (DOM-AKD-035)', () => {
  for (const role of roleKeys) {
    const page = navigation[role].find((p) => p.path === 'yoklama-duzeltme')
    if (role !== 'yonetici') {
      assert.equal(page, undefined, `${role} yoklama düzeltmeyi görmemeli`)
      continue
    }
    assert.ok(page)
    assert.equal(page.module, 'academic')
    assert.equal(page.group, 'YÖNETİM')
    assert.equal(page.apiOnly, true)
  }
  const admin = navigation.yonetici.map((p) => p.path)
  assert.equal(admin[admin.indexOf('personel') + 1], 'yoklama-duzeltme')
  assert.ok(!demoNavigation.yonetici.some((p) => p.path === 'yoklama-duzeltme'))
})
