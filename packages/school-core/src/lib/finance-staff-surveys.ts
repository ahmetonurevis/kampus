import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import {
  anonymityThresholdSchema,
  meetsAnonymityThreshold,
  STAFF_FEEDBACK_THRESHOLD_DEFAULT,
} from './finance-staff-feedback.ts'
import { isStaffRole, STAFF_ROLES, type StaffRole } from './staff-accounts.ts'

/**
 * Anonim personel memnuniyet anketi (docs/domain/finans.md DOM-FIN-143; ON-191; K-484…K-486).
 * Veli/öğrenci anketinin (IST-069) personel sürümüdür ve ondan bağımsız kurulur. Yönetici taslak
 * anketi hazırlar: başlık, açılış ve kapanış günü (Europe/Istanbul, uçlar dahil), hedef kitle (tüm
 * personel ya da rol ve organizasyon birimi süzgeci), anonimlik eşiği ve sorular (Likert 1–5, eNPS
 * 0–10, açık uçlu). Yayımda sorular, eşik ve katılımcı listesi donar (K-484). Her katılımcı bir kez
 * yanıtlar; katılım işareti ayrı tutulur, yanıt satırı kişiye bağlanmaz (K-485). Sonuç yalnız
 * kapanıştan sonra ve eşik geçilince toplu döner; birim kırılımı eşiği ve tamamlayıcı gizlemeyi
 * geçmeyen birimi göstermez, açık uçlu cevaplar karıştırılır ve zaman taşımaz (K-486). Eşik
 * sınırları ve yardımcısı çok kaynaklı geri bildirimle (`DOM-FIN-134`, K-459) ortaktır.
 * Fonksiyonlar saftır; bugün ve rastgelelik dışarıdan verilir.
 */

/** Anketi yalnız yönetici hazırlar, yayımlar ve sonucunu okur (K-484, K-486). */
export const FINANCE_STAFF_SURVEY_ROLES = ['yonetici'] as const satisfies readonly Role[]
/** Kendi anketini personel (yönetici, öğretmen, ön büro) görür ve yanıtlar (K-485). */
export const STAFF_SURVEY_RESPONDENT_ROLES = STAFF_ROLES satisfies readonly Role[]

export const STAFF_SURVEY_QUESTION_KINDS = ['likert', 'enps', 'open'] as const
export type StaffSurveyQuestionKind = (typeof STAFF_SURVEY_QUESTION_KINDS)[number]
export const STAFF_SURVEY_QUESTION_KIND_LABELS = {
  likert: 'Likert (1–5)',
  enps: 'eNPS (0–10)',
  open: 'Açık uçlu',
} as const satisfies Record<StaffSurveyQuestionKind, string>

/** Puanlı soruların ölçeği: Likert 1–5, eNPS 0–10. */
export const STAFF_SURVEY_SCALES = {
  likert: { min: 1, max: 5 },
  enps: { min: 0, max: 10 },
} as const satisfies Record<Exclude<StaffSurveyQuestionKind, 'open'>, { min: number; max: number }>

/** Kurum içi rol adları (StaffRole → görünen ad). */
export const STAFF_SURVEY_ROLE_LABELS = {
  yonetici: 'Yönetici',
  ogretmen: 'Öğretmen',
  onburo: 'Ön büro',
} as const satisfies Record<StaffRole, string>

export const STAFF_SURVEY_STATUSES = ['draft', 'published', 'archived'] as const
export type StaffSurveyStatus = (typeof STAFF_SURVEY_STATUSES)[number]

/** Aşama saklanmaz; durumdan ve bugünden hesaplanır (K-484). */
export const STAFF_SURVEY_PHASES = ['draft', 'scheduled', 'open', 'closed'] as const
export type StaffSurveyPhase = (typeof STAFF_SURVEY_PHASES)[number]
export const STAFF_SURVEY_PHASE_LABELS = {
  draft: 'Taslak',
  scheduled: 'Yayımlandı, açılmadı',
  open: 'Yanıta açık',
  closed: 'Kapandı',
} as const satisfies Record<StaffSurveyPhase, string>

export const STAFF_SURVEY_TITLE_MIN = 3
export const STAFF_SURVEY_TITLE_MAX = 150
export const STAFF_SURVEY_QUESTIONS_MAX = 30
export const STAFF_SURVEY_QUESTION_MIN = 5
export const STAFF_SURVEY_QUESTION_MAX = 300
export const STAFF_SURVEY_TEXT_MAX = 2000
export const STAFF_SURVEY_UNITS_MAX = 50
/** Açılıştan kapanışa en çok 90 gün (uçlar dahil). */
export const STAFF_SURVEY_DURATION_MAX_DAYS = 90
export const STAFF_SURVEY_THRESHOLD_DEFAULT = STAFF_FEEDBACK_THRESHOLD_DEFAULT

// --- Şemalar -------------------------------------------------------------------------------------

const questionSchema = z.strictObject({
  kind: z
    .enum(STAFF_SURVEY_QUESTION_KINDS, 'Soru türünü seçin.')
    .describe('`likert` 1–5, `enps` 0–10 (tavsiye etme olasılığı), `open` açık uçlu'),
  text: z
    .string('Soruyu yazın.')
    .trim()
    .min(STAFF_SURVEY_QUESTION_MIN, 'Soruyu en az 5 karakterle yazın.')
    .max(
      STAFF_SURVEY_QUESTION_MAX,
      `Soru en fazla ${String(STAFF_SURVEY_QUESTION_MAX)} karakter olabilir.`,
    )
    .describe('Soru metni'),
  required: z.boolean('Zorunluluğu seçin.').describe('Yanıtta cevap zorunlu mu'),
})
export type StaffSurveyQuestion = z.output<typeof questionSchema>

const questionsSchema = z
  .array(questionSchema, 'Soruları girin.')
  .min(1, 'En az bir soru girin.')
  .max(STAFF_SURVEY_QUESTIONS_MAX, `En çok ${String(STAFF_SURVEY_QUESTIONS_MAX)} soru girilebilir.`)
  .describe('Sorular, sırasıyla; yayımdan sonra değişmez (K-484)')

const unique = <T>(values: readonly T[]) => new Set(values).size === values.length

export const staffSurveyAudienceSchema = z.strictObject({
  roles: z
    .array(z.enum(STAFF_ROLES, 'Rolü seçin.'), 'Rolleri seçin.')
    .max(STAFF_ROLES.length, 'Roller geçersiz.')
    .refine(unique, 'Bir rol bir kez seçilir.')
    .describe('Rol süzgeci (`yonetici`, `ogretmen`, `onburo`); boş = bütün personel rolleri'),
  unitIds: z
    .array(z.uuid('Birim geçersiz.'), 'Birimleri seçin.')
    .max(STAFF_SURVEY_UNITS_MAX, `En çok ${String(STAFF_SURVEY_UNITS_MAX)} birim seçilebilir.`)
    .refine(unique, 'Bir birim bir kez seçilir.')
    .describe(
      'Organizasyon birimi süzgeci (DOM-FIN-129); yayım günü birimde süren ataması olan personel. Boş = birim süzgeci yok',
    ),
})
export type StaffSurveyAudience = z.output<typeof staffSurveyAudienceSchema>

const titleSchema = z
  .string('Anket başlığını yazın.')
  .trim()
  .min(STAFF_SURVEY_TITLE_MIN, 'Başlığı en az 3 karakterle yazın.')
  .max(
    STAFF_SURVEY_TITLE_MAX,
    `Başlık en fazla ${String(STAFF_SURVEY_TITLE_MAX)} karakter olabilir.`,
  )
  .describe('Anket başlığı')

const thresholdSchema = anonymityThresholdSchema(
  'Sonucun gösterilmesi için gereken en az yanıt (3–10; verilmezse kurumun anonimlik eşiği, K-486)',
)

const dayDistance = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

/** Açılış ≤ kapanış ve en çok 90 gün (K-484); hata `path` ile döner. */
function datesIssue(openDate: string, closeDate: string): string | null {
  if (closeDate < openDate) return 'Kapanış günü açılış gününden önce olamaz.'
  if (dayDistance(openDate, closeDate) + 1 > STAFF_SURVEY_DURATION_MAX_DAYS)
    return `Anket en çok ${String(STAFF_SURVEY_DURATION_MAX_DAYS)} gün açık kalabilir.`
  return null
}

export const staffSurveyCreateSchema = z
  .strictObject({
    title: titleSchema,
    openDate: daySchema.describe('Açılış günü (Europe/Istanbul, dahil)'),
    closeDate: daySchema.describe(
      'Kapanış günü (Europe/Istanbul, dahil); ertesi gün yanıt alınmaz',
    ),
    anonymityThreshold: thresholdSchema.optional(),
    audience: staffSurveyAudienceSchema.describe('Hedef kitle (K-484)'),
    questions: questionsSchema,
  })
  .superRefine((value, ctx) => {
    const issue = datesIssue(value.openDate, value.closeDate)
    if (issue !== null) ctx.addIssue({ code: 'custom', path: ['closeDate'], message: issue })
  })
export type StaffSurveyCreateInput = z.input<typeof staffSurveyCreateSchema>
export type StaffSurveyCreateFields = z.output<typeof staffSurveyCreateSchema>

/** Taslak düzeltmesi: verilen alanlar değişir; en az bir alan (K-484). */
export const staffSurveyUpdateSchema = z
  .strictObject({
    title: titleSchema.optional(),
    openDate: daySchema.describe('Açılış günü').optional(),
    closeDate: daySchema.describe('Kapanış günü').optional(),
    anonymityThreshold: thresholdSchema.optional(),
    audience: staffSurveyAudienceSchema.describe('Hedef kitle').optional(),
    questions: questionsSchema.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Değiştirilecek bir alan gönderin.',
  })
export type StaffSurveyUpdateInput = z.input<typeof staffSurveyUpdateSchema>
export type StaffSurveyUpdateFields = z.output<typeof staffSurveyUpdateSchema>

const answerSchema = z.strictObject({
  value: z
    .number('Cevap geçersiz.')
    .int('Cevap tam sayı olmalı.')
    .nullable()
    .optional()
    .describe('Likert 1–5 ya da eNPS 0–10; boş = cevaplanmadı'),
  // kvkk: K (serbest metin; denetime ve loga yazılmaz, kişiye bağlanmaz)
  text: z
    .string('Cevap geçersiz.')
    .trim()
    .max(
      STAFF_SURVEY_TEXT_MAX,
      `Cevap en fazla ${String(STAFF_SURVEY_TEXT_MAX)} karakter olabilir.`,
    )
    .nullable()
    .optional()
    .describe('Açık uçlu soru için cevap; boş = cevaplanmadı'),
})

/** Personelin kendi yanıtı (K-485): soru sırasıyla cevaplar; gönderim yanıtı kesinleştirir. */
export const staffSurveyResponseSchema = z.strictObject({
  answers: z
    .array(answerSchema, 'Cevapları girin.')
    .max(STAFF_SURVEY_QUESTIONS_MAX, 'Cevaplar geçersiz.')
    .describe('Soru sırasıyla cevaplar; dizi soru sayısı kadardır'),
})
export type StaffSurveyResponseInput = z.input<typeof staffSurveyResponseSchema>
export type StaffSurveyResponseFields = z.output<typeof staffSurveyResponseSchema>

export interface StaffSurveyAnswer {
  value: number | null
  // kvkk: K
  text: string | null
}

// --- Aşama ve kurallar ---------------------------------------------------------------------------

const ruleError = (code: string, message: string, path?: string) =>
  new DomainError(code, message, { kind: 'rule', ...(path === undefined ? {} : { path: [path] }) })
const conflict = (code: string, message: string) =>
  new DomainError(code, message, { kind: 'conflict' })

interface SurveyDates {
  status: StaffSurveyStatus
  openDate: string
  closeDate: string
}

/**
 * Aşama (K-484): taslak; yayımlanmış anket açılış gününden önce "açılmadı", açılış ve kapanış
 * günü arasında (uçlar dahil) "yanıta açık", kapanış gününden sonra "kapandı". Arşivli taslak
 * listelenmez; aşaması taslak sayılır.
 */
export function staffSurveyPhase(survey: SurveyDates, today: string): StaffSurveyPhase {
  if (survey.status !== 'published') return 'draft'
  if (today < survey.openDate) return 'scheduled'
  if (today > survey.closeDate) return 'closed'
  return 'open'
}

const notDraft = () =>
  conflict(
    'staff_survey_not_draft',
    'Anket yayımlandı; sorular, tarihler, hedef kitle ve eşik artık değiştirilemez. Değişiklik için yeni sürüm açın.',
  )

export interface StaffSurveyDraft {
  title: string
  openDate: string
  closeDate: string
  anonymityThreshold: number
  audience: StaffSurveyAudience
  questions: StaffSurveyQuestion[]
}

/** Yeni taslak (K-484): eşik verilmezse kurumun anonimlik eşiği (K-459 ayarı). */
export function planStaffSurveyCreate(
  input: StaffSurveyCreateFields,
  checks: { defaultThreshold: number; unknownUnitIds: readonly string[] },
): StaffSurveyDraft {
  if (checks.unknownUnitIds.length > 0)
    throw ruleError('staff_survey_unit_not_found', 'Seçilen birim bulunamadı.', 'audience')
  return {
    title: input.title,
    openDate: input.openDate,
    closeDate: input.closeDate,
    anonymityThreshold: input.anonymityThreshold ?? checks.defaultThreshold,
    audience: input.audience,
    questions: input.questions,
  }
}

/** Taslak düzeltmesi (K-484): yalnız taslak; birleşen tarihler yeniden denetlenir. */
export function planStaffSurveyUpdate(
  survey: StaffSurveyDraft & { status: StaffSurveyStatus },
  input: StaffSurveyUpdateFields,
  checks: { unknownUnitIds: readonly string[] },
): StaffSurveyDraft {
  if (survey.status !== 'draft') throw notDraft()
  if (checks.unknownUnitIds.length > 0)
    throw ruleError('staff_survey_unit_not_found', 'Seçilen birim bulunamadı.', 'audience')
  const next: StaffSurveyDraft = {
    title: input.title ?? survey.title,
    openDate: input.openDate ?? survey.openDate,
    closeDate: input.closeDate ?? survey.closeDate,
    anonymityThreshold: input.anonymityThreshold ?? survey.anonymityThreshold,
    audience: input.audience ?? survey.audience,
    questions: input.questions ?? survey.questions,
  }
  const issue = datesIssue(next.openDate, next.closeDate)
  if (issue !== null) throw ruleError('staff_survey_dates_invalid', issue, 'closeDate')
  return next
}

/**
 * Yayım (K-484): yalnız taslak; kapanış günü bugünden önce olamaz; donan katılımcı listesi
 * eşikten küçükse sonuç hiç gösterilemeyeceği için yayımlanmaz (K-486).
 */
export function planStaffSurveyPublish(
  survey: SurveyDates & { anonymityThreshold: number },
  checks: { today: string; audienceSize: number },
): void {
  if (survey.status !== 'draft') throw notDraft()
  if (survey.closeDate < checks.today)
    throw ruleError(
      'staff_survey_closes_past',
      'Kapanış günü geçti; yayımlamadan önce tarihleri düzeltin.',
      'closeDate',
    )
  if (!meetsAnonymityThreshold(checks.audienceSize, survey.anonymityThreshold))
    throw ruleError(
      'staff_survey_audience_below_threshold',
      `Hedef kitlede ${String(checks.audienceSize)} personel var; anonimlik için en az ${String(survey.anonymityThreshold)} kişi gerekir.`,
      'audience',
    )
}

/** Taslağı kaldırma (arşiv; K-484): yayımlanmış anket kaldırılmaz. */
export function planStaffSurveyArchive(survey: { status: StaffSurveyStatus }): void {
  if (survey.status !== 'draft') throw notDraft()
}

/**
 * Yeni sürüm (K-484): yayımlanmış anket kopyalanarak taslak açılır (sorular, hedef kitle, eşik;
 * sürüm numarası bir artar). Taslak kopyalanmaz (doğrudan düzeltilir); bir sürümün tek etkin
 * kopyası olur.
 */
export function planStaffSurveyCopy(
  survey: StaffSurveyDraft & { status: StaffSurveyStatus; revision: number },
  checks: { copyExists: boolean },
): StaffSurveyDraft & { revision: number } {
  if (survey.status !== 'published')
    throw conflict(
      'staff_survey_copy_draft',
      'Yalnız yayımlanmış anketin yeni sürümü açılır; taslağı doğrudan düzeltin.',
    )
  if (checks.copyExists)
    throw conflict('staff_survey_copy_exists', 'Bu anketin yeni sürümü zaten açıldı.')
  return {
    title: survey.title,
    openDate: survey.openDate,
    closeDate: survey.closeDate,
    anonymityThreshold: survey.anonymityThreshold,
    audience: survey.audience,
    questions: survey.questions.map((question) => ({ ...question })),
    revision: survey.revision + 1,
  }
}

// --- Hedef kitle ---------------------------------------------------------------------------------

/** Yayım günü kurumun bir üyeliği: rol, etkinlik ve süren atamalarının birimleri (sıralı). */
export interface StaffSurveyCandidate {
  membershipId: string
  role: string
  active: boolean
  /** Yayım günü süren organizasyon atamalarının birimleri, başlangıç gününe göre sıralı. */
  unitIds: readonly string[]
}

export interface StaffSurveyParticipant {
  membershipId: string
  /** Sonuç kırılımındaki birim: süzgeç varsa ilk eşleşen, yoksa ilk süren atamanın birimi. */
  unitId: string | null
}

/**
 * Hedef kitle (K-484): kurumun etkin personeli (yönetici, öğretmen, ön büro); rol süzgeci
 * verildiyse o roller, birim süzgeci verildiyse yayım günü o birimlerden birinde süren ataması
 * olanlar. Birim alt birimleri kapsamaz. Liste yayımda donar; sonradan gelen personel katılmaz.
 */
export function staffSurveyParticipants(
  candidates: readonly StaffSurveyCandidate[],
  audience: StaffSurveyAudience,
): StaffSurveyParticipant[] {
  const roles = new Set<string>(audience.roles)
  const units = new Set(audience.unitIds)
  return candidates.flatMap((candidate) => {
    if (!candidate.active || !isStaffRole(candidate.role)) return []
    if (roles.size > 0 && !roles.has(candidate.role)) return []
    if (units.size === 0)
      return [{ membershipId: candidate.membershipId, unitId: candidate.unitIds[0] ?? null }]
    const unitId = candidate.unitIds.find((id) => units.has(id))
    return unitId === undefined ? [] : [{ membershipId: candidate.membershipId, unitId }]
  })
}

// --- Yanıt ---------------------------------------------------------------------------------------

const isAnswered = (question: StaffSurveyQuestion, answer: StaffSurveyAnswer | undefined) =>
  answer !== undefined && (question.kind === 'open' ? answer.text !== null : answer.value !== null)

/**
 * Cevapları sorulara göre doğrular (K-485): dizi soru sayısı kadardır (422
 * `staff_survey_answers_mismatch`), puanlı soruya metin, açık uçluya puan yazılmaz (422
 * `staff_survey_answer_kind`), puan ölçeğin içinde olmalı (422 `staff_survey_answer_range`),
 * zorunlu sorular cevaplı olmalı (422 `staff_survey_incomplete`). Boş metin cevaplanmamıştır.
 */
export function normalizeStaffSurveyAnswers(
  questions: readonly StaffSurveyQuestion[],
  answers: StaffSurveyResponseFields['answers'],
): StaffSurveyAnswer[] {
  if (answers.length !== questions.length)
    throw ruleError(
      'staff_survey_answers_mismatch',
      'Her soru için bir cevap satırı gönderin.',
      'answers',
    )
  const normalized = questions.map((question, index): StaffSurveyAnswer => {
    const answer = answers[index] ?? {}
    const value = answer.value ?? null
    const text =
      answer.text === undefined || answer.text === null || answer.text === '' ? null : answer.text
    const number = String(index + 1)
    if ((question.kind === 'open' && value !== null) || (question.kind !== 'open' && text !== null))
      throw ruleError(
        'staff_survey_answer_kind',
        `${number}. soru ${question.kind === 'open' ? 'açık uçludur; puan verilmez' : 'puanlıdır; metin yazılmaz'}.`,
        'answers',
      )
    if (question.kind !== 'open' && value !== null) {
      const scale = STAFF_SURVEY_SCALES[question.kind]
      if (value < scale.min || value > scale.max)
        throw ruleError(
          'staff_survey_answer_range',
          `${number}. sorunun cevabı ${String(scale.min)}–${String(scale.max)} arasında olmalı.`,
          'answers',
        )
    }
    return { value, text }
  })
  const missing = questions.filter(
    (question, index) => question.required && !isAnswered(question, normalized[index]),
  ).length
  if (missing > 0)
    throw ruleError(
      'staff_survey_incomplete',
      `Zorunlu ${String(missing)} soru cevaplanmadı.`,
      'answers',
    )
  return normalized
}

/**
 * Personelin yanıtı (K-485): anket yanıta açık olmalı (açılmadıysa 422 `staff_survey_not_open`,
 * kapandıysa 422 `staff_survey_closed`); kişi bir kez yanıtlar (409
 * `staff_survey_already_responded`). Katılımcı olmayan kişiye anket bulunmaz (servis 404).
 */
export function planStaffSurveyResponse(
  survey: SurveyDates & { questions: readonly StaffSurveyQuestion[] },
  participant: { responded: boolean },
  input: StaffSurveyResponseFields,
  today: string,
): StaffSurveyAnswer[] {
  const phase = staffSurveyPhase(survey, today)
  if (phase === 'closed')
    throw ruleError('staff_survey_closed', 'Anket kapandı; yanıt artık alınmıyor.')
  if (phase !== 'open') throw ruleError('staff_survey_not_open', 'Anket henüz yanıta açılmadı.')
  if (participant.responded)
    throw conflict('staff_survey_already_responded', 'Bu anketi zaten yanıtladınız.')
  return normalizeStaffSurveyAnswers(survey.questions, input.answers)
}

// --- Katılım ve sonuç ----------------------------------------------------------------------------

export interface StaffSurveyParticipation {
  participants: number
  responded: number
  /** Yanıtlayan / katılımcı, yüzde, bir ondalık; katılımcı yoksa `null`. */
  rate: number | null
}

export function staffSurveyParticipation(
  participants: number,
  responded: number,
): StaffSurveyParticipation {
  return {
    participants,
    responded,
    rate: participants === 0 ? null : Math.round((responded * 1000) / participants) / 10,
  }
}

/** Birimsiz katılımcının kırılım anahtarı (sorguda `unitId=none`). */
export const STAFF_SURVEY_NO_UNIT = 'none'

/**
 * Tamamlayıcı gizleme (K-486): eşik altındaki gruplar gizlenir; gizli grupların toplamı 1 ile
 * eşik arasında kalırsa (toplam ve görünen grupların farkından bulunabilirdi) en küçük görünen
 * grup da gizlenir, toplam 0 ya da eşik üstü olana kadar. Görünen grup anahtarlarını döner.
 */
export function visibleAnonymousGroups(
  counts: ReadonlyMap<string, number>,
  threshold: number,
): Set<string> {
  const visible = new Set(
    [...counts]
      .filter(([, count]) => meetsAnonymityThreshold(count, threshold))
      .map(([key]) => key),
  )
  let hidden = [...counts].filter(([key]) => !visible.has(key)).reduce((sum, [, n]) => sum + n, 0)
  while (hidden > 0 && !meetsAnonymityThreshold(hidden, threshold) && visible.size > 0) {
    const [smallest] = [...visible].sort(
      (a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0) || a.localeCompare(b),
    )
    if (smallest === undefined) break
    visible.delete(smallest)
    hidden += counts.get(smallest) ?? 0
  }
  return visible
}

export interface StaffSurveyEnps {
  /** Tavsiye eden (9–10) yüzdesi eksi kötüleyen (0–6) yüzdesi, tam sayı (−100…100). */
  score: number
  promoters: number
  passives: number
  detractors: number
}

export interface StaffSurveyQuestionResult {
  kind: StaffSurveyQuestionKind
  text: string
  required: boolean
  /** Bu soruyu cevaplayan sayısı (görünür değilse `null`). */
  answered: number | null
  /** Soru eşik altında ya da tamamlayıcı gizlemeyle gizli: dağılım, ortalama ve metin dönmez. */
  hidden: boolean
  /** Puanlı soruda ortalama, iki ondalık. */
  average: number | null
  /** Puanlı soruda ölçeğin her değerinin yanıt sayısı, küçükten büyüğe (Likert 5, eNPS 11 öğe). */
  distribution: number[]
  enps: StaffSurveyEnps | null
  /** Açık uçlu cevaplar, karıştırılmış sırayla; kimden ve ne zaman geldiği yoktur. */
  texts: string[]
}

export type StaffSurveyHiddenReason = 'not_closed' | 'below_threshold' | 'unit_below_threshold'

export interface StaffSurveyResult extends StaffSurveyParticipation {
  threshold: number
  /** Seçilen birim kırılımı: birim kimliği, `none` birimsiz, `null` bütün yanıtlar. */
  unit: string | null
  visible: boolean
  hiddenReason: StaffSurveyHiddenReason | null
  /** Sonuçta seçilebilen birimler (yanıtı eşik ve tamamlayıcı gizlemeyi geçen), yanıt sayısıyla. */
  units: { unit: string; responses: number }[]
  questions: StaffSurveyQuestionResult[]
}

/** Yanıt satırı: birim (katılımcının yayım günü birimi) ve cevaplar; kişi ve zaman yoktur. */
export interface StaffSurveyStoredResponse {
  unitId: string | null
  answers: readonly StaffSurveyAnswer[]
}

const unitKey = (unitId: string | null) => unitId ?? STAFF_SURVEY_NO_UNIT

/** Fisher–Yates; `random` [0, 1) verir. */
function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const copy = [...values]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    const current = copy[index] as T
    copy[index] = copy[swap] as T
    copy[swap] = current
  }
  return copy
}

const round2 = (value: number) => Math.round(value * 100) / 100

function questionResult(
  question: StaffSurveyQuestion,
  answers: readonly (StaffSurveyAnswer | undefined)[],
  visible: boolean,
  random: () => number,
): StaffSurveyQuestionResult {
  const given = answers.filter(
    (answer): answer is StaffSurveyAnswer => answer !== undefined && isAnswered(question, answer),
  )
  const base = { kind: question.kind, text: question.text, required: question.required }
  if (!visible)
    return {
      ...base,
      answered: null,
      hidden: true,
      average: null,
      distribution: [],
      enps: null,
      texts: [],
    }
  if (question.kind === 'open')
    return {
      ...base,
      answered: given.length,
      hidden: false,
      average: null,
      distribution: [],
      enps: null,
      texts: shuffled(
        given.flatMap((answer) => (answer.text === null ? [] : [answer.text])),
        random,
      ),
    }
  const scale = STAFF_SURVEY_SCALES[question.kind]
  const values = given.flatMap((answer) => (answer.value === null ? [] : [answer.value]))
  const distribution = Array.from(
    { length: scale.max - scale.min + 1 },
    (_, offset) => values.filter((value) => value === scale.min + offset).length,
  )
  const average =
    values.length === 0
      ? null
      : round2(values.reduce((sum, value) => sum + value, 0) / values.length)
  const promoters = values.filter((value) => value >= 9).length
  const detractors = values.filter((value) => value <= 6).length
  return {
    ...base,
    answered: values.length,
    hidden: false,
    average,
    distribution,
    enps:
      question.kind === 'enps' && values.length > 0
        ? {
            score: Math.round(((promoters - detractors) * 100) / values.length),
            promoters,
            passives: values.length - promoters - detractors,
            detractors,
          }
        : null,
    texts: [],
  }
}

/**
 * Toplu sonuç (K-486). Yalnız anket kapandıktan sonra (açıkken her yeni yanıtla değişen toplam,
 * katılım işaretiyle birlikte tek yanıtı ele verirdi; `not_closed`) ve en az `threshold` yanıtla
 * (`below_threshold`) döner. Birim kırılımında birim, yanıt sayısı eşiği ve tamamlayıcı gizlemeyi
 * (`visibleAnonymousGroups`) geçmelidir (`unit_below_threshold`). Soru başına cevap sayısı da aynı
 * kurala tabidir: bütün yanıtlarda eşik, birim kırılımında soru bazında tamamlayıcı gizleme. Puanlı
 * soruda dağılım ve ortalama, eNPS sorusunda ayrıca eNPS puanı; açık uçlu cevaplar karıştırılır.
 */
export function staffSurveyResult(input: {
  questions: readonly StaffSurveyQuestion[]
  threshold: number
  closed: boolean
  participants: number
  responses: readonly StaffSurveyStoredResponse[]
  /** Birim kimliği, `none` birimsiz, `null` bütün yanıtlar. */
  unit: string | null
  random: () => number
}): StaffSurveyResult {
  const { questions, threshold, responses } = input
  const participation = staffSurveyParticipation(input.participants, responses.length)
  const countBy = (rows: readonly StaffSurveyStoredResponse[]) => {
    const counts = new Map<string, number>()
    for (const row of rows)
      counts.set(unitKey(row.unitId), (counts.get(unitKey(row.unitId)) ?? 0) + 1)
    return counts
  }
  const counts = countBy(responses)
  const hidden = (reason: StaffSurveyHiddenReason): StaffSurveyResult => ({
    ...participation,
    threshold,
    unit: input.unit,
    visible: false,
    hiddenReason: reason,
    units: [],
    questions: questions.map((question) => questionResult(question, [], false, input.random)),
  })
  if (!input.closed) return hidden('not_closed')
  if (!meetsAnonymityThreshold(responses.length, threshold)) return hidden('below_threshold')
  const visibleUnits = visibleAnonymousGroups(counts, threshold)
  const units = [...visibleUnits]
    .sort((a, b) => a.localeCompare(b))
    .map((unit) => ({ unit, responses: counts.get(unit) ?? 0 }))
  if (input.unit !== null && !visibleUnits.has(input.unit))
    return { ...hidden('unit_below_threshold'), units }
  const scoped =
    input.unit === null ? responses : responses.filter((row) => unitKey(row.unitId) === input.unit)
  return {
    ...participation,
    threshold,
    unit: input.unit,
    visible: true,
    hiddenReason: null,
    units,
    questions: questions.map((question, index) => {
      const answeredBy = (rows: readonly StaffSurveyStoredResponse[]) =>
        rows.filter((row) => isAnswered(question, row.answers[index]))
      const answered = answeredBy(responses)
      let shown = meetsAnonymityThreshold(answered.length, threshold)
      if (shown && input.unit !== null)
        shown = visibleAnonymousGroups(countBy(answered), threshold).has(input.unit)
      return questionResult(
        question,
        scoped.map((row) => row.answers[index]),
        shown,
        input.random,
      )
    }),
  }
}
