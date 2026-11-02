import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { useTaskAssignments } from '@kampus/react-shared/use-task-assignments.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { NEW_ASSIGNMENT, TaskAssignmentForm } from './TaskAssignmentForm.tsx'
import { TaskAssignmentPanel } from './TaskAssignmentPanel.tsx'
import { SubmissionGradingModal } from './SubmissionGradingModal.tsx'
import { ATTEMPT_PARAM, AttemptReviewModal } from './AttemptReviewModal.tsx'
import {
  assignmentRow,
  assignmentScopeNote,
  dateTimeLabel,
  isStaffAssignment,
  KIND_OPTIONS,
  type AssignmentRow,
} from './task-model.ts'
import { useTaskLookups } from './use-task-lookups.ts'

const URL_FILTERS = { kind: 'amac' }
const NO_SORT: readonly string[] = []
const MOBILE_COLUMNS = ['contentType', 'dueAt', 'owner']

/**
 * Görevler (öğretmen ve yönetici): atadıklarım ve sınıflarımı hedefleyen atamalar, sunucu sayfalı
 * (kapsam sunucuda; DOM-YTK-028: sınıfın öğretmeni görür, yalnız atayan değiştirir). Satırdan
 * ayrıntı sağ panelde (`?gorev=`), yeni atama geniş pencerede (`?gorev-form=yeni`), teslim
 * puanlama penceresi `?puanla=`, otomatik puanlı görevin deneme ayrıntısı `?deneme=` ile açılır.
 */
export function TaskAssignmentsView() {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const list = useListState('gorevler', { urlFilters: URL_FILTERS, urlPrefix: 'gl-' })
  const kind = typeof list.state.filters.kind === 'string' ? list.state.filters.kind : ''
  const assignments = useTaskAssignments({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(kind ? { kind: kind as 'evaluation' | 'practice' } : {}),
  })
  const { names } = useTaskLookups({ students: false })
  const rows = useMemo<AssignmentRow[] | undefined>(
    () =>
      assignments.data?.data
        .filter(isStaffAssignment)
        .map((item) => assignmentRow(item, names, userId)),
    [assignments.data, names, userId],
  )

  const panel = useDetailPanel('gorev')
  const form = useDetailPanel('gorev-form')
  const grading = useDetailPanel('puanla')
  const review = useDetailPanel(ATTEMPT_PARAM)
  // Panel açıkken deneme penceresi panelin içinde (iç içe pencere), değilse tek başına çizilir.
  const reviewModal = <AttemptReviewModal attemptId={review.selectedId} onClose={review.close} />
  const openPanel = panel.open
  const navigate = useNavigate()
  /** Yeni görev kaydedilince form kapanır, yeni kaydın ayrıntısı açılır (tek geçmiş adımı). */
  const showCreated = (id: string) => {
    const next = new URLSearchParams(window.location.search)
    next.delete('gorev-form')
    next.set('gorev', id)
    void Promise.resolve(
      navigate({ search: `?${next.toString()}` }, { replace: true, preventScrollReset: true }),
    ).catch((error: unknown) => console.error('[panel] açılamadı', error))
  }

  const columns = useMemo<DataColumn<AssignmentRow>[]>(
    () => [
      {
        key: 'title',
        label: 'Görev',
        cell: (row) => (
          <button
            type="button"
            onClick={() => openPanel(row.id)}
            aria-label={`${row.title} görev ayrıntısını aç`}
            className="record-link max-w-[300px] truncate text-left font-medium text-primary hover:underline"
          >
            {row.title}
          </button>
        ),
      },
      { key: 'contentType', label: 'Tür' },
      { key: 'kind', label: 'Amaç' },
      { key: 'scoring', label: 'Puanlama' },
      { key: 'targets', label: 'Hedef' },
      { key: 'dueAt', label: 'Son teslim', cell: (row) => dateTimeLabel(row.dueAt) },
      {
        key: 'owner',
        label: 'Atayan',
        cell: (row) => (
          <StatusBadge text={row.owner} tone={row.owner === 'Siz' ? 'purple' : 'gray'} />
        ),
      },
      {
        key: 'actions',
        label: 'İşlemler',
        cell: (row) => (
          <Button
            variant="secondary"
            size="sm"
            aria-label={`${row.title} görev ayrıntısı`}
            onClick={() => openPanel(row.id)}
          >
            <Icon name="Eye" size={15} aria-hidden="true" />
            Ayrıntı
          </Button>
        ),
      },
    ],
    [openPanel],
  )

  return (
    <section
      aria-labelledby="gorev-tablosu"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div>
          <h2 id="gorev-tablosu" className="text-lg font-semibold">
            Görev atamaları
          </h2>
          <p className="text-sm text-muted-foreground">
            {assignments.data?.meta.total ?? 0} görev · {assignmentScopeNote(session?.role ?? '')}
          </p>
        </div>
        <Button onClick={() => form.open(NEW_ASSIGNMENT)}>
          <Icon name="Plus" size={17} aria-hidden="true" />
          Yeni görev
        </Button>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={assignments.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={MOBILE_COLUMNS}
        caption="Görev atamaları"
        search={false}
        empty="Henüz görev atanmadı."
        emptyFiltered="Bu amaçta görev yok."
        loading={assignments.isPending}
        fetching={assignments.isFetching && !assignments.isPending}
        error={
          assignments.error ? (
            <QueryError error={assignments.error} onRetry={() => void assignments.refetch()} />
          ) : undefined
        }
        onRowClick={(row) => openPanel(row.id)}
        externalActive={kind !== ''}
        externalLabel={`Amaç: ${KIND_OPTIONS.find((option) => option.value === kind)?.label ?? kind}`}
        onReset={() => list.dispatch({ type: 'filter', key: 'kind', value: '' })}
        toolbar={
          <NativeSelect
            aria-label="Görev amacı"
            value={kind}
            onChange={(event) =>
              list.dispatch({ type: 'filter', key: 'kind', value: event.target.value })
            }
            className="min-h-9 text-sm"
          >
            <NativeSelectOption value="">Tüm amaçlar</NativeSelectOption>
            {KIND_OPTIONS.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        }
      />
      <TaskAssignmentPanel
        assignmentId={panel.selectedId}
        onClose={panel.close}
        onGrade={grading.open}
        onReview={review.open}
      >
        {panel.selectedId ? reviewModal : null}
      </TaskAssignmentPanel>
      <TaskAssignmentForm
        open={form.selectedId === NEW_ASSIGNMENT}
        onClose={form.close}
        onCreated={showCreated}
      />
      <SubmissionGradingModal submissionId={grading.selectedId} onClose={grading.close} />
      {panel.selectedId ? null : reviewModal}
    </section>
  )
}
