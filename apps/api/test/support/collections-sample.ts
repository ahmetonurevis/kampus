import { createSeed, type State } from '@kampus/school-core/data/seed.ts'

import { recordKey, type CollectionName } from '../../src/db/collections.ts'
import { FIXED_NOW } from './app.ts'

/** Koleksiyon okuma testlerinin ortak örnek kesiti (örnek veriden, kimlikler değişmez). */
export const SEED: State = createSeed(FIXED_NOW)

export const STUDENT_IDS = ['s1', 's2', 's3', 's11', 's12']
/** Kişisel kayıtların sahibi: veli Ayşe'nin çocukları `s1`, `s2`; başka sınıftan `s11`. */
export const OWNERS = ['s1', 's2', 's11']
export const firstOf = <T extends { studentId: string }>(rows: readonly T[], count: number) =>
  OWNERS.flatMap((id) => rows.filter((row) => row.studentId === id).slice(0, count))

/**
 * Örnek veriden küçük, tutarlı bir kesit. Selin Kaya (`t1`, matematik, rehberlik görevli) `c1`–`c3`
 * şubelerinin rehber öğretmeni; `t2` (Türkçe, rehberlik görevi yok) `c1`–`c3`'te ders verir.
 * `s1` `c1`'de, `s2` `c2`'de, `s3` `c3`'te; `s11` ve `s12` bu öğretmenlerin sınıfları dışında.
 */
export const SAMPLE: Partial<Record<CollectionName, readonly Record<string, unknown>[]>> = {
  subjects: SEED.subjects.slice(0, 3),
  teachers: SEED.teachers.filter((item) => ['t1', 't2'].includes(item.id)),
  classes: SEED.classes.filter((item) => ['c1', 'c2', 'c3'].includes(item.id)),
  assignments: SEED.assignments.filter(
    (item) => ['c1', 'c2', 'c3'].includes(item.classId) && ['t1', 't2'].includes(item.teacherId),
  ),
  students: SEED.students.filter((item) => STUDENT_IDS.includes(item.id)),
  parents: SEED.parents.filter((item) => item.id === 'p1'),
  grades: ['math', 'turkish'].flatMap((subject) =>
    firstOf(
      SEED.grades.filter((item) => item.subjectId === subject),
      2,
    ),
  ),
  attendance: firstOf(SEED.attendance, 2),
  invoices: firstOf(SEED.invoices, 2),
  guidanceCases: SEED.guidanceCases,
  studentGoals: SEED.studentGoals,
  mealMenus: SEED.mealMenus.slice(0, 2),
}

/** Örnek kesitteki satırların kimlikleri, core dizisinin (deponun) sırasıyla. */
export function sampleIds(
  collection: CollectionName,
  keep: (row: Record<string, unknown>) => boolean = () => true,
) {
  return (SAMPLE[collection] ?? [])
    .filter(keep)
    .map((row) => recordKey(collection, row))
    .filter((id): id is string => id !== null)
}
export const ofStudents =
  (...ids: string[]) =>
  (row: Record<string, unknown>) =>
    typeof row.studentId === 'string' && ids.includes(row.studentId)

export function sampleRows() {
  return Object.entries(SAMPLE).flatMap(([collection, items]) =>
    (items ?? []).map((data) => {
      const name = collection as CollectionName
      const id = recordKey(name, data)
      if (id === null) throw new Error(`anahtarsız örnek kayıt: ${collection}`)
      return { collection: name, id, data }
    }),
  )
}
