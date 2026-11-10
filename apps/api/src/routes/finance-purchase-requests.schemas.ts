import { z } from 'zod'

import { BUDGET_PERIOD_STATUSES } from '@kampus/school-core/lib/finance-budget.ts'
import {
  PURCHASE_REQUEST_STATUSES,
  PURCHASE_UNITS,
} from '@kampus/school-core/lib/finance-purchase-requests.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Satın alma talebi şemaları (DOM-FIN-071; ON-222). */

const cents = (description: string) => z.number().int().describe(description)
const version = z.number().int().describe('`If-Match` için kayıt sürümü')
const ref = z.object({ id: z.string(), code: z.string(), name: z.string() })
const stockItemLink = ref
  .nullable()
  .describe('Kalemin bağlı olduğu stok kartı (ON-339, K-221); bağ yoksa boş')

const budgetStatusShape = {
  plannedCents: cents('Dönem × merkez × kalem satırının planı; satır yoksa boş').nullable(),
  approvedCents: cents(
    'Aynı satırdaki, etkin siparişi olmayan onaylanmış talepler (bu talep hariç)',
  ),
  pendingCents: cents('Aynı satırdaki kararı bekleyen talepler (bu talep hariç)'),
  orderedCents: cents(
    'Aynı satırdaki etkin siparişlerin henüz kabul edilmemiş kısmı, KDV hariç (K-154)',
  ),
  receivedCents: cents(
    'Gerçekleşen: etkin siparişlerde kabul edilen miktar × birim fiyat, KDV hariç (K-151, K-154)',
  ),
  committedCents: cents(
    'Taahhüt: kararı bekleyen ve onaylanmış talepler ile siparişlerin açık kısmı (K-145, K-154)',
  ),
  remainingCents: cents(
    'Plan eksi taahhüt eksi gerçekleşen; plan yoksa boş, eksi olabilir',
  ).nullable(),
}

/** Bütçe kalanı ve aşım bilgisi (DOM-FIN-071, ON-245, K-145). */
const budgetInfoSchema = z
  .object({
    ...budgetStatusShape,
    exceedsRemaining: z
      .boolean()
      .describe('Talep kalanı aşıyor mu; gönderim ve onay açık onay ister (K-146)'),
    overrunCents: cents('Talebin kalanı aştığı tutar; aşım ya da plan yoksa 0'),
  })
  .describe('Bütçe kalanı ve aşım bilgisi (K-145)')

const summaryShape = {
  id: z.string(),
  number: z.string().describe('Kurum içi talep numarası, ör. `ST-0001`'),
  status: z.enum(PURCHASE_REQUEST_STATUSES),
  costCenter: ref.describe('Talep eden birim (maliyet merkezi)'),
  period: z.object({ id: z.string(), name: z.string() }).describe('Bütçe dönemi'),
  budgetItem: ref.describe('Gider kalemi'),
  supplier: z
    .object({ id: z.string(), name: z.string() })
    .nullable()
    .describe('Önerilen tedarikçi'),
  justification: z.string(),
  itemCount: z.number().int(),
  totalCents: cents('Tahmini toplam: kalemlerin miktar × birim fiyat toplamı, kuruş'),
  requestedByUserId: z.string(),
  requestedByName: z.string().nullable(),
  submittedAt: z.string().nullable(),
  decidedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  createdAt: z.string(),
  version,
}

export const purchaseRequestListResponse = z.object({
  data: z.array(z.object(summaryShape)),
  meta: pageMetaSchema,
})

const detailSchema = z.object({
  ...summaryShape,
  items: z.array(
    z.object({
      id: z.string(),
      position: z.number().int(),
      name: z.string(),
      quantity: z.number().int(),
      unit: z.enum(PURCHASE_UNITS),
      estimatedUnitPriceCents: cents('Tahmini birim fiyat, kuruş'),
      totalCents: cents('Miktar × birim fiyat, kuruş'),
      stockItem: stockItemLink,
    }),
  ),
  budget: budgetInfoSchema,
  submittedByName: z.string().nullable(),
  decidedByName: z.string().nullable(),
  decisionNote: z.string().nullable().describe('Onay notu ya da ret gerekçesi'),
  cancelledByName: z.string().nullable(),
  cancelReason: z.string().nullable(),
  actions: z
    .object({
      edit: z.boolean(),
      submit: z.boolean(),
      cancel: z.boolean(),
      decide: z.boolean(),
    })
    .describe('Oturumdaki kullanıcının bu talepte yapabileceği işlemler'),
  supplyRequest: z
    .object({ id: z.string(), number: z.string().describe('Sarf talebi numarası, ör. `SM-0001`') })
    .nullable()
    .describe('Talep bir sarf talebinin kalanından açıldıysa o talep (DOM-FIN-091, K-246)'),
})
export const purchaseRequestResponse = dataResponse(detailSchema)

export const purchaseRequestOptionsResponse = dataResponse(
  z.object({
    costCenters: z.array(ref).describe('Etkin maliyet merkezleri'),
    budgetItems: z.array(ref).describe('Etkin gider kalemleri'),
    periods: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          status: z.enum(BUDGET_PERIOD_STATUSES),
          startDate: z.string(),
          endDate: z.string(),
        }),
      )
      .describe('Kapalı olmayan bütçe dönemleri'),
    suppliers: z
      .array(z.object({ id: z.string(), name: z.string() }))
      .describe('Etkin tedarikçiler'),
  }),
)

export const purchaseBudgetStatusResponse = dataResponse(
  z.object(budgetStatusShape).describe('Talep formunun bütçe durumu (K-148)'),
)
export const purchaseBudgetStatusQuery = z.strictObject({
  periodId: z.uuid('Bütçe dönemini seçin.').describe('Bütçe dönemi'),
  costCenterId: z.uuid('Talep eden birimi seçin.').describe('Talep eden birim'),
  budgetItemId: z.uuid('Gider kalemini seçin.').describe('Gider kalemi'),
})

export const purchaseRequestParams = z.object({ requestId: z.uuid('Talep geçersiz.') })
export const purchaseRequestListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .optional()
    .describe('Talep numarasında (`ST-0001`), gerekçede ya da birim adında arama'),
  status: z.enum(PURCHASE_REQUEST_STATUSES).optional().describe('Durum'),
  costCenterId: z.uuid('Birim geçersiz.').optional().describe('Talep eden birim'),
  periodId: z.uuid('Dönem geçersiz.').optional().describe('Bütçe dönemi'),
})
