import { useMemo, useState } from 'react'
import { Platform, View } from 'react-native'
import { isLearnerAssignment } from '@kampus/react-shared/student-task-model.ts'
import { useLearnerAssignments } from '@kampus/react-shared/use-learner-task-progress.ts'
import { Badge, Empty, SearchField, T } from '../../ui/components.tsx'
import { EmptyResults, ListRow, Pagination } from '../../ui/SchoolLayout.tsx'
import { useNow } from '../../ui/use-now.ts'
import { API_PAGE_SIZE, clampPageIndex } from '../list-state.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'
import { studentTaskRow, type StudentTaskRow } from '../student-quiz-task.ts'
import { writingTaskMatches } from '../student-writing.ts'
import { useListMemory } from '../view-memory.tsx'
import { TaskQuizSheet } from './task-quiz-sheet.tsx'
import { SpeakingSheet } from './speaking-sheet.tsx'
import { WritingSheet } from './writing-sheet.tsx'

/** Telefon ses kaydı alabilir; web dışa aktarımında kayıt yoktur, görev "web'den çözülür" kalır. */
const CAN_RECORD = Platform.OS !== 'web'

/** Açılabilir satır dokununca ilgili pencereyi seçer; açılmayan satır yalnız bilgidir. */
const openProps = (
  row: StudentTaskRow,
  select: (value: { id: string; open: 'writing' | 'quiz' | 'speaking' }) => void,
) => {
  const open = row.open
  return open ? { onPress: () => select({ id: row.id, open }) } : {}
}

/**
 * Öğrenci: Ödevlerim > Görevler (web `StudentTaskSection`; IST-124). Öğretmen puanlı ve otomatik
 * puanlı görevler tek listededir; durum, hak ve açılmış puan atama listesinin kursiyer özetinden
 * gelir, kapsamı sunucu uygular. Yazma görevi `writing-sheet.tsx`, açılabilir quiz görevi
 * `task-quiz-sheet.tsx`, konuşma görevi `speaking-sheet.tsx` penceresini açar (`studentTaskRow`);
 * el yazısı, dinlemeli görevler ve kayıt alamayan cihazda konuşma satırda "web'den çözülür" kalır. Arama ve sayfa yalnız bellekte tutulur.
 */
export function StudentTasks() {
  const { state, setSearch, setIndex } = useListMemory('ogrenci/odevler/gorevler')
  const [selected, setSelected] = useState<{
    id: string
    open: 'writing' | 'quiz' | 'speaking'
  } | null>(null)
  const assignments = useLearnerAssignments()
  const now = useNow()
  const items = useMemo(() => assignments.items.filter(isLearnerAssignment), [assignments.items])
  const visible = useMemo(
    () =>
      assignments.isReady
        ? items
            .map((item) => studentTaskRow(item, now, { canRecord: CAN_RECORD }))
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
            text="Öğretmenin yazma, quiz ya da konuşma görevi atadığında burada görünür."
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
              {...openProps(row, setSelected)}
              badge={<Badge text={row.status} tone={row.tone} />}
            >
              {!!row.note && (
                <T muted size={13}>
                  {row.note}
                </T>
              )}
            </ListRow>
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
      {selected?.open === 'writing' && (
        <WritingSheet
          key={selected.id}
          assignmentId={selected.id}
          onClose={() => setSelected(null)}
        />
      )}
      {selected?.open === 'speaking' && (
        <SpeakingSheet
          key={selected.id}
          assignmentId={selected.id}
          onClose={() => setSelected(null)}
        />
      )}
      {selected?.open === 'quiz' && (
        <TaskQuizSheet
          key={selected.id}
          assignmentId={selected.id}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  )
}
