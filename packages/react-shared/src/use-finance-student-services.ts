import type { operations } from '@kampus/api-client/schema.d.ts'

import { collectionKeyPrefix } from './collections.ts'
import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

// Ek hizmet aboneliği kancaları (`/finance/student-services`; DOM-FIN-003, ON-087). Başka modülün
// ekranı da aynı kancaları kullanır; taksit özeti ve bakiye bu sorgularla tazelenir.

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type SubscribeStudentServiceBody = JsonBody<'subscribeStudentService'>
export type EndStudentServiceBody = JsonBody<'endStudentService'>
type ListResponse =
  operations['listStudentServices']['responses'][200]['content']['application/json']
export type StudentServiceItem = ListResponse['data'][number]

export type StudentServiceQuery = NonNullable<
  operations['listStudentServices']['parameters']['query']
>

const INVALIDATES = [['student-services'], collectionKeyPrefix('invoices'), ['payments']]

export function useStudentServices(
  query: StudentServiceQuery,
  options: { enabled?: boolean } = {},
) {
  return useApiQuery({
    key: ['student-services', query],
    enabled: options.enabled ?? true,
    request: (client, signal) =>
      client.GET('/api/v1/finance/student-services', { params: { query }, signal }),
  })
}

export function useSubscribeStudentService() {
  return useApiCommand({
    request: (client, body: SubscribeStudentServiceBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/student-services', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: INVALIDATES,
    exclusive: true,
  })
}

export function useEndStudentService() {
  return useApiCommand({
    request: (
      client,
      input: { serviceId: string; version: number; body: EndStudentServiceBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/student-services/{serviceId}/end', {
        params: {
          path: { serviceId: input.serviceId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    version: (input) => input.version,
    invalidates: INVALIDATES,
    exclusive: true,
  })
}
