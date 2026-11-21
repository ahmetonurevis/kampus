import { useApiQuery } from './use-api-query.ts'

/**
 * Velinin ödeyicisi olduğu çocuklar (`GET /finance/payer-children`; ON-313, K-04). Yalnız veli
 * finans sayfaları okur; liste ad ve sınıf adı taşır. Rol veli değilse ya da finans kapalıysa
 * `enabled: false` verilir.
 */
export function useFinancePayerChildren(options: { enabled?: boolean } = {}) {
  return useApiQuery({
    key: ['finance', 'payer-children'],
    enabled: options.enabled ?? true,
    request: (client, signal) => client.GET('/api/v1/finance/payer-children', { signal }),
  })
}
