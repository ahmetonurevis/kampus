import { z } from 'zod'

import { PIPELINE_STEPS } from '@kampus/school-core/lib/finance-forecast.ts'

import { dataResponse } from './common.schemas.ts'

// Gelir ve nakit akışı tahmini (ON-246, ON-247; DOM-FIN-063). Yalnız toplam, sayı ve oran döner;
// öğrenci, aday ya da kişi bilgisi yok. Tutarlar kuruş, oranlar on binde birdir.

const cents = z.number().int()
const count = z.number().int().min(0)
const basisPoints = z.number().int().min(0).max(10_000)
const day = z.string().describe('`YYYY-MM-DD`, Europe/Istanbul')
const month = z.string().describe('`YYYY-MM`, Europe/Istanbul')

const pipelineStep = z.object({
  // Kesin kayıt adımı huni beklentisinde yoktur; deneme yalnız dil okulunda.
  step: z.enum(PIPELINE_STEPS),
  prospects: count.describe('Bu adımda bekleyen açık aday'),
  sampleSize: count.describe('Örneklemde bu adıma ulaşan kapanmış aday'),
  rateBasisPoints: basisPoints
    .nullable()
    .describe('Adımdan kesin kayda dönüşüm oranı (on binde bir); örneklem boşsa `null`'),
  grossCents: cents,
  discountCents: cents,
  netCents: cents,
})

export const revenueForecastResponseSchema = dataResponse(
  z.object({
    year: z.number().int(),
    enrollmentYear: z.number().int().describe('Kesin kaydın yazıldığı eğitim yılı (kurum ayarı)'),
    today: day,
    committed: z
      .object({
        totalCents: cents,
        newEnrollmentCents: cents,
        renewalCents: cents,
        students: count,
        newStudents: count,
        renewalStudents: count,
      })
      .describe('Kesin gelir: yılın iptal edilmemiş taksitleri'),
    contracts: z
      .object({
        count,
        listCents: cents,
        discountCents: cents,
        scholarshipCents: cents,
        netCents: cents,
      })
      .describe('Yılın yürürlükteki sözleşmeleri: liste fiyatı, indirim ve burs (bilgi)'),
    pipeline: z
      .object({
        prospects: count,
        steps: z.array(pipelineStep),
        grossCents: cents,
        discountCents: cents,
        netCents: cents,
        unpricedProspects: count,
        unratedProspects: count,
      })
      .nullable()
      .describe('Huni beklentisi; geçmiş yılda ve `crm` kapalıyken `null`'),
    expectedTotalCents: cents,
    assumptions: z.object({
      pipelineStatus: z.enum(['included', 'crm_disabled', 'past_year']),
      historyFrom: day,
      historyTo: day,
      historyClosedProspects: count,
      tariffYear: z.number().int().nullable(),
      tariffCarriedOver: z.boolean(),
      discountReferenceYear: z.number().int().nullable(),
      discountRateBasisPoints: basisPoints,
      contractAverageCents: cents.nullable(),
      priceSources: z.object({
        tariffLevel: count,
        tariffAverage: count,
        contractAverage: count,
        none: count,
      }),
    }),
  }),
)

const cashFlowAmounts = {
  scheduledCents: cents.describe('Vadesi bugün ya da sonra olan kalan taksit tutarı'),
  expectedCollectionCents: cents.describe('Planlanan × vadesinde tahsil oranı'),
  atRiskCents: cents.describe('Planlanan eksi beklenen'),
  overdueRecoveryCents: cents.describe('Gecikmiş alacaktan beklenen (yalnız ilk ay)'),
  refundCents: cents.describe('Ödenmemiş ayrılış iadesi'),
  expenseCents: cents.nullable().describe('Elle girilen gider; verilmediyse `null`'),
  netCents: cents,
}

export const cashFlowForecastResponseSchema = dataResponse(
  z.object({
    today: day,
    from: month,
    to: month,
    months: z.array(z.object({ month, ...cashFlowAmounts, cumulativeNetCents: cents })),
    totals: z.object(cashFlowAmounts),
    overdueOpenCents: cents,
    beyondHorizonCents: cents,
    pendingRefundCents: cents,
    assumptions: z.object({
      historyFrom: day,
      historyTo: day,
      historyInvoices: count,
      historyAmountCents: cents,
      graceDays: count,
      onTimeRateBasisPoints: basisPoints,
      onTimeRateSource: z.enum(['history', 'default']),
      lateRecoveryRateBasisPoints: basisPoints,
      lateRecoveryRateSource: z.enum(['history', 'default']),
      expenseSource: z.enum(['manual', 'none']),
    }),
  }),
)
