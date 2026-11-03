import { z } from 'zod'

import { staffRoleSchema } from '@kampus/school-core/lib/staff-accounts.ts'

import { roleSchema } from '../auth.ts'
import { MEMBERSHIP_LINK_KINDS } from '../db/schema/membership-links.ts'
import { dataResponse, pageQuerySchema, pageResponse } from './common.schemas.ts'

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
        'Duruma göre süz. `passive`: yöneticinin pasifleştirdiği üyelik ya da bağlı kişi kaydı (öğrenci, çocuk, öğretmen) olan ve hepsi pasif ya da arşivli üyelik',
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
    deactivatedAt: z.iso
      .datetime()
      .nullable()
      .describe('Yöneticinin hesabı pasifleştirdiği an (UTC); etkin hesapta `null` (DOM-YTK-070)'),
    createdAt: z.iso.datetime().describe('Üyeliğin açıldığı an (UTC)'),
  })
  .meta({ id: 'InstitutionMember' })

export const institutionMemberListResponseSchema = pageResponse(institutionMemberSchema)

export const institutionMemberResponseSchema = dataResponse(institutionMemberSchema)

export const institutionMemberParamsSchema = z.object({
  membershipId: z.string().min(1).max(200).describe('Üyelik kimliği'),
})

export const staffInvitationParamsSchema = z.object({
  invitationId: z.string().min(1).max(200).describe('Davet kimliği'),
})

export const staffInvitationListQuerySchema = pageQuerySchema.strict()

export const staffInvitationSchema = z
  .object({
    id: z.string().describe('Davet kimliği'),
    // Üyelik kimliği ve kullanıcı tablosundaki ad dönmez: e-postanın başka kurumda hesabı olup
    // olmadığını belli ederdi (DOM-YTK-070, karar 73).
    name: z.string().nullable().describe('Yöneticinin davette girdiği ad'),
    email: z.string().describe('Davet e-postası; yalnız yöneticiye döner'),
    role: staffRoleSchema,
    status: z
      .enum(['pending', 'accepted', 'canceled', 'rejected'])
      .describe('`pending`: kişi henüz giriş yapmadı; `accepted`: ilk girişini yaptı'),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso
      .datetime()
      .describe('Davet işaretinin süresi; davetle açılan hesap ve üyelik süreden bağımsızdır'),
  })
  .meta({ id: 'StaffInvitation' })

export const staffInvitationResponseSchema = dataResponse(staffInvitationSchema)
export const staffInvitationListResponseSchema = pageResponse(staffInvitationSchema)
