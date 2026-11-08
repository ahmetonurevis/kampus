import { zodResolver } from '@hookform/resolvers/zod'
import { useId, useMemo, useState, type ChangeEvent } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import type { ApiError } from '@kampus/api-client/errors.ts'
import {
  BANK_STATEMENT_FIELD_LABELS,
  BANK_STATEMENT_FIELDS,
  BANK_STATEMENT_SAMPLE,
  type BankStatementField,
} from '@kampus/school-core/lib/finance-bank-statement.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import {
  useImportBankStatement,
  type BankStatementImportResult,
  type BankStatementImportRow,
} from '@kampus/react-shared/use-finance-bank-matching.ts'
import { useBankAccounts } from '@kampus/react-shared/use-payment-commands.ts'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { saveBlob } from '@/lib/download.ts'
import { notify } from '@/lib/notify.ts'
import { bytesToBase64 } from '../crm/enrollment-import-rows.ts'
import {
  IMPORT_ROW_LABELS,
  IMPORT_ROW_TONES,
  importSummary,
  statementFileProblem,
} from './bank-matching-model.ts'

// Banka ekstresi aktarımı (IST-115, ON-099; DOM-FIN-069): hesap ve dosya seç → sunucuda önizle
// (`dryRun`, hiçbir şey yazmaz) → gerekirse sütunları eşle → onayla. Yalnız gelen hareketler
// yazılır; aktarım tahsilat oluşturmaz, eşleştirme ayrı onaydır. Dosya içeriği yalnız bu bileşenin
// durumundadır.

const formSchema = z.object({
  bankAccountId: z.string().min(1, 'Ekstrenin ait olduğu banka hesabını seçin.'),
})
type FormValues = z.infer<typeof formSchema>
type Columns = Partial<Record<BankStatementField, string>>

/** Dosya düzeyindeki sorun (başlık, satır sınırı, okunamayan dosya, hesap) alanda gösterilir. */
const isFileError = (error: ApiError) =>
  error.status === 422 && /^(bank_statement_(?!invalid)|import_file_|csv_)/.test(error.code)
const QUIET = {
  silent: (error: ApiError) => isFileError(error) || error.code === 'bank_statement_invalid',
}

type PreviewRow = {
  id: string
  line: number
  status: string
  tone: (typeof IMPORT_ROW_TONES)[keyof typeof IMPORT_ROW_TONES]
  date: string
  amount: string
  description: string
  problems: string
}
const COLUMNS: DataColumn<PreviewRow>[] = [
  { key: 'line', label: 'Satır' },
  {
    key: 'status',
    label: 'Durum',
    cell: (row) => <StatusBadge text={row.status} tone={row.tone} />,
  },
  { key: 'date', label: 'Tarih' },
  { key: 'amount', label: 'Tutar' },
  { key: 'description', label: 'Açıklama' },
  { key: 'problems', label: 'Sorun' },
]
const MOBILE_COLUMNS = ['line', 'status', 'amount', 'problems']

const previewRow = (row: BankStatementImportRow): PreviewRow => ({
  id: String(row.line),
  line: row.line,
  status: IMPORT_ROW_LABELS[row.status],
  tone: IMPORT_ROW_TONES[row.status],
  date: row.bookingDate ? dateLabel(row.bookingDate, { year: 'numeric' }) : '—',
  amount:
    row.amountCents === null
      ? '—'
      : `${row.direction === 'debit' ? '−' : ''}${money(row.amountCents)}`,
  description: row.description || '—',
  problems: row.issues.map((item) => item.message).join(' ') || '—',
})

export function BankStatementImportDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  return (
    <Modal
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Banka ekstresi yükle"
      description="Önce önizlenir; onaylayana kadar hiçbir hareket yazılmaz. Aktarım tahsilat oluşturmaz."
      size="wide"
    >
      {open ? <ImportForm onClose={onClose} /> : null}
    </Modal>
  )
}

function ImportForm({ onClose }: { onClose: () => void }) {
  const importer = useImportBankStatement()
  const accounts = useBankAccounts()
  const fileId = useId()
  const headingId = useId()
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { bankAccountId: '' },
  })
  const [fileBase64, setFileBase64] = useState<string | null>(null)
  const [fileError, setFileError] = useState('')
  const [reading, setReading] = useState(false)
  const [result, setResult] = useState<BankStatementImportResult | null>(null)
  const [columns, setColumns] = useState<Columns>({})
  const [mapping, setMapping] = useState(false)
  const rows = useMemo(() => result?.rows.map(previewRow) ?? [], [result])
  const busy = importer.isPending || reading
  const accountList = accounts.data?.data ?? []

  function clearPreview() {
    setResult(null)
  }

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    clearPreview()
    setFileBase64(null)
    if (!file) return
    const problem = statementFileProblem(file)
    setFileError(problem ?? '')
    if (problem) {
      input.value = ''
      return
    }
    setReading(true)
    try {
      setFileBase64(bytesToBase64(new Uint8Array(await file.arrayBuffer())))
    } catch (error) {
      notify.error('Dosya okunamadı. Başka bir dosya seçip yeniden deneyin.', error)
    } finally {
      setReading(false)
    }
  }

  const body = (values: FormValues, dryRun: boolean) => {
    const chosen = Object.fromEntries(
      Object.entries(columns).filter(([, name]) => name !== undefined && name.trim() !== ''),
    )
    return {
      bankAccountId: values.bankAccountId,
      fileBase64: fileBase64 ?? '',
      dryRun,
      ...(Object.keys(chosen).length > 0 ? { columns: chosen } : {}),
    }
  }

  const preview = form.handleSubmit(async (values) => {
    if (fileBase64 === null) {
      setFileError('Dosya seçin.')
      return
    }
    const outcome = await importer.submit(body(values, true), {
      ...QUIET,
      setError: (name, error) => {
        if (name === 'bankAccountId') form.setError('bankAccountId', error)
      },
    })
    if (outcome.status === 'success') {
      setResult(outcome.data.data)
      setFileError('')
    } else if (outcome.status === 'failed' && isFileError(outcome.error)) {
      clearPreview()
      setFileError(outcome.error.message)
      if (/header_missing|column_missing/.test(outcome.error.code)) setMapping(true)
    }
  })

  const confirm = form.handleSubmit(async (values) => {
    if (result === null || result.invalidCount > 0) return
    const outcome = await importer.submit(body(values, false), QUIET)
    if (outcome.status === 'success') {
      const done = outcome.data.data
      notify.success(
        done.readyCount === 0
          ? 'Yeni hareket yok; ekstredeki hareketler daha önce aktarılmış.'
          : `${String(done.readyCount)} hareket aktarıldı. Eşleştirmeleri onaylayın.`,
      )
      onClose()
    } else if (outcome.status === 'failed') {
      clearPreview()
      setFileError(outcome.error.message)
    }
  })

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <form
        noValidate
        aria-label="Ekstre aktarım formu"
        onSubmit={(event) => void preview(event)}
        className="grid gap-4"
      >
        <p className="text-sm text-muted-foreground">
          Bankanızın internet şubesinden hesap hareketlerini CSV, Excel ya da MT940 olarak indirin.
          Tarih, açıklama ve tutar (ya da alacak/borç) sütunları tanınır; başlıktan önceki hesap
          bilgisi satırları atlanır. Yalnız gelen hareketler aktarılır; aynı hareket ikinci kez
          aktarılmaz.
        </p>
        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              saveBlob(
                new Blob([BANK_STATEMENT_SAMPLE], { type: 'text/csv;charset=utf-8' }),
                'ornek-banka-ekstresi.csv',
              )
            }
          >
            <Icon name="Download" size={16} aria-hidden="true" />
            Örnek ekstreyi indir
          </Button>
        </div>
        <FormField
          id="ekstre-hesap"
          label="Banka hesabı"
          error={form.formState.errors.bankAccountId}
          description={
            accounts.isSuccess && accountList.length === 0
              ? 'Kurumda bildirilmiş hesap yok; önce Ayarlar’dan hesap ekleyin.'
              : undefined
          }
        >
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('bankAccountId', { onChange: clearPreview })}
              disabled={busy}
            >
              <NativeSelectOption value="">Hesap seçin</NativeSelectOption>
              {accountList.map((account) => (
                <NativeSelectOption key={account.id} value={account.id}>
                  {account.bankName} · {account.iban.slice(-4)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField
          id={fileId}
          label="Ekstre dosyası"
          error={fileError ? { message: fileError } : undefined}
          description="En fazla 5 MB; CSV, Excel (.xlsx, ilk sayfa) ya da MT940. Dosya saklanmaz."
        >
          {(control) => (
            <Input
              {...control}
              type="file"
              accept=".csv,.txt,.xlsx,.sta,.940,.mt940,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={busy}
              onChange={(event) => void readFile(event)}
            />
          )}
        </FormField>
        <div>
          <Button
            type="button"
            variant="ghost"
            aria-expanded={mapping}
            onClick={() => setMapping((value) => !value)}
          >
            <Icon name="Pencil" size={16} aria-hidden="true" />
            Sütunları elle eşle
          </Button>
        </div>
        {mapping ? (
          <fieldset className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
            <legend className="px-1 text-sm font-medium">Sütun eşleme</legend>
            <p className="text-sm text-muted-foreground sm:col-span-2">
              Boş bırakılan alan otomatik tanınır. Tutar tek sütunda işaretliyse (giden eksi)
              “Tutar”ı, gelen ve giden ayrı sütunlardaysa “Alacak” ve “Borç”u seçin.
            </p>
            {BANK_STATEMENT_FIELDS.map((field) => (
              <label key={field} className="grid gap-1 text-sm font-medium">
                {BANK_STATEMENT_FIELD_LABELS[field]}
                {result && result.headers.length > 0 ? (
                  <NativeSelect
                    value={columns[field] ?? ''}
                    onChange={(event) => {
                      clearPreview()
                      setColumns((current) => ({ ...current, [field]: event.target.value }))
                    }}
                  >
                    <NativeSelectOption value="">
                      Otomatik{result.columns[field] ? ` (${result.columns[field]})` : ''}
                    </NativeSelectOption>
                    {result.headers.map((header) => (
                      <NativeSelectOption key={header} value={header}>
                        {header}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                ) : (
                  <Input
                    value={columns[field] ?? ''}
                    placeholder="Dosyadaki başlık adı"
                    onChange={(event) => {
                      clearPreview()
                      setColumns((current) => ({ ...current, [field]: event.target.value }))
                    }}
                  />
                )}
              </label>
            ))}
          </fieldset>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={importer.isPending}>
            Vazgeç
          </Button>
          <Button type="submit" variant="secondary" disabled={busy} aria-busy={busy || undefined}>
            <Icon name="Eye" size={16} aria-hidden="true" />
            Önizle
          </Button>
        </div>
      </form>

      {result ? (
        <section
          aria-labelledby={headingId}
          className="grid grid-cols-[minmax(0,1fr)] gap-3 border-t pt-4"
        >
          <h3 id={headingId} className="text-base font-semibold">
            Ekstre önizlemesi
          </h3>
          <p role="status" className="text-sm text-muted-foreground">
            {importSummary(result)}
          </p>
          {result.invalidCount > 0 ? (
            <div role="alert" className="rounded-md border border-destructive p-3 text-sm">
              Ekstrede hatalı satırlar var. Hiçbir hareket aktarılmadı; sütunları eşleyin ya da
              dosyayı düzeltip yeniden önizleyin.
            </div>
          ) : null}
          <DataTable
            listKey="ekstre-onizleme"
            rows={rows}
            columns={COLUMNS}
            mobileColumns={MOBILE_COLUMNS}
            pageSize={10}
            caption="Ekstre önizlemesi"
            searchKeys={['description', 'problems']}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              onClick={() => void confirm()}
              disabled={result.invalidCount > 0 || result.readyCount === 0 || busy}
              aria-busy={importer.isPending || undefined}
            >
              <Icon name="Check" size={17} aria-hidden="true" />
              {result.readyCount} hareketi aktar
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  )
}
