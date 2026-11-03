import { useMemo } from 'react'
import { Pressable, View } from 'react-native'
import type { State } from '@kampus/school-core/data/seed.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { useCurrentAcademicPeriod } from '@kampus/react-shared/use-academic-years.ts'
import { useCollectionAll, useCollectionList } from '@kampus/react-shared/use-collection.ts'
import { Badge, Empty, T, useColors } from '../../ui/components.tsx'
import { EmptyResults, ListRow, Pagination } from '../../ui/SchoolLayout.tsx'
import { API_PAGE_SIZE, clampPageIndex } from '../list-state.ts'
import {
  ATTENDANCE_STATUSES,
  attendanceCounts,
  attendanceLabel,
  attendanceRangeFilters,
  attendanceRangeLabel,
  attendanceRanges,
  attendanceView,
  decodeAttendanceFilter,
  encodeAttendanceFilter,
  resolveAttendanceRange,
  type AttendanceCounts,
  type AttendanceStatus,
  type AttendanceRange,
  type CurrentTerm,
} from '../parent-tracking.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'
import { useListMemory } from '../view-memory.tsx'

type AttendanceRecord = State['attendance'][number]

/**
 * Katılım özeti; kart seçili durumun listesini süzer, aynı karta yeniden dokununca süzgeç kalkar
 * (öğrenci notlarındaki ders kartlarıyla aynı kalıp). Sayılar çocuğun bütün yoklama kayıtlarından
 * hesaplanır, liste süzgecinden etkilenmez.
 */
function StatusFilter({
  counts,
  value,
  onChange,
}: {
  counts: AttendanceCounts
  value: AttendanceStatus | ''
  onChange: (status: AttendanceStatus | '') => void
}) {
  const c = useColors()
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Devam özeti"
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}
    >
      {ATTENDANCE_STATUSES.map((status) => {
        const selected = status === value
        const label = attendanceLabel(status)
        return (
          <Pressable
            key={status}
            accessibilityRole="radio"
            accessibilityLabel={`${label}: ${counts[status]} kayıt`}
            accessibilityHint={selected ? 'Süzgeci kaldırır' : 'Geçmişi bu duruma göre süzer'}
            accessibilityState={{ checked: selected }}
            aria-checked={selected}
            onPress={() => onChange(selected ? '' : status)}
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
              {label}
            </T>
            <T bold size={18} style={{ color: selected ? c.primary : c.text }}>
              {counts[status]}
            </T>
          </Pressable>
        )
      })}
    </View>
  )
}

/**
 * Tarih aralığı süzgeci (bu dönem / son 30 gün / tümü). Seçim listenin tek süzgeç alanındadır:
 * değişince sayfa başa döner. "Bu dönem" yalnız günün dönemi varken sunulur.
 */
function RangeFilter({
  ranges,
  value,
  onChange,
}: {
  ranges: readonly AttendanceRange[]
  value: AttendanceRange
  onChange: (range: AttendanceRange) => void
}) {
  const c = useColors()
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Tarih aralığı"
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
    >
      {ranges.map((range) => {
        const selected = range === value
        const label = attendanceRangeLabel(range)
        return (
          <Pressable
            key={range}
            accessibilityRole="radio"
            accessibilityLabel={label}
            accessibilityState={{ checked: selected }}
            aria-checked={selected}
            onPress={() => onChange(range)}
            style={({ pressed }) => ({
              minHeight: 48,
              justifyContent: 'center',
              paddingHorizontal: 16,
              borderRadius: 24,
              borderWidth: selected ? 2 : 1,
              borderColor: selected ? c.primary : c.border,
              backgroundColor: c.surface,
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <T bold={selected} size={14} style={{ color: selected ? c.primary : c.text }}>
              {label}
            </T>
          </Pressable>
        )
      })}
    </View>
  )
}

/**
 * Veli: seçili çocuğun devamsızlık özeti ve katılım geçmişi (web Akademik Takip "Devamsızlık"
 * sekmesi). Kayıtlar `studentId` ve tarih aralığıyla (`dateFrom`/`dateTo`, Europe/Istanbul günü) istenir;
 * sunucu yine yalnız bu velinin çocuklarının kayıtlarını döndürür. Yalnız okuma; mazeret bildirimi web'dedir.
 */
export function ParentAttendance({ childId }: { childId: string }) {
  const { state, setFilter, setIndex, clear } = useListMemory(
    `veli/akademik-takip/devamsizlik/${childId}`,
  )
  const period = useCurrentAcademicPeriod()
  const term: CurrentTerm = period.data?.data.term ?? null
  const decoded = decodeAttendanceFilter(state.filter)
  const status = decoded.status
  const range = resolveAttendanceRange(decoded.range, term)
  const rangeFilters = attendanceRangeFilters(range, dayKey(), term)
  const all = useCollectionAll<AttendanceRecord>('attendance', { filters: { studentId: childId } })
  const counts = useMemo(
    () => attendanceCounts((all.data ?? []).map((row) => row.record)),
    [all.data],
  )
  const records = useCollectionList<AttendanceRecord>('attendance', {
    page: state.index + 1,
    pageSize: API_PAGE_SIZE,
    sort: ['-date'],
    filters: { studentId: childId, ...rangeFilters, ...(status ? { status } : {}) },
  })
  const total = records.isPlaceholderData ? undefined : records.data?.total
  const index = clampPageIndex(state.index, total)
  if (index !== state.index) setIndex(index)

  return (
    <>
      {all.error ? (
        <QueryError error={all.error} onRetry={() => void all.refetch()} />
      ) : !all.data ? (
        <ListLoading label="Devam özeti yükleniyor…" />
      ) : (
        <StatusFilter
          counts={counts}
          value={status}
          onChange={(next) => setFilter(encodeAttendanceFilter({ status: next, range }))}
        />
      )}
      <RangeFilter
        ranges={attendanceRanges(term)}
        value={range}
        onChange={(next) => setFilter(encodeAttendanceFilter({ status, range: next }))}
      />
      {records.error ? (
        <QueryError error={records.error} onRetry={() => void records.refetch()} />
      ) : !records.data || records.isPlaceholderData ? (
        // Süzgeç değişirken önceki sayfa (placeholder) başka durumun kayıtlarıdır; gösterilmez.
        <ListLoading label="Katılım geçmişi yükleniyor…" />
      ) : records.data.rows.length === 0 ? (
        status || range !== 'all' ? (
          <EmptyResults noun="yoklama kaydı" onClear={clear} />
        ) : (
          <Empty
            title="Henüz yoklama kaydı yok"
            text="Öğretmenler yoklama aldığında katılım geçmişi burada görünür."
          />
        )
      ) : (
        <View style={{ gap: 10 }} accessibilityRole="list">
          {records.data.rows.map(({ id, record }) => {
            const view = attendanceView(record)
            return (
              <ListRow
                key={id}
                card
                title={view.title}
                subtitle={view.subtitle}
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
