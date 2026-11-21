import { useMemo } from 'react'
import { useCoreAll, type CoreRecord } from '@/hooks/use-core-collection.ts'
import type { AcademicLookups } from './academic-rows.ts'
import { teachingClassIds } from './academic-write.ts'

export type TeacherScope = {
  /** Öğretmenin kimliği; `teachers` okuması yalnız kendi kaydını döndürür. */
  teacherId: string
  /** Rol kapsamındaki ders atamaları (sınıfın diğer öğretmenlerinin atamaları da gelir). */
  assignments: readonly Pick<CoreRecord<'assignments'>, 'classId' | 'subjectId' | 'teacherId'>[]
  /** Ders verilen sınıflar: yoklama ve not girişi yalnız bunlarda yapılır. */
  classIds: ReadonlySet<string>
  pending: boolean
  error: unknown
  retry: () => void
}

const NONE: TeacherScope['assignments'] = []

/** Öğretmenin yazma kapsamı: ders atamalarından türetilir; yetkiyi sunucu yine denetler. */
export function useTeacherScope(lookups: AcademicLookups, enabled = true): TeacherScope {
  const query = useCoreAll('assignments', {}, { enabled })
  const teacherId = [...lookups.teachers.keys()][0] ?? ''
  const assignments = useMemo(() => query.data?.map((row) => row.record) ?? NONE, [query.data])
  const classIds = useMemo(() => teachingClassIds(assignments, teacherId), [assignments, teacherId])
  return {
    teacherId,
    assignments,
    classIds,
    pending: enabled && query.isPending,
    error: query.error,
    retry: () => void query.refetch(),
  }
}
