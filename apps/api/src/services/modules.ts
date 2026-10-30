import { eq } from 'drizzle-orm'

import {
  MODULE_KEYS as CORE_MODULE_KEYS,
  isModuleKey as isCoreModuleKey,
} from '@kampus/school-core/modules/collection-modules.ts'
import { schoolModules } from '@kampus/school-core/modules/school-workflows.ts'

import type { InstitutionType, Role } from '../auth.ts'
import type { Database } from '../db/client.ts'
import { institutions } from '../db/schema/auth.ts'

/**
 * Modül kaydı ve kurum türü kısıtı school-core'dandır (`modules/collection-modules.ts`; anahtar
 * kümesi menü ve iş akışı kaydıyla aynıdır, core testleri doğrular); burada yalnız okunur. API
 * yanıtlarında anahtarlar alfabetik sıradadır.
 */
export const MODULE_KEYS: readonly string[] = [...CORE_MODULE_KEYS].sort()

export function isModuleKey(value: string): boolean {
  return isCoreModuleKey(value)
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

/** Better Auth `json` alanı: yalnız boolean değerli anahtarlar alınır. */
export function toModuleMap(value: unknown): Record<string, boolean> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
    ),
  )
}

export interface InstitutionModules {
  type: InstitutionType
  /** Etkin modül haritası (`effectiveModules`). */
  modules: Record<string, boolean>
}

/**
 * Kurumun türü ve etkin modül haritası; kurum yoksa `null` (üyelik doğrulandığı için olağan
 * değil). Tür, modülün o kurumda bulunup bulunmadığını belirler (DOM-YTK-012).
 */
export async function getInstitutionModules(
  db: Database,
  institutionId: string,
): Promise<InstitutionModules | null> {
  const [row] = await db
    .select({ type: institutions.type, enabledModules: institutions.enabledModules })
    .from(institutions)
    .where(eq(institutions.id, institutionId))
    .limit(1)
  return row ? { type: row.type, modules: effectiveModules(toModuleMap(row.enabledModules)) } : null
}
