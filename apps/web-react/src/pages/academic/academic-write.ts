// Akademik yazma ekranlarının (yoklama alma, not girişi) saf hesapları. Yetkinin kendisi
// sunucudadır (school-core `authorize`); buradaki süzgeçler yalnız kullanıcıya seçilemeyecek
// seçenekleri hiç göstermemek içindir (kapsam dışı sınıf seçilemez).
import { GRADE_TYPES, GRADE_TYPE_LABELS, type GradeType } from '@kampus/school-core/lib/grades.ts'
import type { CoreRecord } from '@/hooks/use-core-collection.ts'

type Assignment = Pick<CoreRecord<'assignments'>, 'classId' | 'subjectId' | 'teacherId'>

/** Öğretmenin ders verdiği sınıflar. Yalnız sınıf danışmanı olduğu sınıfta yoklama alınamaz. */
export function teachingClassIds(
  assignments: readonly Assignment[],
  teacherId: string,
): ReadonlySet<string> {
  return new Set(
    assignments.filter((item) => item.teacherId === teacherId).map((item) => item.classId),
  )
}

/** Öğretmenin bir sınıfta okuttuğu dersler (kimlik sırasıyla, tekrarsız). */
export function teachingSubjectIds(
  assignments: readonly Assignment[],
  teacherId: string,
  classId: string,
): string[] {
  return [
    ...new Set(
      assignments
        .filter((item) => item.teacherId === teacherId && item.classId === classId)
        .map((item) => item.subjectId),
    ),
  ]
}

/** Öğretmen yalnız ders verdiği sınıfın kendi dersindeki notunu düzeltir (DOM-AKD-054). */
export function canCorrectGrade(
  assignments: readonly Assignment[],
  teacherId: string,
  classId: string | undefined,
  subjectId: string,
): boolean {
  return (
    teacherId !== '' &&
    classId !== undefined &&
    assignments.some(
      (item) =>
        item.teacherId === teacherId && item.classId === classId && item.subjectId === subjectId,
    )
  )
}

/** Eylül–Ocak 1. dönem, Şubat–Ağustos 2. dönem (MEB takvimine yakın varsayılan; seçilebilir). */
export function defaultTerm(day: string): 1 | 2 {
  const month = Number(day.slice(5, 7))
  return month >= 9 || month === 1 ? 1 : 2
}

/** Ders etkinliklerine katılım puanı yalnız ortaokulda verilir (core `grade_kind_level_mismatch`). */
export function gradeTypeOptions(
  classGrade: number | undefined,
): { value: GradeType; label: string }[] {
  return GRADE_TYPES.filter((type) => type !== 'katilim' || (classGrade ?? 0) <= 8).map(
    (value) => ({
      value,
      label: GRADE_TYPE_LABELS[value],
    }),
  )
}

/**
 * Puan alanının ham değeri: boş alan `undefined` olur (core "Puanı girin" der). Aksi halde
 * `z.coerce.number()` boş metni sessizce 0 yapardı.
 */
export function scoreValue(raw: unknown): number | undefined {
  if (typeof raw === 'number') return Number.isNaN(raw) ? undefined : raw
  if (typeof raw !== 'string' || raw.trim() === '') return undefined
  return Number(raw)
}
