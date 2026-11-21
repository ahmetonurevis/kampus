import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

// Gezi günü kancaları (`/finance/trip-plans/:planId/day*`, `/finance/trip-days/my`; DOM-FIN-154,
// ON-157). Grup açma, dağıtım, tur açma ve işaret `Idempotency-Key` ile gider: belirsiz hatadan
// sonra yeniden gönderim aynı anahtarı kullanır (çift grup, tur ya da işaret yazılmaz). Düzeltme,
// kaldırma ve tur bitirme `If-Match` ister. Acil kart PDF verisidir: taze oturum ister, her çağrı
// denetime düşer; önbelleğe alınmaz, düğmeyle bir kez çağrılır (K-518).

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never
type Ok<TOperation extends keyof operations> = operations[TOperation]['responses'] extends {
  200: { content: { 'application/json': infer TBody } }
}
  ? TBody
  : never

export type TripDay = Ok<'getTripDay'>['data']
export type TripDayGroup = TripDay['groups'][number]
export type TripDayCheck = TripDayGroup['checks'][number]
export type TripDayRosterRow = TripDayCheck['roster'][number]
export type TripDayStudent = TripDay['unassigned'][number]
export type TripDayGroupBody = JsonBody<'createTripDayGroup'>
export type TripDayGroupUpdateBody = JsonBody<'updateTripDayGroup'>
export type TripDayAssignBody = JsonBody<'assignTripDayStudents'>
export type TripDayMarksBody = JsonBody<'markTripDayCheck'>
export type TripDayCard = Ok<'getTripDayEmergencyCard'>['data']
export type TripDayCardStudent = TripDayCard['students'][number]
export type TripDayCardPurposeInput = NonNullable<
  NonNullable<operations['getTripDayEmergencyCard']['parameters']['query']>['purpose']
>
export type MyTripDayRow = Ok<'listMyTripDays'>['data'][number]

export const TRIP_DAY_KEY = ['finance', 'trip-day'] as const
const MESSAGES = {
  version_conflict: 'Gezi günü başka biri tarafından değiştirildi. Görünüm güncellendi.',
}

const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useTripDay(planId: string, enabled = true) {
  return useApiQuery({
    key: [...TRIP_DAY_KEY, 'plan', planId],
    enabled: enabled && planId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/trip-plans/{planId}/day', {
        params: { path: { planId } },
        signal,
      }),
  })
}

export function useMyTripDays(enabled = true) {
  return useApiQuery({
    key: [...TRIP_DAY_KEY, 'my'],
    enabled,
    request: (client, signal) => client.GET('/api/v1/finance/trip-days/my', { signal }),
  })
}

export function useCreateTripDayGroup() {
  return useApiCommand({
    request: (client, input: { planId: string; body: TripDayGroupBody }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/trip-plans/{planId}/day/groups', {
        params: {
          path: { planId: input.planId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [TRIP_DAY_KEY],
  })
}

export function useUpdateTripDayGroup() {
  return useApiCommand({
    request: (
      client,
      input: { planId: string; groupId: string; version: number; body: TripDayGroupUpdateBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/trip-plans/{planId}/day/groups/{groupId}', {
        params: {
          path: { planId: input.planId, groupId: input.groupId },
          header: versioned(headers),
        },
        body: input.body,
      }),
    invalidates: [TRIP_DAY_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
  })
}

export function useArchiveTripDayGroup() {
  return useApiCommand({
    request: (
      client,
      input: { planId: string; groupId: string; version: number },
      headers: CommandHeaders,
    ) =>
      client.DELETE('/api/v1/finance/trip-plans/{planId}/day/groups/{groupId}', {
        params: {
          path: { planId: input.planId, groupId: input.groupId },
          header: versioned(headers),
        },
      }),
    invalidates: [TRIP_DAY_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
  })
}

export function useAssignTripDay() {
  return useApiCommand({
    request: (
      client,
      input: { planId: string; body: TripDayAssignBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/trip-plans/{planId}/day/assignments', {
        params: {
          path: { planId: input.planId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [TRIP_DAY_KEY],
  })
}

export function useStartTripDayCheck() {
  return useApiCommand({
    request: (
      client,
      input: { planId: string; groupId: string; checkpoint: string },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/trip-plans/{planId}/day/groups/{groupId}/checks', {
        params: {
          path: { planId: input.planId, groupId: input.groupId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: { checkpoint: input.checkpoint },
      }),
    invalidates: [TRIP_DAY_KEY],
  })
}

export function useMarkTripDayCheck() {
  return useApiCommand({
    request: (
      client,
      input: { planId: string; checkId: string; body: TripDayMarksBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/trip-plans/{planId}/day/checks/{checkId}/marks', {
        params: {
          path: { planId: input.planId, checkId: input.checkId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [TRIP_DAY_KEY],
  })
}

export function useCompleteTripDayCheck() {
  return useApiCommand({
    request: (
      client,
      input: { planId: string; checkId: string; version: number },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/trip-plans/{planId}/day/checks/{checkId}/complete', {
        params: {
          path: { planId: input.planId, checkId: input.checkId },
          header: versioned(headers),
        },
        body: {},
      }),
    invalidates: [TRIP_DAY_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
  })
}

export function useProceedTripDayCheck() {
  return useApiCommand({
    request: (
      client,
      input: { planId: string; checkId: string; version: number; reason: string },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/trip-plans/{planId}/day/checks/{checkId}/proceed', {
        params: {
          path: { planId: input.planId, checkId: input.checkId },
          header: versioned(headers),
        },
        body: { reason: input.reason },
      }),
    invalidates: [TRIP_DAY_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
  })
}

export function useTripDayCard() {
  return useApiCommand({
    request: (
      client,
      input: { planId: string; groupId: string; purpose: TripDayCardPurposeInput },
    ) =>
      client.GET('/api/v1/finance/trip-plans/{planId}/day/groups/{groupId}/emergency-card', {
        params: {
          path: { planId: input.planId, groupId: input.groupId },
          query: { purpose: input.purpose },
        },
      }),
    invalidates: [],
  })
}
