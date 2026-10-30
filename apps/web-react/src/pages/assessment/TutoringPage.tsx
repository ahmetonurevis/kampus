import { use, useMemo, useState } from 'react'
import type { Session } from '@/auth/auth-port.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { useNow } from '@/hooks/use-now.ts'
import { ViewScopeContext } from '@/layout/view-scope.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { useSourcesState } from '../workflows/use-workflow-state.ts'
import { collectionSources, coreSession } from '../workflows/workflow-state.ts'
import { AssessmentPanel } from './AssessmentPanel.tsx'
import { TutorDetailPanel } from './TutorDetailPanel.tsx'
import { TutoringPlanSection } from './TutoringPlanSection.tsx'
import { TUTORING_LIST_SOURCES, tutorRows, type TutorRow } from './tutoring-model.ts'

const MOBILE_COLUMNS = ['title', 'status'] as const

/**
 * Otomatik etüt (Vue `AssessmentAutomation.vue`, etüt bölümü): yönetici ve öğretmen plan
 * önizler/onaylar, etüt iptal eder ve yoklama alır; öğrenci ve veli yalnız kendi kapsamındaki
 * etütleri salt okunur görür (kapsamı sunucu ve core `tutoringSessions` uygular; veli seçili
 * çocuğu görür). İptal gerekçesi ve yoklama geçmişi ayrıntıda korunur.
 */
export function TutoringPage({ page }: { page: NavPage }) {
  const { session } = useAuth()
  useDocumentTitle(page.title)
  if (!session) return null
  return <TutoringView page={page} session={session} />
}

function TutoringView({ page, session }: { page: NavPage; session: Session }) {
  const childId = use(ViewScopeContext)
  const actor = useMemo(() => coreSession(session, childId), [session, childId])
  const sources = useMemo(
    () => collectionSources(TUTORING_LIST_SOURCES, session.role),
    [session.role],
  )
  const data = useSourcesState(sources, session)
  const panel = useDetailPanel('etut')
  const [planning, setPlanning] = useState(false)
  const writer = session.role === 'yonetici' || session.role === 'ogretmen'

  // Yoklama başlangıç saatinden sonra açılır; saat dakikada bir tazelenir.
  const now = useNow()
  const rows = tutorRows(data.state, actor, now)
  const selected = rows.find((row) => row.id === panel.selectedId)
  const openRecord = panel.open

  const columns = useMemo<DataColumn<TutorRow>[]>(
    () => [
      {
        key: 'title',
        label: 'Etüt',
        cell: (row) => (
          <button
            type="button"
            onClick={() => openRecord(row.id)}
            className="record-link text-left font-medium text-primary hover:underline"
          >
            {row.title}
          </button>
        ),
      },
      { key: 'when', label: 'Tarih' },
      { key: 'teacher', label: 'Öğretmen' },
      { key: 'room', label: 'Derslik' },
      { key: 'studentCount', label: 'Öğrenci' },
      { key: 'status', label: 'Durum', cell: (row) => <StatusBadge text={row.status} /> },
    ],
    [openRecord],
  )

  return (
    <>
      <PageHeading
        title={page.title}
        description={page.description}
        actions={
          writer ? (
            <Button onClick={() => setPlanning((open) => !open)} aria-expanded={planning}>
              <Icon name="Plus" size={17} aria-hidden="true" />
              {planning ? 'Planlamayı kapat' : 'Etüt planla'}
            </Button>
          ) : undefined
        }
      />
      {planning && writer ? <TutoringPlanSection session={session} actor={actor} /> : null}
      <AssessmentPanel
        id="etut-listesi"
        title="Etütler"
        description={
          writer
            ? `${rows.length} etüt · iptal gerekçesi ve yoklama geçmişi korunur`
            : `${rows.length} etüt · yalnız ${session.role === 'veli' ? 'seçili çocuğunuzun' : 'sizin'} etütleri`
        }
        flush
      >
        {data.error ? <QueryError error={data.error} onRetry={data.retry} /> : null}
        <DataTable
          listKey="etutler"
          rows={rows}
          columns={columns}
          mobileColumns={MOBILE_COLUMNS}
          searchKeys={['title', 'teacher', 'room', 'status']}
          caption="Etütler"
          empty="Henüz etüt yok."
          onRowClick={(row) => openRecord(row.id)}
        />
      </AssessmentPanel>
      <TutorDetailPanel
        selectedId={panel.selectedId}
        row={selected}
        pending={data.pending}
        version={selected ? data.versions.get(selected.id) : undefined}
        onClose={panel.close}
      />
    </>
  )
}
