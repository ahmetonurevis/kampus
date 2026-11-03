import { SKILLS, type PrimarySkill } from '../content/taxonomy.ts'
import type { TaskKind } from './scoring.ts'

/**
 * Beceri ilerleme panosu (IST-057; docs/domain/beceri-gelisimi.md DOM-BEC-035). Okuma, dinleme,
 * yazma ve konuşma için ayrı, tarih sıralı puan noktaları; her nokta kanıt görevine (atama ve
 * sayılan deneme ya da puanlanan teslim) bağlıdır. Saf türetimdir: girdi servisin okuduğu ve
 * kişinin görebildiği sonuçlardır (puan kişiye açılmadıysa `percent: null` gelir), çıktı her
 * okumada hesaplanır ve saklanmaz (hedef ilerlemesi ve seviye önerisiyle aynı ilke, DOM-BEC-030).
 */

/** Panodaki dört beceri, gösterim sırasıyla (aracılık ve dil kullanımı ayrı gösterilir). */
export const PROGRESS_SKILLS = [
  'reading',
  'listening',
  'writing',
  'speaking',
] as const satisfies readonly PrimarySkill[]
export type ProgressSkill = (typeof PROGRESS_SKILLS)[number]

/** Eğilim için karşılaştırılan önceki nokta sayısı ve kararsız bant (yüzde puanı). */
export const TREND_WINDOW = 3
export const TREND_THRESHOLD = 5

export const TRENDS = {
  up: { label: 'Yükseliyor' },
  down: { label: 'Düşüyor' },
  steady: { label: 'Dengeli' },
} as const
export type Trend = keyof typeof TRENDS

/** Puanlanmış görev sonucu (servisin yüklediği satır). */
export interface SkillResult {
  /** Atanan içerik sürümünün birincil becerisi (DOM-BEC-001); etiketsiz içerik `null`. */
  skill: PrimarySkill | null
  kind: TaskKind
  assignmentId: string
  /** Otomatik puanlı görevde sayılan deneme (DOM-BEC-042). */
  attemptId: string | null
  /** Öğretmen puanlı görevde teslim kaydı (DOM-BEC-040). */
  submissionId: string | null
  title: string
  /** Denemenin tamamlandığı ya da puanlanan sürümün gönderildiği an (ISO UTC). */
  performedAt: string
  /** Kişiye açık puan yüzdesi; açılmamış ya da hesaplanamayan puan `null`. */
  percent: number | null
  /** İçerik kaldırıldı (DOM-KYN-051): puan gösterilmez. */
  removed: boolean
  /** Atama ya da kayıt iptal edildi (arşivlendi). */
  cancelled: boolean
}

export interface ProgressPoint {
  assignmentId: string
  attemptId: string | null
  submissionId: string | null
  title: string
  performedAt: string
  percent: number
}

export interface SkillCurve {
  skill: ProgressSkill
  label: string
  points: ProgressPoint[]
  /** Son noktanın yüzdesi; nokta yoksa `null`. */
  latest: number | null
  /** En az iki noktada hesaplanır; aksi hâlde `null`. */
  trend: Trend | null
}

const isProgressSkill = (skill: PrimarySkill | null): skill is ProgressSkill =>
  skill !== null && (PROGRESS_SKILLS as readonly string[]).includes(skill)

/**
 * Sonuç panoya girer mi (DOM-BEC-035): değerlendirme türünde (alıştırma panoya girmez, DOM-BEC-041),
 * dört beceriden birinde, puanı kişiye açık, içeriği kaldırılmamış ve iptal edilmemiş.
 */
export function countsForProgress(
  result: SkillResult,
): result is SkillResult & { skill: ProgressSkill; percent: number } {
  return (
    result.kind === 'evaluation' &&
    isProgressSkill(result.skill) &&
    result.percent !== null &&
    !result.removed &&
    !result.cancelled &&
    (result.attemptId !== null) !== (result.submissionId !== null)
  )
}

const byTime = (a: ProgressPoint, b: ProgressPoint) =>
  Date.parse(a.performedAt) - Date.parse(b.performedAt) ||
  a.assignmentId.localeCompare(b.assignmentId)

/**
 * Eğilim: son nokta, önceki en çok `TREND_WINDOW` noktanın ortalamasıyla karşılaştırılır; fark
 * `TREND_THRESHOLD` puandan küçükse dengeli. Tek nokta eğilim vermez.
 */
export function trendOf(points: readonly Pick<ProgressPoint, 'percent'>[]): Trend | null {
  const last = points.at(-1)
  if (last === undefined || points.length < 2) return null
  const previous = points.slice(-1 - TREND_WINDOW, -1)
  const mean = previous.reduce((sum, point) => sum + point.percent, 0) / previous.length
  const delta = last.percent - mean
  if (delta >= TREND_THRESHOLD) return 'up'
  if (delta <= -TREND_THRESHOLD) return 'down'
  return 'steady'
}

/**
 * Beceri eğrileri (DOM-BEC-035): dört beceri her zaman sırasıyla döner, sonucu olmayan beceri boş
 * eğridir. Aynı atamanın tek noktası vardır (otomatik görevde sayılan deneme, teslimde puanlanan
 * sürüm); servis ikinciyi verirse yalnız ilki alınır.
 */
export function skillProgress(results: readonly SkillResult[]): SkillCurve[] {
  const bySkill = new Map<ProgressSkill, ProgressPoint[]>(PROGRESS_SKILLS.map((s) => [s, []]))
  const seen = new Set<string>()
  for (const result of results) {
    if (!countsForProgress(result) || seen.has(result.assignmentId)) continue
    seen.add(result.assignmentId)
    bySkill.get(result.skill)?.push({
      assignmentId: result.assignmentId,
      attemptId: result.attemptId,
      submissionId: result.submissionId,
      title: result.title,
      performedAt: new Date(result.performedAt).toISOString(),
      percent: Math.min(100, Math.max(0, result.percent)),
    })
  }
  return PROGRESS_SKILLS.map((skill) => {
    const points = (bySkill.get(skill) ?? []).sort(byTime)
    return {
      skill,
      label: SKILLS[skill].label,
      points,
      latest: points.at(-1)?.percent ?? null,
      trend: trendOf(points),
    }
  })
}
