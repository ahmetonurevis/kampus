// Toplu personel aktarımı penceresinin saf modeli (IST-007, DOM-YTK-070): dosya çözme, form
// şeması, önizleme satırları ve özet. Doğrulamanın kararı sunucudadır (`dryRun` önizlemesi); burada
// aynı core ayrıştırıcıyla satırlar tabloya dökülür ve sunucunun satır hataları satırlara eklenir.
import { z } from 'zod'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import { STAFF_ROLE_LABELS } from '@kampus/school-core/lib/staff-accounts.ts'
import {
  parseStaffImport,
  parseStaffRole,
  STAFF_IMPORT_MAX_CHARS,
  STAFF_IMPORT_SAMPLE,
  type StaffImportField,
  type StaffImportIssue,
} from '@kampus/school-core/lib/staff-import.ts'

/** Seçilen dosyanın sınırı: en uzun 1.000 satır bile bunun altında kalır. */
export const IMPORT_FILE_MAX_BYTES = 1024 * 1024
export const IMPORT_FILE_MESSAGE = 'En fazla 1 MB boyutunda CSV ya da TXT dosyası seçin.'
export const SAMPLE_FILENAME = 'personel-aktarim-ornegi.csv'

/** Excel'in Türkçe harfleri doğru açması için örnek dosya BOM'la başlar. */
export const SAMPLE_CSV = `\uFEFF${STAFF_IMPORT_SAMPLE}\n`

export function importFileProblem(file: { name: string; size: number }): string | null {
  if (file.size > IMPORT_FILE_MAX_BYTES) return IMPORT_FILE_MESSAGE
  return /\.(csv|txt)$/i.test(file.name) ? null : IMPORT_FILE_MESSAGE
}

/**
 * Dosyayı çözer: UTF-16 BOM'lu dosya (Excel'in "Unicode Metin" .txt kaydı, `FF FE` ile başlayan
 * UTF-16LE ve sekme ayraçlı) UTF-16 olarak; değilse önce katı UTF-8, olmazsa Windows-1254 (Excel'in
 * Türkçe yerelde "CSV" kaydı). UTF-8 dosya bozulmaz, eski kodlamadaki ş, ğ, ı doğru okunur. Sekme
 * ayracını core ayrıştırıcı tanır (`delimitedRecords`).
 */
export function decodeImportFile(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1254').decode(bytes)
  }
}

export const importFormSchema = z.object({
  csv: z
    .string()
    .refine((value) => value.trim() !== '', 'Dosya seçin ya da içeriği yapıştırın.')
    .refine(
      (value) => value.length <= STAFF_IMPORT_MAX_CHARS,
      'Dosya çok büyük. En çok 1.000 satır aktarılabilir.',
    ),
})
export type ImportFormValues = z.infer<typeof importFormSchema>

export const FIELD_LABELS: Readonly<Record<StaffImportField, string>> = {
  name: 'Ad',
  email: 'E-posta',
  role: 'Rol',
  subject: 'Branş',
  campus: 'Kampüs',
}

/** Hata maddesinin satırdaki metni: alan adıyla ("E-posta: …"), satırın bütünüyse yalnız ileti. */
export const issueText = (issue: StaffImportIssue): string =>
  issue.field === null ? issue.message : `${FIELD_LABELS[issue.field]}: ${issue.message}`

export type ImportPreviewRow = {
  id: string
  line: number
  name: string
  email: string
  roleLabel: string
  subject: string
  campus: string
  status: 'Hazır' | 'Hatalı'
  /** Satırın hataları, okunur metin; hatasızsa boş. */
  problems: string[]
  /** Hataların tek metni (arama, sıralama ve dar ekran kartı). */
  problemText: string
}

/**
 * Önizleme tablosu: CSV yerelde ayrıştırılır (sunucuyla aynı core ayrıştırıcı), sunucunun satır
 * hataları satır numarasıyla eklenir. Dosya düzeyindeki sorun `fileError`'dur (satır yok).
 */
export function importPreviewRows(
  csv: string,
  issues: readonly StaffImportIssue[],
): { rows: ImportPreviewRow[]; fileError: string | null } {
  let parsed: ReturnType<typeof parseStaffImport>
  try {
    parsed = parseStaffImport(csv)
  } catch (error) {
    if (error instanceof DomainError) return { rows: [], fileError: error.message }
    throw error
  }
  const byLine = new Map<number, string[]>()
  for (const issue of issues)
    byLine.set(issue.line, [...(byLine.get(issue.line) ?? []), issueText(issue)])
  return {
    rows: parsed.map((row) => {
      const role = parseStaffRole(row.role)
      const problems = byLine.get(row.line) ?? []
      return {
        id: String(row.line),
        line: row.line,
        name: row.name,
        email: row.email,
        roleLabel: role === null ? row.role : STAFF_ROLE_LABELS[role],
        subject: row.subject,
        campus: row.campus,
        status: problems.length > 0 ? 'Hatalı' : 'Hazır',
        problems,
        problemText: problems.join(' · '),
      }
    }),
    fileError: null,
  }
}

/** Önizleme özeti: satır sayısı ve hatalı satırlar ya da davet edilecek personel. */
export function importSummary(rowCount: number, issues: readonly StaffImportIssue[]): string {
  const failing = new Set(issues.map((issue) => issue.line)).size
  if (failing === 0) return `${rowCount} satır doğrulandı · ${rowCount} personel davet edilecek`
  return `${rowCount} satır · ${failing} satırda ${issues.length} hata · Hiçbir personel aktarılmadı`
}
