import { useMemo } from 'react'
import { useStudentStatement } from '@kampus/react-shared/use-finance-exports.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { statementLineLabel } from '@kampus/school-core/lib/finance-statement.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { PdfButton } from '@/components/PdfButton.tsx'
import { QueryError } from '@/components/QueryError.tsx'

type StatementRow = {
  id: string
  date: string
  label: string
  debitCents: number
  creditCents: number
  balanceCents: number
}

const amountOf = (cents: number) => (cents === 0 ? '—' : money(cents))

const COLUMNS: readonly DataColumn<StatementRow>[] = [
  { key: 'date', label: 'Tarih', cell: (row) => dateLabel(row.date, { year: 'numeric' }) },
  { key: 'label', label: 'İşlem' },
  { key: 'debitCents', label: 'Borç', cell: (row) => amountOf(row.debitCents) },
  { key: 'creditCents', label: 'Alacak', cell: (row) => amountOf(row.creditCents) },
  { key: 'balanceCents', label: 'Bakiye', cell: (row) => money(row.balanceCents) },
]
const MOBILE_COLUMNS = ['date', 'label', 'balanceCents']
// Süzülen ekstrede yürüyen bakiye satırlarla tutmaz; özet kartları sayfanın üstündedir.
const NO_FILTERS = COLUMNS.map((column) => column.key)

/** Veli ve öğrencinin cari ekstresi: özet, hesap hareketleri ve PDF (IST-107). */
export function StudentStatementSection({ studentId }: { studentId: string }) {
  const query = useStudentStatement(studentId)
  const statement = query.data?.data
  const rows = useMemo<StatementRow[]>(
    () =>
      (statement?.lines ?? []).map((line, index) => ({
        id: String(index),
        date: line.date,
        label: statementLineLabel(line),
        debitCents: line.debitCents,
        creditCents: line.creditCents,
        balanceCents: line.balanceCents,
      })),
    [statement],
  )
  return (
    <section aria-label="Cari ekstre" className="mt-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Cari ekstre</h2>
        <PdfButton
          type="student-statement"
          recordId={studentId}
          label="Ekstreyi görüntüle"
          size="default"
        />
      </div>
      {query.error ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : !statement ? (
        <p role="status" className="text-sm text-muted-foreground">
          Ekstre yükleniyor…
        </p>
      ) : (
        <>
          {statement.unappliedCents > 0 ? (
            <p role="note" className="mb-4 rounded-card border bg-surface-soft px-4 py-3 text-sm">
              Taksitlere dağıtılmayan {money(statement.unappliedCents)} iade alacağıdır; kalan
              tutardan düşülmemiştir.
            </p>
          ) : null}
          {statement.openingImportCents > 0 ? (
            <p role="note" className="mb-4 rounded-card border bg-surface-soft px-4 py-3 text-sm">
              Ödenen tutarın {money(statement.openingImportCents)} kısmı açılış aktarımıdır: önceki
              kayıtlardan aktarılmıştır, Kampüs tahsilatı ve dekontu yoktur.
            </p>
          ) : null}
          <DataTable
            listKey={`cari-ekstre-${studentId}`}
            rows={rows}
            columns={COLUMNS}
            mobileColumns={MOBILE_COLUMNS}
            caption="Hesap hareketleri"
            search={false}
            excludeFilters={NO_FILTERS}
            empty="Henüz hesap hareketi yok."
          />
        </>
      )}
    </section>
  )
}

/** Kurum görevlisinin taksit panelinden aldığı ekstre; veli ve öğrenci kendi sayfasında görür. */
export function StudentStatementDownload({ studentId }: { studentId: string }) {
  const { session } = useAuth()
  const staff = session?.role === 'yonetici' || session?.role === 'onburo'
  if (!staff) return null
  return (
    <PdfButton
      type="student-statement"
      recordId={studentId}
      label="Cari ekstre"
      variant="outline"
      size="default"
    />
  )
}
