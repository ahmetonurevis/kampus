import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import {
  BAND_MEANINGS,
  BAND_SCALE,
  HOLISTIC_ASPECT,
  WEIGHT_LIMITS,
  bandMeaning,
  rubricScore,
  type BandMeaning,
} from '../skills/rubric.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import type { PerformancePeriodStatus } from './finance-performance.ts'

/**
 * Ders gözlem formu (docs/domain/finans.md DOM-FIN-130; ON-206). Yönetici kurumun gözlem formu
 * şablonlarını yazar: ad ve ölçütler (sınıf yönetimi, ders planı, öğrenci katılımı…; her ölçütte
 * 0–5 seviye tanımı ve ağırlık). Şablon sürümlüdür: gözlemde kullanılmış sürüm değişmez, yeni
 * sürüm açılır (K-445). Gözlem kaydı öğretmeni (üyelik), gözlemciyi (üyelik), günü, isteğe bağlı
 * sınıf, ders ve performans dönemini, ölçüt başına seviye ve notu taşır; taslak → tamamlandı,
 * tamamlanan kayıt değişmez (K-446). Puan rubrik motorunun kuralıyla (`rubricScore`,
 * DOM-BEC-021) her okumada ölçüt seviyelerinden hesaplanır, saklanmaz ve istemciden alınmaz.
 * Gözlem kişisel veridir: yönetici, gözlemci ve (tamamlanınca) gözlenen öğretmen görür (K-447).
 * Fonksiyonlar saftır; bugün `today` (Europe/Istanbul günü) ile gelir.
 */

/** Şablon ve gözlem yazımı yalnız yönetici (K-447; bu turda öğretmen ekranı yok). */
export const LESSON_OBSERVATION_MANAGE_ROLES = ['yonetici'] as const satisfies readonly Role[]
/** Gözlem okuması: yönetici hepsini, öğretmen yalnız gözlemcisi ya da gözleneni olduğu kaydı (K-447). */
export const LESSON_OBSERVATION_READ_ROLES = [
  'yonetici',
  'ogretmen',
] as const satisfies readonly Role[]
/** Gözlemci olabilecek roller: yönetici ya da öğretmen (zümre başkanı, mentor; K-446). */
export const LESSON_OBSERVER_ROLES = ['yonetici', 'ogretmen'] as const satisfies readonly Role[]

export const LESSON_OBSERVATION_STATUSES = ['draft', 'completed'] as const
export type LessonObservationStatus = (typeof LESSON_OBSERVATION_STATUSES)[number]
export const LESSON_OBSERVATION_STATUS_LABELS = {
  draft: 'Taslak',
  completed: 'Tamamlandı',
} as const satisfies Record<LessonObservationStatus, string>

export const OBSERVATION_NAME_MIN = 2
export const OBSERVATION_NAME_MAX = 120
export const OBSERVATION_CRITERIA_MAX = 10
export const OBSERVATION_CRITERION_TITLE_MIN = 2
export const OBSERVATION_CRITERION_TITLE_MAX = 120
export const OBSERVATION_CRITERION_DESCRIPTION_MAX = 500
export const OBSERVATION_LEVEL_DESCRIPTION_MIN = 2
export const OBSERVATION_LEVEL_DESCRIPTION_MAX = 300
export const OBSERVATION_RATING_NOTE_MAX = 1000
export const OBSERVATION_GENERAL_NOTE_MAX = 4000

/**
 * Seviye ölçeği rubrik bant ölçeğidir (DOM-BEC-020): 0–5, 3 hedef seviyede, 0–2 hedefin altında,
 * 4–5 hedefin üstünde. Ağırlık rubrik ağırlığıdır (1–10, göreli tamsayı).
 */
export const OBSERVATION_LEVELS = Array.from(
  { length: BAND_SCALE.max - BAND_SCALE.min + 1 },
  (_, index) => BAND_SCALE.min + index,
)
export const OBSERVATION_WEIGHT_LIMITS = WEIGHT_LIMITS
export const OBSERVATION_LEVEL_LABELS: Readonly<Record<number, string>> = {
  0: 'Yetersiz',
  1: 'Başlangıç',
  2: 'Gelişiyor',
  3: 'Yeterli',
  4: 'İyi',
  5: 'Örnek uygulama',
}
export const observationLevelMeaning = (level: number): BandMeaning => bandMeaning(level)
export const OBSERVATION_LEVEL_MEANINGS = BAND_MEANINGS

/** Formun önerdiği başlangıç ölçütleri; yönetici değiştirir, ekler ya da çıkarır. */
export const DEFAULT_OBSERVATION_CRITERIA = [
  {
    title: 'Ders planı ve hazırlık',
    description: 'Kazanım, akış ve materyal derse uygun hazırlanmış mı.',
  },
  {
    title: 'Sınıf yönetimi',
    description: 'Kurallar, zaman kullanımı ve geçişler düzenli mi.',
  },
  {
    title: 'Öğrenci katılımı',
    description: 'Öğrencilerin çoğu derse etkin katılıyor mu.',
  },
  {
    title: 'Öğretim yöntemi ve materyal',
    description: 'Yöntem ve materyal kazanıma ve sınıfa uygun mu.',
  },
  {
    title: 'Ölçme ve geri bildirim',
    description: 'Öğrenme ders içinde yoklanıyor, geri bildirim veriliyor mu.',
  },
] as const

/** Seviye tanımı önerisi: ölçüt adından bağımsız genel cümleler; yönetici ölçüte göre yazar. */
export const DEFAULT_OBSERVATION_LEVEL_DESCRIPTIONS: Readonly<Record<number, string>> = {
  0: 'Gözlenmedi ya da belirgin biçimde yetersiz.',
  1: 'Yer yer var; önemli eksikler sürüyor.',
  2: 'Gelişiyor; hedef seviyeye yaklaşıyor.',
  3: 'Hedef seviyede; beklenen uygulama tutarlı.',
  4: 'Hedefin üstünde; güçlü ve tutarlı.',
  5: 'Örnek uygulama; diğer öğretmenlerle paylaşılabilir.',
}

// --- Şemalar -------------------------------------------------------------------------------------

const optionalText = (label: string, max: number) =>
  z
    .string(`${label} geçersiz.`)
    .trim()
    .max(max, `${label} en fazla ${max.toLocaleString('tr-TR')} karakter olabilir.`)
    .transform((value) => (value === '' ? null : value))
    .nullable()

const nameSchema = z
  .string('Form adını yazın.')
  .trim()
  .min(OBSERVATION_NAME_MIN, 'Form adını en az 2 karakterle yazın.')
  .max(OBSERVATION_NAME_MAX, `Form adı en fazla ${String(OBSERVATION_NAME_MAX)} karakter olabilir.`)
  .describe('Gözlem formunun adı (ör. "Ders gözlem formu")')

const levelSchema = z.strictObject({
  level: z
    .number('Seviye geçersiz.')
    .int('Seviye tam sayı olmalı.')
    .min(BAND_SCALE.min, 'Seviye 0–5 arasında olmalı.')
    .max(BAND_SCALE.max, 'Seviye 0–5 arasında olmalı.'),
  description: z
    .string('Seviye tanımını yazın.')
    .trim()
    .min(OBSERVATION_LEVEL_DESCRIPTION_MIN, 'Seviye tanımını en az 2 karakterle yazın.')
    .max(
      OBSERVATION_LEVEL_DESCRIPTION_MAX,
      `Seviye tanımı en fazla ${String(OBSERVATION_LEVEL_DESCRIPTION_MAX)} karakter olabilir.`,
    ),
})

const criterionSchema = z.strictObject({
  title: z
    .string('Ölçüt adını yazın.')
    .trim()
    .min(OBSERVATION_CRITERION_TITLE_MIN, 'Ölçüt adını en az 2 karakterle yazın.')
    .max(
      OBSERVATION_CRITERION_TITLE_MAX,
      `Ölçüt adı en fazla ${String(OBSERVATION_CRITERION_TITLE_MAX)} karakter olabilir.`,
    )
    .describe('Ölçüt (ör. "Sınıf yönetimi")'),
  description: optionalText('Ölçüt açıklaması', OBSERVATION_CRITERION_DESCRIPTION_MAX)
    .default(null)
    .describe('Ölçütün kısa açıklaması; boş olabilir'),
  weight: z
    .number('Ağırlığı girin.')
    .int('Ağırlık tam sayı olmalı.')
    .min(WEIGHT_LIMITS.min, 'Ağırlık en az 1 olmalı.')
    .max(WEIGHT_LIMITS.max, 'Ağırlık en fazla 10 olabilir.')
    .default(WEIGHT_LIMITS.default)
    .describe('Göreli ağırlık (1–10; rubrik ağırlığı)'),
  levels: z
    .array(levelSchema, 'Seviye tanımlarını girin.')
    .length(OBSERVATION_LEVELS.length, 'Her ölçüt için 0–5 arası altı seviyenin tanımını yazın.')
    .refine((levels) => new Set(levels.map((l) => l.level)).size === OBSERVATION_LEVELS.length, {
      message: 'Her seviye bir kez tanımlanır.',
    })
    .transform((levels) => [...levels].sort((a, b) => a.level - b.level))
    .describe('0–5 seviyelerinin tanımı (rubrik bantları)'),
})

const criteriaSchema = z
  .array(criterionSchema, 'Ölçütleri girin.')
  .min(1, 'En az bir ölçüt girin.')
  .max(OBSERVATION_CRITERIA_MAX, `En çok ${String(OBSERVATION_CRITERIA_MAX)} ölçüt girilebilir.`)
  .superRefine((criteria, ctx) => {
    const titles = criteria.map((c) => c.title.toLocaleLowerCase('tr'))
    if (new Set(titles).size !== titles.length)
      ctx.addIssue({ code: 'custom', message: 'Her ölçüt adı bir kez kullanılır.' })
  })
  .describe('Ölçütler, sırasıyla (1–10)')

/** Yeni şablon ve yeni sürüm gövdesi: ad ve ölçütlerin tamamı (K-445). */
export const lessonObservationTemplateInputSchema = z.strictObject({
  name: nameSchema,
  criteria: criteriaSchema,
})
export type LessonObservationTemplateInput = z.input<typeof lessonObservationTemplateInputSchema>

/** Kullanılmamış sürümün düzeltmesi: yalnız gönderilen alanlar (K-445). */
export const lessonObservationTemplateUpdateSchema = z
  .strictObject({
    name: nameSchema.optional(),
    criteria: criteriaSchema.optional(),
  })
  .refine((value) => value.name !== undefined || value.criteria !== undefined, {
    message: 'Değiştirilecek bir alan girin.',
  })

/** Gövdesiz komutlar (arşiv, tamamlama) boş nesne alır. */
export const lessonObservationEmptySchema = z.strictObject({})

const memberIdSchema = (message: string) =>
  z.string(message).trim().min(1, message).max(100, message)
const recordIdSchema = (label: string) =>
  z
    .string(`${label} geçersiz.`)
    .trim()
    .max(200, `${label} geçersiz.`)
    .transform((value) => (value === '' ? null : value))
    .nullable()

const ratingSchema = z.strictObject({
  criterionId: z
    .string('Ölçüt geçersiz.')
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,40}$/, 'Ölçüt geçersiz.'),
  level: z
    .number('Seviye geçersiz.')
    .int('Seviye tam sayı olmalı.')
    .min(BAND_SCALE.min, 'Seviye 0–5 arasında olmalı.')
    .max(BAND_SCALE.max, 'Seviye 0–5 arasında olmalı.')
    .nullable()
    .describe('Verilen seviye (0–5); boş = henüz verilmedi'),
  // kvkk: K (serbest metin; denetime yazılmaz)
  note: optionalText('Ölçüt notu', OBSERVATION_RATING_NOTE_MAX)
    .default(null)
    .describe('Ölçüt notu; hedefin altındaki (0–2) seviyede tamamlamak için zorunlu'),
})

export const lessonObservationCreateSchema = z.strictObject({
  templateId: z
    .uuid('Gözlem formunu seçin.')
    .describe('Gözlem formu şablonu; son sürümü kullanılır'),
  // kvkk: K (öğretmen üyeliği)
  teacherMembershipId: memberIdSchema('Öğretmeni seçin.').describe(
    'Gözlenen öğretmenin kurum üyeliği',
  ),
  // kvkk: K (gözlemci üyeliği)
  observerMembershipId: memberIdSchema('Gözlemciyi seçin.')
    .optional()
    .describe('Gözlemcinin kurum üyeliği (yönetici ya da öğretmen); boşsa isteği yapan'),
  observedDate: daySchema.describe('Gözlem günü; bugünden sonra olamaz'),
  classId: recordIdSchema('Sınıf').optional().describe('İsteğe bağlı sınıf (`classes` kaydı)'),
  subjectId: recordIdSchema('Ders').optional().describe('İsteğe bağlı ders (`subjects` kaydı)'),
  performancePeriodId: z
    .uuid('Performans dönemi geçersiz.')
    .nullable()
    .optional()
    .describe('İsteğe bağlı performans dönemi (DOM-FIN-124)'),
})
export type LessonObservationCreateInput = z.input<typeof lessonObservationCreateSchema>
export type LessonObservationCreateFields = z.output<typeof lessonObservationCreateSchema>

/** Taslak düzeltmesi: yalnız gönderilen alanlar; en az bir alan (K-446). */
export const lessonObservationUpdateSchema = z
  .strictObject({
    observedDate: daySchema.optional().describe('Gözlem günü; bugünden sonra olamaz'),
    classId: recordIdSchema('Sınıf').optional().describe('Sınıf; boş metin bağı kaldırır'),
    subjectId: recordIdSchema('Ders').optional().describe('Ders; boş metin bağı kaldırır'),
    performancePeriodId: z
      .uuid('Performans dönemi geçersiz.')
      .nullable()
      .optional()
      .describe('Performans dönemi; `null` bağı kaldırır'),
    ratings: z
      .array(ratingSchema, 'Seviyeler geçersiz.')
      .max(OBSERVATION_CRITERIA_MAX, 'Seviyeler geçersiz.')
      .optional()
      .describe('Ölçüt başına seviye ve not; gönderilen ölçütler yazılır, diğerleri korunur'),
    // kvkk: K (serbest metin; denetime yazılmaz)
    generalNote: optionalText('Genel değerlendirme', OBSERVATION_GENERAL_NOTE_MAX)
      .optional()
      .describe('Genel değerlendirme; tamamlamak için zorunlu, boş metin siler'),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Değiştirilecek bir alan girin.',
  })
export type LessonObservationUpdateInput = z.input<typeof lessonObservationUpdateSchema>
export type LessonObservationUpdateFields = z.output<typeof lessonObservationUpdateSchema>

// --- Tipler --------------------------------------------------------------------------------------

export interface ObservationCriterion {
  id: string
  title: string
  description: string | null
  weight: number
  levels: { level: number; description: string }[]
}

export interface ObservationRating {
  criterionId: string
  level: number | null
  note: string | null
}

export interface ObservationScore {
  /** Ağırlıklı seviye toplamı. */
  total: number
  /** Azami ağırlıklı toplam (`5 × Σ ağırlık`). */
  max: number
  /** 100'lük puan (rubrik yuvarlaması). */
  percent: number
}

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path?: string[]) =>
  new DomainError(code, message, { kind: 'rule', ...(path === undefined ? {} : { path }) })
const conflict = (code: string, message: string) =>
  new DomainError(code, message, { kind: 'conflict' })

/** Ölçüt kimliği sunucuda sırayla verilir; sürüm değişmediği için gözlemdeki bağ kalıcıdır. */
const withIds = (criteria: z.output<typeof criteriaSchema>): ObservationCriterion[] =>
  criteria.map((criterion, index) => ({ id: `k${String(index + 1)}`, ...criterion }))

/** Yeni şablon ya da yeni sürüm içeriği (K-445). */
export function planLessonObservationTemplate(input: unknown): {
  name: string
  criteria: ObservationCriterion[]
} {
  const parsed = lessonObservationTemplateInputSchema.parse(input)
  return { name: parsed.name, criteria: withIds(parsed.criteria) }
}

const archivedError = () =>
  conflict('observation_template_archived', 'Gözlem formu arşivlendi; değiştirilemez.')

/**
 * Son sürümün yerinde düzeltmesi (K-445): arşivli şablon ve gözlemde kullanılmış sürüm
 * değişmez (409); kullanılmış sürüm için yeni sürüm açılır.
 */
export function planLessonObservationTemplateUpdate(
  template: { archived: boolean; used: boolean },
  input: unknown,
): { name?: string; criteria?: ObservationCriterion[] } {
  const parsed = lessonObservationTemplateUpdateSchema.parse(input)
  if (template.archived) throw archivedError()
  if (template.used)
    throw conflict(
      'observation_template_used',
      'Bu form gözlemde kullanıldı; değiştirilemez. Yeni sürüm açın.',
    )
  return {
    ...(parsed.name === undefined ? {} : { name: parsed.name }),
    ...(parsed.criteria === undefined ? {} : { criteria: withIds(parsed.criteria) }),
  }
}

/** Yeni sürüm (K-445): arşivli şablona açılmaz; önceki sürümler ve gözlemleri değişmez. */
export function planLessonObservationTemplateVersion(
  template: { archived: boolean },
  input: unknown,
) {
  const plan = planLessonObservationTemplate(input)
  if (template.archived) throw archivedError()
  return plan
}

/** Arşiv (K-445): yeni gözlemde seçilmez; eski gözlemler sürümüyle okunur. */
export function planLessonObservationTemplateArchive(template: { archived: boolean }): void {
  if (template.archived) throw archivedError()
}

/** Üyelik gerçeği: kurumda yoksa `null`; `active` pasifleştirilmemiş demektir. */
export interface ObservationMember {
  membershipId: string
  role: string
  active: boolean
}

/** Bağlanan performans dönemi; `undefined` istenmedi, `null` bulunamadı. */
export type ObservationPeriodCheck =
  { status: PerformancePeriodStatus; startDate: string; endDate: string } | null | undefined

function assertPeriod(period: ObservationPeriodCheck, observedDate: string): void {
  if (period === undefined) return
  if (period === null)
    throw ruleError('observation_period_not_found', 'Performans dönemi bulunamadı.', [
      'performancePeriodId',
    ])
  if (period.status === 'closed')
    throw ruleError('observation_period_closed', 'Kapanmış performans dönemine gözlem bağlanmaz.', [
      'performancePeriodId',
    ])
  if (observedDate < period.startDate || observedDate > period.endDate)
    throw ruleError(
      'observation_date_outside_period',
      'Gözlem günü performans dönemi içinde olmalı.',
      ['observedDate'],
    )
}

function assertDay(observedDate: string, today: string): void {
  if (observedDate > today)
    throw ruleError('observation_date_future', 'Gözlem günü bugünden sonra olamaz.', [
      'observedDate',
    ])
}

/**
 * Sınıf ve ders bağı: `null` istenmedi, `false` kurumda yok ya da arşivli. Gözlem planı
 * (DOM-FIN-139) aynı kuralı kullanır.
 */
export function assertObservationRecords(checks: {
  classFound: boolean | null
  subjectFound: boolean | null
}) {
  if (checks.classFound === false)
    throw ruleError('observation_class_not_found', 'Sınıf bulunamadı.', ['classId'])
  if (checks.subjectFound === false)
    throw ruleError('observation_subject_not_found', 'Ders bulunamadı.', ['subjectId'])
}

export interface LessonObservationChecks {
  /** Şablonun son sürümü; şablon kurumda yoksa `null`. */
  template: { archived: boolean; criteria: readonly ObservationCriterion[] } | null
  teacher: ObservationMember | null
  observer: ObservationMember | null
  classFound: boolean | null
  subjectFound: boolean | null
  period: ObservationPeriodCheck
  today: string
}

/**
 * Yeni gözlem taslağı (K-446). Şablon kurumun arşivlenmemiş formudur (son sürümü kullanılır);
 * gözlenen kurumun etkin öğretmeni, gözlemci etkin yönetici ya da öğretmendir ve gözlenenden
 * başka kişidir. Gün bugünden sonra değildir; dönem bağlanırsa dönem kapanmamıştır ve gün dönem
 * içindedir. Ölçüt seviyeleri boş başlar.
 */
export function planLessonObservation(
  input: { observedDate: string },
  checks: LessonObservationChecks,
): ObservationRating[] {
  const { template } = checks
  if (template === null)
    throw ruleError('observation_template_not_found', 'Gözlem formu bulunamadı.', ['templateId'])
  if (template.archived) throw archivedError()
  assertObservationPeople(checks.teacher, checks.observer)
  assertObservationRecords(checks)
  assertDay(input.observedDate, checks.today)
  assertPeriod(checks.period, input.observedDate)
  return template.criteria.map((criterion) => ({
    criterionId: criterion.id,
    level: null,
    note: null,
  }))
}

/**
 * Gözlenen ve gözlemci (K-446): gözlenen kurumun etkin öğretmeni, gözlemci etkin yönetici ya da
 * öğretmen ve gözlenenden başka kişidir. Gözlem planı (DOM-FIN-139) aynı kuralı kullanır.
 */
export function assertObservationPeople(
  teacher: ObservationMember | null,
  observer: ObservationMember | null,
): void {
  if (teacher === null)
    throw ruleError('observation_teacher_not_found', 'Öğretmen bulunamadı.', [
      'teacherMembershipId',
    ])
  if (teacher.role !== 'ogretmen')
    throw ruleError('observation_not_teacher', 'Ders gözlemi yalnız öğretmene yapılır.', [
      'teacherMembershipId',
    ])
  if (!teacher.active)
    throw ruleError(
      'observation_teacher_inactive',
      'Ayrılan (pasifleştirilmiş) öğretmene gözlem açılmaz.',
      ['teacherMembershipId'],
    )
  if (observer === null)
    throw ruleError('observation_observer_not_found', 'Gözlemci bulunamadı.', [
      'observerMembershipId',
    ])
  if (!(LESSON_OBSERVER_ROLES as readonly string[]).includes(observer.role) || !observer.active)
    throw ruleError(
      'observation_observer_invalid',
      'Gözlemci kurumun etkin yöneticisi ya da öğretmeni olmalı.',
      ['observerMembershipId'],
    )
  if (observer.membershipId === teacher.membershipId)
    throw ruleError('observation_self', 'Öğretmen kendi dersinin gözlemcisi olamaz.', [
      'observerMembershipId',
    ])
}

const completedError = () =>
  conflict('observation_completed', 'Gözlem tamamlandı; artık değiştirilemez.')

export interface LessonObservationPatch {
  observedDate?: string
  classId?: string | null
  subjectId?: string | null
  performancePeriodId?: string | null
  ratings?: ObservationRating[]
  generalNote?: string | null
}

/**
 * Taslak düzeltmesi (K-446). Tamamlanan gözlem 409. Seviyeler ölçüt kimliğiyle birleştirilir:
 * bilinmeyen ya da yinelenen ölçüt 422. Gün ya da dönem değişirse gün ve dönem yeniden
 * denetlenir (`period`, son hâldeki dönem; bağ yoksa `undefined`).
 */
export function planLessonObservationUpdate(
  observation: {
    status: LessonObservationStatus
    observedDate: string
    ratings: readonly ObservationRating[]
  },
  criteria: readonly ObservationCriterion[],
  input: LessonObservationUpdateFields,
  checks: {
    classFound: boolean | null
    subjectFound: boolean | null
    period: ObservationPeriodCheck
    today: string
  },
): LessonObservationPatch {
  if (observation.status === 'completed') throw completedError()
  const patch: LessonObservationPatch = {}
  const observedDate = input.observedDate ?? observation.observedDate
  if (input.observedDate !== undefined) {
    assertDay(input.observedDate, checks.today)
    patch.observedDate = input.observedDate
  }
  if (input.observedDate !== undefined || input.performancePeriodId !== undefined)
    assertPeriod(checks.period, observedDate)
  if (input.performancePeriodId !== undefined) patch.performancePeriodId = input.performancePeriodId
  assertObservationRecords(checks)
  if (input.classId !== undefined) patch.classId = input.classId
  if (input.subjectId !== undefined) patch.subjectId = input.subjectId
  if (input.ratings !== undefined) {
    const known = new Set(criteria.map((c) => c.id))
    const given = new Map<string, ObservationRating>()
    input.ratings.forEach((rating, index) => {
      if (!known.has(rating.criterionId) || given.has(rating.criterionId))
        throw ruleError(
          'observation_criterion_invalid',
          'Ölçüt bu formda yok ya da tekrar ediyor.',
          ['ratings', String(index), 'criterionId'],
        )
      given.set(rating.criterionId, rating)
    })
    const current = new Map(observation.ratings.map((r) => [r.criterionId, r]))
    patch.ratings = criteria.map(
      (criterion) =>
        given.get(criterion.id) ??
        current.get(criterion.id) ?? { criterionId: criterion.id, level: null, note: null },
    )
  }
  if (input.generalNote !== undefined) patch.generalNote = input.generalNote
  return patch
}

/** Rubrik motorunun beklediği biçim: kimlik ve ağırlık (bant metni puana girmez). */
const asRubric = (criteria: readonly ObservationCriterion[]) => ({
  criteria: criteria.map((criterion) => ({
    id: criterion.id,
    aspect: HOLISTIC_ASPECT,
    weight: criterion.weight,
    bands: [],
  })),
})

/**
 * Gözlem puanı (K-446): rubrik puanıyla aynı kural (`rubricScore`, DOM-BEC-021) — ağırlıklı seviye
 * toplamı, azami toplam ve 100'lük puan. Seviyesi verilmemiş ölçüt varsa `null`. Saklanmaz; her
 * okumada şablon sürümünden ve seviyelerden hesaplanır.
 */
export function lessonObservationScore(
  criteria: readonly ObservationCriterion[],
  ratings: readonly ObservationRating[],
): ObservationScore | null {
  const levels = new Map(ratings.map((r) => [r.criterionId, r.level]))
  const bands: { criterionId: string; band: number }[] = []
  for (const criterion of criteria) {
    const level = levels.get(criterion.id)
    if (level === null || level === undefined) return null
    bands.push({ criterionId: criterion.id, band: level })
  }
  if (bands.length === 0) return null
  const { total, max, percent } = rubricScore(asRubric(criteria), bands)
  return { total, max, percent }
}

/** Seviyesi verilmiş ölçüt sayısı (ilerleme). */
export const ratedCount = (ratings: readonly ObservationRating[]) =>
  ratings.filter((rating) => rating.level !== null).length

/**
 * Tamamlama (K-446): her ölçüte seviye verilmiş (422 `observation_unrated`), hedefin altındaki
 * (0–2) seviyeye not yazılmış (422 `observation_note_required`; rubrikteki kriter yorumu kuralı,
 * DOM-BEC-021) ve genel değerlendirme yazılmış olmalı (422 `observation_general_note_required`).
 * Tamamlanan gözlem yeniden tamamlanmaz (409). Dönen puan sunucunun hesabıdır.
 */
export function planLessonObservationComplete(
  observation: {
    status: LessonObservationStatus
    ratings: readonly ObservationRating[]
    generalNote: string | null
  },
  criteria: readonly ObservationCriterion[],
): ObservationScore {
  if (observation.status === 'completed') throw completedError()
  const byId = new Map(observation.ratings.map((r) => [r.criterionId, r]))
  const missing = criteria.filter((c) => (byId.get(c.id)?.level ?? null) === null).length
  if (missing > 0)
    throw ruleError(
      'observation_unrated',
      `Seviyesi verilmemiş ${String(missing)} ölçüt var; her ölçüte seviye verin.`,
      ['ratings'],
    )
  criteria.forEach((criterion, index) => {
    const rating = byId.get(criterion.id)
    if (rating?.level != null && bandMeaning(rating.level) === 'below' && rating.note === null)
      throw ruleError(
        'observation_note_required',
        `"${criterion.title}" ölçütüne hedefin altında seviye verildi; kısa not yazın.`,
        ['ratings', String(index), 'note'],
      )
  })
  if (observation.generalNote === null)
    throw ruleError(
      'observation_general_note_required',
      'Gözlemi tamamlamak için genel değerlendirmeyi yazın.',
      ['generalNote'],
    )
  const score = lessonObservationScore(criteria, observation.ratings)
  if (score === null)
    throw ruleError('observation_unrated', 'Her ölçüte seviye verin.', ['ratings'])
  return score
}

/**
 * Taslak arşivi (K-446): yanlış açılmış taslak listeden kalkar; tamamlanan gözlem arşivlenmez
 * (409), kayıt olarak kalır.
 */
export function planLessonObservationArchive(observation: {
  status: LessonObservationStatus
}): void {
  if (observation.status === 'completed')
    throw conflict(
      'observation_completed',
      'Tamamlanan gözlem arşivlenmez; yalnız taslak arşivlenir.',
    )
}

/**
 * Gözlem görünürlüğü (K-447): yönetici hepsini; gözlemci kendi gözlemini (taslak dahil); gözlenen
 * öğretmen yalnız tamamlanmış gözlemini görür. Diğer roller görmez.
 */
export function canViewLessonObservation(
  viewer: { role: string; membershipId: string },
  observation: {
    teacherMembershipId: string
    observerMembershipId: string
    status: LessonObservationStatus
  },
): boolean {
  if (viewer.role === 'yonetici') return true
  if (viewer.role !== 'ogretmen') return false
  if (observation.observerMembershipId === viewer.membershipId) return true
  return (
    observation.teacherMembershipId === viewer.membershipId && observation.status === 'completed'
  )
}
