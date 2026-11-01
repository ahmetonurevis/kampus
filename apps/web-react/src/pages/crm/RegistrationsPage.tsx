import { useMemo } from 'react'
import { Link } from 'react-router'
import { useAuth } from '@/auth/use-auth.ts'
import { Avatar } from '@/components/Avatar.tsx'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { OPEN_PROSPECT_STAGES } from '@kampus/school-core/lib/prospects.ts'
import { EnrollPanel, ENROLL_MODULES_CLOSED_MESSAGE } from './EnrollPanel.tsx'
import { prospectRow, stageFilter, stageTone, type ProspectRow } from './prospect-rows.ts'

const MOBILE_COLUMNS = ['interest', 'stageLabel', 'branch']

/**
 * Kayıt İşlemleri (ön büro, Vue `Crm.vue` `kayit-islemleri`): kesin kayda hazır, yani açık
 * aşamadaki adaylar. Aday sayısı huniyle sınırlıdır; açık adaylar bir kez çekilir, arama, süzgeç ve
 * sıralama tarayıcıdadır. Satırdaki "Kesin kayıt" sağ panelde formu açar (`?kayit=<adayId>`);
 * aynı form aday detayından da açılır. `finance` ya da `crm` kapalıysa işlem devre dışıdır ve
 * nedeni yazılır; kesin kayıt `If-Match` ile aday sürümünü taşır (DOM-KAY-001, DOM-KAY-035).
 */
export function RegistrationsPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const { session } = useAuth()
  const role = session?.role ?? 'onburo'
  const type = session?.institution.type ?? 'school'
  const modulesOpen = session?.modules.crm === true && session.modules.finance === true
  const prospects = useCoreAll('prospects', {
    filters: { stage: [...OPEN_PROSPECT_STAGES] },
    sort: ['-createdAt'],
  })
  const branches = useCoreAll('branches')
  const panel = useDetailPanel('kayit')
  const openPanel = panel.open

  const rows = useMemo(() => {
    const names = new Map((branches.data ?? []).map((item) => [item.record.id, item.record.name]))
    return (prospects.data ?? []).map((item) => prospectRow(item, type, { branches: names }))
  }, [prospects.data, branches.data, type])
  const filters = useMemo(() => {
    const stage = stageFilter(type)
    return [
      {
        ...stage,
        options: stage.options?.filter((option) =>
          (OPEN_PROSPECT_STAGES as readonly (string | number)[]).includes(option.value),
        ),
      },
    ]
  }, [type])

  const columns = useMemo<DataColumn<ProspectRow>[]>(
    () => [
      {
        key: 'name',
        label: 'Aday öğrenci',
        cell: (row) => (
          <span className="person-cell flex items-center gap-2.5">
            <Avatar name={row.name} size="small" />
            <span className="grid">
              <Link
                to={`/${role}/aday/${encodeURIComponent(row.id)}`}
                className="record-link font-medium text-primary hover:underline"
              >
                {row.name}
              </Link>
              <small className="text-xs text-muted-foreground">{row.phone}</small>
            </span>
          </span>
        ),
      },
      {
        key: 'interest',
        label: type === 'language_school' ? 'Hedef seviye' : 'İlgilendiği program',
      },
      { key: 'branch', label: 'Kampüs' },
      {
        key: 'stageLabel',
        label: 'Aşama',
        cell: (row) => <StatusBadge text={row.stageLabel} tone={stageTone(row.stage)} />,
      },
      { key: 'createdLabel', label: 'Kayıt tarihi' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            size="sm"
            onClick={() => openPanel(row.id)}
            disabled={!modulesOpen}
            aria-label={`${row.name} için kesin kayıt`}
          >
            <Icon name="UserRoundPlus" size={15} aria-hidden="true" />
            Kesin kayıt
          </Button>
        ),
      },
    ],
    [role, type, openPanel, modulesOpen],
  )

  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      {!modulesOpen ? (
        <p role="alert" className="rounded-card border bg-warning-soft p-4 text-sm font-medium">
          {ENROLL_MODULES_CLOSED_MESSAGE}
        </p>
      ) : null}
      <section
        aria-labelledby="kayit-tablosu"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading px-6 pt-6 pb-2">
          <h2 id="kayit-tablosu" className="text-lg font-semibold">
            Kesin kayda hazır adaylar
          </h2>
          <p className="text-sm text-muted-foreground">
            {prospects.data ? `${prospects.data.length} açık aday` : 'Adaylar yükleniyor…'} · kayıt
            yalnız açık aşamadaki adaya yapılır
          </p>
        </header>
        {prospects.error ? (
          <div role="alert" className="p-6">
            <QueryError error={prospects.error} onRetry={() => void prospects.refetch()} />
          </div>
        ) : prospects.isPending ? (
          <p role="status" className="p-6 text-sm text-muted-foreground">
            Adaylar yükleniyor…
          </p>
        ) : (
          <DataTable
            listKey="kayit-islemleri"
            rows={rows}
            columns={columns}
            mobileColumns={MOBILE_COLUMNS}
            filters={filters}
            searchKeys={['name', 'phone', 'interest', 'branch']}
            searchInUrl={false}
            caption="Kesin kayda hazır adaylar"
            empty="Kesin kayda hazır aday yok. Önce Aday Öğrenciler sayfasından aday ekleyin."
            emptyFiltered="Bu süzgece uyan aday yok."
          />
        )}
      </section>
      <EnrollPanel prospectId={panel.selectedId} onClose={panel.close} />
    </>
  )
}
