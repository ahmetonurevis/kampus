import { useQueryClient } from '@tanstack/react-query'

import {
  moduleRows,
  MODULE_MESSAGES,
  MODULE_SETTINGS_KEY,
  moduleToggleRequest,
} from './module-settings.ts'
import type { ModuleChange, ModuleRow, ModuleToggleInput } from './module-settings.ts'
import { ME_QUERY_KEY } from './query-keys.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

/**
 * Kurum modül ayarı sorgusu (`GET /modules`, yalnız yönetici): sürüm ve satırlar. Satırlar
 * core modül kataloğuyla (`moduleRows`) birleşmiştir.
 */
export function useModuleSettings() {
  const query = useApiQuery({
    key: MODULE_SETTINGS_KEY,
    request: (client, signal) => client.GET('/api/v1/modules', { signal }),
  })
  const rows: ModuleRow[] = query.data ? moduleRows(query.data.data) : []
  return { ...query, rows, version: query.data?.data.version ?? null }
}

/**
 * Modülü açar/kapatır (`PATCH /modules/:moduleKey`). `If-Match` ekrandaki ayar sürümüdür; tutmazsa
 * 409 ve Türkçe "başkası değiştirdi" mesajı çıkar, ayar sorgusu tazelenir. Başarıda ve çakışmada
 * oturumdaki `enabledModules` (`/me`) da tazelenir: menü ve rota kapısı anında güncellenir.
 */
export function useSetModuleEnabled(options: { onSuccess?: (change: ModuleChange) => void } = {}) {
  const queryClient = useQueryClient()
  const refreshSession = () => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY })
  const command = useApiCommand({
    request: (client, input: ModuleToggleInput, headers) =>
      moduleToggleRequest(client, input, headers),
    invalidates: [MODULE_SETTINGS_KEY],
    version: (input) => input.version,
    messages: MODULE_MESSAGES,
    onSuccess: async (data) => {
      await refreshSession()
      options.onSuccess?.(data.data)
    },
  })
  return {
    ...command,
    async submit(input: ModuleToggleInput) {
      const outcome = await command.submit(input)
      // Çakışma başkasının değişikliği demektir; menü de eski olabilir.
      if (outcome.status === 'failed' && outcome.error.status === 409) await refreshSession()
      return outcome
    },
  }
}
