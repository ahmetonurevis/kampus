import { z } from 'zod'
import type {
  TaskAppeal,
  TaskAppealBody,
  TaskAppealDecisionBody,
} from '@kampus/react-shared/use-task-grading.ts'
import type { TaskSubmissionDetail } from '@kampus/react-shared/use-task-submissions.ts'
import {
  APPEAL_OUTCOMES,
  appealDecisionSchema,
  appealInputSchema,
} from '@kampus/school-core/skills/rubric.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'
import { dateTimeLabel, scoreBody, scoreFormSchema } from './task-model.ts'

/**
 * Görev itirazının ekran modeli (OG-211; DOM-BEC-025). Kim itiraz edebilir, süre ve kimin karar
 * verebileceği sunucudadır; ekran yalnız sunucunun döndürdüğü `appealDeadline` ve `appeal`
 * alanlarını okur. Burada durum metinleri, form şemaları, gövde üreticileri ve öğretmenin
 * itiraz listesinin satırları vardır.
 */

type Version = TaskSubmissionDetail['versions'][number]

// --- Kursiyer ve veli ------------------------------------------------------------------------

export type LearnerAppealState =
  | { kind: 'none' }
  | { kind: 'open'; text: string }
  | { kind: 'expired'; text: string }
  | { kind: 'filed'; text: string; reason: string }
  | { kind: 'decided'; tone: BadgeTone; label: string; text: string; reason: string | null }

/**
 * Sürümün itiraz durumu. `appealDeadline` yalnız değerlendirme türünde, sonuç duyurulduysa ve
 * itiraz yokken dolar; yoksa ve itiraz da yoksa ekranda itirazdan söz edilmez (DOM-BEC-045).
 * İtiraz yalnız son sürümün sonucuna yapılır; eski sürümde süre açık görünse de düğme çıkmaz.
 * Süre dolumu burada yalnız gösterim içindir; kesin karar sunucunundur (422 `appeal_window_closed`).
 */
export function learnerAppealState(
  version: Pick<Version, 'appeal' | 'appealDeadline'>,
  isLatest: boolean,
  now: Date,
): LearnerAppealState {
  const { appeal, appealDeadline } = version
  if (appeal) {
    if (appeal.outcome === null) {
      return {
        kind: 'filed',
        text: `İtirazınız ${dateTimeLabel(appeal.filedAt)} tarihinde alındı; bir öğretmen inceliyor.`,
        reason: appeal.reason,
      }
    }
    const outcome = APPEAL_OUTCOMES[appeal.outcome].label
    return {
      kind: 'decided',
      tone: appeal.outcome === 'upheld' ? 'green' : 'gray',
      label: outcome,
      text: `İtirazınız ${outcome.toLocaleLowerCase('tr')}${
        appeal.decidedAt ? ` (${dateTimeLabel(appeal.decidedAt)})` : ''
      }.`,
      reason: appeal.decisionReason,
    }
  }
  if (appealDeadline === null || !isLatest) return { kind: 'none' }
  if (now.getTime() > new Date(appealDeadline).getTime()) {
    return {
      kind: 'expired',
      text: `İtiraz süresi doldu (son gün ${dateTimeLabel(appealDeadline)}).`,
    }
  }
  return {
    kind: 'open',
    text: `Sonuca ${dateTimeLabel(appealDeadline)} tarihine kadar itiraz edebilirsiniz.`,
  }
}

/** İtiraz formu çekirdek şemadır (`appealInputSchema`): gerekçe zorunlu, alan mesajı çekirdekten. */
export const appealFormSchema = appealInputSchema
export type AppealFormValues = z.input<typeof appealFormSchema>

export const appealBody = (values: AppealFormValues, versionNumber: number): TaskAppealBody => ({
  versionNumber,
  reason: values.reason.trim(),
})

/** Sunucu doğrulama yolunun form alanı; tanınmayan yol formun `root.server` hatasına düşer. */
export const appealFieldFor = (path: string): 'reason' | 'root.server' =>
  path === 'reason' ? 'reason' : 'root.server'

// --- Öğretmenin karar formu ------------------------------------------------------------------

const [, rejectedDecision] = appealDecisionSchema.options

export type AppealOutcomeChoice = keyof typeof APPEAL_OUTCOMES

export const APPEAL_OUTCOME_OPTIONS = (Object.keys(APPEAL_OUTCOMES) as AppealOutcomeChoice[]).map(
  (value) => ({ value, label: APPEAL_OUTCOMES[value].label }),
)

/** Karar gerekçesinin sınırı çekirdeğin `rejected` dalındandır; kabulde aynı gerekçe geçerlidir. */
const decisionReason = rejectedDecision.shape.reason

export const appealDecisionFormSchema = z
  .object({
    outcome: z.enum(['upheld', 'rejected']).nullable(),
    reason: decisionReason,
    criteria: scoreFormSchema.shape.criteria,
    overallComment: z.string(),
  })
  .superRefine((value, context) => {
    if (value.outcome === null) {
      context.addIssue({ code: 'custom', path: ['outcome'], message: 'Kararı seçin.' })
      return
    }
    // Ret yalnız gerekçe ister; kabulde yeni rubrik puanı ayrıca `scoreFormSchema` ile sınanır.
    if (value.outcome === 'rejected') return
    const score = scoreFormSchema.safeParse({
      criteria: value.criteria,
      overallComment: value.overallComment,
    })
    if (!score.success) {
      for (const issue of score.error.issues) context.addIssue({ ...issue, code: 'custom' })
    }
  })

export type AppealDecisionFormValues = z.input<typeof appealDecisionFormSchema>

/**
 * Kabulde yeni puan, retde yalnız gerekçe gider; toplam sunucuda hesaplanır. İtiraz kimliği zaten
 * sürümü belirler; kabul puanı `versionNumber` taşımaz (sunucu gövdeyi katı okur, fazla alan 400).
 */
export function appealDecisionBody(values: AppealDecisionFormValues): TaskAppealDecisionBody {
  const reason = values.reason.trim()
  if (values.outcome === 'upheld') {
    const { criteria, overallComment } = scoreBody(
      { criteria: values.criteria, overallComment: values.overallComment },
      0,
    )
    return { outcome: 'upheld', reason, score: { criteria, overallComment } }
  }
  return { outcome: 'rejected', reason }
}

/** Karar hatalarında teslim eskir: güncel teslim yüklenir ve uyarı pencerede gösterilir. */
const DECISION_STALE_CODES = new Set([
  'version_conflict',
  'appeal_decided',
  'submission_version_not_found',
])
export const showsAppealStaleNotice = (error: { code: string }) =>
  DECISION_STALE_CODES.has(error.code)

export const APPEAL_STALE_TEXT =
  'İtiraz bu arada değişti ve güncel hâli yüklendi. Karar verilmişse form kalkar.'

const DECISION_FIELD = /^(outcome|reason|overallComment|criteria\.\d+\.(band|comment))$/

/**
 * Karar hatalarının form alanı. Kabulün puanı sunucuda `score` altındadır (`score.criteria.0.band`);
 * önek atılarak aynı puan alanlarına bağlanır, tanınmayan yol `root.server` olur.
 */
export function appealDecisionFieldFor(path: string): string {
  const name = path.replace(/^score\./, '')
  return DECISION_FIELD.test(name) ? name : 'root.server'
}

/** Son sürümün itirazı; pencerede karar formu yalnız bunun için açılır. */
export function latestAppeal(
  submission: Pick<TaskSubmissionDetail, 'versions'>,
): { appeal: TaskAppeal; versionNumber: number } | null {
  const version = submission.versions.at(-1)
  return version?.appeal ? { appeal: version.appeal, versionNumber: version.number } : null
}
