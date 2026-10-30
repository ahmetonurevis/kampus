import { navigation } from '@kampus/school-core/modules/full-navigation.ts'
import { schoolModules } from '@kampus/school-core/modules/school-workflows.ts'

import type { Role } from '../auth.ts'

/**
 * Modül kaydı school-core'dandır (`modules/full-navigation.ts`, `modules/school-workflows.ts`);
 * burada yalnız okunur. Bilinen modüller: menü sayfalarının `module` anahtarları (temel modüller
 * `crm`, `finance`, `academic`, `learning`, `communication`) ve okul iş akışı modülleri.
 */
export const MODULE_KEYS: readonly string[] = [
  ...new Set(
    Object.values(navigation).flatMap((pages) =>
      pages.flatMap((page) => (page.module === null ? [] : [page.module])),
    ),
  ),
].sort()

const MODULE_SET: ReadonlySet<string> = new Set(MODULE_KEYS)

export function isModuleKey(value: string): boolean {
  return MODULE_SET.has(value)
}

/**
 * Core'un rol listesi bildirdiği modüller (okul iş akışları). Temel modüllerin core'da rol
 * listesi yoktur (menü sayfaları yetki değildir); onlar için rol kararı koleksiyon erişim
 * tablosundadır.
 */
const MODULE_ROLES: ReadonlyMap<string, ReadonlySet<Role>> = new Map(
  schoolModules.map((module) => [module.key, new Set(module.roles)]),
)

/** Rol modülü kullanabilir mi; core rol listesi bildirmeyen modülde karar çağıranındır. */
export function moduleAllowsRole(moduleKey: string, role: Role): boolean {
  const roles = MODULE_ROLES.get(moduleKey)
  return roles === undefined || roles.has(role)
}

/**
 * Kurumun saklanan modül haritasından etkin harita: her bilinen modül listelenir. Saklanmayan
 * modül açıktır (core örnek verisinde bütün modüller açık başlar); yalnız açıkça `false`
 * olan kapalıdır. Bilinmeyen anahtar yok sayılır.
 */
export function effectiveModules(stored: Readonly<Record<string, boolean>>) {
  return Object.fromEntries(MODULE_KEYS.map((key) => [key, stored[key] !== false]))
}
