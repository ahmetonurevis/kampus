import { useMemo } from 'react'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { managementLookups, type ManagementSources } from './management-rows.ts'

const NONE: readonly never[] = []

/**
 * Yönetim ekranlarının başvuru koleksiyonları (kampüs, sınıf, öğretmen, ders, atama; isteğe
 * bağlı öğrenci). Küçük kurum verisidir; bütün sayfaları bir kez çekilir ve 30 sn taze kalır.
 * TODO(api-aggregate): sınıf/kampüs sayımları için toplu uç gelince öğrenci listesi çekilmez.
 */
export function useManagementLookups({ students: withStudents = false } = {}) {
  const branches = useCoreAll('branches')
  const classes = useCoreAll('classes')
  const teachers = useCoreAll('teachers')
  const subjects = useCoreAll('subjects')
  const assignments = useCoreAll('assignments')
  const students = useCoreAll('students', {}, { enabled: withStudents })
  // Kapalı sorgu (öğrenci istenmediyse) hep "bekliyor" görünür; hesaba katılmaz.
  const queries: { isPending: boolean; error: unknown; refetch: () => Promise<unknown> }[] = [
    branches,
    classes,
    teachers,
    subjects,
    assignments,
    ...(withStudents ? [students] : []),
  ]

  const sources = useMemo<ManagementSources>(
    () => ({
      branches: branches.data ?? NONE,
      classes: classes.data ?? NONE,
      teachers: teachers.data ?? NONE,
      subjects: subjects.data ?? NONE,
      assignments: assignments.data ?? NONE,
      students: students.data ?? NONE,
    }),
    [branches.data, classes.data, teachers.data, subjects.data, assignments.data, students.data],
  )
  const lookups = useMemo(() => managementLookups(sources), [sources])

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
