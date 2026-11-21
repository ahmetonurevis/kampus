import { z } from 'zod'
import type {
  AssignedStaffSurvey,
  StaffSurveyCreateBody,
  StaffSurveyDetail,
  StaffSurveyResultView,
  StaffSurveyUpdateBody,
} from '@kampus/react-shared/use-finance-staff-surveys.ts'
import {
  STAFF_FEEDBACK_THRESHOLD_MAX,
  STAFF_FEEDBACK_THRESHOLD_MIN,
} from '@kampus/school-core/lib/finance-staff-feedback.ts'
import {
  STAFF_SURVEY_QUESTION_KINDS,
  STAFF_SURVEY_QUESTION_MAX,
  STAFF_SURVEY_QUESTION_MIN,
  STAFF_SURVEY_QUESTIONS_MAX,
  STAFF_SURVEY_ROLE_LABELS,
  STAFF_SURVEY_SCALES,
  STAFF_SURVEY_TEXT_MAX,
  STAFF_SURVEY_TITLE_MAX,
  STAFF_SURVEY_TITLE_MIN,
  type StaffSurveyPhase,
  type StaffSurveyQuestion,
  type StaffSurveyQuestionKind,
} from '@kampus/school-core/lib/finance-staff-surveys.ts'
import { STAFF_ROLES, type StaffRole } from '@kampus/school-core/lib/staff-accounts.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

// Personel memnuniyet anketi formlarının saf mantığı (DOM-FIN-143; ON-191; K-484…K-486): anket
// formu değerleri ve gövdesi, yanıt formu, aşama rozeti, katılım ve sonuç metinleri. Kural
// doğrulaması core şemasında ve sunucudadır.

export type StaffSurveyFormValues = {
  title: string
  openDate: string
  closeDate: string
  /** "" = kurumun anonimlik eşiği. */
  anonymityThreshold: string
  roles: StaffRole[]
  unitIds: string[]
  questions: StaffSurveyQuestion[]
}

export const emptyStaffSurveyQuestion = (
  kind: StaffSurveyQuestionKind = 'likert',
): StaffSurveyQuestion => ({ kind, text: '', required: kind !== 'open' })

/** Yeni anket: bugün açılır, iki hafta açık kalır; eNPS ve açık uçlu soru önerilir. */
export function emptyStaffSurvey(today: string): StaffSurveyFormValues {
  const close = new Date(`${today}T00:00:00Z`)
  close.setUTCDate(close.getUTCDate() + 13)
  return {
    title: '',
    openDate: today,
    closeDate: close.toISOString().slice(0, 10),
    anonymityThreshold: '',
    roles: [],
    unitIds: [],
    questions: [
      emptyStaffSurveyQuestion('likert'),
      {
        kind: 'enps',
        text: 'Kurumumuzu çalışma yeri olarak tavsiye eder misiniz?',
        required: true,
      },
      { kind: 'open', text: 'Eklemek istedikleriniz', required: false },
    ],
  }
}

export function staffSurveyValues(survey: StaffSurveyDetail): StaffSurveyFormValues {
  return {
    title: survey.title,
    openDate: survey.openDate,
    closeDate: survey.closeDate,
    anonymityThreshold: String(survey.anonymityThreshold),
    roles: [...survey.audience.roles],
    unitIds: [...survey.audience.unitIds],
    questions: survey.questions.map((question) => ({ ...question })),
  }
}

const questionFormSchema = z.object({
  kind: z.enum(STAFF_SURVEY_QUESTION_KINDS, 'Soru türünü seçin.'),
  text: z
    .string()
    .trim()
    .min(STAFF_SURVEY_QUESTION_MIN, 'Soruyu en az 5 karakterle yazın.')
    .max(
      STAFF_SURVEY_QUESTION_MAX,
      `Soru en fazla ${String(STAFF_SURVEY_QUESTION_MAX)} karakter olabilir.`,
    ),
  required: z.boolean(),
})

export const staffSurveyFormSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(STAFF_SURVEY_TITLE_MIN, 'Başlığı en az 3 karakterle yazın.')
      .max(
        STAFF_SURVEY_TITLE_MAX,
        `Başlık en fazla ${String(STAFF_SURVEY_TITLE_MAX)} karakter olabilir.`,
      ),
    openDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Açılış gününü seçin.'),
    closeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Kapanış gününü seçin.'),
    anonymityThreshold: z.string(),
    roles: z.array(z.enum(STAFF_ROLES)),
    unitIds: z.array(z.string()),
    questions: z
      .array(questionFormSchema)
      .min(1, 'En az bir soru girin.')
      .max(
        STAFF_SURVEY_QUESTIONS_MAX,
        `En çok ${String(STAFF_SURVEY_QUESTIONS_MAX)} soru girilebilir.`,
      ),
  })
  .superRefine((value, ctx) => {
    if (value.closeDate < value.openDate)
      ctx.addIssue({
        code: 'custom',
        path: ['closeDate'],
        message: 'Kapanış günü açılış gününden önce olamaz.',
      })
  })

const threshold = (value: string) => (value === '' ? undefined : Number(value))

export function staffSurveyCreateBody(values: StaffSurveyFormValues): StaffSurveyCreateBody {
  const anonymityThreshold = threshold(values.anonymityThreshold)
  return {
    title: values.title.trim(),
    openDate: values.openDate,
    closeDate: values.closeDate,
    ...(anonymityThreshold === undefined ? {} : { anonymityThreshold }),
    audience: { roles: values.roles, unitIds: values.unitIds },
    questions: values.questions.map((question) => ({ ...question, text: question.text.trim() })),
  }
}

/** Yalnız değişen alanlar; değişiklik yoksa `null`. */
export function staffSurveyUpdateBody(
  survey: StaffSurveyDetail,
  values: StaffSurveyFormValues,
): StaffSurveyUpdateBody | null {
  const next = staffSurveyCreateBody(values)
  const body: StaffSurveyUpdateBody = {}
  if (next.title !== survey.title) body.title = next.title
  if (next.openDate !== survey.openDate) body.openDate = next.openDate
  if (next.closeDate !== survey.closeDate) body.closeDate = next.closeDate
  if (
    next.anonymityThreshold !== undefined &&
    next.anonymityThreshold !== survey.anonymityThreshold
  )
    body.anonymityThreshold = next.anonymityThreshold
  const sameList = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && [...a].sort().join() === [...b].sort().join()
  if (
    !sameList(next.audience.roles, survey.audience.roles) ||
    !sameList(next.audience.unitIds, survey.audience.unitIds)
  )
    body.audience = next.audience
  if (JSON.stringify(next.questions) !== JSON.stringify(survey.questions))
    body.questions = next.questions
  return Object.keys(body).length === 0 ? null : body
}

/** Eşik seçenekleri "3"…"10" (K-486). */
export const STAFF_SURVEY_THRESHOLD_OPTIONS = Array.from(
  { length: STAFF_FEEDBACK_THRESHOLD_MAX - STAFF_FEEDBACK_THRESHOLD_MIN + 1 },
  (_, index) => String(STAFF_FEEDBACK_THRESHOLD_MIN + index),
)

/** Puanlı sorunun seçenekleri: Likert "1"…"5", eNPS "0"…"10"; açık uçluda boş. */
export function staffSurveyScaleOptions(kind: StaffSurveyQuestionKind): string[] {
  if (kind === 'open') return []
  const { min, max } = STAFF_SURVEY_SCALES[kind]
  return Array.from({ length: max - min + 1 }, (_, index) => String(min + index))
}

export type StaffSurveyAnswerFormValues = { answers: { value: string; text: string }[] }

export const staffSurveyAnswerDefaults = (
  questions: readonly StaffSurveyQuestion[],
): StaffSurveyAnswerFormValues => ({ answers: questions.map(() => ({ value: '', text: '' })) })

/** Yanıt formu şeması: zorunlu sorular dolu, metin ≤ 2000. */
export function staffSurveyAnswerFormSchema(questions: readonly StaffSurveyQuestion[]) {
  return z.object({
    answers: z
      .array(
        z.object({
          value: z.string(),
          text: z
            .string()
            .max(
              STAFF_SURVEY_TEXT_MAX,
              `Cevap en fazla ${String(STAFF_SURVEY_TEXT_MAX)} karakter olabilir.`,
            ),
        }),
      )
      .superRefine((answers, ctx) => {
        questions.forEach((question, index) => {
          const answer = answers[index]
          const empty =
            question.kind === 'open' ? (answer?.text.trim() ?? '') === '' : answer?.value === ''
          if (question.required && empty)
            ctx.addIssue({
              code: 'custom',
              path: [index, question.kind === 'open' ? 'text' : 'value'],
              message: 'Bu soru zorunlu.',
            })
        })
      }),
  })
}

export function staffSurveyAnswersBody(
  questions: readonly StaffSurveyQuestion[],
  values: StaffSurveyAnswerFormValues,
): { answers: { value?: number; text?: string }[] } {
  return {
    answers: questions.map((question, index) => {
      const answer = values.answers[index] ?? { value: '', text: '' }
      if (question.kind === 'open') {
        const text = answer.text.trim()
        return text === '' ? {} : { text }
      }
      return answer.value === '' ? {} : { value: Number(answer.value) }
    }),
  }
}

export const STAFF_SURVEY_PHASE_TONES = {
  draft: 'gray',
  scheduled: 'amber',
  open: 'green',
  closed: 'purple',
} as const satisfies Record<StaffSurveyPhase, BadgeTone>

const percent = (rate: number | null) =>
  (rate ?? 0).toLocaleString('tr-TR', { maximumFractionDigits: 1 })

/** "Katılım 3 / 5 (%60)"; taslakta hedef kitle büyüklüğü. */
export function staffSurveyParticipationText(survey: {
  participation: { participants: number; responded: number; rate: number | null } | null
}): string {
  const { participation } = survey
  if (participation === null) return 'Taslak; yayımlanınca katılım izlenir.'
  return `Katılım ${String(participation.responded)} / ${String(participation.participants)} (%${percent(participation.rate)})`
}

export function staffSurveyAudienceText(survey: {
  audience: { roles: readonly StaffRole[]; unitIds: readonly string[] }
  audienceUnits?: readonly { id: string; name: string }[]
}): string {
  const roles =
    survey.audience.roles.length === 0
      ? 'Bütün personel'
      : survey.audience.roles.map((role) => STAFF_SURVEY_ROLE_LABELS[role]).join(', ')
  if (survey.audience.unitIds.length === 0) return roles
  const units = (survey.audienceUnits ?? []).map((unit) => unit.name).join(', ')
  return `${roles} · ${units === '' ? `${String(survey.audience.unitIds.length)} birim` : units}`
}

/** Sonuç neden gizli (K-486); görünürse `null`. */
export function staffSurveyHiddenText(result: StaffSurveyResultView): string | null {
  switch (result.hiddenReason) {
    case null:
      return null
    case 'not_closed':
      return `Sonuçlar anket kapanınca gösterilir (şu an ${String(result.responded)} yanıt).`
    case 'below_threshold':
      return `Sonuç gizli: anonimlik için en az ${String(result.threshold)} yanıt gerekir, ${String(result.responded)} yanıt var.`
    case 'unit_below_threshold':
      return 'Bu birimin sonucu gizli: yanıt sayısı anonimlik eşiğinin altında ya da diğer birimlerle birlikte kişiyi belli edebilir.'
    default:
      return result.hiddenReason satisfies never
  }
}

/** "4,25" ya da "—". */
export const staffSurveyAverageText = (average: number | null) =>
  average === null
    ? '—'
    : average.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

/** eNPS puanı işaretli: "+25", "−10", "0". */
export const staffSurveyEnpsText = (score: number) =>
  score > 0 ? `+${String(score)}` : score < 0 ? `−${String(Math.abs(score))}` : '0'

/** Yanıt bekleyen anketin durumu (personelin kendi ekranı). */
export function assignedSurveyStatus(survey: AssignedStaffSurvey): {
  text: string
  tone: BadgeTone
} {
  if (survey.responded) return { text: 'Yanıtlandı', tone: 'green' }
  if (survey.phase === 'scheduled') return { text: 'Açılmadı', tone: 'gray' }
  return { text: 'Yanıt bekliyor', tone: 'amber' }
}
