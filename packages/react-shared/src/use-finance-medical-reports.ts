import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Personel sağlık raporu kancaları (`/finance/medical-reports`, `/finance/medical-report-summary`;
// DOM-FIN-110, ON-185). Sağlık verisidir (K-363): okumalar denetime düşer, tanı alanı yoktur. Her
// yazma rapor anahtarının tamamını tazeler. Komutlar `exclusive`.

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

export type CreateMedicalReportBody = JsonBody<'createMedicalReport'>
export type UpdateMedicalReportBody = JsonBody<'updateMedicalReport'>
export type MedicalReport =
  operations['listMedicalReports']['responses'][200]['content']['application/json']['data'][number]
export type MedicalReportQuery = Query<'listMedicalReports'>
export type MedicalReportSummaryRow =
  operations['getMedicalReportSummary']['responses'][200]['content']['application/json']['data'][number]
export type MedicalReportSummaryQuery = Query<'getMedicalReportSummary'>

export const MEDICAL_REPORTS_KEY = ['finance', 'medical-reports'] as const
const MESSAGES = {
  version_conflict: 'Rapor başka biri tarafından değiştirildi. Liste güncellendi.',
}

export function useMedicalReports(query: MedicalReportQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...MEDICAL_REPORTS_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/medical-reports', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useMedicalReportSummary(query: MedicalReportSummaryQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...MEDICAL_REPORTS_KEY, 'summary', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/medical-report-summary', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useCreateMedicalReport() {
  return useApiCommand({
    request: (client, body: CreateMedicalReportBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/medical-reports', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [MEDICAL_REPORTS_KEY],
    exclusive: true,
  })
}

export function useUpdateMedicalReport() {
  return useApiCommand({
    request: (
      client,
      input: { reportId: string; version: number; body: UpdateMedicalReportBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/medical-reports/{reportId}', {
        params: {
          path: { reportId: input.reportId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [MEDICAL_REPORTS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCancelMedicalReport() {
  return useApiCommand({
    request: (
      client,
      input: { reportId: string; version: number; reason: string },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/medical-reports/{reportId}/cancel', {
        params: {
          path: { reportId: input.reportId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: { reason: input.reason },
      }),
    invalidates: [MEDICAL_REPORTS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
