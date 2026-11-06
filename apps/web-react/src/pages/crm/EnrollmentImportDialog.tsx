import { useId, useMemo, useState, type ChangeEvent, type ReactNode } from 'react'
import type { ApiError } from '@kampus/api-client/errors.ts'
import type { CommandOutcome } from '@kampus/react-shared/commands.ts'
import {
  importIssuesOf,
  isImportFileError,
  isImportRowsError,
  type ImportRowIssue,
} from '@kampus/react-shared/enrollment-imports.ts'
import { isReauthenticationRequired } from '@kampus/react-shared/reauthentication.ts'
import { useReauthRetry } from '@/auth/use-reauth-retry.tsx'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { saveBlob } from '@/lib/download.ts'
import { notify } from '@/lib/notify.ts'
import {
  bytesToBase64,
  importFileProblem,
  statusTone,
  withRowIssues,
  type ImportStatusLabel,
} from './enrollment-import-rows.ts'

// Pilot verisi aktarımı (IST-007, ON-060, ON-061): dosya seç → sunucuda önizle (`dryRun`, hiçbir şey
// yazmaz) → satır hataları ve bilgiler tabloda → hatasızsa onayla. Onay aynı dosyayı gönderir;
// sunucu kurum kilidi altında yeniden doğrular, arada değişen kurum 422 satır hatalarıyla döner.
// İşlem taze oturum ister (`useReauthRetry`). Dosya içeriği yalnız bu bileşenin durumundadır.

const QUIET = {
  silent: (error: ApiError) =>
    isReauthenticationRequired(error) || isImportFileError(error) || isImportRowsError(error),
}

type TableRow = {
  id: string
  line: number
  status: ImportStatusLabel
  problems: string[]
  notes: string[]
  noteText: string
}

interface ImportCounts {
  rowCount: number
  readyCount: number
  skippedCount: number
  invalidCount: number
}

export function statusColumn<T extends TableRow>(): DataColumn<T> {
  return {
    key: 'status',
    label: 'Durum',
    cell: (row) => <StatusBadge text={row.status} tone={statusTone(row.status)} />,
  }
}

export function noteColumn<T extends TableRow>(): DataColumn<T> {
  return {
    key: 'noteText',
    label: 'Sorun ve bilgi',
    cell: (row) =>
      row.problems.length + row.notes.length === 0 ? (
        '—'
      ) : (
        <ul className="grid gap-0.5 text-sm">
          {row.problems.map((problem) => (
            <li key={problem} className="text-destructive">
              {problem}
            </li>
          ))}
          {row.notes.map((note) => (
            <li key={note} className="text-muted-foreground">
              {note}
            </li>
          ))}
        </ul>
      ),
  }
}

export interface ImportDialogProps<TResult extends ImportCounts, TRow extends TableRow> {
  open: boolean
  onClose: () => void
  title: string
  description: string
  /** Sütun açıklaması; şablonla birlikte okunur. */
  help: ReactNode
  /** Tablonun ve formun erişilebilir adının öznesi: "Öğrenci", "Taksit". */
  noun: string
  listKey: string
  sampleCsv: string
  sampleFilename: string
  columns: readonly DataColumn<TRow>[]
  mobileColumns: readonly string[]
  searchKeys: readonly string[]
  submit: (
    body: { fileBase64: string; dryRun: boolean },
    options: typeof QUIET,
  ) => Promise<CommandOutcome<{ data: TResult & { rows: readonly unknown[] } }>>
  pending: boolean
  toRows: (result: TResult) => TRow[]
  summary: (result: TResult) => string
  successMessage: (result: TResult) => string
}

export function EnrollmentImportDialog<TResult extends ImportCounts, TRow extends TableRow>(
  props: ImportDialogProps<TResult, TRow>,
) {
  const { open, onClose, title, description } = props
  return (
    <Modal
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={title}
      description={description}
      size="wide"
    >
      {open ? <ImportForm {...props} /> : null}
    </Modal>
  )
}

function ImportForm<TResult extends ImportCounts, TRow extends TableRow>({
  onClose,
  help,
  noun,
  listKey,
  sampleCsv,
  sampleFilename,
  columns,
  mobileColumns,
  searchKeys,
  submit,
  pending,
  toRows,
  summary,
  successMessage,
}: ImportDialogProps<TResult, TRow>) {
  const { run, reauthModal } = useReauthRetry()
  const fileId = useId()
  const headingId = useId()
  const [fileBase64, setFileBase64] = useState<string | null>(null)
  const [fileError, setFileError] = useState('')
  const [reading, setReading] = useState(false)
  const [result, setResult] = useState<TResult | null>(null)
  const [lateIssues, setLateIssues] = useState<ImportRowIssue[]>([])
  const rows = useMemo(
    () => (result === null ? [] : withRowIssues(toRows(result), lateIssues)),
    [result, lateIssues, toRows],
  )
  const busy = pending || reading
  const blocked = result === null || result.invalidCount > 0 || lateIssues.length > 0
  const nothingToWrite = result !== null && result.readyCount === 0

  function clearPreview() {
    setResult(null)
    setLateIssues([])
  }

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    clearPreview()
    setFileBase64(null)
    if (!file) return
    const problem = importFileProblem(file)
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

  async function preview() {
    if (fileBase64 === null) {
      setFileError('Dosya seçin.')
      return
    }
    const outcome = await run(() => submit({ fileBase64, dryRun: true }, QUIET))
    if (outcome.status !== 'done') return
    const done = outcome.result
    if (done.status === 'success') {
      setLateIssues([])
      setResult(done.data.data)
      setFileError('')
    } else if (done.status === 'failed' && isImportFileError(done.error)) {
      clearPreview()
      setFileError(done.error.message)
    }
  }

  async function confirm() {
    if (fileBase64 === null || blocked) return
    const outcome = await run(() => submit({ fileBase64, dryRun: false }, QUIET))
    if (outcome.status !== 'done') return
    const done = outcome.result
    if (done.status === 'success') {
      notify.success(successMessage(done.data.data))
      onClose()
      return
    }
    if (done.status !== 'failed') return
    const issues = importIssuesOf(done.error)
    if (issues) setLateIssues(issues)
    else if (isImportFileError(done.error)) {
      clearPreview()
      setFileError(done.error.message)
    }
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <form
        noValidate
        aria-label={`${noun} aktarım formu`}
        onSubmit={(event) => {
          event.preventDefault()
          void preview()
        }}
        className="grid gap-4"
      >
        <div className="text-sm text-muted-foreground">{help}</div>
        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              saveBlob(new Blob([sampleCsv], { type: 'text/csv;charset=utf-8' }), sampleFilename)
            }
          >
            <Icon name="Download" size={16} aria-hidden="true" />
            Örnek şablonu indir
          </Button>
        </div>
        <FormField
          id={fileId}
          label="Aktarım dosyası"
          error={fileError ? { message: fileError } : undefined}
          description="En fazla 5 MB; CSV ya da Excel (.xlsx, ilk sayfa okunur). Dosya saklanmaz."
        >
          {(control) => (
            <Input
              {...control}
              type="file"
              accept=".csv,.txt,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={pending}
              onChange={(event) => void readFile(event)}
            />
          )}
        </FormField>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
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
            Aktarım önizlemesi
          </h3>
          <p role="status" className="text-sm text-muted-foreground">
            {summary(result)}
          </p>
          {result.invalidCount > 0 || lateIssues.length > 0 ? (
            <div role="alert" className="rounded-md border border-destructive p-3 text-sm">
              {lateIssues.length > 0
                ? 'Önizlemeden sonra kurumda değişiklik oldu. Hiçbir kayıt aktarılmadı; dosyayı düzeltip yeniden önizleyin.'
                : 'Dosyada hatalı satırlar var. Hiçbir kayıt aktarılmadı; dosyayı düzeltip yeniden yükleyin.'}
            </div>
          ) : null}
          <DataTable
            listKey={listKey}
            rows={rows}
            columns={columns}
            mobileColumns={mobileColumns}
            pageSize={10}
            caption="Aktarım önizlemesi"
            searchKeys={searchKeys}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              onClick={() => void confirm()}
              disabled={blocked || nothingToWrite || busy}
              aria-busy={pending || undefined}
            >
              <Icon name="Check" size={17} aria-hidden="true" />
              {result.readyCount} {noun.toLocaleLowerCase('tr')} aktar
            </Button>
          </div>
        </section>
      ) : null}
      {reauthModal}
    </div>
  )
}
