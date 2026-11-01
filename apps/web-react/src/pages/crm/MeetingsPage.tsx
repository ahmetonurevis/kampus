import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '@/auth/use-auth.ts'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { OPEN_PROSPECT_STAGES } from '@kampus/school-core/lib/prospects.ts'
import {
  MEETING_DAY_FILTER,
  MEETING_KIND_FILTER,
  meetingEvents,
  stageTone,
  type MeetingEvent,
} from './prospect-rows.ts'

const COLUMNS_MOBILE = ['timeRange', 'kindLabel', 'branch']

/**
 * Tanışma Görüşmeleri (ön büro, Vue `Crm.vue` `deneme-dersi-takvimi`): açık adayların planlanmış
 * tanışma görüşmeleri ve (dil okulunda) deneme dersleri tek listede. Yaklaşanlar önce gelir;
 * tür ve görüşme günü (başlangıç/bitiş) süzgeci, arama ve sıralama tarayıcıdadır. Ad adayın
 * detayına bağlanır (`/onburo/aday/:id`). Aday sayısı pipeline ile sınırlıdır, bu yüzden açık
 * adaylar bir kez çekilir; sunucuda "görüşmesi olan aday" süzgeci yoktur.
 * TODO(api-prospect-meeting-filter): görüşme ve deneme dersi tarihi sunucuda süzülünce liste
 * sayfalı okunur (`trialLesson` tarihi `dateField` listesinde yok).
 */
export function MeetingsPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const { session } = useAuth()
  const role = session?.role ?? 'onburo'
  const type = session?.institution.type ?? 'school'
  const prospects = useCoreAll('prospects', { filters: { stage: [...OPEN_PROSPECT_STAGES] } })
  const branches = useCoreAll('branches')
  const classes = useCoreAll('classes', {}, { enabled: type === 'language_school' })
  const [now] = useState(() => Date.now())
  const rows = useMemo(
    () =>
      meetingEvents(
        (prospects.data ?? []).map((item) => item.record),
        type,
        {
          now,
          branches: new Map(
            (branches.data ?? []).map((item) => [item.record.id, item.record.name]),
          ),
          classes: new Map((classes.data ?? []).map((item) => [item.record.id, item.record.name])),
        },
      ),
    [prospects.data, branches.data, classes.data, type, now],
  )
  const columns = useMemo<DataColumn<MeetingEvent>[]>(
    () => [
      {
        key: 'name',
        label: 'Aday',
        cell: (row) => (
          <Link
            to={`/${role}/aday/${encodeURIComponent(row.prospectId)}`}
            className="record-link font-medium text-primary hover:underline"
          >
            {row.name}
          </Link>
        ),
      },
      { key: 'kindLabel', label: 'Tür' },
      { key: 'whenLabel', label: 'Gün' },
      { key: 'timeRange', label: 'Saat' },
      { key: 'branch', label: 'Kampüs' },
      { key: 'place', label: type === 'language_school' ? 'Oda / grup' : 'Oda' },
      {
        key: 'stageLabel',
        label: 'Aşama',
        cell: (row) => <StatusBadge text={row.stageLabel} tone={stageTone(row.stage)} />,
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button variant="secondary" size="sm" asChild>
            <Link
              to={`/${role}/aday/${encodeURIComponent(row.prospectId)}`}
              aria-label={`${row.name} adayını aç`}
            >
              <Icon name="ArrowUpRight" size={15} aria-hidden="true" />
              Aday
            </Link>
          </Button>
        ),
      },
    ],
    [role, type],
  )
  const filters = useMemo(
    () =>
      type === 'language_school' ? [MEETING_KIND_FILTER, MEETING_DAY_FILTER] : [MEETING_DAY_FILTER],
    [type],
  )
  const upcoming = rows.filter((row) => row.upcoming).length

  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      <section
        aria-labelledby="gorusme-tablosu"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading px-6 pt-6 pb-2">
          <h2 id="gorusme-tablosu" className="text-lg font-semibold">
            Planlanan görüşmeler
          </h2>
          <p className="text-sm text-muted-foreground">
            {rows.length} kayıt · {upcoming} yaklaşan
          </p>
        </header>
        {prospects.error ? (
          <div role="alert" className="p-6">
            <QueryError error={prospects.error} onRetry={() => void prospects.refetch()} />
          </div>
        ) : prospects.isPending ? (
          <p role="status" className="p-6 text-sm text-muted-foreground">
            Görüşmeler yükleniyor…
          </p>
        ) : (
          <DataTable
            listKey="gorusmeler"
            rows={rows}
            columns={columns}
            mobileColumns={COLUMNS_MOBILE}
            filters={filters}
            searchKeys={['name', 'branch', 'place']}
            caption="Planlanan görüşmeler"
            empty="Planlanmış görüşme yok. Aday detayından tanışma görüşmesi planlayın."
            emptyFiltered="Bu süzgece uyan görüşme yok."
          />
        )}
      </section>
    </>
  )
}
