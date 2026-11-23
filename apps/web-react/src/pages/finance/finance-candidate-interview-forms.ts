import { z } from 'zod'
import type {
  CandidateEvaluationBody,
  CandidateInterview,
  CreateCandidateInterviewBody,
  InterviewTemplate,
  InterviewTemplateBody,
} from '@kampus/react-shared/use-finance-candidate-interviews.ts'
import {
  CANDIDATE_INTERVIEW_STATUS_LABELS,
  CANDIDATE_INTERVIEW_TYPE_LABELS,
  CANDIDATE_INTERVIEW_TYPES,
  DEFAULT_INTERVIEW_CRITERIA,
  INTERVIEW_EVALUATORS_MAX,
  INTERVIEW_GENERAL_NOTE_MAX,
  INTERVIEW_LOCATION_MAX,
  INTERVIEW_RATING_NOTE_MAX,
  INTERVIEW_SCALE_DEFAULT,
  INTERVIEW_URL_MAX,
  interviewTemplateInputSchema,
  type CandidateInterviewStatus,
  type CandidateInterviewSummary,
  type CandidateInterviewType,
} from '@kampus/school-core/lib/finance-candidate-interviews.ts'
import { observationLevelMeaning } from '@kampus/school-core/lib/finance-lesson-observations.ts'
import { isoOfLocal, localInputOf } from './finance-event-ticket-forms.ts'

// Aday mülakatının saf mantığı (DOM-FIN-138; ON-178; K-469…K-471): mülakat formu şablonu,
// mülakat planı ve değerlendirici formu değerleri ile gövdeleri, özet metni. An Türkiye saatiyle
// girilir; puan sunucudan gelir.

export const interviewTypeText = (type: CandidateInterviewType) =>
  CANDIDATE_INTERVIEW_TYPE_LABELS[type]
export const interviewStatusText = (status: CandidateInterviewStatus) =>
  CANDIDATE_INTERVIEW_STATUS_LABELS[status]
export function interviewStatusTone(status: CandidateInterviewStatus): 'green' | 'amber' | 'gray' {
  if (status === 'completed') return 'green'
  if (status === 'planned') return 'amber'
  return 'gray'
}

export const percentText = (percent: number | null) =>
  percent === null ? '—' : `${String(percent)}/100`

/** Başvuru ayrıntısındaki mülakat özeti (K-469). */
export function interviewSummaryText(summary: CandidateInterviewSummary): string {
  const parts = [
    `${String(summary.completedCount)} yapıldı`,
    `${String(summary.plannedCount)} planlı`,
  ]
  if (summary.cancelledCount > 0) parts.push(`${String(summary.cancelledCount)} iptal`)
  if (summary.interviewAveragePercent !== null)
    parts.push(`mülakat ortalaması ${percentText(summary.interviewAveragePercent)}`)
  if (summary.sampleLessonAveragePercent !== null)
    parts.push(`örnek ders ortalaması ${percentText(summary.sampleLessonAveragePercent)}`)
  return parts.join(' · ')
}

// --- Mülakat formu şablonu -------------------------------------------------------------------------

export type InterviewTemplateFormValues = {
  name: string
  scaleMax: number
  criteria: { title: string; description: string; weight: number }[]
}

/** Şablon formu doğrulaması core şemasıdır (boş açıklama sunucuda `null` olur). */
export const interviewTemplateFormSchema = interviewTemplateInputSchema

export const emptyInterviewCriterion = (title = '', description = '') => ({
  title,
  description,
  weight: 1,
})

export const defaultInterviewTemplateValues = (): InterviewTemplateFormValues => ({
  name: 'Öğretmen mülakat formu',
  scaleMax: INTERVIEW_SCALE_DEFAULT,
  criteria: DEFAULT_INTERVIEW_CRITERIA.map((criterion) =>
    emptyInterviewCriterion(criterion.title, criterion.description),
  ),
})

export const interviewTemplateValues = (
  template: InterviewTemplate,
): InterviewTemplateFormValues => ({
  name: template.name,
  scaleMax: template.scaleMax,
  criteria: template.criteria.map((criterion) => ({
    title: criterion.title,
    description: criterion.description ?? '',
    weight: criterion.weight,
  })),
})

export const interviewTemplateBody = (
  values: InterviewTemplateFormValues,
): InterviewTemplateBody => ({
  name: values.name.trim(),
  scaleMax: values.scaleMax,
  criteria: values.criteria.map((criterion) => ({
    title: criterion.title.trim(),
    description: criterion.description.trim(),
    weight: criterion.weight,
  })),
})

// --- Mülakat planı -----------------------------------------------------------------------------------

export type InterviewPlanValues = {
  type: CandidateInterviewType
  scheduledAt: string
  location: string
  meetingUrl: string
  templateId: string
  evaluatorMembershipIds: string[]
}

export const interviewPlanDefaults = (now: Date): InterviewPlanValues => ({
  type: 'in_person',
  // Önerilen an: ertesi gün aynı saat, dakika sıfırlanmış.
  scheduledAt: `${localInputOf(new Date(now.getTime() + 86_400_000).toISOString()).slice(0, 13)}:00`,
  location: '',
  meetingUrl: '',
  templateId: '',
  evaluatorMembershipIds: [],
})

/** Formun kaynağı türe göre değişir: örnek derste ders gözlem formu (K-471). */
export const usesObservationForm = (type: CandidateInterviewType) => type === 'sample_lesson'

export const interviewPlanSchema = z
  .object({
    type: z.enum(CANDIDATE_INTERVIEW_TYPES, 'Mülakat türünü seçin.'),
    scheduledAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Mülakatın gününü ve saatini girin.'),
    location: z
      .string()
      .trim()
      .max(
        INTERVIEW_LOCATION_MAX,
        `Yer en fazla ${String(INTERVIEW_LOCATION_MAX)} karakter olabilir.`,
      ),
    meetingUrl: z
      .string()
      .trim()
      .max(INTERVIEW_URL_MAX, `Bağlantı en fazla ${String(INTERVIEW_URL_MAX)} karakter olabilir.`)
      .refine((value) => value === '' || /^https:\/\/\S+$/.test(value), {
        message: 'Bağlantı https:// ile başlamalı.',
      }),
    templateId: z.string().min(1, 'Formu seçin.'),
    evaluatorMembershipIds: z
      .array(z.string())
      .min(1, 'En az bir değerlendirici seçin.')
      .max(
        INTERVIEW_EVALUATORS_MAX,
        `En çok ${String(INTERVIEW_EVALUATORS_MAX)} değerlendirici seçilebilir.`,
      ),
  })
  .superRefine((value, ctx) => {
    if ((value.type === 'in_person' || value.type === 'sample_lesson') && value.location === '')
      ctx.addIssue({
        code: 'custom',
        path: ['location'],
        message: 'Mülakatın yapılacağı yeri yazın.',
      })
    if (value.type === 'online' && value.meetingUrl === '')
      ctx.addIssue({
        code: 'custom',
        path: ['meetingUrl'],
        message: 'Çevrim içi mülakatın bağlantısını yazın.',
      })
  })

export const interviewPlanBody = (values: InterviewPlanValues): CreateCandidateInterviewBody => ({
  type: values.type,
  scheduledAt: isoOfLocal(values.scheduledAt),
  location: values.location.trim() === '' ? null : values.location.trim(),
  meetingUrl: values.meetingUrl.trim() === '' ? null : values.meetingUrl.trim(),
  templateId: values.templateId,
  evaluatorMembershipIds: values.evaluatorMembershipIds,
})

const PLAN_FIELDS = [
  'type',
  'scheduledAt',
  'location',
  'meetingUrl',
  'templateId',
  'evaluatorMembershipIds',
] as const
/** Sunucu hata yolu → form alanı; bilinmeyen yol genel hata olur. */
export function interviewPlanField(name: string): (typeof PLAN_FIELDS)[number] | null {
  const head = name.split('.')[0]
  return PLAN_FIELDS.find((field) => field === head) ?? null
}

// --- Değerlendirme -----------------------------------------------------------------------------------

type EvaluationForm = CandidateInterview['form']

export type EvaluationFormValues = {
  ratings: { criterionId: string; score: string; note: string }[]
  generalNote: string
}

export const evaluationDefaults = (form: EvaluationForm): EvaluationFormValues => ({
  ratings: form.criteria.map((criterion) => ({ criterionId: criterion.id, score: '', note: '' })),
  generalNote: '',
})

/** Puan seçenekleri: mülakat formunda 1–ölçek, örnek derste 0–5 seviye. */
export function scoreOptions(form: EvaluationForm): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = []
  for (let score = form.scaleMin; score <= form.scaleMax; score += 1)
    options.push({
      value: String(score),
      label: String(score),
    })
  return options
}

/** Örnek derste hedefin altındaki seviyeye not zorunludur (gözlem kuralı, K-471). */
export const evaluationNeedsNote = (form: EvaluationForm, score: string) =>
  form.kind === 'observation' && score !== '' && observationLevelMeaning(Number(score)) === 'below'

export const evaluationFormSchema = (form: EvaluationForm) =>
  z
    .object({
      ratings: z.array(
        z.object({
          criterionId: z.string(),
          score: z.string().min(1, 'Puan verin.'),
          note: z
            .string()
            .trim()
            .max(
              INTERVIEW_RATING_NOTE_MAX,
              `Not en fazla ${INTERVIEW_RATING_NOTE_MAX.toLocaleString('tr-TR')} karakter olabilir.`,
            ),
        }),
      ),
      generalNote: z
        .string()
        .trim()
        .min(2, 'Genel değerlendirmeyi yazın.')
        .max(
          INTERVIEW_GENERAL_NOTE_MAX,
          `Genel değerlendirme en fazla ${INTERVIEW_GENERAL_NOTE_MAX.toLocaleString('tr-TR')} karakter olabilir.`,
        ),
    })
    .superRefine((value, ctx) => {
      value.ratings.forEach((rating, index) => {
        if (evaluationNeedsNote(form, rating.score) && rating.note === '')
          ctx.addIssue({
            code: 'custom',
            path: ['ratings', index, 'note'],
            message: 'Hedefin altındaki seviyeye kısa not yazın.',
          })
      })
    })

export const evaluationBody = (values: EvaluationFormValues): CandidateEvaluationBody => ({
  ratings: values.ratings.map((rating) => ({
    criterionId: rating.criterionId,
    score: Number(rating.score),
    note: rating.note.trim() === '' ? null : rating.note.trim(),
  })),
  generalNote: values.generalNote.trim(),
})
