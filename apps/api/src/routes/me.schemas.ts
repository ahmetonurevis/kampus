import { z } from 'zod'

import { INSTITUTION_TYPES, roleSchema } from '../auth.ts'
import { MEMBERSHIP_LINK_KINDS } from '../db/schema/membership-links.ts'
import { dataResponse } from './common.schemas.ts'

export const institutionTypeSchema = z
  .enum(INSTITUTION_TYPES)
  .describe('Kurum türü: `school` ders + kazanım, `language_school` CEFR + beceri')

export const membershipLinkSchema = z
  .object({
    kind: z
      .enum(MEMBERSHIP_LINK_KINDS)
      .describe('Bağlantı türü: öğrenci kendi kaydı, veli çocuğu, öğretmen kaydı'),
    recordId: z.string().describe('school-core kayıt kimliği'),
  })
  .meta({ id: 'MembershipLink' })

export const meSchema = z
  .object({
    user: z.object({
      id: z.string(),
      name: z.string().describe('Ad soyad'),
      email: z.string().describe('Giriş e-postası'),
    }),
    activeInstitution: z
      .object({
        id: z.string(),
        name: z.string(),
        slug: z.string(),
        type: institutionTypeSchema,
        enabledModules: z
          .record(z.string(), z.boolean())
          .describe(
            'Modül anahtarı → açık mı. school-core modül kaydındaki her modül listelenir; kapalı modülün API uçları 403 `module_disabled` döner',
          ),
        academicYear: z
          .number()
          .int()
          .nullable()
          .describe(
            'Etkin eğitim-öğretim yılının (dönemin) başlangıç yılı: 2026 → 2026–2027. Kurum ayarı yoksa `null`',
          ),
      })
      .nullable()
      .describe('Oturumun etkin kurumu; üyelik yoksa `null`'),
    activeMembership: z
      .object({ id: z.string(), role: roleSchema, links: z.array(membershipLinkSchema) })
      .nullable()
      .describe('Etkin kurumdaki üyelik ve school-core kayıt bağlantıları'),
    memberships: z
      .array(
        z.object({
          id: z.string(),
          institutionId: z.string(),
          institutionName: z.string(),
          institutionType: institutionTypeSchema,
          role: roleSchema,
        }),
      )
      .describe('Kullanıcının bütün kurum üyelikleri (kurum değiştirme için)'),
  })
  .meta({ id: 'Me' })

export const meResponseSchema = dataResponse(meSchema)
