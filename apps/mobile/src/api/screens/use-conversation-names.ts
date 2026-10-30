import { useMemo } from 'react'
import type { State } from '@kampus/school-core/data/seed.ts'
import { useCollectionAll } from '@kampus/react-shared/use-collection.ts'
import type { PartyNames } from '../communication.ts'
import type { MemberRole } from '../session-state.ts'

type StudentRecord = State['students'][number]
type TeacherRecord = State['teachers'][number]
type ParentRecord = State['parents'][number]

const NONE: readonly never[] = []

/**
 * Yazışma etiketleri için başvuru adları: öğrenciler ve öğretmenler (okuyanın kapsamıyla sunucuda
 * daraltılmış), öğretmende ayrıca veli kayıtları. Öğretmen yazışması kendi öğrencileriyle
 * sınırlı olduğundan öğretmen listesi yalnız öğrenci ve veli için okunur.
 */
export function useConversationNames(role: MemberRole) {
  const students = useCollectionAll<StudentRecord>('students')
  const teachers = useCollectionAll<TeacherRecord>('teachers', {}, { enabled: role !== 'ogretmen' })
  const parents = useCollectionAll<ParentRecord>('parents', {}, { enabled: role === 'ogretmen' })
  const names = useMemo<PartyNames>(() => {
    const parentsByStudent = new Map<string, string[]>()
    for (const row of parents.data ?? NONE)
      for (const id of row.record.studentIds)
        parentsByStudent.set(id, [...(parentsByStudent.get(id) ?? []), row.record.name])
    return {
      students: new Map((students.data ?? NONE).map((row) => [row.record.id, row.record.name])),
      teachers: new Map((teachers.data ?? NONE).map((row) => [row.record.id, row.record.name])),
      parentsByStudent,
    }
  }, [students.data, teachers.data, parents.data])
  return { names, students, teachers }
}
