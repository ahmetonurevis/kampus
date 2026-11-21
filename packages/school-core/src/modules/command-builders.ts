import type { State } from '../data/seed.ts'
import type { CollectionName, ModuleKey } from './collection-modules.ts'

/**
 * Komut tablolarının ortak yapı taşları. İki kaynak tablo (`platform/commands.ts` ve
 * `commands.ts` içindeki Onur bloğu) bunları kullanır; tablonun kendisi `commands.ts`'tedir
 * (açıklama ve sözleşme orada). Ayrı dosyadır, çünkü `commands.ts` platform tablosunu içe
 * aktarır ve döngüsel içe aktarma olmamalıdır.
 */

export type ScalarKey = Extract<keyof State, 'modules' | 'academicYear'>
export type CommandSpec = {
  readonly module: ModuleKey | null
  readonly collections: readonly CollectionName[]
  readonly scalars: readonly ScalarKey[]
}

/** Kapsam (`scopeFor`) ve yetki (`authorize`) kaynağı; `lib/scope.ts` SCOPE_SOURCE_COLLECTIONS. */
export const SCOPE = [
  'students',
  'teachers',
  'classes',
  'assignments',
  'clubs',
  'mockExams',
] as const
/** Oturum aktörü ve iş akışı kapsamı veliyi de okur (`sessionActor`). */
export const SESSION = [...SCOPE, 'parents'] as const
// Ders/etkinlik/etüt çakışma denetimi (`lib/tutor-conflicts.ts`).
export const CONFLICTS = ['schedule', 'appointments', 'tutorSessions', 'schoolEvents'] as const

export const spec = (
  module: ModuleKey | null,
  collections: readonly CollectionName[],
  scalars: readonly ScalarKey[] = ['modules'],
): CommandSpec => ({ module, collections: [...new Set(collections)], scalars })
/** İş akışı ve otomasyon komutu her zaman bir modüle bağlıdır. */
export type ModuleCommandSpec = CommandSpec & { readonly module: ModuleKey }
export const workflow = (
  module: ModuleKey,
  extra: readonly CollectionName[],
  scalars?: ScalarKey[],
): ModuleCommandSpec => ({ ...spec(module, [...SESSION, ...extra], scalars), module })
