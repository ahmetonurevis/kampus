import type { KampusClient } from '@kampus/api-client/client.ts'
import type { operations } from '@kampus/api-client/schema.d.ts'

import { useApiMutation } from './use-api-mutation.ts'

// Kıdem ve ihbar tazminatı tahmini (ON-205; DOM-FIN-094). Uç `POST`'tur ama hiçbir şey yazmaz;
// ücret kişisel veri olduğundan sorgu önbelleğine girmez, mutasyon olarak çalışır (gövde ve yanıt
// işlem bitince önbellekte kalmaz, K-273). Geçersiz kılınacak sorgu yoktur.

export type SeveranceEstimateBody =
  operations['estimateFinanceSeverance']['requestBody']['content']['application/json']
export type SeveranceEstimateResult =
  operations['estimateFinanceSeverance']['responses'][200]['content']['application/json']['data']

const estimateRequest = (client: KampusClient, body: SeveranceEstimateBody) =>
  client.POST('/api/v1/finance/severance-estimates', { body })

/** Elle girilen ücret ve günlerden kıdem ve ihbar dökümü. */
export function useSeveranceEstimate() {
  return useApiMutation({ request: estimateRequest })
}
