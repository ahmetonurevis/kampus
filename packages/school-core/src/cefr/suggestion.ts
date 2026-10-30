import { z } from 'zod'
import { DomainError } from '../lib/errors.ts'
import { dayKey } from '../lib/format.ts'
import { linkedRecordId, type Actor } from '../lib/scope.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import {
  CEFR_LEVELS,
  PRIMARY_SKILLS,
  SKILLS,
  enumKeys,
  type CefrLevel,
  type PrimarySkill,
} from '../content/taxonomy.ts'
import type { AttemptScore, TaskKind } from '../skills/scoring.ts'
import type { RubricResult } from '../skills/rubric.ts'

/**
 * CEFR seviye önerisi: kanıt seçimi, beceri bazlı öneri, genel öneri ve gösterim modeli
 * (docs/domain/beceri-gelisimi.md DOM-BEC-030…034; ADR 0004 karar 5, 8, 11).
 *
 * Öneri saklanmaz; her okumada servisin yüklediği puanlanmış sonuçlardan `now`'a göre hesaplanır
 * ve aynı girdi aynı öneriyi verir (DOM-BEC-030). Saklanan tek şey karar anının kopyasıdır:
 * `level_decisions.evidence_snapshot` (`evidenceSnapshotSchema`). Kopya yalnız gerekçe olarak
 * gösterilir, başka bir hesabın girdisi olmaz.
 *
 * Puan girdisi F4a'nın çıktısıdır: otomatik görevde sayılan denemenin `scoreAttempt` sonucu
 * (`skills/scoring.ts` `countedAttempt`), rubrikli görevde kesinleşmiş puanın `rubricScore`
 * sonucu (`skills/rubric.ts` `scoreResolution`). Sonucu seçmek servisin işidir; burada her görev
 * için kursiyer başına tek sonuç beklenir.
 *
 * Zaman kuralları:
 * - Pencere `now`'dan geriye sayılır ve sonucun gerçekleştiği andan (`performedAt`: denemenin
 *   tamamlanması, teslim sürümünün gönderimi, tespit oturumunun bitişi) başlar. Bitiş anı
 *   hariçtir: tam `performedAt + pencere` anında kanıt geçersizdir (en muhafazakâr yorum).
 * - Gün farkı Europe/Istanbul takvim gününe göre sayılır (`lib/format` `dayKey`).
 */

z.config(z.locales.tr())

type Instant = Date | string
const toMs = (value: Instant) => (typeof value === 'string' ? Date.parse(value) : value.getTime())
const toIso = (ms: number) => new Date(ms).toISOString()
const DAY = 24 * 60 * 60_000

const identifier = z.string().trim().min(1, 'Bir kayıt seçin.').max(200)
const instant = z.iso.datetime({ error: 'Geçerli bir tarih ve saat girin.' })
const cefrLevel = z.enum(enumKeys(CEFR_LEVELS))
const primarySkill = z.enum(PRIMARY_SKILLS)

// --- Sabitler -----------------------------------------------------------------------------

/**
 * Kanıtın geçerlilik penceresi, gün (DOM-BEC-031, DOM-DIL-012). v1'de sabittir; kurum
 * değiştiremez, böylece kurumlar arası rapor karşılaştırılabilir kalır.
 */
export const EVIDENCE_WINDOW_DAYS = { task: 120, placement: 90 } as const

/** Başarı eşikleri (DOM-BEC-031). */
export const SUCCESS_RULES = {
  /** Otomatik görevde doğru oranı en az %70. */
  autoPercent: 70,
  /** Rubrikli görevde bant ortalaması en az 3. */
  rubricMeanBand: 3,
  /** Rubrikli görevde bu bant veya altındaki tek kriter başarıyı düşürür. */
  rubricFailingBand: 1,
} as const

/** Bir seviyenin gösterilmesi (DOM-BEC-032). */
export const DEMONSTRATION_RULES = {
  minEvidence: 3,
  minDays: 2,
  /** Başarılı kanıt payı en az 2/3. */
  successShare: { numerator: 2, denominator: 3 },
  /** Okuma ve dinlemede kanıtlardaki toplam madde sayısı alt sınırı. */
  minItems: 10,
  /** Artı seviye için bir sonraki ana seviyedeki başarılı kanıt sayısı. */
  plusSuccesses: 2,
} as const

/** Madde sayısı koşulu olan beceriler (DOM-BEC-032). */
export const ITEM_COUNTED_SKILLS = [
  'reading',
  'listening',
] as const satisfies readonly PrimarySkill[]

/** Genel öneriye giren dört beceri (DOM-BEC-033); taksonomideki `core` grubu. */
export const CORE_SKILLS = PRIMARY_SKILLS.filter((skill) => SKILLS[skill].group === 'core')
/** Ayrı gösterilen, genel öneriye girmeyen beceriler: aracılık ve dil kullanımı (DOM-BEC-033). */
export const SEPARATE_SKILLS = PRIMARY_SKILLS.filter((skill) => SKILLS[skill].group !== 'core')

/** Ekranda önerinin adı (DOM-BEC-034). */
export const ESTIMATE_LABEL = 'Tahmini seviye'

/** Seviyeler sıralı; anahtar ve sıra taksonomiden gelir (DOM-BEC-032). */
const LEVELS_BY_RANK = enumKeys(CEFR_LEVELS).sort(
  (a, b) => CEFR_LEVELS[a].rank - CEFR_LEVELS[b].rank,
)
const isCefrLevel = (value: string): value is CefrLevel => value in CEFR_LEVELS
const rankOf = (level: CefrLevel) => CEFR_LEVELS[level].rank

/**
 * Artısı olan ana seviyenin artısı ve bir sonraki ana seviyesi (A2 → A2+, B1; B1 → B1+, B2;
 * B2 → B2+, C1). Artısı olmayan seviyede `null`.
 */
export function plusStepOf(level: CefrLevel): { plus: CefrLevel; nextMain: CefrLevel } | null {
  const plus = `${level}+`
  if (!isCefrLevel(plus)) return null
  const nextMain = LEVELS_BY_RANK[rankOf(plus) + 1]
  return nextMain === undefined ? null : { plus, nextMain }
}

// --- Kanıt adayı ve seçimi ----------------------------------------------------------------

/** Kanıtın kaynağı: atanmış görev veya seviye tespit oturumunun bölümü. */
export const EVIDENCE_SOURCES = {
  task: { label: 'Görev' },
  placement: { label: 'Seviye tespiti' },
} as const
export type EvidenceSource = keyof typeof EVIDENCE_SOURCES

/** Puanlanmış sonuç: sayılan denemenin puanı veya kesinleşmiş rubrik puanı. */
export type EvidenceResult =
  | { mode: 'auto'; score: Pick<AttemptScore, 'ratio' | 'percent' | 'items'> }
  | { mode: 'rubric'; score: Pick<RubricResult, 'percent' | 'criteria'> }

/** Servisin yüklediği aday: bir kursiyerin bir görevdeki (veya tespit bölümündeki) sonucu. */
export type EvidenceCandidate = {
  /** Sonuç kimliği: deneme, teslim sürümü veya tespit bölümünün sonucu. */
  id: string
  /** Görev (atama) veya tespit bölümü kimliği; kursiyer başına tekildir. */
  taskId: string
  title: string
  source: EvidenceSource
  kind: TaskKind
  /** Uzaktan yapılan seviye tespiti (ön tespit, DOM-DIL-011); görevde `false`. */
  preliminary: boolean
  skill: PrimarySkill | null
  targetLevel: CefrLevel | null
  /** Sonucun gerçekleştiği sunucu anı; pencere ve gün sayımı buna göredir. */
  performedAt: string
  /** İtirazı süren sonuç kanıt değildir (DOM-BEC-031, 025). */
  appealPending: boolean
  /** Puanlanmamışsa `null`. */
  result: EvidenceResult | null
}

/** Kanıt dışı bırakılma nedenleri (DOM-BEC-031). Sıra denetim sırasıdır. */
export const EXCLUSION_REASONS = {
  practice: { label: 'Alıştırma kanıt sayılmaz.' },
  preliminary: { label: 'Uzaktan ön tespit kanıt sayılmaz.' },
  no_skill: { label: 'Görevin birincil becerisi yok.' },
  no_target_level: { label: 'Görevin hedef seviyesi yok.' },
  unscored: { label: 'Sonuç henüz puanlanmadı.' },
  appeal_pending: { label: 'Sonuca itiraz sürüyor.' },
  not_yet: { label: 'Sonuç bu andan sonra.' },
  expired: { label: 'Geçerlilik süresi doldu.' },
} as const
export type ExclusionReason = keyof typeof EXCLUSION_REASONS

export type Evidence = {
  id: string
  taskId: string
  title: string
  source: EvidenceSource
  skill: PrimarySkill
  targetLevel: CefrLevel
  performedAt: string
  /** Europe/Istanbul günü (`YYYY-MM-DD`); "farklı gün" koşulu bununla sayılır. */
  day: string
  /** Geçerliliğin bittiği an (hariç). */
  expiresAt: string
  successful: boolean
  percent: number
  /** Otomatik görevde puanlanan madde sayısı (`ItemScore.parts` toplamı); rubrikte `null`. */
  items: number | null
}
export type ExcludedEvidence = {
  id: string
  taskId: string
  title: string
  reason: ExclusionReason
}

/** Rubrik sonucunun başarısı (DOM-BEC-031): bant ortalaması ≥ 3 ve hiçbir kriter ≤ 1. */
// TODO(cefr-agirlikli-ortalama): Domain "bantların ortalaması" diyor, ağırlığı anmıyor; en
// muhafazakâr yorumla hem düz hem ağırlıklı ortalama 3'e ulaşmalı.
function rubricSuccessful(criteria: RubricResult['criteria']): boolean {
  if (criteria.length === 0) return false
  const bandSum = criteria.reduce((sum, c) => sum + c.band, 0)
  const weighted = criteria.reduce((sum, c) => sum + c.band * c.weight, 0)
  const weights = criteria.reduce((sum, c) => sum + c.weight, 0)
  return (
    bandSum >= SUCCESS_RULES.rubricMeanBand * criteria.length &&
    weighted >= SUCCESS_RULES.rubricMeanBand * weights &&
    criteria.every((c) => c.band > SUCCESS_RULES.rubricFailingBand)
  )
}

/** Sonucun başarısı (DOM-BEC-031). Oran yuvarlanmadan karşılaştırılır; %69,5 başarısızdır. */
export function resultSuccessful(result: EvidenceResult): boolean {
  if (result.mode === 'rubric') return rubricSuccessful(result.score.criteria)
  // Kayan nokta toplamındaki son basamak hatası (0,7 → 0,69999…) eşiği kaydırmasın.
  return result.score.ratio * 100 + 1e-9 >= SUCCESS_RULES.autoPercent
}

function exclusionReason(candidate: EvidenceCandidate, nowMs: number): ExclusionReason | null {
  if (candidate.kind === 'practice') return 'practice'
  if (candidate.preliminary) return 'preliminary'
  if (candidate.skill === null) return 'no_skill'
  if (candidate.targetLevel === null) return 'no_target_level'
  if (candidate.result === null) return 'unscored'
  if (candidate.appealPending) return 'appeal_pending'
  const performed = toMs(candidate.performedAt)
  if (performed > nowMs) return 'not_yet'
  if (nowMs >= performed + EVIDENCE_WINDOW_DAYS[candidate.source] * DAY) return 'expired'
  return null
}

/**
 * Kanıt seçimi (DOM-BEC-031): değerlendirme türündeki, birincil becerisi ve hedef seviyesi olan,
 * puanlanmış, itirazı sürmeyen ve pencere içindeki sonuçlar. Alıştırma ve uzaktan ön tespit
 * kanıt değildir. Dışarıda kalanlar nedeniyle listelenir; ekran önerinin neye dayanmadığını da
 * gösterebilir. Aynı görevin ikinci sonucu servis hatasıdır, reddedilir.
 */
export function selectEvidence(
  candidates: readonly EvidenceCandidate[],
  now: Instant,
): { evidence: Evidence[]; excluded: ExcludedEvidence[] } {
  const nowMs = toMs(now)
  const seen = new Set<string>()
  const evidence: Evidence[] = []
  const excluded: ExcludedEvidence[] = []
  for (const candidate of candidates) {
    if (seen.has(candidate.taskId)) {
      throw new DomainError(
        'duplicate_evidence',
        'Bir görev için kursiyer başına tek sonuç kanıt olabilir.',
        { kind: 'conflict', path: ['candidates', candidate.taskId] },
      )
    }
    seen.add(candidate.taskId)
    const reason = exclusionReason(candidate, nowMs)
    const { skill, targetLevel, result } = candidate
    if (reason !== null || skill === null || targetLevel === null || result === null) {
      excluded.push({
        id: candidate.id,
        taskId: candidate.taskId,
        title: candidate.title,
        reason: reason ?? 'unscored',
      })
      continue
    }
    const performed = toMs(candidate.performedAt)
    evidence.push({
      id: candidate.id,
      taskId: candidate.taskId,
      title: candidate.title,
      source: candidate.source,
      skill,
      targetLevel,
      performedAt: toIso(performed),
      day: dayKey(performed),
      expiresAt: toIso(performed + EVIDENCE_WINDOW_DAYS[candidate.source] * DAY),
      successful: resultSuccessful(result),
      percent: result.score.percent,
      items:
        result.mode === 'auto'
          ? result.score.items.reduce((sum, item) => sum + item.parts, 0)
          : null,
    })
  }
  return { evidence, excluded }
}

// --- Beceri ve genel öneri ----------------------------------------------------------------

/** Bir becerinin bir seviyedeki kanıt özeti. */
export type LevelTally = {
  level: CefrLevel
  evidence: number
  successful: number
  days: number
  items: number
  demonstrated: boolean
  /**
   * Gösterilme için gereken en az ek kanıt (her biri başarılı ve yeni bir günde varsayılarak).
   * Madde eksiği ayrıca `missingItems`'tadır.
   */
  missingEvidence: number
  /** Okuma ve dinlemede eksik madde sayısı; diğer becerilerde 0. */
  missingItems: number
}

export type SkillSuggestion =
  | {
      status: 'suggested'
      skill: PrimarySkill
      level: CefrLevel
      /** Gösterilmiş en yüksek seviye; artı uygulanmışsa `level`'ın bir altı. */
      demonstratedLevel: CefrLevel
      plus: boolean
      /** Önerinin dayandığı kanıtlar (DOM-BEC-034). */
      evidenceIds: string[]
      levels: LevelTally[]
    }
  | {
      status: 'insufficient'
      skill: PrimarySkill
      /** Herhangi bir seviyenin gösterilmesi için gereken en az ek kanıt (DOM-BEC-032). */
      missingEvidence: number
      missingItems: number
      evidenceIds: string[]
      levels: LevelTally[]
    }

export type OverallSuggestion =
  | { status: 'suggested'; level: CefrLevel }
  | { status: 'insufficient'; missingSkills: PrimarySkill[] }

export type CefrSuggestion = {
  computedAt: string
  skills: Record<PrimarySkill, SkillSuggestion>
  overall: OverallSuggestion
  evidence: Evidence[]
  excluded: ExcludedEvidence[]
}

const itemCounted = (skill: PrimarySkill) =>
  (ITEM_COUNTED_SKILLS as readonly PrimarySkill[]).includes(skill)

function tally(skill: PrimarySkill, level: CefrLevel, list: readonly Evidence[]): LevelTally {
  const rules = DEMONSTRATION_RULES
  const evidence = list.length
  const successful = list.filter((e) => e.successful).length
  const days = new Set(list.map((e) => e.day)).size
  const items = list.reduce((sum, e) => sum + (e.items ?? 0), 0)
  const { numerator, denominator } = rules.successShare
  const missingItems = itemCounted(skill) ? Math.max(0, rules.minItems - items) : 0
  // k ek başarılı kanıtla: c + k ≥ 3, d + k ≥ 2 ve (s + k) / (c + k) ≥ 2/3.
  const missingEvidence = Math.max(
    0,
    rules.minEvidence - evidence,
    rules.minDays - days,
    Math.ceil((numerator * evidence - denominator * successful) / (denominator - numerator)),
  )
  return {
    level,
    evidence,
    successful,
    days,
    items,
    demonstrated: missingEvidence === 0 && missingItems === 0,
    missingEvidence,
    missingItems,
  }
}

/**
 * Beceri önerisi (DOM-BEC-032): gösterilmiş en yüksek seviye. Gösterilen seviye A2, B1 veya B2
 * ise ve bir sonraki ana seviyede (B1, B2, C1) gösterilmeden en az 2 başarılı kanıt varsa öneri
 * artı seviyedir. Artı seviyeyi hedefleyen kanıt bir sonraki ana seviyeye sayılmaz. Hiçbir seviye
 * gösterilmemişse öneri yetersiz kanıttır; seviye tahmini yapılmaz, eksik kanıt sayısı verilir.
 */
export function suggestSkillLevel(
  skill: PrimarySkill,
  evidence: readonly Evidence[],
): SkillSuggestion {
  const own = evidence.filter((e) => e.skill === skill)
  const byLevel = new Map<CefrLevel, Evidence[]>()
  for (const entry of own)
    byLevel.set(entry.targetLevel, [...(byLevel.get(entry.targetLevel) ?? []), entry])
  const levels = LEVELS_BY_RANK.filter((level) => byLevel.has(level)).map((level) =>
    tally(skill, level, byLevel.get(level) ?? []),
  )
  const demonstrated = levels.filter((t) => t.demonstrated).at(-1)
  if (demonstrated === undefined) {
    // Hiç kanıt yoksa ilk seviyenin bütün eşiği eksiktir.
    const closest = [...levels].sort(
      (a, b) => a.missingEvidence - b.missingEvidence || a.missingItems - b.missingItems,
    )[0]
    return {
      status: 'insufficient',
      skill,
      missingEvidence: closest?.missingEvidence ?? DEMONSTRATION_RULES.minEvidence,
      missingItems:
        closest?.missingItems ?? (itemCounted(skill) ? DEMONSTRATION_RULES.minItems : 0),
      evidenceIds: own.map((e) => e.id),
      levels,
    }
  }
  const step = plusStepOf(demonstrated.level)
  const nextSuccesses =
    step === null ? [] : (byLevel.get(step.nextMain) ?? []).filter((e) => e.successful)
  const plus = step !== null && nextSuccesses.length >= DEMONSTRATION_RULES.plusSuccesses
  const base = byLevel.get(demonstrated.level) ?? []
  return {
    status: 'suggested',
    skill,
    level: plus ? step.plus : demonstrated.level,
    demonstratedLevel: demonstrated.level,
    plus,
    evidenceIds: [...base, ...(plus ? nextSuccesses : [])].map((e) => e.id),
    levels,
  }
}

/**
 * Genel öneri (DOM-BEC-033): yalnız dört becerinin hepsinde öneri varsa; dört öneri sıralanır,
 * ikinci en düşük değer genel öneridir. Aracılık ve dil kullanımı girmez.
 */
export function overallSuggestion(
  skills: Readonly<Record<PrimarySkill, SkillSuggestion>>,
): OverallSuggestion {
  const core = CORE_SKILLS.map((skill) => skills[skill])
  const missingSkills = core.filter((s) => s.status !== 'suggested').map((s) => s.skill)
  const ranks = core
    .flatMap((s) => (s.status === 'suggested' ? [s.level] : []))
    .sort((a, b) => rankOf(a) - rankOf(b))
  const level = ranks[1]
  if (missingSkills.length > 0 || level === undefined)
    return { status: 'insufficient', missingSkills }
  return { status: 'suggested', level }
}

/**
 * Bir kursiyerin bütün önerisi (DOM-BEC-030…033): kanıt seçimi, her birincil beceride öneri ve
 * genel öneri. Saftır ve saklanmaz; aynı aday listesi ve `now` aynı sonucu verir.
 */
export function suggestCefrLevels(input: {
  candidates: readonly EvidenceCandidate[]
  now: Instant
}): CefrSuggestion {
  const { evidence, excluded } = selectEvidence(input.candidates, input.now)
  const skills = Object.fromEntries(
    PRIMARY_SKILLS.map((skill) => [skill, suggestSkillLevel(skill, evidence)]),
  ) as Record<PrimarySkill, SkillSuggestion>
  return {
    computedAt: toIso(toMs(input.now)),
    skills,
    overall: overallSuggestion(skills),
    evidence,
    excluded,
  }
}

// --- Karar anının kopyası -----------------------------------------------------------------

/**
 * `level_decisions.evidence_snapshot` biçimi (ADR 0004 karar 5, 8; DOM-BEC-030). Kararın
 * parçasıdır, sonradan değişmez; yalnız gerekçe olarak gösterilir. Kişisel veri olarak kanıt
 * kimliği, görev adı ve puan yüzdesi taşır.
 */
export const evidenceSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  computedAt: instant,
  overall: z.discriminatedUnion('status', [
    z.object({ status: z.literal('suggested'), level: cefrLevel }),
    z.object({ status: z.literal('insufficient'), missingSkills: z.array(primarySkill) }),
  ]),
  skills: z
    .array(
      z.object({
        skill: primarySkill,
        status: z.enum(['suggested', 'insufficient']),
        level: cefrLevel.nullable(),
        plus: z.boolean(),
        missingEvidence: z.number().int().min(0),
        evidenceIds: z.array(identifier),
      }),
    )
    .refine((list) => new Set(list.map((s) => s.skill)).size === list.length, {
      error: 'Her beceri bir kez yer alır.',
    }),
  // kvkk: K
  evidence: z.array(
    z.object({
      id: identifier,
      taskId: identifier,
      title: z.string().max(500),
      source: z.enum(enumKeys(EVIDENCE_SOURCES)),
      skill: primarySkill,
      targetLevel: cefrLevel,
      performedAt: instant,
      successful: z.boolean(),
      percent: z.number().int().min(0).max(100),
      items: z.number().int().min(0).nullable(),
    }),
  ),
})
export type EvidenceSnapshot = z.output<typeof evidenceSnapshotSchema>

/** Önerinin karar anındaki kopyası; şemadan geçirilir, böylece yazılan biçim sabittir. */
export function evidenceSnapshotOf(suggestion: CefrSuggestion): EvidenceSnapshot {
  return evidenceSnapshotSchema.parse({
    schemaVersion: 1,
    computedAt: suggestion.computedAt,
    overall: suggestion.overall,
    skills: PRIMARY_SKILLS.map((skill) => {
      const s = suggestion.skills[skill]
      return {
        skill,
        status: s.status,
        level: s.status === 'suggested' ? s.level : null,
        plus: s.status === 'suggested' && s.plus,
        missingEvidence: s.status === 'suggested' ? 0 : s.missingEvidence,
        evidenceIds: s.evidenceIds,
      }
    }),
    evidence: suggestion.evidence.map((e) => ({
      id: e.id,
      taskId: e.taskId,
      title: e.title,
      source: e.source,
      skill: e.skill,
      targetLevel: e.targetLevel,
      performedAt: e.performedAt,
      successful: e.successful,
      percent: e.percent,
      items: e.items,
    })),
  })
}

// --- İnsan kararları ve gösterim ----------------------------------------------------------

/** `level_decisions.kind` (ADR 0004 karar 8). */
export const LEVEL_DECISION_KINDS = {
  placement: { label: 'Yerleştirme' },
  progression: { label: 'Kur geçişi' },
  correction: { label: 'Düzeltme' },
} as const
export type LevelDecisionKind = keyof typeof LEVEL_DECISION_KINDS

/** `level_decisions` satırı: profili değiştiren insan kararı. `skill: null` genel seviyedir. */
export type LevelDecisionRow = {
  id: string
  kind: LevelDecisionKind
  skill: PrimarySkill | null
  level: CefrLevel
  // kvkk: K
  rationale: string
  // kvkk: K
  decidedByUserId: string
  decidedAt: string
  evidenceSnapshot: EvidenceSnapshot
}

/** Profili görebilen roller (IST-060: koordinatör, öğretmen, öğrenci, veli). */
// TODO(cefr-profil-kapsam): Öğretmenin hangi kursiyerleri gördüğü (sınıf/grup) `lib/scope.ts`
// `scopeFor` ile serviste daraltılır; burada yalnız rol ve öğrenci/veli bağlantısı denetlenir.
export function canViewCefrProfile(actor: Actor, learnerId: string): boolean {
  switch (actor.role) {
    case 'yonetici':
    case 'ogretmen':
      return true
    case 'ogrenci':
      return linkedRecordId(actor, 'student') === learnerId
    case 'veli':
      return actor.links.some((link) => link.kind === 'child' && link.recordId === learnerId)
    case 'onburo':
      return false
    default:
      return actor.role satisfies never
  }
}

export type SkillEstimate = {
  skill: PrimarySkill
  label: string
  /** Genel öneriye girer mi (DOM-BEC-033). */
  core: boolean
  suggestion: SkillSuggestion
}

export type CefrProfileView = {
  /** `school`'da "Kurum içi beceri profili" (DOM-BEC-060); `language_school`'da CEFR profili. */
  title: string
  /** Öneri: karar değildir, kuru/grubu/notu değiştirmez (DOM-BEC-034). */
  estimate: {
    label: typeof ESTIMATE_LABEL
    overall: OverallSuggestion
    skills: SkillEstimate[]
    evidence: Evidence[]
    excluded: ExcludedEvidence[]
  }
  /**
   * İnsan kararları, öneriden ayrı. Beceri başına (genel için `null`) en yeni karar ve bütün
   * geçmiş en yeniden eskiye. `school`'da seviye kararı yoktur (DOM-YTK-012), alan `null`dır.
   */
  decisions: {
    current: { skill: PrimarySkill | null; decision: LevelDecisionRow }[]
    history: LevelDecisionRow[]
  } | null
}

const newestFirst = (a: LevelDecisionRow, b: LevelDecisionRow) =>
  toMs(b.decidedAt) - toMs(a.decidedAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)

/**
 * Profil ekranının modeli (DOM-BEC-034): "Tahmini seviye" ve dayandığı kanıtlar ile insan
 * kararları ayrı alanlardır; öneri kararın yerine geçmez. Görüntü tek kursiyerindir, başka
 * kursiyerlerle sıralama içermez (DOM-DIL-094). Okulda öneri hesaplanır ama "kurum içi beceri
 * profili" adıyla gösterilir ve karnede/resmî belgede yer almaz (DOM-BEC-060).
 */
export function cefrProfileView(input: {
  institutionType: InstitutionType
  suggestion: CefrSuggestion
  decisions: readonly LevelDecisionRow[]
}): CefrProfileView {
  const { suggestion } = input
  const school = input.institutionType === 'school'
  const history = school ? [] : [...input.decisions].sort(newestFirst)
  const current = new Map<PrimarySkill | null, LevelDecisionRow>()
  for (const decision of history)
    if (!current.has(decision.skill)) current.set(decision.skill, decision)
  return {
    title: school ? 'Kurum içi beceri profili' : 'CEFR profili',
    estimate: {
      label: ESTIMATE_LABEL,
      overall: suggestion.overall,
      skills: PRIMARY_SKILLS.map((skill) => ({
        skill,
        label: SKILLS[skill].label,
        core: (CORE_SKILLS as readonly PrimarySkill[]).includes(skill),
        suggestion: suggestion.skills[skill],
      })),
      evidence: suggestion.evidence,
      excluded: suggestion.excluded,
    },
    decisions: school
      ? null
      : {
          current: [null, ...PRIMARY_SKILLS].flatMap((skill) => {
            const decision = current.get(skill)
            return decision === undefined ? [] : [{ skill, decision }]
          }),
          history,
        },
  }
}
