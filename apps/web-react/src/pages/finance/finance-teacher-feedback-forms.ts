import { z } from 'zod'
import type {
  TeacherFeedbackCreateBody,
  TeacherFeedbackDetail,
  TeacherFeedbackUpdateBody,
} from '@kampus/react-shared/use-finance-teacher-feedback.ts'
import {
  TEACHER_FEEDBACK_QUESTION_KINDS,
  TEACHER_FEEDBACK_QUESTION_MAX,
  TEACHER_FEEDBACK_QUESTION_MIN,
  TEACHER_FEEDBACK_QUESTIONS_MAX,
  TEACHER_FEEDBACK_RESPONDENT_LABELS,
  TEACHER_FEEDBACK_RESPONDENT_ROLES,
  TEACHER_FEEDBACK_TERM_MAX,
  TEACHER_FEEDBACK_TERM_MIN,
  TEACHER_FEEDBACK_THRESHOLD_DEFAULT,
  TEACHER_FEEDBACK_THRESHOLD_MAX,
  TEACHER_FEEDBACK_THRESHOLD_MIN,
  TEACHER_FEEDBACK_TITLE_MAX,
  TEACHER_FEEDBACK_TITLE_MIN,
  type TeacherFeedbackPhase,
  type TeacherFeedbackQuestion,
  type TeacherFeedbackQuestionKind,
  type TeacherFeedbackRespondentRole,
} from '@kampus/school-core/lib/finance-teacher-feedback.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

// Öğretmen geri bildirim anketi formlarının saf mantığı (DOM-FIN-159; ON-213; K-532…K-534):
// anket formu değerleri ve gövdesi, aşama rozeti, katılım, hedef kitle ve sonuç metinleri. Kural
// doğrulaması core şemasında ve sunucudadır.

export type TeacherFeedbackFormValues = {
  title: string
  term: string
  openDate: string
  closeDate: string
  anonymityThreshold: string
  respondents: TeacherFeedbackRespondentRole[]
  classIds: string[]
  questions: TeacherFeedbackQuestion[]
}

export const emptyTeacherFeedbackQuestion = (
  kind: TeacherFeedbackQuestionKind = 'likert',
): TeacherFeedbackQuestion => ({ kind, text: '', required: kind !== 'open' })

/** Yeni anket: bugün açılır, iki hafta açık kalır; öğrenci ve veli; örnek sorular. */
export function emptyTeacherFeedback(today: string): TeacherFeedbackFormValues {
  const close = new Date(`${today}T00:00:00Z`)
  close.setUTCDate(close.getUTCDate() + 13)
  return {
    title: '',
    term: '',
    openDate: today,
    closeDate: close.toISOString().slice(0, 10),
    anonymityThreshold: String(TEACHER_FEEDBACK_THRESHOLD_DEFAULT),
    respondents: ['ogrenci', 'veli'],
    classIds: [],
    questions: [
      { kind: 'likert', text: 'Dersi anlaşılır anlatıyor', required: true },
      { kind: 'likert', text: 'Sorulara ve geri bildirime zaman ayırıyor', required: true },
      { kind: 'open', text: 'Eklemek istedikleriniz', required: false },
    ],
  }
}

export function teacherFeedbackValues(survey: TeacherFeedbackDetail): TeacherFeedbackFormValues {
  return {
    title: survey.title,
    term: survey.term,
    openDate: survey.openDate,
    closeDate: survey.closeDate,
    anonymityThreshold: String(survey.anonymityThreshold),
    respondents: [...survey.audience.respondents],
    classIds: [...survey.audience.classIds],
    questions: survey.questions.map((question) => ({ ...question })),
  }
}

const questionFormSchema = z.object({
  kind: z.enum(TEACHER_FEEDBACK_QUESTION_KINDS, 'Soru türünü seçin.'),
  text: z
    .string()
    .trim()
    .min(TEACHER_FEEDBACK_QUESTION_MIN, 'Soruyu en az 5 karakterle yazın.')
    .max(
      TEACHER_FEEDBACK_QUESTION_MAX,
      `Soru en fazla ${String(TEACHER_FEEDBACK_QUESTION_MAX)} karakter olabilir.`,
    ),
  required: z.boolean(),
})

const DAY = /^\d{4}-\d{2}-\d{2}$/

export const teacherFeedbackFormSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(TEACHER_FEEDBACK_TITLE_MIN, 'Başlığı en az 3 karakterle yazın.')
      .max(
        TEACHER_FEEDBACK_TITLE_MAX,
        `Başlık en fazla ${String(TEACHER_FEEDBACK_TITLE_MAX)} karakter olabilir.`,
      ),
    term: z
      .string()
      .trim()
      .min(TEACHER_FEEDBACK_TERM_MIN, 'Dönemi en az 2 karakterle yazın.')
      .max(
        TEACHER_FEEDBACK_TERM_MAX,
        `Dönem en fazla ${String(TEACHER_FEEDBACK_TERM_MAX)} karakter olabilir.`,
      ),
    openDate: z.string().regex(DAY, 'Açılış gününü seçin.'),
    closeDate: z.string().regex(DAY, 'Kapanış gününü seçin.'),
    anonymityThreshold: z.string().regex(/^\d+$/, 'Eşiği seçin.'),
    respondents: z
      .array(z.enum(TEACHER_FEEDBACK_RESPONDENT_ROLES))
      .min(1, 'Öğrenci, veli ya da ikisini seçin.'),
    classIds: z.array(z.string()),
    questions: z
      .array(questionFormSchema)
      .min(1, 'En az bir soru girin.')
      .max(
        TEACHER_FEEDBACK_QUESTIONS_MAX,
        `En çok ${String(TEACHER_FEEDBACK_QUESTIONS_MAX)} soru girilebilir.`,
      )
      .refine(
        (questions) => questions.some((question) => question.kind === 'likert'),
        'En az bir ölçek sorusu girin; ortalama ölçek sorularından hesaplanır.',
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

export function teacherFeedbackCreateBody(
  values: TeacherFeedbackFormValues,
): TeacherFeedbackCreateBody {
  return {
    title: values.title.trim(),
    term: values.term.trim(),
    openDate: values.openDate,
    closeDate: values.closeDate,
    anonymityThreshold: Number(values.anonymityThreshold),
    audience: { respondents: values.respondents, classIds: values.classIds },
    questions: values.questions.map((question) => ({ ...question, text: question.text.trim() })),
  }
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join()

/** Yalnız değişen alanlar; değişiklik yoksa `null`. */
export function teacherFeedbackUpdateBody(
  survey: TeacherFeedbackDetail,
  values: TeacherFeedbackFormValues,
): TeacherFeedbackUpdateBody | null {
  const next = teacherFeedbackCreateBody(values)
  const body: TeacherFeedbackUpdateBody = {}
  if (next.title !== survey.title) body.title = next.title
  if (next.term !== survey.term) body.term = next.term
  if (next.openDate !== survey.openDate) body.openDate = next.openDate
  if (next.closeDate !== survey.closeDate) body.closeDate = next.closeDate
  if (next.anonymityThreshold !== survey.anonymityThreshold)
    body.anonymityThreshold = next.anonymityThreshold
  if (
    !sameList(next.audience.respondents, survey.audience.respondents) ||
    !sameList(next.audience.classIds, survey.audience.classIds)
  )
    body.audience = next.audience
  if (JSON.stringify(next.questions) !== JSON.stringify(survey.questions))
    body.questions = next.questions
  return Object.keys(body).length === 0 ? null : body
}

/** Eşik seçenekleri "5"…"20"; 5'in altı yoktur (K-532). */
export const TEACHER_FEEDBACK_THRESHOLD_OPTIONS = Array.from(
  { length: TEACHER_FEEDBACK_THRESHOLD_MAX - TEACHER_FEEDBACK_THRESHOLD_MIN + 1 },
  (_, index) => String(TEACHER_FEEDBACK_THRESHOLD_MIN + index),
)

export const TEACHER_FEEDBACK_PHASE_TONES = {
  draft: 'gray',
  scheduled: 'amber',
  open: 'green',
  closed: 'purple',
} as const satisfies Record<TeacherFeedbackPhase, BadgeTone>

/** "Öğrenci, Veli · 9-A, 9-B" ya da "… · bütün sınıflar". */
export function teacherFeedbackAudienceText(survey: {
  audience: { respondents: readonly TeacherFeedbackRespondentRole[]; classIds: readonly string[] }
  audienceClasses?: readonly { id: string; name: string }[]
}): string {
  const who = survey.audience.respondents
    .map((role) => TEACHER_FEEDBACK_RESPONDENT_LABELS[role])
    .join(', ')
  if (survey.audience.classIds.length === 0) return `${who} · bütün sınıflar`
  const names = (survey.audienceClasses ?? []).map((row) => row.name).join(', ')
  return `${who} · ${names === '' ? `${String(survey.audience.classIds.length)} sınıf` : names}`
}

/** "12 değerlendirme · 7 kişi"; taslakta bilgi metni. */
export function teacherFeedbackParticipationText(survey: {
  participation: { responses: number; respondents: number } | null
}): string {
  if (survey.participation === null) return 'Taslak; yayımlanınca katılım izlenir.'
  return `${String(survey.participation.responses)} değerlendirme · ${String(survey.participation.respondents)} kişi`
}

/** Öğretmen sonucu neden gizli (K-532); görünürse `null`. */
export function teacherFeedbackHiddenText(result: {
  hiddenReason: 'not_closed' | 'below_threshold' | null
  responses: number
  threshold: number
}): string | null {
  switch (result.hiddenReason) {
    case null:
      return null
    case 'not_closed':
      return `Sonuç anket kapanınca gösterilir (şu an ${String(result.responses)} yanıt).`
    case 'below_threshold':
      return `Sonuç gizli: anonimlik için en az ${String(result.threshold)} yanıt gerekir, ${String(result.responses)} yanıt var. Yorumlar gösterilmez.`
    default:
      return result.hiddenReason satisfies never
  }
}

/** "4,25" ya da "—". */
export const teacherFeedbackAverageText = (average: number | null) =>
  average === null
    ? '—'
    : average.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

/** Eğilim değişimi: önceki görünür döneme göre "+0,40", "−0,25"; karşılaştırma yoksa `null`. */
export function teacherFeedbackTrendDelta(
  trend: readonly { visible: boolean; average: number | null }[],
  index: number,
): string | null {
  const current = trend[index]
  if (current?.average === null || current === undefined) return null
  const previous = trend
    .slice(0, index)
    .reverse()
    .find((point) => point.average !== null)
  if (previous?.average === null || previous === undefined) return null
  const delta = Math.round((current.average - previous.average) * 100) / 100
  const text = Math.abs(delta).toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return delta > 0 ? `+${text}` : delta < 0 ? `−${text}` : '0,00'
}
