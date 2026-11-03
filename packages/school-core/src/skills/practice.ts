import { z } from 'zod'
import { DomainError } from '../lib/errors.ts'
import type { AnswerKey, ContentUnit } from '../content/resource.ts'
import { PRIMARY_SKILLS, type PrimarySkill } from '../content/taxonomy.ts'
import {
  planAnswerSave,
  responseSchema,
  scoreItem,
  type Answers,
  type AttemptRow,
  type AttemptScore,
  type AttemptTiming,
  type CompletedAttempt,
  type OutcomeRef,
  type ScoringItem,
  type TaskKind,
  type TaskResponse,
} from './scoring.ts'

/**
 * Ünite alıştırma seti (IST-056; docs/domain/beceri-gelisimi.md DOM-BEC-047, 048): alıştırmada
 * madde başına anında geri bildirim ve kontrol hakkı, alıştırma not defterinin ünite, beceri ve
 * kazanım kırılımı.
 *
 * Saf modüldür (ADR 0004 karar 2): girdi servisin yüklediği satırlardır (`attempt_item_checks`,
 * deneme cevapları, puanlama maddeleri); doğruluk, kalan hak ve kırılım saklanmaz, her okumada
 * kontrol edilen cevaptan ve puanlama sürümünün anahtarından hesaplanır (DOM-BEC-010).
 */

type Instant = Date | string
const toIso = (value: Instant) =>
  typeof value === 'string' ? new Date(Date.parse(value)).toISOString() : value.toISOString()

const identifier = z.string().trim().min(1, 'Bir soru seçin.').max(200)

// --- Anında geri bildirim -------------------------------------------------------------------

/**
 * Alıştırmada bir maddenin kontrol hakkı (DOM-BEC-047). Doğru cevap ya da hakkın bitmesi maddeyi
 * kilitler; kilitli maddenin doğru cevabı ve açıklaması açılır.
 */
export const ITEM_CHECK_LIMIT = 2

/** Kontrol isteği: tek madde ve cevabı. Cevap denemeye de kaydedilir. */
export const itemCheckInputSchema = z.strictObject({
  questionVersionId: identifier,
  response: responseSchema,
})
export type ItemCheckInput = z.output<typeof itemCheckInputSchema>

/** `attempt_item_checks` satırı: kontrol edilen cevap ve sırası (sunucu saati). */
export type ItemCheckRow = {
  questionVersionId: string
  checkNumber: number
  response: TaskResponse
  checkedAt: string
}

export type ItemFeedback = {
  questionVersionId: string
  /** Kullanılan ve kalan kontrol hakkı. */
  used: number
  remaining: number
  /** Son kontrol edilen cevap tam doğru mu (çok maddeli soruda bütün maddeler). */
  correct: boolean
  correctParts: number
  parts: number
  /** Doğru ya da hak bitti: cevap değişmez, anahtar açılır. */
  locked: boolean
  /** Yalnız kilitli maddede; diğer maddelerin anahtarı sızmaz (DOM-BEC-045, 047). */
  answerKey: AnswerKey | null
}

/** Nesne anahtarları sözlük sırasıyla dizilmiş JSON: jsonb anahtar sırasını korumaz. */
function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(',')}]`
  if (typeof value === 'object' && value !== null)
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${sortedJson(entry)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

/**
 * Cevabın sıra bağımsız karşılaştırma biçimi: eşleştirme ve boşluk listesi kimliğe göre dizilir,
 * nesne anahtarları sıralanır (kayıtlı kontrol veritabanından anahtar sırası değişmiş okunur).
 */
function canonical(response: TaskResponse): string {
  switch (response.questionType) {
    case 'matching':
      return sortedJson({
        ...response,
        pairs: [...response.pairs].sort((a, b) => a.promptId.localeCompare(b.promptId)),
      })
    case 'gap_fill':
      return sortedJson({
        ...response,
        gaps: [...response.gaps].sort((a, b) => a.gapId.localeCompare(b.gapId)),
      })
    case 'multiple_choice':
    case 'true_false':
    case 'ordering':
    case 'short_answer':
      return sortedJson(response)
    default:
      return response satisfies never
  }
}

function checksByItem(checks: readonly ItemCheckRow[]): Map<string, ItemCheckRow[]> {
  const byItem = new Map<string, ItemCheckRow[]>()
  for (const check of checks) {
    const list = byItem.get(check.questionVersionId) ?? []
    list.push(check)
    byItem.set(check.questionVersionId, list)
  }
  for (const list of byItem.values()) list.sort((a, b) => a.checkNumber - b.checkNumber)
  return byItem
}

function feedbackOf(item: ScoringItem, own: readonly ItemCheckRow[]): ItemFeedback | null {
  const last = own.at(-1)
  if (last === undefined) return null
  const score = scoreItem(item, last.response)
  const correct = score.parts > 0 && score.correctParts === score.parts
  const used = own.length
  const locked = correct || used >= ITEM_CHECK_LIMIT
  return {
    questionVersionId: item.questionVersionId,
    used,
    remaining: Math.max(0, ITEM_CHECK_LIMIT - used),
    correct,
    correctParts: score.correctParts,
    parts: score.parts,
    locked,
    answerKey: locked ? item.answerKey : null,
  }
}

/**
 * Denemenin madde geri bildirimi (DOM-BEC-047), madde sırasıyla; yalnız kontrol edilmiş maddeler.
 * Doğruluk son kontrol edilen cevaptan ve güncel puanlama anahtarından hesaplanır: anahtar
 * düzeltilince (DOM-BEC-011) geri bildirim de yeniden okunur.
 */
export function itemFeedback(
  items: readonly ScoringItem[],
  checks: readonly ItemCheckRow[],
): ItemFeedback[] {
  const byItem = checksByItem(checks)
  return items.flatMap((item) => {
    const feedback = feedbackOf(item, byItem.get(item.questionVersionId) ?? [])
    return feedback === null ? [] : [feedback]
  })
}

/** Kilitli maddelerin son kontrol edilen cevapları; kayıt ve teslim bunları değiştiremez. */
export function lockedAnswers(
  items: readonly ScoringItem[],
  checks: readonly ItemCheckRow[],
): Answers {
  const byItem = checksByItem(checks)
  const locked: Answers = {}
  for (const item of items) {
    const own = byItem.get(item.questionVersionId) ?? []
    const last = own.at(-1)
    if (last !== undefined && feedbackOf(item, own)?.locked)
      locked[item.questionVersionId] = last.response
  }
  return locked
}

/**
 * Kaydedilecek cevaplara kilitli maddelerin cevabını yazar (DOM-BEC-047): kilitli maddeye
 * gönderilen farklı cevap yok sayılır; otomatik kayıt kilitlenmeden önceki cevabı geri yazamaz.
 */
export function withLockedAnswers(
  answers: Answers,
  items: readonly ScoringItem[],
  checks: readonly ItemCheckRow[],
): Answers {
  return { ...answers, ...lockedAnswers(items, checks) }
}

export type ItemCheckPlan =
  { kind: 'new'; answers: Answers; check: ItemCheckRow } | { kind: 'duplicate' }

/**
 * Madde kontrolü (DOM-BEC-047): yalnız alıştırmada ve süren denemede. Cevap denemeye kaydedilir
 * (core `planAnswerSave`: teslim edilmiş deneme 409 `attempt_already_submitted`, süresi dolan 422
 * `attempt_time_over`, görevde olmayan soru ya da uyuşmayan cevap 422 `answer_invalid`) ve yeni
 * kontrol satırı açılır. Son kontrolle aynı cevap mükerrerdir: hak tüketmez, yeni satır açmaz.
 * Kilitli madde (doğru ya da hak bitti) 422 `item_check_locked`. Değerlendirme 422
 * `instant_feedback_unavailable`: anahtar teslim kapanmadan açılmaz (DOM-BEC-045).
 */
export function planItemCheck(input: {
  kind: TaskKind
  attempt: AttemptRow
  timing: AttemptTiming
  items: readonly ScoringItem[]
  checks: readonly ItemCheckRow[]
  check: ItemCheckInput
  now: Instant
}): ItemCheckPlan {
  if (input.kind !== 'practice') {
    throw new DomainError(
      'instant_feedback_unavailable',
      'Anında geri bildirim yalnız alıştırmada kullanılır.',
    )
  }
  const { questionVersionId, response } = input.check
  const answers = planAnswerSave({
    attempt: input.attempt,
    timing: input.timing,
    items: input.items,
    answers: { [questionVersionId]: response },
    now: input.now,
  })
  const own = checksByItem(input.checks).get(questionVersionId) ?? []
  const last = own.at(-1)
  if (last !== undefined && canonical(last.response) === canonical(response)) {
    return { kind: 'duplicate' }
  }
  const item = input.items.find((entry) => entry.questionVersionId === questionVersionId)
  if (item !== undefined && feedbackOf(item, own)?.locked) {
    throw new DomainError(
      'item_check_locked',
      'Bu sorunun kontrol hakkı bitti; cevap kilitlendi.',
      {
        path: ['questionVersionId'],
      },
    )
  }
  return {
    kind: 'new',
    answers: withLockedAnswers(answers, input.items, input.checks),
    check: {
      questionVersionId,
      checkNumber: own.length + 1,
      response,
      checkedAt: toIso(input.now),
    },
  }
}

// --- Alıştırma not defteri ----------------------------------------------------------------

/**
 * Alıştırmanın not defterinde gösterilen denemesi (DOM-BEC-048): son tamamlanan. Alıştırmada
 * sayılan deneme yoktur (DOM-BEC-041, 042); eşitlikte kimlik sırası belirler.
 */
export function practiceShownAttempt(
  completed: readonly CompletedAttempt[],
): CompletedAttempt | null {
  return completed.reduce<CompletedAttempt | null>((latest, attempt) => {
    if (latest === null) return attempt
    const diff = Date.parse(attempt.completedAt) - Date.parse(latest.completedAt)
    return diff > 0 || (diff === 0 && attempt.id > latest.id) ? attempt : latest
  }, null)
}

/** Bir kırılım hücresi: madde sayısı, kazanılan ve olası puan, 100'lük puan (saklanmaz). */
export type GradebookTally = { items: number; earned: number; possible: number; percent: number }

type Sum = { items: number; earned: number; possible: number }
const emptySum = (): Sum => ({ items: 0, earned: 0, possible: 0 })
const tallyOf = (sum: Sum): GradebookTally => ({
  items: sum.items,
  earned: Math.round(sum.earned * 100) / 100,
  possible: sum.possible,
  percent: sum.possible === 0 ? 0 : Math.round((sum.earned / sum.possible) * 100),
})

/** Kursiyerin bir alıştırmadaki gösterilen sonucu ve setin ünitesi. */
export type PracticeResult = {
  learnerId: string
  assignmentId: string
  unit: ContentUnit | null
  items: readonly ScoringItem[]
  score: AttemptScore
}

export type UnitTally = GradebookTally & { number: number; title: string | null; sets: number }
export type SkillTally = GradebookTally & { skill: PrimarySkill }
export type OutcomeTally = GradebookTally & OutcomeRef

export type GradebookBreakdown = {
  sets: number
  overall: GradebookTally
  units: UnitTally[]
  skills: SkillTally[]
  outcomes: OutcomeTally[]
}

class Accumulator {
  sets = 0
  overall = emptySum()
  units = new Map<number, Sum & { title: string | null; sets: number }>()
  skills = new Map<PrimarySkill, Sum>()
  outcomes = new Map<string, Sum & OutcomeRef>()

  add(result: PracticeResult) {
    this.sets += 1
    const itemsOf = new Map(result.items.map((item) => [item.questionVersionId, item]))
    const set = emptySum()
    for (const scored of result.score.items) {
      const item = itemsOf.get(scored.questionVersionId)
      const part = { items: 1, earned: scored.earned, possible: scored.points }
      addTo(set, part)
      const skill = item?.skill ?? null
      if (skill !== null) {
        const sum = this.skills.get(skill) ?? emptySum()
        addTo(sum, part)
        this.skills.set(skill, sum)
      }
      for (const outcome of item?.outcomes ?? []) {
        const key = `${outcome.outcomeSource}:${outcome.outcomeId}`
        const sum = this.outcomes.get(key) ?? { ...emptySum(), ...outcome }
        addTo(sum, part)
        this.outcomes.set(key, sum)
      }
    }
    addTo(this.overall, set)
    if (result.unit !== null) {
      const unit = this.units.get(result.unit.number) ?? {
        ...emptySum(),
        title: null,
        sets: 0,
      }
      addTo(unit, set)
      unit.sets += 1
      unit.title ??= result.unit.title
      this.units.set(result.unit.number, unit)
    }
  }

  view(): GradebookBreakdown {
    return {
      sets: this.sets,
      overall: tallyOf(this.overall),
      units: [...this.units.entries()]
        .sort(([a], [b]) => a - b)
        .map(([number, sum]) => ({ number, title: sum.title, sets: sum.sets, ...tallyOf(sum) })),
      skills: PRIMARY_SKILLS.flatMap((skill) => {
        const sum = this.skills.get(skill)
        return sum === undefined ? [] : [{ skill, ...tallyOf(sum) }]
      }),
      outcomes: [...this.outcomes.values()]
        .sort(
          (a, b) =>
            a.outcomeSource.localeCompare(b.outcomeSource) ||
            a.outcomeId.localeCompare(b.outcomeId),
        )
        .map((sum) => ({
          outcomeSource: sum.outcomeSource,
          outcomeId: sum.outcomeId,
          ...tallyOf(sum),
        })),
    }
  }
}

function addTo(target: Sum, part: Sum) {
  target.items += part.items
  target.earned += part.earned
  target.possible += part.possible
}

/**
 * Alıştırma not defteri (DOM-BEC-048; IST-056): kursiyer başına ve sınıf toplamında ünite, beceri
 * ve kazanım kırılımı. Hücre puanı madde puanlarının toplamından hesaplanır (ağırlık madde
 * puanıdır, set ortalaması değil); ünite setin, beceri ve kazanım maddenin etiketidir. Etiketsiz
 * madde ve ünitesiz set yalnız genel toplamda kalır. Saklanmaz; kursiyerler kimlik sırasıyla döner.
 */
export function practiceGradebook(results: readonly PracticeResult[]): {
  learners: (GradebookBreakdown & { learnerId: string })[]
  totals: GradebookBreakdown
} {
  const totals = new Accumulator()
  const learners = new Map<string, Accumulator>()
  for (const result of results) {
    totals.add(result)
    const own = learners.get(result.learnerId) ?? new Accumulator()
    own.add(result)
    learners.set(result.learnerId, own)
  }
  return {
    learners: [...learners.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([learnerId, own]) => ({ learnerId, ...own.view() })),
    totals: totals.view(),
  }
}
