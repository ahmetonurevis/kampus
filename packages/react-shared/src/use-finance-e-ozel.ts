import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

// e-Özel işlem listesi kancaları (`/finance/e-ozel`; IST-085, DOM-KAY-015). Platform e-Özel'e
// bağlanmaz: liste elle işlem içindir, işaret kim/ne zaman bilgisiyle tutulur.

export type EOzelListQuery = NonNullable<operations['listEOzelItems']['parameters']['query']>
export type EOzelItemRow =
  operations['listEOzelItems']['responses'][200]['content']['application/json']['data'][number]
export type EOzelFileQuery = NonNullable<operations['exportEOzelItems']['parameters']['query']>

const E_OZEL_KEY = ['payments', 'e-ozel'] as const

export const E_OZEL_CHANGED_MESSAGE = 'Kayıt başka biri tarafından değiştirildi. Liste güncellendi.'

export function useEOzelItems(query: EOzelListQuery) {
  return useApiQuery({
    key: [...E_OZEL_KEY, 'list', query],
    request: (client, signal) =>
      client.GET('/api/v1/finance/e-ozel/items', { params: { query }, signal }),
  })
}

/**
 * İşaretler ya da geri alır. Anahtar `payments` altındadır: ücret satırı tahsilatın MEBBİS
 * işaretidir, tahsilat geçmişi de tazelenir.
 */
export function useSetEOzelMark() {
  return useApiCommand({
    request: (
      client,
      input: { kind: EOzelItemRow['kind']; sourceId: string; version: number; recorded: boolean },
      headers,
    ) =>
      client.POST('/api/v1/finance/e-ozel/items/{kind}/{sourceId}/record', {
        params: {
          path: { kind: input.kind, sourceId: input.sourceId },
          header: { ...headers, 'if-match': requireIfMatch(headers) },
        },
        body: { recorded: input.recorded },
      }),
    invalidates: [['payments']],
    version: (input) => input.version,
    messages: { version_conflict: E_OZEL_CHANGED_MESSAGE },
  })
}

/** Dosyayı metin olarak alır; yazma değildir, sorgu tazelenmez. Hata mesajı toast olur. */
export function useEOzelExport() {
  return useApiCommand({
    request: (client, query: EOzelFileQuery) =>
      client.GET('/api/v1/finance/e-ozel/export', { params: { query }, parseAs: 'text' }),
    invalidates: [],
  })
}
