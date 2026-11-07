import { zodResolver } from '@hookform/resolvers/zod'
import { useId, useMemo, useState, type ChangeEvent } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { isReauthenticationRequired } from '@kampus/react-shared/reauthentication.ts'
import { isStaffImportFileError, staffImportIssuesOf } from '@kampus/react-shared/staff-accounts.ts'
import { useImportStaff } from '@kampus/react-shared/use-staff-accounts.ts'
import type { StaffImportIssue } from '@kampus/school-core/lib/staff-import.ts'
import { useReauthRetry } from '@/auth/use-reauth-retry.tsx'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { saveBlob } from '@/lib/download.ts'
import { notify } from '@/lib/notify.ts'
import {
  decodeImportFile,
  importFileProblem,
  importFormSchema,
  importPreviewRows,
  importSummary,
  SAMPLE_CSV,
  SAMPLE_FILENAME,
  type ImportFormValues,
  type ImportPreviewRow,
} from './staff-import-rows.ts'

// Toplu personel aktarımı (IST-007, DOM-YTK-070): dosya seç ya da yapıştır → sunucuda önizle
// (`dryRun`, hiçbir şey yazmaz) → satır hataları tabloda → hatasızsa onayla. Onay aynı içeriği
// gönderir; sunucu kurum kilidi altında yeniden doğrular, arada değişen kurum 422 satır
// hatalarıyla döner ve tabloya yazılır. İşlemler taze oturum ister (`useReauthRetry`).

const QUIET = {
  silent: (error: Parameters<typeof isStaffImportFileError>[0]) =>
    isReauthenticationRequired(error) || isStaffImportFileError(error),
}

type Preview = { csv: string; rowCount: number; issues: StaffImportIssue[]; stale: boolean }

const COLUMNS: DataColumn<ImportPreviewRow>[] = [
  { key: 'line', label: 'Satır' },
  { key: 'name', label: 'Ad soyad' },
  { key: 'email', label: 'E-posta' },
  { key: 'roleLabel', label: 'Rol' },
  { key: 'subject', label: 'Branş' },
  { key: 'campus', label: 'Kampüs' },
  {
    key: 'status',
    label: 'Durum',
    cell: (row) => (
      <StatusBadge text={row.status} tone={row.status === 'Hazır' ? 'green' : 'red'} />
    ),
  },
  {
    key: 'problemText',
    label: 'Hatalar',
    cell: (row) =>
      row.problems.length === 0 ? (
        '—'
      ) : (
        <ul className="grid gap-0.5 text-sm text-destructive">
          {row.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ),
  },
]
const MOBILE_COLUMNS = ['line', 'email', 'status']

export function StaffImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Personeli toplu aktar"
      description="Yönetici, öğretmen ve ön büro hesaplarını CSV dosyasıyla tek seferde davet edin."
      size="wide"
    >
      {open ? <StaffImportForm onClose={onClose} /> : null}
    </Modal>
  )
}

function StaffImportForm({ onClose }: { onClose: () => void }) {
  const importer = useImportStaff()
  const { run, reauthModal } = useReauthRetry()
  const form = useForm<ImportFormValues, unknown, ImportFormValues>({
    resolver: zodResolver(importFormSchema),
    defaultValues: { csv: '' },
  })
  const csv = useWatch({ control: form.control, name: 'csv' })
  const [preview, setPreview] = useState<Preview | null>(null)
  const [fileError, setFileError] = useState('')
  const [reading, setReading] = useState(false)
  const fileId = useId()
  const textId = useId()
  // İçerik önizlemeden sonra değiştiyse önizleme geçersizdir; yeniden önizlemek gerekir.
  const current = preview !== null && preview.csv === csv ? preview : null
  const table = useMemo(
    () => (current ? importPreviewRows(current.csv, current.issues) : null),
    [current],
  )
  const busy = importer.isPending || form.formState.isSubmitting || reading

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    const problem = importFileProblem(file)
    if (problem) {
      setFileError(problem)
      input.value = ''
      return
    }
    setFileError('')
    setReading(true)
    try {
      const text = decodeImportFile(new Uint8Array(await file.arrayBuffer()))
      form.setValue('csv', text, { shouldValidate: true, shouldDirty: true })
    } catch (error) {
      notify.error('Dosya okunamadı. Başka bir dosya seçip yeniden deneyin.', error)
    } finally {
      setReading(false)
      input.value = ''
    }
  }

  const onPreview = form.handleSubmit(async (values) => {
    const outcome = await run(() => importer.submit({ csv: values.csv, dryRun: true }, QUIET))
    if (outcome.status !== 'done') return
    const result = outcome.result
    if (result.status === 'success') {
      const data = result.data.data
      setPreview({ csv: values.csv, rowCount: data.rowCount, issues: data.issues, stale: false })
    } else if (result.status === 'failed' && isStaffImportFileError(result.error)) {
      setPreview(null)
      form.setError('csv', { type: 'server', message: result.error.message }, { shouldFocus: true })
    }
  })

  async function confirm() {
    if (!current || current.issues.length > 0) return
    const outcome = await run(() => importer.submit({ csv: current.csv, dryRun: false }, QUIET))
    if (outcome.status !== 'done') return
    const result = outcome.result
    if (result.status === 'success') {
      // Bildirim davetlerin hepsi için aynıdır (karar 73): başka kurumda hesabı olan e-posta
      // ayırt edilmez.
      notify.success(`${result.data.data.invitedCount} personel davet edildi.`)
      onClose()
      return
    }
    if (result.status !== 'failed') return
    const issues = staffImportIssuesOf(result.error)
    if (issues) setPreview({ ...current, issues, stale: true })
    else if (isStaffImportFileError(result.error))
      form.setError('csv', { type: 'server', message: result.error.message }, { shouldFocus: true })
  }

  const issues = current?.issues ?? []
  const ready =
    current !== null && table !== null && table.fileError === null && issues.length === 0

  return (
    <div className="grid gap-5">
      <form
        noValidate
        aria-label="Personel aktarım dosyası"
        onSubmit={(event) => void onPreview(event)}
        className="grid gap-4"
      >
        <p className="text-sm text-muted-foreground">
          Başlık satırı zorunludur: <code>ad</code>, <code>e-posta</code>, <code>rol</code>{' '}
          (Yönetici, Öğretmen ya da Ön büro); öğretmen satırında isteğe bağlı <code>branş</code> ve{' '}
          <code>kampüs</code> kadrodaki öğretmen kaydını eşleştirir. En çok 1.000 satır; bütün
          satırlar doğrulanmadan hiçbir personel aktarılmaz. Davet edilenlere parola belirleme
          bağlantısı gider.
        </p>
        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              saveBlob(new Blob([SAMPLE_CSV], { type: 'text/csv;charset=utf-8' }), SAMPLE_FILENAME)
            }
          >
            <Icon name="Download" size={16} aria-hidden="true" />
            Örnek CSV'yi indir
          </Button>
        </div>
        <FormField
          id={fileId}
          label="CSV dosyası"
          error={fileError ? { message: fileError } : undefined}
          description="En fazla 1 MB; CSV ya da TXT. UTF-8 ve Windows-1254 kodlamaları otomatik algılanır."
        >
          {(control) => (
            <Input
              {...control}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              disabled={busy}
              onChange={(event) => void readFile(event)}
            />
          )}
        </FormField>
        <FormField
          id={textId}
          label="Dosya içeriği"
          error={form.formState.errors.csv}
          description="Dosya seçince içerik buraya gelir; düzeltmeyi burada yapıp yeniden önizleyebilirsiniz."
        >
          {(control) => (
            <Textarea
              {...control}
              {...form.register('csv')}
              rows={7}
              className="font-mono text-sm"
              spellCheck={false}
              disabled={importer.isPending}
            />
          )}
        </FormField>
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

      {current && table ? (
        <section aria-labelledby="aktarim-onizleme" className="grid gap-3 border-t pt-4">
          <h3 id="aktarim-onizleme" className="text-base font-semibold">
            Aktarım önizlemesi
          </h3>
          <p role="status" className="text-sm text-muted-foreground">
            {importSummary(current.rowCount, issues)}
          </p>
          {issues.length > 0 ? (
            <div role="alert" className="rounded-md border border-destructive p-3 text-sm">
              {current.stale
                ? 'Önizlemeden sonra kurumda değişiklik oldu. Hiçbir personel aktarılmadı; hatalı satırları düzeltip yeniden önizleyin.'
                : 'Dosyada hatalı satırlar var. Hatalı satırları düzeltip yeniden önizleyin; hiçbir personel aktarılmadı.'}
            </div>
          ) : null}
          <DataTable
            listKey="personel-aktarim"
            rows={table.rows}
            columns={COLUMNS}
            mobileColumns={MOBILE_COLUMNS}
            pageSize={10}
            caption="Aktarım önizlemesi"
            searchKeys={['email', 'name', 'problemText']}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              onClick={() => void confirm()}
              disabled={!ready || busy}
              aria-busy={importer.isPending || undefined}
            >
              <Icon name="Check" size={17} aria-hidden="true" />
              {current.rowCount} personeli aktar
            </Button>
          </div>
        </section>
      ) : null}
      {reauthModal}
    </div>
  )
}
