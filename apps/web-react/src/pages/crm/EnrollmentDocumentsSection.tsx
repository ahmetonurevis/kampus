import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  useEnrollmentDocumentList,
  useEnrollmentDocuments,
} from '@kampus/react-shared/use-enrollment-documents.ts'
import { useProspectDocumentUrlFetcher } from '@kampus/react-shared/use-prospect-documents.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { FILE_OPEN_FAILED, FILE_POPUP_BLOCKED } from '../learning/SubmissionFiles.tsx'
import {
  canReadEnrollmentDocuments,
  enrollmentConsentLabel,
  enrollmentDocumentView,
  enrollmentListRow,
  MISSING_FILTER,
  type EnrollmentDocumentView,
  type EnrollmentListRowView,
} from './enrollment-documents.ts'
import { missingLabel } from './prospect-documents.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['missingCount', 'documents']
const URL_FILTERS = { status: 'durum' } as const
const FILTERS = [
  {
    key: 'status',
    label: 'Durum',
    type: 'select' as const,
    options: [{ value: MISSING_FILTER, label: 'Eksik belgesi olanlar' }],
  },
]

/**
 * Kayıt belgeleri (DOM-KAY-045; ON-344, K-386): kesin kayıtta aday belgelerinden öğrenci dosyasına
 * bağlanan belgeler. Personelin React'te genel öğrenci kartı olmadığı için bölüm Kayıt
 * İşlemleri'ndedir. Liste aday kaydından gelen aktif öğrencileri, eksik zorunlu belgeleri ve
 * incelemesi bekleyen belgeleri gösterir; ayrıntı penceresi belgeyi aday belge ucundan açar (her
 * açılış denetim kaydı). Belge ekleme ve inceleme aday kartındadır.
 */
export function EnrollmentDocumentsSection() {
  const { session } = useAuth()
  if (!canReadEnrollmentDocuments(session?.role)) return null
  return <DocumentList role={session?.role ?? ''} />
}

function DocumentList({ role }: { role: string }) {
  const list = useListState('kayit-belgeleri', { urlPrefix: 'evrak_', urlFilters: URL_FILTERS })
  const search = useDebouncedValue(list.state.query).trim()
  const missingOnly = list.state.filters.status === MISSING_FILTER
  const documents = useEnrollmentDocumentList({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search === '' ? {} : { q: search }),
    missingOnly: missingOnly ? 'true' : 'false',
  })
  const [selected, setSelected] = useState<EnrollmentListRowView | null>(null)
  const rows = useMemo(() => documents.data?.data.map(enrollmentListRow), [documents.data])
  const columns = useMemo<DataColumn<EnrollmentListRowView>[]>(
    () => [
      { key: 'name', label: 'Öğrenci' },
      { key: 'documents', label: 'Bağlı belgeler' },
      {
        key: 'missingCount',
        label: 'Eksik',
        cell: (row) => (
          <StatusBadge text={row.missingCount} tone={row.missing === '—' ? 'green' : 'amber'} />
        ),
      },
      { key: 'missing', label: 'Eksik belgeler' },
      { key: 'awaiting', label: 'İnceleme' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setSelected(row)}
            aria-label={`${row.name} kayıt belgelerini göster`}
          >
            <Icon name="FileText" size={15} aria-hidden="true" />
            Belgeler
          </Button>
        ),
      },
    ],
    [],
  )

  return (
    <section aria-labelledby="kayit-belgeleri-baslik" className="mt-6">
      <h2 id="kayit-belgeleri-baslik" className="text-lg font-semibold">
        Kayıt belgeleri
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Kesin kayıtta kabul edilmiş aday belgeleri öğrenci dosyasına bağlanır. Eksik ya da yeniden
        istenen belgeyi aday kartından ekleyin ve inceleyin.
      </p>
      <ServerDataTable
        list={list}
        rows={rows}
        total={documents.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={FILTERS}
        mobileColumns={MOBILE}
        caption="Öğrencilerin kayıt belgeleri"
        empty="Aday kaydından gelen aktif öğrenci yok."
        emptyFiltered="Bu seçimle eşleşen öğrenci yok."
        loading={documents.isPending}
        fetching={documents.isFetching && !documents.isPending}
        error={
          documents.error ? (
            <QueryError error={documents.error} onRetry={() => void documents.refetch()} />
          ) : undefined
        }
      />
      <StudentDocumentsModal row={selected} role={role} onClose={() => setSelected(null)} />
    </section>
  )
}

function StudentDocumentsModal({
  row,
  role,
  onClose,
}: {
  row: EnrollmentListRowView | null
  role: string
  onClose: () => void
}) {
  const detail = useEnrollmentDocuments(row?.id ?? null)
  const data = detail.data?.data
  const consent = data ? enrollmentConsentLabel(data.consent) : null
  return (
    <Modal
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={row ? `${row.name} kayıt belgeleri` : 'Kayıt belgeleri'}
      footer={
        row ? (
          <Button asChild variant="secondary">
            <Link to={`/${role}/aday/${encodeURIComponent(row.prospectId)}`}>
              Aday kartında belgeleri yönet
            </Link>
          </Button>
        ) : null
      }
    >
      {detail.error ? (
        <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
      ) : !data ? (
        <SummaryLoading />
      ) : (
        <div className="grid gap-4">
          {data.gaps.missing.length > 0 ? (
            <p role="note" className="rounded-md border bg-warning-soft p-3 text-sm">
              Eksik belgeler: {missingLabel(data.gaps.missing)}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Zorunlu kayıt belgeleri tam.</p>
          )}
          {data.gaps.awaitingReview > 0 ? (
            <p className="text-sm">
              {data.gaps.awaitingReview} belge aday kartında inceleme bekliyor; kabul edilince
              öğrenci dosyasına bağlanır.
            </p>
          ) : null}
          {consent ? <p className="text-sm">{consent}</p> : null}
          <DocumentItems rows={data.documents.map(enrollmentDocumentView)} />
        </div>
      )}
    </Modal>
  )
}

function DocumentItems({ rows }: { rows: readonly EnrollmentDocumentView[] }) {
  const fetchUrl = useProspectDocumentUrlFetcher()
  const [opening, setOpening] = useState('')

  async function open(row: EnrollmentDocumentView) {
    const tab = window.open('about:blank', '_blank')
    if (!tab) {
      // Bağlantı üretmek denetim kaydıdır; pencere açılamıyorsa üretilmez.
      notify.error(FILE_POPUP_BLOCKED)
      return
    }
    setOpening(row.id)
    try {
      const { url } = await fetchUrl(row.prospectId, row.id)
      tab.opener = null
      tab.location.href = url
    } catch (error) {
      tab.close()
      notify.error(FILE_OPEN_FAILED, error)
    } finally {
      setOpening('')
    }
  }

  if (rows.length === 0)
    return <p className="text-sm text-muted-foreground">Öğrenci dosyasına bağlı belge yok.</p>
  return (
    <ul aria-label="Öğrenci dosyasındaki belgeler" className="grid gap-2">
      {rows.map((row) => (
        <li
          key={row.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
        >
          <div className="grid gap-0.5">
            <span className="font-medium">{row.typeLabel}</span>
            <span className="text-sm text-muted-foreground">
              {row.name} · {row.detail}
            </span>
          </div>
          {row.canOpen ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={opening !== ''}
              aria-label={`${row.typeLabel} belgesini aç`}
              onClick={() => void open(row)}
            >
              <Icon name="ExternalLink" size={15} aria-hidden="true" />
              Aç
            </Button>
          ) : row.locked ? (
            <span className="text-sm text-muted-foreground">{row.locked}</span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
