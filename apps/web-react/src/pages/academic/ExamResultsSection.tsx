import { useCallback, useId, useMemo } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { isUnreadableCollectionError } from '@kampus/react-shared/collections.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { combineStates, DashboardGrid, ListCard } from '../dashboard/DashboardParts.tsx'
import { TableGate } from '../learning/LearningParts.tsx'
import { TrendChart } from './AnalysisParts.tsx'
import { OpticalAnalysis } from './OpticalAnalysis.tsx'
import { currentEvaluationsOf, examRows, netTrend, type ExamRow } from './exam-analysis-model.ts'

const NONE: readonly never[] = []
const EXAM_PARAM = 'sinav'
const MOBILE_COLUMNS = ['date', 'net', 'analysis']

type TableRow = ExamRow & { counts: string; analysis: string }

/**
 * Deneme sonuçları ve seçili denemenin optik soru analizi. Deneme ve optik modülü kapalıysa
 * (ör. dil okulu) bölüm hiç çizilmez; kapsamı sunucu uygular (öğrenci kendi, veli çocuğunun
 * sonucunu okur). Optik analizi olmayan ya da eskimiş (anahtar değişmiş) denemede soru analizi
 * yerine boş durum gösterilir.
 */
export function ExamResultsSection({ studentId }: { studentId: string }) {
  const headingId = useId()
  const [params, setParams] = useSearchParams()
  const { state: historyState } = useLocation()
  const exams = useCoreAll('mockExams')
  const results = useCoreAll('mockResults', { filters: { studentId } })
  const profiles = useCoreAll('opticalProfiles')
  const evaluations = useCoreAll('opticalEvaluations', { filters: { studentId } })

  // Güncel (anahtarı ve sonucu değişmemiş) analizler; eskiyenler gösterilmez.
  const current = useMemo(
    () =>
      currentEvaluationsOf(
        (evaluations.data ?? NONE).map((row) => row.record),
        (profiles.data ?? NONE).map((row) => row.record),
        (results.data ?? NONE).map((row) => row.record),
      ),
    [evaluations.data, profiles.data, results.data],
  )
  const rows = useMemo<TableRow[] | undefined>(() => {
    if (!exams.data || !results.data) return undefined
    const base = examRows(
      exams.data.map((row) => row.record),
      results.data.map((row) => row.record),
      new Set(current.map((item) => item.id)),
    )
    return base.map((row) => ({
      ...row,
      counts: `${row.correct} / ${row.wrong} / ${row.blank}`,
      analysis: row.analysed > 0 ? 'Var' : 'Yok',
    }))
  }, [exams.data, results.data, current])

  const selectExam = useCallback(
    (examId: string) =>
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous)
          if (examId) next.set(EXAM_PARAM, examId)
          else next.delete(EXAM_PARAM)
          return next
        },
        // `state.from` (geri dönüş adresi) seçimle silinmez.
        { preventScrollReset: true, state: historyState },
      ),
    [setParams, historyState],
  )

  const columns = useMemo<DataColumn<TableRow>[]>(
    () => [
      {
        key: 'title',
        label: 'Deneme',
        cell: (row) => (
          <button
            type="button"
            onClick={() => selectExam(row.id)}
            aria-label={`${row.title} soru analizini aç`}
            className="record-link text-left font-medium text-primary hover:underline"
          >
            {row.title}
          </button>
        ),
      },
      { key: 'date', label: 'Tarih', cell: (row) => dateLabel(row.date, { year: 'numeric' }) },
      { key: 'net', label: 'Net', cell: (row) => <strong>{row.net}</strong> },
      { key: 'counts', label: 'Doğru / yanlış / boş' },
      {
        key: 'analysis',
        label: 'Soru analizi',
        cell: (row) => (
          <StatusBadge
            text={row.analysis === 'Var' ? 'Analiz var' : 'Analiz yok'}
            tone={row.analysis === 'Var' ? 'green' : 'gray'}
          />
        ),
      },
    ],
    [selectExam],
  )

  // Deneme (ya da sonuç) koleksiyonu bu kurumda yok ya da kapalı: bölüm yoktur.
  if ([exams.error, results.error].some((item) => item && isUnreadableCollectionError(item)))
    return null
  // Optik koleksiyonlar okunamıyorsa (modül kapalı) analiz yok sayılır; diğer hatalar gösterilir.
  const opticalError = [profiles.error, evaluations.error].find(
    (item) => item && !isUnreadableCollectionError(item),
  )
  const state = combineStates(exams, results)
  const trend = rows ? netTrend(rows) : []
  const requested = params.get(EXAM_PARAM) ?? ''
  const selected = rows?.find((row) => row.id === requested)

  return (
    <>
      <DashboardGrid>
        <section
          aria-labelledby={headingId}
          className="panel min-w-0 overflow-hidden rounded-card border bg-surface"
        >
          <header className="panel-heading border-b px-5 py-4">
            <h2 id={headingId} className="text-lg font-semibold">
              Deneme sonuçları
            </h2>
            <p className="text-sm text-muted-foreground">
              {rows?.length ?? 0} deneme · net, yanlış cezasıyla hesaplanır
            </p>
          </header>
          <TableGate
            error={state.error ?? opticalError}
            onRetry={() => {
              state.retry()
              for (const query of [profiles, evaluations]) if (query.error) void query.refetch()
            }}
            loading={rows === undefined}
          >
            <DataTable
              listKey="deneme-sonuclari"
              rows={rows ?? NONE}
              columns={columns}
              mobileColumns={MOBILE_COLUMNS}
              caption="Deneme sonuçları"
              searchKeys={['title']}
              empty="Henüz deneme sonucu yok."
              onRowClick={(row) => selectExam(row.id)}
            />
          </TableGate>
        </section>
        <ListCard
          title="Deneme net eğilimi"
          description="Tamamlanan denemelerin toplam neti"
          state={state}
          isEmpty={trend.length === 0}
          emptyText="Eğilim için tamamlanmış deneme yok."
        >
          <TrendChart points={trend} unit="net" />
        </ListCard>
      </DashboardGrid>
      {selected ? (
        <OpticalAnalysis
          examId={selected.id}
          examTitle={selected.title}
          evaluations={current.filter((item) => item.examId === selected.id)}
          onClose={() => selectExam('')}
        />
      ) : null}
    </>
  )
}
