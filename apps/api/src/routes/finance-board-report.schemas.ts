import { z } from 'zod'

import { FUNNEL_STEPS } from '@kampus/school-core/lib/enrollment-funnel.ts'
import {
  BOARD_REPORT_AGING_BUCKETS,
  BOARD_REPORT_PERIOD_KINDS,
} from '@kampus/school-core/lib/finance-board-report.ts'
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
  }),
)
