import { z } from 'zod'

import { roleSchema } from '../auth.ts'
import { MEMBERSHIP_LINK_KINDS } from '../db/schema/membership-links.ts'
import { pageQuerySchema, pageResponse } from './common.schemas.ts'

export const MEMBER_STATUSES = ['active', 'passive'] as const
export const MEMBER_SORTS = ['name', '-name', 'role', '-role', 'createdAt', '-createdAt'] as const

export const institutionMemberListQuerySchema = pageQuerySchema
  .extend({
    q: z
      .string()
      .trim()
      .min(2)
      .max(100)
      .optional()
      .describe('Ad veya e-postada arama (Türkçe harf ve büyük/küçük harf duyarsız)'),
    role: roleSchema.optional().describe('Role göre süz'),
    status: z
      .enum(MEMBER_STATUSES)
      .optional()
      .describe(
        'Duruma göre süz. `passive`: bağlı kişi kaydı (öğrenci, çocuk, öğretmen) olan ve hepsi pasif ya da arşivli üyelik',
      ),
    sort: z
      .enum(MEMBER_SORTS)
      .default('name')
      .describe('Sıralama; eksi azalan. Eşitlikte üyelik kimliği'),
  })
  .strict()

export const institutionMemberLinkSchema = z
  .object({
    kind: z
      .enum(MEMBERSHIP_LINK_KINDS)
      .describe('Bağlantı türü: öğrenci, çocuk (veli) veya öğretmen'),
    name: z.string().nullable().describe('Bağlı kişinin adı; kayıt yoksa `null`'),
  })
  .meta({ id: 'InstitutionMemberLink' })

export const institutionMemberSchema = z
  .object({
    id: z.string().describe('Üyelik kimliği'),
    userId: z.string(),
    name: z.string().describe('Görünen ad'),
    email: z.string().describe('Giriş e-postası; yalnız yöneticiye döner'),
    role: roleSchema,
    status: z.enum(MEMBER_STATUSES),
    links: z.array(institutionMemberLinkSchema).describe('Bağlı öğrenci, çocuk veya öğretmen'),
    createdAt: z.iso.datetime().describe('Üyeliğin açıldığı an (UTC)'),
  })
  .meta({ id: 'InstitutionMember' })

export const institutionMemberListResponseSchema = pageResponse(institutionMemberSchema)
