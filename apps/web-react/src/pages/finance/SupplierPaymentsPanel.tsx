import { useMemo, useState } from 'react'
import { isReauthenticationRequired } from '@kampus/react-shared/reauthentication.ts'
import {
  usePaymentInstructionFile,
  useSupplierPayments,
  type SupplierPaymentRow,
} from '@kampus/react-shared/use-finance-supplier-ledger.ts'
import { money } from '@kampus/school-core/lib/format.ts'
import {
  SUPPLIER_PAYMENT_METHOD_LABELS,
  SUPPLIER_PAYMENT_METHODS,
  type SupplierPaymentMethod,
} from '@kampus/school-core/lib/finance-supplier-ledger.ts'
import { useReauthRetry } from '@/auth/use-reauth-retry.tsx'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useListState } from '@/hooks/use-list-state.ts'
import { saveBlob } from '@/lib/download.ts'
import { notify } from '@/lib/notify.ts'
import { dayText, instructionEligible } from './finance-supplier-ledger-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['select', 'supplier', 'amount', 'instruction']
const BOM = '﻿'
const REEXPORT_WARNING = 'supplier_payment_instruction_exported_warning'
const METHOD_OPTIONS = SUPPLIER_PAYMENT_METHODS.map((value) => ({
  value,
  label: SUPPLIER_PAYMENT_METHOD_LABELS[value],
}))
const INSTRUCTION_OPTIONS = [
  { value: 'pending', label: 'Talimatı alınmadı' },
  { value: 'exported', label: 'Talimatı alındı' },
]
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const isMethod = (value: string | null): value is SupplierPaymentMethod =>
  SUPPLIER_PAYMENT_METHODS.some((method) => method === value)

type Row = {
  id: string
  select: string
  paidDate: string
  supplier: string
  invoice: string
  amount: number
  method: string
  account: string
  instruction: string
  payment: SupplierPaymentRow
}

/**
 * Tedarikçi ödemeleri ve ödeme talimatı dosyası (K-164, K-165): etkin havale ve EFT ödemeleri
 * seçilip genel CSV indirilir; indirilen ödemeler "talimatı alındı" işaretlenir. Daha önce alınmış
 * ödeme açık onayla yeniden alınır. Dosya taze oturum ister.
 */
export function SupplierPaymentsPanel() {
  const list = useListState('tedarikci-odemeleri', { urlPrefix: 'todeme_' })
  const method = text(list.state.filters.method)
  const instruction = text(list.state.filters.instruction)
  const payments = useSupplierPayments({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(isMethod(method) ? { method } : {}),
    ...(instruction === 'pending' || instruction === 'exported' ? { instruction } : {}),
  })
  const instructionFile = usePaymentInstructionFile()
  const { run, reauthModal } = useReauthRetry()
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [warning, setWarning] = useState<string | null>(null)
  const toggle = (id: string, checked: boolean) => {
    setWarning(null)
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }
  const rows = useMemo(
    () =>
      payments.data?.data.map((item): Row => ({
        id: item.id,
        select: item.id,
        paidDate: dayText(item.paidDate),
        supplier: item.supplier.name,
        invoice: item.invoice.invoiceNumber,
        amount: item.amountCents,
        method: SUPPLIER_PAYMENT_METHOD_LABELS[item.method],
        account: item.bankAccount?.label ?? '—',
        instruction: item.instructionExportedAt ? 'Alındı' : '',
        payment: item,
      })),
    [payments.data],
  )
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      {
        key: 'select',
        label: 'Seç',
        cell: (row) =>
          instructionEligible(row.payment) ? (
            <Checkbox
              aria-label={`${row.supplier} ${money(row.amount)} ödemesini talimata ekle`}
              checked={selected.has(row.id)}
              onCheckedChange={(next) => toggle(row.id, next === true)}
            />
          ) : null,
      },
      { key: 'paidDate', label: 'Gün' },
      { key: 'supplier', label: 'Tedarikçi' },
      { key: 'invoice', label: 'Fatura' },
      { key: 'amount', label: 'Tutar', cell: (row) => money(row.amount) },
      { key: 'method', label: 'Yöntem' },
      { key: 'account', label: 'Hesap' },
      {
        key: 'instruction',
        label: 'Durum',
        cell: (row) =>
          row.payment.cancelledAt ? (
            <StatusBadge text="İptal edildi" tone="gray" />
          ) : row.payment.instructionExportedAt ? (
            <StatusBadge text="Talimatı alındı" tone="green" />
          ) : instructionEligible(row.payment) ? (
            <StatusBadge text="Talimat bekliyor" tone="amber" />
          ) : (
            '—'
          ),
      },
    ],
    [selected],
  )
  const filters = useMemo(
    () => [
      {
        key: 'instruction',
        label: 'Talimat',
        type: 'select' as const,
        options: INSTRUCTION_OPTIONS,
      },
      { key: 'method', label: 'Yöntem', type: 'select' as const, options: METHOD_OPTIONS },
    ],
    [],
  )
  async function download() {
    const paymentIds = [...selected]
    const outcome = await run(() =>
      instructionFile.submit(
        { paymentIds, ...(warning ? { confirmReexport: true } : {}) },
        { silent: (error) => error.code === REEXPORT_WARNING || isReauthenticationRequired(error) },
      ),
    )
    if (outcome.status !== 'done') return
    const result = outcome.result
    if (result.status === 'failed' && result.error.code === REEXPORT_WARNING) {
      setWarning(result.error.message)
      return
    }
    if (result.status !== 'success') return
    // Yanıt çözülürken BOM düşer; Excel Türkçe karakterleri onunla tanır.
    const csv = String(result.data).replace(BOM, '')
    saveBlob(
      new Blob([BOM, csv], { type: 'text/csv;charset=utf-8' }),
      `odeme-talimati-${new Date().toISOString().slice(0, 10)}.csv`,
    )
    notify.success(`${String(paymentIds.length)} ödemenin talimat dosyası indirildi.`)
    setSelected(new Set())
    setWarning(null)
  }
  const busy = instructionFile.isPending
  return (
    <div className="grid gap-2 pt-4">
      <div className="grid gap-2 px-6">
        <p className="text-sm text-muted-foreground">
          Ödeme talimatı genel CSV dosyasıdır (alıcı unvanı, IBAN, tutar, açıklama); bankanızın
          toplu ödeme ekranına yükleyin. Yalnız havale ve EFT ödemeleri seçilebilir.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={busy || selected.size === 0}
            aria-busy={busy || undefined}
            onClick={() => void download()}
          >
            <Icon name="Download" size={16} aria-hidden="true" />
            {warning
              ? 'Yeniden almayı onayla ve indir'
              : `Talimat dosyası indir (${String(selected.size)})`}
          </Button>
          {selected.size > 0 ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setSelected(new Set())
                setWarning(null)
              }}
            >
              Seçimi temizle
            </Button>
          ) : null}
        </div>
        {warning ? (
          <p role="alert" className="rounded-md border border-warning p-3 text-sm">
            {warning}
          </p>
        ) : null}
      </div>
      <ServerDataTable
        list={list}
        rows={rows}
        total={payments.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={filters}
        mobileColumns={MOBILE}
        search={false}
        caption="Tedarikçi ödemeleri"
        empty="Henüz tedarikçi ödemesi yok. Ödeme, fatura ayrıntısındaki taksitten girilir."
        emptyFiltered="Bu seçimle eşleşen ödeme yok."
        loading={payments.isPending}
        fetching={payments.isFetching && !payments.isPending}
        error={
          payments.error ? (
            <QueryError error={payments.error} onRetry={() => void payments.refetch()} />
          ) : undefined
        }
      />
      {reauthModal}
    </div>
  )
}
