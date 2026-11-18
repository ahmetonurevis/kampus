import type { operations } from '@kampus/api-client/schema.d.ts'

import type { CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'
import { MEDICAL_REPORTS_KEY } from './use-finance-medical-reports.ts'
import { PAY_RATES_KEY } from './use-finance-pay-rates.ts'
import { PAYROLL_EXPORTS_KEY } from './use-finance-payroll-exports.ts'
import { PAYROLL_PERIODS_KEY } from './use-finance-payroll-periods.ts'
import { STAFF_CERTIFICATES_KEY } from './use-finance-staff-certificates.ts'
import { STAFF_DEDUCTIONS_KEY } from './use-finance-staff-deductions.ts'
import { STAFF_DOCUMENTS_KEY } from './use-finance-staff-documents.ts'
import { STAFF_LEAVE_KEY } from './use-finance-staff-leave.ts'
import { WORK_PERMITS_KEY } from './use-finance-work-permits.ts'

// Özlük verisi saklama ve imha kancaları (`/finance/staff-retention-*`, `/finance/staff-data-
// destructions`; DOM-FIN-122, ON-176). İmha taze oturum ister (çağıran `useReauthRetry` ile sarar)
// ve imha edilen kayıtların sekmelerini de tazeler.

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

export type UpdateStaffRetentionPoliciesBody = JsonBody<'updateStaffRetentionPolicies'>
export type DestroyStaffDataBody = JsonBody<'destroyStaffData'>
export type StaffRetentionPolicyRow = Ok<'getStaffRetentionPolicies'>['data'][number]
export type StaffRetentionCandidateRow = Ok<'listStaffRetentionCandidates'>['data'][number]
export type StaffDataDestructionRow = Ok<'listStaffDataDestructions'>['data'][number]
export type StaffRetentionCandidateQuery = Query<'listStaffRetentionCandidates'>
export type StaffDataDestructionQuery = Query<'listStaffDataDestructions'>

export const STAFF_RETENTION_KEY = ['finance', 'staff-retention'] as const

export function useStaffRetentionPolicies(enabled = true) {
  return useApiQuery({
    key: [...STAFF_RETENTION_KEY, 'policies'],
    enabled,
    request: (client, signal) => client.GET('/api/v1/finance/staff-retention-policies', { signal }),
  })
}

export function useStaffRetentionCandidates(query: StaffRetentionCandidateQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...STAFF_RETENTION_KEY, 'candidates', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/staff-retention-candidates', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useStaffDataDestructions(query: StaffDataDestructionQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...STAFF_RETENTION_KEY, 'destructions', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/staff-data-destructions', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useUpdateStaffRetentionPolicies() {
  return useApiCommand({
    request: (client, body: UpdateStaffRetentionPoliciesBody, headers: CommandHeaders) =>
      client.PATCH('/api/v1/finance/staff-retention-policies', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [STAFF_RETENTION_KEY],
    exclusive: true,
  })
}

/** Onaylı imha; imha edilen kategorinin sekmeleri (belgeler, raporlar, ücret …) de tazelenir. */
export function useDestroyStaffData() {
  return useApiCommand({
    request: (client, body: DestroyStaffDataBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/staff-data-destructions', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [
      STAFF_RETENTION_KEY,
      STAFF_DOCUMENTS_KEY,
      MEDICAL_REPORTS_KEY,
      STAFF_CERTIFICATES_KEY,
      WORK_PERMITS_KEY,
      STAFF_LEAVE_KEY,
      PAY_RATES_KEY,
      STAFF_DEDUCTIONS_KEY,
      PAYROLL_PERIODS_KEY,
      PAYROLL_EXPORTS_KEY,
    ],
    exclusive: true,
  })
}
