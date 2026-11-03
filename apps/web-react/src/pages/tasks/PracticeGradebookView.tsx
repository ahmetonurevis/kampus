import { useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router'
import { usePracticeGradebook } from '@kampus/react-shared/use-practice-gradebook.ts'
import { DataTable, type DataColumn, type DataTableHandle } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { LineTabs, type LineTabOption } from '@/components/LineTabs.tsx'
import { Button } from '@/components/ui/button'
import { exportCsv } from '@/lib/download.ts'
import { TableGate } from '../learning/LearningParts.tsx'
import {
  GRADEBOOK_COLUMNS,
  GRADEBOOK_VIEW_LABELS,
  GRADEBOOK_VIEWS,
  gradebookRows,
  gradebookSummary,
  isGradebookView,
  type GradebookRow,
  type GradebookView,
} from './practice-gradebook-model.ts'

const VIEW_PARAM = 'kirilim'
const VIEW_OPTIONS: readonly LineTabOption<GradebookView>[] = GRADEBOOK_VIEWS.map((value) => ({
  value,
  label: GRADEBOOK_VIEW_LABELS[value],
}))
const MOBILE_COLUMNS = ['learner', 'group', 'percent']
const NONE: readonly GradebookRow[] = []

/**
 * Alıştırma not defteri (OG-085; IST-056, DOM-BEC-048): alıştırma sonuçlarının ünite, beceri ve
 * kazanım kırılımı, değerlendirme notlarından ayrı. Kursiyer başına son tamamlanan deneme sayılır;
 * hücre madde puanlarının toplamıdır. Kapsam sunucudadır (öğretmen gördüğü atamalar). Kırılım
 * `?kirilim=` ile adreste tutulur; tablo arama, sıralama ve sayfayı korur, CSV filtrelenmiş ve
 * sıralanmış bütün sonucu indirir.
 */
export function PracticeGradebookView() {
  const [params, setParams] = useSearchParams()
  const requested = params.get(VIEW_PARAM)
  const view: GradebookView = isGradebookView(requested) ? requested : 'genel'
  const book = usePracticeGradebook()
  const table = useRef<DataTableHandle<GradebookRow>>(null)
  const rows = useMemo(
    () => (book.data ? gradebookRows(book.data, view) : undefined),
    [book.data, view],
  )
  const summary = book.data ? gradebookSummary(book.data, view) : []

  const columns = useMemo<DataColumn<GradebookRow>[]>(
    () => [
      { key: 'learner', label: 'Öğrenci' },
      { key: 'group', label: GRADEBOOK_VIEW_LABELS[view] },
      { key: 'sets', label: 'Alıştırma', cell: (row) => (row.sets === null ? '—' : row.sets) },
      { key: 'score', label: 'Puan' },
      { key: 'percent', label: 'Yüzde', cell: (row) => row.percentText },
    ],
    [view],
  )

  function selectView(next: GradebookView) {
    setParams(
      (current) => {
        const out = new URLSearchParams(current)
        if (next === 'genel') out.delete(VIEW_PARAM)
        else out.set(VIEW_PARAM, next)
        return out
      },
      { preventScrollReset: true },
    )
  }

  function download() {
    const all = table.current?.filteredRows() ?? rows ?? NONE
    exportCsv(
      `Alıştırma not defteri - ${GRADEBOOK_VIEW_LABELS[view]}`,
      GRADEBOOK_COLUMNS.map((column) =>
        column.key === 'group' ? { ...column, label: GRADEBOOK_VIEW_LABELS[view] } : column,
      ),
      all,
    )
  }

  return (
    <section
      aria-labelledby="alistirma-not-defteri"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="min-w-0">
          <h2 id="alistirma-not-defteri" className="text-lg font-semibold">
            Alıştırma not defteri
          </h2>
          <p className="text-sm text-muted-foreground">
            Alıştırmalarda son tamamlanan deneme · Değerlendirme notlarından ayrıdır, nota ve beceri
            panosuna girmez.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={download} disabled={rows === undefined}>
          <Icon name="Download" size={15} aria-hidden="true" />
          CSV indir
        </Button>
      </header>
      <div className="px-6 pb-2">
        <LineTabs
          label="Not defteri kırılımı"
          value={view}
          options={VIEW_OPTIONS}
          onChange={selectView}
        />
        {summary.length > 0 ? (
          <dl aria-label="Sınıf geneli" className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {summary.map((item) => (
              <div key={item.key} className="flex gap-1.5">
                <dt className="text-muted-foreground">{item.group}:</dt>
                <dd className="font-medium">{item.text}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {book.data?.truncated ? (
          <p role="note" className="mt-2 text-xs text-muted-foreground">
            Yalnız en yeni 100 alıştırma ataması gösteriliyor.
          </p>
        ) : null}
      </div>
      <TableGate error={book.error} onRetry={() => void book.refetch()} loading={book.isPending}>
        <DataTable
          ref={table}
          listKey="alistirma-not-defteri"
          urlPrefix="and-"
          filterKey={view}
          rows={rows ?? NONE}
          columns={columns}
          mobileColumns={MOBILE_COLUMNS}
          caption="Alıştırma not defteri"
          searchKeys={['learner', 'group']}
          empty="Henüz tamamlanmış alıştırma yok."
          emptyFiltered="Bu aramaya uyan sonuç yok."
        />
      </TableGate>
    </section>
  )
}
