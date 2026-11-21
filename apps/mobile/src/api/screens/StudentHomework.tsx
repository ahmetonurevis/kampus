import { useState } from 'react'
import type { State } from '@kampus/school-core/data/seed.ts'
import { useCollectionAll } from '@kampus/react-shared/use-collection.ts'
import { Empty, T } from '../../ui/components.tsx'
import { Screen, Tabs } from '../../ui/SchoolLayout.tsx'
import { useApiSession } from '../auth.tsx'
import { canOpenScreen } from '../pages.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'
import { HomeworkList } from './homework-list.tsx'
import { StudentTasks } from './student-tasks.tsx'

type StudentRecord = State['students'][number]

const LIST_KEY = 'ogrenci/odevler'

type Tab = 'odevler' | 'gorevler'
const TABS: readonly { value: Tab; label: string }[] = [
  { value: 'odevler', label: 'Ödevler' },
  { value: 'gorevler', label: 'Görevler' },
]

/** Sınıf ödevleri sekmesi: öğrenci kaydı ve sınıfı gelince ödev listesi. */
function ClassHomework() {
  const students = useCollectionAll<StudentRecord>('students')
  const student = students.data?.[0]?.record
  return students.error ? (
    <QueryError error={students.error} onRetry={() => void students.refetch()} />
  ) : !students.data ? (
    <ListLoading label="Öğrenci bilgileri yükleniyor…" />
  ) : !student ? (
    <Empty title="Öğrenci kaydı bulunamadı" text="Hesabına bağlı öğrenci kaydı görünmüyor." />
  ) : !student.classId ? (
    <Empty title="Sınıf atanmamış" text="Sınıfın atandığında ödevlerin burada görünür." />
  ) : (
    <HomeworkList student={student} listKey={LIST_KEY} audience="student" />
  )
}

/**
 * Öğrenci: ödevlerim (web `ogrenci/odevler`). İki sekme: sınıf ödevleri ve öğretmen puanlı görevler.
 * Sınıf ödevlerinde öğrenci kaydı kapsamdan gelir (öğrencide tek kayıt döner); ödevler öğrencinin
 * sınıfından istenir, sunucu yine yalnız kendi sınıfının ödevlerini döndürür (DOM-AKD-074). Durum ve
 * puan salt okunur; teslim ayrıntı penceresindedir (`homework-submission.tsx`). Görevler sekmesi
 * (`student-tasks.tsx`) web'deki görev bölümleridir; yazma görevi telefonda yazılır, taslağı
 * kaydedilir ve teslim edilir (IST-047); dinlemesiz quiz görevi çözülür ve teslim edilir (IST-051, IST-124).
 */
export default function StudentHomework() {
  const session = useApiSession()
  const open = canOpenScreen(session, 'StudentHomework')
  const [tab, setTab] = useState<Tab>('odevler')

  if (!open)
    return (
      <Screen>
        <Empty title="Modül kullanıma kapalı" text="Yönetici modül tercihlerini değiştirebilir." />
      </Screen>
    )
  return (
    <Screen>
      <T muted>Ödevlerin, yazma görevlerin, son tarihleri ve değerlendirmeleri.</T>
      <Tabs value={tab} onChange={setTab} options={TABS} />
      {tab === 'odevler' ? <ClassHomework /> : <StudentTasks />}
    </Screen>
  )
}
