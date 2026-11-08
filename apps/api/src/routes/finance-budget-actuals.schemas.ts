import { z } from 'zod'

import { FEE_ITEM_KINDS } from '@kampus/school-core/lib/fee-tariffs.ts'
import { BUDGET_ITEM_KINDS } from '@kampus/school-core/lib/finance-budget.ts'
import {
  BUDGET_ACTUAL_BASES,
  BUDGET_ACTUAL_STATUSES,
} from '@kampus/school-core/lib/finance-budget-actuals.ts'

import { dataResponse } from './common.schemas.ts'

/** Bütçe–gerçekleşen yanıt şeması (DOM-FIN-066; ON-244). Tutarlar kuruş, oranlar on binde bir. */

const cents = z.number().int()
const optionalCents = cents.nullable()
const points = z.number().int().nullable().describe('Gerçekleşen ÷ plan, on binde bir')
const month = z.string().describe('Takvim ayı `YYYY-MM` (Europe/Istanbul)')

const totals = {
  plannedCents: cents,
  actualCents: optionalCents,
  varianceCents: optionalCents.describe('Gerçekleşen − plan'),
  realizationBasisPoints: points,
}

const rowSchema = z.object({
  key: z.string(),
  itemId: z.string(),
  itemCode: z.string(),
  itemName: z.string(),
  itemKind: z.enum(BUDGET_ITEM_KINDS),
  feeKind: z.enum(FEE_ITEM_KINDS).nullable(),
  costCenterId: z.string().nullable().describe('`null`: dağıtılmamış'),
  costCenterCode: z.string().nullable(),
  costCenterName: z.string().nullable(),
  costCenterPath: z.string().nullable(),
  hasLine: z.boolean().describe('Bu merkez ve kalem için bütçe satırı var mı'),
  plannedCents: cents,
  plannedToDateCents: optionalCents.describe('Bugüne kadarki ayların planı; dağılımsızsa boş'),
  actualCents: optionalCents,
  varianceCents: optionalCents,
  realizationBasisPoints: points,
  status: z.enum(BUDGET_ACTUAL_STATUSES),
  months: z.array(
    z.object({
      month,
      plannedCents: optionalCents.describe('Aylık dağılım yoksa boş'),
      actualCents: optionalCents.describe('Gelmemiş ayda boş'),
      varianceCents: optionalCents,
      realizationBasisPoints: points,
    }),
  ),
})

export const budgetActualsResponse = dataResponse(
  z.object({
    periodId: z.string(),
    basis: z.enum(BUDGET_ACTUAL_BASES),
    startDate: z.string(),
    endDate: z.string(),
    asOfDate: z.string().nullable().describe('Hareketlerin sayıldığı son gün'),
    months: z.array(month),
    expenseData: z.enum(['none', 'available']),
    rows: z.array(rowSchema),
    unmatched: z.array(
      z.object({
        feeKind: z.enum(FEE_ITEM_KINDS).nullable(),
        actualCents: cents,
        months: z.array(z.object({ month, actualCents: optionalCents })),
      }),
    ),
    totals: z.object({
      income: z.object({ ...totals, unmatchedCents: optionalCents }),
      expense: z.object(totals),
      net: z.object({ plannedCents: cents, actualCents: optionalCents }),
    }),
    openingImportCents: cents,
  }),
)
