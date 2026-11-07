import { z } from 'zod'

import {
  CUSTODY_KIND_KEYS,
  GUARDIAN_RELATIONSHIP_KEYS,
  linkGuardianSchema,
  updateGuardianLinkSchema,
} from '@kampus/school-core/lib/guardianship.ts'

import { dataResponse } from './common.schemas.ts'

/**
 * Veli–öğrenci bağı uçlarının şemaları (IST-019; DOM-ILT-070…075). Gövdeler core
 * `linkGuardianSchema` ve `updateGuardianLinkSchema`'dır (katı; gövdede `institutionId` ve
 * öğrenci kimliği 400). Okuma yanıtı veliye daraltılmış görünüm döner (DOM-ILT-073): kısıt alanı
 * ve kayıt bilgileri (`createdAt`, `updatedAt`, `rowVersion`) yalnız yönetici ve ön büroya gelir.
 */

const recordId = (description: string) => z.string().min(1).max(200).describe(description)

export const studentGuardianListParamsSchema = z.object({
  studentId: recordId('Öğrenci kimliği'),
})

export const studentGuardianParamsSchema = studentGuardianListParamsSchema.extend({
  linkId: z.uuid().describe('Veli bağı kimliği'),
})

export const linkGuardianBodySchema = linkGuardianSchema
export const updateGuardianBodySchema = updateGuardianLinkSchema

const bondFields = {
  id: z.uuid(),
  // kvkk: K
  studentId: z.string(),
  // kvkk: K
  parentId: z.string().nullable().describe('Veli kaydı (`parents`); hesabı olmayan veli için'),
  // kvkk: K
  membershipId: z.string().nullable().describe('Veli hesabının üyeliği'),
  relationship: z
    .enum(GUARDIAN_RELATIONSHIP_KEYS)
    .describe('`mother`, `father`, `legal_guardian` (vasi), `other`'),
  // kvkk: Ç
  custody: z
    .enum(CUSTODY_KIND_KEYS)
    .describe('Velayet: `full` sahibi, `joint` ortak, `none` velayeti yok (DOM-ILT-070)'),
  isPayer: z.boolean().describe('Öğrencinin tek ödeyicisi (DOM-ILT-074)'),
  canPickUp: z.boolean().describe('Öğrenciyi teslim alma yetkisi'),
}

/** Liste öğesi: veliye kendi bağı kısıt ve kayıt alanları olmadan döner. */
export const studentGuardianListItemSchema = z
  .object({
    ...bondFields,
    // kvkk: Ç
    contactRestricted: z
      .boolean()
      .optional()
      .describe('İletişim kısıtı (DOM-ILT-074); yalnız yönetici ve ön büroya döner'),
    createdAt: z.iso.datetime().optional().describe('Yalnız yönetici ve ön büroya döner'),
    updatedAt: z.iso.datetime().optional().describe('Yalnız yönetici ve ön büroya döner'),
    rowVersion: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Düzenleme ve kaldırmada `If-Match` değeri; yalnız yönetici ve ön büroya döner'),
  })
  .meta({ id: 'StudentGuardianListItem' })

/** Yazma yanıtı (yönetici ve ön büro): bağın tamamı. */
export const studentGuardianSchema = z
  .object({
    ...bondFields,
    // kvkk: Ç
    contactRestricted: z.boolean().describe('İletişim kısıtı (DOM-ILT-074)'),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    archivedAt: z.iso.datetime().nullable().describe('Kaldırıldıysa an; etkin bağda `null`'),
    rowVersion: z.number().int().min(1).describe('Düzenleme ve kaldırmada `If-Match` değeri'),
  })
  .meta({ id: 'StudentGuardian' })

export const studentGuardianListResponseSchema = dataResponse(
  z.array(studentGuardianListItemSchema),
)
export const studentGuardianResponseSchema = dataResponse(studentGuardianSchema)
