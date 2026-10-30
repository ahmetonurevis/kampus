import { useMemo, useRef } from 'react'
import { PageHeading } from '@/components/PageHeading.tsx'
import { DataTable, type DataColumn, type DataTableHandle } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useCoreAll, useCoreCounts } from '@/hooks/use-core-collection.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { exportCsv } from '@/lib/download.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { combineStates, ListCard, ShareBar } from '../dashboard/DashboardParts.tsx'
import {
  ENROLLED_STAGE,
  funnelSteps,
  sourceRows,
  type SourceRow,
} from './enrollment-report-rows.ts'

const NONE: readonly never[] = []
const MOBILE_COLUMNS = ['count', 'enrolled', 'ratio']

const COLUMNS: DataColumn<SourceRow>[] = [
  { key: 'source', label: 'Kanal' },
  { key: 'count', label: 'Aday sayısı' },
  { key: 'enrolled', label: 'Kesin kayıt' },
  { key: 'ratio', label: 'Dönüşüm oranı', cell: (row) => `%${row.ratio}` },
]
const CSV_COLUMNS = COLUMNS.map(({ key, label }) => ({ key, label }))

/**
 * Kayıt Raporları (yönetici, Vue `Management.vue` `kayit-raporlari`): adaydan öğrenciye huni ve
 * kanal bazlı dönüşüm. Aşama sayıları sunucu sayımından, kanal tablosu kapsamlı aday
 * kayıtlarından hesaplanır; oranlar saklanmaz. Yalnız okuma.
 * TODO(api-prospect-source-group): `source` alanı sayımda gruplanamadığından aday listesi
 * bütünüyle çekilir (5000 kayıt sınırı); alan gruplanabilir olunca kanal sayımı sunucuya iner.
 */
export function EnrollmentReportsPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const stages = useCoreCounts('prospects', { groupBy: 'stage' })
  const prospects = useCoreAll('prospects')
  const table = useRef<DataTableHandle<SourceRow>>(null)

  const steps = useMemo(() => funnelSteps(stages.data), [stages.data])
  const rows = useMemo(
    () => (prospects.data ? sourceRows(prospects.data) : undefined),
    [prospects.data],
  )
  const total = stages.data?.total ?? 0
  const enrolled = steps.find((step) => step.stage === ENROLLED_STAGE)?.count ?? 0

  function download() {
    exportCsv(page.title, CSV_COLUMNS, table.current?.filteredRows() ?? rows ?? NONE)
  }

  return (
    <>
      <PageHeading
        title={page.title}
        description={page.description}
        actions={
          <Button variant="secondary" onClick={download} disabled={rows === undefined}>
            <Icon name="Download" size={17} aria-hidden="true" />
            Raporu indir
          </Button>
        }
      />
      <ListCard
        className="mb-6"
        title="Adaydan öğrenciye"
        description="CRM kayıtlarının güncel aşama dağılımı"
        state={combineStates(stages)}
        isEmpty={total === 0}
        emptyText="Henüz aday kaydı yok."
      >
        <p className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <StatusBadge text={`${total} aday`} />
          <span>{enrolled} kesin kayıt</span>
        </p>
        <ol aria-label="Aday aşamaları" className="funnel grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.stage} className="grid gap-1.5 rounded-card border bg-surface-soft p-4">
              <span className="funnel-step text-xs text-muted-foreground">
                {String(index + 1).padStart(2, '0')}
              </span>
              <strong className="text-stat font-semibold tabular-nums">{step.count}</strong>
              <span className="text-sm">{step.stage}</span>
              <ShareBar
                value={step.share}
                tone={step.stage === ENROLLED_STAGE ? 'success' : 'primary'}
              />
              <span className="text-xs text-muted-foreground">Adayların %{step.share}</span>
            </li>
          ))}
        </ol>
      </ListCard>
      <section
        aria-labelledby="kanal-donusumu"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading px-6 pt-6 pb-2">
          <h2 id="kanal-donusumu" className="text-lg font-semibold">
            Kanal bazlı dönüşüm
          </h2>
          <p className="text-sm text-muted-foreground">
            Güncel kayıtlar · {rows?.length ?? 0} sonuç
          </p>
        </header>
        {prospects.error ? (
          <div role="alert" className="p-[45px] text-center">
            <QueryError error={prospects.error} onRetry={() => void prospects.refetch()} />
          </div>
        ) : rows === undefined ? (
          <p role="status" className="p-[45px] text-center text-base text-muted-foreground">
            Kayıtlar yükleniyor…
          </p>
        ) : (
          <DataTable
            ref={table}
            listKey="kayit-raporlari"
            rows={rows}
            columns={COLUMNS}
            mobileColumns={MOBILE_COLUMNS}
            caption="Kanal bazlı dönüşüm"
            searchKeys={['source']}
            empty="Henüz aday kaydı yok."
          />
        )}
      </section>
    </>
  )
}
