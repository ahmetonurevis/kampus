import { CEFR_LEVELS, type CefrLevel, type PrimarySkill } from '../content/taxonomy.ts'
import type { EvidenceSnapshot, LevelDecisionRow, SuggestionContextKind } from './suggestion.ts'

/**
 * CEFR profilinin zaman çizelgesi (OG-079; IST-060; DOM-BEC-034): beceri başına seviye
 * kararlarının sırası, bir önceki seviyeye göre değişim, karar anının kanıt özeti ve mini grafik
 * dizisi. Hepsi saklanan `level_decisions` satırlarından her okumada türetilir; değişim ve dizi
 * saklanmaz. Kararlar değişmez olduğundan aynı girdi her zaman aynı çizelgeyi verir.
 */

/** Çizelgedeki bir karar: beceri (`null` genel seviye), seviye ve an. */
export type TimelineDecision = {
  id: string
  skill: PrimarySkill | null
  level: CefrLevel
  decidedAt: string
}

/** Kararın aynı becerideki bir önceki karara göre yönü. */
export const LEVEL_CHANGES = {
  first: { label: 'İlk karar' },
  up: { label: 'Yükseldi' },
  down: { label: 'Düştü' },
  same: { label: 'Değişmedi' },
} as const
export type LevelChange = keyof typeof LEVEL_CHANGES

export type TimelineEntry<T extends TimelineDecision> = T & {
  /** Aynı becerideki bir önceki kararın seviyesi; ilk kararda `null`. */
  previousLevel: CefrLevel | null
  change: LevelChange
}

const rankOf = (level: CefrLevel) => CEFR_LEVELS[level].rank

/** Eskiden yeniye; aynı anda verilenler kimliğe göre (sunucu sırası ters çevrilince tutarlı). */
const oldestFirst = (a: TimelineDecision, b: TimelineDecision) =>
  Date.parse(a.decidedAt) - Date.parse(b.decidedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * Kararlar en yeniden eskiye, her biri aynı becerinin bir önceki kararına göre değişimiyle. Genel
 * seviye (`skill: null`) kendi başına bir beceri gibi izlenir.
 */
export function levelTimeline<T extends TimelineDecision>(
  decisions: readonly T[],
): TimelineEntry<T>[] {
  const last = new Map<PrimarySkill | null, CefrLevel>()
  const entries: TimelineEntry<T>[] = []
  for (const decision of [...decisions].sort(oldestFirst)) {
    const previousLevel = last.get(decision.skill) ?? null
    const change: LevelChange =
      previousLevel === null
        ? 'first'
        : rankOf(decision.level) > rankOf(previousLevel)
          ? 'up'
          : rankOf(decision.level) < rankOf(previousLevel)
            ? 'down'
            : 'same'
    last.set(decision.skill, decision.level)
    entries.push({ ...decision, previousLevel, change })
  }
  return entries.reverse()
}

export type LevelPoint = {
  decisionId: string
  decidedAt: string
  level: CefrLevel
  /** Taksonomideki sıra (Pre-A1 0 … C2 9); grafiğin dikey ekseni. */
  rank: number
}

/**
 * Bir becerinin (`null` genel seviye) seviye dizisi, eskiden yeniye. Mini grafik yalnız bu gerçek
 * karar noktalarını çizer; ara değer üretilmez.
 */
export function levelSeries(
  decisions: readonly TimelineDecision[],
  skill: PrimarySkill | null,
): LevelPoint[] {
  return decisions
    .filter((decision) => decision.skill === skill)
    .sort(oldestFirst)
    .map((decision) => ({
      decisionId: decision.id,
      decidedAt: decision.decidedAt,
      level: decision.level,
      rank: rankOf(decision.level),
    }))
}

/** Çizelgede kararı olan beceriler: önce genel seviye, sonra verilen beceri sırası. */
export function timelineSkills(
  decisions: readonly TimelineDecision[],
  order: readonly PrimarySkill[],
): (PrimarySkill | null)[] {
  const present = new Set(decisions.map((decision) => decision.skill))
  return [null, ...order].filter((skill) => present.has(skill))
}

type SnapshotEvidence = EvidenceSnapshot['evidence'][number]

/** Karar anındaki kanıt: kopyadaki satır ve önerinin ona dayanıp dayanmadığı. */
export type DecisionEvidenceItem = Omit<SnapshotEvidence, 'items'> & {
  /** Karar anındaki önerinin dayandığı kanıtlardan mı (`skills[].evidenceIds`). */
  basis: boolean
}

export type DecisionEvidence = {
  /** Önerinin bağlamı: genel ya da seviye tespiti. */
  context: SuggestionContextKind
  /** Karar anındaki öneri (aynı beceri ya da genel); kanıt yetersizse `null`. */
  suggestedLevel: CefrLevel | null
  /** Karar öneriyle aynı mı; öneri yoksa `null`. */
  followsSuggestion: boolean | null
  /** Karar anındaki kanıtlar: beceri kararında o becerinin, genel kararda hepsinin. */
  items: DecisionEvidenceItem[]
  successful: number
}

/**
 * Kararın dayandığı kanıtların özeti (IST-060 kabulü: değişiklik hangi kanıtla yapıldı). Kaynak
 * yalnız kararın değişmez `evidence_snapshot` kopyasıdır (DOM-BEC-030); bugünkü öneri ya da
 * güncel puanlar karışmaz.
 */
export function decisionEvidence(decision: LevelDecisionRow): DecisionEvidence {
  const snapshot = decision.evidenceSnapshot
  const skillEntry =
    decision.skill === null
      ? undefined
      : snapshot.skills.find((entry) => entry.skill === decision.skill)
  const basisIds = new Set(
    decision.skill === null
      ? snapshot.skills.flatMap((entry) => entry.evidenceIds)
      : (skillEntry?.evidenceIds ?? []),
  )
  const suggestedLevel =
    decision.skill === null
      ? snapshot.overall.status === 'suggested'
        ? snapshot.overall.level
        : null
      : (skillEntry?.level ?? null)
  const items = snapshot.evidence
    .filter((item) => decision.skill === null || item.skill === decision.skill)
    .sort(
      (a, b) => Date.parse(b.performedAt) - Date.parse(a.performedAt) || a.id.localeCompare(b.id),
    )
    .map((item) => ({
      id: item.id,
      taskId: item.taskId,
      title: item.title,
      source: item.source,
      skill: item.skill,
      targetLevel: item.targetLevel,
      performedAt: item.performedAt,
      successful: item.successful,
      percent: item.percent,
      basis: basisIds.has(item.id),
    }))
  return {
    context: snapshot.context,
    suggestedLevel,
    followsSuggestion: suggestedLevel === null ? null : suggestedLevel === decision.level,
    items,
    successful: items.filter((item) => item.successful).length,
  }
}
