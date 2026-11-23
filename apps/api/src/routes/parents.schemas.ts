import { z } from 'zod'

import { PARENT_CONTACT_FIELDS } from '@kampus/school-core/lib/parent-contact.ts'

import { dataResponse } from './common.schemas.ts'

/** Veli uçlarının yol ve yanıt şemaları; gövde şeması core'dadır (`revealParentContactSchema`). */

export const parentParamsSchema = z.object({
  parentId: z.string().min(1).max(200).describe('Veli kaydının kimliği'),
})

export const revealedParentContactSchema = z
  .object({
    parentId: z.string(),
    studentId: z.string().describe('Velisi açılan öğrenci (kapsamla denetlendi)'),
    field: z.enum(PARENT_CONTACT_FIELDS).describe('Açılan alan'),
    // kvkk: K — tam değer; istemcide yalnız bellekte tutulur, önbelleğe alınmaz.
    value: z.string().describe('Alanın maskesiz değeri'),
  })
  .meta({ id: 'RevealedParentContact' })

export const revealParentContactResponseSchema = dataResponse(revealedParentContactSchema)
