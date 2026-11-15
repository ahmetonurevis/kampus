// e-Okul öğrenci listesi aktarımı penceresinin saf modeli (IST-134, ON-062; DOM-KAY-042): dosya
// denetimi, eşleme seçenekleri, önizleme satırları, varsayılan seçim, özet ve hatalı satır CSV'si.
// Doğrulamanın kararı sunucudadır (`dryRun`); dosya sunucuda ayrıştırılır. CSV'deki kimlik maskelidir:
// tam kimlik tarayıcıya hiç gelmez.
import type { ImportRowIssue } from '@kampus/react-shared/enrollment-imports.ts'
import type {
  EokulImportResult,
  EokulImportRowResult,
} from '@kampus/react-shared/enrollment-eokul-imports.ts'
import {
  EOKUL_FIELD_LABELS,
  EOKUL_FIELDS,
  EOKUL_IMPORT_MAX_ROWS,
  type EokulField,
  type EokulMapping,
} from '@kampus/school-core/lib/enrollment-eokul-import.ts'
import { IMPORT_FILE_MAX_BYTES } from '@kampus/school-core/lib/enrollment-import-cells.ts'
import type { ListColumn } from '@/lib/list-view.ts'

export const EOKUL_FILE_ACCEPT =
  '.csv,.txt,.xlsx,.xls,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel'
export const EOKUL_FILE_MESSAGE = 'En fazla 5 MB boyutunda CSV ya da Excel (.xlsx) dosyası seçin.'
export const EOKUL_LEGACY_MESSAGE =
  'e-Okul\'dan inen eski Excel (.xls) dosyası okunmuyor. Dosyayı Excel\'de açıp "Farklı kaydet" ile .xlsx ya da CSV olarak kaydedin.'

export function eokulFileProblem(file: { name: string; size: number }): string | null {
  if (/\.xls$/i.test(file.name)) return EOKUL_LEGACY_MESSAGE
  if (file.size === 0 || file.size > IMPORT_FILE_MAX_BYTES) return EOKUL_FILE_MESSAGE
  return /\.(csv|txt|xlsx)$/i.test(file.name) ? null : EOKUL_FILE_MESSAGE
}

export const EOKUL_HELP = `e-Okul'dan indirdiğiniz öğrenci listesini yükleyin; başlık satırı ilk 20 satırda aranır, sütunlar başlık adlarından eşlenir ve düzeltilebilir. En çok ${EOKUL_IMPORT_MAX_ROWS.toLocaleString('tr-TR')} satır.`

export type EokulStatusLabel = 'Yeni' | 'Güncellenecek' | 'Değişiklik yok' | 'Hatalı'
const STATUS_LABELS = {
  new: 'Yeni',
  update: 'Güncellenecek',
  unchanged: 'Değişiklik yok',
  invalid: 'Hatalı',
} as const satisfies Record<EokulImportRowResult['status'], EokulStatusLabel>

export const eokulStatusTone = (status: EokulStatusLabel) =>
  status === 'Yeni'
    ? 'green'
    : status === 'Güncellenecek'
      ? 'amber'
      : status === 'Hatalı'
        ? 'red'
        : 'gray'

const CHANGE_LABELS = {
  name: 'Ad soyad',
  schoolNumber: 'Okul no',
  class: 'Sınıf',
} as const

export function eokulChangeText(change: EokulImportRowResult['changes'][number]): string {
  if (change.field === 'identity') return 'Kimlik eklenecek'
  return `${CHANGE_LABELS[change.field]}: ${change.before ?? '—'} → ${change.after ?? '—'}`
}

export type EokulTableRow = {
  id: string
  line: number
  status: EokulStatusLabel
  schoolNumber: string
  name: string
  classLabel: string
  identity: string
  changeText: string
  problems: string[]
  notes: string[]
  /** Sorun, bilgi ve değişikliklerin tek metni (arama ve dar ekran kartı). */
  noteText: string
  /** Yazılacak bir şey var ve hatasız: seçilebilir. */
  selectable: boolean
}

export function eokulTableRow(row: EokulImportRowResult): EokulTableRow {
  const problems = row.issues.map((issue) => issue.message)
  const notes = row.notices.map((notice) => notice.message)
  const changes = row.changes.map(eokulChangeText)
  return {
    id: String(row.line),
    line: row.line,
    status: STATUS_LABELS[row.status],
    schoolNumber: row.schoolNumber,
    name: row.name,
    classLabel:
      row.classLabel && row.classLabel !== row.className
        ? `${row.className} → ${row.classLabel}`
        : row.className,
    identity: row.identityMasked,
    changeText: changes.join(' · '),
    problems,
    notes,
    noteText: [...problems, ...notes, ...changes].join(' · '),
    selectable: row.status === 'new' || row.status === 'update',
  }
}

/** Onayın satır hataları (önizlemeden sonra değişen kurum) satırlara yazılır, satır seçilemez. */
export function withEokulIssues(
  rows: readonly EokulTableRow[],
  issues: readonly ImportRowIssue[],
): EokulTableRow[] {
  const byLine = new Map<number, string[]>()
  for (const issue of issues)
    byLine.set(issue.line, [...(byLine.get(issue.line) ?? []), issue.message])
  return rows.map((row) => {
    const problems = byLine.get(row.line)
    return problems === undefined
      ? row
      : {
          ...row,
          status: 'Hatalı' as const,
          problems,
          noteText: [...problems, ...row.notes].join(' · '),
          selectable: false,
        }
  })
}

/** Varsayılan seçim: yeni ve güncellenecek bütün satırlar. */
export const defaultEokulSelection = (rows: readonly EokulTableRow[]) =>
  new Set(rows.filter((row) => row.selectable).map((row) => row.line))

export function eokulSummary(result: EokulImportResult): string {
  const parts = [`${result.rowCount} öğrenci satırı`]
  if (result.newCount > 0) parts.push(`${result.newCount} yeni`)
  if (result.updateCount > 0) parts.push(`${result.updateCount} güncellenecek`)
  if (result.unchangedCount > 0) parts.push(`${result.unchangedCount} değişiklik yok`)
  if (result.invalidCount > 0) parts.push(`${result.invalidCount} hatalı`)
  return parts.join(' · ')
}

export const eokulSuccess = (result: EokulImportResult) =>
  `${result.newCount} yeni öğrenci açıldı, ${result.updateCount} öğrenci güncellendi.`

/** Eşleme seçenekleri: her alan için "Eşlenmedi" ve başlıktaki sütunlar. */
export const EOKUL_MAPPING_FIELDS = EOKUL_FIELDS.map((field) => ({
  field,
  label: EOKUL_FIELD_LABELS[field],
}))

export const NOT_MAPPED = ''

/** Yanıtın eşlemesi → form değerleri (sütun sırası metin; eşlenmemiş boş). */
export function mappingValues(mapping: EokulImportResult['mapping']): Record<EokulField, string> {
  return Object.fromEntries(
    EOKUL_FIELDS.map((field) => {
      const value = mapping[field]
      return [field, typeof value === 'number' ? String(value) : NOT_MAPPED]
    }),
  ) as Record<EokulField, string>
}

/** Form değerleri → gövde eşlemesi. */
export function mappingBody(values: Readonly<Record<EokulField, string>>): EokulMapping {
  return Object.fromEntries(
    EOKUL_FIELDS.map((field) => [
      field,
      values[field] === NOT_MAPPED ? null : Number(values[field]),
    ]),
  ) as EokulMapping
}

export const EOKUL_ERROR_CSV_COLUMNS: readonly ListColumn[] = [
  { key: 'line', label: 'Satır' },
  { key: 'schoolNumber', label: 'Okul no' },
  { key: 'name', label: 'Ad soyad' },
  { key: 'classLabel', label: 'Sınıf' },
  { key: 'identity', label: 'Kimlik (maskeli)' },
  { key: 'problems', label: 'Sorunlar' },
]

/** Hatalı satırların CSV'si: dosyadaki satır, maskeli kimlik ve sorunlar. */
export function eokulErrorRows(rows: readonly EokulTableRow[]) {
  return rows
    .filter((row) => row.status === 'Hatalı')
    .map((row) => ({
      line: row.line,
      schoolNumber: row.schoolNumber,
      name: row.name,
      classLabel: row.classLabel,
      identity: row.identity,
      problems: row.problems.join(' · '),
    }))
}
