import type { KampusClient } from '@kampus/api-client/client.ts'
import type { components } from '@kampus/api-client/schema.d.ts'
import { moduleInfo, type ModuleInfo } from '@kampus/school-core/modules/module-catalog.ts'

import type { CommandHeaders, CommandMessages } from './commands.ts'

/**
 * Kurum modül ayarının (`GET /modules`, `PATCH /modules/:moduleKey`, DOM-YTK-040/042) saf
 * yardımcıları. Hook `use-module-settings.ts`'tedir; burası React olmadan test edilir.
 */

export type ModuleSettings = components['schemas']['ModuleSettings']
export type ModuleChange = components['schemas']['ModuleChange']

/** Ayar sorgusunun anahtar parçası (etkin kurum kendiliğinden eklenir). */
export const MODULE_SETTINGS_KEY = ['module-settings'] as const

/** Eşzamanlı değişiklik: başka yönetici modülleri değiştirdi (409 `version_conflict`). */
export const MODULE_CONFLICT_MESSAGE =
  'Modül ayarlarını başka biri değiştirdi. Liste yenilendi; son durumu kontrol edip yeniden deneyin.'
export const MODULE_UNCHANGED_MESSAGE = 'Modül zaten bu durumda. Liste güncellendi.'

export const MODULE_MESSAGES: CommandMessages = {
  version_conflict: MODULE_CONFLICT_MESSAGE,
  module_unchanged: MODULE_UNCHANGED_MESSAGE,
}

export interface ModuleToggleInput {
  moduleKey: string
  /** İstenen durum. */
  enabled: boolean
  /** Ekrandaki ayar sürümü (`If-Match`); tutmazsa 409. */
  version: number
}

export function moduleToggleRequest(
  client: KampusClient,
  { moduleKey, enabled }: ModuleToggleInput,
  headers: CommandHeaders,
) {
  return client.PATCH('/api/v1/modules/{moduleKey}', {
    // `if-match` zorunludur; `commandHeaders` sürüm verildiğinde ekler.
    params: { path: { moduleKey }, header: { ...headers, 'if-match': headers['if-match'] ?? '' } },
    body: { enabled },
  })
}

export interface ModuleRow extends ModuleInfo {
  enabled: boolean
}

/**
 * Ayar ekranı satırları: sunucunun kurum türüne göre verdiği modüller, core kataloğundaki ad ve
 * açıklamayla. Katalogda olmayan (yeni) modül listelenmez; sunucu sırası korunur.
 */
export function moduleRows(settings: ModuleSettings): ModuleRow[] {
  return settings.modules.flatMap(({ key, enabled }) => {
    const info = moduleInfo(key)
    return info ? [{ ...info, enabled }] : []
  })
}

/** Başarı bildirimi: "Finans & Tahsilat modülü kapatıldı." */
export function moduleChangedMessage(title: string, enabled: boolean): string {
  return `${title} modülü ${enabled ? 'açıldı' : 'kapatıldı'}.`
}
