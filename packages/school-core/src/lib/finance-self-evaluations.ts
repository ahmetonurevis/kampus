import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { DomainError } from './errors.ts'
import { FINANCE_PERFORMANCE_ROLES, type PerformancePeriodStatus } from './finance-performance.ts'

/**
 * Personel öz değerlendirmesi (docs/domain/finans.md DOM-FIN-131; ON-210). Performans dönemine
 * (`DOM-FIN-124`) bağlı tek bir şablon vardır: puanlı (1–5) ve açık uçlu sorular (K-448). Dönemde
 * performans kaydı olan her personelin tek yanıtı olur; yanıt taslak → gönderildi ilerler,
 * gönderilen yanıt düzenlenmez, yönetici gerekçeyle geri açar (K-449). Bu turda personelin kendi
 * ekranı yoktur: yönetici kâğıt form ya da e-postayla gelen yanıtı personel adına girer, kanal
 * saklanır. Dönem başına gönderen oranı ve yönetici görüşü K-450'dedir. Veri kişiseldir: yalnız
 * yönetici okur ve yazar, yanıt ayrıntısının okunuşu denetime düşer (K-450). Fonksiyonlar saftır.
 */

/** Öz değerlendirmeyi yalnız yönetici okur ve yazar (K-450; performans verisiyle aynı, K-429). */
export const FINANCE_SELF_EVALUATION_ROLES = FINANCE_PERFORMANCE_ROLES satisfies readonly Role[]

export const SELF_EVALUATION_QUESTION_KINDS = ['scale', 'open'] as const
export type SelfEvaluationQuestionKind = (typeof SELF_EVALUATION_QUESTION_KINDS)[number]
export const SELF_EVALUATION_QUESTION_KIND_LABELS = {
  scale: 'Puanlı (1–5)',
  open: 'Açık uçlu',
} as const satisfies Record<SelfEvaluationQuestionKind, string>

export const SELF_EVALUATION_STATUSES = ['draft', 'submitted'] as const
export type SelfEvaluationStatus = (typeof SELF_EVALUATION_STATUSES)[number]
/** Takip listesindeki durum: yanıtı hiç açılmamış personel `missing`. */
export const SELF_EVALUATION_TRACKING_STATUSES = ['missing', 'draft', 'submitted'] as const
export type SelfEvaluationTrackingStatus = (typeof SELF_EVALUATION_TRACKING_STATUSES)[number]
export const SELF_EVALUATION_TRACKING_LABELS = {
  missing: 'Gönderilmedi',
  draft: 'Taslak',
  submitted: 'Gönderildi',
} as const satisfies Record<SelfEvaluationTrackingStatus, string>

/** Personel adına girişte yanıtın geldiği kanal (K-449); kendi ekranı gelince `self_service`. */
export const SELF_EVALUATION_CHANNELS = ['paper', 'email'] as const
export type SelfEvaluationChannel = (typeof SELF_EVALUATION_CHANNELS)[number]
export const SELF_EVALUATION_CHANNEL_LABELS = {
  paper: 'Kâğıt form',
  email: 'E-posta',
} as const satisfies Record<SelfEvaluationChannel, string>

export const SELF_EVALUATION_QUESTIONS_MAX = 20
export const SELF_EVALUATION_QUESTION_MIN = 5
export const SELF_EVALUATION_QUESTION_MAX = 300
export const SELF_EVALUATION_SCORE_MIN = 1
export const SELF_EVALUATION_SCORE_MAX = 5
export const SELF_EVALUATION_TEXT_MAX = 2000
export const SELF_EVALUATION_REASON_MIN = 5
export const SELF_EVALUATION_REASON_MAX = 500

/** Yanıt yürürlük, ara görüşme ve değerlendirme aşamasında yazılır (K-449). */
export const SELF_EVALUATION_OPEN_STATUSES = [
  'active',
  'interim',
  'evaluation',
] as const satisfies readonly PerformancePeriodStatus[]

export const isSelfEvaluationOpen = (status: PerformancePeriodStatus) =>
  (SELF_EVALUATION_OPEN_STATUSES as readonly PerformancePeriodStatus[]).includes(status)

export interface SelfEvaluationQuestion {
  kind: SelfEvaluationQuestionKind
  text: string
  required: boolean
}

export interface SelfEvaluationAnswer {
  score: number | null
  text: string | null
}

// --- Şemalar -------------------------------------------------------------------------------------

const questionSchema = z.strictObject({
  kind: z
    .enum(SELF_EVALUATION_QUESTION_KINDS, 'Soru türünü seçin.')
    .describe('`scale` puanlı (1–5), `open` açık uçlu'),
  text: z
    .string('Soruyu yazın.')
    .trim()
    .min(SELF_EVALUATION_QUESTION_MIN, 'Soruyu en az 5 karakterle yazın.')
    .max(
      SELF_EVALUATION_QUESTION_MAX,
      `Soru en fazla ${String(SELF_EVALUATION_QUESTION_MAX)} karakter olabilir.`,
    )
    .describe('Soru metni'),
  required: z.boolean('Zorunluluğu seçin.').describe('Gönderimde cevap zorunlu mu'),
})

/** Şablon: 1–20 soru (K-448). */
export const selfEvaluationTemplateInputSchema = z.strictObject({
  questions: z
    .array(questionSchema, 'Soruları girin.')
    .min(1, 'En az bir soru girin.')
    .max(
      SELF_EVALUATION_QUESTIONS_MAX,
      `En çok ${String(SELF_EVALUATION_QUESTIONS_MAX)} soru girilebilir.`,
    )
    .describe('Sorular, sırasıyla'),
})
export type SelfEvaluationTemplateInput = z.input<typeof selfEvaluationTemplateInputSchema>
export type SelfEvaluationTemplateFields = z.output<typeof selfEvaluationTemplateInputSchema>

const answerSchema = z.strictObject({
  score: z
    .number('Puan geçersiz.')
    .int('Puan tam sayı olmalı.')
    .min(SELF_EVALUATION_SCORE_MIN, 'Puan en az 1 olabilir.')
    .max(SELF_EVALUATION_SCORE_MAX, 'Puan en çok 5 olabilir.')
    .nullable()
    .optional()
    .describe('Puanlı soru için 1–5; boş = cevaplanmadı'),
  // kvkk: K (serbest metin; denetime ve loga yazılmaz)
  text: z
    .string('Cevap geçersiz.')
    .trim()
    .max(
      SELF_EVALUATION_TEXT_MAX,
      `Cevap en fazla ${String(SELF_EVALUATION_TEXT_MAX)} karakter olabilir.`,
    )
    .nullable()
    .optional()
    .describe('Açık uçlu soru için cevap; boş = cevaplanmadı'),
})

const answersSchema = z
  .array(answerSchema, 'Cevaplar geçersiz.')
  .max(SELF_EVALUATION_QUESTIONS_MAX, 'Cevaplar geçersiz.')
  .describe('Soru sırasıyla cevaplar; dizi soru sayısı kadardır')

const channelSchema = z
  .enum(SELF_EVALUATION_CHANNELS, 'Yanıtın geldiği kanalı seçin.')
  .describe('Yanıtın geldiği kanal: `paper` kâğıt form, `email` e-posta (K-449)')

export const selfEvaluationCreateSchema = z.strictObject({
  // kvkk: K (personel üyeliği)
  membershipId: z
    .string('Personel seçin.')
    .trim()
    .min(1, 'Personel seçin.')
    .max(100, 'Personel geçersiz.')
    .describe('Yanıtı veren personelin kurum üyeliği; dönemde performans kaydı olmalı'),
  channel: channelSchema,
  answers: answersSchema.optional(),
})
export type SelfEvaluationCreateInput = z.input<typeof selfEvaluationCreateSchema>
export type SelfEvaluationCreateFields = z.output<typeof selfEvaluationCreateSchema>

/** Kısmi düzeltme: cevap ve kanal taslakta, yönetici görüşü gönderilmiş yanıtta (K-449, K-450). */
export const selfEvaluationUpdateSchema = z
  .strictObject({
    answers: answersSchema.optional(),
    channel: channelSchema.optional(),
    // kvkk: K (serbest metin; denetime ve loga yazılmaz)
    managerComment: z
      .string('Yönetici görüşü geçersiz.')
      .trim()
      .max(
        SELF_EVALUATION_TEXT_MAX,
        `Yönetici görüşü en fazla ${String(SELF_EVALUATION_TEXT_MAX)} karakter olabilir.`,
      )
      .transform((value) => (value === '' ? null : value))
      .nullable()
      .optional()
      .describe('Yöneticinin öz değerlendirmeye görüşü; boş metin görüşü siler (K-450)'),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Değiştirilecek bir alan girin.',
  })
export type SelfEvaluationUpdateInput = z.input<typeof selfEvaluationUpdateSchema>
export type SelfEvaluationUpdateFields = z.output<typeof selfEvaluationUpdateSchema>

export const selfEvaluationSubmitSchema = z.strictObject({})

export const selfEvaluationReopenSchema = z.strictObject({
  // kvkk: K (serbest metin; denetime ve loga yazılmaz)
  reason: z
    .string('Geri açma gerekçesini yazın.')
    .trim()
    .min(SELF_EVALUATION_REASON_MIN, 'Gerekçeyi en az 5 karakterle yazın.')
    .max(
      SELF_EVALUATION_REASON_MAX,
      `Gerekçe en fazla ${String(SELF_EVALUATION_REASON_MAX)} karakter olabilir.`,
    )
    .describe('Gönderilmiş yanıtın neden taslağa döndüğü (zorunlu, K-449)'),
})

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path?: string) =>
  new DomainError(code, message, { kind: 'rule', ...(path === undefined ? {} : { path: [path] }) })
const conflict = (code: string, message: string) =>
  new DomainError(code, message, { kind: 'conflict' })

const closedError = () =>
  conflict(
    'performance_period_closed',
    'Dönem kapandı; öz değerlendirme şablonu ve yanıtları artık değiştirilemez.',
  )

/** Boş cevap dizisi: her soru için cevaplanmamış. */
export const emptySelfEvaluationAnswers = (
  questions: readonly SelfEvaluationQuestion[],
): SelfEvaluationAnswer[] => questions.map(() => ({ score: null, text: null }))

/** Cevap verilmiş mi: puanlı soruda puan, açık uçluda boş olmayan metin. */
export const isSelfEvaluationAnswered = (
  question: SelfEvaluationQuestion,
  answer: SelfEvaluationAnswer | undefined,
) =>
  answer !== undefined &&
  (question.kind === 'scale' ? answer.score !== null : answer.text !== null && answer.text !== '')

/** Cevaplanmış soru sayısı (takip ve ekran için). */
export const selfEvaluationAnsweredCount = (
  questions: readonly SelfEvaluationQuestion[],
  answers: readonly SelfEvaluationAnswer[],
) =>
  questions.filter((question, index) => isSelfEvaluationAnswered(question, answers[index])).length

/**
 * Cevapları şablona göre doğrular ve saklanacak biçime getirir (K-449): dizi soru sayısı kadardır
 * (422 `self_evaluation_answers_mismatch`); puanlı soruya metin, açık uçluya puan yazılmaz
 * (422 `self_evaluation_answer_kind`). Boş metin cevaplanmamış sayılır.
 */
export function normalizeSelfEvaluationAnswers(
  questions: readonly SelfEvaluationQuestion[],
  answers: readonly { score?: number | null | undefined; text?: string | null | undefined }[],
): SelfEvaluationAnswer[] {
  if (answers.length !== questions.length)
    throw ruleError(
      'self_evaluation_answers_mismatch',
      'Her soru için bir cevap satırı gönderin.',
      'answers',
    )
  return questions.map((question, index) => {
    const answer = answers[index] ?? {}
    const score = answer.score ?? null
    const text =
      answer.text === undefined || answer.text === null || answer.text === '' ? null : answer.text
    if (
      (question.kind === 'scale' && text !== null) ||
      (question.kind === 'open' && score !== null)
    )
      throw ruleError(
        'self_evaluation_answer_kind',
        `${String(index + 1)}. soru ${question.kind === 'scale' ? 'puanlıdır; metin yazılmaz' : 'açık uçludur; puan verilmez'}.`,
        'answers',
      )
    return { score, text }
  })
}

/** Şablon açma (K-448): dönem kapanmamış olmalı; dönemde tek şablon. */
export function planSelfEvaluationTemplate(
  period: { status: PerformancePeriodStatus },
  input: SelfEvaluationTemplateFields,
  checks: { exists: boolean },
): SelfEvaluationQuestion[] {
  if (period.status === 'closed') throw closedError()
  if (checks.exists)
    throw conflict('self_evaluation_template_exists', 'Bu dönemin öz değerlendirme şablonu var.')
  return input.questions
}

/** Şablon düzeltme (K-448): kapanmamış dönemde, dönemde hiç yanıt açılmamışken. */
export function planSelfEvaluationTemplateUpdate(
  period: { status: PerformancePeriodStatus },
  input: SelfEvaluationTemplateFields,
  checks: { responseCount: number },
): SelfEvaluationQuestion[] {
  if (period.status === 'closed') throw closedError()
  if (checks.responseCount > 0)
    throw conflict(
      'self_evaluation_template_in_use',
      `Bu şablonla ${String(checks.responseCount)} yanıt açıldı; sorular artık değiştirilemez.`,
    )
  return input.questions
}

const notOpenError = () =>
  ruleError(
    'self_evaluation_not_open',
    'Öz değerlendirme yanıtı yürürlük, ara görüşme ya da değerlendirme aşamasında yazılır.',
  )

/** Servisin kurum kilidi altında yüklediği gerçekler (yeni yanıt). */
export interface SelfEvaluationChecks {
  period: { status: PerformancePeriodStatus }
  /** Dönemin şablonu; yoksa `null`. */
  questions: readonly SelfEvaluationQuestion[] | null
  /** Personelin dönemde performans kaydı var mı. */
  enrolled: boolean
  /** Personelin dönemde yanıtı var mı. */
  duplicate: boolean
}

/**
 * Yeni yanıt (K-449): kapanmamış ve yanıta açık dönem, şablonu olan dönem, dönemde performans kaydı
 * olan personel; personel × dönem tek yanıt. Yanıt taslak açılır; cevap verilmezse hepsi boştur.
 */
export function planSelfEvaluation(
  input: SelfEvaluationCreateFields,
  checks: SelfEvaluationChecks,
): SelfEvaluationAnswer[] {
  if (checks.period.status === 'closed') throw closedError()
  if (!isSelfEvaluationOpen(checks.period.status)) throw notOpenError()
  if (checks.questions === null)
    throw ruleError(
      'self_evaluation_template_missing',
      'Önce dönemin öz değerlendirme şablonunu hazırlayın.',
    )
  if (!checks.enrolled)
    throw ruleError(
      'self_evaluation_not_enrolled',
      'Öz değerlendirme yalnız dönemde performans kaydı olan personelden alınır.',
      'membershipId',
    )
  if (checks.duplicate)
    throw conflict('self_evaluation_exists', 'Bu personelin bu dönemde öz değerlendirmesi var.')
  return input.answers === undefined
    ? emptySelfEvaluationAnswers(checks.questions)
    : normalizeSelfEvaluationAnswers(checks.questions, input.answers)
}

interface StoredSelfEvaluationState {
  status: SelfEvaluationStatus
}

/** Yanıtın değişen alanları; `undefined` alan yazılmaz. */
export interface SelfEvaluationPatch {
  answers?: SelfEvaluationAnswer[]
  channel?: SelfEvaluationChannel
  managerComment?: string | null
}

/**
 * Yanıt düzeltmesi (K-449, K-450). Kapanmış dönem 409. Cevap ve kanal yalnız taslakta ve yanıta
 * açık dönemde (gönderilmiş yanıt 409 `self_evaluation_submitted`); yönetici görüşü yalnız
 * gönderilmiş yanıtta (422 `self_evaluation_not_submitted`).
 */
export function planSelfEvaluationUpdate(
  response: StoredSelfEvaluationState,
  period: { status: PerformancePeriodStatus },
  questions: readonly SelfEvaluationQuestion[],
  input: SelfEvaluationUpdateFields,
): SelfEvaluationPatch {
  if (period.status === 'closed') throw closedError()
  const patch: SelfEvaluationPatch = {}
  if (input.answers !== undefined || input.channel !== undefined) {
    if (response.status === 'submitted')
      throw conflict(
        'self_evaluation_submitted',
        'Gönderilmiş yanıt düzenlenemez; değiştirmek için önce gerekçeyle geri açın.',
      )
    if (!isSelfEvaluationOpen(period.status)) throw notOpenError()
    if (input.answers !== undefined)
      patch.answers = normalizeSelfEvaluationAnswers(questions, input.answers)
    if (input.channel !== undefined) patch.channel = input.channel
  }
  if (input.managerComment !== undefined) {
    if (response.status !== 'submitted')
      throw ruleError(
        'self_evaluation_not_submitted',
        'Yönetici görüşü gönderilmiş öz değerlendirmeye yazılır.',
        'managerComment',
      )
    patch.managerComment = input.managerComment
  }
  return patch
}

/**
 * Gönderim (K-449): taslak, yanıta açık dönem; zorunlu soruların hepsi cevaplı olmalı
 * (422 `self_evaluation_incomplete`, ileti eksik soru sayısını verir).
 */
export function planSelfEvaluationSubmit(
  response: StoredSelfEvaluationState & { answers: readonly SelfEvaluationAnswer[] },
  period: { status: PerformancePeriodStatus },
  questions: readonly SelfEvaluationQuestion[],
): void {
  if (period.status === 'closed') throw closedError()
  if (response.status === 'submitted')
    throw conflict('self_evaluation_already_submitted', 'Öz değerlendirme zaten gönderildi.')
  if (!isSelfEvaluationOpen(period.status)) throw notOpenError()
  const missing = questions.filter(
    (question, index) =>
      question.required && !isSelfEvaluationAnswered(question, response.answers[index]),
  ).length
  if (missing > 0)
    throw ruleError(
      'self_evaluation_incomplete',
      `Zorunlu ${String(missing)} soru cevaplanmadı; yanıt bütün zorunlu sorular cevaplanınca gönderilir.`,
      'answers',
    )
}

/** Geri açma (K-449): yalnız gönderilmiş yanıt, kapanmamış dönem; gerekçe zorunlu. */
export function planSelfEvaluationReopen(
  response: StoredSelfEvaluationState,
  period: { status: PerformancePeriodStatus },
  input: unknown,
): string {
  const { reason } = selfEvaluationReopenSchema.parse(input)
  if (period.status === 'closed') throw closedError()
  if (response.status !== 'submitted')
    throw conflict('self_evaluation_not_submitted', 'Yalnız gönderilmiş yanıt geri açılır.')
  return reason
}

// --- Takip ---------------------------------------------------------------------------------------

export interface SelfEvaluationSummary {
  /** Dönemde performans kaydı olan personel. */
  enrolled: number
  submitted: number
  draft: number
  /** Yanıtı hiç açılmamış personel. */
  missing: number
  /** Gönderen / personel, yüzde, bir ondalık; personel yoksa `null`. */
  rate: number | null
}

/** Dönem başına gönderen oranı (K-450). */
export function selfEvaluationSummary(counts: {
  enrolled: number
  submitted: number
  draft: number
}): SelfEvaluationSummary {
  const { enrolled, submitted, draft } = counts
  return {
    enrolled,
    submitted,
    draft,
    missing: Math.max(0, enrolled - submitted - draft),
    rate: enrolled === 0 ? null : Math.round((submitted * 1000) / enrolled) / 10,
  }
}
