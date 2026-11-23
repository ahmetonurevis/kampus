import type { operations } from '@kampus/api-client/schema.d.ts'
import type { HealthAccessReason } from '@kampus/school-core/lib/finance-health-access.ts'

import type { CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { healthReasonHeaders } from './use-finance-health-access.ts'

// Yemekhane alerji uyarısı kancaları (`/finance/meal-allergy-checks/*`; DOM-FIN-162, ON-151).
// Servis listesi sağlık ayrıntısı taşır ve her okuması sunucuda gerekçesiyle denetime düşer: sorgu
// önbelleğine alınmaz (pencere odağı ya da sekme dönüşü yeni okuma ve yeni denetim satırı
// açmasın), kullanıcının "Listeyi göster" demesiyle bir kez çağrılır ve bileşen belleğinde kalır.
// Onay işareti `Idempotency-Key` ile gider; yanıtı listeye bileşende işlenir (liste yeniden
// okunmaz).

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never
type Query<TOperation extends keyof operations> = operations[TOperation]['parameters'] extends {
  query?: infer TQuery
}
  ? NonNullable<TQuery>
  : never
type Ok<TOperation extends keyof operations> = operations[TOperation]['responses'] extends {
  200: { content: { 'application/json': infer TBody } }
}
  ? TBody
  : never

export type MealAllergyOptions = Ok<'getMealAllergyOptions'>['data']
export type MealAllergyRosterQuery = Query<'getMealAllergyRoster'>
export type MealAllergyRoster = Ok<'getMealAllergyRoster'>['data']
export type MealAllergyRosterStudent = MealAllergyRoster['students'][number]
export type MealAllergyAcknowledgement = NonNullable<MealAllergyRosterStudent['acknowledgement']>
export type MealAllergyAcknowledgementBody = JsonBody<'acknowledgeMealAllergy'>

export const MEAL_ALLERGY_KEY = ['finance', 'meal-allergy-checks'] as const

/** Seçim ekranı: sınıflar, düzeyler, öğünler, gün aralığı; sağlık bilgisi taşımaz. */
export function useMealAllergyOptions(enabled = true) {
  return useApiQuery({
    key: [...MEAL_ALLERGY_KEY, 'options'],
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/meal-allergy-checks/options', { signal }),
  })
}

/** Servis listesi; erişim gerekçesi başlıkta gider, her çağrı denetime düşer. */
export function useLoadMealAllergyRoster() {
  return useApiCommand({
    request: (client, input: { query: MealAllergyRosterQuery; reason: HealthAccessReason }) =>
      client.GET('/api/v1/finance/meal-allergy-checks', {
        params: { query: input.query, header: healthReasonHeaders(input.reason) },
      }),
    invalidates: [],
  })
}

export const MEAL_ALLERGY_ACK_MESSAGES = {
  meal_allergy_ack_exists: 'Bu öğrencinin uyarısı zaten işaretlenmiş. Listeyi yenileyin.',
}

/** "Uyarı görüldü, alternatif verildi" işareti. */
export function useAcknowledgeMealAllergy() {
  return useApiCommand({
    request: (client, body: MealAllergyAcknowledgementBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/meal-allergy-checks/acknowledgements', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [],
    messages: MEAL_ALLERGY_ACK_MESSAGES,
  })
}
