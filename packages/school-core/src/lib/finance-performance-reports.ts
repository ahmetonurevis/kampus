import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import type { PerformancePeriodStatus } from './finance-performance.ts'
import type { SelfEvaluationAnswer, SelfEvaluationQuestion } from './finance-self-evaluations.ts'

/**
 * Personel performans raporu (docs/domain/finans.md DOM-FIN-137; ON-220). Personel × dönem
 * raporu dönem sonu değerlendirmesini (DOM-FIN-124), gönderilmiş öz değerlendirmeyi
 * (DOM-FIN-131), dönemdeki tamamlanmış ders gözlemlerini ve puan ortalamasını (DOM-FIN-130) ve
 * yönetici görüşünü bölüm bölüm bir araya getirir (K-466). Rapor içeriği saklanmaz, kaynak
 * kayıtlardan okunur; dönem kapandıktan sonra yönetici raporu görüşüyle kesinleştirir, personelin
 * "okudum" kaydını kanalıyla personel adına girer (K-467). Rapor kişiseldir: dönem özeti ve
 * bütün raporlar yalnız yöneticide, personel kendi kesinleşmiş raporunu okur; her okuma denetime
 * düşer (K-468). Fonksiyonlar saftır; bugün `today` (Europe/Istanbul günü) ile gelir.
 */

/** Dönem özeti, satırlar, kesinleştirme ve "okudum" kaydı yalnız yönetici (K-467, K-468). */
export const PERFORMANCE_REPORT_MANAGE_ROLES = ['yonetici'] as const satisfies readonly Role[]
/** Rapor okuması: yönetici her raporu, öğretmen yalnız kendi kesinleşmiş raporunu (K-468). */
export const PERFORMANCE_REPORT_READ_ROLES = [
  'yonetici',
  'ogretmen',
] as const satisfies readonly Role[]

/**
 * Raporun bu turdaki bölümleri, sırasıyla (K-466). Gelişim hedefleri (ON-209) ve çok kaynaklı
 * geri bildirim (ON-212) birleşince bu listeye kendi bölümleriyle eklenir.
 */
export const PERFORMANCE_REPORT_SECTIONS = [
  'evaluation',
  'selfEvaluation',
  'observations',
  'managerOpinion',
] as const
export type PerformanceReportSection = (typeof PERFORMANCE_REPORT_SECTIONS)[number]
export const PERFORMANCE_REPORT_SECTION_LABELS = {
  evaluation: 'Dönem sonu değerlendirmesi',
  selfEvaluation: 'Öz değerlendirme',
  observations: 'Ders gözlemleri',
  managerOpinion: 'Yönetici görüşü',
} as const satisfies Record<PerformanceReportSection, string>

export const PERFORMANCE_REPORT_STATUSES = ['draft', 'finalized', 'acknowledged'] as const
export type PerformanceReportStatus = (typeof PERFORMANCE_REPORT_STATUSES)[number]
export const PERFORMANCE_REPORT_STATUS_LABELS = {
  draft: 'Kesinleşmedi',
  finalized: 'Kesinleşti',
  acknowledged: 'Okundu',
} as const satisfies Record<PerformanceReportStatus, string>

/** "Okudum" kaydının geldiği kanal; yönetici personel adına girer (K-467). */
export const PERFORMANCE_REPORT_ACK_CHANNELS = ['paper', 'email', 'in_person'] as const
export type PerformanceReportAckChannel = (typeof PERFORMANCE_REPORT_ACK_CHANNELS)[number]
export const PERFORMANCE_REPORT_ACK_CHANNEL_LABELS = {
  paper: 'Islak imzalı nüsha',
  email: 'E-posta',
  in_person: 'Yüz yüze görüşme',
} as const satisfies Record<PerformanceReportAckChannel, string>

/** Öz değerlendirmenin rapordaki durumu: yanıt yok, taslakta ya da gönderildi. */
export const PERFORMANCE_REPORT_SELF_STATUSES = ['missing', 'draft', 'submitted'] as const
export type PerformanceReportSelfStatus = (typeof PERFORMANCE_REPORT_SELF_STATUSES)[number]
export const PERFORMANCE_REPORT_SELF_STATUS_LABELS = {
  missing: 'Yanıt yok',
  draft: 'Gönderilmedi (taslak)',
  submitted: 'Gönderildi',
} as const satisfies Record<PerformanceReportSelfStatus, string>

/** Genel puan dağılımı bantları (1–5 ölçeği); puanı eksik kayıt ayrı sayılır (K-466). */
export const PERFORMANCE_SCORE_BANDS = ['1', '2', '3', '4', '5'] as const
export type PerformanceScoreBand = (typeof PERFORMANCE_SCORE_BANDS)[number]
export const PERFORMANCE_SCORE_BAND_LABELS = {
  '1': '1,00–1,99',
  '2': '2,00–2,99',
  '3': '3,00–3,99',
  '4': '4,00–4,99',
  '5': '5,00',
} as const satisfies Record<PerformanceScoreBand, string>

export const PERFORMANCE_REPORT_OPINION_MIN = 10
export const PERFORMANCE_REPORT_OPINION_MAX = 2000

// --- Şemalar -------------------------------------------------------------------------------------

export const performanceReportFinalizeSchema = z.strictObject({
  // kvkk: K (serbest metin; denetime yazılmaz)
  managerOpinion: z
    .string('Yönetici görüşünü yazın.')
    .trim()
    .min(
      PERFORMANCE_REPORT_OPINION_MIN,
      `Yönetici görüşünü en az ${String(PERFORMANCE_REPORT_OPINION_MIN)} karakterle yazın.`,
    )
    .max(
      PERFORMANCE_REPORT_OPINION_MAX,
      `Yönetici görüşü en fazla ${String(PERFORMANCE_REPORT_OPINION_MAX)} karakter olabilir.`,
    )
    .describe('Yöneticinin dönem görüşü; kesinleştirmede yazılır, sonra değişmez (K-467)'),
})
export type PerformanceReportFinalizeInput = z.input<typeof performanceReportFinalizeSchema>

export const performanceReportAcknowledgeSchema = z.strictObject({
  channel: z
    .enum(PERFORMANCE_REPORT_ACK_CHANNELS, 'Kanalı seçin.')
    .describe(
      '"Okudum" kaydının kanalı: `paper` ıslak imzalı nüsha, `email` e-posta, `in_person` yüz yüze görüşme',
    ),
  acknowledgedDate: daySchema.describe(
    'Personelin raporu okuduğunu bildirdiği gün; kesinleştirme gününden önce, bugünden sonra olamaz',
  ),
})
export type PerformanceReportAcknowledgeInput = z.input<typeof performanceReportAcknowledgeSchema>

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path?: string) =>
  new DomainError(code, message, { kind: 'rule', ...(path === undefined ? {} : { path: [path] }) })
const conflict = (code: string, message: string) =>
  new DomainError(code, message, { kind: 'conflict' })

/** Raporun durumu kesinleştirme ve "okudum" kaydından türetilir (saklanmaz). */
export function performanceReportStatus(
  report: { finalizedAt: string | null; acknowledgedDate: string | null } | null,
): PerformanceReportStatus {
  if (report === null || report.finalizedAt === null) return 'draft'
  return report.acknowledgedDate === null ? 'finalized' : 'acknowledged'
}

/** Kesinleştirmenin ön şartları (servisin kurum kilidi altında yüklediği gerçekler). */
export interface PerformanceReportFinalizeChecks {
  period: { status: PerformancePeriodStatus }
  /** Raporu daha önce kesinleşmiş mi. */
  finalized: boolean
  /** Raporun sahibi personelin kullanıcı kimliği. */
  staffUserId: string
  actorUserId: string
}

/**
 * Kesinleştirme (K-467): dönem kapanmış olmalı (422 `performance_report_period_open`), rapor bir
 * kez kesinleşir (409 `performance_report_finalized`), yönetici kendi raporunu kesinleştirmez
 * (422 `performance_report_self`). Görüş 10–2000 karakter, sonra değişmez.
 */
export function planPerformanceReportFinalize(
  input: unknown,
  checks: PerformanceReportFinalizeChecks,
): { managerOpinion: string } {
  const { managerOpinion } = performanceReportFinalizeSchema.parse(input)
  if (checks.finalized)
    throw conflict(
      'performance_report_finalized',
      'Rapor zaten kesinleşti; yönetici görüşü artık değiştirilemez.',
    )
  if (checks.period.status !== 'closed')
    throw ruleError(
      'performance_report_period_open',
      'Rapor dönem kapandıktan sonra kesinleştirilir.',
    )
  if (checks.staffUserId === checks.actorUserId)
    throw ruleError(
      'performance_report_self',
      'Kendi performans raporunuzu kesinleştiremezsiniz; başka bir yönetici kesinleştirir.',
    )
  return { managerOpinion }
}

/**
 * "Okudum" kaydı (K-467): yalnız kesinleşmiş rapora (422 `performance_report_not_finalized`), bir
 * kez (409 `performance_report_acknowledged`). Gün kesinleştirme gününden önce
 * (422 `performance_report_ack_before_final`) ve bugünden sonra (422
 * `performance_report_ack_date_future`) olamaz. Yönetici personel adına girer, kanal zorunlu.
 */
export function planPerformanceReportAcknowledge(
  report: { finalizedDate: string; acknowledgedDate: string | null } | null,
  input: unknown,
  today: string,
): { channel: PerformanceReportAckChannel; acknowledgedDate: string } {
  const parsed = performanceReportAcknowledgeSchema.parse(input)
  if (report === null)
    throw ruleError(
      'performance_report_not_finalized',
      '"Okudum" kaydı kesinleşmiş rapora girilir; önce raporu kesinleştirin.',
    )
  if (report.acknowledgedDate !== null)
    throw conflict('performance_report_acknowledged', 'Bu raporun "okudum" kaydı zaten girildi.')
  if (parsed.acknowledgedDate > today)
    throw ruleError(
      'performance_report_ack_date_future',
      'Okuma günü bugünden sonra olamaz.',
      'acknowledgedDate',
    )
  if (parsed.acknowledgedDate < report.finalizedDate)
    throw ruleError(
      'performance_report_ack_before_final',
      'Okuma günü raporun kesinleştiği günden önce olamaz.',
      'acknowledgedDate',
    )
  return parsed
}

/**
 * Rapor görünürlüğü (K-468): yönetici her raporu; öğretmen yalnız kendi kesinleşmiş raporunu
 * görür (taslak rapor ve başkasının raporu görünmez). Diğer roller görmez.
 */
export function canViewPerformanceReport(
  viewer: { role: string; membershipId: string },
  report: { membershipId: string; finalized: boolean },
): boolean {
  if (viewer.role === 'yonetici') return true
  if (viewer.role !== 'ogretmen') return false
  return report.membershipId === viewer.membershipId && report.finalized
}

/**
 * Gözlem rapora girer mi (K-466): tamamlanmış gözlem; dönemine bağlıysa o dönem, döneme
 * bağlanmamışsa günü dönem içinde. Kesinleşmiş raporda yalnız kesinleştirme anına kadar
 * tamamlanmış gözlemler girer; böylece kesinleşen rapor sonradan değişmez.
 */
export function isObservationInPeriodReport(
  observation: {
    status: string
    performancePeriodId: string | null
    observedDate: string
    completedAt: string | null
  },
  period: { id: string; startDate: string; endDate: string },
  finalizedAt: string | null,
): boolean {
  if (observation.status !== 'completed' || observation.completedAt === null) return false
  const inPeriod =
    observation.performancePeriodId === null
      ? observation.observedDate >= period.startDate && observation.observedDate <= period.endDate
      : observation.performancePeriodId === period.id
  if (!inPeriod) return false
  return finalizedAt === null || observation.completedAt <= finalizedAt
}

const round = (value: number, digits: number) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** Ortalama; boş listede `null`. */
export function averageOf(values: readonly number[], digits: number): number | null {
  if (values.length === 0) return null
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, digits)
}

/** Gözlem puanı ortalaması (100'lük), bir ondalık; gözlem yoksa `null` (K-466). */
export const observationAverage = (percents: readonly number[]) => averageOf(percents, 1)

/** Öz değerlendirmedeki puanlı soruların ortalaması (1–5), iki ondalık; puan yoksa `null`. */
export function selfEvaluationScaleAverage(
  questions: readonly SelfEvaluationQuestion[],
  answers: readonly SelfEvaluationAnswer[],
): number | null {
  const scores: number[] = []
  questions.forEach((question, index) => {
    const score = answers[index]?.score ?? null
    if (question.kind === 'scale' && score !== null) scores.push(score)
  })
  return averageOf(scores, 2)
}

/** Genel puanın dağılım bandı: tam sayı kısmı (1–5); puan yoksa `null`. */
export function performanceScoreBand(score: number | null): PerformanceScoreBand | null {
  if (score === null || !Number.isFinite(score)) return null
  const band = Math.min(5, Math.max(1, Math.floor(score)))
  return String(band) as PerformanceScoreBand
}

/** Dönem özeti satırı: personelin genel puanı, rapor durumu ve gözlem puanları. */
export interface PerformanceReportSummaryInput {
  overallScore: number | null
  status: PerformanceReportStatus
  selfEvaluationStatus: PerformanceReportSelfStatus
  observationPercents: readonly number[]
}

export interface PerformanceReportSummary {
  staffCount: number
  scoredCount: number
  /** Genel puanların ortalaması, iki ondalık; puanlı kayıt yoksa `null`. */
  averageScore: number | null
  minScore: number | null
  maxScore: number | null
  distribution: { band: PerformanceScoreBand; count: number }[]
  unscoredCount: number
  /** Dönemdeki bütün rapor gözlemlerinin 100'lük ortalaması, bir ondalık. */
  observationCount: number
  observationAverage: number | null
  selfEvaluationSubmitted: number
  finalizedCount: number
  acknowledgedCount: number
}

/**
 * Dönem özeti (K-466): personel sayısı, genel puan ortalaması, en düşük ve en yüksek puan, bant
 * dağılımı (puanı eksik kayıt ayrı), gözlem ortalaması, öz değerlendirme gönderen, kesinleşen ve
 * okunan rapor sayısı.
 */
export function performanceReportSummary(
  rows: readonly PerformanceReportSummaryInput[],
): PerformanceReportSummary {
  const scores = rows.flatMap((row) => (row.overallScore === null ? [] : [row.overallScore]))
  const counts = new Map<PerformanceScoreBand, number>()
  for (const score of scores) {
    const band = performanceScoreBand(score)
    if (band !== null) counts.set(band, (counts.get(band) ?? 0) + 1)
  }
  const percents = rows.flatMap((row) => row.observationPercents)
  return {
    staffCount: rows.length,
    scoredCount: scores.length,
    averageScore: averageOf(scores, 2),
    minScore: scores.length === 0 ? null : Math.min(...scores),
    maxScore: scores.length === 0 ? null : Math.max(...scores),
    distribution: PERFORMANCE_SCORE_BANDS.map((band) => ({ band, count: counts.get(band) ?? 0 })),
    unscoredCount: rows.length - scores.length,
    observationCount: percents.length,
    observationAverage: observationAverage(percents),
    selfEvaluationSubmitted: rows.filter((row) => row.selfEvaluationStatus === 'submitted').length,
    finalizedCount: rows.filter((row) => row.status !== 'draft').length,
    acknowledgedCount: rows.filter((row) => row.status === 'acknowledged').length,
  }
}
