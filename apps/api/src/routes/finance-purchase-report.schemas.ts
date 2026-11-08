import { z } from 'zod'

import { BUDGET_PERIOD_STATUSES } from '@kampus/school-core/lib/finance-budget.ts'
import { SUPPLIER_CATEGORIES, SUPPLIER_TYPES } from '@kampus/school-core/lib/finance-suppliers.ts'

import { dataResponse } from './common.schemas.ts'

/** Satın alma raporu yanıtı (DOM-FIN-075; ON-227). Vergi numarası ve iletişim bilgisi yoktur. */

const cents = (description: string) => z.number().int().describe(description)
const amounts = {
  orderCount: z.number().int().describe('İptal edilmemiş sipariş sayısı'),
  netCents: cents('KDV hariç tutar, kuruş'),
  vatCents: cents('KDV, kuruş; kalemde yuvarlanır (K-138)'),
  grossCents: cents('KDV dahil tutar, kuruş'),
}
const share = {
  ...amounts,
  shareBasisPoints: z
    .number()
    .int()
    .nullable()
    .describe('Brüt tutarın toplam brüte oranı, on binde bir; toplam sıfırsa boş'),
}
const refRow = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  ...share,
})
const supplierRow = z.object({
  rank: z.number().int().describe('Brüt tutara göre sıra, 1 en çok'),
  supplierId: z.string(),
  name: z.string().describe('Tedarikçinin güncel unvanı; şahıs tedarikçide kişisel veri (K-155)'),
  type: z.enum(SUPPLIER_TYPES),
  categories: z.array(z.enum(SUPPLIER_CATEGORIES)),
  isActive: z.boolean(),
  ...share,
  averageLeadDays: z
    .number()
    .nullable()
    .describe('Talepten siparişe ortalama takvim günü, bir ondalık (K-158)'),
})

export const purchaseReportResponse = dataResponse(
  z.object({
    scope: z.enum(['period', 'range']).describe('Bütçe dönemi ya da tarih aralığı'),
    from: z.string().describe('Kapsamın ilk günü `YYYY-MM-DD`'),
    to: z.string().describe('Kapsamın son günü `YYYY-MM-DD`'),
    period: z
      .object({
        id: z.string(),
        name: z.string(),
        status: z.enum(BUDGET_PERIOD_STATUSES),
        startDate: z.string(),
        endDate: z.string(),
      })
      .nullable()
      .describe('Bütçe dönemi kapsamında dönem; aralıkta boş'),
    totals: z.object({
      ...amounts,
      supplierCount: z.number().int().describe('Siparişi olan tedarikçi sayısı'),
    }),
    cancelled: z
      .object({ orderCount: z.number().int(), grossCents: cents('İptal edilen KDV dahil tutar') })
      .describe('Kapsamda iptal edilen siparişler; toplamlara girmez'),
    leadTime: z.object({
      orderCount: z.number().int(),
      averageDays: z.number().nullable().describe('Ortalama takvim günü, bir ondalık'),
      minDays: z.number().int().nullable(),
      maxDays: z.number().int().nullable(),
    }),
    categories: z
      .array(
        z.object({
          category: z.enum(SUPPLIER_CATEGORIES),
          supplierCount: z.number().int(),
          ...share,
        }),
      )
      .describe('Çok kategorili tedarikçinin siparişi her kategorisinde sayılır (K-157)'),
    suppliers: z.array(supplierRow).describe('Brüt tutara göre azalan'),
    topSuppliers: z.array(supplierRow).describe('En çok harcama yapılan beş tedarikçi'),
    costCenters: z.array(refRow).describe('Talebin maliyet merkezine göre'),
    budgetItems: z.array(refRow).describe('Talebin gider kalemine göre'),
  }),
)
