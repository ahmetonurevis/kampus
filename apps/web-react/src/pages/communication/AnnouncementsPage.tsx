import { useMemo, useState } from 'react'
import {
  useCollectionCounts,
  useCollectionItem,
  useCollectionList,
} from '@kampus/react-shared/use-collection.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { collectionQueryFromList } from '@/lib/collection-list.ts'
import type { NavPage } from '@/lib/navigation.ts'
import {
  announcementRow,
  canPublish,
  describeTarget,
  STATUS_PUBLISHED,
  STATUS_UNREAD,
  STATUS_UPDATED,
  STATUS_WITHDRAWN,
  type AnnouncementRecord,
  type AnnouncementRow,
} from '@kampus/react-shared/announcement-model.ts'
import {
  ANNOUNCEMENT_FILTERS,
  ANNOUNCEMENT_LIST,
  ANNOUNCEMENT_SORTABLE,
  ANNOUNCEMENT_UNREAD_QUERY,
  ANNOUNCEMENT_URL_FILTERS,
} from './announcement-list.ts'
import { AnnouncementFormModal } from './AnnouncementFormModal.tsx'
import { AnnouncementPanel } from './AnnouncementPanel.tsx'

const NONE: readonly never[] = []
const MOBILE_COLUMNS = ['category', 'date', 'status']
const STATUS_TONES = {
  [STATUS_WITHDRAWN]: 'red',
  [STATUS_UNREAD]: 'purple',
  [STATUS_UPDATED]: 'amber',
  [STATUS_PUBLISHED]: 'gray',
} as const

/**
 * Duyurular (bütün roller, Vue `Communication.vue` duyuru sekmesi): kurum içinde kullanıcının
 * alıcısı olduğu veya yayınladığı duyurular. Liste sunucu sayfalıdır: arama, durum süzgeci
 * (okuyucuya göre türetilir; DOM-ILT-003, DOM-ILT-004), sıralama ve sayfa sunucuda uygulanır,
 * durum adreste tutulur. Satırdan sağ panel açılır (sayfada olmayan duyuru kimlikle okunur) ve
 * alıcı için okundu yazılır. Yayınlayabilen roller yeni duyuru yayınlar, kendi duyurusunu
 * düzeltir veya gerekçeyle geri çeker.
 */
export function AnnouncementsPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const { session } = useAuth()
  const list = useListState('duyurular', { pageSize: 10, urlFilters: ANNOUNCEMENT_URL_FILTERS })
  const search = useDebouncedValue(list.state.query)
  const announcements = useCollectionList<AnnouncementRecord>(
    'announcements',
    collectionQueryFromList(list.state, ANNOUNCEMENT_LIST, search),
  )
  const unreadCount = useCollectionCounts('announcements', ANNOUNCEMENT_UNREAD_QUERY)
  const classes = useCoreAll('classes')
  const branches = useCoreAll('branches')
  const panel = useDetailPanel('duyuru')
  const openAnnouncement = panel.open
  const [creating, setCreating] = useState(false)

  const rows = useMemo(() => announcements.data?.rows.map(announcementRow), [announcements.data])
  // Açık duyuru sayfada olmayabilir (adres, panodaki kart): kimlikle okunur.
  const detail = useCollectionItem<AnnouncementRecord>('announcements', panel.selectedId || null)
  const selected = useMemo(
    () => (detail.data ? announcementRow(detail.data) : undefined),
    [detail.data],
  )
  const names = useMemo(
    () => ({
      branches: new Map((branches.data ?? NONE).map((row) => [row.record.id, row.record.name])),
      classes: new Map((classes.data ?? NONE).map((row) => [row.record.id, row.record.name])),
    }),
    [branches.data, classes.data],
  )
  const showRead = rows?.some((row) => row.read !== '') ?? false

  const columns = useMemo<DataColumn<AnnouncementRow>[]>(
    () => [
      {
        key: 'title',
        label: 'Duyuru',
        cell: (row) => (
          <button
            type="button"
            onClick={() => openAnnouncement(row.id)}
            aria-label={`${row.title} duyurusunu aç`}
            className="record-link max-w-[360px] truncate text-left font-medium text-primary hover:underline"
          >
            {row.title}
          </button>
        ),
      },
      { key: 'category', label: 'Kategori' },
      { key: 'date', label: 'Yayın', cell: (row) => dateLabel(row.date, { year: 'numeric' }) },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <span className="inline-flex flex-wrap gap-1.5">
            <StatusBadge
              text={row.status}
              tone={STATUS_TONES[row.status as keyof typeof STATUS_TONES] ?? 'gray'}
            />
            {row.revised && row.status === STATUS_UNREAD ? (
              <StatusBadge text={STATUS_UPDATED} tone="amber" />
            ) : null}
          </span>
        ),
      },
      ...(showRead
        ? [
            {
              key: 'read',
              label: 'Okundu',
              cell: (row: AnnouncementRow) => row.read || '—',
            },
          ]
        : []),
      {
        key: 'actions',
        label: 'İşlemler',
        cell: (row) => (
          <Button
            variant="secondary"
            size="sm"
            aria-label={`${row.title} ayrıntısı`}
            onClick={() => openAnnouncement(row.id)}
          >
            <Icon name="Eye" size={15} aria-hidden="true" />
            Aç
          </Button>
        ),
      },
    ],
    [openAnnouncement, showRead],
  )

  if (!session) return null
  const viewer = { role: session.role, userId: session.user.id }
  const error = announcements.error ?? classes.error ?? branches.error
  const total = announcements.data?.total ?? 0
  const unread = unreadCount.data?.total ?? 0

  return (
    <>
      <PageHeading
        title={page.title}
        description={page.description}
        actions={
          canPublish(session.role) ? (
            <Button onClick={() => setCreating(true)}>
              <Icon name="Plus" size={16} aria-hidden="true" />
              Yeni duyuru
            </Button>
          ) : null
        }
      />
      <section
        aria-labelledby="duyuru-listesi"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading px-6 pt-6 pb-2">
          <h2 id="duyuru-listesi" className="text-lg font-semibold">
            Duyuru listesi
          </h2>
          <p className="text-sm text-muted-foreground">
            {total} duyuru{unread > 0 ? ` · ${unread} okunmamış` : ''}
          </p>
        </header>
        <ServerDataTable
          list={list}
          rows={rows}
          total={total}
          sortable={ANNOUNCEMENT_SORTABLE}
          filters={ANNOUNCEMENT_FILTERS}
          columns={columns}
          mobileColumns={MOBILE_COLUMNS}
          caption="Duyuru listesi"
          empty="Henüz duyuru yok."
          emptyFiltered="Aramanızla eşleşen duyuru bulunamadı."
          loading={announcements.isPending}
          fetching={announcements.isFetching && !announcements.isPending}
          error={
            error ? (
              <QueryError
                error={error}
                onRetry={() => {
                  for (const query of [announcements, classes, branches])
                    if (query.error) void query.refetch()
                }}
              />
            ) : undefined
          }
          onRowClick={(row) => openAnnouncement(row.id)}
        />
      </section>
      <AnnouncementPanel
        row={selected}
        announcementId={panel.selectedId}
        listReady={!detail.isPending}
        viewer={viewer}
        audience={selected ? describeTarget(selected.record.target, names) : ''}
        onClose={panel.close}
      />
      <AnnouncementFormModal
        open={creating}
        role={session.role}
        institutionType={session.institution.type}
        classes={classes.data ?? NONE}
        branches={branches.data ?? NONE}
        onClose={() => setCreating(false)}
      />
    </>
  )
}
