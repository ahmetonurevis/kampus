import { z } from 'zod'
import type {
  StaffFeedbackOverview,
  StaffFeedbackResultView,
} from '@kampus/react-shared/use-finance-staff-feedback.ts'
import type { PerformancePeriodStatus } from '@kampus/school-core/lib/finance-performance.ts'
import {
  isStaffFeedbackAssignable,
  isStaffFeedbackOpen,
  STAFF_FEEDBACK_REASON_MAX,
  STAFF_FEEDBACK_REASON_MIN,
  STAFF_FEEDBACK_RELATIONS,
  STAFF_FEEDBACK_THRESHOLD_MAX,
  STAFF_FEEDBACK_THRESHOLD_MIN,
  type StaffFeedbackQuestion,
  type StaffFeedbackRelation,
} from '@kampus/school-core/lib/finance-staff-feedback.ts'
import { emptySelfEvaluationQuestion } from './finance-self-evaluation-forms.ts'

// Çok kaynaklı geri bildirim formlarının saf mantığı (DOM-FIN-134; ON-212): şablon varsayılanı,
// atama ve geri alma formları, eşik seçenekleri, özet ve toplu sonuç metinleri (K-457…K-459).
// Soru ve cevap formu öz değerlendirmeninkidir (`finance-self-evaluation-forms.ts`). Kural
// doğrulaması core şemasında ve sunucudadır.

export function staffFeedbackTemplateDefaults(template: StaffFeedbackOverview['template']): {
  questions: StaffFeedbackQuestion[]
} {
  return {
    questions:
      template === null
        ? [emptySelfEvaluationQuestion()]
        : template.questions.map((question) => ({ ...question })),
  }
}

export type StaffFeedbackAssignmentFormValues = {
  reviewerMembershipId: string
  relation: StaffFeedbackRelation
}

export const staffFeedbackAssignmentFormSchema = z.object({
  reviewerMembershipId: z.string().min(1, 'Değerlendireni seçin.'),
  relation: z.enum(STAFF_FEEDBACK_RELATIONS, 'İlişki türünü seçin.'),
})

export const staffFeedbackWithdrawFormSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(STAFF_FEEDBACK_REASON_MIN, 'Gerekçeyi en az 5 karakterle yazın.')
    .max(
      STAFF_FEEDBACK_REASON_MAX,
      `Gerekçe en fazla ${String(STAFF_FEEDBACK_REASON_MAX)} karakter olabilir.`,
    ),
})

/** Eşik seçenekleri "3"…"10" (K-459). */
export const STAFF_FEEDBACK_THRESHOLD_OPTIONS = Array.from(
  { length: STAFF_FEEDBACK_THRESHOLD_MAX - STAFF_FEEDBACK_THRESHOLD_MIN + 1 },
  (_, index) => String(STAFF_FEEDBACK_THRESHOLD_MIN + index),
)

const percent = (rate: number | null) =>
  (rate ?? 0).toLocaleString('tr-TR', { maximumFractionDigits: 1 })

/** "1 / 2"; atama yoksa "—". */
export const staffFeedbackProgressText = (progress: { assigned: number; responded: number }) =>
  progress.assigned === 0 ? '—' : `${String(progress.responded)} / ${String(progress.assigned)}`

/** Özet: "Yanıtlanan 3 / 5 (%60) · Yönetici 1 / 1 · Meslektaş 2 / 4"; atama yoksa açıklama. */
export function staffFeedbackSummaryText(summary: StaffFeedbackOverview['summary']): string {
  if (summary.assigned === 0) return 'Henüz değerlendiren atanmadı.'
  const { manager, peer } = summary.byRelation
  return `Yanıtlanan ${String(summary.responded)} / ${String(summary.assigned)} (%${percent(summary.rate)}) · Yönetici ${staffFeedbackProgressText(manager)} · Meslektaş ${staffFeedbackProgressText(peer)}`
}

export const staffFeedbackThresholdText = (threshold: number) =>
  `Meslektaş sonuçları değerlendirme aşamasından sonra, en az ${String(threshold)} yanıtla ve yalnız toplu gösterilir.`

/** Meslektaş toplu sonucunun neden gizli olduğu (K-459). */
export function staffFeedbackPeerHiddenText(
  peer: StaffFeedbackResultView['peer'],
  threshold: number,
): string | null {
  if (peer.hiddenReason === 'period_open')
    return `Meslektaş sonucu dönem değerlendirme aşamasına geçince gösterilir (şu an ${String(peer.responded)} yanıt).`
  if (peer.hiddenReason === 'below_threshold')
    return `Meslektaş sonucu gizli: en az ${String(threshold)} yanıt gerekir, ${String(peer.responded)} yanıt var.`
  return null
}

/** Puanlı soruda ortalama: "3,67 / 5". */
export const staffFeedbackAverageText = (average: number | null) =>
  average === null
    ? '—'
    : `${average.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} / 5`

/** Dönemin aşamasına göre açık işlemler (K-457, K-458). */
export function staffFeedbackEditable(
  status: PerformancePeriodStatus,
  template: StaffFeedbackOverview['template'],
) {
  return {
    template: status !== 'closed' && (template === null || !template.locked),
    assign: isStaffFeedbackAssignable(status),
    respond: template !== null && isStaffFeedbackOpen(status),
  }
}
