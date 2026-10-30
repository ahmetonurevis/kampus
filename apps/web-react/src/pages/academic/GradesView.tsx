import { useMemo } from 'react'
import { Avatar } from '@/components/Avatar.tsx'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
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
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { subjectAverages } from '@kampus/school-core/lib/grades.ts'
import type { UrlFilters } from '@/lib/list-url.ts'
import { LookupError, StatGrid, TableSection } from './AcademicParts.tsx'
import {
  gradeCsvRow,
  gradeRow,
  overallAverage,
  scoreText,
  scoreTone,
  withSubjectNames,
  type GradeRow,
} from './academic-rows.ts'
import { canCorrectGrade } from './academic-write.ts'
import { GradeEntryPanel } from './GradeEntryPanel.tsx'
import { GradePanel } from './GradePanel.tsx'
import { useAcademicLookups } from './use-academic-lookups.ts'
import { useTeacherScope } from './use-teacher-scope.ts'

const GRADE_LIST = {
  sortFields: { title: 'title', date: 'date', score: 'score' },
  filterFields: { classId: 'classId', subjectId: 'subjectId' },
  defaultSort: ['-date'],
} satisfies CollectionListConfig
const SORTABLE = sortableColumns(GRADE_LIST)
const ALL = 'all'
const TEACHER_URL_FILTERS: UrlFilters = { classId: 'sinif', subjectId: 'ders' }
const STUDENT_URL_FILTERS: UrlFilters = { subjectId: 'ders' }

const filterValue = (value: unknown) => (typeof value === 'string' ? value : '')

type GradesViewProps = {
  /** `teacher`: öğrenci sütunu ve sınıf filtresi; `student`: kendi (veya velinin çocuğunun) notları. */
  audience: 'teacher' | 'student'
  /** Sabit öğrenci kapsamı (veli: seçili çocuk). Öğrencide boştur, kapsamı sunucu daraltır. */
  studentId?: string
  /** Aynı sayfada birden çok liste için URL parametre öneki. */
  urlPrefix?: string
  /** Dosya adı ve tablo adı için başlık. */
  title: string
}

/**
 * Not listesi (Vue `Academic.vue` `notlarim` ve not geçmişi): sunucu sayfalı tablo; ders (ve
 * öğretmende sınıf) filtresi, başlık/tarih/puan sıralaması, satırdan sağ panelde ayrıntı. Ders
 * bazında ortalama core `average` ile kayıtlardan hesaplanır, saklanmaz. Öğretmen "Not gir" ile
 * resmî not girer ve ayrıntı panelinden kendi dersinin notunu gerekçeyle düzeltir; öğrenci ve
 * veli görünümü yalnız okunurdur.
 */
export function GradesView({ audience, studentId, urlPrefix = '', title }: GradesViewProps) {
  const data = useAcademicLookups()
  const { lookups, sources } = data
  const teacher = audience === 'teacher'
  const urlFilters = teacher ? TEACHER_URL_FILTERS : STUDENT_URL_FILTERS
  const list = useListState(`${urlPrefix}notlar`, { urlFilters, urlPrefix })
  const search = useDebouncedValue(list.state.query)
  const classId = teacher ? filterValue(list.state.filters.classId) : ''
  const subjectId = filterValue(list.state.filters.subjectId)

  // Sınıf süzgeci sunucuya `classId` olarak gider (öğrencinin güncel sınıfı); sabit öğrenci
  // (veli: seçili çocuk) `studentId` filtresidir.
  const withScope = <T extends { filters?: Record<string, string | readonly string[]> }>(
    query: T,
  ): T => (studentId ? { ...query, filters: { ...query.filters, studentId } } : query)
  const grades = useCoreList(
    'grades',
    withScope(collectionQueryFromList(list.state, GRADE_LIST, search)),
  )
  const rows = grades.data?.rows.map((item) => gradeRow(item, lookups))
  const panel = useDetailPanel('not')
  const openGrade = panel.open
  const entry = useDetailPanel('notgir')
  const scope = useTeacherScope(lookups, teacher)
  const fetchAll = useCoreFetchAll('grades')
  const csv = useCsvExport()

  // Özet: öğrencinin bütün notları (liste filtresinden bağımsız).
  const own = useCoreAll('grades', studentId ? { filters: { studentId } } : {}, {
    enabled: !teacher,
  })
  const averages = useMemo(
    () =>
      withSubjectNames(
        subjectAverages(own.data?.map((item) => item.record) ?? []),
        lookups.subjects,
      ),
    [own.data, lookups.subjects],
  )

  const setFilter = (key: 'classId' | 'subjectId', value: string) =>
    list.dispatch({ type: 'filter', key, value: value === ALL ? '' : value })

  const columns = useMemo<DataColumn<GradeRow>[]>(() => {
    const evaluation: DataColumn<GradeRow> = {
      key: 'title',
      label: 'Değerlendirme',
      cell: (row) => (
        <button
          type="button"
          onClick={() => openGrade(row.id)}
          className="record-link text-left font-medium text-primary hover:underline"
        >
          {row.title}
        </button>
      ),
    }
    const student: DataColumn<GradeRow> = {
      key: 'student',
      label: 'Öğrenci',
      cell: (row) => (
        <span className="person-cell flex items-center gap-2.5">
          <Avatar name={row.student} size="small" />
          <strong className="font-medium">{row.student || '—'}</strong>
        </span>
      ),
    }
    return [
      ...(teacher ? [student] : []),
      evaluation,
      { key: 'subject', label: 'Ders' },
      { key: 'topic', label: 'Kazanım / Konu' },
      { key: 'date', label: 'Tarih', cell: (row) => dateLabel(row.date, { year: 'numeric' }) },
      {
        key: 'score',
        label: 'Puan',
        cell: (row) => <StatusBadge text={scoreText(row.score)} tone={scoreTone(row.score)} />,
      },
    ]
  }, [teacher, openGrade])

  function download() {
    const query = withScope(exportQueryFromList(list.state, GRADE_LIST, search))
    void csv.download(title, columns, async () =>
      (await fetchAll(query)).map((item) => gradeCsvRow(gradeRow(item, lookups))),
    )
  }

  const total = grades.data?.total ?? 0
  const className = lookups.classes.get(classId)?.name
  const subjectName = lookups.subjects.get(subjectId)?.name
  const classOptions = sources.classes.map((item) => item.record)
  // Öğrenci yalnız notu olan dersleri süzer; öğretmen bütün dersleri.
  const subjectOptions = teacher
    ? sources.subjects.map((item) => ({ id: item.record.id, name: item.record.name }))
    : averages.map((item) => ({ id: item.subjectId, name: item.name }))
  return (
    <>
      {data.error ? <LookupError error={data.error} onRetry={data.retry} /> : null}
      {!teacher ? (
        <>
          {own.error ? (
            <LookupError error={own.error} onRetry={() => void own.refetch()} />
          ) : (
            <StatGrid
              label="Not özeti"
              items={[
                {
                  label: 'Genel ortalama',
                  value: own.data ? scoreText(overallAverage(own.data.map((i) => i.record))) : '—',
                  note: own.data ? `${own.data.length} değerlendirme` : 'Yükleniyor…',
                },
                ...averages.map((subject) => ({
                  label: subject.name,
                  value: scoreText(subject.average),
                  note: `${subject.count} değerlendirme`,
                })),
              ]}
            />
          )}
        </>
      ) : null}
      <TableSection
        title={teacher ? 'Not listesi' : 'Notlar'}
        subtitle={`${total} kayıt`}
        onDownload={download}
        downloadBusy={csv.busy}
        downloadDisabled={data.pending}
        action={
          teacher ? (
            <Button onClick={() => entry.open('yeni')} disabled={data.pending || scope.pending}>
              <Icon name="Plus" size={17} aria-hidden="true" />
              Not gir
            </Button>
          ) : null
        }
      >
        <ServerDataTable
          list={list}
          rows={rows}
          total={total}
          sortable={SORTABLE}
          columns={columns}
          mobileColumns={teacher ? ['student', 'subject', 'score'] : ['subject', 'title', 'score']}
          caption={title}
          loading={grades.isPending}
          fetching={grades.isFetching && !grades.isPending}
          error={
            grades.error ? (
              <QueryError error={grades.error} onRetry={() => void grades.refetch()} />
            ) : undefined
          }
          onRowClick={(row) => openGrade(row.id)}
          externalActive={classId !== '' || subjectId !== ''}
          externalLabel={[className, subjectName].filter(Boolean).join(' · ')}
          onReset={() => {
            setFilter('classId', ALL)
            setFilter('subjectId', ALL)
          }}
          toolbar={
            <>
              {teacher ? (
                <NativeSelect
                  aria-label="Not sınıfı"
                  value={classId || ALL}
                  onChange={(event) => setFilter('classId', event.target.value)}
                  className="min-h-9 text-sm"
                >
                  <NativeSelectOption value={ALL}>Tüm sınıflar</NativeSelectOption>
                  {classOptions.map((record) => (
                    <NativeSelectOption key={record.id} value={record.id}>
                      {record.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              ) : null}
              <NativeSelect
                aria-label="Not dersi"
                value={subjectId || ALL}
                onChange={(event) => setFilter('subjectId', event.target.value)}
                className="min-h-9 text-sm"
              >
                <NativeSelectOption value={ALL}>Tüm dersler</NativeSelectOption>
                {subjectOptions.map((record) => (
                  <NativeSelectOption key={record.id} value={record.id}>
                    {record.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </>
          }
        />
      </TableSection>
      <GradePanel
        gradeId={panel.selectedId}
        lookups={lookups}
        onClose={panel.close}
        {...(teacher
          ? {
              canCorrect: (record) =>
                canCorrectGrade(
                  scope.assignments,
                  scope.teacherId,
                  lookups.students.get(record.studentId)?.classId,
                  record.subjectId,
                ),
            }
          : {})}
      />
      {teacher ? (
        <GradeEntryPanel
          open={entry.selectedId !== ''}
          lookups={lookups}
          scope={scope}
          onClose={entry.close}
        />
      ) : null}
    </>
  )
}
