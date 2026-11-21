import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { DomainError } from './errors.ts'
import type { JobApplicationStage } from './finance-job-postings.ts'
import {
  lessonObservationScore,
  observationLevelMeaning,
  type ObservationCriterion,
  type ObservationScore,
} from './finance-lesson-observations.ts'

/**
 * Aday değerlendirme ve mülakat (docs/domain/finans.md DOM-FIN-138; ON-178). İş başvurusu
 * (DOM-FIN-128) "mülakat" aşamasındayken yönetici başvuruya mülakat planlar: tür (ön görüşme, yüz
 * yüze, çevrim içi, örnek ders), gün ve saat, yer ya da bağlantı, değerlendiriciler (kurumun etkin
 * yönetici ya da öğretmen üyeliği) ve form. Durum planlandı → yapıldı ya da iptal (K-469).
 *
 * Mülakat formu kurumun sürümlü şablonudur (ON-206 deseni): ad, ölçek (1–N) ve ölçütler (ad,
 * açıklama, ağırlık); kullanılmış sürüm değişmez, yeni sürüm açılır. Her değerlendirici yapılmış
 * mülakatta kendi formunu bir kez gönderir (ölçüt başına puan ve not, genel değerlendirme);
 * gönderilen değerlendirme değişmez, puan sunucuda hesaplanır ve saklanmaz (K-470).
 *
 * Örnek ders gözlemi: aday kurum üyesi olmadığı için ders gözlem kaydı (DOM-FIN-130) açılamaz;
 * örnek ders mülakatı ders gözlem formunun sürümünü kullanır, 0–5 seviyeler ve puan gözlemle aynı
 * kuralladır (`lessonObservationScore`, rubrik kuralı). "Teklif"e ya da "işe alındı"ya geçiş en az
 * bir yapılmış mülakat ister; başvuru anonimleştirilince mülakat notları ve yer/bağlantı silinir,
 * planlı mülakat iptal olur (K-471). Fonksiyonlar saftır; an ve gün parametreyle gelir.
 */

/** Şablon, planlama, durum ve başvurudaki mülakat özeti: yalnız yönetici (K-469). */
export const CANDIDATE_INTERVIEW_MANAGE_ROLES = ['yonetici'] as const satisfies readonly Role[]
/** Değerlendirici olabilen ve kendi formunu gönderen roller (K-470). */
export const CANDIDATE_INTERVIEW_EVALUATOR_ROLES = [
  'yonetici',
  'ogretmen',
] as const satisfies readonly Role[]

export const CANDIDATE_INTERVIEW_TYPES = [
  'pre_screen',
  'in_person',
  'online',
  'sample_lesson',
] as const
export type CandidateInterviewType = (typeof CANDIDATE_INTERVIEW_TYPES)[number]
export const CANDIDATE_INTERVIEW_TYPE_LABELS = {
  pre_screen: 'Ön görüşme',
  in_person: 'Yüz yüze',
  online: 'Çevrim içi',
  sample_lesson: 'Örnek ders',
} as const satisfies Record<CandidateInterviewType, string>

export const CANDIDATE_INTERVIEW_STATUSES = ['planned', 'completed', 'cancelled'] as const
export type CandidateInterviewStatus = (typeof CANDIDATE_INTERVIEW_STATUSES)[number]
export const CANDIDATE_INTERVIEW_STATUS_LABELS = {
  planned: 'Planlandı',
  completed: 'Yapıldı',
  cancelled: 'İptal',
} as const satisfies Record<CandidateInterviewStatus, string>

/** Formun kaynağı: mülakat formu şablonu ya da (örnek derste) ders gözlem formu (K-471). */
export type CandidateInterviewFormKind = 'interview' | 'observation'
export const interviewFormKind = (type: CandidateInterviewType): CandidateInterviewFormKind =>
  type === 'sample_lesson' ? 'observation' : 'interview'

export const INTERVIEW_TEMPLATE_NAME_MIN = 2
export const INTERVIEW_TEMPLATE_NAME_MAX = 120
export const INTERVIEW_CRITERIA_MAX = 10
export const INTERVIEW_CRITERION_TITLE_MAX = 120
export const INTERVIEW_CRITERION_DESCRIPTION_MAX = 500
export const INTERVIEW_SCALE_MIN = 3
export const INTERVIEW_SCALE_MAX = 10
export const INTERVIEW_SCALE_DEFAULT = 5
export const INTERVIEW_WEIGHT_MIN = 1
export const INTERVIEW_WEIGHT_MAX = 10
export const INTERVIEW_EVALUATORS_MAX = 5
export const INTERVIEW_LOCATION_MAX = 200
export const INTERVIEW_URL_MAX = 500
export const INTERVIEW_RATING_NOTE_MAX = 1000
export const INTERVIEW_GENERAL_NOTE_MIN = 2
export const INTERVIEW_GENERAL_NOTE_MAX = 4000

/** Formun önerdiği başlangıç ölçütleri; yönetici değiştirir, ekler ya da çıkarır. */
export const DEFAULT_INTERVIEW_CRITERIA = [
  { title: 'Alan bilgisi', description: 'Branş bilgisi ve güncelliği.' },
  { title: 'İletişim', description: 'Kendini açık ifade etme, dinleme.' },
  { title: 'Sınıf yönetimi yaklaşımı', description: 'Örnek durumlara yanıtı.' },
  { title: 'Kuruma uyum', description: 'Kurumun değerleri ve ekiple çalışma.' },
] as const

// --- Şemalar -------------------------------------------------------------------------------------

const optionalText = (label: string, max: number) =>
  z
    .string(`${label} geçersiz.`)
    .trim()
    .max(max, `${label} en fazla ${max.toLocaleString('tr-TR')} karakter olabilir.`)
    .transform((value) => (value === '' ? null : value))
    .nullable()

const templateNameSchema = z
  .string('Form adını yazın.')
  .trim()
  .min(INTERVIEW_TEMPLATE_NAME_MIN, 'Form adını en az 2 karakterle yazın.')
  .max(
    INTERVIEW_TEMPLATE_NAME_MAX,
    `Form adı en fazla ${String(INTERVIEW_TEMPLATE_NAME_MAX)} karakter olabilir.`,
  )
  .describe('Mülakat formunun adı (ör. "Öğretmen mülakat formu")')

const scaleSchema = z
  .number('Ölçeği girin.')
  .int('Ölçek tam sayı olmalı.')
  .min(INTERVIEW_SCALE_MIN, `Ölçek en az ${String(INTERVIEW_SCALE_MIN)} olmalı.`)
  .max(INTERVIEW_SCALE_MAX, `Ölçek en fazla ${String(INTERVIEW_SCALE_MAX)} olabilir.`)
  .describe('Puan ölçeğinin üst ucu (3–10); puanlar 1 ile bu değer arasında verilir')

const criterionSchema = z.strictObject({
  title: z
    .string('Ölçüt adını yazın.')
    .trim()
    .min(2, 'Ölçüt adını en az 2 karakterle yazın.')
    .max(
      INTERVIEW_CRITERION_TITLE_MAX,
      `Ölçüt adı en fazla ${String(INTERVIEW_CRITERION_TITLE_MAX)} karakter olabilir.`,
    )
    .describe('Ölçüt (ör. "Alan bilgisi")'),
  description: optionalText('Ölçüt açıklaması', INTERVIEW_CRITERION_DESCRIPTION_MAX)
    .default(null)
    .describe('Ölçütün kısa açıklaması; boş olabilir'),
  weight: z
    .number('Ağırlığı girin.')
    .int('Ağırlık tam sayı olmalı.')
    .min(INTERVIEW_WEIGHT_MIN, 'Ağırlık en az 1 olmalı.')
    .max(INTERVIEW_WEIGHT_MAX, 'Ağırlık en fazla 10 olabilir.')
    .default(1)
    .describe('Göreli ağırlık (1–10)'),
})

const criteriaSchema = z
  .array(criterionSchema, 'Ölçütleri girin.')
  .min(1, 'En az bir ölçüt girin.')
  .max(INTERVIEW_CRITERIA_MAX, `En çok ${String(INTERVIEW_CRITERIA_MAX)} ölçüt girilebilir.`)
  .superRefine((criteria, ctx) => {
    const titles = criteria.map((c) => c.title.toLocaleLowerCase('tr'))
    if (new Set(titles).size !== titles.length)
      ctx.addIssue({ code: 'custom', message: 'Her ölçüt adı bir kez kullanılır.' })
  })
  .describe('Ölçütler, sırasıyla (1–10)')

/** Yeni mülakat formu ve yeni sürüm gövdesi: ad, ölçek ve ölçütlerin tamamı (K-470). */
export const interviewTemplateInputSchema = z.strictObject({
  name: templateNameSchema,
  scaleMax: scaleSchema.default(INTERVIEW_SCALE_DEFAULT),
  criteria: criteriaSchema,
})
export type InterviewTemplateInput = z.input<typeof interviewTemplateInputSchema>

/** Kullanılmamış sürümün düzeltmesi: yalnız gönderilen alanlar (K-470). */
export const interviewTemplateUpdateSchema = z
  .strictObject({
    name: templateNameSchema.optional(),
    scaleMax: scaleSchema.optional(),
    criteria: criteriaSchema.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Değiştirilecek bir alan girin.',
  })

/** Gövdesiz komutlar (arşiv, yapıldı, iptal) boş nesne alır. */
export const candidateInterviewEmptySchema = z.strictObject({})

const scheduledAtSchema = z.iso
  .datetime({ offset: true, error: 'Geçerli bir gün ve saat girin.' })
  .describe('Mülakat anı (ISO 8601); gösterim Europe/Istanbul')

const locationSchema = optionalText('Yer', INTERVIEW_LOCATION_MAX).describe(
  'Yer (ör. "Müdür odası", "5-A sınıfı"); yüz yüze ve örnek derste zorunlu',
)

const meetingUrlSchema = z
  .string('Bağlantı geçersiz.')
  .trim()
  .max(INTERVIEW_URL_MAX, `Bağlantı en fazla ${String(INTERVIEW_URL_MAX)} karakter olabilir.`)
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .refine(
    (value) => value === null || /^https:\/\/[^\s]+$/.test(value),
    'Bağlantı https:// ile başlamalı.',
  )
  .describe('Görüşme bağlantısı (https://); çevrim içi mülakatta zorunlu')

const memberIdSchema = z
  .string('Değerlendiriciyi seçin.')
  .trim()
  .min(1, 'Değerlendiriciyi seçin.')
  .max(100, 'Değerlendirici geçersiz.')

/** Yer ya da bağlantı zorunluluğu (K-469): yüz yüze ve örnek ders yer, çevrim içi bağlantı ister. */
function placeIssue(
  type: CandidateInterviewType,
  place: { location: string | null; meetingUrl: string | null },
): { path: 'location' | 'meetingUrl'; message: string } | null {
  if ((type === 'in_person' || type === 'sample_lesson') && place.location === null)
    return { path: 'location', message: 'Mülakatın yapılacağı yeri yazın.' }
  if (type === 'online' && place.meetingUrl === null)
    return { path: 'meetingUrl', message: 'Çevrim içi mülakatın bağlantısını yazın.' }
  return null
}

export const candidateInterviewCreateSchema = z
  .strictObject({
    type: z
      .enum(CANDIDATE_INTERVIEW_TYPES, 'Mülakat türünü seçin.')
      .describe(
        '`pre_screen` ön görüşme, `in_person` yüz yüze, `online` çevrim içi, `sample_lesson` örnek ders',
      ),
    scheduledAt: scheduledAtSchema,
    location: locationSchema.default(null),
    meetingUrl: meetingUrlSchema.default(null),
    templateId: z
      .uuid('Formu seçin.')
      .describe(
        'Mülakat formu (`/finance/interview-templates`); örnek derste ders gözlem formu (`/finance/lesson-observation-templates`). Son sürüm kullanılır',
      ),
    // kvkk: K (değerlendirici üyelikleri)
    evaluatorMembershipIds: z
      .array(memberIdSchema, 'Değerlendiricileri seçin.')
      .min(1, 'En az bir değerlendirici seçin.')
      .max(
        INTERVIEW_EVALUATORS_MAX,
        `En çok ${String(INTERVIEW_EVALUATORS_MAX)} değerlendirici seçilebilir.`,
      )
      .refine((ids) => new Set(ids).size === ids.length, 'Aynı değerlendirici iki kez seçilmiş.')
      .describe('Değerlendiriciler: kurumun etkin yönetici ya da öğretmen üyelikleri (1–5)'),
  })
  .superRefine((value, ctx) => {
    const issue = placeIssue(value.type, value)
    if (issue !== null) ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.message })
  })
export type CandidateInterviewCreateInput = z.input<typeof candidateInterviewCreateSchema>
export type CandidateInterviewCreateFields = z.output<typeof candidateInterviewCreateSchema>

/** Planlı mülakatın düzeltmesi: gün ve saat, yer, bağlantı; en az bir alan (K-469). */
export const candidateInterviewUpdateSchema = z
  .strictObject({
    scheduledAt: scheduledAtSchema.optional(),
    location: locationSchema.optional(),
    meetingUrl: meetingUrlSchema.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Değiştirilecek bir alan girin.',
  })
export type CandidateInterviewUpdateFields = z.output<typeof candidateInterviewUpdateSchema>

const ratingSchema = z.strictObject({
  criterionId: z
    .string('Ölçüt geçersiz.')
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,40}$/, 'Ölçüt geçersiz.'),
  score: z
    .number('Puanı girin.')
    .int('Puan tam sayı olmalı.')
    .min(0, 'Puan ölçeğin dışında.')
    .max(INTERVIEW_SCALE_MAX, 'Puan ölçeğin dışında.')
    .describe('Mülakat formunda 1–ölçek; örnek derste 0–5 seviye'),
  // kvkk: K (serbest metin; denetime yazılmaz)
  note: optionalText('Ölçüt notu', INTERVIEW_RATING_NOTE_MAX)
    .default(null)
    .describe('Ölçüt notu; örnek derste hedefin altındaki (0–2) seviyede zorunlu'),
})

/** Değerlendiricinin formu: her ölçüte bir puan ve genel değerlendirme (K-470). */
export const candidateEvaluationInputSchema = z.strictObject({
  ratings: z
    .array(ratingSchema, 'Puanları girin.')
    .min(1, 'Puanları girin.')
    .max(INTERVIEW_CRITERIA_MAX, 'Puanlar geçersiz.')
    .describe('Ölçüt başına puan ve not; formdaki her ölçüt bir kez'),
  // kvkk: K (serbest metin; denetime yazılmaz)
  generalNote: z
    .string('Genel değerlendirmeyi yazın.')
    .trim()
    .min(INTERVIEW_GENERAL_NOTE_MIN, 'Genel değerlendirmeyi en az 2 karakterle yazın.')
    .max(
      INTERVIEW_GENERAL_NOTE_MAX,
      `Genel değerlendirme en fazla ${INTERVIEW_GENERAL_NOTE_MAX.toLocaleString('tr-TR')} karakter olabilir.`,
    )
    .describe('Değerlendiricinin genel görüşü (2–4000)'),
})
export type CandidateEvaluationInput = z.input<typeof candidateEvaluationInputSchema>
export type CandidateEvaluationFields = z.output<typeof candidateEvaluationInputSchema>

// --- Tipler --------------------------------------------------------------------------------------

export interface InterviewCriterion {
  id: string
  title: string
  description: string | null
  weight: number
}

/** Değerlendirmenin formu: mülakat formu ölçütleri ve ölçeği ya da gözlem formu ölçütleri. */
export type CandidateInterviewForm =
  | { kind: 'interview'; scaleMax: number; criteria: readonly InterviewCriterion[] }
  | { kind: 'observation'; criteria: readonly ObservationCriterion[] }

export interface CandidateRating {
  criterionId: string
  score: number
  note: string | null
}

export type CandidateScore = ObservationScore

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path?: string[]) =>
  new DomainError(code, message, { kind: 'rule', ...(path === undefined ? {} : { path }) })
const conflict = (code: string, message: string) =>
  new DomainError(code, message, { kind: 'conflict' })

const withIds = (criteria: z.output<typeof criteriaSchema>): InterviewCriterion[] =>
  criteria.map((criterion, index) => ({ id: `k${String(index + 1)}`, ...criterion }))

/** Yeni mülakat formu ya da yeni sürüm içeriği (K-470); ölçüt kimliğini sunucu verir. */
export function planInterviewTemplate(input: unknown): {
  name: string
  scaleMax: number
  criteria: InterviewCriterion[]
} {
  const parsed = interviewTemplateInputSchema.parse(input)
  return { name: parsed.name, scaleMax: parsed.scaleMax, criteria: withIds(parsed.criteria) }
}

const templateArchived = () =>
  conflict('interview_template_archived', 'Mülakat formu arşivlendi; değiştirilemez.')

/** Son sürümün yerinde düzeltmesi (K-470): arşivli form ve mülakatta kullanılmış sürüm 409. */
export function planInterviewTemplateUpdate(
  template: { archived: boolean; used: boolean },
  input: unknown,
): { name?: string; scaleMax?: number; criteria?: InterviewCriterion[] } {
  const parsed = interviewTemplateUpdateSchema.parse(input)
  if (template.archived) throw templateArchived()
  if (template.used)
    throw conflict(
      'interview_template_used',
      'Bu form mülakatta kullanıldı; değiştirilemez. Yeni sürüm açın.',
    )
  return {
    ...(parsed.name === undefined ? {} : { name: parsed.name }),
    ...(parsed.scaleMax === undefined ? {} : { scaleMax: parsed.scaleMax }),
    ...(parsed.criteria === undefined ? {} : { criteria: withIds(parsed.criteria) }),
  }
}

/** Yeni sürüm (K-470): arşivli forma açılmaz; önceki sürümler ve değerlendirmeleri değişmez. */
export function planInterviewTemplateVersion(template: { archived: boolean }, input: unknown) {
  const plan = planInterviewTemplate(input)
  if (template.archived) throw templateArchived()
  return plan
}

/** Arşiv (K-470): yeni mülakatta seçilmez; eski mülakatlar sürümüyle okunur. */
export function planInterviewTemplateArchive(template: { archived: boolean }): void {
  if (template.archived) throw templateArchived()
}

/** Üyelik gerçeği: kurumda yoksa `null`; `active` pasifleştirilmemiş demektir. */
export interface InterviewMember {
  membershipId: string
  role: string
  active: boolean
}

/** Başvurunun mülakat için gereken alanları. */
export interface InterviewApplicationState {
  stage: JobApplicationStage
  anonymizedAt: string | null
}

const assertNotAnonymized = (application: Pick<InterviewApplicationState, 'anonymizedAt'>) => {
  if (application.anonymizedAt !== null)
    throw ruleError(
      'candidate_interview_application_anonymized',
      'Anonimleştirilmiş başvurunun mülakatı değiştirilemez.',
    )
}

export interface CandidateInterviewChecks {
  application: InterviewApplicationState
  /** Seçilen formun son sürümü; form kurumda yoksa `null`. */
  template: { archived: boolean } | null
  /** `evaluatorMembershipIds` sırasıyla üyelik gerçekleri. */
  evaluators: readonly (InterviewMember | null)[]
}

/**
 * Mülakat planı (K-469): başvuru anonimleştirilmemiş ve "mülakat" aşamasında olmalı; form kurumun
 * arşivlenmemiş formudur (örnek derste ders gözlem formu); değerlendiriciler kurumun etkin
 * yönetici ya da öğretmen üyelikleridir. Gün ve saat geçmişte olabilir (yapılmış mülakatın sonradan
 * girilmesi). Yer ve bağlantı zorunluluğu şemada (400).
 */
export function assertCandidateInterviewPlan(checks: CandidateInterviewChecks): void {
  assertNotAnonymized(checks.application)
  if (checks.application.stage !== 'interview')
    throw ruleError(
      'candidate_interview_stage',
      'Mülakat yalnız "Mülakat" aşamasındaki başvuruya planlanır; önce aşamayı değiştirin.',
    )
  if (checks.template === null)
    throw ruleError('candidate_interview_template_not_found', 'Form bulunamadı.', ['templateId'])
  if (checks.template.archived)
    throw ruleError(
      'candidate_interview_template_archived',
      'Arşivlenmiş form yeni mülakatta kullanılamaz.',
      ['templateId'],
    )
  checks.evaluators.forEach((member, index) => {
    const path = ['evaluatorMembershipIds', String(index)]
    if (member === null)
      throw ruleError('candidate_interview_evaluator_not_found', 'Değerlendirici bulunamadı.', path)
    if (
      !(CANDIDATE_INTERVIEW_EVALUATOR_ROLES as readonly string[]).includes(member.role) ||
      !member.active
    )
      throw ruleError(
        'candidate_interview_evaluator_invalid',
        'Değerlendirici kurumun etkin yöneticisi ya da öğretmeni olmalı.',
        path,
      )
  })
}

export interface StoredInterviewState {
  type: CandidateInterviewType
  status: CandidateInterviewStatus
  scheduledAt: string
  location: string | null
  meetingUrl: string | null
}

const assertPlanned = (interview: Pick<StoredInterviewState, 'status'>) => {
  if (interview.status !== 'planned')
    throw ruleError(
      'candidate_interview_not_planned',
      `"${CANDIDATE_INTERVIEW_STATUS_LABELS[interview.status]}" durumundaki mülakat değiştirilemez.`,
    )
}

/**
 * Planlı mülakatın düzeltmesi (K-469): yalnız planlı mülakat; yer ya da bağlantı türün
 * zorunluluğunu kaybetmez; değişiklik yoksa 422. Sonraki değerler ve değişen alan adları döner.
 */
export function planCandidateInterviewUpdate(
  interview: StoredInterviewState,
  application: Pick<InterviewApplicationState, 'anonymizedAt'>,
  input: CandidateInterviewUpdateFields,
): {
  next: Pick<StoredInterviewState, 'scheduledAt' | 'location' | 'meetingUrl'>
  changed: string[]
} {
  assertNotAnonymized(application)
  assertPlanned(interview)
  const next = {
    scheduledAt:
      input.scheduledAt === undefined
        ? interview.scheduledAt
        : new Date(input.scheduledAt).toISOString(),
    location: input.location === undefined ? interview.location : input.location,
    meetingUrl: input.meetingUrl === undefined ? interview.meetingUrl : input.meetingUrl,
  }
  const changed = (['scheduledAt', 'location', 'meetingUrl'] as const).filter(
    (field) => next[field] !== interview[field],
  )
  if (changed.length === 0)
    throw ruleError('candidate_interview_unchanged', 'Mülakatta değişiklik yok.')
  const issue = placeIssue(interview.type, next)
  if (issue !== null)
    throw ruleError(
      issue.path === 'location'
        ? 'candidate_interview_location_required'
        : 'candidate_interview_link_required',
      issue.message,
      [issue.path],
    )
  return { next, changed: [...changed] }
}

/** "Yapıldı" (K-469): yalnız planlı mülakat ve mülakat anı geldiyse. */
export function planCandidateInterviewComplete(
  interview: Pick<StoredInterviewState, 'status' | 'scheduledAt'>,
  application: Pick<InterviewApplicationState, 'anonymizedAt'>,
  now: Date,
): void {
  assertNotAnonymized(application)
  assertPlanned(interview)
  if (new Date(interview.scheduledAt).getTime() > now.getTime())
    throw ruleError(
      'candidate_interview_not_started',
      'Mülakat saati gelmeden "yapıldı" işaretlenemez.',
    )
}

/** İptal (K-469): yalnız planlı mülakat; değerlendirmeler açılmaz. */
export function planCandidateInterviewCancel(
  interview: Pick<StoredInterviewState, 'status'>,
): void {
  assertPlanned(interview)
}

/** Formdaki ölçütlerin puan aralığı: mülakat formunda 1–ölçek, gözlem formunda 0–5. */
export function scoreRange(form: CandidateInterviewForm): { min: number; max: number } {
  return form.kind === 'interview' ? { min: 1, max: form.scaleMax } : { min: 0, max: 5 }
}

/**
 * Değerlendirme puanı (K-470, K-471). Mülakat formunda ağırlıklı puan toplamı, azami toplam
 * (`ölçek × Σ ağırlık`) ve 100'lük puan (yarım yukarı yuvarlanır, rubrik yuvarlamasıyla aynı);
 * örnek derste ders gözlemiyle aynı kural (`lessonObservationScore`, DOM-BEC-021). Puanı eksik
 * ölçüt varsa `null`. Saklanmaz; her okumada form sürümünden ve puanlardan hesaplanır.
 */
export function candidateEvaluationScore(
  form: CandidateInterviewForm,
  ratings: readonly CandidateRating[],
): CandidateScore | null {
  if (form.kind === 'observation')
    return lessonObservationScore(
      form.criteria,
      ratings.map((rating) => ({
        criterionId: rating.criterionId,
        level: rating.score,
        note: rating.note,
      })),
    )
  const scores = new Map(ratings.map((rating) => [rating.criterionId, rating.score]))
  let total = 0
  let max = 0
  for (const criterion of form.criteria) {
    const score = scores.get(criterion.id)
    if (score === undefined) return null
    total += score * criterion.weight
    max += form.scaleMax * criterion.weight
  }
  if (max === 0) return null
  return { total, max, percent: Math.floor((200 * total + max) / (2 * max)) }
}

export interface EvaluationChecks {
  interview: Pick<StoredInterviewState, 'status'>
  application: Pick<InterviewApplicationState, 'anonymizedAt'>
  /** İsteği yapanın değerlendirme satırı; değerlendirici değilse `null`. */
  evaluation: { submittedAt: string | null } | null
  form: CandidateInterviewForm
}

/**
 * Değerlendirme gönderimi (K-470): isteği yapan mülakatın değerlendiricisi olmalı, mülakat
 * yapılmış ve başvuru anonimleştirilmemiş olmalı; gönderilmiş değerlendirme değişmez (409). Formdaki
 * her ölçüte bir kez, aralıkta puan verilir; örnek derste hedefin altındaki (0–2) seviyeye not
 * zorunludur (gözlem kuralı). Puanlar formun ölçüt sırasıyla ve sunucunun hesapladığı puan döner.
 */
export function planCandidateEvaluation(
  checks: EvaluationChecks,
  input: CandidateEvaluationFields,
): { ratings: CandidateRating[]; score: CandidateScore } {
  if (checks.evaluation === null)
    throw ruleError(
      'candidate_interview_not_evaluator',
      'Bu mülakatın değerlendiricisi değilsiniz; formu yalnız değerlendirici gönderir.',
    )
  assertNotAnonymized(checks.application)
  if (checks.evaluation.submittedAt !== null)
    throw conflict(
      'candidate_evaluation_submitted',
      'Değerlendirmenizi gönderdiniz; artık değiştirilemez.',
    )
  if (checks.interview.status !== 'completed')
    throw ruleError(
      'candidate_interview_not_completed',
      'Değerlendirme mülakat "yapıldı" işaretlendikten sonra gönderilir.',
    )
  const { form } = checks
  const known = new Map(form.criteria.map((criterion) => [criterion.id, criterion]))
  const given = new Map<string, CandidateRating>()
  const range = scoreRange(form)
  input.ratings.forEach((rating, index) => {
    const path = ['ratings', String(index)]
    if (!known.has(rating.criterionId) || given.has(rating.criterionId))
      throw ruleError(
        'candidate_evaluation_criterion_invalid',
        'Ölçüt bu formda yok ya da tekrar ediyor.',
        [...path, 'criterionId'],
      )
    if (rating.score < range.min || rating.score > range.max)
      throw ruleError(
        'candidate_evaluation_score_range',
        `Puan ${String(range.min)}–${String(range.max)} arasında olmalı.`,
        [...path, 'score'],
      )
    given.set(rating.criterionId, rating)
  })
  const missing = form.criteria.filter((criterion) => !given.has(criterion.id)).length
  if (missing > 0)
    throw ruleError(
      'candidate_evaluation_unrated',
      `Puanı verilmemiş ${String(missing)} ölçüt var; her ölçüte puan verin.`,
      ['ratings'],
    )
  const ratings = form.criteria.map((criterion) => {
    const rating = given.get(criterion.id)
    if (rating === undefined) throw new Error('rating was checked above')
    return { criterionId: criterion.id, score: rating.score, note: rating.note }
  })
  if (form.kind === 'observation')
    form.criteria.forEach((criterion, index) => {
      const rating = ratings[index]
      if (
        rating !== undefined &&
        observationLevelMeaning(rating.score) === 'below' &&
        rating.note === null
      )
        throw ruleError(
          'candidate_evaluation_note_required',
          `"${criterion.title}" ölçütüne hedefin altında seviye verildi; kısa not yazın.`,
          ['ratings', String(index), 'note'],
        )
    })
  const score = candidateEvaluationScore(form, ratings)
  if (score === null)
    throw ruleError('candidate_evaluation_unrated', 'Her ölçüte puan verin.', ['ratings'])
  return { ratings, score }
}

/** 100'lük puanların ortalaması (yarım yukarı); boşsa `null`. */
export function averagePercent(percents: readonly number[]): number | null {
  if (percents.length === 0) return null
  const sum = percents.reduce((total, value) => total + value, 0)
  return Math.floor((2 * sum + percents.length) / (2 * percents.length))
}

export interface InterviewSummaryInput {
  type: CandidateInterviewType
  status: CandidateInterviewStatus
  /** Gönderilmiş değerlendirmelerin 100'lük puanları. */
  submittedPercents: readonly number[]
}

export interface CandidateInterviewSummary {
  plannedCount: number
  completedCount: number
  cancelledCount: number
  /** Gönderilmiş değerlendirme sayısı (bütün mülakatlarda). */
  submittedCount: number
  /** Mülakat formlu (örnek ders dışı) yapılmış mülakatların değerlendirici ortalamalarının ortalaması. */
  interviewAveragePercent: number | null
  /** Örnek derslerin değerlendirici ortalamalarının ortalaması (gözlem puanı). */
  sampleLessonAveragePercent: number | null
}

/**
 * Başvurudaki mülakat özeti (K-469): durum sayıları ve değerlendirici ortalamaları. Her yapılmış
 * mülakatın ortalaması gönderilmiş değerlendirmelerinden alınır; örnek ders gözlem puanı ayrı
 * ortalanır (ölçekler farklı). İptal edilen mülakat ortalamaya girmez.
 */
export function candidateInterviewSummary(
  interviews: readonly InterviewSummaryInput[],
): CandidateInterviewSummary {
  const averages = (sampleLesson: boolean) =>
    interviews
      .filter(
        (interview) =>
          interview.status === 'completed' && (interview.type === 'sample_lesson') === sampleLesson,
      )
      .map((interview) => averagePercent(interview.submittedPercents))
      .filter((value): value is number => value !== null)
  const count = (status: CandidateInterviewStatus) =>
    interviews.filter((interview) => interview.status === status).length
  return {
    plannedCount: count('planned'),
    completedCount: count('completed'),
    cancelledCount: count('cancelled'),
    submittedCount: interviews
      .filter((interview) => interview.status === 'completed')
      .reduce((sum, interview) => sum + interview.submittedPercents.length, 0),
    interviewAveragePercent: averagePercent(averages(false)),
    sampleLessonAveragePercent: averagePercent(averages(true)),
  }
}

/**
 * Teklif kapısı (K-469): başvuru "teklif"e ya da (teklifi atlayarak) "işe alındı"ya en az bir
 * yapılmış mülakatla geçer. Ret ve diğer aşamalar serbesttir.
 */
export function assertInterviewBeforeOffer(
  target: JobApplicationStage,
  completedInterviewCount: number,
): void {
  if ((target === 'offer' || target === 'hired') && completedInterviewCount === 0)
    throw ruleError(
      'job_application_interview_required',
      'Teklife geçmek için en az bir yapılmış mülakat gerekir; önce mülakatı "yapıldı" işaretleyin.',
      ['stage'],
    )
}
