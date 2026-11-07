import {
  PROGRESSION_OUTCOMES,
  type ProgressionOutcome,
} from '@kampus/school-core/cefr/progression.ts'
import { money } from '@kampus/school-core/lib/format.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'
import type { SaleOffer } from './PackageSaleModal.tsx'

/**
 * Kur yenileme teklif listesinin satırı (IST-088, ON-082; DOM-DIL-070, DOM-DIL-071, DOM-DIL-050).
 * Tutarlar sunucunun tarife hesabıdır; burada yalnız biçimlenir. Teklif ilk uyan paketle açılır,
 * satış formunda başka paket seçilebilir.
 */

/** `GET /finance/course-offers` satırının ekranda okunan alanları. */
export type CourseOfferItem = {
  studentId: string
  studentName: string
  status: 'ready' | 'no_next_level'
  outcome: ProgressionOutcome
  fromCourseName: string
  fromLevel: string
  courseName: string | null
  level: string | null
  options: readonly { packageId: string; packageName: string; hours: number; priceCents: number }[]
  saleId: string | null
  problem: { code: string; message: string } | null
}

export type CourseOfferRow = {
  id: string
  studentName: string
  fromCourse: string
  outcome: string
  target: string
  price: string
  state: { label: string; tone: BadgeTone; note: string | null }
  /** Teklif açılabiliyorsa satış formunun başlangıcı. */
  offer: SaleOffer | null
  saleId: string | null
}

export const COURSE_OFFER_OUTCOME_OPTIONS = Object.entries(PROGRESSION_OUTCOMES).map(
  ([value, item]) => ({ value, label: item.label }),
)

export const isProgressionOutcome = (value: string | null): value is ProgressionOutcome =>
  value !== null && value in PROGRESSION_OUTCOMES

function targetLabel(item: CourseOfferItem) {
  if (item.status === 'no_next_level') return 'Üst seviye yok'
  if (item.courseName !== null) return `${item.courseName} (${item.level ?? '—'})`
  return `${item.level ?? '—'} seviyesi`
}

function stateOf(item: CourseOfferItem): CourseOfferRow['state'] {
  if (item.saleId !== null) return { label: 'Satıldı', tone: 'green', note: null }
  if (item.problem !== null)
    return { label: 'Teklif açılamaz', tone: 'amber', note: item.problem.message }
  return { label: 'Teklif hazır', tone: 'purple', note: null }
}

export function courseOfferRow(item: CourseOfferItem): CourseOfferRow {
  const [first] = item.options
  const outcome = PROGRESSION_OUTCOMES[item.outcome].label
  return {
    id: item.studentId,
    studentName: item.studentName,
    fromCourse: `${item.fromCourseName} (${item.fromLevel})`,
    outcome,
    target: targetLabel(item),
    price:
      first === undefined
        ? '—'
        : `${money(first.priceCents)} · ${String(first.hours)} saat · ${first.packageName}`,
    state: stateOf(item),
    offer:
      first === undefined || item.saleId !== null || item.problem !== null
        ? null
        : {
            studentId: item.studentId,
            packageId: first.packageId,
            note: `${item.studentName} · kur sonu kararı: ${outcome}; teklif ${targetLabel(item)}.`,
          },
    saleId: item.saleId,
  }
}
