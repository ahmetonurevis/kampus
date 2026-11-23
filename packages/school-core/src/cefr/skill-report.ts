import { CEFR_LEVELS, SKILLS, type CefrLevel } from '../content/taxonomy.ts'
import {
  PROGRESS_SKILLS,
  countsForProgress,
  type ProgressSkill,
  type SkillResult,
} from '../skills/progress.ts'

/**
 * Beceri ve CEFR raporu (IST-118; docs/domain/beceri-gelisimi.md DOM-BEC-037): grup (dil grubu) ya
 * da kur (CEFR seviyesi) başına öğrenci sayısı, beceri ortalaması ve güncel seviye dağılımı.
 *
 * Saf türetimdir: girdi servisin yüklediği ve kişinin kapsamına daraltılmış satırlardır
 * (gruplar, öğrencilerin görev sonuçları, öğrencilerin güncel seviyeleri), çıktı her okumada
 * hesaplanır ve saklanmaz (DOM-BEC-030 ilkesi). Kapsam kararı burada verilmez: gruba girmeyen
 * öğrencinin sonucu hesaba hiç girmez.
 *
 * Beceri puanı beceri ilerleme panosunun kanıt kümesidir (`countsForProgress`, DOM-BEC-035):
 * yalnız değerlendirme türü, dört beceri, puanı açık, içeriği kaldırılmamış, iptal edilmemiş
 * sonuç. Satır başına tarama yoktur: sonuçlar kursiyere göre bir kez indekslenir, grup kendi
 * kursiyerlerinin indeksine bakar (O(sonuç + üyelik)).
 */

/** Rapor satırlarının gruplanışı: dil grubu (`class`) ya da kur seviyesi (`level`). */
export const REPORT_GROUPINGS = ['class', 'level'] as const
export type ReportGrouping = (typeof REPORT_GROUPINGS)[number]

/** Kursiyerin bir görev sonucu; `learnerId` kapsamdaki öğrencinin kayıt kimliğidir. */
export type LearnerSkillResult = SkillResult & { learnerId: string }

/** Rapor satırı: dil grubu ya da kur seviyesi ve kapsamdaki etkin kursiyerleri. */
export type ReportGroup = {
  id: string
  name: string
  studentIds: readonly string[]
}

export type SkillReportInput = {
  groups: readonly ReportGroup[]
  results: readonly LearnerSkillResult[]
  /** Kursiyerin güncel genel CEFR seviyesi (en yeni genel karar); kararı olmayan yoktur. */
  levels: ReadonlyMap<string, CefrLevel>
  /** Hesap anı; yanıttaki `computedAt`. Pencere ve dönem karşılaştırması bunu kullanacak. */
  now: Date
}

export type SkillAverage = {
  skill: ProgressSkill
  label: string
  /** Kanıtı olan kursiyerlerin ortalamalarının ortalaması; kanıt yoksa `null` (sıfır değil). */
  average: number | null
  /** Kanıt sayısı: gruptaki kursiyerlerin sayılan görev sonuçları. */
  evidenceCount: number
  /** Bu beceride en az bir kanıtı olan kursiyer sayısı. */
  studentCount: number
}

export type LevelShare = { level: CefrLevel; label: string; count: number }

export type GroupSkillReport = {
  id: string
  name: string
  studentCount: number
  skills: SkillAverage[]
  /** Güncel seviye dağılımı, seviye sırasıyla; yalnız kursiyeri olan seviyeler. */
  levels: LevelShare[]
  /** Güncel genel seviye kararı olmayan kursiyer sayısı (dağılıma girmez, ayrı sayılır). */
  noLevelCount: number
}

export type SkillReport = {
  computedAt: string
  groups: GroupSkillReport[]
  /** Raporun bütün kursiyerleri; birden çok grupta olan kursiyer bir kez sayılır. */
  totals: Omit<GroupSkillReport, 'id' | 'name'>
}

/**
 * Ortalama bir ondalıkla verilir (DOM-BEC-036'daki sonuç özetiyle aynı). Yuvarlama yalnız sonda,
 * bir kez yapılır: kursiyer ortalamaları ve grup ortalaması yuvarlanmamış değerlerle hesaplanır,
 * yoksa ara yuvarlama kanıt sayısı arttıkça sapma biriktirir.
 */
const AVERAGE_DECIMALS = 10
const round = (value: number) => Math.round(value * AVERAGE_DECIMALS) / AVERAGE_DECIMALS

const LEVELS_BY_RANK = (Object.keys(CEFR_LEVELS) as CefrLevel[]).sort(
  (a, b) => CEFR_LEVELS[a].rank - CEFR_LEVELS[b].rank,
)

type Scores = Map<ProgressSkill, number[]>

/**
 * Kursiyer → beceri → puan yüzdeleri. Aynı atamanın tek sonucu sayılır (servis ikinciyi verirse
 * ilki kalır; `skillProgress` ile aynı kural). Sayılmayan sonuç hiç indekse girmez.
 */
function indexScores(results: readonly LearnerSkillResult[]) {
  const byLearner = new Map<string, Scores>()
  const seen = new Set<string>()
  for (const result of results) {
    if (!countsForProgress(result)) continue
    const key = `${result.learnerId}\u0000${result.assignmentId}`
    if (seen.has(key)) continue
    seen.add(key)
    const scores = byLearner.get(result.learnerId) ?? new Map()
    const list = scores.get(result.skill) ?? []
    list.push(Math.min(100, Math.max(0, result.percent)))
    scores.set(result.skill, list)
    byLearner.set(result.learnerId, scores)
  }
  return byLearner
}

function reportOf(
  studentIds: readonly string[],
  scores: ReadonlyMap<string, Scores>,
  levels: ReadonlyMap<string, CefrLevel>,
): Omit<GroupSkillReport, 'id' | 'name'> {
  const unique = [...new Set(studentIds)]
  const skills = PROGRESS_SKILLS.map((skill): SkillAverage => {
    // Her kursiyer eşit ağırlıklıdır: çok görev yapan kursiyer grubun ortalamasını sürüklemesin.
    const means: number[] = []
    let evidenceCount = 0
    for (const id of unique) {
      const list = scores.get(id)?.get(skill)
      if (list === undefined || list.length === 0) continue
      evidenceCount += list.length
      means.push(list.reduce((sum, value) => sum + value, 0) / list.length)
    }
    return {
      skill,
      label: SKILLS[skill].label,
      average:
        means.length === 0
          ? null
          : round(means.reduce((sum, value) => sum + value, 0) / means.length),
      evidenceCount,
      studentCount: means.length,
    }
  })
  const counts = new Map<CefrLevel, number>()
  let noLevelCount = 0
  for (const id of unique) {
    const level = levels.get(id)
    if (level === undefined) noLevelCount += 1
    else counts.set(level, (counts.get(level) ?? 0) + 1)
  }
  return {
    studentCount: unique.length,
    skills,
    levels: LEVELS_BY_RANK.flatMap((level) => {
      const count = counts.get(level)
      return count === undefined ? [] : [{ level, label: CEFR_LEVELS[level].label, count }]
    }),
    noLevelCount,
  }
}

/** Beceri ve CEFR raporu (IST-118). Gruplar girdideki sırayla döner. */
export function skillReport(input: SkillReportInput): SkillReport {
  const scores = indexScores(input.results)
  return {
    computedAt: input.now.toISOString(),
    groups: input.groups.map((group) => ({
      id: group.id,
      name: group.name,
      ...reportOf(group.studentIds, scores, input.levels),
    })),
    totals: reportOf(
      input.groups.flatMap((group) => group.studentIds),
      scores,
      input.levels,
    ),
  }
}
