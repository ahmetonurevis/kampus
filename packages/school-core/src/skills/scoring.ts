import { z } from 'zod'
import { DomainError } from '../lib/errors.ts'
import type { AnswerKey, QuestionBody, ResourceTags } from '../content/resource.ts'
import {
  QUESTION_TYPES,
  SUBSKILLS,
  enumKeys,
  type ContentType,
  type PrimarySkill,
  type QuestionType,
  type Subskill,
} from '../content/taxonomy.ts'

/**
 * Beceri görevlerinin otomatik puanı, deneme hakkı, süre, geç teslim ve cevabın açılması
 * (docs/domain/beceri-gelisimi.md DOM-BEC-010, 011, 023, 041…045; ADR 0004 karar 5, 6, 11).
 *
 * Bu modül State'e koleksiyon eklemez (ADR 0004 karar 2): girdi servisin yüklediği satırlardır
 * (`task_attempts`, puanlama sürümünün soruları ve anahtarı), fonksiyonlar saftır ve `now` alır.
 * Puan, geç bayrağı ve sayılan deneme saklanmaz; her okumada buradan hesaplanır (karar 5).
 *
 * Zaman kuralları:
 * - Bütün zamanlar sunucu saatidir (ISO 8601 UTC); istemci saati hiçbir girdide yoktur (DOM-BEC-043).
 * - Son teslim anı dahildir: tam `dueAt` anındaki teslim zamanındadır, sonrası geçtir. Geç kabul
 *   süresinin bitiş anı da dahildir; sonrası kapalıdır (DOM-BEC-044).
 * - Deneme süresinin bitiş anı hariçtir: süre dolduğu anda (`now >= endsAt`) cevap kaydedilmez,
 *   deneme kaydedilmiş cevaplarla teslim edilmiş sayılır (DOM-BEC-043).
 */

z.config(z.locales.tr())

const identifier = z.string().trim().min(1, 'Bir kayıt seçin.').max(200)
const itemId = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,40}$/, 'Kimlik yalnız harf, rakam, - ve _ içerebilir.')
/** Sunucu zamanı; yalnız `Z` sonlu UTC kabul edilir. */
const instant = z.iso.datetime({ error: 'Geçerli bir tarih ve saat girin.' })

type Instant = Date | string
const toMs = (value: Instant) => (typeof value === 'string' ? Date.parse(value) : value.getTime())
const toIso = (ms: number) => new Date(ms).toISOString()

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

// --- Görev türü ve deneme ayarı -----------------------------------------------------------

/** Görev türü (DOM-BEC-041). Yayımdan sonra değişmez; sabitleme atamadadır. */
export const TASK_KINDS = {
  evaluation: { label: 'Değerlendirme' },
  practice: { label: 'Alıştırma' },
} as const
export type TaskKind = keyof typeof TASK_KINDS

/** Sayım politikası (DOM-BEC-042). Varsayılan ilk tamamlanan denemedir. */
export const COUNT_POLICIES = {
  first: { label: 'İlk tamamlanan deneme' },
  highest: { label: 'En yüksek puan' },
} as const
export type CountPolicy = keyof typeof COUNT_POLICIES

/** Otomatik değerlendirme görevinde deneme hakkı (DOM-BEC-042). */
export const ATTEMPT_LIMITS = { default: 1, min: 1, max: 3 } as const

/**
 * Deneme ayarı (DOM-BEC-041, 042). Alıştırma sınırsız denenir ve sayılan sonuç üretmez;
 * değerlendirmede hak 1–3'tür, "en yüksek" politikası yalnız hak 1'den büyükse seçilir.
 */
export const attemptRulesSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('evaluation'),
      maxAttempts: z
        .number()
        .int()
        .min(ATTEMPT_LIMITS.min, 'Deneme hakkı en az 1 olmalıdır.')
        .max(ATTEMPT_LIMITS.max, 'Deneme hakkı en fazla 3 olabilir.')
        .default(ATTEMPT_LIMITS.default),
      countPolicy: z.enum(enumKeys(COUNT_POLICIES)).default('first'),
    })
    .refine((rules) => rules.countPolicy === 'first' || rules.maxAttempts > 1, {
      message: '"En yüksek" politikası için deneme hakkı 1\'den büyük olmalıdır.',
      path: ['countPolicy'],
    }),
  z.object({ kind: z.literal('practice') }),
])
export type AttemptRulesInput = z.input<typeof attemptRulesSchema>
export type AttemptRules = z.output<typeof attemptRulesSchema>

// --- Son teslim ve geç kabul --------------------------------------------------------------

/** Geç kabul süresinin üst sınırı (DOM-BEC-044). */
export const LATE_ACCEPTANCE_MAX_DAYS = 7

/**
 * Son teslim ayarı (DOM-BEC-044). `dueAt` UTC'dir; form Europe/Istanbul yerel saatini
 * `istanbulLocalToUtc` ile çevirir. `lateAcceptanceDays: 0` geç teslimi kapatır.
 * `dueAt: null` son tarihsiz görevdir (yalnız alıştırmada anlamlıdır; atama kuralı F4a2).
 */
export const deadlineSchema = z.object({
  dueAt: instant.nullable().default(null),
  // TODO(beceri-gec-kabul-varsayilan): Domain varsayılanı belirtmiyor; en muhafazakâr değer
  // seçildi (geç teslim kapalı). Öğretmen 1–7 gün açar.
  lateAcceptanceDays: z
    .number()
    .int()
    .min(0)
    .max(LATE_ACCEPTANCE_MAX_DAYS, 'Geç kabul süresi en fazla 7 gün olabilir.')
    .default(0),
})
export type DeadlineInput = z.input<typeof deadlineSchema>
export type Deadline = z.output<typeof deadlineSchema>

const LOCAL_MINUTE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
const istanbulParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Istanbul',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})
/** Europe/Istanbul duvar saati, UTC milisaniye gibi (`Date.UTC` ile) okunur. */
function istanbulWallMs(utcMs: number): number {
  const parts = istanbulParts.formatToParts(new Date(utcMs))
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value)
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'))
}

/**
 * Europe/Istanbul yerel saati (`YYYY-MM-DDTHH:mm`, `<input type="datetime-local">` biçimi) →
 * ISO 8601 UTC (DOM-BEC-044: yerel saatle girilir, UTC saklanır). Geçersiz tarih `null` döner.
 * Ofset sabit varsayılmaz, saat dilimi veritabanından okunur.
 */
export function istanbulLocalToUtc(local: string): string | null {
  const match = LOCAL_MINUTE.exec(local)
  if (!match) return null
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number]
  const wall = Date.UTC(y, mo - 1, d, h, mi)
  // `Date.UTC` 30 Şubat'ı 2 Mart'a kaydırır; takvimde olmayan gün reddedilir.
  if (toIso(wall).slice(0, 16) !== local) return null
  let utc = wall - (istanbulWallMs(wall) - wall)
  utc = wall - (istanbulWallMs(utc) - utc)
  return istanbulWallMs(utc) === wall ? toIso(utc) : null
}

/** Formdaki yerel son teslim saati; çıktı UTC ISO'dur (API gövdesi `deadlineSchema.dueAt`). */
export const istanbulLocalDueSchema = z.string().transform((value, ctx) => {
  const utc = istanbulLocalToUtc(value.trim())
  if (utc === null) {
    ctx.addIssue({ code: 'custom', message: 'Geçerli bir tarih ve saat girin.' })
    return z.NEVER
  }
  return utc
})

export type SubmissionWindow = { dueAt: string | null; closesAt: string | null }

/** Son teslim ve teslimin kapandığı an (son tarih + geç kabul süresi). Son tarihsizde ikisi `null`. */
export function submissionWindow(deadline: Deadline): SubmissionWindow {
  if (deadline.dueAt === null) return { dueAt: null, closesAt: null }
  const due = toMs(deadline.dueAt)
  return { dueAt: toIso(due), closesAt: toIso(due + deadline.lateAcceptanceDays * DAY) }
}

/** Teslim geç mi (DOM-BEC-044). Tam son teslim anı zamanındadır. Saklanmaz, okunurken hesaplanır. */
export function isLate(submittedAt: Instant, deadline: Deadline): boolean {
  return deadline.dueAt !== null && toMs(submittedAt) > toMs(deadline.dueAt)
}

/** Teslim kapandı mı (DOM-BEC-044). Geç kabul süresinin bitiş anı dahil açıktır. */
export function isClosed(deadline: Deadline, now: Instant): boolean {
  const { closesAt } = submissionWindow(deadline)
  return closesAt !== null && toMs(now) > toMs(closesAt)
}

/** Teslim kapalıysa Türkçe iletiyle reddeder (`submission_closed`). */
export function assertSubmissionOpen(deadline: Deadline, now: Instant): void {
  if (!isClosed(deadline, now)) return
  throw new DomainError(
    'submission_closed',
    deadline.lateAcceptanceDays === 0
      ? 'Son teslim tarihi geçti; bu görev geç teslim kabul etmiyor.'
      : 'Geç teslim süresi doldu; bu görev artık teslim alınmıyor.',
    { path: ['submittedAt'] },
  )
}

// --- Puanlama yolu ------------------------------------------------------------------------

/** Otomatik puanlanan soru türleri (DOM-BEC-002). Soru bankasındaki bütün türler otomatiktir. */
export const AUTO_SCORED_QUESTION_TYPES = enumKeys(QUESTION_TYPES) as readonly QuestionType[]

/** Görev olarak atanabilen içerik türünün puanlama yolu (DOM-BEC-002, 023); görev değilse `null`. */
export function scoringModeFor(contentType: ContentType): 'auto' | 'teacher' | null {
  switch (contentType) {
    case 'question':
    case 'quiz':
    case 'exercise_set':
      return 'auto'
    case 'homework_template':
      return 'teacher'
    default:
      return null
  }
}

/**
 * Otomatik puanlama yalnız soru, quiz ve alıştırma setinde çalışır. Yazma, konuşma ve aracılık
 * puanını yalnız öğretmen verir (DOM-BEC-023); sözcük sayısı gibi yardımcı bilgi bant önermez.
 */
export function assertAutoScored(contentType: ContentType): void {
  if (scoringModeFor(contentType) === 'auto') return
  throw new DomainError(
    'not_auto_scored',
    'Bu görev otomatik puanlanmaz; yazma, konuşma ve aracılık puanını öğretmen verir.',
  )
}

// --- Cevaplar -----------------------------------------------------------------------------

/**
 * Kursiyerin bir soruya cevabı. Doğru cevap ve açıklama burada değil anahtardadır; öğrenci
 * yanıt şeması anahtar alanı taşımaz (ADR 0004 karar 3). `null` seçim, cevapsız demektir.
 */
export const responseSchema = z.discriminatedUnion('questionType', [
  z.object({ questionType: z.literal('multiple_choice'), optionId: itemId.nullable() }),
  z.object({
    questionType: z.literal('true_false'),
    answer: z.enum(['true', 'false', 'not_given']).nullable(),
  }),
  z.object({
    questionType: z.literal('matching'),
    pairs: z
      .array(z.object({ promptId: itemId, choiceId: itemId }))
      .max(20)
      .refine((pairs) => new Set(pairs.map((p) => p.promptId)).size === pairs.length, {
        message: 'Her öncül tek bir eşleşmeyle eşlenir.',
      }),
  }),
  z.object({
    questionType: z.literal('gap_fill'),
    gaps: z
      .array(z.object({ gapId: itemId, value: z.string().max(200) }))
      .max(20)
      .refine((gaps) => new Set(gaps.map((g) => g.gapId)).size === gaps.length, {
        message: 'Her boşluk bir kez yanıtlanır.',
      }),
  }),
  z.object({ questionType: z.literal('ordering'), order: z.array(itemId).max(20) }),
  z.object({ questionType: z.literal('short_answer'), value: z.string().max(500) }),
])
export type TaskResponse = z.output<typeof responseSchema>

/** Bir denemenin cevapları; anahtar quiz/alıştırma setindeki soru sürüm kimliğidir. */
export const answersSchema = z
  .record(identifier, responseSchema)
  .refine((answers) => Object.keys(answers).length <= 200, 'En fazla 200 cevap gönderilebilir.')
export type Answers = z.output<typeof answersSchema>

/** Puanlanacak soru: quiz satırı (`resource_version_items`) + puanlama sürümünün içeriği ve anahtarı. */
export type ScoringItem = {
  questionVersionId: string
  points: number
  question: QuestionBody
  answerKey: AnswerKey
  /** Kısa cevap karşılaştırma dili; çağıran açıkça seçer (`answerLocaleForTags`). */
  locale: AnswerLocale
  /** Sorunun alt becerisi (DOM-BEC-006; soru etiketinden); dökümde kullanılır, puanı değiştirmez. */
  subskill?: Subskill | null
  /**
   * Maddenin birincil becerisi ve kazanımları (DOM-BEC-048): sorunun etiketi, yoksa quiz/alıştırma
   * setininki. Not defteri kırılımında kullanılır, puanı değiştirmez.
   */
  skill?: PrimarySkill | null
  outcomes?: readonly OutcomeRef[]
}

/** Kazanım bağlantısı (`ResourceTags['outcomes']` satırı). */
export type OutcomeRef = ResourceTags['outcomes'][number]

function responseIssue(question: QuestionBody, response: TaskResponse): string | null {
  if (question.questionType !== response.questionType) return 'Cevap soru türüyle uyuşmuyor.'
  switch (response.questionType) {
    case 'multiple_choice':
      return question.questionType === 'multiple_choice' &&
        response.optionId !== null &&
        !question.options.some((option) => option.id === response.optionId)
        ? 'Seçenek soruda bulunmuyor.'
        : null
    case 'true_false':
      return question.questionType === 'true_false' &&
        response.answer === 'not_given' &&
        !question.allowNotGiven
        ? '"Belirtilmemiş" bu soruda seçilemez.'
        : null
    case 'matching': {
      if (question.questionType !== 'matching') return null
      const prompts = new Set(question.prompts.map((p) => p.id))
      const choices = new Set(question.choices.map((c) => c.id))
      return response.pairs.every((p) => prompts.has(p.promptId) && choices.has(p.choiceId))
        ? null
        : 'Eşleştirme soruda olmayan bir öğe içeriyor.'
    }
    case 'gap_fill': {
      if (question.questionType !== 'gap_fill') return null
      const gaps = new Map(question.gaps.map((gap) => [gap.id, gap]))
      for (const entry of response.gaps) {
        const gap = gaps.get(entry.gapId)
        if (!gap) return 'Boşluk soruda bulunmuyor.'
        if (gap.options.length > 0 && entry.value !== '' && !gap.options.includes(entry.value)) {
          return 'Bu boşluğun cevabı listeden seçilir.'
        }
      }
      return null
    }
    case 'ordering': {
      if (question.questionType !== 'ordering') return null
      const items = new Set(question.items.map((i) => i.id))
      return response.order.length === 0 ||
        (response.order.length === items.size &&
          new Set(response.order).size === items.size &&
          response.order.every((id) => items.has(id)))
        ? null
        : 'Sıralama bütün öğeleri birer kez içermelidir.'
    }
    case 'short_answer':
      return question.questionType === 'short_answer' && response.value.length > question.maxLength
        ? `Cevap en fazla ${question.maxLength} karakter olabilir.`
        : null
    default:
      return response satisfies never
  }
}

/**
 * Kaydedilecek cevapları sorularla denetler. Denemede olmayan soru veya soruyla uyuşmayan cevap
 * `path: ['answers', <soru sürümü>]` ile reddedilir; hiçbir cevap yazılmaz.
 */
export function assertResponsesFit(items: readonly ScoringItem[], answers: Answers): void {
  const byId = new Map(items.map((item) => [item.questionVersionId, item]))
  for (const [id, response] of Object.entries(answers)) {
    const item = byId.get(id)
    const issue = item ? responseIssue(item.question, response) : 'Soru bu görevde bulunmuyor.'
    if (issue) throw new DomainError('answer_invalid', issue, { path: ['answers', id] })
  }
}

/** Karşılaştırma dili: küçültme kuralını belirler (`tr-TR` veya `en-US`). */
export type AnswerLocale = 'tr' | 'en'

const LOWERCASE_LOCALE: Record<AnswerLocale, string> = { tr: 'tr-TR', en: 'en-US' }

/**
 * Kaynağın etiketlerinden karşılaştırma dili (DOM-BEC-010): beceri (birincil veya ek) ya da CEFR
 * seviyesi varsa İngilizce beceri içeriğidir (`en`), yoksa `tr`.
 */
export function answerLocaleForTags(
  tags: Pick<ResourceTags, 'cefrLevel' | 'primarySkill'> & { skills: readonly unknown[] },
): AnswerLocale {
  // TODO(beceri-ders-dili): Okul kurumunda İngilizce dersinin beceri etiketsiz içeriği `tr` olur;
  // "I" anahtarına "i" yazan öğrenci yanlış sayılır. Ders dili alanı gelince dil oradan okunur.
  const skillTagged =
    tags.cefrLevel !== null || tags.primarySkill !== null || tags.skills.length > 0
  return skillTagged ? 'en' : 'tr'
}

/**
 * Kısa cevap ve açık boşluk karşılaştırması (DOM-BEC-010): Unicode NFC, içeriğin diline göre
 * küçültme (`tr`: `tr-TR`, `İ` → `i`, `I` → `ı`; `en`: `en-US`, `I` → `i`), baştaki/sondaki boşluk
 * atılır, art arda ve Unicode boşluklar (NBSP dahil) tek boşluk olur. Tipografik kesme işaretleri
 * (`’ ‘ ʼ ′ ´` ve ters tırnak) `'`, tipografik tırnaklar (`“ ” „ ″`) `"` olur: bunlar yazım farkı
 * değil, klavyenin akıllı noktalama çıktısıdır. Diğer noktalama korunur, sondaki nokta anlamlıdır.
 * Yazım farkı katlanmaz: `ı`/`i`, `ş`/`s` ayrıdır; yazım varyantı yalnız kabul listesinde varsa
 * doğrudur.
 */
export function normalizeShortAnswer(value: string, locale: AnswerLocale): string {
  return value
    .normalize('NFC')
    .toLocaleLowerCase(LOWERCASE_LOCALE[locale])
    .replace(/[\u2018\u2019\u02BC\u2032\u00B4`]/gu, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/gu, '"')
    .replace(/\s+/gu, ' ')
    .trim()
}

const accepts = (accepted: readonly string[], value: string, locale: AnswerLocale) => {
  const normalized = normalizeShortAnswer(value, locale)
  return (
    normalized !== '' &&
    accepted.some((answer) => normalizeShortAnswer(answer, locale) === normalized)
  )
}

export type ItemScore = {
  questionVersionId: string
  /** Puanlanan madde sayısı: eşleştirmede öncül, sıralamada konum, boşlukta boşluk; diğerlerinde 1. */
  parts: number
  correctParts: number
  answered: boolean
  points: number
  /** `points × correctParts / parts`; eksi puan yoktur. */
  earned: number
}

/**
 * Bir sorunun puanı (DOM-BEC-010). Çok maddeli sorularda her madde ayrı puanlanır; yanlış veya
 * yanıtsız madde 0'dır, eksi puan yoktur. Soruyla uyuşmayan cevap yanıtsız sayılır.
 */
export function scoreItem(item: ScoringItem, response: TaskResponse | undefined): ItemScore {
  const { question, answerKey: key } = item
  if (question.questionType !== key.questionType) {
    throw new DomainError('answer_key_mismatch', 'Cevap anahtarı soru türüyle uyuşmuyor.', {
      kind: 'conflict',
      path: ['items', item.questionVersionId],
    })
  }
  const fits = response !== undefined && responseIssue(question, response) === null
  const result = (parts: number, correctParts: number, answered: boolean): ItemScore => ({
    questionVersionId: item.questionVersionId,
    parts,
    correctParts,
    answered,
    points: item.points,
    earned: parts === 0 ? 0 : (item.points * correctParts) / parts,
  })
  const given = fits ? response : undefined
  switch (key.questionType) {
    case 'multiple_choice': {
      const choice = given?.questionType === 'multiple_choice' ? given.optionId : null
      return result(1, choice === key.correctOptionId ? 1 : 0, choice !== null)
    }
    case 'true_false': {
      const answer = given?.questionType === 'true_false' ? given.answer : null
      return result(1, answer === key.answer ? 1 : 0, answer !== null)
    }
    case 'matching': {
      const chosen = new Map(
        given?.questionType === 'matching' ? given.pairs.map((p) => [p.promptId, p.choiceId]) : [],
      )
      const correct = key.pairs.filter((pair) => chosen.get(pair.promptId) === pair.choiceId)
      return result(key.pairs.length, correct.length, chosen.size > 0)
    }
    case 'gap_fill': {
      const values = new Map(
        given?.questionType === 'gap_fill' ? given.gaps.map((g) => [g.gapId, g.value]) : [],
      )
      const correct = key.gaps.filter((gap) =>
        accepts(gap.accepted, values.get(gap.gapId) ?? '', item.locale),
      )
      const answered = [...values.values()].some(
        (value) => normalizeShortAnswer(value, item.locale) !== '',
      )
      return result(key.gaps.length, correct.length, answered)
    }
    case 'ordering': {
      // TODO(beceri-siralama-puani): Domain "her madde ayrı puanlanır" diyor, maddeyi tanımlamıyor;
      // en muhafazakâr yorumla madde konumdur (doğru konumdaki öğe sayısı), komşu çift sayılmaz.
      const order = given?.questionType === 'ordering' ? given.order : []
      const correct = key.order.filter((id, index) => order[index] === id)
      return result(key.order.length, correct.length, order.length > 0)
    }
    case 'short_answer': {
      const value = given?.questionType === 'short_answer' ? given.value : ''
      return result(
        1,
        accepts(key.accepted, value, item.locale) ? 1 : 0,
        normalizeShortAnswer(value, item.locale) !== '',
      )
    }
    default:
      return key satisfies never
  }
}

export type AttemptScore = {
  /** Kazanılan puan, iki ondalığa yuvarlanmış gösterim değeri. */
  earned: number
  possible: number
  /** 100'lük puan, tam sayıya yuvarlanır. */
  percent: number
  /** Sıralama ve "en yüksek" karşılaştırması için yuvarlanmamış oran (0–1). */
  ratio: number
  items: ItemScore[]
}

/**
 * Denemenin puanı (DOM-BEC-010). Cevaplardan ve puanlama sürümünün anahtarından her okumada
 * hesaplanır, saklanmaz; anahtar düzeltilince (DOM-BEC-011) aynı cevaplar yeni anahtarla yeniden
 * okunur. Yanıtsız madde yanlıştır (DOM-BEC-043).
 */
export function scoreAttempt(items: readonly ScoringItem[], answers: Answers): AttemptScore {
  const scored = items.map((item) => scoreItem(item, answers[item.questionVersionId]))
  const possible = scored.reduce((total, item) => total + item.points, 0)
  const earned = scored.reduce((total, item) => total + item.earned, 0)
  const ratio = possible === 0 ? 0 : earned / possible
  return {
    earned: Math.round(earned * 100) / 100,
    possible,
    percent: Math.round(ratio * 100),
    ratio,
    items: scored,
  }
}

/** Bir alt becerinin sonucu (DOM-BEC-006); denemenin puanından türer, saklanmaz. */
export type SubskillScore = {
  subskill: Subskill
  /** Bu alt beceriyle etiketli madde sayısı. */
  items: number
  /** Kazanılan puan, iki ondalığa yuvarlanmış. */
  earned: number
  possible: number
  /** 100'lük puan, tam sayıya yuvarlanır. */
  percent: number
}

/**
 * Alt beceri dökümü (DOM-BEC-006; IST-042): madde puanları sorunun alt becerisine göre toplanır.
 * Her okumada denemenin puanından hesaplanır, saklanmaz; anahtar düzeltilince döküm de yeni
 * anahtarla okunur. Etiketsiz madde dökülmez (toplam puanda kalır); yalnız maddesi olan alt
 * beceriler, sözlük sırasıyla döner.
 */
export function subskillBreakdown(
  items: readonly ScoringItem[],
  score: AttemptScore,
): SubskillScore[] {
  const subskillOf = new Map(items.map((item) => [item.questionVersionId, item.subskill ?? null]))
  const totals = new Map<Subskill, { items: number; earned: number; possible: number }>()
  for (const item of score.items) {
    const subskill = subskillOf.get(item.questionVersionId) ?? null
    if (subskill === null) continue
    const total = totals.get(subskill) ?? { items: 0, earned: 0, possible: 0 }
    total.items += 1
    total.earned += item.earned
    total.possible += item.points
    totals.set(subskill, total)
  }
  return enumKeys(SUBSKILLS).flatMap((subskill) => {
    const total = totals.get(subskill)
    if (!total) return []
    const ratio = total.possible === 0 ? 0 : total.earned / total.possible
    return [
      {
        subskill,
        items: total.items,
        earned: Math.round(total.earned * 100) / 100,
        possible: total.possible,
        percent: Math.round(ratio * 100),
      },
    ]
  })
}

// --- Deneme ve süre -----------------------------------------------------------------------

/** `task_attempts` satırı. Başlangıç ve teslim sunucu saatidir (ADR 0004 karar 6). */
export type AttemptRow = {
  id: string
  startedAt: string
  submittedAt: string | null
  answers: Answers
}

/** Bireysel ek süre (DOM-BEC-043): gerekçesi kayıt geçmişinde görünür. */
export const extraTimeSchema = z.object({
  minutes: z
    .number()
    .int()
    .min(1, 'Ek süre en az 1 dakika olmalıdır.')
    .max(300, 'Ek süre en fazla 300 dakika olabilir.'),
  reason: z
    .string()
    .trim()
    .min(3, 'Ek süre gerekçesini yazın.')
    .max(1000, 'Gerekçe en fazla 1.000 karakter olabilir.'),
})
export type ExtraTime = z.output<typeof extraTimeSchema>

/** Denemenin süre bağlamı: içerik/atamadaki süre, kursiyerin ek süresi ve son teslim ayarı. */
export type AttemptTiming = {
  timeLimitMinutes: number | null
  extraMinutes: number
  deadline: Deadline
}

/**
 * Denemenin bittiği an (DOM-BEC-043): başlangıç + süre + bireysel ek süre; teslim kapanışından
 * sonraya taşmaz. Süresiz ve son tarihsiz denemede `null`.
 */
export function attemptEndsAt(startedAt: Instant, timing: AttemptTiming): string | null {
  const { closesAt } = submissionWindow(timing.deadline)
  const limit =
    timing.timeLimitMinutes === null
      ? null
      : toMs(startedAt) + (timing.timeLimitMinutes + timing.extraMinutes) * MINUTE
  const close = closesAt === null ? null : toMs(closesAt)
  if (limit === null) return close === null ? null : toIso(close)
  return toIso(close === null ? limit : Math.min(limit, close))
}

export type AttemptStatus = 'in_progress' | 'submitted' | 'expired'

export type AttemptState = {
  status: AttemptStatus
  endsAt: string | null
  /** Kalan süre (ms); süresiz veya bitmiş denemede `null`. */
  remainingMs: number | null
  /** Tamamlanma anı: teslim anı ya da süre dolduysa bitiş anı. */
  completedAt: string | null
  /** Süre dolduğu için kaydedilmiş cevaplarla teslim edilmiş sayılır. */
  autoSubmitted: boolean
}

/**
 * Denemenin durumu sunucu saatine göre (DOM-BEC-043). Bağlantı kopsa da süre işler: teslim
 * edilmemiş deneme bitiş anında (`now >= endsAt`) `expired` olur ve kaydedilmiş cevaplarla teslim
 * edilmiş sayılır.
 */
export function attemptState(
  attempt: AttemptRow,
  timing: AttemptTiming,
  now: Instant,
): AttemptState {
  const endsAt = attemptEndsAt(attempt.startedAt, timing)
  if (attempt.submittedAt !== null) {
    return {
      status: 'submitted',
      endsAt,
      remainingMs: null,
      completedAt: toIso(toMs(attempt.submittedAt)),
      autoSubmitted: false,
    }
  }
  if (endsAt !== null && toMs(now) >= toMs(endsAt)) {
    return {
      status: 'expired',
      endsAt,
      remainingMs: null,
      completedAt: endsAt,
      autoSubmitted: true,
    }
  }
  return {
    status: 'in_progress',
    endsAt,
    remainingMs: endsAt === null ? null : toMs(endsAt) - toMs(now),
    completedAt: null,
    autoSubmitted: false,
  }
}

export type AttemptStartInput = {
  rules: AttemptRules
  timing: AttemptTiming
  /** Kursiyerin bu atamadaki bütün denemeleri. */
  attempts: readonly AttemptRow[]
  now: Instant
}

/**
 * Yeni deneme (DOM-BEC-042, 043). Değerlendirmede başlatılmış her deneme hakkı tüketir; hakkı
 * biten kursiyer başlatamaz. Süren deneme varken ikinci deneme açılmaz (sürdürülür). Teslim
 * kapandıktan sonra deneme başlamaz.
 */
export function planAttemptStart(input: AttemptStartInput): {
  attemptNumber: number
  startedAt: string
  endsAt: string | null
} {
  const { rules, timing, attempts, now } = input
  assertSubmissionOpen(timing.deadline, now)
  if (attempts.some((a) => attemptState(a, timing, now).status === 'in_progress')) {
    throw new DomainError('attempt_in_progress', 'Süren bir denemeniz var; ona devam edin.', {
      kind: 'conflict',
    })
  }
  // TODO(beceri-deneme-sayimi): Domain "hakkı biten kursiyer yeni deneme başlatamaz" diyor,
  // terk edilen denemeyi tanımlamıyor; en muhafazakâr yorumla başlatılan her deneme hakkı tüketir.
  if (rules.kind === 'evaluation' && attempts.length >= rules.maxAttempts) {
    throw new DomainError('attempt_limit_reached', 'Deneme hakkınız doldu.', {
      path: ['attempts'],
    })
  }
  const startedAt = toIso(toMs(now))
  return { attemptNumber: attempts.length + 1, startedAt, endsAt: attemptEndsAt(startedAt, timing) }
}

function assertWritable(attempt: AttemptRow, timing: AttemptTiming, now: Instant): void {
  const state = attemptState(attempt, timing, now)
  if (state.status === 'submitted') {
    throw new DomainError('attempt_already_submitted', 'Bu deneme zaten teslim edildi.', {
      kind: 'conflict',
    })
  }
  if (state.status === 'expired') {
    throw new DomainError('attempt_time_over', 'Süre doldu; cevaplar kaydedilmedi.', {
      path: ['answers'],
    })
  }
}

export type AnswerSaveInput = {
  attempt: AttemptRow
  timing: AttemptTiming
  items: readonly ScoringItem[]
  /** Kaydedilecek cevaplar; yalnız gönderilen sorular güncellenir. */
  answers: Answers
  now: Instant
}

/** Süren denemeye cevap kaydı (DOM-BEC-043). Süre dolduysa reddedilir; dönen yeni cevap kümesidir. */
export function planAnswerSave(input: AnswerSaveInput): Answers {
  assertWritable(input.attempt, input.timing, input.now)
  assertResponsesFit(input.items, input.answers)
  return { ...input.attempt.answers, ...input.answers }
}

/**
 * Deneme teslimi (DOM-BEC-043). Süre dolmuşsa gönderilen cevaplar alınmaz; deneme bitiş anında
 * kaydedilmiş cevaplarla teslim edilir. Teslim edilmiş deneme ikinci kez teslim edilmez.
 */
export function planAttemptSubmit(
  input: Omit<AnswerSaveInput, 'answers'> & { answers?: Answers },
): {
  submittedAt: string
  answers: Answers
  autoSubmitted: boolean
} {
  const { attempt, timing, now } = input
  const state = attemptState(attempt, timing, now)
  if (state.status === 'expired' && state.endsAt !== null) {
    return { submittedAt: state.endsAt, answers: attempt.answers, autoSubmitted: true }
  }
  const answers = planAnswerSave({ ...input, answers: input.answers ?? {} })
  return { submittedAt: toIso(toMs(now)), answers, autoSubmitted: false }
}

export type CompletedAttempt = { id: string; completedAt: string; score: AttemptScore }

/**
 * Sayılan deneme (DOM-BEC-042): varsayılan ilk tamamlanan; "en yüksek" politikasında en yüksek
 * oran, eşitlikte önce tamamlanan. Alıştırma sayılan sonuç üretmez (DOM-BEC-041): not defterine ve
 * seviye kanıtına girmez, `null` döner. Saklanmaz, okunurken hesaplanır.
 */
export function countedAttempt(
  rules: AttemptRules,
  completed: readonly CompletedAttempt[],
): CompletedAttempt | null {
  if (rules.kind === 'practice') return null
  const ordered = [...completed].sort((a, b) => toMs(a.completedAt) - toMs(b.completedAt))
  if (rules.countPolicy === 'first') return ordered[0] ?? null
  return ordered.reduce<CompletedAttempt | null>(
    (best, attempt) => (best === null || attempt.score.ratio > best.score.ratio ? attempt : best),
    null,
  )
}

// --- Cevap ve geri bildirimin açılması ----------------------------------------------------

/**
 * Doğru cevaplar ve açıklamalar kursiyere açık mı (DOM-BEC-045). Alıştırmada kendi denemesi
 * biter bitmez; değerlendirmede son teslim ve geç kabul süresi bittikten sonra (kapanış anında
 * hâlâ teslim alındığı için kapalı).
 */
export function answerKeyReleased(input: {
  kind: TaskKind
  deadline: Deadline
  attemptCompleted: boolean
  now: Instant
}): boolean {
  if (input.kind === 'practice') return input.attemptCompleted
  const { closesAt } = submissionWindow(input.deadline)
  // TODO(beceri-suresiz-anahtar): Son tarihsiz değerlendirmede anahtarın açılma anı domain'de
  // yok; en muhafazakâr yorumla hiç açılmaz.
  return closesAt !== null && toMs(input.now) > toMs(closesAt)
}

/**
 * Kursiyerin (ve velisinin) sonuç görünümü (DOM-BEC-045): süren denemede hiçbir şey, tamamlanınca
 * yalnız toplam puan, anahtar açılınca madde sonuçları, doğru cevaplar ve açıklamalar. Madde bazında
 * doğru/yanlış da anahtarı sızdırdığı için (doğru/yanlış sorusu) anahtarla birlikte açılır.
 */
export function learnerResultLevel(input: {
  kind: TaskKind
  deadline: Deadline
  attempt: AttemptState
  now: Instant
}): 'none' | 'score' | 'full' {
  if (input.attempt.status === 'in_progress') return 'none'
  return answerKeyReleased({ ...input, attemptCompleted: true }) ? 'full' : 'score'
}

/** Öğretmen geri bildirimi puanlama tamamlanınca açılır (DOM-BEC-045). */
export function teacherFeedbackReleased(gradingCompletedAt: Instant | null, now: Instant): boolean {
  return gradingCompletedAt !== null && toMs(now) >= toMs(gradingCompletedAt)
}
