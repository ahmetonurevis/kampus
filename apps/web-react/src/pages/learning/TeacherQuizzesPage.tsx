import { useMemo } from 'react'
import type { QuizStatusFilter } from '@kampus/react-shared/quizzes.ts'
import { useQuizList } from '@kampus/react-shared/use-quizzes.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { ClassSubjectFilters, filterValue, useClassSubjectFilters } from './LearningFilters.tsx'
import { teacherQuizRow, type TeacherQuizRow } from './learning-rows.ts'
import { quizActions, quizDueText, seesQuizResults, type QuizActor } from './quiz-forms.ts'
import { NEW_QUIZ } from './QuizForms.tsx'
import { QuizResultsPanel } from './QuizResultsPanel.tsx'

// Panel parametreleri (`quiz`, `quiz-form`) süzgeç adlarıyla çakışmamalı.
const URL_FILTERS = { classId: 'sinif', subjectId: 'ders', status: 'durum' }
const NO_SORT: readonly string[] = []
const MOBILE_COLUMNS = ['className', 'questions', 'average']
const NONE: readonly never[] = []

const STATUS_OPTIONS = [
  { value: '', label: 'Tüm durumlar' },
  { value: 'open', label: 'Açık' },
  { value: 'closed', label: 'Kapandı' },
] as const
const isStatus = (value: string): value is Exclude<QuizStatusFilter, 'all'> =>
  value === 'open' || value === 'closed'

/**
 * Quiz Oluştur (öğretmen; IST-095, DOM-AKD-075…079): kapsamdaki quizler `/quizzes` ucundan sunucu
 * sayfalı; başlık araması, sınıf, ders ve durum süzgeci. Çözen sayısı ve sınıf ortalaması sunucunun deneme
 * özetidir (`statistics`; cevaplardan hesaplanır, saklanmaz). Quiz hazırla ve düzenle, sonuçlar
 * ve arşiv aynı sağ panelde açılır.
 */
export function TeacherQuizzesPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const { session } = useAuth()
  const actor: QuizActor = useMemo(
    () => ({
      role: session?.role ?? '',
      teacherId: session?.links.find((link) => link.kind === 'teacher')?.recordId ?? null,
    }),
    [session],
  )
  const canCreate = quizActions(actor).create
  const classes = useCoreAll('classes')
  const filters = useClassSubjectFilters(classes.data ?? NONE)

  const list = useListState('quizler', { urlFilters: URL_FILTERS })
  const classId = filterValue(list.state.filters.classId)
  const subjectId = filterValue(list.state.filters.subjectId)
  const statusValue = filterValue(list.state.filters.status)
  const status = isStatus(statusValue) ? statusValue : undefined
  // Sunucu başlık araması: her tuşta istek atılmaz; sayfa arama değişince `useListState`'te sıfırlanır.
  const search = useDebouncedValue(list.state.query)
  const quizzes = useQuizList({
    page: list.state.page,
    pageSize: list.state.pageSize,
    q: search,
    ...(classId ? { classId } : {}),
    ...(subjectId ? { subjectId } : {}),
    ...(status ? { status } : {}),
  })
  const classById = useMemo(
    () => new Map((classes.data ?? NONE).map((row) => [row.record.id, row.record])),
    [classes.data],
  )
  const rows = useMemo(
    () =>
      quizzes.data?.rows.map((item) =>
        teacherQuizRow(item, { className: classById.get(item.classId)?.name }),
      ),
    [quizzes.data, classById],
  )
  // Sonuçları görmeyen öğretmene (başka dersin öğretmeni) sayı yerine "—" (DOM-AKD-079).
  const sees = (row: TeacherQuizRow) =>
    seesQuizResults(actor, row, classById.get(row.classId)?.teacherId)

  const detail = useDetailPanel('quiz')
  const form = useDetailPanel('quiz-form')
  const openQuiz = detail.open

  const columns: DataColumn<TeacherQuizRow>[] = [
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
    { key: 'solved', label: 'Çözen', cell: (row) => (sees(row) ? row.solved : '—') },
    {
      key: 'average',
      label: 'Sınıf ortalaması',
      cell: (row) =>
        !sees(row) ? '—' : row.average === null ? 'Çözen yok' : <strong>%{row.average}</strong>,
    },
    { key: 'dueDate', label: 'Son tarih', cell: (row) => quizDueText(row.dueDate) },
    {
      key: 'status',
      label: 'Durum',
      cell: (row) => (
        <StatusBadge
          text={row.status === 'open' ? 'Açık' : 'Kapandı'}
          tone={row.status === 'open' ? 'green' : 'gray'}
        />
      ),
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
  ]

  const error = quizzes.error ?? classes.error
  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      <section
        aria-labelledby="quiz-tablosu"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
          <div>
            <h2 id="quiz-tablosu" className="text-lg font-semibold">
              Quiz listesi
            </h2>
            <p className="text-sm text-muted-foreground">
              {quizzes.data?.total ?? 0} quiz · Sınıf ortalamaları öğrenci cevaplarından hesaplanır
            </p>
          </div>
          {canCreate ? (
            <Button type="button" onClick={() => form.open(NEW_QUIZ)}>
              <Icon name="Plus" size={17} aria-hidden="true" />
              Quiz hazırla
            </Button>
          ) : null}
        </header>
        <ServerDataTable
          list={list}
          rows={rows}
          total={quizzes.data?.total ?? 0}
          sortable={NO_SORT}
          columns={columns}
          mobileColumns={MOBILE_COLUMNS}
          caption="Quiz listesi"
          empty="Henüz quiz yok."
          emptyFiltered="Bu süzgeçlere uyan quiz yok."
          loading={quizzes.isPending}
          fetching={quizzes.isFetching && !quizzes.isPending}
          error={
            error ? (
              <QueryError
                error={error}
                onRetry={() => {
                  if (quizzes.error) void quizzes.refetch()
                  if (classes.error) void classes.refetch()
                }}
              />
            ) : undefined
          }
          onRowClick={(row) => openQuiz(row.id)}
          externalActive={classId !== '' || subjectId !== '' || status !== undefined}
          externalLabel={[
            classId ? `Sınıf: ${filters.className(classId)}` : '',
            subjectId ? `Ders: ${filters.subjectName(subjectId)}` : '',
            status ? `Durum: ${status === 'open' ? 'Açık' : 'Kapandı'}` : '',
          ]
            .filter(Boolean)
            .join(' · ')}
          onReset={() => {
            for (const key of ['classId', 'subjectId', 'status'] as const)
              list.dispatch({ type: 'filter', key, value: '' })
          }}
          toolbar={
            <>
              <ClassSubjectFilters
                filters={filters}
                classId={classId}
                subjectId={subjectId}
                onChange={(key, value) => list.dispatch({ type: 'filter', key, value })}
              />
              <NativeSelect
                aria-label="Durum"
                value={status ?? ''}
                onChange={(event) =>
                  list.dispatch({ type: 'filter', key: 'status', value: event.target.value })
                }
                className="min-h-9 text-sm"
              >
                {STATUS_OPTIONS.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </>
          }
        />
      </section>
      <QuizResultsPanel detail={detail} form={form} actor={actor} />
    </>
  )
}
