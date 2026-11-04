import { useMemo } from 'react'
import { useGradingQueue, type GradingQueueItem } from '@kampus/react-shared/use-task-grading.ts'
import { useTaskAssignments } from '@kampus/react-shared/use-task-assignments.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useListState } from '@/hooks/use-list-state.ts'
import { SubmissionGradingModal } from './SubmissionGradingModal.tsx'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import {
  AWAITING_OPTIONS,
  isAwaitingFilter,
  queueAction,
  queueStatus,
  type QueuePhase,
} from './second-rating-model.ts'
import { dateTimeLabel, isStaffAssignment, learnerLabel } from './task-model.ts'

const URL_FILTERS = { assignmentId: 'atama', awaiting: 'bekleyen' }
const NO_SORT: readonly string[] = []
const MOBILE_COLUMNS = ['learner', 'status', 'submittedAt']

interface QueueRow extends Record<string, unknown> {
  id: string
  learner: string
  assignment: string
  status: string
  statusTone: ReturnType<typeof queueStatus>['tone']
  phase: QueuePhase
  versions: number
  submittedAt: string
  words: string
}

/**
 * Puanlama kuyruğu (`GET /task-submissions/grading-queue`): puanlanmayı bekleyen yazma teslimleri,
 * sunucu sayfalı. Kapsam sunucudadır: öğretmen atamayı gören (atayan olmasa da) teslimleri görür
 * (DOM-YTK-028). Satırdan puanlama penceresi `?puanla=` ile açılır; puan verilince teslim kuyruktan
 * düşer. İkinci puanı bekleyen teslim ayrı görünür ve aynı pencerede kör puanlanır (OG-210;
 * DOM-BEC-024); `bekleyen` süzgeci ilk ya da ikinci puan bekleyenleri ayırır. Atama adı atama listesinden eşlenir.
 */
export function GradingQueueView() {
  const list = useListState('puanlama', { urlFilters: URL_FILTERS, urlPrefix: 'pk-' })
  const assignmentId =
    typeof list.state.filters.assignmentId === 'string' ? list.state.filters.assignmentId : ''
  const rawAwaiting = list.state.filters.awaiting
  const awaiting = isAwaitingFilter(rawAwaiting) ? rawAwaiting : ''
  const queue = useGradingQueue({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(assignmentId ? { assignmentId } : {}),
    ...(awaiting ? { awaiting } : {}),
  })
  const assignments = useTaskAssignments({ page: 1, pageSize: 100 })
  const titles = useMemo(
    () =>
      new Map(
        (assignments.data?.data ?? []).filter(isStaffAssignment).map((item) => [item.id, item]),
      ),
    [assignments.data],
  )
  const grading = useDetailPanel('puanla')
  const openGrading = grading.open

  const rows = useMemo<QueueRow[] | undefined>(
    () =>
      queue.data?.data.map((item: GradingQueueItem) => {
        // İki puanı ayrışan teslim koordinatörün son puanını bekler (DOM-BEC-024); öğretmen burada
        // yeniden puanlayamaz, durum bunu söyler. İkinci puan bekleyen satır kör puanlanır.
        const status = queueStatus(item)
        return {
          id: item.id,
          learner: learnerLabel(item),
          assignment: titles.get(item.assignmentId)?.title ?? item.assignmentTitle ?? 'Görev',
          status: status.label,
          statusTone: status.tone,
          phase: status.phase,
          versions: item.versionCount,
          submittedAt: dateTimeLabel(item.latestVersion?.submittedAt),
          words: item.latestVersion?.wordCount ? String(item.latestVersion.wordCount.count) : '—',
        }
      }),
    [queue.data, titles],
  )

  const columns = useMemo<DataColumn<QueueRow>[]>(
    () => [
      {
        key: 'learner',
        label: 'Öğrenci',
        cell: (row) => (
          <button
            type="button"
            onClick={() => openGrading(row.id)}
            aria-label={queueAction(row.phase, row.learner).ariaLabel}
            className="record-link max-w-[240px] truncate text-left font-medium text-primary hover:underline"
          >
            {row.learner}
          </button>
        ),
      },
      { key: 'assignment', label: 'Görev' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => <StatusBadge text={row.status} tone={row.statusTone} />,
      },
      { key: 'versions', label: 'Sürüm' },
      { key: 'submittedAt', label: 'Son gönderim' },
      { key: 'words', label: 'Sözcük' },
      {
        key: 'actions',
        label: 'İşlemler',
        cell: (row) => {
          const action = queueAction(row.phase, row.learner)
          return (
            <Button
              variant="secondary"
              size="sm"
              aria-label={action.ariaLabel}
              onClick={() => openGrading(row.id)}
            >
              <Icon name="ClipboardCheck" size={15} aria-hidden="true" />
              {action.label}
            </Button>
          )
        },
      },
    ],
    [openGrading],
  )

  const assignmentOptions = [...titles.values()].filter((item) => item.scoringMode === 'teacher')
  return (
    <section
      aria-labelledby="puanlama-kuyrugu"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading px-6 pt-6 pb-2">
        <h2 id="puanlama-kuyrugu" className="text-lg font-semibold">
          Puanlama kuyruğu
        </h2>
        <p className="text-sm text-muted-foreground">
          {queue.data?.meta.total ?? 0} teslim · Rubrikle puanlanmayı bekleyen yazılar
        </p>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={queue.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={MOBILE_COLUMNS}
        caption="Puanlama kuyruğu"
        search={false}
        empty="Puanlanmayı bekleyen teslim yok."
        emptyFiltered="Bu görev için puanlanmayı bekleyen teslim yok."
        loading={queue.isPending}
        fetching={queue.isFetching && !queue.isPending}
        error={
          queue.error ? (
            <QueryError error={queue.error} onRetry={() => void queue.refetch()} />
          ) : undefined
        }
        onRowClick={(row) => openGrading(row.id)}
        externalActive={assignmentId !== '' || awaiting !== ''}
        externalLabel={[
          assignmentId ? `Görev: ${titles.get(assignmentId)?.title ?? 'Seçili görev'}` : '',
          awaiting ? (AWAITING_OPTIONS.find((item) => item.value === awaiting)?.label ?? '') : '',
        ]
          .filter(Boolean)
          .join(' · ')}
        onReset={() => list.dispatch({ type: 'filters', filters: {} })}
        toolbar={
          <>
            <NativeSelect
              aria-label="Görev"
              value={assignmentId}
              onChange={(event) =>
                list.dispatch({ type: 'filter', key: 'assignmentId', value: event.target.value })
              }
              className="min-h-9 text-sm"
            >
              <NativeSelectOption value="">Tüm görevler</NativeSelectOption>
              {assignmentOptions.map((item) => (
                <NativeSelectOption key={item.id} value={item.id}>
                  {item.title}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="Bekleyen puan"
              value={awaiting}
              onChange={(event) =>
                list.dispatch({ type: 'filter', key: 'awaiting', value: event.target.value })
              }
              className="min-h-9 text-sm"
            >
              {AWAITING_OPTIONS.map((item) => (
                <NativeSelectOption key={item.value} value={item.value}>
                  {item.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </>
        }
      />
      <SubmissionGradingModal submissionId={grading.selectedId} onClose={grading.close} />
    </section>
  )
}
