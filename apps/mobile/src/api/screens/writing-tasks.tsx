import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { isLearnerAssignment } from '@kampus/react-shared/student-task-model.ts'
import { useLearnerAssignments } from '@kampus/react-shared/use-learner-task-progress.ts'
import { Badge, Empty, SearchField, T } from '../../ui/components.tsx'
import { EmptyResults, ListRow, Pagination } from '../../ui/SchoolLayout.tsx'
import { useNow } from '../../ui/use-now.ts'
import { API_PAGE_SIZE, clampPageIndex } from '../list-state.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'
import { teacherTasks, writingTaskMatches, writingTaskRow } from '../student-writing.ts'
import { useListMemory } from '../view-memory.tsx'
import { WritingSheet } from './writing-sheet.tsx'

/**
 * Öğrenci: Ödevlerim > Görevler (web `StudentTaskSection` `mode="teacher"`; IST-124). Öğretmen puanlı
 * görevler listelenir; durum, hak ve açılmış puan atama listesinin kursiyer özetinden gelir, kapsamı
 * sunucu uygular. Yalnız yazma görevi dokununca açılır (`writing-sheet.tsx`); konuşma ve el yazısı
 * görevleri telefonda yalnız listelenir. Arama ve sayfa yalnız bellekte tutulur.
 */
export function StudentWritingTasks() {
  const { state, setSearch, setIndex } = useListMemory('ogrenci/odevler/gorevler')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const assignments = useLearnerAssignments()
  const now = useNow()
  const items = useMemo(
    () => teacherTasks(assignments.items.filter(isLearnerAssignment)),
    [assignments.items],
  )
  const visible = useMemo(
    () =>
      assignments.isReady
        ? items
            .map((item) => writingTaskRow(item, now))
            .filter((row) => writingTaskMatches(row, state.search))
        : undefined,
    [assignments.isReady, items, now, state.search],
  )
  const total = visible?.length
  const index = clampPageIndex(state.index, total)
  if (index !== state.index) setIndex(index)
  const page = visible?.slice(index * API_PAGE_SIZE, (index + 1) * API_PAGE_SIZE)
  const incomplete = assignments.isLoadingMore || assignments.truncated

  return (
    <>
      <SearchField value={state.search} onChange={setSearch} placeholder="Görev veya tür" />
      {assignments.error && !assignments.isReady ? (
        <QueryError error={assignments.error} onRetry={() => void assignments.refetch()} />
      ) : !page || (page.length === 0 && assignments.isLoadingMore) ? (
        <ListLoading label="Görevler yükleniyor…" />
      ) : page.length === 0 ? (
        state.search ? (
          <EmptyResults noun="görev" onClear={() => setSearch('')} />
        ) : incomplete ? null : (
          <Empty
            title="Atanmış görev yok"
            text="Öğretmenin yazma ya da konuşma görevi atadığında burada görünür."
          />
        )
      ) : (
        <View style={{ gap: 10 }} accessibilityRole="list">
          {page.map((row) => (
            <ListRow
              key={row.id}
              card
              title={row.title}
              subtitle={row.subtitle}
              eyebrow={row.score ? `Puan ${row.score}` : undefined}
              label={row.label}
              {...(row.writable ? { onPress: () => setSelectedId(row.id) } : {})}
              badge={<Badge text={row.status} tone={row.tone} />}
            />
          ))}
        </View>
      )}
      {assignments.truncated && (
        <T muted size={13} accessibilityRole="alert">
          Bütün görevler yüklenemedi; liste eksik olabilir.
        </T>
      )}
      {total !== undefined && (
        <Pagination count={total} index={index} pageSize={API_PAGE_SIZE} onChange={setIndex} />
      )}
      {selectedId && (
        <WritingSheet
          key={selectedId}
          assignmentId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </>
  )
}
