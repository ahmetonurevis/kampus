import { useMemo } from 'react'
import { useContentAssignmentResults } from '@kampus/react-shared/use-content-assignments.ts'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { useTaskLookups } from '../tasks/use-task-lookups.ts'
import {
  RESULT_LIST_PREFIX,
  resultRows,
  resultTotalsLabel,
  type ResultRow,
} from './content-assign-model.ts'

const COLUMNS: readonly DataColumn<ResultRow>[] = [
  { key: 'target', label: 'Hedef' },
  { key: 'dueAt', label: 'Son teslim' },
  { key: 'completed', label: 'Tamamlayan' },
  { key: 'average', label: 'Ortalama' },
  { key: 'title', label: 'Atanan sürüm' },
  { key: 'kind', label: 'Amaç' },
]
const MOBILE_COLUMNS = ['target', 'dueAt', 'completed']
const NO_ROWS: readonly ResultRow[] = []

/**
 * İçeriğe bağlı sonuç özeti (OG-089; IST-034, DOM-BEC-036): içerik ayrıntısında atama ve hedef
 * başına kursiyer, tamamlayan ve puan ortalaması. Değerler her okumada sunucuda hesaplanır;
 * öğretmen yalnız kendi kapsamındaki hedefleri görür. Masaüstünde tablo, dar ekranda temel
 * bilgiler ve açılan ayrıntı (`DataTable`).
 */
export function ContentAssignmentResults({ resourceId }: { resourceId: string }) {
  const results = useContentAssignmentResults(resourceId)
  const { names } = useTaskLookups()
  const data = results.data?.data
  const rows = useMemo(() => (data ? resultRows(data, names) : NO_ROWS), [data, names])
  return (
    <section aria-labelledby="icerik-sonuc-baslik" className="grid gap-2">
      <h3 id="icerik-sonuc-baslik" className="text-sm font-semibold">
        Atamalar ve sonuçlar
      </h3>
      {results.error ? (
        <QueryError error={results.error} onRetry={() => void results.refetch()} />
      ) : !data ? (
        <p role="status" className="text-sm text-muted-foreground">
          Sonuçlar yükleniyor…
        </p>
      ) : data.assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Bu içerik henüz atanmadı. Atayınca sınıf başına sonuçlar burada görünür.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{resultTotalsLabel(data)}</p>
          <DataTable
            listKey={`icerik-sonuc-${resourceId}`}
            urlPrefix={RESULT_LIST_PREFIX}
            rows={rows}
            columns={COLUMNS}
            mobileColumns={MOBILE_COLUMNS}
            search={false}
            pageSize={10}
            caption="İçeriğin atama sonuçları"
            empty="Görebileceğiniz bir hedef yok."
          />
          {data.truncated ? (
            <p role="status" className="text-sm text-muted-foreground">
              Yalnız en yeni 100 atama gösteriliyor.
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}
