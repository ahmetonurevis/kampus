import { z } from 'zod'

import type { State } from '../data/seed.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import { delimitedRecords, foldHeader } from './delimited-input.ts'
import type { MakeId } from './domain.ts'
import { GUARDIAN_RELATIONSHIP_LABELS, isValidTurkishId, type ParentBond } from './enrollment.ts'
import {
  applyStudentImport,
  classOccupancy,
  planStudentImport,
  type AppliedStudent,
  type GuardianMatch,
  type PlannedStudent,
  type StudentImportRow,
  type StudentImportState,
} from './enrollment-import.ts'
import {
  importFileInputSchema,
  normalizeImportIdentity,
  parseImportDay,
  type ImportIssue,
  type ImportNotice,
} from './enrollment-import-cells.ts'
import { DomainError } from './errors.ts'
import { maskPhone } from './parent-contact.ts'
import { maskNationalId } from './scope.ts'

/**
 * e-Okul öğrenci listesinden içe aktarım (IST-134, ON-062; docs/domain/kayit-ve-crm.md DOM-KAY-042).
 * Okul e-Okul'dan indirdiği öğrenci listesini yükler; sütunlar başlık adlarından önerilen ve
 * kullanıcının düzelttiği eşlemeyle okunur. Her satır kurumdaki öğrenciyle T.C. kimlik no, yoksa okul
 * numarasıyla eşleşir ve "yeni / güncellenecek / değişiklik yok / hatalı" diye sınıflanır. Yeni
 * öğrenci pilot aktarımının kuralıyla açılır (`planStudentImport`: kimlik, veli, kontenjan, kardeş;
 * DOM-KAY-010, -012, -013, -036). Mevcut öğrencide yalnız ad soyad, okul numarası, aynı düzeyde şube
 * ve eksik kimlik yazılır; düzey değişikliği Kayıt Yenileme'nin işidir (DOM-KAY-020). Sınıf ve şube
 * açılmaz: bilinmeyen sınıf hatadır. Saf fonksiyonlardır; API kurum kilidi altında okuduğu bağlamı
 * verir. Sorun iletileri hücre değeri taşımaz.
 *
 * Biçim varsayımı (K-276, **doğrulanmalı**): e-Okul "Öğrenci Listesi" dışa aktarımı; başlıktan önce
 * okul adı ve rapor başlığı satırları olabilir, başlık ilk 20 satırda aranır. Sınıf "9. Sınıf / A
 * Şubesi", "9/A", "9-A" biçimlerinde ya da ayrı "Sınıf" ve "Şube" sütunlarında gelebilir.
 */

export const EOKUL_IMPORT_MAX_ROWS = 3000
/** Başlık satırının aranacağı ilk satır sayısı (okul adı ve rapor başlığı satırları için). */
export const EOKUL_HEADER_SCAN_ROWS = 20

export const EOKUL_FIELDS = [
  'schoolNumber',
  'identityNumber',
  'fullName',
  'firstName',
  'lastName',
  'className',
  'grade',
  'section',
  'birthDate',
  'guardianName',
  'guardianPhone',
  'relationship',
] as const
export type EokulField = (typeof EOKUL_FIELDS)[number]

export const EOKUL_FIELD_LABELS: Readonly<Record<EokulField, string>> = {
  schoolNumber: 'Okul no',
  identityNumber: 'T.C. kimlik no',
  fullName: 'Ad soyad (tek sütun)',
  firstName: 'Ad',
  lastName: 'Soyad',
  className: 'Sınıf/şube (tek sütun)',
  grade: 'Sınıf düzeyi',
  section: 'Şube',
  birthDate: 'Doğum tarihi',
  guardianName: 'Veli adı soyadı',
  guardianPhone: 'Veli telefonu',
  relationship: 'Yakınlık',
}

/**
 * Otomatik eşleme önerisinin başlık adları; nokta, eğik çizgi ve parantez atılarak katlanmış
 * karşılaştırılır ("T.C. Kimlik No" = "TC Kimlik No"). Cinsiyet, anne/baba adı ve doğum yeri
 * bilerek yoktur: aktarım bunları almaz (K-278, KVKK ölçülülük).
 */
const EOKUL_ALIASES: Readonly<Record<EokulField, readonly string[]>> = {
  schoolNumber: [
    'okul no',
    'okul numarası',
    'öğrenci no',
    'öğrenci numarası',
    'öğr no',
    'no',
    'numara',
    'numarası',
  ],
  identityNumber: [
    't.c. kimlik no',
    't.c. kimlik numarası',
    'tc kimlik no',
    'kimlik no',
    'kimlik numarası',
    'tckn',
    'tc no',
    't.c. no',
    'tc',
  ],
  fullName: [
    'adı soyadı',
    'ad soyad',
    'adı ve soyadı',
    'ad ve soyad',
    'öğrenci adı soyadı',
    'öğrencinin adı soyadı',
    'öğrenci ad soyad',
  ],
  firstName: ['adı', 'ad', 'öğrencinin adı', 'öğrenci adı'],
  lastName: ['soyadı', 'soyad', 'öğrencinin soyadı', 'öğrenci soyadı'],
  className: [
    'sınıf/şube',
    'sınıfı/şubesi',
    'sınıf şube',
    'sınıf şubesi',
    'sınıf ve şube',
    'sınıf adı',
  ],
  grade: ['sınıf', 'sınıfı', 'sınıf düzeyi', 'sınıf seviyesi', 'düzey'],
  section: ['şube', 'şubesi', 'şube adı'],
  birthDate: ['doğum tarihi', 'doğum t', 'd tarihi', 'doğum günü'],
  guardianName: [
    'veli adı soyadı',
    'veli adı',
    'veli ad soyad',
    'veli',
    'velisi',
    'velinin adı soyadı',
  ],
  guardianPhone: [
    'veli telefonu',
    'veli telefon',
    'veli tel',
    'veli cep telefonu',
    'veli cep tel',
    'veli cep',
    'veli gsm',
    'velinin telefonu',
  ],
  relationship: ['yakınlık', 'yakınlık derecesi', 'veli yakınlığı', 'veli yakınlık derecesi'],
}

const foldLabel = (value: string) => foldHeader(value).replace(/[./()\\:]/g, '')

const ALIAS_INDEX = new Map<string, EokulField>(
  EOKUL_FIELDS.flatMap((field) =>
    EOKUL_ALIASES[field].map((alias) => [foldLabel(alias), field] as const),
  ),
)

const columnIndexSchema = z.number().int().min(0).max(255).nullable().optional()

/** Alan → başlıktaki sütun sırası (0'dan); `null` ya da yok: eşlenmemiş. */
export const eokulMappingSchema = z.strictObject({
  schoolNumber: columnIndexSchema,
  identityNumber: columnIndexSchema,
  fullName: columnIndexSchema,
  firstName: columnIndexSchema,
  lastName: columnIndexSchema,
  className: columnIndexSchema,
  grade: columnIndexSchema,
  section: columnIndexSchema,
  birthDate: columnIndexSchema,
  guardianName: columnIndexSchema,
  guardianPhone: columnIndexSchema,
  relationship: columnIndexSchema,
})
export type EokulMapping = z.infer<typeof eokulMappingSchema>

/**
 * Önizleme ve onay aynı gövdeyi taşır; dosya saklanmaz, iki adımda da yeniden gönderilir. Eşleme
 * verilmezse başlıktan önerilen kullanılır. Onay yalnız seçilen satırları (`lines`) yazar.
 */
export const eokulImportInputSchema = z
  .strictObject({
    // kvkk: Ç — e-Okul listesi: öğrencinin kimlik no ve doğum tarihi, veli adı ve telefonu. Dosya
    // saklanmaz, loglanmaz (`fileBase64` gizleme listesinde), denetime yalnız alan adı ve sayı yazılır.
    fileBase64: importFileInputSchema.shape.fileBase64,
    dryRun: z.boolean().default(false),
    mapping: eokulMappingSchema.optional(),
    /** Sınıf adı birden çok kampüste varsa aramayı bu kampüsle sınırlar. */
    branchId: z.string().trim().min(1).max(80).optional(),
    /** Dosyada sınıf sütunu yoksa (sınıf listesi) bütün satırların sınıfı. */
    fallbackClassId: z.string().trim().min(1).max(80).optional(),
    /** Onayda yazılacak satırlar (dosyadaki satır numarası). */
    lines: z.array(z.number().int().min(1).max(1_000_000)).max(EOKUL_IMPORT_MAX_ROWS).optional(),
  })
  .superRefine((value, context) => {
    if (!value.dryRun && (value.lines?.length ?? 0) === 0)
      context.addIssue({
        code: 'custom',
        path: ['lines'],
        message: 'Aktarılacak en az bir satır seçin.',
      })
    if (value.lines !== undefined && new Set(value.lines).size !== value.lines.length)
      context.addIssue({
        code: 'custom',
        path: ['lines'],
        message: 'Aynı satır birden çok kez seçilmiş.',
      })
  })
export type EokulImportInput = z.input<typeof eokulImportInputSchema>

/** Eşleme sorunu: alan, kararlı kod, Türkçe ileti. */
export const eokulMappingIssueSchema = z.object({
  field: z.string(),
  code: z.string(),
  message: z.string(),
})
export type EokulMappingIssue = z.infer<typeof eokulMappingIssueSchema>

export const EOKUL_IMPORT_MESSAGES = {
  eokul_import_invalid:
    'Seçilen satırlarda düzeltilmesi gereken sorun var. Hiçbir kayıt yazılmadı.',
  eokul_mapping_invalid:
    'Sütun eşlemesinde düzeltilmesi gereken sorun var. Hiçbir kayıt yazılmadı.',
  header_not_found:
    'Başlık satırı bulunamadı. İlk 20 satırda T.C. kimlik no ya da okul no ile ad soyad sütunlarının başlığı olmalı.',
  column_missing: 'Seçilen sütun dosyada yok.',
  column_duplicate: 'Bu sütun başka bir alana da eşlenmiş.',
  match_column_required: 'T.C. kimlik no ya da okul no sütununu eşleyin.',
  name_column_required: 'Ad soyad sütununu ya da ad ve soyad sütunlarını eşleyin.',
  name_column_conflict: 'Ad soyad tek sütunsa ad ve soyad ayrıca eşlenmez.',
  class_column_conflict: 'Sınıf/şube tek sütunsa sınıf düzeyi ve şube ayrıca eşlenmez.',
  grade_column_required: 'Şube sütunuyla birlikte sınıf düzeyi sütununu da eşleyin.',
  campus_not_found: 'Seçilen kampüs bulunamadı.',
  fallback_class_not_found: 'Seçilen sınıf bulunamadı ya da seçilen kampüste değil.',
  line_not_found: 'Seçilen satır dosyada yok ya da boş.',
  identity_invalid: 'Geçerli bir T.C. kimlik numarası girin.',
  school_number_invalid: 'Okul numarası 1–10 haneli bir sayı olmalı.',
  match_key_required: 'T.C. kimlik no ya da okul no boş.',
  name_invalid: 'Ad soyadı 2–80 karakter olmalı.',
  birth_date_invalid: 'Doğum tarihi geçmiş bir gün olmalı (GG.AA.YYYY ya da YYYY-AA-GG).',
  school_number_ambiguous:
    'Bu okul numarası kurumda birden çok öğrencide kayıtlı. Satıra T.C. kimlik no ekleyin.',
  match_conflict: 'T.C. kimlik no ve okul no kurumda farklı öğrencilere ait.',
  student_inactive:
    'Bu öğrenci kurumda ayrılmış ya da arşivlenmiş. Yeniden kayıt kesin kayıt ekranından yapılır.',
  identity_mismatch: 'Bu okul numarasındaki öğrencinin kayıtlı T.C. kimlik numarası farklı.',
  school_number_name_mismatch:
    'Bu okul numarasındaki öğrencinin adı farklı ve kimliği kayıtlı değil. Satıra T.C. kimlik no ekleyin.',
  class_not_found: 'Bu sınıf ve şube kurumda yok. Sınıfı önce Sınıflar ekranında açın.',
  class_ambiguous: 'Bu sınıf ve şube birden çok kampüste var. Kampüs seçin.',
  class_required: 'Yeni öğrenci için sınıf gerekli: sınıf sütununu eşleyin ya da sınıf seçin.',
  class_capacity_full: 'Sınıfın kontenjanı bu satıra yetmiyor.',
  identity_required_for_new: 'Yeni öğrenci için T.C. kimlik no gerekli.',
  grade_change_skipped:
    'Sınıf düzeyi farklı; sınıf değiştirilmez. Düzey geçişi Kayıt Yenileme ile yapılır.',
  birth_date_differs:
    'Doğum tarihi kurumdaki kayıtla farklı; değiştirilmez. Kimlik bilgisini kontrol edin.',
  identity_birth_date_missing:
    'Kimlik numarası kayıtlı değil, doğum tarihi olmadığı için eklenmez. Doğum tarihi sütununu eşleyin.',
} as const
type EokulMessageCode = keyof typeof EOKUL_IMPORT_MESSAGES

/** Dosyanın okunmuş tablosu: başlık satırı ve sonrasındaki boş olmayan satırlar. */
export interface EokulTable {
  headerLine: number
  headers: string[]
  rows: { line: number; cells: string[] }[]
}

/** Başlık hücrelerinden önerilen eşleme; her alan ilk uyan sütunu alır. */
export function suggestEokulMapping(headers: readonly string[]): EokulMapping {
  const mapping: EokulMapping = {}
  headers.forEach((header, index) => {
    const field = ALIAS_INDEX.get(foldLabel(header))
    if (field !== undefined && mapping[field] === undefined) mapping[field] = index
  })
  // "Adı Soyadı" varken ayrıca "Adı" gibi bir sütun bulunursa tek sütun önceliklidir.
  if (mapping.fullName !== undefined) {
    delete mapping.firstName
    delete mapping.lastName
  }
  if (mapping.className !== undefined) {
    delete mapping.grade
    delete mapping.section
  }
  return mapping
}

const isMapped = (mapping: EokulMapping, field: EokulField) =>
  mapping[field] !== undefined && mapping[field] !== null

function looksLikeHeader(cells: readonly string[]): boolean {
  const mapping = suggestEokulMapping(cells)
  return (
    (isMapped(mapping, 'identityNumber') || isMapped(mapping, 'schoolNumber')) &&
    (isMapped(mapping, 'fullName') || isMapped(mapping, 'firstName'))
  )
}

/**
 * Metni tabloya çevirir: başlık ilk 20 satırda aranır; başlıktan sonra başlığın aynısı olan satır
 * (sayfa başında yinelenen başlık) atlanır. Dosya düzeyindeki sorun `DomainError`.
 */
export function readEokulTable(raw: string): EokulTable {
  const records = delimitedRecords(raw)
  if (records.length === 0)
    throw new DomainError('csv_empty', 'Dosya boş. Başlık satırı ve en az bir veri satırı gerekli.')
  const headerIndex = records
    .slice(0, EOKUL_HEADER_SCAN_ROWS)
    .findIndex((record) => looksLikeHeader(record.cells))
  const head = records[headerIndex]
  if (headerIndex < 0 || head === undefined)
    throw new DomainError('import_file_header_not_found', EOKUL_IMPORT_MESSAGES.header_not_found)
  const headerKey = head.cells.map(foldLabel).join('|')
  const rows = records
    .slice(headerIndex + 1)
    .filter((record) => record.cells.map(foldLabel).join('|') !== headerKey)
  if (rows.length === 0)
    throw new DomainError('csv_no_rows', 'Dosyada başlıktan sonra en az bir veri satırı olmalı.')
  if (rows.length > EOKUL_IMPORT_MAX_ROWS)
    throw new DomainError(
      'csv_too_many_rows',
      `Dosya en çok ${EOKUL_IMPORT_MAX_ROWS.toLocaleString('tr-TR')} veri satırı içerebilir; bu dosyada ${rows.length.toLocaleString('tr-TR')} satır var.`,
    )
  return {
    headerLine: head.line,
    headers: head.cells.map((cell) => cell.trim().slice(0, 60)),
    rows: rows.map((record) => ({ line: record.line, cells: record.cells })),
  }
}

/** Büyük harfle yazılmış ad ("DENİZ YILMAZ") Türkçe baş harf büyük yazılır; karışık ad korunur. */
export function eokulNameCase(value: string): string {
  const name = value.replace(/\s+/g, ' ').trim()
  if (name !== name.toLocaleUpperCase('tr')) return name
  return name
    .toLocaleLowerCase('tr')
    .replace(
      /(^|[\s'-])(\p{L})/gu,
      (_match, separator: string, letter: string) =>
        `${separator}${letter.toLocaleUpperCase('tr')}`,
    )
}

/** "9. Sınıf / A Şubesi", "9/A", "9-A", "9 A", "9A" → düzey ve şube; tanınmazsa `null`. */
export function parseEokulClass(cell: string): { grade: number; section: string } | null {
  const text = cell
    .toLocaleUpperCase('tr')
    .replace(/SINIFI|SINIF|ŞUBESİ|ŞUBE/g, ' ')
    .replace(/[.()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const match = /^(\d{1,2}) ?[/-]? ?([A-ZÇĞİÖŞÜ]{1,3})$/u.exec(text)
  if (match === null) return null
  const grade = Number(match[1])
  return grade >= 1 && grade <= 12 ? { grade, section: match[2] ?? '' } : null
}

/** Planın gördüğü kurum durumu; API kurum kilidi altında (önizlemede tek görüntüde) okur. */
export interface EokulImportContext {
  institutionType: InstitutionType
  /** Bugün, Europe/Istanbul günü. */
  today: string
  now: string
  /** Kurumun arşivlenmemiş kimlik satırları: öğrenci → kimlik no ve doğum tarihi. */
  identities: ReadonlyMap<string, { number: string; birthDate: string }>
  /** Kurumun etkin veli–öğrenci bağları (DOM-ILT-070, -074). */
  bonds: readonly ParentBond[]
}

export interface EokulImportOptions {
  mapping: EokulMapping
  branchId?: string | undefined
  fallbackClassId?: string | undefined
  /** Verilirse yalnız bu satırlar planlanır (onay). */
  lines?: readonly number[] | undefined
}

export const EOKUL_ROW_STATUSES = ['new', 'update', 'unchanged', 'invalid'] as const
export type EokulRowStatus = (typeof EOKUL_ROW_STATUSES)[number]
export const EOKUL_CHANGE_FIELDS = ['name', 'schoolNumber', 'class', 'identity'] as const
export type EokulChangeField = (typeof EOKUL_CHANGE_FIELDS)[number]

/** Değişiklik; kimlikte önceki ve sonraki değer taşınmaz. */
export interface EokulChange {
  field: EokulChangeField
  before: string | null
  after: string | null
}

/** Önizleme satırı: kimlik ve telefon maskeli; tam kimlik yanıtta dönmez. */
export interface EokulPreviewRow {
  line: number
  status: EokulRowStatus
  schoolNumber: string
  name: string
  /** Dosyadaki sınıf hücresi. */
  className: string
  /** Eşleşen Kampüs sınıfı; bulunamadıysa boş. */
  classLabel: string
  identityMasked: string
  guardianName: string
  guardianPhoneMasked: string
  guardianMatch: GuardianMatch | null
  changes: EokulChange[]
  issues: ImportIssue[]
  notices: ImportNotice[]
}

export interface EokulStudentUpdate {
  studentId: string
  name?: string
  number?: string
  classId?: string
  identity?: { number: string; birthDate: string }
}

export interface EokulImportPlan {
  mappingIssues: EokulMappingIssue[]
  rows: EokulPreviewRow[]
  /** Satır sorunları; varsa `updates` ve `created` boştur, çağıran hiçbir şey yazmaz. */
  issues: ImportIssue[]
  updates: EokulStudentUpdate[]
  created: PlannedStudent[]
  /** Yeni öğrencinin okul numarası (dosya satırı → numara). */
  numberByLine: ReadonlyMap<number, string>
  newGuardianCount: number
  existingGuardianCount: number
}

export type EokulImportState = StudentImportState

type ClassItem = State['classes'][number]

/** Sınıfın düzey ve şubesi: kayıttaki `grade`/`section`, yoksa adından ("7-A"). */
function classKey(item: ClassItem): { grade: number; section: string } | null {
  const raw: { grade?: unknown; section?: unknown; name: string } = item
  if (typeof raw.grade === 'number' && typeof raw.section === 'string' && raw.section.trim())
    return { grade: raw.grade, section: raw.section.trim().toLocaleUpperCase('tr') }
  const parsed = parseEokulClass(raw.name)
  if (parsed === null) return null
  return typeof raw.grade === 'number' ? { ...parsed, grade: raw.grade } : parsed
}

const sameName = (left: string, right: string) => foldHeader(left) === foldHeader(right)

/** Eşleme sorunları: dosyadaki sütunlar, zorunlu alanlar, kampüs ve sabit sınıf. */
export function checkEokulMapping(
  state: Pick<EokulImportState, 'classes' | 'branches'>,
  headerCount: number,
  options: EokulImportOptions,
): EokulMappingIssue[] {
  const { mapping } = options
  const issues: EokulMappingIssue[] = []
  const add = (field: string, code: EokulMessageCode) =>
    issues.push({ field, code, message: EOKUL_IMPORT_MESSAGES[code] })
  const used = new Map<number, EokulField>()
  for (const field of EOKUL_FIELDS) {
    const index = mapping[field]
    if (index === undefined || index === null) continue
    if (index >= headerCount) add(field, 'column_missing')
    else if (used.has(index)) add(field, 'column_duplicate')
    else used.set(index, field)
  }
  if (!isMapped(mapping, 'identityNumber') && !isMapped(mapping, 'schoolNumber'))
    add('identityNumber', 'match_column_required')
  const split = isMapped(mapping, 'firstName') || isMapped(mapping, 'lastName')
  if (isMapped(mapping, 'fullName') && split) add('fullName', 'name_column_conflict')
  else if (
    !isMapped(mapping, 'fullName') &&
    !(isMapped(mapping, 'firstName') && isMapped(mapping, 'lastName'))
  )
    add('fullName', 'name_column_required')
  const splitClass = isMapped(mapping, 'grade') || isMapped(mapping, 'section')
  if (isMapped(mapping, 'className') && splitClass) add('className', 'class_column_conflict')
  if (isMapped(mapping, 'section') && !isMapped(mapping, 'grade'))
    add('grade', 'grade_column_required')
  const branch =
    options.branchId === undefined
      ? null
      : state.branches.find((item) => item.id === options.branchId && item.isActive)
  if (branch === undefined) add('branchId', 'campus_not_found')
  if (options.fallbackClassId !== undefined) {
    const target = state.classes.find(
      (item) =>
        item.id === options.fallbackClassId &&
        item.isActive &&
        (branch === null || branch === undefined || item.branchId === branch.id),
    )
    if (target === undefined) add('fallbackClassId', 'fallback_class_not_found')
  }
  return issues
}

interface ExtractedRow {
  line: number
  schoolNumber: string
  identityNumber: string
  name: string
  classCell: string
  birthDate: string
  guardianName: string
  guardianPhone: string
  relationship: string
}

function extractRows(table: EokulTable, mapping: EokulMapping): ExtractedRow[] {
  const rows: ExtractedRow[] = []
  for (const record of table.rows) {
    const cell = (field: EokulField) => {
      const index = mapping[field]
      return index === undefined || index === null
        ? ''
        : (record.cells[index] ?? '').replace(/\s+/g, ' ').trim()
    }
    const name = isMapped(mapping, 'fullName')
      ? cell('fullName')
      : `${cell('firstName')} ${cell('lastName')}`.trim()
    const row: ExtractedRow = {
      line: record.line,
      schoolNumber: cell('schoolNumber').replace(/\s/g, ''),
      identityNumber: normalizeImportIdentity(cell('identityNumber')),
      name: eokulNameCase(name),
      classCell: isMapped(mapping, 'className')
        ? cell('className')
        : [cell('grade'), cell('section')].filter(Boolean).join(' '),
      birthDate: cell('birthDate'),
      guardianName: eokulNameCase(cell('guardianName')),
      guardianPhone: cell('guardianPhone'),
      relationship: cell('relationship'),
    }
    // Rapor başlığı, sınıf ayracı ya da alt bilgi satırı: eşleşme anahtarı ve ad yoksa öğrenci değil.
    if (row.schoolNumber === '' && row.identityNumber === '' && row.name === '') continue
    rows.push(row)
  }
  return rows
}

type ClassResolution =
  { kind: 'none' } | { kind: 'found'; id: string } | { kind: 'missing' } | { kind: 'ambiguous' }

function resolveClassCell(cell: string, pool: readonly ClassItem[]): ClassResolution {
  if (cell === '') return { kind: 'none' }
  const parsed = parseEokulClass(cell)
  let hits = parsed
    ? pool.filter((item) => {
        const key = classKey(item)
        return key !== null && key.grade === parsed.grade && key.section === parsed.section
      })
    : []
  if (hits.length === 0)
    hits = pool.filter((item) => item.id === cell || foldLabel(item.name) === foldLabel(cell))
  const [first, second] = hits
  if (first === undefined) return { kind: 'missing' }
  if (second !== undefined) return { kind: 'ambiguous' }
  return { kind: 'found', id: first.id }
}

const PILOT_FIELD: Readonly<Record<string, EokulField>> = {
  name: 'fullName',
  className: 'className',
  campus: 'className',
  identityKind: 'identityNumber',
  identityNumber: 'identityNumber',
  birthDate: 'birthDate',
  guardianName: 'guardianName',
  guardianPhone: 'guardianPhone',
  relationship: 'relationship',
}

/**
 * Satırları sınıflar ve yazılacakları çıkarır (IST-134; DOM-KAY-042). Eşleme sorunu varsa satır
 * işlenmez. Bir satırın birden çok sorunu ayrı maddedir.
 */
export function planEokulImport(
  state: EokulImportState,
  table: EokulTable,
  context: EokulImportContext,
  options: EokulImportOptions,
): EokulImportPlan {
  const empty: EokulImportPlan = {
    mappingIssues: [],
    rows: [],
    issues: [],
    updates: [],
    created: [],
    numberByLine: new Map(),
    newGuardianCount: 0,
    existingGuardianCount: 0,
  }
  const mappingIssues = checkEokulMapping(state, table.headers.length, options)
  if (mappingIssues.length > 0) return { ...empty, mappingIssues }

  const activeBranches = new Set(
    state.branches.filter((branch) => branch.isActive).map((branch) => branch.id),
  )
  const pool = state.classes.filter(
    (item) =>
      item.isActive &&
      activeBranches.has(item.branchId) &&
      (options.branchId === undefined || item.branchId === options.branchId),
  )
  const classesById = new Map(state.classes.map((item) => [item.id, item]))
  const studentsById = new Map(state.students.map((student) => [student.id, student]))
  const byNumber = new Map<string, string[]>()
  for (const student of state.students) {
    const number = student.number?.trim()
    if (number) byNumber.set(number, [...(byNumber.get(number) ?? []), student.id])
  }
  const holders = new Map<string, string>()
  for (const [studentId, identity] of context.identities) holders.set(identity.number, studentId)
  const occupants = classOccupancy(state)

  let extracted = extractRows(table, options.mapping)
  const rows: EokulPreviewRow[] = []
  const allIssues: ImportIssue[] = []
  if (options.lines !== undefined) {
    const selected = new Set(options.lines)
    const present = new Set(extracted.map((row) => row.line))
    for (const line of options.lines)
      if (!present.has(line))
        allIssues.push({
          line,
          field: null,
          code: 'line_not_found',
          message: EOKUL_IMPORT_MESSAGES.line_not_found,
        })
    extracted = extracted.filter((row) => selected.has(row.line))
  }

  const seenIdentity = new Map<string, number>()
  const seenNumber = new Map<string, number>()
  const updates: EokulStudentUpdate[] = []
  const moved = new Map<string, string>()
  const candidates: StudentImportRow[] = []
  const numberByLine = new Map<number, string>()
  const previewByLine = new Map<number, EokulPreviewRow>()

  for (const row of extracted) {
    const issues: ImportIssue[] = []
    const notices: ImportNotice[] = []
    const add = (field: EokulField | null, code: EokulMessageCode) =>
      issues.push({ line: row.line, field, code, message: EOKUL_IMPORT_MESSAGES[code] })
    const notice = (code: EokulMessageCode) =>
      notices.push({ code, message: EOKUL_IMPORT_MESSAGES[code] })
    const tc = row.identityNumber
    const number = row.schoolNumber
    const validTc = tc !== '' && isValidTurkishId(tc)
    if (tc !== '' && !validTc) add('identityNumber', 'identity_invalid')
    if (number !== '' && !/^\d{1,10}$/.test(number)) add('schoolNumber', 'school_number_invalid')
    if (tc === '' && number === '') add('identityNumber', 'match_key_required')
    if (row.name.length < 2 || row.name.length > 80) add('fullName', 'name_invalid')
    const birthDate = row.birthDate === '' ? null : parseImportDay(row.birthDate)
    if (row.birthDate !== '' && (birthDate === null || birthDate >= context.today))
      add('birthDate', 'birth_date_invalid')
    if (validTc) {
      const first = seenIdentity.get(tc)
      if (first === undefined) seenIdentity.set(tc, row.line)
      else
        issues.push({
          line: row.line,
          field: 'identityNumber',
          code: 'duplicate_identity',
          message: `Bu kimlik numarası dosyanın ${first}. satırında da var.`,
        })
    }
    if (/^\d{1,10}$/.test(number)) {
      const first = seenNumber.get(number)
      if (first === undefined) seenNumber.set(number, row.line)
      else
        issues.push({
          line: row.line,
          field: 'schoolNumber',
          code: 'duplicate_school_number',
          message: `Bu okul numarası dosyanın ${first}. satırında da var.`,
        })
    }

    const preview: EokulPreviewRow = {
      line: row.line,
      status: 'invalid',
      schoolNumber: number,
      name: row.name,
      className: row.classCell,
      classLabel: '',
      identityMasked: tc === '' ? '' : maskNationalId(tc),
      guardianName: '',
      guardianPhoneMasked: '',
      guardianMatch: null,
      changes: [],
      issues,
      notices,
    }
    rows.push(preview)
    previewByLine.set(row.line, preview)
    if (issues.length > 0) continue

    const byTc = validTc ? holders.get(tc) : undefined
    const numberHits = number === '' ? [] : (byNumber.get(number) ?? [])
    if (byTc === undefined && numberHits.length > 1) add('schoolNumber', 'school_number_ambiguous')
    const byNo = numberHits.length === 1 ? numberHits[0] : undefined
    if (byTc !== undefined && byNo !== undefined && byTc !== byNo)
      add('schoolNumber', 'match_conflict')
    if (issues.length > 0) continue

    const classCell = resolveClassCell(row.classCell, pool)
    const fallback = options.fallbackClassId
    const targetClassId =
      classCell.kind === 'found'
        ? classCell.id
        : classCell.kind === 'none' && fallback !== undefined
          ? fallback
          : null
    if (classCell.kind === 'missing') add('className', 'class_not_found')
    if (classCell.kind === 'ambiguous') add('className', 'class_ambiguous')
    if (targetClassId !== null) preview.classLabel = classesById.get(targetClassId)?.name ?? ''

    const matchedId = byTc ?? byNo
    if (matchedId === undefined) {
      // Yeni öğrenci: pilot aktarımının kuralıyla doğrulanır (veli, kontenjan, kardeş).
      if (!validTc) add('identityNumber', 'identity_required_for_new')
      if (targetClassId === null && classCell.kind === 'none') add('className', 'class_required')
      if (issues.length > 0) continue
      preview.guardianName = row.guardianName
      preview.guardianPhoneMasked = row.guardianPhone === '' ? '' : maskPhone(row.guardianPhone)
      if (number !== '') numberByLine.set(row.line, number)
      candidates.push({
        line: row.line,
        name: row.name,
        className: targetClassId ?? '',
        campus: '',
        identityKind: '',
        identityNumber: tc,
        birthDate: row.birthDate,
        guardianName: row.guardianName,
        guardianPhone: row.guardianPhone,
        // e-Okul listesi yakınlık taşımayabilir; boşsa "Diğer" (K-278).
        relationship:
          row.relationship === '' ? GUARDIAN_RELATIONSHIP_LABELS.other : row.relationship,
        studentPhone: '',
        extraCells: false,
      })
      continue
    }

    const student = studentsById.get(matchedId)
    if (student === undefined || !student.isActive) {
      add('identityNumber', 'student_inactive')
      continue
    }
    const stored = context.identities.get(student.id)
    if (byTc === undefined && validTc && stored !== undefined && stored.number !== tc)
      add('identityNumber', 'identity_mismatch')
    if (byTc === undefined && stored === undefined && !sameName(student.name, row.name))
      add('fullName', 'school_number_name_mismatch')
    if (issues.length > 0) continue

    const update: EokulStudentUpdate = { studentId: student.id }
    if (!sameName(student.name, row.name)) {
      update.name = row.name
      preview.changes.push({ field: 'name', before: student.name, after: row.name })
    }
    if (number !== '' && (student.number ?? '') !== number) {
      update.number = number
      preview.changes.push({
        field: 'schoolNumber',
        before: student.number?.trim() || null,
        after: number,
      })
    }
    if (targetClassId !== null && targetClassId !== student.classId) {
      const current = classesById.get(student.classId)
      const from = current === undefined ? null : classKey(current)
      const target = classesById.get(targetClassId)
      const to = target === undefined ? null : classKey(target)
      if (from === null || to === null || from.grade !== to.grade) notice('grade_change_skipped')
      else {
        const held = occupants.get(targetClassId) ?? 0
        if (held >= (target?.capacity ?? 0)) {
          add('className', 'class_capacity_full')
          continue
        }
        occupants.set(targetClassId, held + 1)
        occupants.set(student.classId, Math.max((occupants.get(student.classId) ?? 1) - 1, 0))
        moved.set(student.id, targetClassId)
        update.classId = targetClassId
        preview.changes.push({
          field: 'class',
          before: current?.name ?? null,
          after: target?.name ?? null,
        })
      }
    }
    if (stored === undefined && validTc) {
      if (birthDate === null) notice('identity_birth_date_missing')
      else {
        update.identity = { number: tc, birthDate }
        preview.changes.push({ field: 'identity', before: null, after: null })
      }
    }
    if (stored !== undefined && birthDate !== null && stored.birthDate !== birthDate)
      notice('birth_date_differs')
    preview.status = preview.changes.length > 0 ? 'update' : 'unchanged'
    if (preview.changes.length > 0) updates.push(update)
  }

  // Yeni satırlar: şube değişiklikleri işlenmiş görüntüde planlanır (kontenjan aynı sayımla).
  let created: PlannedStudent[] = []
  let guardianCounts = { newGuardianCount: 0, existingGuardianCount: 0 }
  if (candidates.length > 0) {
    const view: EokulImportState = {
      ...state,
      students: state.students.map((student) => {
        const classId = moved.get(student.id)
        return classId === undefined ? student : { ...student, classId }
      }),
    }
    const sub = planStudentImport(view, candidates, {
      institutionType: context.institutionType,
      today: context.today,
      now: context.now,
      identityHolders: holders,
      bonds: context.bonds,
    })
    for (const subRow of sub.rows) {
      const preview = previewByLine.get(subRow.line)
      if (preview === undefined) continue
      preview.guardianMatch = subRow.guardianMatch
      preview.notices.push(...subRow.notices)
      preview.issues.push(
        ...subRow.issues.map((issue) => ({
          ...issue,
          field: issue.field === null ? null : (PILOT_FIELD[issue.field] ?? null),
        })),
      )
      preview.status = preview.issues.length > 0 ? 'invalid' : 'new'
    }
    created = sub.students
    guardianCounts = {
      newGuardianCount: sub.newGuardianCount,
      existingGuardianCount: sub.existingGuardianCount,
    }
  }

  for (const preview of rows) allIssues.push(...preview.issues)
  allIssues.sort((left, right) => left.line - right.line)
  const failed = allIssues.length > 0
  return {
    mappingIssues: [],
    rows,
    issues: allIssues,
    updates: failed ? [] : updates,
    created: failed ? [] : created,
    numberByLine,
    ...guardianCounts,
  }
}

/** Yazılan değişiklikler: yeni öğrenciler (kimlik ve veli bağı için) ve eklenecek kimlikler. */
export interface EokulImportApplied {
  created: AppliedStudent[]
  identities: { studentId: string; number: string; birthDate: string }[]
  updatedCount: number
}

/**
 * Planı State'e uygular. Mevcut öğrencide yalnız ad, okul numarası ve sınıf alanı değişir; yeni
 * öğrenci ve velisi pilot aktarımının biçimiyle açılır (`applyStudentImport`), okul numarası eklenir.
 */
export function applyEokulImport(
  state: Pick<State, 'students' | 'parents'>,
  plan: EokulImportPlan,
  makeId: MakeId,
  now: string,
): EokulImportApplied {
  const studentsById = new Map(state.students.map((student) => [student.id, student]))
  const identities: EokulImportApplied['identities'] = []
  for (const update of plan.updates) {
    const student = studentsById.get(update.studentId)
    if (student === undefined) continue
    if (update.name !== undefined) student.name = update.name
    if (update.number !== undefined) student.number = update.number
    if (update.classId !== undefined) student.classId = update.classId
    if (update.identity !== undefined)
      identities.push({ studentId: student.id, ...update.identity })
  }
  const created = applyStudentImport(state, plan.created, makeId, now)
  created.forEach((item, index) => {
    const line = plan.created[index]?.line
    const number = line === undefined ? undefined : plan.numberByLine.get(line)
    const student = state.students.find((candidate) => candidate.id === item.studentId)
    if (student !== undefined && number !== undefined) student.number = number
  })
  return { created, identities, updatedCount: plan.updates.length }
}
