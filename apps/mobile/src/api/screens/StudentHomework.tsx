import type { State } from '@kampus/school-core/data/seed.ts'
import { useCollectionAll } from '@kampus/react-shared/use-collection.ts'
import { Empty, T } from '../../ui/components.tsx'
import { Screen } from '../../ui/SchoolLayout.tsx'
import { useApiSession } from '../auth.tsx'
import { canOpenScreen } from '../pages.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'
import { HomeworkList } from './homework-list.tsx'

type StudentRecord = State['students'][number]

const LIST_KEY = 'ogrenci/odevler'

/**
 * Öğrenci: ödevlerim (web `ogrenci/odevler` sınıf ödevleri bölümü). Öğrenci kaydı kapsamdan gelir
 * (öğrencide tek kayıt döner); ödevler öğrencinin sınıfından istenir, sunucu yine yalnız kendi
 * sınıfının ödevlerini döndürür (DOM-AKD-074). Durum ve puan salt okunur; teslim web'dedir.
 */
export default function StudentHomework() {
  const session = useApiSession()
  const open = canOpenScreen(session, 'StudentHomework')
  const students = useCollectionAll<StudentRecord>('students', {}, { enabled: open })
  const student = students.data?.[0]?.record

  if (!open)
    return (
      <Screen>
        <Empty title="Modül kullanıma kapalı" text="Yönetici modül tercihlerini değiştirebilir." />
      </Screen>
    )
  return (
    <Screen>
      <T muted>Ödevlerin, son tarihleri ve değerlendirmeleri.</T>
      {students.error ? (
        <QueryError error={students.error} onRetry={() => void students.refetch()} />
      ) : !students.data ? (
        <ListLoading label="Öğrenci bilgileri yükleniyor…" />
      ) : !student ? (
        <Empty title="Öğrenci kaydı bulunamadı" text="Hesabına bağlı öğrenci kaydı görünmüyor." />
      ) : !student.classId ? (
        <Empty title="Sınıf atanmamış" text="Sınıfın atandığında ödevlerin burada görünür." />
      ) : (
        <HomeworkList student={student} listKey={LIST_KEY} audience="student" />
      )}
    </Screen>
  )
}
