import { useMemo } from 'react'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { useCoreAll, useCoreList } from '@/hooks/use-core-collection.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { collectionQueryFromList, sortableColumns } from '@/lib/collection-list.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { ClassSubjectFilters, filterValue, useClassSubjectFilters } from './LearningFilters.tsx'
import {
  learningLookups,
  QUIZ_LIST,
  teacherQuizRow,
  uniqueValues,
  type TeacherQuizRow,
} from './learning-rows.ts'
import { QuizResultsPanel } from './QuizResultsPanel.tsx'

const URL_FILTERS = { classId: 'sinif', subjectId: 'ders' }
const SORTABLE = sortableColumns(QUIZ_LIST)
const MOBILE_COLUMNS = ['className', 'questions', 'average']
const NONE: readonly never[] = []

/**
 * Quiz Oluştur (öğretmen, Vue `Learning.vue` `/quiz-olustur`): kapsamdaki sınıfların quizleri
 * sunucu sayfalı; soru sayısı, çözen sayısı ve sınıf ortalaması. Ortalama, sayfadaki quizlerin
 * denemelerinin cevaplarından core `gradeQuiz` ile soru bankasına karşı hesaplanır. Yalnız okuma.
 * TODO(api-quiz-write): quiz oluşturma ve soru seçimi yazma ucuyla gelir; soru bankası ayrı görevdir.
 * TODO(api-aggregate): ortalama sayfadaki quizlerin denemelerinden istemcide hesaplanır; toplu uç
 * gelince tek sorguya iner.
 */
export function TeacherQuizzesPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const classes = useCoreAll('classes')
  const students = useCoreAll('students')
  const lookups = useMemo(
    () => learningLookups(classes.data ?? NONE, students.data ?? NONE),
    [classes.data, students.data],
  )
  const filters = useClassSubjectFilters(classes.data ?? NONE)

  const list = useListState('quizler', { urlFilters: URL_FILTERS })
  const search = useDebouncedValue(list.state.query)
  const quizzes = useCoreList('quizzes', collectionQueryFromList(list.state, QUIZ_LIST, search))
  const pageRows = quizzes.data?.rows
  const quizIds = useMemo(
    () => uniqueValues(pageRows?.map((row) => row.record.id) ?? []),
    [pageRows],
  )
  const subjectIds = useMemo(
    () => uniqueValues(pageRows?.map((row) => row.record.subjectId) ?? []),
    [pageRows],
  )
  const attempts = useCoreAll(
    'quizAttempts',
    { filters: { quizId: quizIds } },
    { enabled: quizIds.length > 0 },
  )
  // Cevap anahtarı yalnız soru bankasındadır; sayfadaki quizlerin derslerine göre çekilir.
  const bank = useCoreAll(
    'bank',
    { filters: { subjectId: subjectIds } },
    { enabled: subjectIds.length > 0 },
  )
  const ready = quizIds.length === 0 || (attempts.data !== undefined && bank.data !== undefined)
  const rows = useMemo(() => {
    if (!pageRows) return undefined
    const records = attempts.data?.map((row) => row.record) ?? NONE
    const questions = bank.data?.map((row) => row.record) ?? NONE
    return pageRows.map((item) => teacherQuizRow(item, records, questions, lookups))
  }, [pageRows, attempts.data, bank.data, lookups])

  const panel = useDetailPanel('quiz')
  const openQuiz = panel.open
  const classId = filterValue(list.state.filters.classId)
  const subjectId = filterValue(list.state.filters.subjectId)

  const columns = useMemo<DataColumn<TeacherQuizRow>[]>(
    () => [
      {
        key: 'title',
        label: 'Quiz',
        cell: (row) => (
          <button
            type="button"
            onClick={() => openQuiz(row.id)}
            aria-label={`${row.title} sonuçlarını aç`}
            className="record-link max-w-[340px] truncate text-left font-medium text-primary hover:underline"
          >
            {row.title}
          </button>
        ),
      },
      { key: 'className', label: 'Sınıf' },
      { key: 'subject', label: 'Ders' },
      { key: 'questions', label: 'Soru sayısı' },
      { key: 'duration', label: 'Süre', cell: (row) => `${row.duration} dk` },
      {
        key: 'solved',
        label: 'Çözen',
        cell: (row) => (ready ? row.solved : '…'),
      },
      {
        key: 'average',
        label: 'Sınıf ortalaması',
        cell: (row) =>
          !ready ? '…' : row.average === null ? 'Çözen yok' : <strong>%{row.average}</strong>,
      },
      {
        key: 'actions',
        label: 'İşlemler',
        cell: (row) => (
          <Button
            variant="secondary"
            size="sm"
            aria-label={`${row.title} sonuçları`}
            onClick={() => openQuiz(row.id)}
          >
            <Icon name="Eye" size={15} aria-hidden="true" />
            Sonuçlar
          </Button>
        ),
      },
    ],
    [openQuiz, ready],
  )

  const error = quizzes.error ?? classes.error ?? students.error
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      <section
        aria-labelledby="quiz-tablosu"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading px-6 pt-6 pb-2">
          <h2 id="quiz-tablosu" className="text-lg font-semibold">
            Quiz listesi
          </h2>
          <p className="text-sm text-muted-foreground">
            {quizzes.data?.total ?? 0} quiz · Sınıf ortalamaları öğrenci cevaplarından hesaplanır
          </p>
        </header>
        <ServerDataTable
          list={list}
          rows={rows}
          total={quizzes.data?.total ?? 0}
          sortable={SORTABLE}
          columns={columns}
          mobileColumns={MOBILE_COLUMNS}
          caption="Quiz listesi"
          loading={quizzes.isPending}
          fetching={quizzes.isFetching && !quizzes.isPending}
          error={
            error ? (
              <QueryError
                error={error}
                onRetry={() => {
                  if (quizzes.error) void quizzes.refetch()
                  if (classes.error) void classes.refetch()
                  if (students.error) void students.refetch()
                }}
              />
            ) : undefined
          }
          onRowClick={(row) => openQuiz(row.id)}
          externalActive={classId !== '' || subjectId !== ''}
          externalLabel={[
            classId ? `Sınıf: ${lookups.classes.get(classId)?.name ?? classId}` : '',
            subjectId ? `Ders: ${filters.subjectName(subjectId)}` : '',
          ]
            .filter(Boolean)
            .join(' · ')}
          onReset={() => {
            list.dispatch({ type: 'filter', key: 'classId', value: '' })
            list.dispatch({ type: 'filter', key: 'subjectId', value: '' })
          }}
          toolbar={
            <ClassSubjectFilters
              filters={filters}
              classId={classId}
              subjectId={subjectId}
              onChange={(key, value) => list.dispatch({ type: 'filter', key, value })}
            />
          }
        />
      </section>
      <QuizResultsPanel quizId={panel.selectedId} lookups={lookups} onClose={panel.close} />
    </>
  )
}
