import type { SkillCurve, SkillProgressPoint } from '@kampus/react-shared/skill-progress.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { TRENDS } from '@kampus/school-core/skills/progress.ts'
import type { TrendPoint } from '../dashboard/dashboard-model.ts'

/**
 * Beceri ilerleme panosunun sunumu (OG-080; IST-057, DOM-BEC-035). Eğri, son değer ve eğilim
 * sunucuda puanlardan hesaplanır; burada yalnız metin, grafik noktası ve görev sonucuna giden
 * bağlantı kurulur. Grafik ekran okuyucudan gizlidir, aynı bilgi özet metninde ve satırlardadır.
 */

/** Panoyu görenin görev sonucuna gideceği ekran: öğrenci kendi çalışma alanı, veli takip sekmesi. */
export type ProgressAudience = { kind: 'student' } | { kind: 'parent'; childId: string }

/** Öğrenci quiz çalışma alanı (`QUIZ_PARAM`) ve yazma/konuşma çalışma alanı (`WRITING_PARAM`). */
const STUDENT_QUIZ_PATH = '/ogrenci/soru-coz'
const STUDENT_WRITING_PATH = '/ogrenci/odevler'
/** Velinin "Beceri görevleri" sekmesi; `gorev` paneli atamayı açar (`PARENT_TASK_PARAM`). */
const PARENT_TASKS_PATH = '/veli/akademik-takip'

/**
 * Noktanın bağlandığı görev sonucu. Otomatik puanlı görevde (deneme) quiz çalışma alanı, öğretmen
 * puanlı görevde (teslim) yazma/konuşma çalışma alanı; ikisi de atamanın sonucunu gösterir.
 */
export function pointHref(point: SkillProgressPoint, audience: ProgressAudience): string {
  const params = new URLSearchParams()
  if (audience.kind === 'parent') {
    params.set('cocuk', audience.childId)
    params.set('sekme', 'gorevler')
    params.set('gorev', point.assignmentId)
    return `${PARENT_TASKS_PATH}?${params.toString()}`
  }
  const quiz = point.attemptId !== null
  params.set(quiz ? 'coz' : 'yaz', point.assignmentId)
  return `${quiz ? STUDENT_QUIZ_PATH : STUDENT_WRITING_PATH}?${params.toString()}`
}

const lower = (label: string) => label.toLocaleLowerCase('tr-TR')

/** Boş beceri metni: "Henüz puanlanmış okuma görevi yok." */
export const emptySkillText = (curve: Pick<SkillCurve, 'label'>) =>
  `Henüz puanlanmış ${lower(curve.label)} görevi yok.`

/** Kısa özet: son puan, eğilim ve görev sayısı; grafik yerine okunan metindir. */
export function skillSummary(curve: SkillCurve): string {
  if (curve.latest === null) return emptySkillText(curve)
  const count = `${curve.points.length} görev`
  const trend = curve.trend === null ? '' : ` · ${TRENDS[curve.trend].label}`
  return `Son puan %${curve.latest}${trend} · ${count}`
}

/** Grafik noktaları, tarih sırasıyla (sunucu sırası). */
export function chartPoints(curve: SkillCurve): TrendPoint[] {
  return curve.points.map((point) => ({
    label: dateLabel(point.performedAt),
    value: point.percent,
  }))
}

export interface SkillPointRow {
  key: string
  title: string
  date: string
  percent: string
  href: string
  /** Bağlantının erişilebilir adı: görev, tarih ve puan. */
  linkLabel: string
}

/** Erişilebilir satırlar: en yeni görev üstte; her satır görev sonucuna bağlanır. */
export function skillPointRows(curve: SkillCurve, audience: ProgressAudience): SkillPointRow[] {
  return curve.points
    .map((point) => {
      const date = dateLabel(point.performedAt, { year: 'numeric' })
      const percent = `%${point.percent}`
      return {
        key: point.attemptId ?? point.submissionId ?? point.assignmentId,
        title: point.title || 'Adsız görev',
        date,
        percent,
        href: pointHref(point, audience),
        linkLabel: `${point.title || 'Adsız görev'}, ${date}, ${percent} sonucunu aç`,
      }
    })
    .reverse()
}
