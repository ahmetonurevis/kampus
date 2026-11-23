import type { operations } from '@kampus/api-client/schema.d.ts'
import { isApiError } from '@kampus/api-client/errors.ts'

import { collectionKeyPrefix } from './collections.ts'
import { useApiQuery } from './use-api-query.ts'

// Yetişkin kursiyerin kendi sözleşmeleri (`GET /finance/students/:id/contracts`; IST-082,
// docs/domain/finans.md DOM-FIN-059). Salt okunur; durum ve plan özeti sunucuda hesaplanır.

export type OwnContract =
  operations['listOwnContracts']['responses'][200]['content']['application/json']['data'][number]

/**
 * Kursiyerin sözleşme sürümleri. Anahtar sözleşme koleksiyonunun önekindedir: sözleşme komutlarının
 * tazelemesi bu listeyi de yeniler.
 */
export function useOwnContracts(studentId: string, options: { enabled?: boolean } = {}) {
  return useApiQuery({
    key: [...collectionKeyPrefix('contracts'), 'own', studentId],
    enabled: (options.enabled ?? true) && studentId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/students/{studentId}/contracts', {
        params: { path: { studentId } },
        signal,
      }),
  })
}

/**
 * 18 yaş altı kursiyer kendi kaydındadır ama sözleşmenin tarafı velidir (403
 * `adult_learner_only`): bölüm hata göstermeden gizlenir.
 */
export function isAdultLearnerOnlyError(error: unknown): boolean {
  return isApiError(error) && error.status === 403 && error.code === 'adult_learner_only'
}
