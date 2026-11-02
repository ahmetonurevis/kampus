import { number } from '@kampus/school-core/lib/format.ts'
import { useCoreCounts } from '@/hooks/use-core-collection.ts'
import { combineStates, StatCard, StatGrid } from '../dashboard/DashboardParts.tsx'

const ACTIVE = { isActive: 'true' } as const

/**
 * Yönetim sayfalarının üst özet kartları (Vue `SchoolManagement.vue` `stats-three`). Değerler
 * sunucu sayımıdır (`counts`): kurum ve kampüs kapsamı API'de uygulanır, sayfanın arama ve
 * süzgeçlerinden bağımsızdır; yalnız aktif kayıtlar sayılır. Liste çekilmez.
 */
function useActiveCount(collection: 'branches' | 'classes' | 'students' | 'teachers') {
  return useCoreCounts(collection, { groupBy: 'isActive', filters: ACTIVE })
}

/** Kampüsler & Sınıflar: aktif kampüs, aktif sınıf, aktif öğrenci. */
export function CampusStats() {
  const branches = useActiveCount('branches')
  const classes = useActiveCount('classes')
  const students = useActiveCount('students')
  return (
    <StatGrid label="Kampüs ve sınıf özeti">
      <StatCard
        label="Aktif kampüs"
        icon="Building2"
        value={number(branches.data?.total ?? 0)}
        state={combineStates(branches)}
      />
      <StatCard
        label="Aktif sınıf"
        icon="BookOpen"
        value={number(classes.data?.total ?? 0)}
        note="Ortaokul ve lise"
        state={combineStates(classes)}
      />
      <StatCard
        label="Aktif öğrenci"
        icon="GraduationCap"
        value={number(students.data?.total ?? 0)}
        note="Tüm kampüslerde"
        state={combineStates(students)}
      />
    </StatGrid>
  )
}

/** Eğitim Kadrosu: aktif kadro, ders branşı (aktif kadronun farklı dersleri), aktif öğrenci. */
export function StaffStats() {
  const teachers = useActiveCount('teachers')
  const subjects = useCoreCounts('teachers', { groupBy: 'subjectId', filters: ACTIVE })
  const students = useActiveCount('students')
  const subjectCount = subjects.data?.groups.filter((group) => group.value !== null).length ?? 0
  return (
    <StatGrid label="Eğitim kadrosu özeti">
      <StatCard
        label="Aktif eğitim kadrosu"
        icon="UsersRound"
        value={number(teachers.data?.total ?? 0)}
        state={combineStates(teachers)}
      />
      <StatCard
        label="Ders branşı"
        icon="BookOpen"
        value={number(subjectCount)}
        note="Ortaokul ve lise"
        state={combineStates(subjects)}
      />
      <StatCard
        label="Aktif öğrenci"
        icon="GraduationCap"
        value={number(students.data?.total ?? 0)}
        note="Tüm kampüslerde"
        state={combineStates(students)}
      />
    </StatGrid>
  )
}
