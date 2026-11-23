import type { KampusClient } from '@kampus/api-client/client.ts'
import type { operations } from '@kampus/api-client/schema.d.ts'

import { useApiMutation } from './use-api-mutation.ts'
import { useApiQuery } from './use-api-query.ts'
import { PAY_RATES_KEY } from './use-finance-pay-rates.ts'

// Kıdem ve ihbar tazminatı tahmini (ON-205, ON-341; DOM-FIN-094). Tahmin ucu `POST`'tur ama hesap
// saklanmaz; ücret kişisel veri olduğundan sorgu önbelleğine girmez, mutasyon olarak çalışır (K-273).
// Ücret önerisi (K-345) tutar içerir ve her okuması denetime düşer (K-347): önbellekte tutulmaz
// (`gcTime` 0), odak ya da bağlantı dönüşünde kendiliğinden yeniden okunmaz. Anahtarı ücret
// anahtarının altındadır; ücret tanımı yazılınca öneri tazelenir.

export type SeveranceEstimateBody =
  operations['estimateFinanceSeverance']['requestBody']['content']['application/json']
export type SeveranceEstimateResult =
  operations['estimateFinanceSeverance']['responses'][200]['content']['application/json']['data']
export type SeverancePaySuggestionResult =
  operations['getFinanceSeverancePaySuggestion']['responses'][200]['content']['application/json']['data']

const estimateRequest = (client: KampusClient, body: SeveranceEstimateBody) =>
  client.POST('/api/v1/finance/severance-estimates', { body })

/** Ücret, günler ve kurumun bordro parametresinden kıdem ve ihbar dökümü. */
export function useSeveranceEstimate() {
  return useApiMutation({ request: estimateRequest })
}

/** Personelin `date` (çıkış) günündeki ücret önerisi; personel seçilmediyse çalışmaz. */
export function useSeverancePaySuggestion(membershipId: string, date: string, enabled = true) {
  return useApiQuery({
    key: [...PAY_RATES_KEY, 'severance-suggestion', membershipId, date],
    enabled: enabled && membershipId !== '' && date !== '',
    gcTime: 0,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    request: (client, signal) =>
      client.GET('/api/v1/finance/severance-pay-suggestion', {
        params: { query: { membershipId, date } },
        signal,
      }),
  })
}
