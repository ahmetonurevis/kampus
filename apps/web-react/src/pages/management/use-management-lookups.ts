import { useMemo } from 'react'
import { useCoreAll, useCoreCounts } from '@/hooks/use-core-collection.ts'
import {
  managementLookups,
  studentCountsByClass,
  type ManagementSources,
} from './management-rows.ts'

const NONE: readonly never[] = []

/**
 * Yönetim ekranlarının başvuru koleksiyonları (kampüs, sınıf, öğretmen, ders, atama; isteğe
 * bağlı sınıf başına aktif öğrenci sayısı). Küçük kurum verisidir; bütün sayfaları bir kez
 * çekilir. Öğrenci sayıları öğrenci listesi çekilmeden `counts?groupBy=classId` ile gelir.
 */
export function useManagementLookups({ studentCounts: withCounts = false } = {}) {
  const branches = useCoreAll('branches')
  const classes = useCoreAll('classes')
  const teachers = useCoreAll('teachers')
  const subjects = useCoreAll('subjects')
  const assignments = useCoreAll('assignments')
  const counts = useCoreCounts(
    'students',
    { groupBy: 'classId', filters: { isActive: 'true' } },
    { enabled: withCounts },
  )
  // Kapalı sorgu (sayım istenmediyse) hep "bekliyor" görünür; hesaba katılmaz.
  const queries: { isPending: boolean; error: unknown; refetch: () => Promise<unknown> }[] = [
    branches,
    classes,
    teachers,
    subjects,
    assignments,
    ...(withCounts ? [counts] : []),
  ]

  const sources = useMemo<ManagementSources>(
    () => ({
      branches: branches.data ?? NONE,
      classes: classes.data ?? NONE,
      teachers: teachers.data ?? NONE,
      subjects: subjects.data ?? NONE,
      assignments: assignments.data ?? NONE,
    }),
    [branches.data, classes.data, teachers.data, subjects.data, assignments.data],
  )
  const lookups = useMemo(
    () => managementLookups(sources, counts.data ? studentCountsByClass(counts.data) : undefined),
    [sources, counts.data],
  )

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
