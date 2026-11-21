import { use, useMemo } from 'react'
import { useAuth } from '@/auth/use-auth.ts'
import { useCoreAll, type CoreRecord } from '@/hooks/use-core-collection.ts'
import { ViewScopeContext } from '@/layout/view-scope.ts'

type Student = CoreRecord<'students'>

/**
 * Öğrenme ekranının öğrencisi: öğrencide kendi kaydı (kapsam tek öğrenci döndürür), veli
 * çocuk seçicisinde seçili çocuk (`ViewScopeContext`). Kayıt gelene kadar `student` boştur.
 * Kapsamı sunucu uygular; seçilen çocuk velinin bağlı çocuğu değilse kayıt bulunamaz.
 */
export function useLearningStudent() {
  const { session } = useAuth()
  const childId = use(ViewScopeContext)
  const students = useCoreAll('students')
  const parent = session?.role === 'veli'
  const student = useMemo<Student | undefined>(() => {
    const rows = students.data
    if (!rows) return undefined
    if (parent) return rows.find((row) => row.record.id === childId)?.record
    return rows[0]?.record
  }, [students.data, parent, childId])
  return {
    student,
    /** Veli hesabında bağlı çocuk yok. */
    noChild: parent && childId === '',
    isPending: students.isPending,
    error: students.error,
    retry: () => void students.refetch(),
  } as const
}
