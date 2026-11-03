import { useMemo, useState } from 'react'
import { View } from 'react-native'
import type { CollectionRow } from '@kampus/react-shared/collections.ts'
import { useCollectionAll } from '@kampus/react-shared/use-collection.ts'
import { questionStamp } from '@kampus/react-shared/question-model.ts'
import type { State } from '@kampus/school-core/data/seed.ts'
import { Badge, Button, Empty, SearchField, T } from '../../ui/components.tsx'
import { EmptyResults, ListRow, Pagination, Screen, Tabs } from '../../ui/SchoolLayout.tsx'
import { useApiSession } from '../auth.tsx'
import { API_PAGE_SIZE, clampPageIndex } from '../list-state.ts'
import { canOpenScreen } from '../pages.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'
import {
  QUESTION_GROUP_OPTIONS,
  questionBadgeTone,
  questionEmptyText,
  questionErrorView,
  questionGroupCounts,
  questionLookups,
  studentQuestionRows,
  visibleQuestionRows,
} from '../student-question.ts'
import { useListMemory } from '../view-memory.tsx'
import { QuestionAskSheet } from './question-ask.tsx'
import { QuestionSheet } from './question-sheet.tsx'

type QuestionRecord = State['questions'][number]
type SubjectRecord = State['subjects'][number]
type TeacherRecord = State['teachers'][number]

const LIST_KEY = 'ogrenci/soru-sor'

/**
 * Öğrenci: Öğretmenime Sor (web `ogrenci/soru-sor`; IST-124, DOM-ILT-090…093). Sorular kapsamdan
 * gelir (öğrenci yalnız kendisininkini görür); durum (yanıt bekliyor, yanıtlandı, geri çekildi)
 * kayıttan hesaplanır. Soru sorma ve geri çekme yalnız sunucu yanıtıyla listeye yansır. Soru metni
 * ve taslağı cihaza yazılmaz. Soru fotoğrafı telefonda yoktur (web'de).
 */
export default function StudentQuestions() {
  const session = useApiSession()
  const open = canOpenScreen(session, 'StudentQuestions')
  const questions = useCollectionAll<QuestionRecord>('questions', {}, { enabled: open })
  const subjects = useCollectionAll<SubjectRecord>('subjects', {}, { enabled: open })
  const teachers = useCollectionAll<TeacherRecord>('teachers', {}, { enabled: open })
  const [asking, setAsking] = useState(false)

  if (!open)
    return (
      <Screen>
        <Empty title="Modül kullanıma kapalı" text="Yönetici modül tercihlerini değiştirebilir." />
      </Screen>
    )
  const error = questions.error ?? subjects.error ?? teachers.error
  const loaded = !!questions.data && !!subjects.data && !!teachers.data
  const retry = () => {
    for (const query of [questions, subjects, teachers]) if (query.error) void query.refetch()
  }
  return (
    <Screen>
      <T muted>Aklına takılan soruları ders öğretmenine sor, yanıtı buradan oku.</T>
      <Button primary icon="Plus" onPress={() => setAsking(true)}>
        Yeni soru
      </Button>
      {error && loaded && <QueryError error={error} onRetry={retry} />}
      {questionErrorView(error, loaded) === 'full' && error ? (
        <QueryError error={error} onRetry={retry} />
      ) : !questions.data || !subjects.data || !teachers.data ? (
        <ListLoading label="Sorular yükleniyor…" />
      ) : (
        <QuestionList items={questions.data} subjects={subjects.data} teachers={teachers.data} />
      )}
      {asking && <QuestionAskSheet onClose={() => setAsking(false)} />}
    </Screen>
  )
}

function QuestionList({
  items,
  subjects,
  teachers,
}: {
  items: readonly CollectionRow<QuestionRecord>[]
  subjects: readonly CollectionRow<SubjectRecord>[]
  teachers: readonly CollectionRow<TeacherRecord>[]
}) {
  const { state, setSearch, setFilter, setIndex } = useListMemory(LIST_KEY)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const lookups = useMemo(() => questionLookups(subjects, teachers), [subjects, teachers])
  const rows = useMemo(() => studentQuestionRows(items, lookups), [items, lookups])
  const counts = useMemo(() => questionGroupCounts(rows), [rows])
  const visible = useMemo(
    () => visibleQuestionRows(rows, state.filter, state.search),
    [rows, state.filter, state.search],
  )
  const index = clampPageIndex(state.index, visible.length)
  if (index !== state.index) setIndex(index)
  const page = visible.slice(index * API_PAGE_SIZE, (index + 1) * API_PAGE_SIZE)
  const tabs = QUESTION_GROUP_OPTIONS.map((option) => ({
    value: option.value,
    label: option.value === '' ? option.label : `${option.label} (${counts[option.value]})`,
  }))
  const empty = questionEmptyText(state.filter)
  const selected = selectedId ? rows.find((row) => row.id === selectedId) : undefined

  return (
    <>
      <Tabs value={state.filter} onChange={setFilter} options={tabs} />
      <SearchField
        value={state.search}
        onChange={setSearch}
        placeholder="Konu, ders veya öğretmen"
      />
      {page.length === 0 ? (
        state.search ? (
          <EmptyResults noun="soru" onClear={() => setSearch('')} />
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
              subtitle={`${row.subject} · ${row.teacher}\n${questionStamp(row.createdAt)}`}
              label={`${row.title}, ${row.status}. Ayrıntıyı aç`}
              onPress={() => setSelectedId(row.id)}
              badge={<Badge text={row.status} tone={questionBadgeTone(row.state)} />}
            />
          ))}
        </View>
      )}
      <Pagination
        count={visible.length}
        index={index}
        pageSize={API_PAGE_SIZE}
        onChange={setIndex}
      />
      {selected && <QuestionSheet row={selected} onClose={() => setSelectedId(null)} />}
    </>
  )
}
