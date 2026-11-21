import type { operations } from '@kampus/api-client/schema.d.ts'

import { useApiCommand } from './use-api-command.ts'

// Servis listesi kancası (`GET /finance/transport/routes/:routeId/roster`; DOM-FIN-148, ON-148).
// Liste PDF verisidir: taze oturum ister, her çağrı denetime düşer; bu yüzden sorgu önbelleğine
// alınmaz, düğmeyle bir kez çağrılır (K-500).

export type TransportRoster =
  operations['getTransportRoster']['responses'][200]['content']['application/json']['data']
export type TransportRosterStop = TransportRoster['stops'][number]
export type TransportRosterStudent = TransportRosterStop['students'][number]
export type TransportRosterPurposeInput = NonNullable<
  NonNullable<operations['getTransportRoster']['parameters']['query']>['purpose']
>

export function useTransportRoster() {
  return useApiCommand({
    request: (client, input: { routeId: string; purpose: TransportRosterPurposeInput }) =>
      client.GET('/api/v1/finance/transport/routes/{routeId}/roster', {
        params: { path: { routeId: input.routeId }, query: { purpose: input.purpose } },
      }),
    invalidates: [],
  })
}
