import { useMemo } from 'react'
import { Pressable, View } from 'react-native'
import type { State } from '@kampus/school-core/data/seed.ts'
import { useCollectionAll, useCollectionList } from '@kampus/react-shared/use-collection.ts'
import { Badge, Empty, SearchField, T, useColors } from '../../ui/components.tsx'
import { EmptyResults, ListRow, Pagination, Screen } from '../../ui/SchoolLayout.tsx'
import { useApiSession } from '../auth.tsx'
import { API_PAGE_SIZE, clampPageIndex } from '../list-state.ts'
import { canOpenScreen } from '../pages.ts'
import { gradeSummary, gradeView, type GradeSummary } from '../presentation.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'
import { useDebouncedValue } from '../use-debounced-value.ts'
import { useListMemory } from '../view-memory.tsx'

type GradeRecord = State['grades'][number]
type SubjectRecord = State['subjects'][number]

const LIST_KEY = 'ogrenci/notlarim'

/**
 * Ders ortalamaları; karta dokununca liste o derse süzülür, aynı karta yeniden dokununca süzgeç
 * kalkar. Kartlar beyaz opak yüzeydir, seçili kart safir çerçeveyle ayrılır.
 */
function SubjectFilter({
  summary,
  value,
  onChange,
}: {
  summary: GradeSummary
  value: string
  onChange: (subjectId: string) => void
}) {
  const c = useColors()
  const options = [
    { subjectId: '', name: 'Genel ortalama', average: summary.overall, count: summary.count },
    ...summary.subjects,
  ]
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Ders ortalamaları"
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}
    >
      {options.map((option) => {
        const selected = option.subjectId === value
        return (
          <Pressable
            key={option.subjectId || 'tum'}
            accessibilityRole="radio"
            accessibilityLabel={`${option.name}: ${option.average}, ${option.count} değerlendirme`}
            accessibilityHint={
              option.subjectId
                ? 'Notları bu derse göre süzer'
                : 'Bütün derslerin notlarını gösterir'
            }
            accessibilityState={{ checked: selected }}
            aria-checked={selected}
            onPress={() => onChange(selected ? '' : option.subjectId)}
            style={({ pressed }) => ({
              flexGrow: 1,
              flexBasis: 140,
              minHeight: 72,
              padding: 14,
              gap: 4,
              borderRadius: 12,
              borderWidth: selected ? 2 : 1,
              borderColor: selected ? c.primary : c.border,
              backgroundColor: c.surface,
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <T muted size={13}>
              {option.name}
            </T>
            <T bold size={18} style={{ color: selected ? c.primary : c.text }}>
              {option.average}
            </T>
            <T muted size={12}>
              {option.count} değerlendirme
            </T>
          </Pressable>
        )
      })}
    </View>
  )
}

/**
 * Öğrenci: kendi notları (web `ogrenci/notlarim`, demo `notlarim` karşılığı). Kapsamı sunucu
 * uygular; öğrenci yalnız kendi not kayıtlarını alır, istemci `studentId` göndermez. Özet bütün
 * notlardan, liste sayfalı sorgudan gelir; ders kartı listeyi `subjectId` ile süzer.
 */
export default function StudentGrades() {
  const session = useApiSession()
  const open = canOpenScreen(session, 'StudentGrades')
  const { state, setSearch, setFilter, setIndex, clear } = useListMemory(LIST_KEY)
  const search = useDebouncedValue(state.search)
  const all = useCollectionAll<GradeRecord>('grades', {}, { enabled: open })
  // Ders adları güncel ders kaydından; ders listesi okunamazsa notun kendi ders adı kalır.
  const subjects = useCollectionAll<SubjectRecord>('subjects', {}, { enabled: open })
  const summary = useMemo(
    () =>
      gradeSummary(
        (all.data ?? []).map((row) => row.record),
        new Map((subjects.data ?? []).map((row) => [row.id, row.record])),
      ),
    [all.data, subjects.data],
  )
  // Kayıtlı süzgeç artık notu olmayan bir derse aitse liste "tümü"ne döner.
  const subjectId =
    all.data && !summary.subjects.some((item) => item.subjectId === state.filter)
      ? ''
      : state.filter
  const grades = useCollectionList<GradeRecord>(
    'grades',
    {
      page: state.index + 1,
      pageSize: API_PAGE_SIZE,
      q: search,
      sort: ['-date'],
      ...(subjectId ? { filters: { subjectId } } : {}),
    },
    { enabled: open },
  )
  const total = grades.data?.total
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
      <T muted>Notların ve ders ortalamaların tek bir yerde.</T>
      {all.error ? (
        <QueryError error={all.error} onRetry={() => void all.refetch()} />
      ) : !all.data ? (
        <ListLoading label="Not özeti yükleniyor…" />
      ) : summary.count === 0 ? null : (
        <SubjectFilter summary={summary} value={subjectId} onChange={setFilter} />
      )}
      <SearchField value={state.search} onChange={setSearch} placeholder="Ders, konu veya sınav" />
      {grades.error ? (
        <QueryError error={grades.error} onRetry={() => void grades.refetch()} />
      ) : !grades.data ? (
        <ListLoading label="Notlar yükleniyor…" />
      ) : grades.data.rows.length === 0 ? (
        search || subjectId ? (
          <EmptyResults noun="not" onClear={clear} />
        ) : (
          <Empty title="Henüz not girilmedi" text="Öğretmenlerin not girdiğinde burada görünür." />
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
    </Screen>
  )
}
