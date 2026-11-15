import { z } from 'zod'

import {
  MAINTENANCE_INSPECTION_RESULTS,
  MAINTENANCE_PLAN_DUE_FILTERS,
  MAINTENANCE_PLAN_DUE_STATUSES,
  MAINTENANCE_PLAN_RESPONSIBLE_TYPES,
  MAINTENANCE_PLAN_TYPES,
} from '@kampus/school-core/lib/finance-maintenance-plans.ts'
import { MAINTENANCE_STATUSES } from '@kampus/school-core/lib/finance-maintenance-requests.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/**
 * Periyodik bakım planı şemaları (DOM-FIN-092; ON-240). Takvim alanları (`lastDoneDate`,
 * `nextDueDate`, `dueStatus`, `daysLeft`) saklanmaz, her okumada hesaplanır (K-253).
 */

const planSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(MAINTENANCE_PLAN_TYPES),
  campusId: z.string().nullable(),
  campusName: z.string().nullable().describe('Kampüs adı; kampüs yoksa ya da arşivlendiyse boş'),
  location: z.string().describe('Donanımın yeri'),
  asset: z
    .object({ id: z.string(), tagNumber: z.string(), name: z.string() })
    .nullable()
    .describe('Bağlı demirbaş (DOM-FIN-085)'),
  periodMonths: z.number().int().describe('Denetim periyodu (ay)'),
  isLegal: z.boolean().describe('Yasal zorunlu denetim'),
  previousDoneDate: z
    .string()
    .nullable()
    .describe('Plan açılırken girilen, sistemden önceki son denetim günü'),
  lastDoneDate: z
    .string()
    .nullable()
    .describe('Son denetim: önceki gün ile iptal edilmemiş denetimlerin en geç günü'),
  nextDueDate: z.string().nullable().describe('Sonraki denetim günü; hiç denetim yoksa boş'),
  dueStatus: z
    .enum(MAINTENANCE_PLAN_DUE_STATUSES)
    .describe(
      '`overdue` gecikti, `due_soon` 30 gün içinde, `ok` zamanında, `never` denetim kaydı yok',
    ),
  daysLeft: z.number().int().nullable().describe('Sonraki denetime kalan gün; geçtiyse eksi'),
  responsible: z
    .object({
      type: z.enum(MAINTENANCE_PLAN_RESPONSIBLE_TYPES),
      id: z.string().describe('Personel üyeliği ya da tedarikçi kimliği'),
      name: z.string().nullable(),
    })
    .nullable()
    .describe('Sorumlu personel ya da tedarikçi'),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})

const inspectionSchema = z.object({
  id: z.string(),
  doneDate: z.string().describe('Denetim günü (YYYY-MM-DD)'),
  performedBy: z.string().describe('Denetimi yapan kişi ya da kuruluş'),
  result: z.enum(MAINTENANCE_INSPECTION_RESULTS),
  documentNumber: z.string().nullable(),
  note: z.string().nullable(),
  recordedByName: z.string().nullable().describe('Kaydeden kişi'),
  recordedAt: z.string(),
  maintenanceRequest: z
    .object({
      id: z.string(),
      number: z.string().describe('Talep numarası (`AT-0007`)'),
      status: z.enum(MAINTENANCE_STATUSES).nullable(),
    })
    .nullable()
    .describe('Bu denetimden açılan arıza talebi (DOM-FIN-089)'),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  cancelledByName: z.string().nullable(),
  version: z.number().int().describe('`If-Match` için denetim sürümü'),
})

export const maintenancePlanResponse = dataResponse(
  planSchema.extend({
    inspections: z
      .array(inspectionSchema)
      .describe('Denetim kayıtları, yeniden eskiye (iptal edilenler dahil)'),
  }),
)
export const maintenancePlanListResponse = z.object({
  data: z.array(planSchema),
  meta: pageMetaSchema,
})
export const maintenancePlanArchiveResponse = dataResponse(
  z.object({ id: z.string(), archivedAt: z.string() }),
)

export const maintenancePlanParams = z.object({ planId: z.uuid('Plan geçersiz.') })
export const maintenanceInspectionParams = maintenancePlanParams.extend({
  inspectionId: z.uuid('Denetim geçersiz.'),
})

export const maintenancePlanListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .optional()
    .describe('Ad, yer, demirbaş etiketi ve adında arama'),
  type: z.enum(MAINTENANCE_PLAN_TYPES).optional().describe('Tür'),
  due: z
    .enum(MAINTENANCE_PLAN_DUE_FILTERS)
    .optional()
    .describe(
      '`attention` geciken, 30 gün içinde yaklaşan ve hiç denetlenmemiş; ya da tek durum (`overdue`, `due_soon`, `ok`, `never`)',
    ),
  assetId: z.uuid().optional().describe('Demirbaşın bakım planları'),
})
