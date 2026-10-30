// Risk Altındaki Öğrenciler saf hesapları (Vue `Management.vue` `risk-listesi`). Girdi sunucunun
// sayım uçlarıdır (öğrenci başına not toplamı ve devamsızlık sayısı) ile kapsamlı öğrenci/sınıf
// kayıtları; hiçbir risk durumu saklanmaz, hepsi kayıtlardan türetilir. Rehberlik dosyası ve iç
// notu bu hesaba hiç girmez (DOM-YTK-020, DOM-ILT-041): kaynak yalnız not ve yoklamadır.
import type { CollectionCounts } from '@kampus/react-shared/collections.ts'
import type { CoreRecord, CoreRow } from '@/hooks/use-core-collection.ts'

/** Erken uyarı eşikleri (Vue ile aynı); resmî başarı eşiği değil, işletme göstergesidir. */
export const RISK_ABSENCE = 6
export const RISK_SCORE = 65
export const HIGH_ABSENCE = 8
export const HIGH_SCORE = 55

export const RISK_LEVELS = { high: 'Yüksek risk', watch: 'Takip önerilir' } as const
export type RiskLevel = (typeof RISK_LEVELS)[keyof typeof RISK_LEVELS]

export type RiskRow = {
  id: string
  name: string
  number: string
  classId: string
  class: string
  branch: string
  /** Not ortalaması (0–100); hiç notu olmayan öğrencide `null` (ortalama uydurulmaz). */
  score: number | null
  /** Devamsız (gelmedi) ders sayısı. */
  absent: number
  risk: RiskLevel
}

export type RiskLookups = {
  classes: ReadonlyMap<string, Pick<CoreRecord<'classes'>, 'name' | 'branchId'>>
  branches: ReadonlyMap<string, Pick<CoreRecord<'branches'>, 'name'>>
}

/** Sayım gruplarını kimliğe göre eşler (satır başına tarama yapılmaz). */
function groupsById(counts: CollectionCounts | undefined) {
  const map = new Map<string, { count: number; sum: number }>()
  for (const group of counts?.groups ?? [])
    if (typeof group.value === 'string')
      map.set(group.value, { count: group.count, sum: group.sum ?? 0 })
  return map
}

/** Öğrencinin risk düzeyi; eşiklerin altındaysa `null` (listeye girmez). */
export function riskLevel(score: number | null, absent: number): RiskLevel | null {
  const lowScore = score !== null && score < RISK_SCORE
  if (!lowScore && absent < RISK_ABSENCE) return null
  const veryLowScore = score !== null && score < HIGH_SCORE
  return veryLowScore || absent >= HIGH_ABSENCE ? RISK_LEVELS.high : RISK_LEVELS.watch
}

/**
 * Risk listesi: aktif öğrencilerden devamsızlığı 6 ve üzeri ya da not ortalaması 65 altı olanlar.
 * Ortalama sunucudaki toplamın not sayısına bölümüdür (yuvarlanmış). Sıra: yüksek risk önce,
 * sonra çok devamsız, sonra düşük ortalama, sonra ad.
 */
export function riskRows(
  students: readonly CoreRow<'students'>[],
  lookups: RiskLookups,
  gradeCounts: CollectionCounts | undefined,
  absentCounts: CollectionCounts | undefined,
): RiskRow[] {
  const grades = groupsById(gradeCounts)
  const absences = groupsById(absentCounts)
  const rows: RiskRow[] = []
  for (const { record } of students) {
    if (!record.isActive) continue
    const own = grades.get(record.id)
    const score = own && own.count > 0 ? Math.round(own.sum / own.count) : null
    const absent = absences.get(record.id)?.count ?? 0
    const risk = riskLevel(score, absent)
    if (!risk) continue
    const schoolClass = lookups.classes.get(record.classId)
    rows.push({
      id: record.id,
      name: record.name,
      number: record.number ?? '',
      classId: record.classId,
      class: schoolClass?.name ?? '—',
      branch: lookups.branches.get(schoolClass?.branchId ?? '')?.name ?? '—',
      score,
      absent,
      risk,
    })
  }
  return rows.sort(
    (a, b) =>
      Number(b.risk === RISK_LEVELS.high) - Number(a.risk === RISK_LEVELS.high) ||
      b.absent - a.absent ||
      (a.score ?? 101) - (b.score ?? 101) ||
      a.name.localeCompare(b.name, 'tr'),
  )
}

export type RiskSummary = { tracked: number; high: number }

export const riskSummary = (rows: readonly RiskRow[]): RiskSummary => ({
  tracked: rows.length,
  high: rows.filter((row) => row.risk === RISK_LEVELS.high).length,
})

/** Risk nedeni cümlesi (panelde ve erişilebilir ad olarak); yalnız ölçülen veriden. */
export function riskReasons(row: Pick<RiskRow, 'score' | 'absent'>): string[] {
  const reasons: string[] = []
  if (row.absent >= RISK_ABSENCE) reasons.push(`${row.absent} ders devamsızlık`)
  if (row.score !== null && row.score < RISK_SCORE) reasons.push(`Not ortalaması ${row.score}/100`)
  return reasons
}
