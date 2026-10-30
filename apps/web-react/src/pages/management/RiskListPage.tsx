import { useMemo, useRef } from 'react'
import { Avatar } from '@/components/Avatar.tsx'
import { DataTable, type DataColumn, type DataTableHandle } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { useCoreAll, useCoreCounts } from '@/hooks/use-core-collection.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { exportCsv } from '@/lib/download.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { scoreText, scoreTone } from '../academic/academic-rows.ts'
import { StatGrid } from '../academic/AcademicParts.tsx'
import { RiskStudentPanel } from './RiskStudentPanel.tsx'
import {
  HIGH_ABSENCE,
  HIGH_SCORE,
  RISK_ABSENCE,
  RISK_SCORE,
  riskRows,
  riskSummary,
  type RiskRow,
} from './risk-rows.ts'
import { useManagementLookups } from './use-management-lookups.ts'

const NONE: readonly never[] = []
const MOBILE_COLUMNS = ['class', 'absent', 'risk']
const ABSENT_FILTER = { status: 'absent' } as const
const CSV_COLUMNS = [
  { key: 'name', label: 'Öğrenci' },
  { key: 'number', label: 'Okul numarası' },
  { key: 'class', label: 'Sınıf' },
  { key: 'branch', label: 'Şube' },
  { key: 'scoreText', label: 'Ortalama' },
  { key: 'absent', label: 'Devamsızlık' },
  { key: 'risk', label: 'Risk durumu' },
] as const

/**
 * Risk Altındaki Öğrenciler (yönetici, Vue `Management.vue` `risk-listesi`): devamsızlığı 6 ve
 * üzeri ya da not ortalaması 65 altı olan aktif öğrenciler. Öğrenci başına not toplamı ve
 * devamsızlık sayısı sunucu sayımlarından gelir (notlar tek tek çekilmez); risk durumu
 * kayıtlardan türetilir, saklanmaz. Rehberlik dosyası ve iç notu bu ekranın hiçbir yerinde
 * okunmaz (DOM-YTK-020, DOM-ILT-041). Yalnız okuma.
 * TODO(api-risk-listesi): öğrenci listesi `useCoreAll` ile bütünüyle çekilir (5000 kayıt sınırı);
 * çok büyük kurumlar için sunucu tarafı risk ucu gerekir.
 */
export function RiskListPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const data = useManagementLookups()
  const students = useCoreAll('students')
  const grades = useCoreCounts('grades', { groupBy: 'studentId', sum: 'score' })
  const absences = useCoreCounts('attendance', {
    groupBy: 'studentId',
    filters: ABSENT_FILTER,
  })
  const panel = useDetailPanel('ogrenci')
  const openStudent = panel.open
  const table = useRef<DataTableHandle<RiskRow>>(null)

  const queries = [students, grades, absences]
  const error = data.error ?? queries.find((query) => query.error)?.error ?? null
  const pending = data.pending || queries.some((query) => query.isPending)
  const retry = () => {
    data.retry()
    for (const query of queries) if (query.error) void query.refetch()
  }

  const rows = useMemo(
    () =>
      pending || error
        ? undefined
        : riskRows(students.data ?? NONE, data.lookups, grades.data, absences.data),
    [pending, error, students.data, data.lookups, grades.data, absences.data],
  )
  const summary = riskSummary(rows ?? NONE)

  const columns = useMemo<DataColumn<RiskRow>[]>(
    () => [
      {
        key: 'name',
        label: 'Öğrenci',
        cell: (row) => (
          <span className="person-cell flex items-center gap-2.5">
            <Avatar name={row.name} size="small" />
            <span className="grid">
              <button
                type="button"
                onClick={() => openStudent(row.id)}
                aria-label={`${row.name} özetini aç`}
                className="record-link text-left font-medium text-primary hover:underline"
              >
                <strong className="font-medium">{row.name}</strong>
              </button>
              <small className="text-xs text-muted-foreground">
                {row.class} · No: {row.number || '—'}
              </small>
            </span>
          </span>
        ),
      },
      { key: 'class', label: 'Sınıf' },
      { key: 'branch', label: 'Şube' },
      {
        key: 'score',
        label: 'Ortalama',
        cell: (row) =>
          row.score === null ? (
            '—'
          ) : (
            <StatusBadge text={scoreText(row.score)} tone={scoreTone(row.score)} />
          ),
      },
      { key: 'absent', label: 'Devamsızlık', cell: (row) => `${row.absent} ders` },
      { key: 'risk', label: 'Risk durumu', cell: (row) => <StatusBadge text={row.risk} /> },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            variant="secondary"
            size="sm"
            aria-label={`${row.name} özeti`}
            onClick={() => openStudent(row.id)}
          >
            <Icon name="Eye" size={15} aria-hidden="true" />
            Özet
          </Button>
        ),
      },
    ],
    [openStudent],
  )

  // CSV filtrelenmiş ve sıralanmış bütün sonucu içerir; ortalama ekrandaki gibi "72/100" yazılır.
  function download() {
    const all = table.current?.filteredRows() ?? rows ?? NONE
    exportCsv(
      page.title,
      CSV_COLUMNS,
      all.map((row) => ({
        ...row,
        scoreText: row.score === null ? '' : scoreText(row.score),
      })),
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
        label="Risk özeti"
        items={[
          {
            label: 'Takip edilen öğrenci',
            value: rows ? summary.tracked : '—',
            note: 'Eşiği aşan aktif öğrenciler',
          },
          {
            label: 'Yüksek riskli',
            value: rows ? summary.high : '—',
            note: 'Öncelik verilmesi önerilir',
          },
          {
            label: 'Risk eşiği',
            value: `${RISK_ABSENCE} ders / ${RISK_SCORE} puan`,
            note: `Yüksek risk: ${HIGH_ABSENCE} ders ya da ${HIGH_SCORE} puan altı`,
          },
        ]}
      />
      <section
        aria-labelledby="risk-listesi"
        className="panel overflow-hidden rounded-card border bg-surface"
      >
        <header className="panel-heading px-6 pt-6 pb-2">
          <h2 id="risk-listesi" className="text-lg font-semibold">
            Erken uyarı listesi
          </h2>
          <p className="text-sm text-muted-foreground">
            Devam ve başarı birlikte değerlendirilir · {rows?.length ?? 0} sonuç
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
            listKey="risk-listesi"
            rows={rows}
            columns={columns}
            mobileColumns={MOBILE_COLUMNS}
            caption="Risk altındaki öğrenciler"
            searchKeys={['name', 'number', 'class']}
            empty="Risk eşiğini aşan öğrenci yok."
            onRowClick={(row) => openStudent(row.id)}
          />
        )}
      </section>
      <RiskStudentPanel
        studentId={panel.selectedId}
        lookups={{
          classes: data.lookups.classes,
          branches: data.lookups.branches,
          subjects: data.lookups.subjects,
        }}
        onClose={panel.close}
      />
    </>
  )
}
