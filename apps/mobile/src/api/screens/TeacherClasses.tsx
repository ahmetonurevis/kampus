import { useMemo } from 'react'
import { View } from 'react-native'
import type { State } from '@kampus/school-core/data/seed.ts'
import { useCollectionAll, useCollectionList } from '@kampus/react-shared/use-collection.ts'
import { Badge, Empty, SearchField, T } from '../../ui/components.tsx'
import { EmptyResults, ListRow, Pagination, Screen } from '../../ui/SchoolLayout.tsx'
import { useApiSession } from '../auth.tsx'
import { API_PAGE_SIZE, clampPageIndex } from '../list-state.ts'
import { canOpenScreen } from '../pages.ts'
import { classSubtitle } from '../presentation.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'
import { useDebouncedValue } from '../use-debounced-value.ts'
import { useListMemory } from '../view-memory.tsx'

type ClassRecord = State['classes'][number]
type BranchRecord = State['branches'][number]

/** Sınıf mevcudu sunucudan (kapsamlı öğrenci listesinin toplamı); mobilde sayılmaz. */
function StudentCount({ classId }: { classId: string }) {
  const count = useCollectionList('students', { pageSize: 1, filters: { classId } })
  if (!count.data) return null
  return (
    <T muted size={13}>
      {count.data.total} öğrenci
    </T>
  )
}

/**
 * Öğretmenin sınıfları (demo `siniflarim` karşılığı). Hangi sınıfların görüneceği sunucudaki
 * kapsamdan gelir (ders verdiği ve rehberi olduğu sınıflar); istemci süzmez.
 */
export default function TeacherClasses() {
  const session = useApiSession()
  const open = canOpenScreen(session, 'TeacherClasses')
  const { state, setSearch, setIndex } = useListMemory('ogretmen/siniflarim')
  const search = useDebouncedValue(state.search)
  const classes = useCollectionList<ClassRecord>(
    'classes',
    { page: state.index + 1, pageSize: API_PAGE_SIZE, q: search, sort: ['name'] },
    { enabled: open },
  )
  const branches = useCollectionAll<BranchRecord>('branches', {}, { enabled: open })
  const branchNames = useMemo(
    () => new Map((branches.data ?? []).map((row) => [row.id, row.record.name])),
    [branches.data],
  )
  const total = classes.data?.total
  const index = clampPageIndex(state.index, total)
  if (index !== state.index) setIndex(index)

  if (!open)
    return (
      <Screen>
        <Empty title="Modül kullanıma kapalı" text="Yönetici modül tercihlerini değiştirebilir." />
      </Screen>
    )
  return (
    <Screen>
      <T muted>Sınıflarınız ve öğrencileriniz bir arada.</T>
      <SearchField value={state.search} onChange={setSearch} placeholder="Sınıf adı veya düzey" />
      {classes.error ? (
        <QueryError error={classes.error} onRetry={() => void classes.refetch()} />
      ) : !classes.data ? (
        <ListLoading label="Sınıflar yükleniyor…" />
      ) : classes.data.rows.length === 0 ? (
        search ? (
          <EmptyResults noun="sınıf" onClear={() => setSearch('')} />
        ) : (
          <Empty title="Size atanmış sınıf yok" text="Sınıf atamaları yönetimden yapılır." />
        )
      ) : (
        <View style={{ gap: 10 }} accessibilityRole="list">
          {classes.data.rows.map(({ id, record }) => (
            <ListRow
              key={id}
              card
              title={record.name}
              subtitle={classSubtitle(record, branchNames.get(record.branchId))}
              badge={<Badge text={record.isActive === false ? 'Arşivde' : 'Aktif'} />}
            >
              <StudentCount classId={id} />
            </ListRow>
          ))}
        </View>
      )}
      {total !== undefined && (
        <Pagination count={total} index={index} pageSize={API_PAGE_SIZE} onChange={setIndex} />
      )}
    </Screen>
  )
}
