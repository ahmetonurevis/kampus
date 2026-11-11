import { z } from 'zod'

import {
  isModuleKey,
  moduleAvailableFor,
  type InstitutionType,
} from '../modules/collection-modules.ts'
import { DomainError } from './errors.ts'
import type { Actor } from './scope.ts'

/**
 * Kurum modüllerini açma/kapama (DOM-YTK-040, DOM-YTK-042, DOM-YTK-012). İşlem saf fonksiyondur:
 * saklanan modül haritasını değiştirmez, yenisini döndürür. Kapatma veriyi silmez ve arşivlemez;
 * koleksiyon kayıtlarına (gelecek etüt rezervasyonları dahil) hiç dokunulmaz, modül yeniden
 * açılınca aynen döner. Modüller arasında ön koşul/bağımlılık tanımı core'da yoktur; yeni
 * bağımlılık icat edilmez, yalnız aşağıdaki kurallar uygulanır.
 */

/** API gövde şeması ve web ayar ekranı. */
export const moduleToggleInputSchema = z.object({ enabled: z.boolean() })
export type ModuleToggleInput = z.infer<typeof moduleToggleInputSchema>

export interface ModuleSettingsSource {
  institutionType: InstitutionType
  /** Saklanan modül haritası; yalnız açıkça `false` olan kapalıdır (API `effectiveModules`). */
  modules: Readonly<Record<string, boolean>>
}

export interface ModuleToggleResult {
  /** Yeni saklanan harita: yalnız verilen modülün değeri değişir. */
  modules: Record<string, boolean>
  moduleKey: string
  enabled: boolean
}

/**
 * Modülü açar veya kapatır. Sıra: girdi (Zod) → yönetici → bilinen modül → kurum türünde bulunur →
 * durum değişir. Reddedilirse hiçbir şey değişmez.
 *
 * - `permission_denied` (forbidden): yalnız yönetici değiştirir (DOM-YTK-042).
 * - `module_not_found` (not_found): bilinmeyen modül anahtarı.
 * - `module_unavailable_for_type` (rule, `path: ['moduleKey']`): kurum türünde olmayan modül
 *   açılamaz ve kapatılamaz (DOM-YTK-012).
 * - `module_unchanged` (conflict): modül zaten istenen durumda.
 */
export function setModuleEnabled(
  source: ModuleSettingsSource,
  actor: Pick<Actor, 'role'>,
  moduleKey: string,
  input: unknown,
): ModuleToggleResult {
  const { enabled } = moduleToggleInputSchema.parse(input)
  if (actor.role !== 'yonetici')
    throw new DomainError('permission_denied', 'Modülleri yalnız yönetici değiştirebilir.', {
      kind: 'forbidden',
    })
  if (!isModuleKey(moduleKey))
    throw new DomainError('module_not_found', 'Modül bulunamadı.', { kind: 'not_found' })
  if (!moduleAvailableFor(moduleKey, source.institutionType))
    throw new DomainError('module_unavailable_for_type', 'Bu modül kurum türünüzde kullanılamaz.', {
      kind: 'rule',
      path: ['moduleKey'],
    })
  const current = source.modules[moduleKey] !== false
  if (current === enabled)
    throw new DomainError(
      'module_unchanged',
      enabled ? 'Modül zaten açık.' : 'Modül zaten kapalı.',
      {
        kind: 'conflict',
      },
    )
  return { modules: { ...source.modules, [moduleKey]: enabled }, moduleKey, enabled }
}
