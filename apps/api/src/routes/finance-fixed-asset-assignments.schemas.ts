import { z } from 'zod'

import {
  FIXED_ASSET_ASSIGNEE_TYPES,
  FIXED_ASSET_ASSIGNMENT_STATES,
  FIXED_ASSET_RETURN_CONDITIONS,
} from '@kampus/school-core/lib/finance-fixed-asset-assignments.ts'
import { FIXED_ASSET_CATEGORIES } from '@kampus/school-core/lib/finance-fixed-assets.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Demirbaş zimmeti şemaları (DOM-FIN-086; ON-236). Personel adı yalnız yöneticiye döner (K-189). */

const assignmentSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  assetTagNumber: z.string(),
  assetName: z.string(),
  assetCategory: z.enum(FIXED_ASSET_CATEGORIES),
  assigneeType: z
    .enum(FIXED_ASSET_ASSIGNEE_TYPES)
    .describe('`staff` personel, `location` konum (K-210)'),
  membershipId: z.string().nullable().describe('Personel zimmetinde kurum üyeliği'),
  staffName: z.string().nullable().describe('Teslim alan personelin adı'),
  staffRole: z.string().nullable().describe('Personelin bugünkü rolü'),
  staffActive: z
    .boolean()
    .nullable()
    .describe('Personel pasifleştirildiyse `false`; konum zimmetinde boş'),
  campusId: z.string().nullable(),
  campusName: z.string().nullable().describe('Kampüs adı; kampüs yoksa ya da arşivlendiyse boş'),
  location: z.string().nullable().describe('Konum zimmetinde oda ya da yer'),
  assignedDate: z.string().describe('Zimmet günü (YYYY-MM-DD)'),
  note: z.string().nullable(),
  assignedAt: z.string(),
  returnDate: z.string().nullable().describe('İade günü; açık zimmette boş'),
  returnCondition: z.enum(FIXED_ASSET_RETURN_CONDITIONS).nullable(),
  returnNote: z.string().nullable(),
  returnedAt: z.string().nullable(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü (iade)'),
})
export const assignmentResponse = dataResponse(assignmentSchema)
export const assignmentListResponse = z.object({
  data: z.array(assignmentSchema),
  meta: pageMetaSchema,
})

const assigneeSchema = z.object({
  membershipId: z.string(),
  name: z.string(),
  role: z.string().describe('Rol: `yonetici`, `ogretmen` ya da `onburo`'),
  active: z.boolean().describe('Pasifleştirilmiş (ayrılan) personelde `false`'),
  openAssignmentCount: z.number().int().describe('Üzerindeki açık zimmet sayısı'),
})
export const assigneeListResponse = z.object({
  data: z.array(assigneeSchema),
  meta: pageMetaSchema,
})

export const assignmentParams = z.object({ assignmentId: z.uuid('Zimmet geçersiz.') })
export const assetAssignmentParams = z.object({ assetId: z.uuid('Demirbaş geçersiz.') })

const search = z.string().trim().min(2).max(100).optional()

export const assignmentListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  assetId: z.uuid().optional().describe('Demirbaşın zimmet geçmişi'),
  membershipId: z.string().trim().min(1).max(100).optional().describe('Personelin zimmetleri'),
  state: z
    .enum(FIXED_ASSET_ASSIGNMENT_STATES)
    .optional()
    .describe('`open` iade edilmemiş, `returned` iade edilmiş'),
  q: search.describe('Etiket, demirbaş adı, personel adı ve konumda arama, Türkçe harf duyarsız'),
})

export const assigneeListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: search.describe('Personel adında arama, Türkçe harf duyarsız'),
  status: z
    .enum(['active', 'passive'])
    .optional()
    .describe('`active` etkin, `passive` pasifleştirilmiş (ayrılan) personel'),
  holding: z
    .enum(['true', 'false'])
    .optional()
    .describe('`true` yalnız açık zimmeti olan personel'),
})
