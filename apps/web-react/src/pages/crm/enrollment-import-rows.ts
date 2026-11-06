// Pilot verisi aktarımı penceresinin saf modeli (IST-007, ON-060, ON-061): dosya denetimi, base64,
// önizleme satırları ve özet. Doğrulamanın kararı sunucudadır (`dryRun`); Excel ve CSV sunucuda
// ayrıştırılır, tarayıcıya ayrıştırıcı girmez. Dosya bellekte yalnız pencere açıkken tutulur.
import type {
  ImportRowIssue,
  InstallmentImportResult,
  InstallmentImportRowResult,
  StudentImportResult,
  StudentImportRowResult,
} from '@kampus/react-shared/enrollment-imports.ts'
import {
  GUARDIAN_RELATIONSHIP_LABELS,
  type GuardianRelationship,
} from '@kampus/school-core/lib/enrollment.ts'
import { STUDENT_IMPORT_SAMPLE } from '@kampus/school-core/lib/enrollment-import.ts'
import {
  IMPORT_FILE_MAX_BYTES,
  IMPORT_FILE_MESSAGE,
} from '@kampus/school-core/lib/enrollment-import-cells.ts'
import { INSTALLMENT_IMPORT_SAMPLE } from '@kampus/school-core/lib/finance-installment-import.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'

/** Excel'in Türkçe harfleri doğru açması için örnek dosya BOM'la başlar. */
export const STUDENT_SAMPLE_CSV = `\uFEFF${STUDENT_IMPORT_SAMPLE}\n`
export const STUDENT_SAMPLE_FILENAME = 'ogrenci-veli-aktarim-ornegi.csv'
export const INSTALLMENT_SAMPLE_CSV = `\uFEFF${INSTALLMENT_IMPORT_SAMPLE}\n`
export const INSTALLMENT_SAMPLE_FILENAME = 'taksit-aktarim-ornegi.csv'

export function importFileProblem(file: { name: string; size: number }): string | null {
  if (file.size === 0 || file.size > IMPORT_FILE_MAX_BYTES) return IMPORT_FILE_MESSAGE
  return /\.(csv|txt|xlsx)$/i.test(file.name) ? null : IMPORT_FILE_MESSAGE
}

/** Dosya baytları → base64; büyük dizide yığın taşmasın diye parça parça. */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let start = 0; start < bytes.length; start += CHUNK)
    binary += String.fromCharCode(...bytes.subarray(start, start + CHUNK))
  return btoa(binary)
}

export type ImportStatusLabel = 'Hazır' | 'Atlanacak' | 'Hatalı'
const STATUS_LABELS = { ready: 'Hazır', skipped: 'Atlanacak', invalid: 'Hatalı' } as const

export const statusTone = (status: ImportStatusLabel) =>
  status === 'Hazır' ? 'green' : status === 'Hatalı' ? 'red' : 'gray'

type BaseRow = {
  id: string
  line: number
  status: ImportStatusLabel
  problems: string[]
  notes: string[]
  /** Sorun ve bilgilerin tek metni (arama ve dar ekran kartı). */
  noteText: string
}

function base(row: {
  line: number
  status: 'ready' | 'skipped' | 'invalid'
  issues: readonly { message: string }[]
  notices: readonly { message: string }[]
}): BaseRow {
  const problems = row.issues.map((issue) => issue.message)
  const notes = row.notices.map((notice) => notice.message)
  return {
    id: String(row.line),
    line: row.line,
    status: STATUS_LABELS[row.status],
    problems,
    notes,
    noteText: [...problems, ...notes].join(' · '),
  }
}

export type StudentImportTableRow = BaseRow & {
  name: string
  classLabel: string
  identity: string
  guardian: string
  guardianPhone: string
  relationshipLabel: string
}

export function studentImportRow(row: StudentImportRowResult): StudentImportTableRow {
  return {
    ...base(row),
    name: row.name,
    classLabel: row.campus ? `${row.className} · ${row.campus}` : row.className,
    identity: row.identityMasked,
    guardian: row.guardianMatch === 'self' ? 'Kursiyerin kendisi' : row.guardianName,
    guardianPhone: row.guardianPhoneMasked,
    relationshipLabel:
      row.relationship === null
        ? ''
        : GUARDIAN_RELATIONSHIP_LABELS[row.relationship satisfies GuardianRelationship],
  }
}

export type InstallmentImportTableRow = BaseRow & {
  student: string
  identity: string
  installment: string
  amount: string
  due: string
  paid: string
  contract: string
}

export function installmentImportRow(row: InstallmentImportRowResult): InstallmentImportTableRow {
  return {
    ...base(row),
    student: row.studentName ?? '',
    identity: row.identityMasked,
    installment: row.installment === null ? '' : String(row.installment),
    amount: row.amountCents === null ? '' : money(row.amountCents),
    due: row.dueDate === null ? '' : dateLabel(`${row.dueDate}T09:00:00.000Z`),
    paid:
      row.paidDate === null
        ? 'Açık'
        : `${dateLabel(`${row.paidDate}T09:00:00.000Z`)} · ${row.method ?? ''}`,
    contract: row.status === 'ready' ? (row.contractLinked ? 'Bağlanacak' : 'Sözleşmesiz') : '',
  }
}

/** Onayın satır hataları (önizlemeden sonra değişen kurum) satırlara yazılır. */
export function withRowIssues<T extends BaseRow>(
  rows: readonly T[],
  issues: readonly ImportRowIssue[],
): T[] {
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
        }
  })
}

type Counts = Pick<StudentImportResult, 'rowCount' | 'readyCount' | 'skippedCount' | 'invalidCount'>

function countSummary(counts: Counts, ready: string): string {
  const parts = [`${counts.rowCount} satır`]
  if (counts.invalidCount > 0) parts.push(`${counts.invalidCount} hatalı`)
  parts.push(`${counts.readyCount} ${ready}`)
  if (counts.skippedCount > 0) parts.push(`${counts.skippedCount} zaten kayıtlı, atlanacak`)
  return parts.join(' · ')
}

export function studentImportSummary(result: StudentImportResult): string {
  const guardians =
    result.invalidCount > 0
      ? ''
      : ` · ${result.newGuardianCount} yeni veli, ${result.existingGuardianCount} mevcut veli`
  return `${countSummary(result, 'öğrenci yazılacak')}${guardians}`
}

export function installmentImportSummary(result: InstallmentImportResult): string {
  const totals =
    result.invalidCount > 0
      ? ''
      : ` · toplam ${money(result.totalCents)}, ödenmiş ${money(result.paidCents)} (açılış aktarımı), ${result.linkedCount} taksit sözleşmeye bağlanacak`
  return `${countSummary(result, 'taksit yazılacak')}${totals}`
}
