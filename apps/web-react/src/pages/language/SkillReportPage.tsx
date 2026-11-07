import { useMemo, useRef } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useSkillReport, type SkillReport } from '@kampus/react-shared/use-skill-report.ts'
import { number } from '@kampus/school-core/lib/format.ts'
import { DataTable, type DataColumn, type DataTableHandle } from '@/components/DataTable.tsx'
import { EmptyState } from '@/components/EmptyState.tsx'
import { Icon } from '@/components/Icon.tsx'
import { LineTabs, type LineTabOption } from '@/components/LineTabs.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/auth/use-auth.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import { exportCsv } from '@/lib/download.ts'
import { pageHref, type NavPage } from '@/lib/navigation.ts'
import {
  averageText,
  barPercent,
  computedAtText,
  evidenceText,
  groupLink,
  GROUPING_LABELS,
  GROUPINGS,
  levelShares,
  NO_EVIDENCE_LABEL,
  REPORT_CSV_COLUMNS,
  REPORT_SKILL_KEYS,
  resolveGrouping,
  skillAriaLabel,
  skillReportRows,
  type ReportSkillKey,
  type SkillReportRow,
} from './skill-report-model.ts'

const GROUPING_PARAM = 'kirilim'
const GROUPING_OPTIONS: readonly LineTabOption<(typeof GROUPINGS)[number]>[] = GROUPINGS.map(
  (value) => ({ value, label: GROUPING_LABELS[value] }),
)
const SKILL_LABELS: Readonly<Record<ReportSkillKey, string>> = {
  reading: 'Okuma',
  listening: 'Dinleme',
  writing: 'Yazma',
  speaking: 'Konuşma',
}
const NONE: readonly SkillReportRow[] = []

/** Oran çubuğu; yalnız süstür (değer metinle yanında verilir), kanıtsız beceride çizilmez. */
function Bar({ percent }: { percent: number | null }) {
  if (percent === null) return null
  return (
    <span aria-hidden="true" className="block h-1.5 w-full rounded-full bg-muted">
      <span className="block h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
    </span>
  )
}

/** Beceri hücresi: ortalama, çubuk ve kanıt sayısı; kanıtsız beceri "—" ve "kanıt yok". */
function SkillCell({ skill }: { skill: SkillReport['totals']['skills'][number] | undefined }) {
  const average = skill?.average ?? null
  return (
    <span className="grid min-w-24 gap-1">
      <span className={average === null ? 'text-muted-foreground' : 'font-medium tabular-nums'}>
        {averageText(average)}
      </span>
      <Bar percent={barPercent(average)} />
      <span className="text-xs text-muted-foreground">
        {skill ? evidenceText(skill) : NO_EVIDENCE_LABEL}
      </span>
    </span>
  )
}

function TotalsPanel({ report }: { report: SkillReport }) {
  const { totals } = report
  const shares = levelShares(totals)
  return (
    <section
      aria-labelledby="beceri-raporu-toplam"
      className="panel mb-5 grid gap-4 rounded-card border bg-surface p-6"
    >
      <header>
        <h2 id="beceri-raporu-toplam" className="text-lg font-semibold">
          Tüm kursiyerler
        </h2>
        <p className="text-sm text-muted-foreground">
          {number(totals.studentCount)} etkin kursiyer · her kursiyer bir kez sayılır · Hesaplanma{' '}
          {computedAtText(report.computedAt)}
        </p>
      </header>
      <ul aria-label="Beceri ortalamaları" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {totals.skills.map((skill) => (
          <li
            key={skill.skill}
            aria-label={skillAriaLabel(skill)}
            className="grid gap-1 rounded-card border bg-surface-soft px-3 py-2"
          >
            <span className="text-xs text-muted-foreground">{skill.label}</span>
            <SkillCell skill={skill} />
          </li>
        ))}
      </ul>
      <div>
        <h3 className="mb-2 text-sm font-semibold">Güncel seviye dağılımı</h3>
        {shares.length === 0 ? (
          <p className="text-sm text-muted-foreground">Henüz kursiyer yok.</p>
        ) : (
          <ul aria-label="Güncel seviye dağılımı" className="grid gap-1.5">
            {shares.map((share) => (
              <li
                key={share.key}
                className="grid grid-cols-[8rem_1fr_6rem] items-center gap-3 text-sm"
              >
                <span>{share.label}</span>
                <Bar percent={share.percent} />
                <span className="text-right tabular-nums text-muted-foreground">
                  {number(share.count)} · %{share.percent}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

/**
 * Beceri ve CEFR raporu (dil okulu; OG-100, IST-118; DOM-BEC-037): dil grubu ya da kur seviyesi
 * (`?kirilim=`) başına kursiyer sayısı, dört beceri için ortalama ve kanıt sayısı ile güncel seviye
 * dağılımı. Rapor sunucuda her okumada hesaplanır; kişi adı ya da puanı taşımaz. Kanıtsız beceri
 * "—" ve "kanıt yok" olarak görünür, sıfır gösterilmez. Yönetici kurum geneli, öğretmen okuyabildiği
 * grupları görür (kapsam sunucudadır). Grup satırı grup listesinin ilgili grubuna, oradan kursiyerin
 * seviye profiline götürür. Satırlar tek yanıtta gelir; arama, süzgeç, sıralama ve sayfa istemcidedir.
 */
// TODO(rapor-ogretmen): öğretmen bazında kırılım (OG-147).
// TODO(rapor-donem): seçilebilir dönem ve karşılaştırma (OG-147); kanıt penceresi sabittir.
export function SkillReportPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const [params, setParams] = useSearchParams()
  const { session } = useAuth()
  const grouping = resolveGrouping(params.get(GROUPING_PARAM))
  const report = useSkillReport(grouping)
  const table = useRef<DataTableHandle<SkillReportRow>>(null)
  const data = report.data?.data
  const rows = useMemo(() => (data ? skillReportRows(data) : NONE), [data])
  const role = session?.role

  const columns = useMemo<DataColumn<SkillReportRow>[]>(
    () => [
      {
        key: 'name',
        label: grouping === 'class' ? 'Grup' : 'Kur seviyesi',
        cell: (row) => {
          const link = role ? groupLink(grouping, row) : null
          return link && role ? (
            <Link
              className="record-link font-medium text-primary hover:underline"
              to={{ pathname: pageHref(role, link), search: link.search }}
              aria-label={`${row.name} grubunu ve kursiyerlerini aç`}
            >
              {row.name}
            </Link>
          ) : (
            <span className="font-medium">{row.name}</span>
          )
        },
      },
      ...(grouping === 'class' ? [{ key: 'level', label: 'Seviye' }] : []),
      { key: 'students', label: 'Kursiyer' },
      ...REPORT_SKILL_KEYS.map((key) => ({
        key,
        label: SKILL_LABELS[key],
        cell: (row: SkillReportRow) => <SkillCell skill={row.skills[key]} />,
      })),
      { key: 'levelsText', label: 'Seviye dağılımı' },
    ],
    [grouping, role],
  )

  function selectGrouping(next: (typeof GROUPINGS)[number]) {
    setParams(
      (current) => {
        const out = new URLSearchParams(current)
        if (next === 'class') out.delete(GROUPING_PARAM)
        else out.set(GROUPING_PARAM, next)
        return out
      },
      { preventScrollReset: true },
    )
  }

  function download() {
    const all = table.current?.filteredRows() ?? rows
    exportCsv(`Beceri raporu - ${GROUPING_LABELS[grouping]}`, REPORT_CSV_COLUMNS, all)
  }

  return (
    <>
      <PageHeading
        title={page.title}
        description={page.description}
        actions={
          <Button variant="secondary" onClick={download} disabled={data === undefined}>
            <Icon name="Download" size={16} aria-hidden="true" />
            CSV indir
          </Button>
        }
      />
      <div className="mb-4">
        <LineTabs
          label="Rapor kırılımı"
          value={grouping}
          options={GROUPING_OPTIONS}
          onChange={selectGrouping}
        />
      </div>
      {report.error ? (
        <div role="alert" className="panel rounded-card border bg-surface p-[45px] text-center">
          <QueryError error={report.error} onRetry={() => void report.refetch()} />
        </div>
      ) : report.isPending ? (
        <p role="status" className="p-[45px] text-center text-base text-muted-foreground">
          Rapor hazırlanıyor…
        </p>
      ) : data ? (
        <>
          <TotalsPanel report={data} />
          {rows.length === 0 ? (
            <EmptyState
              icon="ChartNoAxesCombined"
              title={grouping === 'class' ? 'Raporlanacak grup yok' : 'Raporlanacak kur yok'}
              description="Etkin (planlı, açık ya da süren) grupta kursiyer bulunduğunda rapor burada görünür."
            />
          ) : (
            <section
              aria-labelledby="beceri-raporu-tablo"
              className="panel overflow-hidden rounded-card border bg-surface"
            >
              <header className="panel-heading px-6 pt-6 pb-2">
                <h2 id="beceri-raporu-tablo" className="text-lg font-semibold">
                  {GROUPING_LABELS[grouping]} · beceri ortalamaları
                </h2>
                <p className="text-sm text-muted-foreground">
                  Ortalama 0–100 arasıdır; kursiyerler eşit ağırlıklıdır. Kanıtı olmayan beceri "—"
                  ile gösterilir.
                </p>
              </header>
              <DataTable
                ref={table}
                listKey="beceri-raporu"
                urlPrefix="br-"
                filterKey={grouping}
                rows={rows}
                columns={columns}
                mobileColumns={['name', 'students', 'reading']}
                caption="Beceri ve CEFR raporu"
                searchKeys={['name', 'level', 'levelsText']}
                empty="Henüz raporlanacak satır yok."
                emptyFiltered="Bu aramaya uyan satır yok."
              />
            </section>
          )}
        </>
      ) : null}
    </>
  )
}
