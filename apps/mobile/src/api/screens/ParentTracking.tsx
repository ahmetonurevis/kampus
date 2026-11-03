import { useMemo, useState } from 'react'
import { View } from 'react-native'
import type { State } from '@kampus/school-core/data/seed.ts'
import { useCollectionAll, useCollectionList } from '@kampus/react-shared/use-collection.ts'
import { Badge, Empty, SearchField, T } from '../../ui/components.tsx'
import { EmptyResults, ListRow, Pagination, Screen, Tabs } from '../../ui/SchoolLayout.tsx'
import { useApiSession } from '../auth.tsx'
import { API_PAGE_SIZE, clampPageIndex } from '../list-state.ts'
import { canOpenScreen } from '../pages.ts'
import { parentTabs, resolveParentTab, type ParentTab } from '../parent-tracking.ts'
import { gradeView } from '../presentation.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'
import { resolveChild } from '../session-state.ts'
import { useDebouncedValue } from '../use-debounced-value.ts'
import { useListMemory, useSelectedChild } from '../view-memory.tsx'
import { ParentAttendance } from './parent-attendance.tsx'
import { childOptions, ChildPicker } from './parent-child-picker.tsx'
import { ParentSchedule } from './parent-schedule.tsx'
import { HomeworkList } from './homework-list.tsx'

type StudentRecord = State['students'][number]
type ClassRecord = State['classes'][number]
type GradeRecord = State['grades'][number]

function GradeList({ childId }: { childId: string }) {
  // Arama ve sayfa çocuk bazında ayrı tutulur.
  const { state, setSearch, setIndex } = useListMemory(`veli/akademik-takip/${childId}`)
  const search = useDebouncedValue(state.search)
  const grades = useCollectionList<GradeRecord>('grades', {
    page: state.index + 1,
    pageSize: API_PAGE_SIZE,
    q: search,
    sort: ['-date'],
    filters: { studentId: childId },
  })
  const total = grades.data?.total
  const index = clampPageIndex(state.index, total)
  if (index !== state.index) setIndex(index)
  return (
    <>
      <SearchField value={state.search} onChange={setSearch} placeholder="Ders, konu veya sınav" />
      {grades.error ? (
        <QueryError error={grades.error} onRetry={() => void grades.refetch()} />
      ) : !grades.data ? (
        <ListLoading label="Notlar yükleniyor…" />
      ) : grades.data.rows.length === 0 ? (
        search ? (
          <EmptyResults noun="not" onClear={() => setSearch('')} />
        ) : (
          <Empty title="Henüz not girilmedi" text="Öğretmenler not girdiğinde burada görünür." />
        )
      ) : (
        <View style={{ gap: 10 }} accessibilityRole="list">
          {grades.data.rows.map(({ id, record }) => {
            const view = gradeView(record)
            return (
              <ListRow
                key={id}
                card
                title={view.title}
                subtitle={view.subtitle}
                eyebrow={view.score}
                badge={<Badge text={view.status} />}
              />
            )
          })}
        </View>
      )}
      {total !== undefined && (
        <Pagination count={total} index={index} pageSize={API_PAGE_SIZE} onChange={setIndex} />
      )}
    </>
  )
}

/**
 * Veli: Akademik Takip (web `veli/akademik-takip` ile aynı sekmeler): seçili çocuğun notları,
 * devamsızlığı, haftalık ders programı ve ödevleri. Çocuk seçici bir kez üstte durur, seçim
 * ekranlar arasında korunur (`useSelectedChild`, yalnız bellekte). Çocuklar sunucunun veli
 * kapsamından gelir (yalnız bağlı çocuklar); her sekme verisini `studentId`/`classId` ile ister,
 * sunucu yine yalnız bu velinin çocuklarının kayıtlarını döndürür, istemci süzmez. Kapalı modülün
 * sekmesi çizilmez.
 */
export default function ParentTracking() {
  const session = useApiSession()
  const open = canOpenScreen(session, 'ParentTracking')
  const [selected, setSelected] = useSelectedChild()
  const [requestedTab, setTab] = useState<ParentTab>('notlar')
  const students = useCollectionAll<StudentRecord>('students', {}, { enabled: open })
  const classes = useCollectionAll<ClassRecord>('classes', {}, { enabled: open })
  const options = useMemo(
    () => childOptions(students.data ?? [], classes.data ?? []),
    [students.data, classes.data],
  )
  const childId = resolveChild(
    options.map((option) => option.id),
    selected,
  )
  const classId = students.data?.find((row) => row.id === childId)?.record.classId
  const tabs = parentTabs(session.modules)
  const tab = resolveParentTab(requestedTab, tabs)

  if (!open)
    return (
      <Screen>
        <Empty title="Modül kullanıma kapalı" text="Yönetici modül tercihlerini değiştirebilir." />
      </Screen>
    )
  return (
    <Screen>
      <T muted>Notlar, devamsızlık, ders programı ve ödevler tek bir yerde.</T>
      {students.error ? (
        <QueryError error={students.error} onRetry={() => void students.refetch()} />
      ) : !students.data ? (
        <ListLoading label="Çocuklarınız yükleniyor…" />
      ) : !childId ? (
        <Empty title="Bağlı öğrenci yok" text="Hesabınıza bağlı öğrenci kaydı bulunamadı." />
      ) : (
        <>
          <ChildPicker options={options} value={childId} onChange={setSelected} />
          <Tabs value={tab} onChange={setTab} options={tabs} />
          {tab === 'notlar' ? (
            <GradeList key={childId} childId={childId} />
          ) : tab === 'devamsizlik' ? (
            <ParentAttendance key={childId} childId={childId} />
          ) : !classId ? (
            <Empty
              title="Sınıf atanmamış"
              text="Çocuğunuzun sınıfı atandığında program ve ödevler burada görünür."
            />
          ) : tab === 'program' ? (
            <ParentSchedule key={childId} classId={classId} />
          ) : (
            <HomeworkList
              key={childId}
              student={{ id: childId, classId }}
              listKey={`veli/akademik-takip/odevler/${childId}`}
              audience="parent"
            />
          )}
        </>
      )}
    </Screen>
  )
}
