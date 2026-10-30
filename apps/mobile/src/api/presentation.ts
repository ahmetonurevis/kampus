// API satırlarının görünüm metinleri (demo `model/school.ts` `rowsFor` ile aynı biçim).
// Rol kapsamı sunucuda uygulanır; rolün göremediği alanlar satırda bulunmayabilir.
import type { State } from '@kampus/school-core/data/seed.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'

type ClassRecord = Partial<State['classes'][number]>
type GradeRecord = Partial<State['grades'][number]>

/** Kampüs · düzey · derslik; eksik parça atlanır. */
export function classSubtitle(record: ClassRecord, branchName: string | undefined): string {
  return [branchName, record.level, record.room ? `Derslik ${record.room}` : undefined]
    .filter(Boolean)
    .join(' · ')
}

/** Notun başarı eşiği demo ekranıyla aynıdır (70). */
export const PASSING_SCORE = 70

export function gradeView(record: GradeRecord) {
  const score = typeof record.score === 'number' ? record.score : null
  return {
    title: record.title ?? record.subject ?? 'Değerlendirme',
    subtitle: [record.date ? dateLabel(record.date) : undefined, record.topic]
      .filter(Boolean)
      .join(' · '),
    score: score === null ? '—' : `${score} / 100`,
    status: score === null ? '' : score >= PASSING_SCORE ? 'Başarılı' : 'Tekrar önerilir',
  }
}
