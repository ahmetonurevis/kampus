import { useMemo } from 'react'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { academicLookups, type AcademicSources } from './academic-rows.ts'

const NONE: readonly never[] = []

/**
 * Akademik ekranların başvuru koleksiyonları (ders, sınıf, öğrenci, öğretmen, kampüs). Hepsi
 * rol kapsamıyla gelir (öğretmen kendi sınıfları ve öğrencileri, öğrenci kendisi, veli
 * çocukları), yani küçük kümelerdir; bütün sayfaları bir kez çekilir ve önbellekten paylaşılır.
 */
export function useAcademicLookups() {
  const subjects = useCoreAll('subjects')
  const classes = useCoreAll('classes')
  const students = useCoreAll('students')
  const teachers = useCoreAll('teachers')
  const branches = useCoreAll('branches')
  const queries = [subjects, classes, students, teachers, branches]

  const sources = useMemo<AcademicSources>(
    () => ({
      subjects: subjects.data ?? NONE,
      classes: classes.data ?? NONE,
      students: students.data ?? NONE,
      teachers: teachers.data ?? NONE,
      branches: branches.data ?? NONE,
    }),
    [subjects.data, classes.data, students.data, teachers.data, branches.data],
  )
  const lookups = useMemo(() => academicLookups(sources), [sources])

  return {
    sources,
    lookups,
    pending: queries.some((query) => query.isPending),
    error: queries.find((query) => query.error)?.error ?? null,
    retry: () => {
      for (const query of queries) if (query.error) void query.refetch()
    },
  }
}
