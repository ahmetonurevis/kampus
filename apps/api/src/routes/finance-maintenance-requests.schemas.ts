import { z } from 'zod'

import { FIXED_ASSET_CATEGORIES } from '@kampus/school-core/lib/finance-fixed-assets.ts'
import {
  MAINTENANCE_ASSIGNEE_TYPES,
  MAINTENANCE_EVENTS,
  MAINTENANCE_PRIORITIES,
  MAINTENANCE_STATES,
  MAINTENANCE_STATUSES,
} from '@kampus/school-core/lib/finance-maintenance-requests.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/**
 * Arıza ve bakım talebi şemaları (DOM-FIN-089; ON-239). Maliyet (`resolutionCostCents`) yalnız
 * yöneticinin yanıtında bulunur; ön büro ve öğretmen yanıtında anahtar yoktur (K-238).
 */

const assigneeSchema = z
  .object({
    type: z.enum(MAINTENANCE_ASSIGNEE_TYPES).describe('`staff` personel, `supplier` tedarikçi'),
    id: z.string().describe('Personel üyeliği ya da tedarikçi kimliği'),
    name: z.string().nullable().describe('Personel adı ya da tedarikçi unvanı'),
  })
  .nullable()

const actionsSchema = z
  .object({
    assign: z.boolean(),
    start: z.boolean(),
    resolve: z.boolean(),
    close: z.boolean(),
    cancel: z.boolean(),
  })
  .describe('Oturumdaki rolün bu talepte yapabileceği işlemler (ekran düğmeleri)')

const requestSchema = z.object({
  id: z.string(),
  number: z.string().describe('Talep numarası (`AT-0007`)'),
  title: z.string(),
  description: z.string(),
  campusId: z.string().nullable(),
  campusName: z.string().nullable().describe('Kampüs adı; kampüs yoksa ya da arşivlendiyse boş'),
  location: z.string().describe('Oda ya da yer'),
  asset: z
    .object({
      id: z.string(),
      tagNumber: z.string(),
      name: z.string(),
      category: z.enum(FIXED_ASSET_CATEGORIES).nullable(),
    })
    .nullable()
    .describe('Bağlı demirbaş (DOM-FIN-085)'),
  priority: z.enum(MAINTENANCE_PRIORITIES),
  status: z.enum(MAINTENANCE_STATUSES),
  reportedByName: z.string().nullable().describe('Bildiren kişinin adı'),
  reportedByMe: z.boolean().describe('Oturumdaki kullanıcı bildirdiyse `true`'),
  reportedAt: z.string(),
  assignee: assigneeSchema.describe('Şimdiki sorumlu; atanmamışsa boş'),
  assignedAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  resolvedDate: z.string().nullable().describe('Çözüm günü (YYYY-MM-DD)'),
  resolution: z.string().nullable().describe('Yapılan iş'),
  resolutionCostCents: z
    .number()
    .int()
    .nullable()
    .optional()
    .describe('Onarım maliyeti, kuruş; yalnız yönetici yanıtında bulunur (K-238)'),
  resolutionSupplier: z
    .object({ id: z.string(), name: z.string() })
    .nullable()
    .describe('İşi yapan tedarikçi'),
  closedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  actions: actionsSchema,
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})

const eventSchema = z.object({
  id: z.string(),
  event: z.enum(MAINTENANCE_EVENTS),
  fromStatus: z.enum(MAINTENANCE_STATUSES).nullable(),
  toStatus: z.enum(MAINTENANCE_STATUSES),
  note: z.string().nullable().describe('Adımın notu; çözümde yapılan iş, iptalde gerekçe'),
  actorName: z.string().nullable().describe('Adımı yapan kişi'),
  assignee: assigneeSchema.describe('Atama adımında sorumlu'),
  occurredAt: z.string(),
})

export const maintenanceResponse = dataResponse(
  requestSchema.extend({
    events: z.array(eventSchema).describe('İş emri geçmişi, eskiden yeniye (K-237)'),
  }),
)
export const maintenanceListResponse = z.object({
  data: z.array(requestSchema),
  meta: pageMetaSchema,
})

export const maintenanceParams = z.object({ requestId: z.uuid('Talep geçersiz.') })

export const maintenanceListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .optional()
    .describe('Başlık, yer, demirbaş etiketi ve adında ya da talep numarasında arama'),
  status: z.enum(MAINTENANCE_STATUSES).optional().describe('Durum'),
  state: z
    .enum(MAINTENANCE_STATES)
    .optional()
    .describe('`active` kapatılmamış ve iptal edilmemiş, `done` kapatılmış ya da iptal edilmiş'),
  priority: z.enum(MAINTENANCE_PRIORITIES).optional().describe('Öncelik'),
  assetId: z.uuid().optional().describe('Demirbaşın arıza geçmişi'),
})
