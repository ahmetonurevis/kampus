import { useMemo } from 'react'
import { useTaskAppeals } from '@kampus/react-shared/use-task-grading.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { appealQueueRow, appealQueueSummary, type AppealQueueRow } from './appeal-model.ts'
import { SubmissionGradingModal } from './SubmissionGradingModal.tsx'

const NO_SORT: readonly string[] = []
const MOBILE_COLUMNS = ['assignment', 'learner', 'filedAt']

/**
 * Açık itirazlar (OG-1010; DOM-BEC-025): karara bağlanmayı bekleyen görev itirazları
 * (`GET /task-appeals?status=open`), sunucu sayfalı, en eski itiraz önce. Kapsam sunucudadır:
 * öğretmen atamayı gördüğü (DOM-YTK-028) itirazları, yönetici kurumun hepsini görür; yönetici
 * yalnız okur, karar öğretmendedir. Satır, teslimin puanlama penceresini (`?puanla=`) itiraz
 * kartına odaklanarak açar. "Siz puanladınız" rozeti, kişi itiraz edilen sürümü puanladıysa
 * karar veremeyeceğini söyler (409 `rater_not_independent`). Karar verilince itiraz listeden düşer
 * (karar işlemi teslim önekini geçersiz kılar, `TASK_GRADING_INVALIDATES`).
 *
 * TODO(itiraz-kuyrugu-suzgec): Sunucu görev/öğrenci araması ve süzgeci sunmuyor; liste yalnız
 * sayfalanır, başlıkta toplam görünür. Uç arama alırsa buraya eklenir.
 */
export function AppealQueueView() {
  const list = useListState('itirazlar', { urlPrefix: 'it-' })
  const queue = useTaskAppeals({
    status: 'open',
    page: list.state.page,
    pageSize: list.state.pageSize,
  })
  const grading = useDetailPanel('puanla')
  const openGrading = grading.open

  const rows = useMemo<AppealQueueRow[] | undefined>(
    () => queue.data?.data.map(appealQueueRow),
    [queue.data],
  )

  const columns = useMemo<DataColumn<AppealQueueRow>[]>(
    () => [
      {
        key: 'assignment',
        label: 'Görev',
        cell: (row) => (
          <button
            type="button"
            onClick={() => openGrading(row.submissionId)}
            aria-label={`İtirazı aç: ${row.assignment}, ${row.learner}, ${row.version}`}
            className="record-link max-w-[280px] truncate text-left font-medium text-primary hover:underline"
          >
            {row.assignment}
          </button>
        ),
      },
      { key: 'learner', label: 'Öğrenci' },
      { key: 'version', label: 'Sürüm' },
      { key: 'filedAt', label: 'Açılma zamanı' },
      {
        key: 'scoredByViewer',
        label: 'Puanlama',
        cell: (row) =>
          row.scoredByViewer ? (
            <StatusBadge text="Siz puanladınız" tone="purple" />
          ) : (
            <span aria-hidden="true" className="text-muted-foreground">
              —
            </span>
          ),
      },
      {
        key: 'actions',
        label: 'İşlemler',
        cell: (row) => (
          <Button
            variant="secondary"
            size="sm"
            aria-label={`İtirazı incele: ${row.assignment}, ${row.learner}, ${row.version}`}
            onClick={() => openGrading(row.submissionId)}
          >
            <Icon name="ClipboardCheck" size={15} aria-hidden="true" />
            İncele
          </Button>
        ),
      },
    ],
    [openGrading],
  )

  return (
    <section
      aria-labelledby="acik-itirazlar"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading px-6 pt-6 pb-2">
        <h2 id="acik-itirazlar" className="text-lg font-semibold">
          Açık itirazlar
        </h2>
        <p className="text-sm text-muted-foreground">
          {appealQueueSummary(queue.data?.meta.total ?? 0)}
        </p>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={queue.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={MOBILE_COLUMNS}
        caption="Açık itirazlar"
        search={false}
        empty="Açık itiraz yok."
        emptyFiltered="Açık itiraz yok."
        loading={queue.isPending}
        fetching={queue.isFetching && !queue.isPending}
        error={
          queue.error ? (
            <QueryError error={queue.error} onRetry={() => void queue.refetch()} />
          ) : undefined
        }
        onRowClick={(row) => openGrading(row.submissionId)}
      />
      <SubmissionGradingModal
        submissionId={grading.selectedId}
        onClose={grading.close}
        focusAppeal
      />
    </section>
  )
}
