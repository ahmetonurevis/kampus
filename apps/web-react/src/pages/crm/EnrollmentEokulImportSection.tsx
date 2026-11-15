import { useId, useMemo, useState, type ChangeEvent } from 'react'
import type { ApiError } from '@kampus/api-client/errors.ts'
import type { EokulImportResult } from '@kampus/react-shared/enrollment-eokul-imports.ts'
import {
  importIssuesOf,
  isImportFileError,
  isImportRowsError,
  type ImportRowIssue,
} from '@kampus/react-shared/enrollment-imports.ts'
import { isReauthenticationRequired } from '@kampus/react-shared/reauthentication.ts'
import { useImportEokulStudents } from '@kampus/react-shared/use-enrollment-eokul-imports.ts'
import type { EokulField } from '@kampus/school-core/lib/enrollment-eokul-import.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { useReauthRetry } from '@/auth/use-reauth-retry.tsx'
import { DataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { exportCsv } from '@/lib/download.ts'
import { notify } from '@/lib/notify.ts'
import {
  defaultEokulSelection,
  EOKUL_ERROR_CSV_COLUMNS,
  EOKUL_FILE_ACCEPT,
  EOKUL_HELP,
  EOKUL_MAPPING_FIELDS,
  eokulErrorRows,
  eokulFileProblem,
  eokulStatusTone,
  eokulSuccess,
  eokulSummary,
  eokulTableRow,
  mappingBody,
  mappingValues,
  NOT_MAPPED,
  withEokulIssues,
  type EokulTableRow,
} from './enrollment-eokul-import-model.ts'
import { bytesToBase64 } from './enrollment-import-rows.ts'

// e-Okul öğrenci listesi aktarımı (IST-134, ON-062; DOM-KAY-042): dosya seç → sunucuda önizle
// (`dryRun`, yazmaz) → sütun eşlemesini düzelt ve yeniden önizle → yazılacak satırları seç → onayla.
// Onay aynı dosyayı ve seçilen satırları gönderir; sunucu kurum kilidi altında yeniden doğrular.
// İşlem taze oturum ister (`useReauthRetry`). Dosya içeriği yalnız bu bileşenin durumundadır.

const QUIET = {
  silent: (error: ApiError) =>
    isReauthenticationRequired(error) || isImportFileError(error) || isImportRowsError(error),
}

const ROLES = new Set(['yonetici', 'onburo'])

/** Kayıt İşlemleri → e-Okul listesinden aktarım; yalnız okulda, yönetici ve ön büroya çizilir. */
export function EnrollmentEokulImportSection() {
  const { session } = useAuth()
  const [open, setOpen] = useState(false)
  if (!session || !ROLES.has(session.role) || session.institution.type !== 'school') return null
  return (
    <section
      aria-labelledby="eokul-aktarim-baslik"
      className="mt-6 grid gap-3 rounded-xl border bg-surface-soft p-4 sm:flex sm:items-center sm:justify-between"
    >
      <div>
        <h2 id="eokul-aktarim-baslik" className="text-base font-semibold">
          e-Okul listesinden aktar
        </h2>
        <p className="text-sm text-muted-foreground">
          e-Okul öğrenci listesiyle yeni öğrencileri açın, mevcut öğrencilerin okul numarası, adı ve
          şubesini eşitleyin.
        </p>
      </div>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        <Icon name="Upload" size={16} aria-hidden="true" />
        e-Okul listesini aktar
      </Button>
      <Modal
        open={open}
        onOpenChange={(next) => (next ? undefined : setOpen(false))}
        title="e-Okul listesini aktar"
        description="Önce önizlenir; seçtiğiniz satırları onaylayana kadar hiçbir kayıt yazılmaz."
        size="wide"
      >
        {open ? <EokulImportForm onClose={() => setOpen(false)} /> : null}
      </Modal>
    </section>
  )
}

function EokulImportForm({ onClose }: { onClose: () => void }) {
  const importer = useImportEokulStudents()
  const { run, reauthModal } = useReauthRetry()
  const branches = useCoreAll('branches')
  const classes = useCoreAll('classes')
  const fileId = useId()
  const branchFieldId = useId()
  const classFieldId = useId()
  const mappingHeadingId = useId()
  const previewHeadingId = useId()
  const [fileBase64, setFileBase64] = useState<string | null>(null)
  const [fileError, setFileError] = useState('')
  const [reading, setReading] = useState(false)
  const [branchId, setBranchId] = useState('')
  const [fallbackClassId, setFallbackClassId] = useState('')
  const [mapping, setMapping] = useState<Record<EokulField, string> | null>(null)
  const [result, setResult] = useState<EokulImportResult | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set())
  const [lateIssues, setLateIssues] = useState<ImportRowIssue[]>([])

  const rows = useMemo(
    () => (result === null ? [] : withEokulIssues(result.rows.map(eokulTableRow), lateIssues)),
    [result, lateIssues],
  )
  const selectable = rows.filter((row) => row.selectable)
  const chosen = selectable.filter((row) => selected.has(row.line))
  const pending = importer.isPending
  const busy = pending || reading
  const mappingIssues = result?.mappingIssues ?? []
  const fieldError = (field: string) =>
    mappingIssues.find((issue) => issue.field === field)?.message ?? ''

  const activeBranches = (branches.data ?? []).filter((row) => row.record.isActive !== false)
  const activeClasses = (classes.data ?? []).filter(
    (row) => row.record.isActive !== false && (!branchId || row.record.branchId === branchId),
  )

  function reset() {
    setResult(null)
    setLateIssues([])
    setSelected(new Set())
  }

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    reset()
    setMapping(null)
    setFileBase64(null)
    if (!file) return
    const problem = eokulFileProblem(file)
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

  const body = (dryRun: boolean, lines?: number[]) => ({
    fileBase64: fileBase64 ?? '',
    dryRun,
    ...(mapping === null ? {} : { mapping: mappingBody(mapping) }),
    ...(branchId ? { branchId } : {}),
    ...(fallbackClassId ? { fallbackClassId } : {}),
    ...(lines === undefined ? {} : { lines }),
  })

  async function preview() {
    if (fileBase64 === null) {
      setFileError('Dosya seçin.')
      return
    }
    const outcome = await run(() => importer.submit(body(true), QUIET))
    if (outcome.status !== 'done') return
    const done = outcome.result
    if (done.status === 'success') {
      const data = done.data.data
      setLateIssues([])
      setResult(data)
      setMapping(mappingValues(data.mapping))
      setSelected(defaultEokulSelection(data.rows.map(eokulTableRow)))
      setFileError('')
    } else if (done.status === 'failed' && isImportFileError(done.error)) {
      reset()
      setFileError(done.error.message)
    }
  }

  async function confirm() {
    if (fileBase64 === null || chosen.length === 0) return
    const lines = chosen.map((row) => row.line)
    const outcome = await run(() => importer.submit(body(false, lines), QUIET))
    if (outcome.status !== 'done') return
    const done = outcome.result
    if (done.status === 'success') {
      notify.success(eokulSuccess(done.data.data))
      onClose()
      return
    }
    if (done.status !== 'failed') return
    const issues = importIssuesOf(done.error)
    if (issues) {
      setLateIssues(issues)
      const failed = new Set(issues.map((issue) => issue.line))
      setSelected((current) => new Set([...current].filter((line) => !failed.has(line))))
    } else if (isImportFileError(done.error)) {
      reset()
      setFileError(done.error.message)
    }
  }

  function toggle(line: number, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(line)
      else next.delete(line)
      return next
    })
  }

  const columns: DataColumn<EokulTableRow>[] = [
    {
      key: 'select',
      label: 'Seç',
      cell: (row) =>
        row.selectable ? (
          <Checkbox
            checked={selected.has(row.line)}
            onCheckedChange={(checked) => toggle(row.line, checked === true)}
            aria-label={`${row.line}. satırı seç`}
            className="size-5"
          />
        ) : (
          '—'
        ),
    },
    { key: 'line', label: 'Satır' },
    {
      key: 'status',
      label: 'Durum',
      cell: (row) => <StatusBadge text={row.status} tone={eokulStatusTone(row.status)} />,
    },
    { key: 'schoolNumber', label: 'Okul no' },
    { key: 'name', label: 'Ad soyad' },
    { key: 'classLabel', label: 'Sınıf' },
    { key: 'identity', label: 'Kimlik' },
    {
      key: 'noteText',
      label: 'Değişiklik, sorun ve bilgi',
      cell: (row) =>
        row.problems.length + row.notes.length === 0 && !row.changeText ? (
          '—'
        ) : (
          <ul className="grid gap-0.5 text-sm">
            {row.changeText ? <li>{row.changeText}</li> : null}
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
    },
  ]

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <form
        noValidate
        aria-label="e-Okul aktarım formu"
        onSubmit={(event) => {
          event.preventDefault()
          void preview()
        }}
        className="grid gap-4"
      >
        <p className="text-sm text-muted-foreground">
          {EOKUL_HELP} Bilinmeyen sınıf ve şube hatadır; sınıflar açılmaz. Yeni öğrenci için kimlik,
          doğum tarihi, veli adı ve telefonu gerekir. Düzey değişikliği Kayıt Yenileme ile yapılır.
        </p>
        <FormField
          id={fileId}
          label="e-Okul öğrenci listesi"
          error={fileError ? { message: fileError } : undefined}
          description="En fazla 5 MB; CSV ya da Excel (.xlsx, ilk sayfa). Eski .xls dosyasını Excel'de .xlsx olarak kaydedin. Dosya saklanmaz."
        >
          {(control) => (
            <Input
              {...control}
              type="file"
              accept={EOKUL_FILE_ACCEPT}
              disabled={pending}
              onChange={(event) => void readFile(event)}
            />
          )}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id={branchFieldId}
            label="Kampüs (isteğe bağlı)"
            error={fieldError('branchId') ? { message: fieldError('branchId') } : undefined}
            description="Aynı adlı sınıf birden çok kampüsteyse seçin."
          >
            {(control) => (
              <NativeSelect
                {...control}
                className="w-full"
                value={branchId}
                onChange={(event) => {
                  setBranchId(event.currentTarget.value)
                  setFallbackClassId('')
                }}
              >
                <NativeSelectOption value="">Bütün kampüsler</NativeSelectOption>
                {activeBranches.map((row) => (
                  <NativeSelectOption key={row.id} value={row.id}>
                    {row.record.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField
            id={classFieldId}
            label="Sınıf sütunu yoksa sınıf"
            error={
              fieldError('fallbackClassId') ? { message: fieldError('fallbackClassId') } : undefined
            }
            description="Tek sınıfın listesinde bütün satırlar bu sınıfa yazılır."
          >
            {(control) => (
              <NativeSelect
                {...control}
                className="w-full"
                value={fallbackClassId}
                onChange={(event) => setFallbackClassId(event.currentTarget.value)}
              >
                <NativeSelectOption value="">Dosyadaki sınıf</NativeSelectOption>
                {activeClasses.map((row) => (
                  <NativeSelectOption key={row.id} value={row.id}>
                    {row.record.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        </div>

        {result !== null && mapping !== null ? (
          <fieldset aria-labelledby={mappingHeadingId} className="grid gap-3 border-t pt-4">
            <legend id={mappingHeadingId} className="text-base font-semibold">
              Sütun eşleme
            </legend>
            <p className="text-sm text-muted-foreground">
              Başlık dosyanın {result.headerLine}. satırında bulundu. Önerilen eşlemeyi kontrol
              edin; değiştirirseniz yeniden önizleyin.
            </p>
            {mappingIssues.length > 0 ? (
              <p role="alert" className="text-sm text-destructive">
                Eşlemede düzeltilmesi gereken sorun var; düzeltip yeniden önizleyin.
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {EOKUL_MAPPING_FIELDS.map(({ field, label }) => (
                <MappingSelect
                  key={field}
                  label={label}
                  value={mapping[field]}
                  headers={result.headers}
                  error={fieldError(field)}
                  onChange={(value) => setMapping({ ...mapping, [field]: value })}
                />
              ))}
            </div>
          </fieldset>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Vazgeç
          </Button>
          <Button type="submit" variant="secondary" disabled={busy} aria-busy={busy || undefined}>
            <Icon name="Eye" size={16} aria-hidden="true" />
            {result === null ? 'Önizle' : 'Yeniden önizle'}
          </Button>
        </div>
      </form>

      {result !== null && mappingIssues.length === 0 ? (
        <section
          aria-labelledby={previewHeadingId}
          className="grid grid-cols-[minmax(0,1fr)] gap-3 border-t pt-4"
        >
          <h3 id={previewHeadingId} className="text-base font-semibold">
            Aktarım önizlemesi
          </h3>
          <p role="status" className="text-sm text-muted-foreground">
            {eokulSummary(result)} · {chosen.length} satır seçili
          </p>
          {lateIssues.length > 0 ? (
            <div role="alert" className="rounded-md border border-destructive p-3 text-sm">
              Önizlemeden sonra kurumda değişiklik oldu ya da seçilen satırlarda sorun var. Hiçbir
              kayıt yazılmadı; sorunlu satırların seçimi kaldırıldı.
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSelected(new Set(selectable.map((row) => row.line)))}
              disabled={selectable.length === 0}
            >
              Tümünü seç
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSelected(new Set())}
              disabled={chosen.length === 0}
            >
              Seçimi kaldır
            </Button>
            {rows.some((row) => row.status === 'Hatalı') ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  exportCsv('e-okul-hatali-satirlar', EOKUL_ERROR_CSV_COLUMNS, eokulErrorRows(rows))
                }
              >
                <Icon name="Download" size={16} aria-hidden="true" />
                Hatalı satırları indir (CSV)
              </Button>
            ) : null}
          </div>
          <DataTable
            listKey="eokul-aktarim"
            rows={rows}
            columns={columns}
            mobileColumns={['select', 'line', 'name', 'status']}
            pageSize={20}
            caption="e-Okul aktarım önizlemesi"
            searchKeys={['name', 'schoolNumber', 'noteText']}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              onClick={() => void confirm()}
              disabled={chosen.length === 0 || busy}
              aria-busy={pending || undefined}
            >
              <Icon name="Check" size={17} aria-hidden="true" />
              {chosen.length} satırı aktar
            </Button>
          </div>
        </section>
      ) : null}
      {reauthModal}
    </div>
  )
}

function MappingSelect({
  label,
  value,
  headers,
  error,
  onChange,
}: {
  label: string
  value: string
  headers: readonly { index: number; label: string }[]
  error: string
  onChange: (value: string) => void
}) {
  const id = useId()
  return (
    <FormField id={id} label={label} error={error ? { message: error } : undefined}>
      {(control) => (
        <NativeSelect
          {...control}
          className="w-full"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          <NativeSelectOption value={NOT_MAPPED}>Eşlenmedi</NativeSelectOption>
          {headers.map((header) => (
            <NativeSelectOption key={header.index} value={String(header.index)}>
              {header.label || `${header.index + 1}. sütun (başlıksız)`}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}
    </FormField>
  )
}
