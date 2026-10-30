import { useMemo, useState } from 'react'
import { useCollectionAll } from '@kampus/react-shared/use-collection.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { TableGate } from '../learning/LearningParts.tsx'
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
} from './announcement-model.ts'
import { AnnouncementFormModal } from './AnnouncementFormModal.tsx'
import { AnnouncementPanel } from './AnnouncementPanel.tsx'

const NONE: readonly never[] = []
const MOBILE_COLUMNS = ['category', 'date', 'status']
const SEARCH_KEYS = ['title', 'text', 'category']
const NO_FILTER_COLUMNS = ['date']
const STATUS_TONES = {
  [STATUS_WITHDRAWN]: 'red',
  [STATUS_UNREAD]: 'purple',
  [STATUS_UPDATED]: 'amber',
  [STATUS_PUBLISHED]: 'gray',
} as const
const STATUS_OPTIONS = [STATUS_UNREAD, STATUS_UPDATED, STATUS_WITHDRAWN, STATUS_PUBLISHED].map(
  (value) => ({ value, label: value }),
)

/**
 * Duyurular (bütün roller, Vue `Communication.vue` duyuru sekmesi): kurum içinde kullanıcının
 * alıcısı olduğu veya yayınladığı duyurular. Arama, kategori ve durum süzgeci ile sayfalama
 * istemcidedir (durum `withdrawnAt`/`revisedAt`/`myReadAt`'ten türetilir; sunucu bu alanlarda
 * süzemez). Satırdan sağ panel açılır ve alıcı için okundu yazılır. Yayınlayabilen roller yeni
 * duyuru yayınlar, kendi duyurusunu düzeltir veya gerekçeyle geri çeker.
 * TODO(api-announcement-status-filter): durum süzgeci sunucuya inince liste sunucu sayfalı olur
 * (şimdi bir kurumun bütün duyurusu, en çok 5000, tek seferde okunur).
 */
export function AnnouncementsPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const { session } = useAuth()
  const announcements = useCollectionAll<AnnouncementRecord>('announcements', { sort: ['-date'] })
  const classes = useCoreAll('classes')
  const branches = useCoreAll('branches')
  const panel = useDetailPanel('duyuru')
  const openAnnouncement = panel.open
  const [creating, setCreating] = useState(false)

  const rows = useMemo(() => announcements.data?.map(announcementRow), [announcements.data])
  const names = useMemo(
    () => ({
      branches: new Map((branches.data ?? NONE).map((row) => [row.record.id, row.record.name])),
      classes: new Map((classes.data ?? NONE).map((row) => [row.record.id, row.record.name])),
    }),
    [branches.data, classes.data],
  )
  const selected = rows?.find((row) => row.id === panel.selectedId)
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
  const unread = rows?.filter((row) => row.unread).length ?? 0

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
            {rows?.length ?? 0} duyuru{unread > 0 ? ` · ${unread} okunmamış` : ''}
          </p>
        </header>
        <TableGate
          error={error}
          onRetry={() => {
            for (const query of [announcements, classes, branches])
              if (query.error) void query.refetch()
          }}
          loading={rows === undefined}
        >
          <DataTable
            listKey="duyurular"
            rows={rows ?? NONE}
            columns={columns}
            pageSize={10}
            mobileColumns={MOBILE_COLUMNS}
            caption="Duyuru listesi"
            searchKeys={SEARCH_KEYS}
            excludeFilters={NO_FILTER_COLUMNS}
            filters={[{ key: 'status', label: 'Durum', options: STATUS_OPTIONS }]}
            empty="Aramanızla eşleşen duyuru bulunamadı."
            onRowClick={(row) => openAnnouncement(row.id)}
          />
        </TableGate>
      </section>
      <AnnouncementPanel
        row={selected}
        announcementId={panel.selectedId}
        listReady={rows !== undefined}
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
