import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

// Organizasyon şeması kancaları (`/finance/org-*`; DOM-FIN-129, ON-187). Şema yanıtı birimleri,
// pozisyonları ve görevlileri taşır; bütün yazmalar şemayı tazeler. Yeni kayıtlar
// `Idempotency-Key`, değişiklikler `If-Match` ile gider.

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type OrgChart =
  operations['getOrgChart']['responses'][200]['content']['application/json']['data']
export type OrgUnit = OrgChart['units'][number]
export type OrgPosition = OrgChart['positions'][number]
export type OrgUnitBody = JsonBody<'createOrgUnit'>
export type OrgUnitUpdateBody = JsonBody<'updateOrgUnit'>
export type OrgPositionBody = JsonBody<'createOrgPosition'>
export type OrgAssignmentBody = JsonBody<'createOrgAssignment'>

export const ORG_CHART_KEY = ['finance', 'org-chart'] as const
const MESSAGES = {
  version_conflict: 'Kayıt başka biri tarafından değiştirildi. Şema güncellendi.',
}

export function useOrgChart() {
  return useApiQuery({
    key: [...ORG_CHART_KEY, 'chart'],
    request: (client, signal) => client.GET('/api/v1/finance/org-chart', { signal }),
  })
}

export function useCreateOrgUnit() {
  return useApiCommand({
    request: (client, body: OrgUnitBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/org-units', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [ORG_CHART_KEY],
    exclusive: true,
  })
}

export function useUpdateOrgUnit() {
  return useApiCommand({
    request: (
      client,
      input: { unitId: string; version: number; body: OrgUnitUpdateBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/org-units/{unitId}', {
        params: {
          path: { unitId: input.unitId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [ORG_CHART_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCreateOrgPosition() {
  return useApiCommand({
    request: (client, body: OrgPositionBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/org-positions', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [ORG_CHART_KEY],
    exclusive: true,
  })
}

export function useCreateOrgAssignment() {
  return useApiCommand({
    request: (client, body: OrgAssignmentBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/org-assignments', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [ORG_CHART_KEY],
    exclusive: true,
  })
}

export function useEndOrgAssignment() {
  return useApiCommand({
    request: (
      client,
      input: { assignmentId: string; version: number; endDate: string | null },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/org-assignments/{assignmentId}', {
        params: {
          path: { assignmentId: input.assignmentId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: { endDate: input.endDate },
      }),
    invalidates: [ORG_CHART_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
