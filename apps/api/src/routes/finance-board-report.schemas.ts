import { z } from 'zod'

import { FUNNEL_STEPS } from '@kampus/school-core/lib/enrollment-funnel.ts'
import {
  BOARD_REPORT_AGING_BUCKETS,
  BOARD_REPORT_PERIOD_KINDS,
} from '@kampus/school-core/lib/finance-board-report.ts'
import {
  BUDGET_ITEM_KINDS,
  BUDGET_PERIOD_STATUSES,
} from '@kampus/school-core/lib/finance-budget.ts'
import { BUDGET_ACTUAL_BASES } from '@kampus/school-core/lib/finance-budget-actuals.ts'
import { PAYMENT_METHODS } from '@kampus/school-core/lib/payments.ts'
import { WITHDRAWAL_REASONS } from '@kampus/school-core/lib/withdrawals.ts'

import { dataResponse } from './common.schemas.ts'

/**
 * Yönetim kurulu raporu yanıtı (DOM-FIN-064). Tutarlar kuruş, günler Europe/Istanbul `YYYY-MM-DD`.
 * Kişi adı ve kimliği yoktur; gizli hücrede (`suppressed`) sayı ve tutar `null` gelir (K-77).
 */

const cents = () => z.number().int()
const hidden = (schema: z.ZodNumber) => schema.nullable().describe('Gizli hücrede `null`')

const amounts = z.object({
  openingCents: cents().describe('Dönem başı bakiye: açık borç − alacak'),
  accruedCents: cents().describe('Vadesi dönemde olan taksitler (tahakkuk)'),
  withdrawalAdjustmentCents: cents().describe('Ayrılışta hak edilmeyen tahakkuk'),
  collectedCents: cents().describe('Ödeme günü dönemde olan tahsilatlar (brüt)'),
  openingImportCents: cents().describe('Ödeme günü dönemde olan açılış aktarımı (DOM-FIN-014)'),
  reversedCents: cents().describe('İptal günü dönemde olan tahsilatlar'),
  refundedCents: cents().describe('Ödeme günü dönemde olan iadeler'),
  scholarshipCents: cents().describe('Eğitim yılı sözleşmelerinin bursu; bilgi amaçlı'),
  discountCents: cents().describe('Eğitim yılı sözleşmelerinin indirimi; bilgi amaçlı'),
  closingCents: cents().describe('Dönem sonu bakiye: açık borç − alacak'),
  expectedClosingCents: cents(),
  differenceCents: cents(),
  openDebtCents: cents().describe('Dönem sonunda vadesi gelmiş açık taksit tutarı'),
  creditCents: cents(),
})

const basisPoints = () => z.number().int().nullable().describe('On binde bir; payda sıfırsa `null`')

const budgetPeriodOption = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(BUDGET_PERIOD_STATUSES),
  startDate: z.string(),
  endDate: z.string(),
})

const budgetTotals = z.object({
  plannedCents: cents().describe('Dönem planı'),
  plannedToDateCents: cents()
    .nullable()
    .describe('Bugüne kadarki ayların planı; dağılımsız satır varken dönem bitmediyse `null`'),
  actualCents: cents().nullable().describe('Gerçekleşen; hesaplanmıyorsa (veri yok) `null`'),
  varianceCents: cents().nullable().describe('Gerçekleşen − dönem planı'),
  realizationBasisPoints: basisPoints().describe('Gerçekleşen ÷ dönem planı, on binde bir'),
})

const campusRow = z.object({
  studentCount: z.number().int(),
  accruedCents: cents(),
  netCollectedCents: cents().describe('Tahsilat − iptal − iade'),
  budgetExpenseCents: cents().describe('Bütçe gideri (ortak gider payı dahil)'),
  accruedPerStudentCents: cents().nullable().describe('5 kişiden az ya da öğrencisiz `null`'),
  budgetExpensePerStudentCents: cents()
    .nullable()
    .describe('Öğrenci başı maliyet; 5 kişiden az ya da öğrencisiz `null`'),
  suppressed: z.boolean().describe('Küçük grup: öğrenci başı değer gizli (K-102)'),
})

const sections = {
  budgetPeriods: z
    .array(budgetPeriodOption)
    .describe('Kurumun arşivlenmemiş bütçe dönemleri (seçim için), yeniden eskiye'),
  budgetPeriod: budgetPeriodOption
    .extend({
      selection: z
        .enum(['chosen', 'matched'])
        .describe('`chosen`: `budgetPeriodId` ile seçildi; `matched`: rapor dönemine göre bulundu'),
    })
    .nullable()
    .describe('Bütçe ve maliyet bölümlerinin dönemi; uyan dönem yoksa `null`'),
  budget: z
    .object({
      basis: z.enum(BUDGET_ACTUAL_BASES),
      asOfDate: z
        .string()
        .nullable()
        .describe('Hareketlerin sayıldığı son gün; başlamadıysa `null`'),
      expenseData: z
        .enum(['none', 'available'])
        .describe('`none`: gider gerçekleşeni kaynağı yok (veri yok)'),
      income: budgetTotals.extend({
        unmatchedCents: cents().nullable().describe('Kaleme eşlenmemiş gelir'),
      }),
      expense: budgetTotals,
      net: z.object({ plannedCents: cents(), actualCents: cents().nullable() }),
      topVariances: z
        .array(
          z.object({
            itemCode: z.string(),
            itemName: z.string(),
            itemKind: z.enum(BUDGET_ITEM_KINDS),
            plannedCents: cents(),
            plannedToDateCents: cents().nullable(),
            actualCents: cents(),
            varianceCents: cents().describe('Gerçekleşen − karşılaştırma planı'),
            realizationBasisPoints: basisPoints(),
            comparedTo: z
              .enum(['to_date', 'period'])
              .describe('`to_date`: bugüne kadarki plan; `period`: dönem planı'),
          }),
        )
        .describe('En çok sapan kalemler (merkezler toplanır), en çok 5'),
    })
    .nullable()
    .describe('Bütçe–gerçekleşen özeti (DOM-FIN-066, tahakkuk esası); bütçe dönemi yoksa `null`'),
  costs: z
    .object({
      from: z.string(),
      to: z.string(),
      minGroupSize: z.number().int(),
      campuses: z
        .array(
          z.object({
            campusId: z.string().nullable(),
            name: z.string(),
            studentCount: hidden(z.number().int()),
            accruedCents: hidden(cents()),
            netCollectedCents: hidden(cents()),
            budgetExpenseCents: hidden(cents()),
            accruedPerStudentCents: cents()
              .nullable()
              .describe('Gizli, 5 kişiden az ya da öğrencisiz `null`'),
            budgetExpensePerStudentCents: cents()
              .nullable()
              .describe('Öğrenci başı maliyet; gizli, 5 kişiden az ya da öğrencisiz `null`'),
            suppressed: z
              .boolean()
              .describe(
                'Küçük grup (K-116): 1–4 kişilik kampüs, toplamdan geri hesaplanmasın diye ikincil gizlenen ya da tamamı gizli kırılım; sayı ve tutarlar `null`',
              ),
          }),
        )
        .describe('Kampüs satırları; kişi sayısı kurul raporunun küçük grup kuralıyla gizlenir'),
      totals: campusRow.describe('Kurum geneli toplam; gizlenmez'),
    })
    .nullable()
    .describe(
      'Kampüs konsolide özet ve öğrenci başı maliyet (DOM-FIN-065); bütçe dönemi yoksa `null`',
    ),
  forecast: z
    .object({
      today: z.string(),
      revenue: z.object({
        year: z.number().int().describe('Tahmin yılı: bugünün eğitim yılından sonraki yıl'),
        committedCents: cents(),
        newEnrollmentCents: cents(),
        renewalCents: cents(),
        pipelineNetCents: cents().nullable().describe('Huni beklentisi; huni yoksa `null`'),
        pipelineStatus: z.enum(['included', 'crm_disabled', 'past_year']),
        expectedTotalCents: cents(),
        discountCents: cents(),
        scholarshipCents: cents(),
        tariffYear: z.number().int().nullable(),
      }),
      cashFlow: z.object({
        from: z.string(),
        to: z.string(),
        months: z.array(
          z.object({
            month: z.string().describe('`YYYY-MM`'),
            expectedInCents: cents().describe('Beklenen tahsilat + gecikmişten geç tahsil'),
            refundCents: cents(),
            expenseCents: cents().nullable().describe('Gider verisi yoksa `null`'),
            netCents: cents(),
            cumulativeNetCents: cents(),
          }),
        ),
        totals: z.object({
          scheduledCents: cents(),
          expectedInCents: cents(),
          atRiskCents: cents(),
          refundCents: cents(),
          expenseCents: cents().nullable(),
          netCents: cents(),
        }),
        overdueOpenCents: cents(),
        pendingRefundCents: cents(),
        onTimeRateBasisPoints: z.number().int(),
        expenseSource: z.enum(['manual', 'none']),
      }),
    })
    .describe('Gelecek yıl gelir tahmini ve 12 aylık nakit akışı (DOM-FIN-063), bugün itibarıyla'),
}

export const boardReportResponseSchema = dataResponse(
  z.object({
    period: z.object({
      kind: z.enum(BOARD_REPORT_PERIOD_KINDS),
      year: z.number().int(),
      from: z.string(),
      to: z.string().describe('Rapor bitişi; süren dönemde bugün'),
      endDate: z.string().describe('Seçilen bitiş günü'),
      complete: z.boolean().describe('Seçilen bitiş geçtiyse `true`'),
      termId: z.string().nullable(),
      termName: z.string().nullable(),
    }),
    today: z.string(),
    institutionType: z.enum(['school', 'language_school']),
    minGroupSize: z.number().int().describe('Küçük grup bastırma eşiği (kişi)'),
    terms: z
      .array(
        z.object({ id: z.string(), name: z.string(), startDate: z.string(), endDate: z.string() }),
      )
      .describe('Seçilen eğitim yılının dönemleri (dil okulu dönem seçimi için)'),
    finance: z.object({
      totals: amounts.describe('Yıl sonu mutabakatının dönem toplamı (DOM-FIN-056)'),
      mismatchCount: z.number().int().describe('Mutabakatta tutmayan kişi sayısı'),
      methods: z.object({
        rows: z.array(
          z.object({
            method: z.enum(PAYMENT_METHODS),
            studentCount: hidden(z.number().int()),
            collectedCents: hidden(cents()),
            reversedCents: hidden(cents()),
            netCents: hidden(cents()),
            suppressed: z.boolean(),
          }),
        ),
        collectedCents: cents(),
        reversedCents: cents(),
        netCents: cents(),
      }),
      aging: z.object({
        asOf: z.string().describe('Yaşlandırma günü: raporun alındığı gün'),
        overdueCents: cents(),
        studentCount: z.number().int(),
        rows: z.array(
          z.object({
            bucket: z.enum(BOARD_REPORT_AGING_BUCKETS.map((bucket) => bucket.key)),
            studentCount: hidden(z.number().int()),
            amountCents: hidden(cents()),
            suppressed: z.boolean(),
          }),
        ),
      }),
      packages: z
        .object({
          saleCount: z.number().int(),
          soldHours: z.number(),
          usedHours: z.number(),
          refundedHours: z.number(),
          expiredHours: z.number(),
          soldCents: cents(),
          recognizedCents: cents().describe('Kullanılan saatin payı: tanınan gelir'),
          returnedCents: cents(),
          openingDeferredCents: cents(),
          closingDeferredCents: cents().describe('Dönem sonu ertelenmiş gelir'),
        })
        .nullable()
        .describe('Paket saat raporu toplamı (DOM-FIN-058); yalnız dil okulunda'),
    }),
    enrollment: z.object({
      startCount: z.number().int(),
      endCount: z.number().int(),
      newCount: z.number().int(),
      withdrawnCount: z.number().int(),
      graduatedCount: z.number().int(),
      reasons: z.array(
        z.object({
          reason: z.enum(WITHDRAWAL_REASONS),
          count: hidden(z.number().int()),
          suppressed: z.boolean(),
        }),
      ),
      renewal: z
        .object({
          targetYear: z.number().int(),
          eligibleCount: z.number().int(),
          renewedCount: z.number().int(),
          rate: z.number().nullable().describe('Yüzde, bir ondalık'),
        })
        .nullable()
        .describe('Yenileme modülü kapalıysa `null`'),
    }),
    funnel: z
      .object({
        prospects: z.number().int(),
        steps: z.array(
          z.object({
            step: z.enum(FUNNEL_STEPS),
            count: z.number().int(),
            rate: z.number().nullable(),
          }),
        ),
        conversionRate: z.number().nullable(),
      })
      .nullable()
      .describe('Dönemde açılan adayların hunisi (DOM-KAY-040); `crm` kapalıysa `null`'),
    ...sections,
  }),
)
