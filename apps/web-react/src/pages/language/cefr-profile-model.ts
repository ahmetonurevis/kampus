import { PLACEMENT_MODES } from '@kampus/school-core/cefr/placement.ts'
import { LEVEL_DECISION_KINDS } from '@kampus/school-core/cefr/suggestion.ts'
import { PRIMARY_SKILLS, SKILLS, type PrimarySkill } from '@kampus/school-core/content/taxonomy.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { isStaffProfile, type CefrProfile } from '@kampus/react-shared/cefr.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

/**
 * CEFR profilinin sunumu (OG-054; IST-060; DOM-DIL-010…012, DOM-BEC-034). Seviye, öneri ve
 * geçerlilik sunucuda hesaplanır; burada yalnız etiket ve sıralama vardır. Gerekçe yalnız `staff`
 * görünümünde gelir; öğrenci ve veli görünümünde satırda gerekçe alanı hiç yoktur.
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

export interface TimelineRow {
  key: string
  title: string
  kind: string
  date: string
  /** Yalnız personel görünümünde; öğrenci ve veliye `null`. */
  rationale: string | null
}

/** Karar çizelgesi (sunucudan en yeniden eskiye gelir). */
export function timelineRows(profile: CefrProfile): TimelineRow[] {
  const rationales = isStaffProfile(profile)
    ? new Map(profile.timeline.map((row) => [row.id, row.rationale]))
    : null
  return profile.timeline.map((row) => ({
    key: row.id,
    title: `${skillLabel(row.skill)}: ${row.level}`,
    kind: LEVEL_DECISION_KINDS[row.kind].label,
    date: dateLabel(row.decidedAt, DATE_OPTIONS),
    rationale: rationales?.get(row.id) ?? null,
  }))
}
