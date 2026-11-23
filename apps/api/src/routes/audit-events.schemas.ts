import { z } from 'zod'

import { roleSchema } from '../auth.ts'
import { pageQuerySchema, pageResponse } from './common.schemas.ts'

const dayValue = (edge: string) =>
  z.iso.date().optional().describe(`Europe/Istanbul günü olarak ${edge} (\`YYYY-MM-DD\`, dahil)`)

export const auditEventListQuerySchema = pageQuerySchema
  .extend({
    dateFrom: dayValue('başlangıç'),
    dateTo: dayValue('bitiş'),
    createdBefore: z.iso
      .datetime()
      .optional()
      .describe(
        'Üst zaman sınırı (ISO 8601 UTC, hariç): yalnız bu andan önce yazılmış kayıtlar. Sayfalı dışa aktarma ilk istekte sabitler; böylece sürerken yazılan yeni kayıtlar sayfaları kaydırıp mükerrer satır üretmez. `dateTo` ile birlikte kullanılırsa ikisi de uygulanır',
      ),
    actorUserId: z
      .string()
      .min(1)
      .max(128)
      .optional()
      .describe('Yapan kişinin kullanıcı kimliği (`institution-members` listesindeki `userId`)'),
    entityType: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/)
      .optional()
      .describe('Varlık türü (ör. `invoices`, `module`); eşitlik'),
  })
  .strict()
  .refine((query) => !query.dateFrom || !query.dateTo || query.dateFrom <= query.dateTo, {
    path: ['dateTo'],
    message: 'Bitiş günü başlangıç gününden önce olamaz.',
  })

export const auditEventActorSchema = z
  .object({
    userId: z.string(),
    name: z.string().nullable().describe('Kullanıcının görünen adı; hesap yoksa `null`'),
    role: roleSchema.nullable().describe('İşlem anındaki rol; kayıtlı değilse üyelik rolü'),
  })
  .meta({ id: 'AuditEventActor' })

export const auditEventSchema = z
  .object({
    id: z.string(),
    createdAt: z.iso.datetime().describe('İşlemin anı (UTC)'),
    action: z.string().describe('İşlem adı (ör. `module.set`, `workflow.goal`)'),
    entityType: z
      .string()
      .nullable()
      .describe('Varlık türü; rehberlik kayıtlarında `guidanceCases`'),
    entityId: z
      .string()
      .nullable()
      .describe('Varlık kimliği; rehberlik kayıtlarında (DOM-YTK-020) hiçbir zaman dönmez'),
    actor: auditEventActorSchema.nullable().describe('Yapan kişi; sistem olaylarında `null`'),
    fields: z
      .array(z.string())
      .describe('Değişen alan adları (değerler hiçbir zaman dönmez); rehberlikte boştur'),
    reason: z
      .string()
      .nullable()
      .describe(
        'Gerekçeli hassas okumanın (DOM-YTK-052) ya da ders iptali ve yedek görevlendirmenin (DOM-YTK-069) gerekçesi; diğer kayıtlarda `null`',
      ),
  })
  .meta({ id: 'AuditEvent' })

export const auditEventListResponseSchema = pageResponse(auditEventSchema)
