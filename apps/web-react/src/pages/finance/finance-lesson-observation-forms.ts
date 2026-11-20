import { z } from 'zod'
import type {
  CreateLessonObservationBody,
  LessonObservationDetail,
  LessonObservationTemplate,
  UpdateLessonObservationBody,
} from '@kampus/react-shared/use-finance-lesson-observations.ts'
import {
  DEFAULT_OBSERVATION_CRITERIA,
  DEFAULT_OBSERVATION_LEVEL_DESCRIPTIONS,
  lessonObservationScore,
  lessonObservationTemplateInputSchema,
  OBSERVATION_GENERAL_NOTE_MAX,
  OBSERVATION_LEVEL_LABELS,
  OBSERVATION_LEVELS,
  OBSERVATION_RATING_NOTE_MAX,
  observationLevelMeaning,
  type ObservationCriterion,
  type ObservationScore,
} from '@kampus/school-core/lib/finance-lesson-observations.ts'

// Ders gözlem formunun saf mantığı (DOM-FIN-130; ON-206): şablon formu varsayılanları, gözlem
// açma ve düzeltme gövdeleri, puan önizlemesi (K-445, K-446). Bileşen yalnız bağlar; doğrulama
// core şemasından, kesin puan sunucudandır.

export type CriterionFormValue = {
  title: string
  description: string
  weight: number
  levels: { level: number; description: string }[]
}
export type TemplateFormValues = { name: string; criteria: CriterionFormValue[] }

/** Şablon formu doğrulaması core şemasıdır (boş açıklama sunucuda `null` olur). */
export const templateFormSchema = lessonObservationTemplateInputSchema

const defaultLevels = () =>
  OBSERVATION_LEVELS.map((level) => ({
    level,
    description: DEFAULT_OBSERVATION_LEVEL_DESCRIPTIONS[level] ?? '',
  }))

export const emptyCriterion = (title = '', description = ''): CriterionFormValue => ({
  title,
  description,
  weight: 1,
  levels: defaultLevels(),
})

/** Yeni formun önerisi: başlangıç ölçütleri ve genel seviye tanımları. */
export const defaultTemplateFormValues = (): TemplateFormValues => ({
  name: 'Ders gözlem formu',
  criteria: DEFAULT_OBSERVATION_CRITERIA.map((criterion) =>
    emptyCriterion(criterion.title, criterion.description),
  ),
})

/** Var olan formun son sürümü (düzeltme ya da yeni sürüm başlangıcı). */
export const templateFormValues = (template: LessonObservationTemplate): TemplateFormValues => ({
  name: template.name,
  criteria: template.criteria.map((criterion) => ({
    title: criterion.title,
    description: criterion.description ?? '',
    weight: criterion.weight,
    levels: criterion.levels.map(({ level, description }) => ({ level, description })),
  })),
})

export const levelLabel = (level: number) =>
  `${String(level)} · ${OBSERVATION_LEVEL_LABELS[level] ?? ''}`

// --- Gözlem açma -----------------------------------------------------------------------------------

export type ObservationCreateValues = {
  templateId: string
  teacherMembershipId: string
  /** Boş: gözlemci formu açan yönetici. */
  observerMembershipId: string
  observedDate: string
  classId: string
  subjectId: string
  performancePeriodId: string
}

export const emptyObservationCreate = (today: string): ObservationCreateValues => ({
  templateId: '',
  teacherMembershipId: '',
  observerMembershipId: '',
  observedDate: today,
  classId: '',
  subjectId: '',
  performancePeriodId: '',
})

export const observationCreateFormSchema = z.object({
  templateId: z.string().min(1, 'Gözlem formunu seçin.'),
  teacherMembershipId: z.string().min(1, 'Öğretmeni seçin.'),
  observerMembershipId: z.string(),
  observedDate: z.string().min(1, 'Gözlem gününü seçin.'),
  classId: z.string(),
  subjectId: z.string(),
  performancePeriodId: z.string(),
})

/** Boş seçimler gönderilmez; gözlemci boşsa sunucu açan kişiyi yazar. */
export function observationCreateBody(
  values: ObservationCreateValues,
): CreateLessonObservationBody {
  return {
    templateId: values.templateId,
    teacherMembershipId: values.teacherMembershipId,
    observedDate: values.observedDate,
    ...(values.observerMembershipId === ''
      ? {}
      : { observerMembershipId: values.observerMembershipId }),
    ...(values.classId === '' ? {} : { classId: values.classId }),
    ...(values.subjectId === '' ? {} : { subjectId: values.subjectId }),
    ...(values.performancePeriodId === ''
      ? {}
      : { performancePeriodId: values.performancePeriodId }),
  }
}

// --- Gözlem düzeltme -------------------------------------------------------------------------------

export type RatingFormValue = { criterionId: string; level: string; note: string }
export type ObservationEditValues = {
  observedDate: string
  generalNote: string
  ratings: RatingFormValue[]
}

const noteSchema = (max: number) =>
  z.string().max(max, `En fazla ${max.toLocaleString('tr-TR')} karakter girebilirsiniz.`)

export const observationEditFormSchema = z.object({
  observedDate: z.string().min(1, 'Gözlem gününü seçin.'),
  generalNote: noteSchema(OBSERVATION_GENERAL_NOTE_MAX),
  ratings: z.array(
    z.object({
      criterionId: z.string(),
      level: z.string(),
      note: noteSchema(OBSERVATION_RATING_NOTE_MAX),
    }),
  ),
})

/** Formun başlangıcı: ölçüt sırasıyla seviye (`''` = verilmedi) ve not. */
export function observationEditValues(detail: LessonObservationDetail): ObservationEditValues {
  const byId = new Map(detail.ratings.map((rating) => [rating.criterionId, rating]))
  return {
    observedDate: detail.observedDate,
    generalNote: detail.generalNote ?? '',
    ratings: detail.criteria.map((criterion) => {
      const rating = byId.get(criterion.id)
      return {
        criterionId: criterion.id,
        level: rating?.level === null || rating === undefined ? '' : String(rating.level),
        note: rating?.note ?? '',
      }
    }),
  }
}

const toLevel = (value: string) => (value === '' ? null : Number(value))

export function observationUpdateBody(values: ObservationEditValues): UpdateLessonObservationBody {
  return {
    observedDate: values.observedDate,
    generalNote: values.generalNote,
    ratings: values.ratings.map((rating) => ({
      criterionId: rating.criterionId,
      level: toLevel(rating.level),
      note: rating.note,
    })),
  }
}

/** Formdaki seviyelerle önizleme (rubrik kuralı); kesin puan kaydedince sunucudan gelir. */
export function previewScore(
  criteria: readonly ObservationCriterion[],
  ratings: readonly RatingFormValue[],
): ObservationScore | null {
  return lessonObservationScore(
    criteria,
    ratings.map((rating) => ({
      criterionId: rating.criterionId,
      level: toLevel(rating.level),
      note: null,
    })),
  )
}

/** Hedefin altındaki seviyede not gerekir (tamamlamada denetlenir; formda ipucu). */
export const needsNote = (level: string) =>
  level !== '' && observationLevelMeaning(Number(level)) === 'below'

/** Puan metni: "%73 (11 / 15)" ya da eksikse "2 / 5 ölçüt". */
export function scoreText(score: ObservationScore | null, rated: number, total: number): string {
  if (score === null) return `${String(rated)} / ${String(total)} ölçüt`
  return `%${String(score.percent)} (${String(score.total)} / ${String(score.max)})`
}
