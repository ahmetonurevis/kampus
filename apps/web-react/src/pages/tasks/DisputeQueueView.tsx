import { useMemo } from 'react'
import { useGradingQueue } from '@kampus/react-shared/use-task-grading.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { disputeRow, type DisputeRow } from './dispute-model.ts'
import { FinalScoreModal } from './FinalScoreModal.tsx'

const URL_FILTERS = { overdue: 'gecikme' }
const NO_SORT: readonly string[] = []
const MOBILE_COLUMNS = ['learner', 'assignment', 'dueAt']

type Overdue = 'true' | 'false'
const isOverdue = (value: unknown): value is Overdue => value === 'true' || value === 'false'

/**
 * Uyuşmazlık kuyruğu (OG-058; IST-005, IST-048; DOM-BEC-024, DOM-YTK-027): iki puanı birden
 * fazla bant ayrışıp koordinatörün son puanını bekleyen yazma teslimleri
 * (`GET /task-submissions/grading-queue?awaiting=resolution`), sunucu sayfalı, en eski gönderim
 * önce. Kapsam sunucudadır: zümre başkanı (okul) atanan içeriğin dersinde, akademik koordinatör
 * (dil okulu) seviyesinde görür; atamayı görmese de. Satırdan son puan penceresi `?son-puan=` ile
 * açılır; son puan verilince teslim kuyruktan düşer.
 */
export function DisputeQueueView() {
  const list = useListState('uyusmazlik', { urlFilters: URL_FILTERS, urlPrefix: 'uk-' })
  const rawOverdue = list.state.filters.overdue
  const overdue = isOverdue(rawOverdue) ? rawOverdue : ''
  const queue = useGradingQueue({
    page: list.state.page,
    pageSize: list.state.pageSize,
    awaiting: 'resolution',
    ...(overdue ? { overdue } : {}),
  })
  const finalScore = useDetailPanel('son-puan')
  const openFinal = finalScore.open

  // TODO(uyusmazlik-derin-baslik): Teslim ayrıntısı yanıtında görev başlığı yok; derin bağlantıyla
  // (`?son-puan=`) açılan teslim bu sayfada değilse pencere başlığı "Görev" kalır. Ayrıntıya
  // `assignmentTitle` eklenince buradan beslenir (API alanı Oğuzhan'ındır).
  const titles = useMemo(
    () =>
      new Map((queue.data?.data ?? []).map((item) => [item.id, item.assignmentTitle ?? undefined])),
    [queue.data],
  )
  const rows = useMemo<DisputeRow[] | undefined>(
    () => queue.data?.data.map((item) => disputeRow(item)),
    [queue.data],
  )

  const columns = useMemo<DataColumn<DisputeRow>[]>(
    () => [
      {
        key: 'learner',
        label: 'Öğrenci',
        cell: (row) => (
          <button
            type="button"
            onClick={() => openFinal(row.id)}
            className="record-link max-w-[240px] truncate text-left font-medium text-primary hover:underline"
          >
            {row.learner}
          </button>
        ),
      },
      { key: 'assignment', label: 'Görev' },
      { key: 'submittedAt', label: 'Son gönderim' },
      {
        key: 'dueAt',
        label: 'Puanlama süresi',
        cell: (row) =>
          row.overdue ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              {row.dueAt}
              <StatusBadge text="Süre aşıldı" tone="red" />
            </span>
          ) : (
            row.dueAt
          ),
      },
      {
        key: 'actions',
        label: 'İşlemler',
        cell: (row) => (
          <Button
            variant="secondary"
            size="sm"
            aria-label={`Son puanı ver: ${row.assignment}, ${row.submittedAt}`}
            onClick={() => openFinal(row.id)}
          >
            <Icon name="ClipboardCheck" size={15} aria-hidden="true" />
            Son puanı ver
          </Button>
        ),
      },
    ],
    [openFinal],
  )

  return (
    <section
      aria-labelledby="uyusmazlik-kuyrugu"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading px-6 pt-6 pb-2">
        <h2 id="uyusmazlik-kuyrugu" className="text-lg font-semibold">
          Uyuşmazlık kuyruğu
        </h2>
        <p className="text-sm text-muted-foreground">
          {queue.data?.meta.total ?? 0} teslim · İki puanı ayrışan ve son puanını sizin
          verebileceğiniz yazılar
        </p>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={queue.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={MOBILE_COLUMNS}
        caption="Uyuşmazlık kuyruğu"
        search={false}
        empty="Son puan bekleyen uyuşmazlık yok."
        emptyFiltered="Bu süzgece uyan uyuşmazlık yok."
        loading={queue.isPending}
        fetching={queue.isFetching && !queue.isPending}
        error={
          queue.error ? (
            <QueryError error={queue.error} onRetry={() => void queue.refetch()} />
          ) : undefined
        }
        onRowClick={(row) => openFinal(row.id)}
        externalActive={overdue !== ''}
        externalLabel={overdue === 'true' ? 'Süresi aşılanlar' : 'Süresi aşılmayanlar'}
        onReset={() => list.dispatch({ type: 'filter', key: 'overdue', value: '' })}
        toolbar={
          <NativeSelect
            aria-label="Puanlama süresi"
            value={overdue}
            onChange={(event) =>
              list.dispatch({ type: 'filter', key: 'overdue', value: event.target.value })
            }
            className="min-h-9 text-sm"
          >
            <NativeSelectOption value="">Tüm süreler</NativeSelectOption>
            <NativeSelectOption value="true">Süresi aşılanlar</NativeSelectOption>
            <NativeSelectOption value="false">Süresi aşılmayanlar</NativeSelectOption>
          </NativeSelect>
        }
      />
      <FinalScoreModal
        submissionId={finalScore.selectedId}
        assignmentTitle={titles.get(finalScore.selectedId)}
        onClose={finalScore.close}
      />
    </section>
  )
}
