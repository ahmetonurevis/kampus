import { z } from 'zod'

import {
  COORDINATOR_DUTY_KINDS,
  coordinatorDutyInputSchema,
} from '@kampus/school-core/lib/coordinator-duties.ts'

import { dataResponse, pageQuerySchema, pageResponse } from './common.schemas.ts'

/**
 * Zümre başkanı ve akademik koordinatör görevi (DOM-YTK-027). Gövde core
 * `coordinatorDutyInputSchema`'dır (katı); görev türü kurum türünden gelir, istemci veremez.
 */

export const coordinatorDutyParamsSchema = z.object({
  dutyId: z.uuid().describe('Görev kimliği'),
})

export const coordinatorDutyListQuerySchema = pageQuerySchema
  .extend({
    membershipId: z.string().min(1).max(200).optional().describe('Üyelik süzgeci'),
  })
  .strict()

export const coordinatorDutyBodySchema = coordinatorDutyInputSchema

export const coordinatorDutySchema = z
  .object({
    id: z.uuid(),
    membershipId: z.string().describe('Görevli öğretmenin üyeliği'),
    kind: z
      .enum(Object.keys(COORDINATOR_DUTY_KINDS) as [keyof typeof COORDINATOR_DUTY_KINDS])
      .describe('`subject_head` zümre başkanı (school), `academic_coordinator` (language_school)'),
    scopeId: z.string().describe('Ders kimliği (`subject_head`) veya CEFR seviyesi'),
    createdAt: z.iso.datetime(),
    archivedAt: z.iso.datetime().nullable().describe('Kaldırıldıysa an; etkin görevde `null`'),
    rowVersion: z.number().int().min(1).describe('Kaldırmada `If-Match` değeri'),
  })
  .meta({ id: 'CoordinatorDuty' })

export const coordinatorDutyResponseSchema = dataResponse(coordinatorDutySchema)
export const coordinatorDutyListResponseSchema = pageResponse(coordinatorDutySchema)
