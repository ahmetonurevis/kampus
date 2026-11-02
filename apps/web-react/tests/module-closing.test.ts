import assert from 'node:assert/strict'
import { test } from 'node:test'
import { INSTITUTION_TYPES } from '@kampus/school-core/modules/collection-modules.ts'
import {
  accountPages,
  findPage,
  isPageAvailable,
  moduleKeys,
  ROLE_KEYS,
  rolePages,
  rolePages as allRolePages,
  sidebarGroups,
  visiblePages,
  type ModuleState,
} from '../src/lib/navigation.ts'
import { MIGRATED } from '../src/lib/page-coverage.ts'
import {
  PROSPECT_DETAIL_PATH,
  resolveProspectDetail,
  resolveShell,
} from '../src/lib/route-guard.ts'

/**
 * IST-009, DOM-YTK-040: modül kapanınca menü (sidebar kategorileri ve hesap menüsü) ve doğrudan
 * adres kapanır; boş kategori gizlenir. Bütün roller ve bütün modüller döngüyle taranır; sunucu
 * tarafı `apps/api/test/module-inventory.test.ts`'tedir. Kurum türüne bağlı sayfalar (dil okulu
 * kurları) yalnız kendi türlerinde taranır; başka türde adresleri yoktur (`route-guard.test.ts`).
 */

const KEYS = moduleKeys()
const allOpen: ModuleState = Object.fromEntries(KEYS.map((key) => [key, true]))

test('IST-009: her rol ve her modül için kapalı modülün sayfaları menüden ve adresten düşer', () => {
  for (const module of KEYS) {
    const closed = { ...allOpen, [module]: false }
    for (const role of ROLE_KEYS)
      for (const type of INSTITUTION_TYPES) {
        const home = `/${role}/dashboard`
        const session = { role, modules: closed, institution: { type } }
        for (const page of rolePages(role)) {
          if (!isPageAvailable(page, type)) continue
          const decision = resolveShell(session, role, page.path)
          if (page.module === module) {
            assert.equal(decision.kind, 'module-closed', `${role}/${page.path}`)
            assert.equal(decision.kind === 'module-closed' && decision.to, home)
          } else assert.equal(decision.kind, 'page', `${role}/${page.path} (${module} kapalı)`)
        }
        const shown = [
          ...sidebarGroups(role, closed, type).flatMap((group) => group.pages),
          ...accountPages(role, closed, type),
        ]
        assert.ok(!shown.some((page) => page.module === module), `${role}: ${module} menüde`)
        for (const group of sidebarGroups(role, closed, type))
          assert.ok(group.pages.length > 0, `${role}: boş kategori ${group.key}`)
      }
  }
})

test('IST-009: bütün modüller kapalıyken yalnız modülsüz sayfalar kalır, boş kategori yoktur', () => {
  const none = Object.fromEntries(KEYS.map((key) => [key, false]))
  // Okul kurumu (tür verilmezse okul sayılır): türe bağlı sayfalar hiç yoktur.
  const rolePages = (role: (typeof ROLE_KEYS)[number]) =>
    allRolePages(role).filter((page) => isPageAvailable(page, 'school'))
  for (const role of ROLE_KEYS) {
    const visible = visiblePages(role, none)
    assert.deepEqual(
      visible.map((page) => page.path),
      rolePages(role)
        .filter((page) => !page.module)
        .map((page) => page.path),
    )
    assert.ok(
      visible.some((page) => page.path === 'dashboard'),
      role,
    )
    for (const group of sidebarGroups(role, none)) assert.ok(group.pages.length > 0, group.key)
    // Modül yeniden açılınca sayfaları geri gelir.
    for (const module of KEYS) {
      const reopened = visiblePages(role, { ...none, [module]: true })
      const expected = rolePages(role).filter((page) => !page.module || page.module === module)
      assert.deepEqual(
        reopened.map((page) => page.path),
        expected.map((page) => page.path),
        `${role}: ${module}`,
      )
    }
  }
})

test('IST-009: taşınmış her sayfa menüde modülüyle kayıtlıdır; menü dışı aday detayı crm ister', () => {
  for (const key of MIGRATED) {
    const [role, path] = key.split('/') as [(typeof ROLE_KEYS)[number], string]
    if (path === PROSPECT_DETAIL_PATH) {
      const closed = resolveProspectDetail({ role, modules: { ...allOpen, crm: false } }, role)
      assert.equal(closed.kind, 'module-closed', key)
      continue
    }
    assert.ok(findPage(role, path), `${key}: menüde yok, adres koruması modülünü bilemez`)
  }
})
