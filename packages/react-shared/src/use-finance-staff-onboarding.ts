import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// İş teklifi ve işe başlama listesi kancaları (`/finance/job-offers`,
// `/finance/staff-onboarding-settings`; DOM-FIN-121, ON-179). Yalnız yönetici (K-412). Her yazma
// işe başlama anahtarının tamamını tazeler; adım işlemleri teklifin sürümüyle (`If-Match`)
// yapılır. Komutlar `exclusive`.

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

export type CreateJobOfferBody = JsonBody<'createJobOffer'>
export type UpdateJobOfferBody = JsonBody<'updateJobOffer'>
export type JobOfferDetail = Ok<'getJobOffer'>['data']
export type JobOfferRow = Ok<'listJobOffers'>['data'][number]
export type JobOfferQuery = Query<'listJobOffers'>
export type OnboardingStep = JobOfferDetail['steps'][number]
export type OnboardingSettings = Ok<'getStaffOnboardingSettings'>['data']
export type OnboardingStaffOption = Ok<'listStaffOnboardingStaff'>['data'][number]
export type JobOfferLetter = Ok<'getJobOfferLetter'>['data']
export type JobOfferVerb = 'send' | 'accept' | 'reject' | 'withdraw'

export const STAFF_ONBOARDING_KEY = ['finance', 'staff-onboarding'] as const
const MESSAGES = {
  version_conflict: 'Teklif başka biri tarafından değiştirildi. Bilgiler güncellendi.',
}

export function useJobOffers(query: JobOfferQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...STAFF_ONBOARDING_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/job-offers', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useJobOffer(offerId: string, enabled = true) {
  return useApiQuery({
    key: [...STAFF_ONBOARDING_KEY, 'detail', offerId],
    enabled: enabled && offerId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/job-offers/{offerId}', {
        params: { path: { offerId } },
        signal,
      }),
  })
}

export function useOnboardingSettings(enabled = true) {
  return useApiQuery({
    key: [...STAFF_ONBOARDING_KEY, 'settings'],
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/staff-onboarding-settings', { signal }),
  })
}

export function useOnboardingStaff(enabled = true) {
  return useApiQuery({
    key: [...STAFF_ONBOARDING_KEY, 'staff'],
    enabled,
    request: (client, signal) => client.GET('/api/v1/finance/staff-onboarding-staff', { signal }),
  })
}

export function useCreateJobOffer() {
  return useApiCommand({
    request: (client, body: CreateJobOfferBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/job-offers', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [STAFF_ONBOARDING_KEY],
    exclusive: true,
  })
}

const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useUpdateJobOffer() {
  return useApiCommand({
    request: (
      client,
      input: { offerId: string; version: number; body: UpdateJobOfferBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/job-offers/{offerId}', {
        params: { path: { offerId: input.offerId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [STAFF_ONBOARDING_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Durum geçişi: gönder (`sentOn`), kabul, ret, geri çek (`decidedOn`, isteğe bağlı `reason`). */
export function useJobOfferTransition() {
  return useApiCommand({
    request: (
      client,
      input: {
        offerId: string
        version: number
        verb: JobOfferVerb
        day: string
        reason?: string | null
      },
      headers: CommandHeaders,
    ) => {
      const params = { path: { offerId: input.offerId }, header: versioned(headers) }
      const decision = { decidedOn: input.day, reason: input.reason ?? null }
      switch (input.verb) {
        case 'send':
          return client.POST('/api/v1/finance/job-offers/{offerId}/send', {
            params,
            body: { sentOn: input.day },
          })
        case 'accept':
          return client.POST('/api/v1/finance/job-offers/{offerId}/accept', {
            params,
            body: { decidedOn: input.day },
          })
        case 'reject':
          return client.POST('/api/v1/finance/job-offers/{offerId}/reject', {
            params,
            body: decision,
          })
        case 'withdraw':
          return client.POST('/api/v1/finance/job-offers/{offerId}/withdraw', {
            params,
            body: decision,
          })
        default:
          return input.verb satisfies never
      }
    },
    invalidates: [STAFF_ONBOARDING_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useLinkJobOfferAccount() {
  return useApiCommand({
    request: (
      client,
      input: { offerId: string; version: number; membershipId: string },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/job-offers/{offerId}/link-account', {
        params: { path: { offerId: input.offerId }, header: versioned(headers) },
        body: { membershipId: input.membershipId },
      }),
    invalidates: [STAFF_ONBOARDING_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useUpdateOnboardingStep() {
  return useApiCommand({
    request: (
      client,
      input: {
        offerId: string
        stepId: string
        version: number
        body: JsonBody<'updateOnboardingStep'>
      },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/job-offers/{offerId}/steps/{stepId}', {
        params: {
          path: { offerId: input.offerId, stepId: input.stepId },
          header: versioned(headers),
        },
        body: input.body,
      }),
    invalidates: [STAFF_ONBOARDING_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCompleteOnboardingStep() {
  return useApiCommand({
    request: (
      client,
      input: {
        offerId: string
        stepId: string
        version: number
        completedOn: string
        note: string | null
      },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/job-offers/{offerId}/steps/{stepId}/complete', {
        params: {
          path: { offerId: input.offerId, stepId: input.stepId },
          header: versioned(headers),
        },
        body: { completedOn: input.completedOn, note: input.note },
      }),
    invalidates: [STAFF_ONBOARDING_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useReopenOnboardingStep() {
  return useApiCommand({
    request: (
      client,
      input: { offerId: string; stepId: string; version: number },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/job-offers/{offerId}/steps/{stepId}/reopen', {
        params: {
          path: { offerId: input.offerId, stepId: input.stepId },
          header: versioned(headers),
        },
      }),
    invalidates: [STAFF_ONBOARDING_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Oryantasyon ayarı; ilk yazma `If-Match` almaz (sürüm `null`). */
export function useUpdateOnboardingSettings() {
  return useApiCommand({
    request: (
      client,
      input: { version: number | null; body: JsonBody<'updateStaffOnboardingSettings'> },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/staff-onboarding-settings', {
        params: {
          header: {
            'idempotency-key': headers['idempotency-key'],
            ...(input.version === null ? {} : { 'if-match': requireIfMatch(headers) }),
          },
        },
        body: input.body,
      }),
    invalidates: [STAFF_ONBOARDING_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
