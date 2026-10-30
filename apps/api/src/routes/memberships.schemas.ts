import { z } from 'zod'

import { roleSchema } from '../auth.ts'
import { pageQuerySchema, pageResponse } from './common.schemas.ts'

export const membershipListQuerySchema = pageQuerySchema
  .extend({ role: roleSchema.optional().describe('Role göre süz') })
  .strict()

export const institutionMembershipSchema = z
  .object({
    id: z.string().describe('Üyelik kimliği'),
    userId: z.string(),
    name: z.string().describe('Ad soyad'),
    email: z.string().describe('Giriş e-postası'),
    role: roleSchema,
    createdAt: z.iso.datetime().describe('Üyeliğin açıldığı an (UTC)'),
  })
  .meta({ id: 'InstitutionMembership' })

export const membershipListResponseSchema = pageResponse(institutionMembershipSchema)
