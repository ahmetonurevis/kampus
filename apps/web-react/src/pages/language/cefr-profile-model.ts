import { PLACEMENT_MODES } from '@kampus/school-core/cefr/placement.ts'
import { LEVEL_DECISION_KINDS, SUGGESTION_CONTEXTS } from '@kampus/school-core/cefr/suggestion.ts'
import {
  LEVEL_CHANGES,
  levelSeries,
  timelineSkills,
  type LevelChange,
} from '@kampus/school-core/cefr/timeline.ts'
import {
  CEFR_LEVELS,
  PRIMARY_SKILLS,
  SKILLS,
  type PrimarySkill,
} from '@kampus/school-core/content/taxonomy.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import {
  isStaffProfile,
  type CefrProfile,
  type CefrStaffTimelineEntry,
} from '@kampus/react-shared/cefr.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

/**
 * CEFR profilinin sunumu (OG-054, OG-079; IST-060; DOM-DIL-010…012, DOM-BEC-034). Seviye, öneri,
 * geçerlilik ve çizelgedeki değişim sunucuda hesaplanır; burada yalnız etiket, süzgeç ve sıralama
 * vardır. Gerekçe, kararı veren ve kanıt özeti yalnız `staff` görünümünde gelir; öğrenci ve veli
 * görünümünde satırda bu alanlar hiç yoktur.
 */

const DATE_OPTIONS = { day: 'numeric', month: 'long', year: 'numeric' } as const

export const GENERAL_LEVEL_LABEL = 'Genel seviye'

export function skillLabel(skill: PrimarySkill | null): string {
  return skill === null ? GENERAL_LEVEL_LABEL : SKILLS[skill].label
}

/** Genel seviye önce, beceriler sözlük sırasıyla. */
const skillOrder = (skill: PrimarySkill | null) =>
  skill === null ? -1 : PRIMARY_SKILLS.indexOf(skill)

export interface LevelRow {
  key: string
  label: string
  level: string
  note: string
}

/** Güncel seviyeler: beceri başına en yeni insan kararı. */
export function currentLevelRows(profile: CefrProfile): LevelRow[] {
  return [...profile.current]
    .sort((left, right) => skillOrder(left.skill) - skillOrder(right.skill))
    .map((row) => ({
      key: row.decisionId,
      label: skillLabel(row.skill),
      level: row.level,
      note: dateLabel(row.decidedAt, DATE_OPTIONS),
    }))
}

/** Tahmini genel seviye: öneri karar değildir (DOM-BEC-034). */
export function estimateSummary(estimate: CefrProfile['estimate']): {
  level: string
  note: string
} {
  if (estimate.overall.status === 'suggested')
    return { level: estimate.overall.level, note: 'Kanıtlara göre öneri; karar değildir.' }
  const missing = estimate.overall.missingSkills.map((skill) => SKILLS[skill].label)
  return {
    level: 'Kanıt yetersiz',
    note: missing.length ? `Eksik beceri: ${missing.join(', ')}` : 'Yeterli kanıt yok.',
  }
}

/** Beceri bazında tahmini seviye; eksik kanıt sayısı metinle söylenir. */
export function estimateSkillRows(estimate: CefrProfile['estimate']): LevelRow[] {
  return [...estimate.skills]
    .sort((left, right) => skillOrder(left.skill) - skillOrder(right.skill))
    .map((row) => ({
      key: row.skill,
      label: row.label,
      level: row.status === 'suggested' && row.level ? row.level : 'Kanıt yetersiz',
      note:
        row.status === 'suggested'
          ? `${row.evidenceIds.length} kanıt`
          : row.missingEvidence > 0
            ? `${row.missingEvidence} kanıt daha gerekir`
            : 'Kanıt yetersiz',
    }))
}

const VALIDITY = {
  in_progress: { label: 'Sürüyor', tone: 'amber' },
  valid: { label: 'Geçerli', tone: 'green' },
  expired: { label: 'Süresi doldu', tone: 'gray' },
} as const satisfies Record<string, { label: string; tone: BadgeTone }>

export interface PlacementRow {
  key: string
  date: string
  mode: string
  status: string
  tone: BadgeTone
  until: string
}

/** Seviye tespitleri en yeniden eskiye; geçerlilik 90 gündür (DOM-DIL-012). */
export function placementRows(profile: CefrProfile): PlacementRow[] {
  return [...profile.placements]
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    .map((row) => {
      const validity = VALIDITY[row.validity.status]
      return {
        key: row.id,
        date: dateLabel(row.completedAt ?? row.startedAt, DATE_OPTIONS),
        mode: PLACEMENT_MODES[row.mode].label,
        status: validity.label,
        tone: validity.tone,
        until:
          row.validity.status === 'valid' && row.validity.validUntil
            ? `${dateLabel(row.validity.validUntil, DATE_OPTIONS)} tarihine kadar`
            : '',
      }
    })
}

/** Çizelge süzgeci: bütün kararlar, genel seviye ya da tek beceri. */
export type TimelineFilter = 'all' | 'general' | PrimarySkill

const filterSkill = (filter: Exclude<TimelineFilter, 'all'>): PrimarySkill | null =>
  filter === 'general' ? null : filter

const filterOf = (skill: PrimarySkill | null): Exclude<TimelineFilter, 'all'> =>
  skill === null ? 'general' : skill

const matches = (filter: TimelineFilter, skill: PrimarySkill | null) =>
  filter === 'all' || filterSkill(filter) === skill

export interface TimelineFilterOption {
  value: TimelineFilter
  label: string
  count: number
}

/**
 * Geçerli süzgeç: seçili değer seçeneklerde yoksa (başka kursiyere geçildi, süzgeç çıkmıyor)
 * "Tümü"ne döner.
 */
export function resolveTimelineFilter(
  options: readonly TimelineFilterOption[],
  filter: TimelineFilter,
): TimelineFilter {
  return options.some((option) => option.value === filter) ? filter : 'all'
}

/**
 * Süzgeç seçenekleri: "Tümü", sonra kararı olan genel seviye ve beceriler (core `timelineSkills`).
 * Tek beceride karar varsa süzgeç gösterilmez.
 */
export function timelineFilterOptions(profile: CefrProfile): TimelineFilterOption[] {
  const skills = timelineSkills(profile.timeline, PRIMARY_SKILLS)
  if (skills.length < 2) return []
  return [
    { value: 'all', label: 'Tümü', count: profile.timeline.length },
    ...skills.map((skill) => ({
      value: filterOf(skill),
      label: skillLabel(skill),
      count: profile.timeline.filter((row) => row.skill === skill).length,
    })),
  ]
}

const TONE_OF_CHANGE = {
  first: 'gray',
  up: 'green',
  down: 'amber',
  same: 'gray',
} as const satisfies Record<LevelChange, BadgeTone>

export interface EvidenceRow {
  key: string
  title: string
  note: string
  date: string
  dateTime: string
}

export interface TimelineRow {
  key: string
  title: string
  kind: string
  date: string
  /** `time` ögesinin makine okunur değeri (ISO 8601). */
  dateTime: string
  /** Önceki seviyeye göre değişim ("A2 → B1"); ilk kararda yalnız etiket. */
  change: { label: string; detail: string; tone: BadgeTone }
  /** Yalnız personel görünümünde; öğrenci ve veliye `null`. */
  rationale: string | null
  decidedBy: string | null
  /** Karar anının kanıt özeti; yalnız personel görünümünde. */
  evidence: { summary: string; suggestion: string; items: EvidenceRow[] } | null
}

function evidenceSummary(entry: CefrStaffTimelineEntry): NonNullable<TimelineRow['evidence']> {
  const { evidence } = entry
  const count = evidence.items.length
  const context = SUGGESTION_CONTEXTS[evidence.context].label
  return {
    summary: count
      ? `${count} kanıt görevi, ${evidence.successful} başarılı`
      : 'Karar anında kayıtlı kanıt yok',
    suggestion:
      evidence.suggestedLevel === null
        ? `${context}: kanıt yetersizdi`
        : `${context}: ${evidence.suggestedLevel}${
            evidence.followsSuggestion ? ' (karar öneriyle aynı)' : ' (karar öneriden farklı)'
          }`,
    items: evidence.items.map((item) => ({
      key: item.id,
      title: item.title,
      note: [
        `${SKILLS[item.skill].label} · hedef ${item.targetLevel}`,
        `%${item.percent}`,
        item.successful ? 'başarılı' : 'başarısız',
        ...(item.basis ? ['öneriye dayanak'] : []),
      ].join(' · '),
      date: dateLabel(item.performedAt, DATE_OPTIONS),
      dateTime: item.performedAt,
    })),
  }
}

/**
 * Karar çizelgesi (sunucudan en yeniden eskiye gelir), süzgece göre. Değişim sunucuda core
 * `levelTimeline` ile hesaplanır; kim ve kanıt yalnız personel yanıtındadır.
 */
export function timelineRows(profile: CefrProfile, filter: TimelineFilter = 'all'): TimelineRow[] {
  const staff = isStaffProfile(profile)
    ? new Map(profile.timeline.map((row) => [row.id, row]))
    : null
  return profile.timeline
    .filter((row) => matches(filter, row.skill))
    .map((row) => {
      const detail = staff?.get(row.id)
      return {
        key: row.id,
        title: `${skillLabel(row.skill)}: ${row.level}`,
        kind: LEVEL_DECISION_KINDS[row.kind].label,
        date: dateLabel(row.decidedAt, DATE_OPTIONS),
        dateTime: row.decidedAt,
        change: {
          label: LEVEL_CHANGES[row.change].label,
          detail: row.previousLevel === null ? '' : `${row.previousLevel} → ${row.level}`,
          tone: TONE_OF_CHANGE[row.change],
        },
        rationale: detail?.rationale ?? null,
        decidedBy: detail ? (detail.decidedByName ?? 'Bilinmiyor') : null,
        evidence: detail ? evidenceSummary(detail) : null,
      }
    })
}

/** Mini grafiğin noktası: x 0…1 zaman sırası, y 0…1 seviye sırası (Pre-A1 0, C2 1). */
export interface ChartPoint {
  key: string
  x: number
  y: number
  level: string
}

const MAX_RANK = Math.max(...Object.values(CEFR_LEVELS).map((level) => level.rank))

/**
 * Seçili becerinin seviye grafiği (core `levelSeries`): yalnız gerçek karar noktaları, eşit
 * aralıklı sıra ekseninde; ara değer üretilmez. Kararlar tek becerideyse süzgeç çıkmaz ve grafik
 * "Tümü"nde o beceriyle çizilir; birden çok becerili "Tümü"nde ya da tek kararda grafik yoktur.
 */
export function levelChart(
  profile: CefrProfile,
  filter: TimelineFilter,
): { label: string; points: ChartPoint[]; summary: string } | null {
  const skills = timelineSkills(profile.timeline, PRIMARY_SKILLS)
  const only = skills.length === 1 ? skills[0] : undefined
  if (filter === 'all' && only === undefined) return null
  const skill = filter === 'all' ? (only ?? null) : filterSkill(filter)
  const series = levelSeries(profile.timeline, skill)
  const first = series[0]
  const last = series.at(-1)
  if (series.length < 2 || !first || !last) return null
  const step = 1 / (series.length - 1)
  return {
    label: `${skillLabel(skill)} seviye grafiği`,
    points: series.map((point, index) => ({
      key: point.decisionId,
      x: index * step,
      y: point.rank / MAX_RANK,
      level: point.level,
    })),
    summary: `${series.length} karar: ${first.level} (${dateLabel(first.decidedAt, DATE_OPTIONS)}) → ${last.level} (${dateLabel(last.decidedAt, DATE_OPTIONS)})`,
  }
}
