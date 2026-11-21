import { z } from 'zod'

import { FEE_ITEM_KINDS } from '@kampus/school-core/lib/fee-tariffs.ts'
import {
  BUDGET_ITEM_KINDS,
  BUDGET_PERIOD_STATUSES,
} from '@kampus/school-core/lib/finance-budget.ts'
import { COST_CENTER_TYPES } from '@kampus/school-core/lib/finance-cost-centers.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Maliyet merkezi, bütçe kalemi, dönem ve satır şemaları (DOM-FIN-062; ON-241, ON-242). */

const cents = (description: string) => z.number().int().describe(description)
const version = z.number().int().describe('`If-Match` için kayıt sürümü')
const search = z
  .string()
  .trim()
  .min(2)
  .max(100)
  .optional()
  .describe('Kodda ya da adda arama (Türkçe harf duyarsız)')
const activeStatus = z
  .enum(['active', 'inactive'])
  .optional()
  .describe('`active` etkin, `inactive` pasif kayıtlar')

const costCenterSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  type: z.enum(COST_CENTER_TYPES),
  parentId: z.string().nullable(),
  path: z.string().describe('Kökten merkeze kod yolu, ör. `KAD / ORT / 7`'),
  campusId: z.string().nullable(),
  campusName: z.string().nullable().describe('Bağlı kampüsün adı; arşivlenmişse boş'),
  gradeLevel: z.number().int().nullable(),
  courseId: z.string().nullable(),
  courseName: z.string().nullable().describe('Bağlı kurun adı; arşivlenmişse boş'),
  isActive: z.boolean(),
  createdAt: z.string(),
  version,
})
export const costCenterResponse = dataResponse(costCenterSchema)
export const costCenterListResponse = z.object({
  data: z.array(costCenterSchema),
  meta: pageMetaSchema,
})
export const costCenterParams = z.object({ costCenterId: z.uuid('Maliyet merkezi geçersiz.') })
export const costCenterListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: search,
  type: z.enum(COST_CENTER_TYPES).optional().describe('Merkez türü'),
  status: activeStatus,
})

const budgetItemSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  kind: z.enum(BUDGET_ITEM_KINDS),
  feeKind: z.enum(FEE_ITEM_KINDS).nullable().describe('Gelir kaleminin eşlendiği ücret türü'),
  isActive: z.boolean(),
  createdAt: z.string(),
  version,
})
export const budgetItemResponse = dataResponse(budgetItemSchema)
export const budgetItemListResponse = z.object({
  data: z.array(budgetItemSchema),
  meta: pageMetaSchema,
})
export const budgetItemParams = z.object({ itemId: z.uuid('Bütçe kalemi geçersiz.') })
export const budgetItemListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: search,
  kind: z.enum(BUDGET_ITEM_KINDS).optional().describe('`income` gelir, `expense` gider'),
  status: activeStatus,
})

const budgetPeriodSchema = z.object({
  id: z.string(),
  name: z.string(),
  academicYear: z.number().int().nullable().describe('Bağlı eğitim yılının başlangıç yılı'),
  startDate: z.string(),
  endDate: z.string(),
  status: z.enum(BUDGET_PERIOD_STATUSES),
  openedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  months: z
    .array(z.string())
    .describe('Dönemin değdiği takvim ayları (`YYYY-MM`); aylık dağılımın sırası'),
  incomeCents: cents('Gelir satırları toplamı, kuruş; hesaplanır'),
  expenseCents: cents('Gider satırları toplamı, kuruş; hesaplanır'),
  balanceCents: cents('Gelir eksi gider, kuruş'),
  lineCount: z.number().int(),
  createdAt: z.string(),
  version,
})
export const budgetPeriodResponse = dataResponse(budgetPeriodSchema)
export const budgetPeriodListResponse = z.object({
  data: z.array(budgetPeriodSchema),
  meta: pageMetaSchema,
})
export const budgetPeriodParams = z.object({ periodId: z.uuid('Bütçe dönemi geçersiz.') })
export const budgetPeriodListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  status: z.enum(BUDGET_PERIOD_STATUSES).optional().describe('Dönem durumu'),
})

const budgetLineSchema = z.object({
  id: z.string(),
  periodId: z.string(),
  costCenterId: z.string(),
  costCenterCode: z.string(),
  costCenterName: z.string(),
  itemId: z.string(),
  itemCode: z.string(),
  itemName: z.string(),
  itemKind: z.enum(BUDGET_ITEM_KINDS),
  amountCents: cents('Planlanan tutar, kuruş'),
  monthlyCents: z
    .array(z.number().int())
    .nullable()
    .describe('Aylık dağılım, dönemin `months` sırasıyla; boşsa dağılım yok'),
  version,
})
export const budgetLineResponse = dataResponse(budgetLineSchema)
export const budgetLineRemoveResponse = dataResponse(z.object({ id: z.string() }))
export const budgetLineListResponse = z.object({
  data: z.array(budgetLineSchema),
  meta: pageMetaSchema,
})
export const budgetLineParams = z.object({
  periodId: z.uuid('Bütçe dönemi geçersiz.'),
  lineId: z.uuid('Bütçe satırı geçersiz.'),
})
export const budgetLineListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: search.describe('Merkez ya da kalem kodu ve adında arama'),
  costCenterId: z.uuid('Maliyet merkezi geçersiz.').optional().describe('Merkez süzgeci'),
  kind: z.enum(BUDGET_ITEM_KINDS).optional().describe('Kalem türü süzgeci'),
})
