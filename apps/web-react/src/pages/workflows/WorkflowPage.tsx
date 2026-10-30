import { use, useMemo, useState } from 'react'
import {
  workflowCreateActions,
  workflowDetails,
  workflowRows,
  type WorkflowAction,
} from '@kampus/school-core/lib/workflow-presentation.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { workflowPage } from '@kampus/school-core/modules/school-workflows.ts'
import type { Session } from '@/auth/auth-port.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ViewScopeContext } from '@/layout/view-scope.ts'
import { exportCsv } from '@/lib/download.ts'
import { filterOptions, type FilterField } from '@/lib/list-query.ts'
import type { UrlFilters } from '@/lib/list-url.ts'
import { ACTIONS_KEY, listView } from '@/lib/list-view.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { useWorkflowState } from './use-workflow-state.ts'
import { WorkflowDetailPanel } from './WorkflowDetailPanel.tsx'
import { WorkflowFormPanel } from './WorkflowFormPanel.tsx'
import {
  coreSession,
  isWorkflowModuleKey,
  workflowScopeLabel,
  workflowTableRow,
  type WorkflowModuleKey,
  type WorkflowTableRow,
} from './workflow-state.ts'

const URL_FILTERS: UrlFilters = { status: 'durum' }
const SORTABLE = ['title', 'subtitle', 'status', 'date'] as const
const SEARCH_KEYS = ['title', 'subtitle', 'body', 'status'] as const
const MOBILE_COLUMNS = ['subtitle', 'status'] as const
const STATUS_FIELD: FilterField = { key: 'status', label: 'Durum' }

/**
 * Okul iş akışı sayfası (Vue `SchoolWorkflows.vue`): menü yolundan core modül tanımı, satırlar
 * core `workflowRows`, detay `workflowDetails`, oluşturma `workflowCreateActions`, form
 * `workflowForm`. Kapsamı sunucu uygular (veli seçili çocuk, öğretmen görev kapsamı, rehberlik
 * iç notu); ekran ayrı süzgeç yazmaz.
 */
export function WorkflowPage({ page }: { page: NavPage }) {
  const { session } = useAuth()
  const definition = workflowPage(page.path)
  useDocumentTitle(page.title)
  if (!session || !definition || !isWorkflowModuleKey(definition.key)) return null
  return <WorkflowView page={page} module={definition.key} session={session} />
}

type ViewProps = { page: NavPage; module: WorkflowModuleKey; session: Session }

function WorkflowView({ page, module, session }: ViewProps) {
  const childId = use(ViewScopeContext)
  const actor = useMemo(() => coreSession(session, childId), [session, childId])
  const data = useWorkflowState(module, session)
  const list = useListState('kayitlar', { urlFilters: URL_FILTERS })
  const panel = useDetailPanel('kayit')
  const [action, setAction] = useState<WorkflowAction | null>(null)

  const coreRows = workflowRows(data.state, actor, page.path)
  const rows = coreRows.map(workflowTableRow)
  const statusField: FilterField = { ...STATUS_FIELD, options: filterOptions(STATUS_FIELD, rows) }
  const view = listView(rows, list.state, { fields: [statusField], searchKeys: SEARCH_KEYS })
  const createActions = workflowCreateActions(data.state, actor, page.path)
  const selected = coreRows.find((row) => row.id === panel.selectedId)
  const details = selected ? workflowDetails(data.state, actor, selected) : null
  const openRecord = panel.open

  const columns = useMemo<DataColumn<WorkflowTableRow>[]>(
    () => [
      {
        key: 'title',
        label: 'Kayıt',
        cell: (row) => (
          <button
            type="button"
            onClick={() => openRecord(row.id)}
            className="record-link text-left font-medium text-primary hover:underline"
          >
            {row.title || 'Adsız kayıt'}
          </button>
        ),
      },
      { key: 'subtitle', label: 'Kapsam / Tarih' },
      {
        key: 'body',
        label: 'Özet',
        cell: (row) => <span className="text-sm whitespace-pre-line">{row.body}</span>,
      },
      { key: 'status', label: 'Durum', cell: (row) => <StatusBadge text={row.status} /> },
      {
        key: 'date',
        label: 'Tarih',
        cell: (row) => (row.date ? dateLabel(row.date) : '—'),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button variant="secondary" size="sm" onClick={() => openRecord(row.id)}>
            Ayrıntılar
          </Button>
        ),
      },
    ],
    [openRecord],
  )

  function download() {
    exportCsv(
      page.path,
      [{ key: 'id', label: 'id' }, ...columns.filter((column) => column.key !== ACTIONS_KEY)],
      view.rows,
    )
  }

  return (
    <>
      <PageHeading
        title={page.title}
        description={page.description}
        actions={createActions.map((item, index) => (
          <Button
            key={item.command}
            variant={index === 0 ? 'default' : 'secondary'}
            onClick={() => setAction(item)}
            disabled={data.pending}
          >
            <Icon name="Plus" size={17} aria-hidden="true" />
            {item.label}
          </Button>
        ))}
      />
      <section
        aria-labelledby="is-akisi-kayitlari"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading flex flex-wrap items-end justify-between gap-3 px-6 pt-6 pb-2 max-[650px]:px-4">
          <div className="min-w-0">
            <h2 id="is-akisi-kayitlari" className="text-lg font-semibold">
              {page.title}
            </h2>
            <p className="text-sm text-muted-foreground">
              {view.total} kayıt · {workflowScopeLabel(session.role)}
            </p>
          </div>
          <Button variant="secondary" onClick={download} disabled={data.pending}>
            <Icon name="Download" size={17} aria-hidden="true" />
            CSV indir
          </Button>
        </header>
        <ServerDataTable
          list={list}
          rows={data.pending ? undefined : view.visible}
          total={view.total}
          sortable={SORTABLE}
          filters={[statusField]}
          columns={columns}
          mobileColumns={MOBILE_COLUMNS}
          caption={page.title}
          empty="Henüz kayıt yok. Yetkili rolden yeni kayıt ekleyebilirsiniz."
          loading={data.pending}
          fetching={data.fetching && !data.pending}
          error={data.error ? <QueryError error={data.error} onRetry={data.retry} /> : undefined}
          onRowClick={(row) => openRecord(row.id)}
        />
      </section>
      <WorkflowDetailPanel
        selectedId={panel.selectedId}
        row={selected}
        details={details}
        pending={data.pending}
        onAction={setAction}
        onClose={panel.close}
      />
      <WorkflowFormPanel
        action={action}
        state={data.state}
        session={actor}
        version={action?.recordId ? data.versions.get(action.recordId) : undefined}
        onClose={() => setAction(null)}
      />
    </>
  )
}
