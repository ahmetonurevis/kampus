import type { PerformanceReportSummary } from '@kampus/react-shared/use-finance-performance-reports.ts'
import {
  PERFORMANCE_REPORT_ACK_CHANNELS,
  PERFORMANCE_REPORT_OPINION_MAX,
  PERFORMANCE_REPORT_OPINION_MIN,
  PERFORMANCE_SCORE_BAND_LABELS,
  type PerformanceReportAckChannel,
  type PerformanceReportStatus,
} from '@kampus/school-core/lib/finance-performance-reports.ts'
import type { PerformancePeriodStatus } from '@kampus/school-core/lib/finance-performance.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import { z } from 'zod'

// Performans raporu bölümünün saf mantığı (DOM-FIN-137; ON-220; K-466…K-468): puan ve yüzde
// metinleri, dönem özeti cümlesi, hangi işlemin açık olduğu ve form şemaları.

const decimal = (value: number, digits: number) =>
  value.toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits })

/** Genel puan: "4,60 / 5"; puan yoksa "—". */
export const reportScoreText = (score: number | null) =>
  score === null ? '—' : `${decimal(score, 2)} / 5`

/** 100'lük gözlem puanı: "%86,5"; yoksa "—". */
export const reportPercentText = (percent: number | null) =>
  percent === null ? '—' : `%${decimal(percent, 1)}`

/** Dönem özeti cümlesi (ekran okuyucuda canlı bölge). */
export function reportSummaryText(summary: PerformanceReportSummary): string {
  if (summary.staffCount === 0) return 'Bu dönemde personel kaydı yok.'
  const parts = [
    `${String(summary.staffCount)} personel`,
    `ortalama ${reportScoreText(summary.averageScore)}`,
    summary.minScore === null
      ? null
      : `en düşük ${decimal(summary.minScore, 2)}, en yüksek ${decimal(summary.maxScore ?? summary.minScore, 2)}`,
    summary.unscoredCount > 0 ? `${String(summary.unscoredCount)} kayıt puansız` : null,
    `${String(summary.observationCount)} gözlem, ortalama ${reportPercentText(summary.observationAverage)}`,
    `${String(summary.selfEvaluationSubmitted)} öz değerlendirme gönderildi`,
    `${String(summary.finalizedCount)} rapor kesinleşti, ${String(summary.acknowledgedCount)} okundu`,
  ]
  return `${parts.filter((part) => part !== null).join(' · ')}.`
}

/** Dağılım satırları: bant etiketi, sayı ve en büyük banda göre çubuk oranı (0–100). */
export function distributionRows(summary: PerformanceReportSummary) {
  const largest = Math.max(1, ...summary.distribution.map((item) => item.count))
  return summary.distribution.map((item) => ({
    band: item.band,
    label: PERFORMANCE_SCORE_BAND_LABELS[item.band],
    count: item.count,
    ratio: Math.round((item.count * 100) / largest),
  }))
}

/**
 * Açık işlemler (K-467): kesinleştirme kapanan dönemde, kesinleşmemiş raporda; "okudum" kaydı
 * kesinleşmiş ama okunmamış raporda.
 */
export function reportActions(
  periodStatus: PerformancePeriodStatus,
  status: PerformanceReportStatus,
) {
  return {
    finalize: periodStatus === 'closed' && status === 'draft',
    acknowledge: status === 'finalized',
  }
}

export const performanceReportFinalizeFormSchema = z.object({
  managerOpinion: z
    .string()
    .trim()
    .min(
      PERFORMANCE_REPORT_OPINION_MIN,
      `Yönetici görüşünü en az ${String(PERFORMANCE_REPORT_OPINION_MIN)} karakterle yazın.`,
    )
    .max(
      PERFORMANCE_REPORT_OPINION_MAX,
      `Yönetici görüşü en fazla ${String(PERFORMANCE_REPORT_OPINION_MAX)} karakter olabilir.`,
    ),
})
export type PerformanceReportFinalizeFormValues = z.infer<
  typeof performanceReportFinalizeFormSchema
>

export const performanceReportAcknowledgeFormSchema = z
  .object({
    channel: z.enum(PERFORMANCE_REPORT_ACK_CHANNELS, 'Kanalı seçin.'),
    acknowledgedDate: daySchema,
    today: z.string(),
  })
  .superRefine((value, ctx) => {
    if (value.acknowledgedDate > value.today)
      ctx.addIssue({
        code: 'custom',
        path: ['acknowledgedDate'],
        message: 'Okuma günü bugünden sonra olamaz.',
      })
  })
export type PerformanceReportAcknowledgeFormValues = {
  channel: PerformanceReportAckChannel
  acknowledgedDate: string
  today: string
}

export const performanceReportAcknowledgeDefaults = (
  today: string,
): PerformanceReportAcknowledgeFormValues => ({
  channel: 'paper',
  acknowledgedDate: today,
  today,
})
