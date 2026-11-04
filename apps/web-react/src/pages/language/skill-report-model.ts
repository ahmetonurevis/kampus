import { dateLabel, number } from '@kampus/school-core/lib/format.ts'
import type {
  SkillReport,
  SkillReportGroup,
  SkillReportGroupBy,
  SkillReportSkill,
} from '@kampus/react-shared/use-skill-report.ts'

/**
 * Beceri ve CEFR raporunun sunumu (OG-100; IST-118; DOM-BEC-037). Ortalama, kanıt sayısı ve seviye
 * dağılımı sunucuda hesaplanır; burada yalnız metin, oran çubuğu ve tablo satırı vardır. Kanıtsız
 * beceri `null` gelir ve "—" ile "kanıt yok" olarak gösterilir; sıfır gösterilmez.
 */

export const GROUPINGS = ['class', 'level'] as const satisfies readonly SkillReportGroupBy[]

export const GROUPING_LABELS = {
  class: 'Gruplar',
  level: 'Kur seviyeleri',
} as const satisfies Record<SkillReportGroupBy, string>

export const NO_LEVEL_LABEL = 'Seviye kararı yok'
export const NO_EVIDENCE_LABEL = 'kanıt yok'

export function isGrouping(value: string | null): value is SkillReportGroupBy {
  return GROUPINGS.some((grouping) => grouping === value)
}

/** Adres parametresinden kırılım; geçersiz ya da yoksa dil grupları. */
export function resolveGrouping(value: string | null): SkillReportGroupBy {
  return isGrouping(value) ? value : 'class'
}

const averageFormatter = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

/** Beceri ortalaması (0–100, bir ondalık); kanıtsız `null` "—" olur, sıfır gösterilmez. */
export function averageText(average: number | null): string {
  return average === null ? '—' : averageFormatter.format(average)
}

/** Çubuk genişliği (yüzde); kanıtsız beceride çubuk çizilmez. */
export function barPercent(average: number | null): number | null {
  return average === null ? null : Math.min(100, Math.max(0, Math.round(average)))
}

/** "12 sonuç · 5 kursiyer" ya da "kanıt yok". */
export function evidenceText(skill: Pick<SkillReportSkill, 'evidenceCount' | 'studentCount'>) {
  return skill.evidenceCount === 0
    ? NO_EVIDENCE_LABEL
    : `${number(skill.evidenceCount)} sonuç · ${number(skill.studentCount)} kursiyer`
}

/** Ekran okuyucu için bir becerinin tam cümlesi. */
export function skillAriaLabel(skill: SkillReportSkill): string {
  return skill.average === null
    ? `${skill.label}: kanıt yok`
    : `${skill.label}: ortalama ${averageText(skill.average)}, ${evidenceText(skill)}`
}

export type LevelShare = {
  key: string
  label: string
  count: number
  /** Kursiyer sayısına oranı (tam sayı yüzde). */
  percent: number
}

type LevelSource = Pick<SkillReportGroup, 'levels' | 'noLevelCount' | 'studentCount'>

/** Seviye dağılımı satırları: seviye sırasıyla, seviye kararı olmayanlar sonda. */
export function levelShares(group: LevelSource): LevelShare[] {
  const share = (count: number) =>
    group.studentCount === 0 ? 0 : Math.round((count / group.studentCount) * 100)
  const rows: LevelShare[] = group.levels.map((item) => ({
    key: item.level,
    label: item.label,
    count: item.count,
    percent: share(item.count),
  }))
  if (group.noLevelCount > 0)
    rows.push({
      key: 'none',
      label: NO_LEVEL_LABEL,
      count: group.noLevelCount,
      percent: share(group.noLevelCount),
    })
  return rows
}

/** "B1: 3 · B2: 2 · Seviye kararı yok: 1"; hiç kursiyer yoksa "—". */
export function levelDistributionText(group: LevelSource): string {
  const shares = levelShares(group)
  return shares.length === 0
    ? '—'
    : shares.map((item) => `${item.label}: ${number(item.count)}`).join(' · ')
}

export const REPORT_SKILL_KEYS = ['reading', 'listening', 'writing', 'speaking'] as const
export type ReportSkillKey = (typeof REPORT_SKILL_KEYS)[number]

export type SkillReportRow = {
  id: string
  name: string
  /** Kur seviyesi etiketi; seviyesi olmayan grupta boş (tablo "—" gösterir, süzgeç seçeneği olmaz). */
  level: string
  students: number
  reading: number | null
  listening: number | null
  writing: number | null
  speaking: number | null
  /** Beceri anahtarı → sunucudaki satır (kanıt sayısı ve kursiyer sayısı için). */
  skills: Readonly<Record<ReportSkillKey, SkillReportSkill | undefined>>
  levelsText: string
  shares: readonly LevelShare[]
}

/** Rapor satırı: sunucunun grup/seviye satırı tablo satırına çevrilir; sıra sunucudakidir. */
export function skillReportRow(group: SkillReportGroup): SkillReportRow {
  const skill = (key: ReportSkillKey) => group.skills.find((item) => item.skill === key)
  return {
    id: group.id,
    name: group.name,
    level: group.level ?? '',
    students: group.studentCount,
    reading: skill('reading')?.average ?? null,
    listening: skill('listening')?.average ?? null,
    writing: skill('writing')?.average ?? null,
    speaking: skill('speaking')?.average ?? null,
    skills: {
      reading: skill('reading'),
      listening: skill('listening'),
      writing: skill('writing'),
      speaking: skill('speaking'),
    },
    levelsText: levelDistributionText(group),
    shares: levelShares(group),
  }
}

export const skillReportRows = (report: SkillReport): SkillReportRow[] =>
  report.groups.map(skillReportRow)

/** Rapor hesaplandığı an ("4 Kas 2026 12:30"). */
export function computedAtText(computedAt: string): string {
  return dateLabel(computedAt, { year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * Satırdan kanıta inme (DOM-BEC-037 "Kodda"): dil grubu satırı grup listesinin ilgili grubunu
 * açar (`?grup=`); seviye satırının tek bir grubu yoktur, bağlantı verilmez.
 */
export function groupLink(
  grouping: SkillReportGroupBy,
  row: Pick<SkillReportRow, 'id'>,
): { path: string; search: string } | null {
  return grouping === 'class'
    ? { path: 'gruplar', search: `?grup=${encodeURIComponent(row.id)}` }
    : null
}

export const REPORT_CSV_COLUMNS = [
  { key: 'name', label: 'Satır' },
  { key: 'level', label: 'Seviye' },
  { key: 'students', label: 'Kursiyer' },
  { key: 'reading', label: 'Okuma' },
  { key: 'listening', label: 'Dinleme' },
  { key: 'writing', label: 'Yazma' },
  { key: 'speaking', label: 'Konuşma' },
  { key: 'levelsText', label: 'Seviye dağılımı' },
] as const
