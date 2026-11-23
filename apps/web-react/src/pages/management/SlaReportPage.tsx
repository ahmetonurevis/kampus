import { useMemo, useRef } from 'react'
import { DataTable, type DataColumn, type DataTableHandle } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { useMinuteClock } from '@/hooks/use-minute-clock.ts'
import { exportCsv } from '@/lib/download.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { StatGrid } from '../academic/AcademicParts.tsx'
import { responseText, SLA_HOURS, slaRows, slaSummary, type SlaRow } from './sla-rows.ts'
import { useManagementLookups } from './use-management-lookups.ts'

const NONE: readonly never[] = []
const MOBILE_COLUMNS = ['response', 'pending', 'breaches']

const COLUMNS: DataColumn<SlaRow>[] = [
  { key: 'name', label: 'Öğretmen' },
  { key: 'classes', label: 'Sınıflar' },
  { key: 'total', label: 'Soru' },
  { key: 'response', label: 'Ort. yanıt süresi', cell: (row) => responseText(row.response) },
  { key: 'pending', label: 'Bekleyen' },
  {
    key: 'breaches',
    label: 'İhlal',
    cell: (row) =>
      row.breaches > 0 ? <StatusBadge text={`${row.breaches} ihlal`} tone="red" /> : '0',
  },
  { key: 'slaRate', label: 'SLA uyumu (%)', cell: (row) => `%${row.slaRate}` },
]
const CSV_COLUMNS = [
  { key: 'name', label: 'Öğretmen' },
  { key: 'classes', label: 'Sınıflar' },
  { key: 'total', label: 'Soru' },
  { key: 'responseText', label: 'Ort. yanıt süresi' },
  { key: 'pending', label: 'Bekleyen' },
  { key: 'breaches', label: 'İhlal' },
  { key: 'slaRate', label: 'SLA uyumu (%)' },
] as const

/**
 * SLA Raporu (yönetici, Vue `Management.vue` `sla-raporu`): öğretmen başına soru kuyruğu yanıt
 * süresi. Hedef, sorunun oluştuğu andan 24 saattir; ortalama yanıt süresi, bekleyen soru, ihlal
 * ve uyum yüzdesi kapsamlı soru kayıtlarından hesaplanır, saklanmaz. Yalnız okuma.
 * TODO(api-sla-aggregate): soru kayıtları `useCoreAll` ile bütünüyle çekilir (5000 kayıt sınırı);
 * öğretmen başına yanıt süresi ortalaması sunucu sayımında olmadığından istemcide hesaplanır.
 */
export function SlaReportPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const data = useManagementLookups()
  const questions = useCoreAll('questions')
  const clock = useMinuteClock()
  const table = useRef<DataTableHandle<SlaRow>>(null)

  const error = data.error ?? questions.error ?? null
  const pending = data.pending || questions.isPending
  const retry = () => {
    data.retry()
    if (questions.error) void questions.refetch()
  }

  const rows = useMemo(
    () =>
      pending || error
        ? undefined
        : slaRows(data.sources.teachers, questions.data ?? NONE, data.lookups, Date.parse(clock)),
    [pending, error, data.sources.teachers, questions.data, data.lookups, clock],
  )
  const summary = slaSummary(rows ?? NONE)

  // CSV filtrelenmiş ve sıralanmış bütün sonucu içerir; süre ekrandaki gibi yazılır.
  function download() {
    const all = table.current?.filteredRows() ?? rows ?? NONE
    exportCsv(
      page.title,
      CSV_COLUMNS,
      all.map((row) => ({ ...row, responseText: responseText(row.response) })),
    )
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
      <StatGrid
        label="SLA özeti"
        items={[
          {
            label: 'Toplam soru',
            value: rows ? summary.questions : '—',
            note: `${rows ? summary.teachers : '—'} aktif öğretmen`,
          },
          {
            label: 'Yanıt bekleyen',
            value: rows ? summary.pending : '—',
            note: 'Henüz yanıtlanmamış sorular',
          },
          {
            label: 'Süre aşımı',
            value: rows ? summary.breaches : '—',
            note: `Hedef: ${SLA_HOURS} saat içinde yanıt`,
          },
          {
            label: 'SLA uyumu',
            value: rows ? (summary.slaRate === null ? '—' : `%${summary.slaRate}`) : '—',
            note:
              summary.slaRate === null && rows ? 'Henüz soru yok' : 'Hedefe uyan soruların oranı',
          },
        ]}
      />
      <section
        aria-labelledby="sla-ogretmenler"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading px-6 pt-6 pb-2">
          <h2 id="sla-ogretmenler" className="text-lg font-semibold">
            Öğretmen yanıt süreleri
          </h2>
          <p className="text-sm text-muted-foreground">
            Hedef yanıt süresi {SLA_HOURS} saat · {rows?.length ?? 0} sonuç
          </p>
        </header>
        {error ? (
          <div role="alert" className="p-[45px] text-center">
            <QueryError error={error} onRetry={retry} />
          </div>
        ) : rows === undefined ? (
          <p role="status" className="p-[45px] text-center text-base text-muted-foreground">
            Kayıtlar yükleniyor…
          </p>
        ) : (
          <DataTable
            ref={table}
            listKey="sla-raporu"
            rows={rows}
            columns={COLUMNS}
            mobileColumns={MOBILE_COLUMNS}
            caption="Öğretmen SLA raporu"
            searchKeys={['name', 'classes']}
            empty="Aktif öğretmen yok."
          />
        )}
      </section>
    </>
  )
}
