import { SKILLS } from '@kampus/school-core/content/taxonomy.ts'
import type {
  PracticeGradebook,
  PracticeGradebookBreakdown,
} from '@kampus/react-shared/practice-gradebook.ts'
import type { ListColumn } from '@/lib/list-view.ts'

/**
 * Alıştırma not defterinin tablo modeli (OG-085; IST-056, DOM-BEC-048). Kırılım sunucuda
 * hesaplanır; burada seçilen kırılımın (genel, ünite, beceri, kazanım) kursiyer × grup satırları,
 * CSV sütunları ve sınıf geneli özeti üretilir. Değerlendirme notlarından ayrıdır.
 */

export const GRADEBOOK_VIEWS = ['genel', 'unite', 'beceri', 'kazanim'] as const
export type GradebookView = (typeof GRADEBOOK_VIEWS)[number]

export const GRADEBOOK_VIEW_LABELS: Record<GradebookView, string> = {
  genel: 'Genel',
  unite: 'Ünite',
  beceri: 'Beceri',
  kazanim: 'Kazanım',
}

export const isGradebookView = (value: unknown): value is GradebookView =>
  (GRADEBOOK_VIEWS as readonly unknown[]).includes(value)

export type GradebookRow = {
  id: string
  learner: string
  group: string
  sets: number | null
  score: string
  percent: number
  percentText: string
}

type Tally = PracticeGradebookBreakdown['overall']
type Unit = PracticeGradebookBreakdown['units'][number]
type Skill = PracticeGradebookBreakdown['skills'][number]
type Outcome = PracticeGradebookBreakdown['outcomes'][number]

/** Puan iki ondalığa kadar, Türkçe ondalık virgülüyle. */
export function formatScore(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, '').replace('.', ',')
}

export const unitLabel = (unit: Pick<Unit, 'number' | 'title'>) =>
  unit.title ? `Ünite ${unit.number} · ${unit.title}` : `Ünite ${unit.number}`

export const skillLabel = (skill: Skill['skill']) => SKILLS[skill].label

export const outcomeLabel = (outcome: Pick<Outcome, 'outcomeId'>) => outcome.outcomeId

function groupsOf(
  breakdown: PracticeGradebookBreakdown,
  view: GradebookView,
): { key: string; group: string; sets: number | null; tally: Tally }[] {
  switch (view) {
    case 'genel':
      return [
        {
          key: 'genel',
          group: 'Bütün alıştırmalar',
          sets: breakdown.sets,
          tally: breakdown.overall,
        },
      ]
    case 'unite':
      return breakdown.units.map((unit) => ({
        key: `u${unit.number}`,
        group: unitLabel(unit),
        sets: unit.sets,
        tally: unit,
      }))
    case 'beceri':
      return breakdown.skills.map((skill) => ({
        key: skill.skill,
        group: skillLabel(skill.skill),
        sets: null,
        tally: skill,
      }))
    case 'kazanim':
      return breakdown.outcomes.map((outcome) => ({
        key: `${outcome.outcomeSource}:${outcome.outcomeId}`,
        group: outcomeLabel(outcome),
        sets: null,
        tally: outcome,
      }))
    default:
      return view satisfies never
  }
}

const scoreText = (tally: Tally) => `${formatScore(tally.earned)} / ${formatScore(tally.possible)}`

/** Seçilen kırılımın kursiyer × grup satırları; öğrenci adı yoksa (öğrenci görünümü) "Siz". */
export function gradebookRows(book: PracticeGradebook, view: GradebookView): GradebookRow[] {
  return book.learners.flatMap((learner) =>
    groupsOf(learner, view).map(({ key, group, sets, tally }) => ({
      id: `${learner.learnerId}:${key}`,
      learner: learner.learnerName ?? 'Siz',
      group,
      sets,
      score: scoreText(tally),
      percent: tally.percent,
      percentText: `%${tally.percent}`,
    })),
  )
}

/** Sınıf geneli: seçilen kırılımın bütün kursiyerler toplamı. */
export function gradebookSummary(book: PracticeGradebook, view: GradebookView) {
  return groupsOf(book.totals, view).map(({ key, group, tally }) => ({
    key,
    group,
    text: `%${tally.percent} (${scoreText(tally)})`,
  }))
}

export const GRADEBOOK_COLUMNS: readonly ListColumn[] = [
  { key: 'learner', label: 'Öğrenci' },
  { key: 'group', label: 'Kırılım' },
  { key: 'sets', label: 'Alıştırma' },
  { key: 'score', label: 'Puan' },
  { key: 'percent', label: 'Yüzde' },
]
