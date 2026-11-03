import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { toApiError } from '@kampus/api-client/errors.ts'
import { useAllQuizzes } from '@kampus/react-shared/use-quizzes.ts'
import { useCollectionAll } from '@kampus/react-shared/use-collection.ts'
import type { State } from '@kampus/school-core/data/seed.ts'
import { Badge, Empty, SearchField, T } from '../../ui/components.tsx'
import { EmptyResults, ListRow, Pagination, Screen, Tabs } from '../../ui/SchoolLayout.tsx'
import { useApiSession } from '../auth.tsx'
import { API_PAGE_SIZE, clampPageIndex } from '../list-state.ts'
import { canOpenScreen } from '../pages.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'
import {
  QUIZ_GROUP_OPTIONS,
  quizEmptyText,
  quizGroupCounts,
  quizRow,
  visibleQuizRows,
} from '../student-quiz.ts'
import { useListMemory } from '../view-memory.tsx'
import { QuizSheet } from './quiz-sheet.tsx'

type StudentRecord = State['students'][number]

const LIST_KEY = 'ogrenci/soru-coz'

/**
 * Öğrenci: Quiz & Testler (web `ogrenci/soru-coz` sınıf quizleri bölümü; IST-095). Sınıfın quizleri
 * `/quizzes` ucundan, deneme durumu ve puan sunucunun cevaplardan hesapladığı sonuçtan gelir;
 * telefon puan hesaplamaz. Açık, tamamlanan ve süresi geçen quizler sekmelerle ayrılır; arama ve
 * sayfa bellekte korunur. Quiz görevleri (soru bankası görevleri) ve soru sor/çöz web'dedir.
 */
export default function StudentQuizzes() {
  const session = useApiSession()
  const open = canOpenScreen(session, 'StudentQuizzes')
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
      <T muted>Sınıfının quizlerini çöz, sonuçlarını gör.</T>
      {students.error ? (
        <QueryError error={students.error} onRetry={() => void students.refetch()} />
      ) : !students.data ? (
        <ListLoading label="Öğrenci bilgileri yükleniyor…" />
      ) : !student ? (
        <Empty title="Öğrenci kaydı bulunamadı" text="Hesabına bağlı öğrenci kaydı görünmüyor." />
      ) : !student.classId ? (
        <Empty title="Sınıf atanmamış" text="Sınıfın atandığında quizlerin burada görünür." />
      ) : (
        <QuizList student={{ id: student.id, classId: student.classId }} />
      )}
    </Screen>
  )
}

function QuizList({ student }: { student: { id: string; classId: string } }) {
  const { state, setSearch, setFilter, setIndex } = useListMemory(LIST_KEY)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const quizzes = useAllQuizzes({ classId: student.classId })
  const rows = useMemo(
    () => quizzes.data?.map((item) => quizRow(item, student.id)),
    [quizzes.data, student.id],
  )
  const counts = useMemo(() => (rows ? quizGroupCounts(rows) : undefined), [rows])
  const visible = useMemo(
    () => rows && visibleQuizRows(rows, state.filter, state.search),
    [rows, state.filter, state.search],
  )
  const total = visible?.length
  const index = clampPageIndex(state.index, total)
  if (index !== state.index) setIndex(index)
  const page = visible?.slice(index * API_PAGE_SIZE, (index + 1) * API_PAGE_SIZE)
  // Düz `useQuery`: hata türü tek tutulsun diye `ApiError`'a çevrilir.
  const error = quizzes.error ? toApiError(quizzes.error) : undefined
  const tabs = QUIZ_GROUP_OPTIONS.map((option) => ({
    value: option.value,
    label:
      counts && option.value !== '' ? `${option.label} (${counts[option.value]})` : option.label,
  }))
  const empty = quizEmptyText(state.filter)

  return (
    <>
      <Tabs value={state.filter} onChange={setFilter} options={tabs} />
      <SearchField value={state.search} onChange={setSearch} placeholder="Quiz veya ders" />
      {error ? (
        <QueryError error={error} onRetry={() => void quizzes.refetch()} />
      ) : !page ? (
        <ListLoading label="Quizler yükleniyor…" />
      ) : page.length === 0 ? (
        state.search ? (
          <EmptyResults noun="quiz" onClear={() => setSearch('')} />
        ) : (
          <Empty title={empty.title} text={empty.text} />
        )
      ) : (
        <View style={{ gap: 10 }} accessibilityRole="list">
          {page.map((row) => (
            <ListRow
              key={row.id}
              card
              title={row.title}
              subtitle={`${row.subtitle}\n${row.due}`}
              eyebrow={row.score ? `Puan ${row.score}` : undefined}
              label={`${row.title}, ${row.badge}. ${row.resumable ? 'Devam et' : row.startable ? 'Ayrıntıyı aç ve başlat' : 'Ayrıntıyı aç'}`}
              onPress={() => setSelectedId(row.id)}
              badge={<Badge text={row.badge} />}
            />
          ))}
        </View>
      )}
      {total !== undefined && (
        <Pagination count={total} index={index} pageSize={API_PAGE_SIZE} onChange={setIndex} />
      )}
      {selectedId && (
        <QuizSheet
          key={selectedId}
          quizId={selectedId}
          studentId={student.id}
          onClose={() => setSelectedId(null)}
        />
      )}
    </>
  )
}
