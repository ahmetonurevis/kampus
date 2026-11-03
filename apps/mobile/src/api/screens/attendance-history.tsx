import { useEffect, useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'
import type { State } from '@kampus/school-core/data/seed.ts'
import { useCurrentAcademicPeriod } from '@kampus/react-shared/use-academic-years.ts'
import {
  useCollectionAll,
  useCollectionCounts,
  useCollectionList,
} from '@kampus/react-shared/use-collection.ts'
import { Badge, Empty, SearchField, Select, Sheet, T, useColors } from '../../ui/components.tsx'
import { EmptyResults, ListRow, Notice, Pagination } from '../../ui/SchoolLayout.tsx'
import {
  DEFAULT_HISTORY_FILTER,
  changeHistoryFilter,
  clearHistoryFilters,
  decodeHistoryFilter,
  emptyHistoryText,
  countsFromGroups,
  historyDay,
  HISTORY_READ_ONLY_NOTICE,
  historyQueryFilters,
  historyRangeFilters,
  historyRangeLabel,
  historyRangeText,
  historyRowView,
  presentedHistoryRanges,
  resolveHistoryClass,
  resolveHistoryRange,
  type HistoryFilter,
  type HistoryRange,
  type DayRange,
} from '../attendance-history.ts'
import { API_PAGE_SIZE, clampPageIndex } from '../list-state.ts'
import {
  ATTENDANCE_STATUSES,
  attendanceLabel,
  attendanceView,
  type AttendanceCounts,
  type AttendanceStatus,
  type CurrentTerm,
  type TermStatus,
} from '../parent-tracking.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'
import { useDebouncedValue } from '../use-debounced-value.ts'
import { useListMemory } from '../view-memory.tsx'

type ClassRecord = State['classes'][number]
type AttendanceRecord = State['attendance'][number]

const ALL_CLASSES = ''

/** Tarih aralığı düğmeleri (radyo grubu); seçim yalnız renkle değil kalın yazı ve çerçeveyle de bellidir. */
function RangeChoice({
  ranges,
  value,
  onChange,
}: {
  ranges: readonly HistoryRange[]
  value: HistoryRange
  onChange: (range: HistoryRange) => void
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
        const label = historyRangeLabel(range)
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
 * Durum özeti: kart seçili durumun listesini süzer, aynı karta yeniden dokununca süzgeç kalkar
 * (açılıp kapanan düğme: `button` rolü ve `selected` durumu; radyo grubu seçimin kalkmasına izin vermez).
 * Sayılar seçili aralık, sınıf ve arama içindeki bütün kayıtlardan sunucuda hesaplanır; durum
 * süzgecinden etkilenmez.
 */
function StatusCards({
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
      accessibilityRole="toolbar"
      accessibilityLabel="Katılım özeti"
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}
    >
      {ATTENDANCE_STATUSES.map((status) => {
        const selected = status === value
        const label = attendanceLabel(status)
        return (
          <Pressable
            key={status}
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${counts[status]} kayıt`}
            accessibilityHint={selected ? 'Süzgeci kaldırır' : 'Geçmişi bu duruma göre süzer'}
            accessibilityState={{ selected }}
            aria-selected={selected}
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

type StudentTarget = { studentId: string; name: string; className: string | undefined }

/**
 * Öğrencinin seçili aralıktaki durum sayıları ve günlük kayıtları (en yeni üstte). Sınıf, durum
 * ve arama süzgeci uygulanmaz: öğrencinin bütün aralığı görülür. Salt okunurdur.
 */
function StudentSheet({
  target,
  range,
  onClose,
}: {
  target: StudentTarget
  range: DayRange
  onClose: () => void
}) {
  const filters = historyQueryFilters(DEFAULT_HISTORY_FILTER, range, target.studentId)
  const counts = useCollectionCounts('attendance', { groupBy: 'status', filters })
  const records = useCollectionAll<AttendanceRecord>('attendance', { filters, sort: ['-date'] })
  const summary = countsFromGroups(counts.data?.groups ?? [])
  return (
    <Sheet visible title={target.name} onClose={onClose}>
      <T muted size={14}>
        {[target.className, historyRangeText(range)].filter(Boolean).join(' · ')}
      </T>
      {counts.error ? (
        <QueryError error={counts.error} onRetry={() => void counts.refetch()} />
      ) : !counts.data ? (
        <ListLoading label="Durum sayıları yükleniyor…" />
      ) : (
        <View
          accessibilityLabel={`${target.name} durum sayıları`}
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}
        >
          {ATTENDANCE_STATUSES.map((status) => (
            <View
              key={status}
              accessible
              accessibilityLabel={`${attendanceLabel(status)}: ${summary[status]} kayıt`}
              style={{ flexGrow: 1, flexBasis: 120, gap: 2 }}
            >
              <T muted size={13}>
                {attendanceLabel(status)}
              </T>
              <T bold size={18}>
                {summary[status]}
              </T>
            </View>
          ))}
        </View>
      )}
      {records.error ? (
        <QueryError error={records.error} onRetry={() => void records.refetch()} />
      ) : !records.data ? (
        <ListLoading label="Günlük kayıtlar yükleniyor…" />
      ) : records.data.length === 0 ? (
        <Empty
          title="Bu aralıkta kayıt yok"
          text="Öğrenci için seçili günlerde yoklama alınmamış."
        />
      ) : (
        <View style={{ gap: 10 }} accessibilityRole="list">
          {records.data.map(({ id, record }) => {
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
    </Sheet>
  )
}

/** Dakikada bir yenilenen saat: gece yarısı geçince gün (ve dönem) yeniden istenir. */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

/**
 * Öğretmen: yoklama geçmişi (web `ogretmen/yoklama` "Yoklama geçmişi" bölümü). Kapsamı sunucu
 * uygular: öğretmen yalnız ders verdiği ya da danışmanı olduğu sınıfların kayıtlarını görür, istemci
 * süzmez. Tarih aralığı (bu hafta, son 30 gün, dönem; Europe/Istanbul günü, iki uç dahil), sınıf,
 * durum ve öğrenci adı araması sunucuya gider; süzgeç ya da arama değişince sayfa başa döner. Durum
 * sayıları sunucuda hesaplanır, bir öğrenciye dokununca onun sayıları ve günlük kayıtları açılır.
 * Telefonda salt okunurdur: geçmiş günü yalnız yönetici düzeltir (DOM-AKD-035).
 */
export function AttendanceHistory() {
  const { state, setSearch, setIndex, replace } = useListMemory('ogretmen/yoklama/gecmis')
  const search = useDebouncedValue(state.search)
  const period = useCurrentAcademicPeriod()
  const termStatus: TermStatus = period.data ? 'ready' : period.error ? 'error' : 'loading'
  const term: CurrentTerm = period.data?.data.term ?? null
  // Gün sunucudandır (dönemle aynı yanıt); cihaz saati yalnız yanıtın eskidiğini anlamak içindir.
  const now = useMinuteClock()
  const { today, stale } = historyDay(period.data?.data.date, period.dataUpdatedAt, now)
  const refetchPeriod = period.refetch
  useEffect(() => {
    if (stale) void refetchPeriod()
  }, [stale, refetchPeriod])
  const decoded = decodeHistoryFilter(state.filter)
  const classes = useCollectionAll<ClassRecord>('classes')
  const classOptions = useMemo(
    () => [
      { value: ALL_CLASSES, label: 'Tüm sınıflar' },
      ...(classes.data ?? []).map((row) => ({ value: row.id, label: row.record.name })),
    ],
    [classes.data],
  )
  const classId = classes.data
    ? resolveHistoryClass(
        decoded.classId,
        classes.data.map((row) => row.id),
      )
    : decoded.classId
  const { range, wait } = resolveHistoryRange(decoded.range, termStatus, term)
  const filter: HistoryFilter = { range, classId, status: decoded.status }
  // Gün gelmeden istek kurulmaz (`enabled`); boş aralık yalnız sorgu anahtarını doldurur.
  const dayRange: DayRange = today
    ? historyRangeFilters(range, today, term)
    : { dateFrom: '', dateTo: '' }
  const enabled = wait === null && today !== null
  const [student, setStudent] = useState<StudentTarget | null>(null)

  const counts = useCollectionCounts(
    'attendance',
    {
      groupBy: 'status',
      q: search,
      filters: historyQueryFilters({ ...filter, status: '' }, dayRange),
    },
    { enabled },
  )
  const records = useCollectionList<AttendanceRecord>(
    'attendance',
    {
      page: state.index + 1,
      pageSize: API_PAGE_SIZE,
      q: search,
      sort: ['-date'],
      filters: historyQueryFilters(filter, dayRange),
    },
    { enabled },
  )
  const total = enabled && !records.isPlaceholderData ? records.data?.total : undefined
  const index = clampPageIndex(state.index, total)
  if (index !== state.index) setIndex(index)

  // Süzgeç değişince sayfa başa döner (`changeHistoryFilter`); arama ayrı alandadır.
  const change = (next: Partial<HistoryFilter>) =>
    replace(changeHistoryFilter(state, { ...filter, ...next }))
  const filtered = classId !== '' || decoded.status !== '' || search.trim().length >= 2
  const empty = emptyHistoryText(filtered)

  return (
    <>
      <Notice title="Salt okunur geçmiş" text={HISTORY_READ_ONLY_NOTICE} />
      <RangeChoice
        ranges={presentedHistoryRanges(termStatus, term)}
        value={range}
        onChange={(next) => change({ range: next })}
      />
      {enabled && (
        <T muted size={14} accessibilityLiveRegion="polite">
          {historyRangeText(dayRange)}
        </T>
      )}
      <Select
        label="Sınıf"
        value={classId}
        options={classOptions}
        onChange={(next) => change({ classId: next })}
      />
      <SearchField
        value={state.search}
        onChange={setSearch}
        placeholder="Öğrenci, numara veya sınıf"
      />
      {enabled &&
        (counts.error ? (
          <QueryError error={counts.error} onRetry={() => void counts.refetch()} />
        ) : !counts.data ? (
          <ListLoading label="Katılım özeti yükleniyor…" />
        ) : (
          <StatusCards
            counts={countsFromGroups(counts.data.groups)}
            value={decoded.status}
            onChange={(status) => change({ status })}
          />
        ))}
      {wait === 'error' && period.error ? (
        <QueryError error={period.error} onRetry={() => void period.refetch()} />
      ) : wait === 'error' ? null : wait === 'loading' ? (
        <ListLoading label="Gün ve dönem bilgisi yükleniyor…" />
      ) : records.error ? (
        <QueryError error={records.error} onRetry={() => void records.refetch()} />
      ) : !records.data || records.isPlaceholderData ? (
        // Süzgeç değişirken önceki sayfa başka aralığın kayıtlarıdır; gösterilmez.
        <ListLoading label="Yoklama geçmişi yükleniyor…" />
      ) : records.data.rows.length === 0 ? (
        filtered ? (
          <EmptyResults noun="yoklama kaydı" onClear={() => replace(clearHistoryFilters(state))} />
        ) : (
          <Empty title={empty.title} text={empty.text} />
        )
      ) : (
        <View style={{ gap: 10 }} accessibilityRole="list">
          {records.data.rows.map(({ id, record, joined }) => {
            const view = historyRowView(record, joined)
            return (
              <ListRow
                key={id}
                card
                title={view.title}
                eyebrow={view.eyebrow}
                subtitle={view.subtitle}
                badge={<Badge text={view.status} />}
                label={`${view.label}. Öğrencinin durum sayılarını aç`}
                onPress={() =>
                  setStudent({
                    studentId: record.studentId,
                    name: view.title,
                    className: view.eyebrow,
                  })
                }
              />
            )
          })}
        </View>
      )}
      {total !== undefined && (
        <Pagination count={total} index={index} pageSize={API_PAGE_SIZE} onChange={setIndex} />
      )}
      {student && (
        <StudentSheet target={student} range={dayRange} onClose={() => setStudent(null)} />
      )}
    </>
  )
}
