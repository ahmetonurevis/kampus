import type { KampusClient } from '@kampus/api-client/client.ts'
import type { operations } from '@kampus/api-client/schema.d.ts'

import { collectionKeyPrefix } from './collections.ts'
import { requireIfMatch, type CommandHeaders, type CommandMessages } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'

/**
 * Kayıt sonrası veli bilgisi düzeltme (ON-117; `PATCH /api/v1/parents/{parentId}`, DOM-KAY-012).
 * Okunan sürüm `If-Match` olarak zorunludur; başarıda veli kayıtları tazelenir.
 */

export type UpdateParentDetailsBody = NonNullable<
  operations['updateParentDetails']['requestBody']
>['content']['application/json']

export interface UpdateParentDetailsInput {
  parentId: string
  version: number
  body: UpdateParentDetailsBody
}

export const PARENT_MESSAGES: CommandMessages = {
  parent_unchanged: 'Veli bilgisinde değişiklik yok.',
  parent_not_found: 'Veli kaydı bulunamadı.',
  version_conflict: 'Veli bilgisi başka bir yerde değişti, güncel hâli yüklendi.',
}

export function updateParentDetailsRequest(
  client: KampusClient,
  { parentId, body }: UpdateParentDetailsInput,
  headers: CommandHeaders,
) {
  return client.PATCH('/api/v1/parents/{parentId}', {
    params: { path: { parentId }, header: { ...headers, 'if-match': requireIfMatch(headers) } },
    body,
  })
}

export function useUpdateParentDetails(options: { onSuccess?: () => void } = {}) {
  return useApiCommand({
    request: updateParentDetailsRequest,
    version: (input: UpdateParentDetailsInput) => input.version,
    invalidates: [collectionKeyPrefix('parents')],
    messages: PARENT_MESSAGES,
    exclusive: true,
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  })
}
