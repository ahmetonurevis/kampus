import { useMemo, useState } from 'react'
import {
  BANK_TRANSACTION_STATUSES,
  type BankTransactionStatus,
} from '@kampus/school-core/lib/finance-bank-matching.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { receiptNumberLabel } from '@kampus/school-core/lib/finance-receipt.ts'
import {
  useBankTransactions,
  useRestoreBankTransaction,
  type BankTransaction,
} from '@kampus/react-shared/use-finance-bank-matching.ts'
import { useBankAccounts } from '@kampus/react-shared/use-payment-commands.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useEnrollmentLearner } from '@/hooks/use-enrollment-learner.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { BankMatchPanel } from './BankMatchPanel.tsx'
import { BankStatementImportDialog } from './BankStatementImportDialog.tsx'
import {
  CONFIDENCE_TONES,
  confidenceLabel,
  STATUS_TONES,
  statusLabel,
} from './bank-matching-model.ts'

type Row = {
  id: string
  bookingDate: string
  description: string
  amountCents: number
  account: string
  status: BankTransactionStatus
  suggestion: string
  transaction: BankTransaction
}

const NO_SORT: readonly string[] = []
const MOBILE_COLUMNS = ['bookingDate', 'amountCents', 'status', ACTIONS_KEY]
const ALL = 'all'
const isStatus = (value: unknown): value is BankTransactionStatus =>
  typeof value === 'string' && (BANK_TRANSACTION_STATUSES as readonly string[]).includes(value)
const dayFilter = (value: unknown) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null

/**
 * Finans → Banka eşleştirme (IST-115, ON-099; DOM-FIN-069): ekstre yükleme, gelen hareket listesi
 * (durum, hesap, gün ve metin süzgeci, sunucu sayfalı) ve eşleştirme paneli. Varsayılan süzgeç
 * eşleşmemiş hareketlerdir. Öneri onaylanmadan tahsilat oluşmaz. Yalnız yönetici; sayfa sekmeyi
 * rolüne göre gösterir.
 */
export function FinanceBankMatchingSection() {
  const learner = useEnrollmentLearner()
  const list = useListState('banka-eslestirme')
  const search = useDebouncedValue(list.state.query).trim()
  const statusFilter = list.state.filters.status
  const status = statusFilter === ALL ? null : isStatus(statusFilter) ? statusFilter : 'unmatched'
  const accountId =
    typeof list.state.filters.account === 'string' && list.state.filters.account !== ''
      ? list.state.filters.account
      : null
  const dateFrom = dayFilter(list.state.filters.dateFrom)
  const dateTo = dayFilter(list.state.filters.dateTo)
  const reversedRange = dateFrom !== null && dateTo !== null && dateTo < dateFrom
  const transactions = useBankTransactions({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(status ? { status } : {}),
    ...(accountId ? { bankAccountId: accountId } : {}),
    ...(search.length >= 2 ? { q: search } : {}),
    ...(dateFrom && !reversedRange ? { dateFrom } : {}),
    ...(dateTo && !reversedRange ? { dateTo } : {}),
  })
  const accounts = useBankAccounts()
  const restore = useRestoreBankTransaction()
  const [importing, setImporting] = useState(false)
  const [selected, setSelected] = useState<BankTransaction | null>(null)

  const rows = useMemo(
    () =>
      transactions.data?.data.map((item): Row => ({
        id: item.id,
        bookingDate: item.bookingDate,
        description: [item.description, item.counterparty].filter(Boolean).join(' · '),
        amountCents: item.amountCents,
        account: item.bankAccountLabel,
        status: item.status,
        suggestion: item.suggestion?.studentName ?? '',
        transaction: item,
      })),
    [transactions.data],
  )

  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      {
        key: 'bookingDate',
        label: 'İşlem tarihi',
        cell: (row) => dateLabel(row.bookingDate, { year: 'numeric' }),
      },
      { key: 'description', label: 'Açıklama' },
      { key: 'amountCents', label: 'Tutar', cell: (row) => money(row.amountCents) },
      { key: 'account', label: 'Hesap' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge text={statusLabel(row.status)} tone={STATUS_TONES[row.status]} />
        ),
      },
      {
        key: 'suggestion',
        label: 'Öneri',
        cell: ({ transaction }) => {
          if (transaction.status === 'matched' && transaction.payment)
            return `${transaction.payment.studentName ?? learner.title} · ${receiptNumberLabel(transaction.payment)}`
          const suggestion = transaction.suggestion
          if (!suggestion) return '—'
          return (
            <span className="grid gap-1">
              <span>
                {suggestion.studentName} · {suggestion.installment}. taksit
              </span>
              <StatusBadge
                text={confidenceLabel(suggestion.confidence)}
                tone={CONFIDENCE_TONES[suggestion.confidence]}
              />
            </span>
          )
        },
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: ({ transaction }) =>
          transaction.status === 'ignored' ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={restore.isPending}
              aria-label={`${dateLabel(transaction.bookingDate, { year: 'numeric' })} tarihli ${money(transaction.amountCents)} hareketin yoksaymasını geri al`}
              onClick={() =>
                void restore
                  .submit({ transactionId: transaction.id, version: transaction.version })
                  .then((outcome) => {
                    if (outcome.status === 'success') notify.success('Hareket yeniden eşleşmedi.')
                  })
              }
            >
              Geri al
            </Button>
          ) : (
            <Button
              size="sm"
              variant={transaction.status === 'unmatched' ? 'default' : 'secondary'}
              aria-label={`${dateLabel(transaction.bookingDate, { year: 'numeric' })} tarihli ${money(transaction.amountCents)} hareketi ${transaction.status === 'unmatched' ? 'eşleştir' : 'görüntüle'}`}
              onClick={() => setSelected(transaction)}
            >
              {transaction.status === 'unmatched' ? 'Eşleştir' : 'Ayrıntı'}
            </Button>
          ),
      },
    ],
    [learner, restore],
  )

  const total = transactions.data?.meta.total ?? 0
  return (
    <section
      aria-labelledby="banka-eslestirme-baslik"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading grid gap-3 px-6 pt-6 pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="banka-eslestirme-baslik" className="text-lg font-semibold">
              Banka eşleştirme
            </h2>
            <p className="text-sm text-muted-foreground">
              {total} hareket · Ekstredeki gelen havale ve EFT’ler önerilen taksitle eşleşir;
              onaylamadan tahsilat oluşmaz.
            </p>
          </div>
          <Button type="button" onClick={() => setImporting(true)}>
            <Icon name="Upload" size={16} aria-hidden="true" />
            Ekstre yükle
          </Button>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="grid w-full max-w-xs gap-1 text-sm font-medium">
            Durum
            <NativeSelect
              value={status ?? ALL}
              onChange={(event) =>
                list.dispatch({ type: 'filter', key: 'status', value: event.target.value })
              }
            >
              {BANK_TRANSACTION_STATUSES.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {statusLabel(value)}
                </NativeSelectOption>
              ))}
              <NativeSelectOption value={ALL}>Tümü</NativeSelectOption>
            </NativeSelect>
          </label>
          <label className="grid w-full max-w-xs gap-1 text-sm font-medium">
            Banka hesabı
            <NativeSelect
              value={accountId ?? ''}
              onChange={(event) =>
                list.dispatch({ type: 'filter', key: 'account', value: event.target.value })
              }
            >
              <NativeSelectOption value="">Tüm hesaplar</NativeSelectOption>
              {(accounts.data?.data ?? []).map((account) => (
                <NativeSelectOption key={account.id} value={account.id}>
                  {account.bankName} · {account.iban.slice(-4)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            İşlem günü (başlangıç)
            <Input
              type="date"
              value={dateFrom ?? ''}
              onChange={(event) =>
                list.dispatch({ type: 'filter', key: 'dateFrom', value: event.target.value })
              }
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            İşlem günü (bitiş)
            <Input
              type="date"
              value={dateTo ?? ''}
              aria-invalid={reversedRange || undefined}
              aria-describedby={reversedRange ? 'banka-gun-hata' : undefined}
              onChange={(event) =>
                list.dispatch({ type: 'filter', key: 'dateTo', value: event.target.value })
              }
            />
          </label>
          {reversedRange ? (
            <p id="banka-gun-hata" role="alert" className="self-end text-sm text-destructive">
              Bitiş günü başlangıç gününden önce olamaz.
            </p>
          ) : null}
        </div>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={total}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={MOBILE_COLUMNS}
        caption="Banka hareketleri"
        empty={
          status === 'unmatched'
            ? 'Eşleşmeyi bekleyen hareket yok. Yeni ekstre yükleyin.'
            : 'Hareket bulunamadı.'
        }
        loading={transactions.isPending}
        fetching={transactions.isFetching && !transactions.isPending}
        error={
          transactions.error ? (
            <QueryError error={transactions.error} onRetry={() => void transactions.refetch()} />
          ) : undefined
        }
      />
      <BankStatementImportDialog open={importing} onClose={() => setImporting(false)} />
      {selected ? (
        <BankMatchPanel transaction={selected} onClose={() => setSelected(null)} />
      ) : null}
    </section>
  )
}
