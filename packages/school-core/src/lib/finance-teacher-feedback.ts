import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { meetsAnonymityThreshold } from './finance-staff-feedback.ts'
import {
  normalizeStaffSurveyAnswers,
  shuffled,
  STAFF_SURVEY_SCALES,
  visibleAnonymousGroups,
  type StaffSurveyAnswer,
} from './finance-staff-surveys.ts'

/**
 * Öğrenci ve veli geri bildirimi: öğretmene yönelik dönemlik anket (docs/domain/finans.md
 * DOM-FIN-159; ON-213; IST-069; K-532…K-534). Personel memnuniyet anketinin (DOM-FIN-143)
 * yanıt–kimlik ayrımı ve eşik desenini öğretmen başına uygular; genel veli anketinden (OG-164)
 * bağımsızdır. Yönetici taslak açar: başlık, dönem adı, açılış ve kapanış günü, hedef kitle
 * (öğrenci, veli ya da ikisi; sınıf süzgeci), anonimlik eşiği (en az 5, K-532) ve sorular (Likert
 * 1–5, açık uçlu). Yayımda sorular, eşik ve hedef kitle donar; yönetici anketi kapanış gününden
 * önce de kapatabilir. Yanıtlayan yalnız kendi (velide çocuğunun) sınıfının öğretmenlerini, her
 * öğretmeni bir kez değerlendirir (K-533). Katılım işareti ayrı tutulur, yanıt satırı kişiye
 * bağlanmaz. Sonuç öğretmen başına, kapanıştan sonra ve en az eşik kadar yanıtla döner; açık uçlu
 * cevaplar eşik altında hiç dönmez, eşik altındaki sınıflar "diğer sınıflar" grubunda birleşir
 * (K-532). Fonksiyonlar saftır; bugün ve rastgelelik dışarıdan verilir.
 */

/** Anketi yalnız yönetici hazırlar, yayımlar, kapatır ve bütün sonuçları okur (K-532). */
export const FINANCE_TEACHER_FEEDBACK_ROLES = ['yonetici'] as const satisfies readonly Role[]
/** Öğretmen yalnız kendi sonucunu okur (K-532). */
export const TEACHER_FEEDBACK_TEACHER_ROLES = ['ogretmen'] as const satisfies readonly Role[]
/** Yanıtlayan roller: öğrenci ve veli (K-533). */
export const TEACHER_FEEDBACK_RESPONDENT_ROLES = [
  'ogrenci',
  'veli',
] as const satisfies readonly Role[]
export type TeacherFeedbackRespondentRole = (typeof TEACHER_FEEDBACK_RESPONDENT_ROLES)[number]
export const TEACHER_FEEDBACK_RESPONDENT_LABELS = {
  ogrenci: 'Öğrenci',
  veli: 'Veli',
} as const satisfies Record<TeacherFeedbackRespondentRole, string>

export const TEACHER_FEEDBACK_QUESTION_KINDS = ['likert', 'open'] as const
export type TeacherFeedbackQuestionKind = (typeof TEACHER_FEEDBACK_QUESTION_KINDS)[number]
export const TEACHER_FEEDBACK_QUESTION_KIND_LABELS = {
  likert: 'Ölçek (1–5)',
  open: 'Açık uçlu',
} as const satisfies Record<TeacherFeedbackQuestionKind, string>

export const TEACHER_FEEDBACK_STATUSES = ['draft', 'published', 'archived'] as const
export type TeacherFeedbackStatus = (typeof TEACHER_FEEDBACK_STATUSES)[number]

/** Aşama saklanmaz; durum, kapatılma anı ve bugünden hesaplanır. */
export const TEACHER_FEEDBACK_PHASES = ['draft', 'scheduled', 'open', 'closed'] as const
export type TeacherFeedbackPhase = (typeof TEACHER_FEEDBACK_PHASES)[number]
export const TEACHER_FEEDBACK_PHASE_LABELS = {
  draft: 'Taslak',
  scheduled: 'Yayımlandı, açılmadı',
  open: 'Yanıta açık',
  closed: 'Kapandı',
} as const satisfies Record<TeacherFeedbackPhase, string>

export const TEACHER_FEEDBACK_TITLE_MIN = 3
export const TEACHER_FEEDBACK_TITLE_MAX = 150
export const TEACHER_FEEDBACK_TERM_MIN = 2
export const TEACHER_FEEDBACK_TERM_MAX = 60
export const TEACHER_FEEDBACK_QUESTIONS_MAX = 20
export const TEACHER_FEEDBACK_QUESTION_MIN = 5
export const TEACHER_FEEDBACK_QUESTION_MAX = 300
export const TEACHER_FEEDBACK_TEXT_MAX = 1000
export const TEACHER_FEEDBACK_CLASSES_MAX = 100
export const TEACHER_FEEDBACK_DURATION_MAX_DAYS = 90
/**
 * Anonimlik eşiği (K-532): varsayılan ve alt sınır 5. Kurum anket başına artırabilir (en çok 20),
 * azaltamaz: sınıfın öğretmeni beş kişiden az yanıtta tek tek cevabı tahmin edebilir.
 */
export const TEACHER_FEEDBACK_THRESHOLD_MIN = 5
export const TEACHER_FEEDBACK_THRESHOLD_MAX = 20
export const TEACHER_FEEDBACK_THRESHOLD_DEFAULT = TEACHER_FEEDBACK_THRESHOLD_MIN
/** Eşik altındaki sınıfların birleştiği grubun anahtarı (K-532). */
export const TEACHER_FEEDBACK_OTHER_GROUP = 'other'
/** Eğilimde gösterilen en çok dönem (en yeni kapanan anketler). */
export const TEACHER_FEEDBACK_TREND_MAX = 12

// --- Şemalar -------------------------------------------------------------------------------------

const questionSchema = z.strictObject({
  kind: z
    .enum(TEACHER_FEEDBACK_QUESTION_KINDS, 'Soru türünü seçin.')
    .describe('`likert` 1–5 ölçek, `open` açık uçlu'),
  text: z
    .string('Soruyu yazın.')
    .trim()
    .min(TEACHER_FEEDBACK_QUESTION_MIN, 'Soruyu en az 5 karakterle yazın.')
    .max(
      TEACHER_FEEDBACK_QUESTION_MAX,
      `Soru en fazla ${String(TEACHER_FEEDBACK_QUESTION_MAX)} karakter olabilir.`,
    )
    .describe('Soru metni'),
  required: z.boolean('Zorunluluğu seçin.').describe('Yanıtta cevap zorunlu mu'),
})
export type TeacherFeedbackQuestion = z.output<typeof questionSchema>

const questionsSchema = z
  .array(questionSchema, 'Soruları girin.')
  .min(1, 'En az bir soru girin.')
  .max(
    TEACHER_FEEDBACK_QUESTIONS_MAX,
    `En çok ${String(TEACHER_FEEDBACK_QUESTIONS_MAX)} soru girilebilir.`,
  )
  .refine(
    (questions) => questions.some((question) => question.kind === 'likert'),
    'En az bir ölçek sorusu girin; ortalama ve eğilim ölçek sorularından hesaplanır.',
  )
  .describe('Sorular, sırasıyla; yayımdan sonra değişmez')

const unique = <T>(values: readonly T[]) => new Set(values).size === values.length

export const teacherFeedbackAudienceSchema = z.strictObject({
  respondents: z
    .array(z.enum(TEACHER_FEEDBACK_RESPONDENT_ROLES, 'Yanıtlayanı seçin.'), 'Yanıtlayanları seçin.')
    .min(1, 'Öğrenci, veli ya da ikisini seçin.')
    .max(TEACHER_FEEDBACK_RESPONDENT_ROLES.length, 'Yanıtlayanlar geçersiz.')
    .refine(unique, 'Bir yanıtlayan bir kez seçilir.')
    .describe('Yanıtlayan roller: `ogrenci`, `veli` ya da ikisi (K-533)'),
  classIds: z
    .array(
      z.string('Sınıf geçersiz.').trim().min(1, 'Sınıf geçersiz.').max(100),
      'Sınıfları seçin.',
    )
    .max(
      TEACHER_FEEDBACK_CLASSES_MAX,
      `En çok ${String(TEACHER_FEEDBACK_CLASSES_MAX)} sınıf seçilebilir.`,
    )
    .refine(unique, 'Bir sınıf bir kez seçilir.')
    .describe('Sınıf/grup süzgeci (öğrencinin güncel sınıfı); boş = bütün sınıflar'),
})
export type TeacherFeedbackAudience = z.output<typeof teacherFeedbackAudienceSchema>

const titleSchema = z
  .string('Anket başlığını yazın.')
  .trim()
  .min(TEACHER_FEEDBACK_TITLE_MIN, 'Başlığı en az 3 karakterle yazın.')
  .max(
    TEACHER_FEEDBACK_TITLE_MAX,
    `Başlık en fazla ${String(TEACHER_FEEDBACK_TITLE_MAX)} karakter olabilir.`,
  )
  .describe('Anket başlığı')

const termSchema = z
  .string('Dönemi yazın.')
  .trim()
  .min(TEACHER_FEEDBACK_TERM_MIN, 'Dönemi en az 2 karakterle yazın.')
  .max(
    TEACHER_FEEDBACK_TERM_MAX,
    `Dönem en fazla ${String(TEACHER_FEEDBACK_TERM_MAX)} karakter olabilir.`,
  )
  .describe('Dönem adı (ör. "2026–2027 1. dönem"); eğilimde etiket olur')

const thresholdSchema = z
  .number('Eşiği girin.')
  .int('Eşik tam sayı olmalı.')
  .min(TEACHER_FEEDBACK_THRESHOLD_MIN, 'Eşik en az 5 olabilir; kurum eşiği azaltamaz.')
  .max(TEACHER_FEEDBACK_THRESHOLD_MAX, 'Eşik en çok 20 olabilir.')
  .describe('Öğretmen başına sonucun gösterilmesi için gereken en az yanıt (5–20; varsayılan 5)')

const dayDistance = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

function datesIssue(openDate: string, closeDate: string): string | null {
  if (closeDate < openDate) return 'Kapanış günü açılış gününden önce olamaz.'
  if (dayDistance(openDate, closeDate) + 1 > TEACHER_FEEDBACK_DURATION_MAX_DAYS)
    return `Anket en çok ${String(TEACHER_FEEDBACK_DURATION_MAX_DAYS)} gün açık kalabilir.`
  return null
}

export const teacherFeedbackCreateSchema = z
  .strictObject({
    title: titleSchema,
    term: termSchema,
    openDate: daySchema.describe('Açılış günü (Europe/Istanbul, dahil)'),
    closeDate: daySchema.describe('Kapanış günü (Europe/Istanbul, dahil)'),
    anonymityThreshold: thresholdSchema.optional(),
    audience: teacherFeedbackAudienceSchema.describe('Hedef kitle (K-533)'),
    questions: questionsSchema,
  })
  .superRefine((value, ctx) => {
    const issue = datesIssue(value.openDate, value.closeDate)
    if (issue !== null) ctx.addIssue({ code: 'custom', path: ['closeDate'], message: issue })
  })
export type TeacherFeedbackCreateInput = z.input<typeof teacherFeedbackCreateSchema>
export type TeacherFeedbackCreateFields = z.output<typeof teacherFeedbackCreateSchema>

export const teacherFeedbackUpdateSchema = z
  .strictObject({
    title: titleSchema.optional(),
    term: termSchema.optional(),
    openDate: daySchema.describe('Açılış günü').optional(),
    closeDate: daySchema.describe('Kapanış günü').optional(),
    anonymityThreshold: thresholdSchema.optional(),
    audience: teacherFeedbackAudienceSchema.describe('Hedef kitle').optional(),
    questions: questionsSchema.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Değiştirilecek bir alan gönderin.',
  })
export type TeacherFeedbackUpdateInput = z.input<typeof teacherFeedbackUpdateSchema>
export type TeacherFeedbackUpdateFields = z.output<typeof teacherFeedbackUpdateSchema>

const answerSchema = z.strictObject({
  value: z
    .number('Cevap geçersiz.')
    .int('Cevap tam sayı olmalı.')
    .nullable()
    .optional()
    .describe('Ölçek sorusunda 1–5; boş = cevaplanmadı'),
  // kvkk: K (serbest metin; denetime ve loga yazılmaz, kişiye bağlanmaz)
  text: z
    .string('Cevap geçersiz.')
    .trim()
    .max(
      TEACHER_FEEDBACK_TEXT_MAX,
      `Cevap en fazla ${String(TEACHER_FEEDBACK_TEXT_MAX)} karakter olabilir.`,
    )
    .nullable()
    .optional()
    .describe('Açık uçlu soru için cevap; boş = cevaplanmadı'),
})

/** Yanıtlayanın bir öğretmen için yanıtı (K-533): öğretmen ve soru sırasıyla cevaplar. */
export const teacherFeedbackResponseSchema = z.strictObject({
  teacherId: z
    .string('Öğretmeni seçin.')
    .trim()
    .min(1, 'Öğretmeni seçin.')
    .max(100, 'Öğretmen geçersiz.')
    .describe('Değerlendirilen öğretmen kaydı (`teachers`)'),
  answers: z
    .array(answerSchema, 'Cevapları girin.')
    .max(TEACHER_FEEDBACK_QUESTIONS_MAX, 'Cevaplar geçersiz.')
    .describe('Soru sırasıyla cevaplar; dizi soru sayısı kadardır'),
})
export type TeacherFeedbackResponseInput = z.input<typeof teacherFeedbackResponseSchema>
export type TeacherFeedbackResponseFields = z.output<typeof teacherFeedbackResponseSchema>

export type TeacherFeedbackAnswer = StaffSurveyAnswer

// --- Aşama ve yaşam döngüsü ----------------------------------------------------------------------

const ruleError = (code: string, message: string, path?: string) =>
  new DomainError(code, message, { kind: 'rule', ...(path === undefined ? {} : { path: [path] }) })
const conflict = (code: string, message: string) =>
  new DomainError(code, message, { kind: 'conflict' })

interface SurveyDates {
  status: TeacherFeedbackStatus
  openDate: string
  closeDate: string
  /** Yöneticinin erken kapatma anı; yoksa kapanış günü geçince kapanır. */
  closedAt: string | null
}

/**
 * Aşama: taslak; yayımlanmış anket açılış gününden önce "açılmadı", açılış ve kapanış günü
 * arasında (uçlar dahil) "yanıta açık", kapanış günü geçince ya da yönetici kapatınca "kapandı".
 */
export function teacherFeedbackPhase(survey: SurveyDates, today: string): TeacherFeedbackPhase {
  if (survey.status !== 'published') return 'draft'
  if (survey.closedAt !== null || today > survey.closeDate) return 'closed'
  if (today < survey.openDate) return 'scheduled'
  return 'open'
}

const notDraft = () =>
  conflict(
    'teacher_feedback_not_draft',
    'Anket yayımlandı; sorular, tarihler, hedef kitle ve eşik artık değiştirilemez.',
  )

export interface TeacherFeedbackDraft {
  title: string
  term: string
  openDate: string
  closeDate: string
  anonymityThreshold: number
  audience: TeacherFeedbackAudience
  questions: TeacherFeedbackQuestion[]
}

const unknownClasses = (unknownClassIds: readonly string[]) => {
  if (unknownClassIds.length > 0)
    throw ruleError('teacher_feedback_class_not_found', 'Seçilen sınıf bulunamadı.', 'audience')
}

/** Yeni taslak: eşik verilmezse 5 (K-532); bilinmeyen sınıf 422. */
export function planTeacherFeedbackCreate(
  input: TeacherFeedbackCreateFields,
  checks: { unknownClassIds: readonly string[] },
): TeacherFeedbackDraft {
  unknownClasses(checks.unknownClassIds)
  return {
    title: input.title,
    term: input.term,
    openDate: input.openDate,
    closeDate: input.closeDate,
    anonymityThreshold: input.anonymityThreshold ?? TEACHER_FEEDBACK_THRESHOLD_DEFAULT,
    audience: input.audience,
    questions: input.questions,
  }
}

/** Taslak düzeltmesi: yalnız taslak; birleşen tarihler yeniden denetlenir. */
export function planTeacherFeedbackUpdate(
  survey: TeacherFeedbackDraft & { status: TeacherFeedbackStatus },
  input: TeacherFeedbackUpdateFields,
  checks: { unknownClassIds: readonly string[] },
): TeacherFeedbackDraft {
  if (survey.status !== 'draft') throw notDraft()
  unknownClasses(checks.unknownClassIds)
  const next: TeacherFeedbackDraft = {
    title: input.title ?? survey.title,
    term: input.term ?? survey.term,
    openDate: input.openDate ?? survey.openDate,
    closeDate: input.closeDate ?? survey.closeDate,
    anonymityThreshold: input.anonymityThreshold ?? survey.anonymityThreshold,
    audience: input.audience ?? survey.audience,
    questions: input.questions ?? survey.questions,
  }
  const issue = datesIssue(next.openDate, next.closeDate)
  if (issue !== null) throw ruleError('teacher_feedback_dates_invalid', issue, 'closeDate')
  return next
}

/** Yayım: yalnız taslak; kapanış günü geçmiş taslak yayımlanmaz. */
export function planTeacherFeedbackPublish(
  survey: SurveyDates,
  checks: { today: string; unknownClassIds: readonly string[] },
): void {
  if (survey.status !== 'draft') throw notDraft()
  unknownClasses(checks.unknownClassIds)
  if (survey.closeDate < checks.today)
    throw ruleError(
      'teacher_feedback_closes_past',
      'Kapanış günü geçti; yayımlamadan önce tarihleri düzeltin.',
      'closeDate',
    )
}

/** Taslağı kaldırma (arşiv): yayımlanmış anket kaldırılmaz. */
export function planTeacherFeedbackArchive(survey: { status: TeacherFeedbackStatus }): void {
  if (survey.status !== 'draft') throw notDraft()
}

/**
 * Erken kapatma: yalnız yayımlanmış ve kapanmamış anket. Kapanınca yanıt alınmaz ve sonuç
 * açılır; kapatma geri alınmaz.
 */
export function planTeacherFeedbackClose(survey: SurveyDates, today: string): void {
  if (survey.status !== 'published')
    throw conflict('teacher_feedback_close_draft', 'Taslak kapatılmaz; kaldırılabilir.')
  if (teacherFeedbackPhase(survey, today) === 'closed')
    throw conflict('teacher_feedback_already_closed', 'Anket zaten kapandı.')
}

// --- Yanıtlayan ve değerlendirilecek öğretmenler -------------------------------------------------

/** Kapsam kaynağının bu kuralın okuduğu kısmı (`lib/scope.ts` `ScopeSource` ile uyumlu). */
export interface TeacherFeedbackSource {
  students: readonly { id: string; classId: string; isActive?: boolean }[]
  classes: readonly { id: string; teacherId: string }[]
  assignments: readonly { classId: string; teacherId: string }[]
  teachers: readonly { id: string; isActive?: boolean; deletedAt?: string | null }[]
}

/**
 * Yanıtlayanın değerlendireceği öğretmenler (K-533): öğrencinin (velide kapsamdaki her çocuğun)
 * güncel sınıfının sınıf öğretmeni ve o sınıfa ders ataması olan öğretmenler. Pasif öğrenci,
 * hedef kitle sınıf süzgecine uymayan sınıf ve pasif/silinmiş öğretmen sayılmaz. Öğretmen birden
 * çok sınıfta eşleşirse kırılım sınıfı kimliği en küçük olandır. Öğretmen kimliği → sınıf.
 */
export function teacherFeedbackTeachersFor(
  source: TeacherFeedbackSource,
  studentIds: ReadonlySet<string>,
  classFilter: readonly string[],
): Map<string, string> {
  const filter = new Set(classFilter)
  const activeTeachers = new Set(
    source.teachers
      .filter((teacher) => teacher.isActive !== false && !teacher.deletedAt)
      .map((teacher) => teacher.id),
  )
  const classIds = [
    ...new Set(
      source.students
        .filter(
          (student) =>
            studentIds.has(student.id) &&
            student.isActive !== false &&
            (filter.size === 0 || filter.has(student.classId)),
        )
        .map((student) => student.classId),
    ),
  ].sort((a, b) => a.localeCompare(b))
  const teachers = new Map<string, string>()
  const add = (teacherId: string, classId: string) => {
    if (activeTeachers.has(teacherId) && !teachers.has(teacherId)) teachers.set(teacherId, classId)
  }
  for (const classId of classIds) {
    for (const row of source.classes) if (row.id === classId) add(row.teacherId, classId)
    for (const row of source.assignments) if (row.classId === classId) add(row.teacherId, classId)
  }
  return teachers
}

/** Yanıtlayan bu ankete katılabilir mi (K-533): rolü hedef kitlede olmalı. */
export const isTeacherFeedbackRespondent = (
  audience: TeacherFeedbackAudience,
  role: string,
): role is TeacherFeedbackRespondentRole =>
  (audience.respondents as readonly string[]).includes(role)

/**
 * Yanıt (K-533): anket yanıta açık olmalı (açılmadıysa 422 `teacher_feedback_not_open`,
 * kapandıysa 422 `teacher_feedback_closed`); öğretmen yanıtlayanın değerlendirebileceği
 * öğretmenlerden olmalı (422 `teacher_feedback_teacher_not_eligible`); her öğretmen bir kez (409
 * `teacher_feedback_already_responded`). Cevaplar sorulara göre denetlenir.
 */
export function planTeacherFeedbackResponse(
  survey: SurveyDates & { questions: readonly TeacherFeedbackQuestion[] },
  checks: { eligible: ReadonlyMap<string, string>; responded: boolean; today: string },
  input: TeacherFeedbackResponseFields,
): { classId: string; answers: TeacherFeedbackAnswer[] } {
  const phase = teacherFeedbackPhase(survey, checks.today)
  if (phase === 'closed')
    throw ruleError('teacher_feedback_closed', 'Anket kapandı; yanıt artık alınmıyor.')
  if (phase !== 'open') throw ruleError('teacher_feedback_not_open', 'Anket henüz yanıta açılmadı.')
  const classId = checks.eligible.get(input.teacherId)
  if (classId === undefined)
    throw ruleError(
      'teacher_feedback_teacher_not_eligible',
      'Yalnız kendi sınıfınızın öğretmenlerini değerlendirebilirsiniz.',
      'teacherId',
    )
  if (checks.responded)
    throw conflict('teacher_feedback_already_responded', 'Bu öğretmeni zaten değerlendirdiniz.')
  return {
    classId,
    answers: normalizeStaffSurveyAnswers(survey.questions, input.answers, 'teacher_feedback'),
  }
}

// --- Sonuç ---------------------------------------------------------------------------------------

/** Yanıt satırı: öğretmen, kırılım sınıfı ve cevaplar; kişi ve zaman yoktur. */
export interface TeacherFeedbackStoredResponse {
  teacherId: string
  classId: string
  answers: readonly TeacherFeedbackAnswer[]
}

export type TeacherFeedbackHiddenReason = 'not_closed' | 'below_threshold'

export interface TeacherFeedbackQuestionResult {
  kind: TeacherFeedbackQuestionKind
  text: string
  required: boolean
  /** Bu soruyu cevaplayan sayısı (gizliyse `null`). */
  answered: number | null
  /** Soru cevap sayısı eşiğin altında ya da öğretmen sonucu gizli. */
  hidden: boolean
  average: number | null
  /** Ölçek sorusunda 1–5 değerlerinin cevap sayısı. */
  distribution: number[]
  /** Açık uçlu cevaplar, karışık sırayla; kimden, hangi sınıftan ve ne zaman geldiği yoktur. */
  texts: string[]
}

export interface TeacherFeedbackGroup {
  /** Sınıf kimliği ya da `other` (eşik altındaki sınıfların birleşimi). */
  key: string
  /** Gruptaki sınıflar; `other` grubunda birleşen sınıflar. */
  classIds: string[]
  responses: number
  /** Ölçek sorularının bütün cevaplarının ortalaması, iki ondalık. */
  average: number | null
}

export interface TeacherFeedbackTeacherResult {
  teacherId: string
  /** Yanıt sayısı; eşik altında da döner (içerik taşımaz). */
  responses: number
  visible: boolean
  hiddenReason: TeacherFeedbackHiddenReason | null
  /** Ölçek sorularının bütün cevaplarının ortalaması, iki ondalık (gizliyse `null`). */
  average: number | null
  questions: TeacherFeedbackQuestionResult[]
  /** Sınıf kırılımı; tek grup kalırsa boş (toplamın aynısı). */
  groups: TeacherFeedbackGroup[]
}

const round2 = (value: number) => Math.round(value * 100) / 100
const LIKERT = STAFF_SURVEY_SCALES.likert

const isAnswered = (question: TeacherFeedbackQuestion, answer: TeacherFeedbackAnswer | undefined) =>
  answer !== undefined && (question.kind === 'open' ? answer.text !== null : answer.value !== null)

function averageOf(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : round2(values.reduce((sum, value) => sum + value, 0) / values.length)
}

/** Ölçek sorularındaki bütün değerler (genel ortalama ve eğilim için). */
function likertValues(
  questions: readonly TeacherFeedbackQuestion[],
  rows: readonly TeacherFeedbackStoredResponse[],
): number[] {
  return rows.flatMap((row) =>
    questions.flatMap((question, index) => {
      const value = row.answers[index]?.value ?? null
      return question.kind === 'likert' && value !== null ? [value] : []
    }),
  )
}

function hiddenQuestion(question: TeacherFeedbackQuestion): TeacherFeedbackQuestionResult {
  return {
    kind: question.kind,
    text: question.text,
    required: question.required,
    answered: null,
    hidden: true,
    average: null,
    distribution: [],
    texts: [],
  }
}

/**
 * Bir öğretmenin sonucu (K-532). Yalnız anket kapandıktan sonra (`not_closed`; açıkken her yeni
 * yanıtla değişen ortalama, katılımla birlikte tek yanıtı ele verirdi) ve en az `threshold` yanıtla
 * (`below_threshold`) döner. Soru başına cevap sayısı da eşiğin altındaysa soru gizlidir; açık
 * uçlu cevaplar eşik altında hiç dönmez ve karışık sırayla döner. Sınıf kırılımı: eşiği geçen
 * sınıflar tek tek, geçmeyenler `other` grubunda birleşir; birleşim eşik altında kalırsa en küçük
 * görünen sınıf da gruba katılır (tamamlayıcı gizleme, `visibleAnonymousGroups`). Tek grup
 * kalırsa kırılım boştur.
 */
export function teacherFeedbackTeacherResult(input: {
  teacherId: string
  questions: readonly TeacherFeedbackQuestion[]
  threshold: number
  closed: boolean
  responses: readonly TeacherFeedbackStoredResponse[]
  random: () => number
}): TeacherFeedbackTeacherResult {
  const { questions, threshold, responses } = input
  const hidden = (reason: TeacherFeedbackHiddenReason): TeacherFeedbackTeacherResult => ({
    teacherId: input.teacherId,
    responses: responses.length,
    visible: false,
    hiddenReason: reason,
    average: null,
    questions: questions.map(hiddenQuestion),
    groups: [],
  })
  if (!input.closed) return hidden('not_closed')
  if (!meetsAnonymityThreshold(responses.length, threshold)) return hidden('below_threshold')

  const questionResults = questions.map((question, index): TeacherFeedbackQuestionResult => {
    const given = responses.flatMap((row) => {
      const answer = row.answers[index]
      return answer !== undefined && isAnswered(question, answer) ? [answer] : []
    })
    if (!meetsAnonymityThreshold(given.length, threshold)) return hiddenQuestion(question)
    const base = {
      kind: question.kind,
      text: question.text,
      required: question.required,
      answered: given.length,
      hidden: false,
    }
    if (question.kind === 'open')
      return {
        ...base,
        average: null,
        distribution: [],
        texts: shuffled(
          given.flatMap((answer) => (answer.text === null ? [] : [answer.text])),
          input.random,
        ),
      }
    const values = given.flatMap((answer) => (answer.value === null ? [] : [answer.value]))
    return {
      ...base,
      average: averageOf(values),
      distribution: Array.from(
        { length: LIKERT.max - LIKERT.min + 1 },
        (_, offset) => values.filter((value) => value === LIKERT.min + offset).length,
      ),
      texts: [],
    }
  })

  const byClass = new Map<string, TeacherFeedbackStoredResponse[]>()
  for (const row of responses) byClass.set(row.classId, [...(byClass.get(row.classId) ?? []), row])
  const counts = new Map([...byClass].map(([classId, rows]) => [classId, rows.length]))
  const visibleClasses = visibleAnonymousGroups(counts, threshold)
  const groups: TeacherFeedbackGroup[] = [...visibleClasses]
    .sort((a, b) => a.localeCompare(b))
    .map((classId) => {
      const rows = byClass.get(classId) ?? []
      return {
        key: classId,
        classIds: [classId],
        responses: rows.length,
        average: averageOf(likertValues(questions, rows)),
      }
    })
  const merged = [...byClass.keys()]
    .filter((classId) => !visibleClasses.has(classId))
    .sort((a, b) => a.localeCompare(b))
  if (merged.length > 0) {
    const rows = merged.flatMap((classId) => byClass.get(classId) ?? [])
    groups.push({
      key: TEACHER_FEEDBACK_OTHER_GROUP,
      classIds: merged,
      responses: rows.length,
      average: averageOf(likertValues(questions, rows)),
    })
  }
  return {
    teacherId: input.teacherId,
    responses: responses.length,
    visible: true,
    hiddenReason: null,
    average: averageOf(likertValues(questions, responses)),
    questions: questionResults,
    groups: groups.length > 1 ? groups : [],
  }
}

/** Anketin bütün öğretmenleri için sonuç; yanıtı olan öğretmenler, kimlik sırasıyla. */
export function teacherFeedbackResults(input: {
  questions: readonly TeacherFeedbackQuestion[]
  threshold: number
  closed: boolean
  responses: readonly TeacherFeedbackStoredResponse[]
  random: () => number
}): TeacherFeedbackTeacherResult[] {
  const byTeacher = new Map<string, TeacherFeedbackStoredResponse[]>()
  for (const row of input.responses)
    byTeacher.set(row.teacherId, [...(byTeacher.get(row.teacherId) ?? []), row])
  return [...byTeacher]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([teacherId, responses]) =>
      teacherFeedbackTeacherResult({ ...input, teacherId, responses }),
    )
}

export interface TeacherFeedbackTrendSurvey {
  surveyId: string
  title: string
  term: string
  closeDate: string
  questions: readonly TeacherFeedbackQuestion[]
  threshold: number
  /** Bu öğretmenin yanıtları. */
  responses: readonly TeacherFeedbackStoredResponse[]
}

export interface TeacherFeedbackTrendPoint {
  surveyId: string
  title: string
  term: string
  closeDate: string
  responses: number
  visible: boolean
  /** Ölçek sorularının genel ortalaması; eşik altında `null`. */
  average: number | null
}

/**
 * Dönemler arası eğilim (K-532): kapanmış anketlerde öğretmenin genel ortalaması, kapanış gününe
 * göre eskiden yeniye, en çok son 12 dönem. Sorular dönemden döneme değişebildiği için eğilim
 * yalnız ölçek sorularının genel ortalamasıdır; eşik altındaki dönem ortalama taşımaz.
 */
export function teacherFeedbackTrend(
  surveys: readonly TeacherFeedbackTrendSurvey[],
): TeacherFeedbackTrendPoint[] {
  return [...surveys]
    .sort((a, b) => a.closeDate.localeCompare(b.closeDate) || a.surveyId.localeCompare(b.surveyId))
    .slice(-TEACHER_FEEDBACK_TREND_MAX)
    .map((survey) => {
      const visible = meetsAnonymityThreshold(survey.responses.length, survey.threshold)
      return {
        surveyId: survey.surveyId,
        title: survey.title,
        term: survey.term,
        closeDate: survey.closeDate,
        responses: survey.responses.length,
        visible,
        average: visible ? averageOf(likertValues(survey.questions, survey.responses)) : null,
      }
    })
}
