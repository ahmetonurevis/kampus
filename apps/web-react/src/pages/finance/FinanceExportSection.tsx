import { useState } from 'react'
import { dayKey, money } from '@kampus/school-core/lib/format.ts'
import {
  useFinanceExport,
  useFinanceSummary,
  type FinanceExportKind,
} from '@kampus/react-shared/use-finance-exports.ts'
import { REAUTHENTICATION_CODE } from '@kampus/react-shared/use-withdrawals.ts'
import { ReauthModal } from '@/auth/ReauthModal.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { saveBlob } from '@/lib/download.ts'
import { notify } from '@/lib/notify.ts'
import { StatGrid } from '../academic/AcademicParts.tsx'
import { FinanceExportProfileButton } from './FinanceExportProfilePanel.tsx'

const FILES: readonly { kind: FinanceExportKind; label: string; name: string }[] = [
  { kind: 'payments', label: 'Tahsilat dosyası', name: 'tahsilatlar' },
  { kind: 'refunds', label: 'İade dosyası', name: 'iadeler' },
  { kind: 'invoices', label: 'Taksit dosyası', name: 'taksitler' },
]
const BOM = '﻿'

/**
 * Muhasebe aktarımı (IST-111, ADR 0006 karar 11): toplamlar ve dosya sunucuda aynı satırlardan
 * üretilir, dosya toplamı ekrandaki toplama eşittir. Toplamı yönetici ve ön büro görür, kişisel
 * veri taşıyan dosyayı yalnız yönetici indirir. Kampüs fatura düzenlemez.
 */
export function FinanceExportSection({ canDownload }: { canDownload: boolean }) {
  const today = dayKey()
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`)
  const [to, setTo] = useState(today)
  const [pending, setPending] = useState<(typeof FILES)[number] | null>(null)
  const complete = from !== '' && to !== ''
  const summary = useFinanceSummary({ from, to }, { enabled: complete })
  const exporter = useFinanceExport()
  const data = summary.data?.data

  async function download(file: (typeof FILES)[number]) {
    const outcome = await exporter.submit({ kind: file.kind, from, to })
    if (outcome.status === 'failed' && outcome.error.code === REAUTHENTICATION_CODE)
      setPending(file)
    if (outcome.status !== 'success') return
    // Yanıt çözülürken BOM düşer; Excel Türkçe karakterleri onunla tanır.
    const csv = String(outcome.data).replace(BOM, '')
    saveBlob(
      new Blob([BOM, csv], { type: 'text/csv;charset=utf-8' }),
      `${file.name}-${from}-${to}.csv`,
    )
    notify.success('Dosya indirildi.')
  }

  const busy = exporter.isPending
  return (
    <section
      aria-labelledby="muhasebe-aktarimi"
      className="panel rounded-card border bg-surface p-6 max-[650px]:p-4"
    >
      <h2 id="muhasebe-aktarimi" className="text-lg font-semibold">
        Muhasebe aktarımı
      </h2>
      <p className="mb-5 text-sm text-muted-foreground">
        Dönem en çok bir yıl olabilir. Tahsilat iptali, iptal gününde eksi satır olarak yazılır.
      </p>
      <div className="mb-6 grid max-w-md grid-cols-2 gap-4 max-[420px]:grid-cols-1">
        <FormField id="aktarim-baslangic" label="Dönem başlangıcı">
          {(control) => (
            <Input
              {...control}
              type="date"
              value={from}
              max={today}
              onChange={(event) => setFrom(event.target.value)}
            />
          )}
        </FormField>
        <FormField id="aktarim-bitis" label="Dönem bitişi">
          {(control) => (
            <Input
              {...control}
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          )}
        </FormField>
      </div>
      {summary.error ? (
        <div className="mb-6">
          <QueryError error={summary.error} onRetry={() => void summary.refetch()} />
        </div>
      ) : null}
      {data ? (
        <StatGrid
          label="Dönem toplamları"
          items={[
            {
              label: 'Net tahsilat',
              value: money(data.payments.totalCents),
              note: `${String(data.payments.count)} hareket`,
            },
            {
              label: 'Ödenen iade',
              value: money(data.refunds.totalCents),
              note: `${String(data.refunds.count)} iade`,
            },
            {
              label: 'Vadesi dönemde olan taksit',
              value: money(data.invoices.totalCents),
              note: `${String(data.invoices.count)} taksit · ${money(data.invoices.paidCents)} ödendi${
                data.invoices.openingImportCents > 0
                  ? `, ${money(data.invoices.openingImportCents)} açılış aktarımı`
                  : ''
              }`,
            },
          ]}
        />
      ) : null}
      {canDownload ? (
        <div className="flex flex-wrap gap-3">
          {FILES.map((file) => (
            <Button
              key={file.kind}
              variant="secondary"
              disabled={busy || !complete || Boolean(summary.error)}
              aria-busy={busy || undefined}
              onClick={() => void download(file)}
            >
              <Icon name="Download" size={17} aria-hidden="true" />
              {file.label}
            </Button>
          ))}
          <FinanceExportProfileButton />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Aktarım dosyalarını yönetici indirir.</p>
      )}
      {pending ? (
        <ReauthModal
          onCancel={() => setPending(null)}
          onDone={() => {
            const file = pending
            setPending(null)
            void download(file)
          }}
        />
      ) : null}
    </section>
  )
}
