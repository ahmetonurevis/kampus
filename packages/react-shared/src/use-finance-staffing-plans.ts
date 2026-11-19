import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

// Kadro planı ve açık pozisyon kancaları (`/finance/staffing-plans`, `/finance/staffing-positions`;
// DOM-FIN-126, ON-188). Plan yanıtı pozisyonları da taşır; bütün yazmalar planı tazeler.

export type StaffingPlan =
  operations['getStaffingPlan']['responses'][200]['content']['application/json']['data']
export type StaffingRow = StaffingPlan['rows'][number]
export type StaffingPosition = StaffingPlan['positions'][number]
export type StaffingPlanBody = NonNullable<
  operations['saveStaffingPlan']['requestBody']
>['content']['application/json']
export type StaffingPositionBody = NonNullable<
  operations['createStaffingPosition']['requestBody']
>['content']['application/json']
export type StaffingPositionUpdateBody = NonNullable<
  operations['updateStaffingPosition']['requestBody']
>['content']['application/json']

export const STAFFING_PLAN_KEY = ['finance', 'staffing-plans'] as const
const MESSAGES = {
  version_conflict: 'Kadro planı başka biri tarafından değiştirildi. Plan güncellendi.',
}

/** Eğitim yılının planı ve hesabı; `weekOf` ders programı önerisinin haftası. */
export function useStaffingPlan(academicYear: number, weekOf: string | undefined) {
  return useApiQuery({
    key: [...STAFFING_PLAN_KEY, academicYear, weekOf ?? null],
    request: (client, signal) =>
      client.GET('/api/v1/finance/staffing-plans/{academicYear}', {
        params: { path: { academicYear }, query: weekOf === undefined ? {} : { weekOf } },
        signal,
      }),
  })
}

/** Norm ve branş satırlarını bütün olarak kaydeder; `If-Match` plan sürümü. */
export function useSaveStaffingPlan() {
  return useApiCommand({
    request: (
      client,
      input: { academicYear: number; version: number; body: StaffingPlanBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/staffing-plans/{academicYear}', {
        params: {
          path: { academicYear: input.academicYear },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [STAFFING_PLAN_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Açık pozisyon açar (`Idempotency-Key`). */
export function useCreateStaffingPosition() {
  return useApiCommand({
    request: (client, body: StaffingPositionBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/staffing-positions', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [STAFFING_PLAN_KEY],
    exclusive: true,
  })
}

/** Pozisyon durumu ve alanları; `If-Match` pozisyon sürümü. */
export function useUpdateStaffingPosition() {
  return useApiCommand({
    request: (
      client,
      input: { id: string; version: number; body: StaffingPositionUpdateBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/staffing-positions/{positionId}', {
        params: {
          path: { positionId: input.id },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [STAFFING_PLAN_KEY],
    version: (input) => input.version,
    messages: {
      version_conflict: 'Pozisyon başka biri tarafından değiştirildi. Liste güncellendi.',
    },
  })
}
