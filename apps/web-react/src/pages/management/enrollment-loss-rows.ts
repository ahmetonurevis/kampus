// Kayıp aday kırılımının ekran satırları (IST-117, DOM-KAY-005). Girdi sunucunun kırılım yanıtıdır;
// pay saklanmaz, vazgeçen aday sayısına göre hesaplanır.
import {
  PROSPECT_LOST_REASON_LABELS,
  type ProspectLossBreakdown,
} from '@kampus/school-core/lib/prospects.ts'

/** Nedeni olmayan eski kayıt ve kurumu yazılmamış aday satırı. */
export const UNSPECIFIED = 'Belirtilmemiş'
/** Rapor sınırının dışında kalan kurumlar. */
export const OTHER_INSTITUTIONS = 'Diğer kurumlar'

export type LossRow = {
  label: string
  count: number
  /** Vazgeçen adaylara oranı (0–100, yuvarlanmış). */
  share: number
}

const percent = (count: number, total: number) =>
  total > 0 ? Math.round((count / total) * 100) : 0

export function lossReasonRows(breakdown: ProspectLossBreakdown): LossRow[] {
  return breakdown.reasons.map(({ reason, count }) => ({
    label: reason === null ? UNSPECIFIED : PROSPECT_LOST_REASON_LABELS[reason],
    count,
    share: percent(count, breakdown.total),
  }))
}

/** Kurumlar çoktan aza; sınır dışı kalanlar ve kurumu yazılmamış adaylar sonda toplu gösterilir. */
export function lossInstitutionRows(breakdown: ProspectLossBreakdown): LossRow[] {
  const rows = breakdown.institutions.map(({ name, count }) => ({ label: name, count }))
  if (breakdown.otherInstitutions > 0)
    rows.push({ label: OTHER_INSTITUTIONS, count: breakdown.otherInstitutions })
  if (breakdown.unnamed > 0) rows.push({ label: UNSPECIFIED, count: breakdown.unnamed })
  return rows.map((row) => ({ ...row, share: percent(row.count, breakdown.total) }))
}
