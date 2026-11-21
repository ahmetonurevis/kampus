import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Revir ve ilaç onayı kancaları (`/finance/infirmary/*`; DOM-FIN-151, ON-101). Ziyaret, ilaç talebi
// ve uygulama `Idempotency-Key`; düzeltme, kapatma, onay, ret ve geri çekme `If-Match` ile gider.
// Her yazma anahtarın tamamını tazeler (liste, ayrıntı, durum ve gün planı birlikte değişir).
// Sağlık ayrıntısı dönen okumalar sunucuda denetime düşer.

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

export type InfirmaryVisitCreateBody = JsonBody<'createInfirmaryVisit'>
export type InfirmaryVisitUpdateBody = JsonBody<'updateInfirmaryVisit'>
export type InfirmaryDischargeBody = JsonBody<'dischargeInfirmaryVisit'>
export type MedicationConsentCreateBody = JsonBody<'createMedicationConsent'>
export type MedicationAdministrationBody = JsonBody<'recordMedicationAdministration'>
export type InfirmaryVisitRow = Ok<'listInfirmaryVisits'>['data'][number]
export type InfirmaryVisitDetail = Ok<'getInfirmaryVisit'>['data']
export type InfirmaryVisitState = Ok<'listInfirmaryVisitStates'>['data'][number]
export type GuardianInfirmaryVisit = Ok<'listGuardianInfirmaryVisits'>['data'][number]
export type MedicationConsentRow = Ok<'listMedicationConsents'>['data'][number]
export type MedicationConsentDetail = Ok<'getMedicationConsent'>['data']
export type MedicationScheduleSlot = Ok<'getMedicationSchedule'>['data'][number]
export type InfirmaryStaffMember = Ok<'listInfirmaryStaff'>['data'][number]
export type InfirmaryVisitQuery = Query<'listInfirmaryVisits'>
export type MedicationConsentQuery = Query<'listMedicationConsents'>
export type GuardianInfirmaryVisitQuery = Query<'listGuardianInfirmaryVisits'>
export type InfirmaryStaffQuery = Query<'listInfirmaryStaff'>

export const INFIRMARY_KEY = ['finance', 'infirmary'] as const
const VISIT_MESSAGES = {
  version_conflict: 'Ziyaret başka biri tarafından değiştirildi. Ziyaret güncellendi.',
}
const CONSENT_MESSAGES = {
  version_conflict: 'İlaç talebi başka biri tarafından değiştirildi. Talep güncellendi.',
}

export function useInfirmaryVisits(query: InfirmaryVisitQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...INFIRMARY_KEY, 'visits', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/infirmary/visits', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useInfirmaryVisit(visitId: string, enabled = true) {
  return useApiQuery({
    key: [...INFIRMARY_KEY, 'visit', visitId],
    enabled: enabled && visitId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/infirmary/visits/{visitId}', {
        params: { path: { visitId } },
        signal,
      }),
  })
}

export function useInfirmaryVisitStates(date: string | undefined, enabled = true) {
  return useApiQuery({
    key: [...INFIRMARY_KEY, 'states', date ?? 'today'],
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/infirmary/visit-states', {
        params: { query: date === undefined ? {} : { date } },
        signal,
      }),
  })
}

export function useGuardianInfirmaryVisits(query: GuardianInfirmaryVisitQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...INFIRMARY_KEY, 'my-visits', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/infirmary/my-visits', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useMedicationConsents(query: MedicationConsentQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...INFIRMARY_KEY, 'consents', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/infirmary/medication-consents', {
          params: { query },
          signal,
        }),
    },
    { enabled },
  )
}

export function useMedicationConsent(consentId: string, enabled = true) {
  return useApiQuery({
    key: [...INFIRMARY_KEY, 'consent', consentId],
    enabled: enabled && consentId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/infirmary/medication-consents/{consentId}', {
        params: { path: { consentId } },
        signal,
      }),
  })
}

export function useMedicationSchedule(date: string | undefined, enabled = true) {
  return useApiQuery({
    key: [...INFIRMARY_KEY, 'schedule', date ?? 'today'],
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/infirmary/medication-schedule', {
        params: { query: date === undefined ? {} : { date } },
        signal,
      }),
  })
}

export function useInfirmaryStaff(query: InfirmaryStaffQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...INFIRMARY_KEY, 'staff', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/infirmary/staff', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useCreateInfirmaryVisit() {
  return useApiCommand({
    request: (client, body: InfirmaryVisitCreateBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/infirmary/visits', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [INFIRMARY_KEY],
    exclusive: true,
  })
}

export function useUpdateInfirmaryVisit() {
  return useApiCommand({
    request: (
      client,
      input: { visitId: string; version: number; body: InfirmaryVisitUpdateBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/infirmary/visits/{visitId}', {
        params: {
          path: { visitId: input.visitId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [INFIRMARY_KEY],
    version: (input) => input.version,
    messages: VISIT_MESSAGES,
    exclusive: true,
  })
}

export function useDischargeInfirmaryVisit() {
  return useApiCommand({
    request: (
      client,
      input: { visitId: string; version: number; body: InfirmaryDischargeBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/infirmary/visits/{visitId}/discharge', {
        params: {
          path: { visitId: input.visitId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [INFIRMARY_KEY],
    version: (input) => input.version,
    messages: VISIT_MESSAGES,
    exclusive: true,
  })
}

export function useCreateMedicationConsent() {
  return useApiCommand({
    request: (client, body: MedicationConsentCreateBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/infirmary/medication-consents', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [INFIRMARY_KEY],
    exclusive: true,
  })
}

export function useApproveMedicationConsent() {
  return useApiCommand({
    request: (client, input: { consentId: string; version: number }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/infirmary/medication-consents/{consentId}/approve', {
        params: {
          path: { consentId: input.consentId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: {},
      }),
    invalidates: [INFIRMARY_KEY],
    version: (input) => input.version,
    messages: CONSENT_MESSAGES,
    exclusive: true,
  })
}

export function useRejectMedicationConsent() {
  return useApiCommand({
    request: (
      client,
      input: { consentId: string; version: number; reason: string },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/infirmary/medication-consents/{consentId}/reject', {
        params: {
          path: { consentId: input.consentId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: { reason: input.reason },
      }),
    invalidates: [INFIRMARY_KEY],
    version: (input) => input.version,
    messages: CONSENT_MESSAGES,
    exclusive: true,
  })
}

export function useWithdrawMedicationConsent() {
  return useApiCommand({
    request: (client, input: { consentId: string; version: number }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/infirmary/medication-consents/{consentId}/withdraw', {
        params: {
          path: { consentId: input.consentId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: {},
      }),
    invalidates: [INFIRMARY_KEY],
    version: (input) => input.version,
    messages: CONSENT_MESSAGES,
    exclusive: true,
  })
}

export function useRecordMedicationAdministration() {
  return useApiCommand({
    request: (
      client,
      input: { consentId: string; body: MedicationAdministrationBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/infirmary/medication-consents/{consentId}/administrations', {
        params: {
          path: { consentId: input.consentId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [INFIRMARY_KEY],
    exclusive: true,
  })
}
