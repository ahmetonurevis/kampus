import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { FIXED_ASSETS_KEY } from './use-finance-fixed-assets.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Demirbaş zimmeti kancaları (`/finance/fixed-asset-assignments`; DOM-FIN-086, ON-236). Anahtarlar
// demirbaş anahtarının altındadır: zimmet ve iade demirbaş listesindeki "zimmetli" sütununu da
// değiştirir, her yazma demirbaş anahtarının tamamını tazeler. Komutlar `exclusive`.

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

export type AssignFixedAssetBody = JsonBody<'assignFixedAsset'>
export type ReturnFixedAssetBody = JsonBody<'returnFixedAssetAssignment'>
export type FixedAssetAssignment =
  operations['getFixedAssetAssignment']['responses'][200]['content']['application/json']['data']
export type FixedAssetAssignmentQuery = Query<'listFixedAssetAssignments'>
export type FixedAssetAssignee =
  operations['listFixedAssetAssignees']['responses'][200]['content']['application/json']['data'][number]
export type FixedAssetAssigneeQuery = Query<'listFixedAssetAssignees'>

const ASSIGNMENTS_KEY = [...FIXED_ASSETS_KEY, 'assignments'] as const
const MESSAGES = {
  version_conflict: 'Zimmet başka biri tarafından değiştirildi. Liste güncellendi.',
}

export function useFixedAssetAssignments(query: FixedAssetAssignmentQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...ASSIGNMENTS_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/fixed-asset-assignments', { params: { query }, signal }),
    },
    { enabled },
  )
}

/** Zimmet alabilecek personel ve açık zimmet sayıları (form seçimi ve ilişik kesme listesi). */
export function useFixedAssetAssignees(query: FixedAssetAssigneeQuery, enabled = true) {
  return useApiQuery({
    key: [...ASSIGNMENTS_KEY, 'assignees', query],
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/fixed-asset-assignees', { params: { query }, signal }),
  })
}

export function useAssignFixedAsset() {
  return useApiCommand({
    request: (
      client,
      input: { assetId: string; body: AssignFixedAssetBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/fixed-assets/{assetId}/assignments', {
        params: {
          path: { assetId: input.assetId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: [FIXED_ASSETS_KEY],
    exclusive: true,
  })
}

export function useReturnFixedAsset() {
  return useApiCommand({
    request: (
      client,
      input: { assignmentId: string; version: number; body: ReturnFixedAssetBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/fixed-asset-assignments/{assignmentId}/return', {
        params: {
          path: { assignmentId: input.assignmentId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [FIXED_ASSETS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}
