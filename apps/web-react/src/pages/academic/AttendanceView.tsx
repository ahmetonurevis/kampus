import { useMemo } from 'react'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { Avatar } from '@/components/Avatar.tsx'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll, useCoreFetchAll, useCoreList } from '@/hooks/use-core-collection.ts'
import { useCsvExport } from '@/hooks/use-csv-export.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import {
  collectionQueryFromList,
  exportQueryFromList,
  sortableColumns,
  type CollectionListConfig,
} from '@/lib/collection-list.ts'
import type { UrlFilters } from '@/lib/list-url.ts'
import { LookupError, StatGrid, TableSection } from './AcademicParts.tsx'
import {
  ATTENDANCE_OPTIONS,
  attendanceCounts,
  attendanceCsvRow,
  attendanceRangeError,
  attendanceRangeFilters,
  attendanceRow,
  isDayKey,
  NO_REASON,
  type AttendanceRow,
} from './academic-rows.ts'
import { AttendancePanel } from './AttendancePanel.tsx'
import { useAcademicLookups } from './use-academic-lookups.ts'

const ATTENDANCE_LIST = {
  sortFields: { date: 'date', statusLabel: 'status' },
  filterFields: { classId: 'classId', status: 'status' },
  defaultSort: ['-date'],
} satisfies CollectionListConfig
const SORTABLE = sortableColumns(ATTENDANCE_LIST)
const ALL = 'all'
const TEACHER_URL_FILTERS: UrlFilters = {
  classId: 'sinif',
  status: 'durum',
  from: 'baslangic',
  to: 'bitis',
}
const STUDENT_URL_FILTERS: UrlFilters = { status: 'durum', from: 'baslangic', to: 'bitis' }

const filterValue = (value: unknown) => (typeof value === 'string' ? value : '')
const today = () => new Date().toISOString().slice(0, 10)

type AttendanceViewProps = {
  /** `teacher`: öğrenci ve sınıf sütunları, sınıf filtresi; `student`: kendi (veya çocuğun) kaydı. */
  audience: 'teacher' | 'student'
  /** Sabit öğrenci kapsamı (veli: seçili çocuk). Öğrencide boştur, kapsamı sunucu daraltır. */
  studentId?: string
  urlPrefix?: string
  title: string
}

/**
 * Yoklama geçmişi (Vue `Academic.vue` `devamsizlik`): sunucu sayfalı tablo; durum, tarih (ve
 * öğretmende sınıf) filtresi, tarih/durum sıralaması, satırdan sağ panelde ayrıntı. Öğrencide
 * katılım sayıları kayıtlardan hesaplanır. Yalnız okuma.
 * TODO(D-attendance-write): yoklama alma core işlemi gelince "Yoklama al" eklenir.
 * Tarih aralığı (`?baslangic=` ve `?bitis=`, `YYYY-MM-DD`; IST-093, DOM-AKD-036) sunucuya
 * `dateFrom`/`dateTo` olarak gider (Europe/Istanbul günü, iki uç dahil) ve sayfalamadan önce
 * süzülür; tek uç açık aralıktır. Bitiş başlangıçtan önce ya da aralık 1 yıldan uzunsa istek
 * atılmaz, hata alanın altında yazılır. Serbest arama ayrıdır.
 */
export function AttendanceView({
  audience,
  studentId,
  urlPrefix = '',
  title,
}: AttendanceViewProps) {
  const data = useAcademicLookups()
  const { lookups, sources } = data
  const teacher = audience === 'teacher'
  const urlFilters = teacher ? TEACHER_URL_FILTERS : STUDENT_URL_FILTERS
  const list = useListState(`${urlPrefix}yoklama`, { urlFilters, urlPrefix })
  const classId = teacher ? filterValue(list.state.filters.classId) : ''
  const status = filterValue(list.state.filters.status)
  const fromValue = filterValue(list.state.filters.from)
  const toValue = filterValue(list.state.filters.to)
  const from = isDayKey(fromValue) ? fromValue : ''
  const to = isDayKey(toValue) ? toValue : ''
  const rangeError = attendanceRangeError(from, to)
  const search = useDebouncedValue(list.state.query)

  // Sabit öğrenci (veli: seçili çocuk) ve tarih aralığı sunucu filtresi olarak eklenir.
  const withScope = <T extends { filters?: Record<string, string | readonly string[]> }>(
    query: T,
  ): T => ({
    ...query,
    filters: {
      ...query.filters,
      ...attendanceRangeFilters(from, to),
      ...(studentId ? { studentId } : {}),
    },
  })
  const records = useCoreList(
    'attendance',
    withScope(collectionQueryFromList(list.state, ATTENDANCE_LIST, search)),
  )
  const rows = useMemo(
    () => records.data?.rows.map((item) => attendanceRow(item, lookups)),
    [records.data, lookups],
  )
  const panel = useDetailPanel('kayit')
  const openRecord = panel.open
  const fetchAll = useCoreFetchAll('attendance')
  const csv = useCsvExport()

  // Özet: öğrencinin bütün yoklama kayıtları (liste filtresinden bağımsız).
  const own = useCoreAll('attendance', studentId ? { filters: { studentId } } : {}, {
    enabled: !teacher,
  })
  const counts = useMemo(
    () => attendanceCounts(own.data?.map((item) => item.record) ?? []),
    [own.data],
  )

  const setFilter = (key: 'classId' | 'status' | 'from' | 'to', value: string) =>
    list.dispatch({ type: 'filter', key, value: value === ALL ? '' : value })

  const columns = useMemo<DataColumn<AttendanceRow>[]>(
    () => [
      ...(teacher
        ? [
            {
              key: 'student',
              label: 'Öğrenci',
              cell: (row: AttendanceRow) => (
                <span className="person-cell flex items-center gap-2.5">
                  <Avatar name={row.student} size="small" />
                  <button
                    type="button"
                    onClick={() => openRecord(row.id)}
                    className="record-link text-left font-medium text-primary hover:underline"
                  >
                    {row.student || '—'}
                  </button>
                </span>
              ),
            },
            { key: 'className', label: 'Sınıf' },
          ]
        : []),
      {
        key: 'date',
        label: 'Ders tarihi',
        cell: (row) =>
          teacher ? (
            dateLabel(row.date, { year: 'numeric', weekday: 'long' })
          ) : (
            <button
              type="button"
              onClick={() => openRecord(row.id)}
              className="record-link text-left font-medium text-primary hover:underline"
            >
              {dateLabel(row.date, { year: 'numeric', weekday: 'long' })}
            </button>
          ),
      },
      {
        key: 'statusLabel',
        label: 'Katılım',
        cell: (row) => (
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge text={row.statusLabel} />
            {row.lateMinutes === null ? null : (
              <span className="text-sm text-muted-foreground">{row.lateMinutes} dk</span>
            )}
          </span>
        ),
      },
      { key: 'reason', label: 'Not', cell: (row) => row.reason || NO_REASON },
    ],
    [teacher, openRecord],
  )

  function download() {
    const query = withScope(exportQueryFromList(list.state, ATTENDANCE_LIST, search))
    void csv.download(title, columns, async () =>
      (await fetchAll(query)).map((item) => attendanceCsvRow(attendanceRow(item, lookups))),
    )
  }

  const total = records.data?.total ?? 0
  const className = lookups.classes.get(classId)?.name
  const statusLabel = ATTENDANCE_OPTIONS.find((option) => option.value === status)?.label
  const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
  const rangeLabel =
    from || to ? `${from ? dayText(from) : '…'} – ${to ? dayText(to) : '…'}` : undefined
  return (
    <>
      {data.error ? <LookupError error={data.error} onRetry={data.retry} /> : null}
      {!teacher ? (
        own.error ? (
          <LookupError error={own.error} onRetry={() => void own.refetch()} />
        ) : (
          <StatGrid
            label="Devam özeti"
            items={[
              { label: 'Katıldığı ders', value: counts.present, note: 'Zamanında katılım' },
              { label: 'Devamsızlık', value: counts.absent, note: 'Derse katılmadığı günler' },
              { label: 'Geç katılım', value: counts.late, note: 'Geç geldi olarak işaretlendi' },
              { label: 'Mazeretli', value: counts.excused, note: 'Mazereti kayıtlı günler' },
            ]}
          />
        )
      ) : null}
      <TableSection
        title={teacher ? 'Yoklama geçmişi' : 'Katılım geçmişi'}
        subtitle={`${total} kayıt`}
        onDownload={download}
        downloadBusy={csv.busy}
        downloadDisabled={data.pending}
      >
        <ServerDataTable
          list={list}
          rows={rows}
          total={total}
          sortable={SORTABLE}
          columns={columns}
          mobileColumns={teacher ? ['student', 'date', 'statusLabel'] : ['date', 'statusLabel']}
          caption={title}
          loading={records.isPending}
          fetching={records.isFetching && !records.isPending}
          error={
            records.error ? (
              <QueryError error={records.error} onRetry={() => void records.refetch()} />
            ) : undefined
          }
          onRowClick={(row) => openRecord(row.id)}
          externalActive={classId !== '' || status !== '' || from !== '' || to !== ''}
          externalLabel={[className, statusLabel, rangeLabel].filter(Boolean).join(' · ')}
          onReset={() => {
            setFilter('classId', ALL)
            setFilter('status', ALL)
            setFilter('from', ALL)
            setFilter('to', ALL)
          }}
          toolbar={
            <>
              {teacher ? (
                <NativeSelect
                  aria-label="Yoklama sınıfı"
                  value={classId || ALL}
                  onChange={(event) => setFilter('classId', event.target.value)}
                  className="min-h-9 text-sm"
                >
                  <NativeSelectOption value={ALL}>Tüm sınıflar</NativeSelectOption>
                  {sources.classes.map(({ record }) => (
                    <NativeSelectOption key={record.id} value={record.id}>
                      {record.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              ) : null}
              <NativeSelect
                aria-label="Katılım durumu"
                value={status || ALL}
                onChange={(event) => setFilter('status', event.target.value)}
                className="min-h-9 text-sm"
              >
                <NativeSelectOption value={ALL}>Tüm durumlar</NativeSelectOption>
                {ATTENDANCE_OPTIONS.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <label className="flex items-center gap-2 text-sm">
                Başlangıç
                <Input
                  type="date"
                  aria-label="Yoklama başlangıç tarihi"
                  value={from}
                  max={to || today()}
                  onChange={(event) => setFilter('from', event.target.value)}
                  aria-invalid={rangeError ? true : undefined}
                  aria-describedby={rangeError ? 'yoklama-aralik-hata' : undefined}
                  className="min-h-9 w-auto text-sm"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                Bitiş
                <Input
                  type="date"
                  aria-label="Yoklama bitiş tarihi"
                  value={to}
                  min={from || undefined}
                  max={today()}
                  onChange={(event) => setFilter('to', event.target.value)}
                  aria-invalid={rangeError ? true : undefined}
                  aria-describedby={rangeError ? 'yoklama-aralik-hata' : undefined}
                  className="min-h-9 w-auto text-sm"
                />
              </label>
              {rangeError ? (
                <p id="yoklama-aralik-hata" role="alert" className="basis-full text-sm text-danger">
                  {rangeError} Aralık uygulanmadı.
                </p>
              ) : null}
            </>
          }
        />
      </TableSection>
      <AttendancePanel recordId={panel.selectedId} lookups={lookups} onClose={panel.close} />
    </>
  )
}
