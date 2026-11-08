import { z } from 'zod'

import { delimitedRecords, foldHeader, type DelimitedRecord } from './delimited-input.ts'
import { daySchema } from './domain.ts'
import { importFileInputSchema, parseImportDay } from './enrollment-import-cells.ts'
import { DomainError } from './errors.ts'
import { parseTlAmount } from './finance-installment-import.ts'

/**
 * Banka ekstresi içe aktarımı (IST-115, ON-099; docs/domain/finans.md DOM-FIN-069). Kurum bankasından
 * aldığı hesap hareketi dosyasını (CSV, Excel'in ilk sayfası ya da MT940) yükler; dosya saklanmaz,
 * yalnız gelen (alacak) hareketler eşleştirme adayı olarak yazılır (K-106). Saf modüldür: hücreleri
 * çözer, satır sorunlarını satır numarasıyla döndürür ve mükerrer parmak izinin anahtarını kurar
 * (`bankTransactionKey`); özeti API alır (sha256). Sorun iletileri hücre değeri taşımaz.
 *
 * CSV başlık satırı ilk 30 satırda aranır: bankaların dökümünde başlıktan önce hesap ve dönem
 * satırları bulunur. Sütunlar yaygın Türk bankası başlıklarıyla (`BANK_STATEMENT_ALIASES`) ya da
 * kullanıcının seçtiği başlık adlarıyla (`columns`) eşlenir; tanınmayan sütunlar yok sayılır. Tutar
 * tek sütunda işaretli (`-` ya da sonda `-`, parantez) ya da alacak/borç olarak iki sütunda olabilir.
 * Tarihi ya da tutarı boş satır (devir, toplam, ara başlık) hareket sayılmaz (`ignored`); dolu ama
 * okunamayan satır hatalıdır ve onayı engeller.
 */

export const BANK_STATEMENT_MAX_ROWS = 5000
/** Başlık satırının arandığı ilk satır sayısı. */
const HEADER_SEARCH_ROWS = 30
/** Saklanan açıklamanın üst sınırı; daha uzun metin kesilir (`bank_transactions` kısıtı). */
export const BANK_DESCRIPTION_MAX = 1000
const SHORT_TEXT_MAX = 140

export const BANK_STATEMENT_FIELDS = [
  'date',
  'description',
  'amount',
  'credit',
  'debit',
  'balance',
  'reference',
  'counterparty',
] as const
export type BankStatementField = (typeof BANK_STATEMENT_FIELDS)[number]

export const BANK_STATEMENT_FIELD_LABELS = {
  date: 'İşlem tarihi',
  description: 'Açıklama',
  amount: 'Tutar (işaretli)',
  credit: 'Alacak (gelen)',
  debit: 'Borç (giden)',
  balance: 'Bakiye',
  reference: 'Referans / dekont no',
  counterparty: 'Gönderen / karşı taraf',
} as const satisfies Record<BankStatementField, string>

/**
 * Yaygın başlıklar, öncelik sırasıyla: aynı dosyada `İşlem Tarihi` ve `Valör` birlikte varsa işlem
 * tarihi seçilir. Bir başlık hücresi yalnız bir alana gider.
 */
export const BANK_STATEMENT_ALIASES = {
  date: ['tarih', 'işlem tarihi', 'işlem tarih', 'hareket tarihi', 'tarih/saat', 'valör'],
  description: ['açıklama', 'işlem açıklaması', 'açıklamalar', 'detay', 'işlem detayı'],
  amount: ['tutar', 'işlem tutarı', 'tutar (tl)', 'tutar tl', 'tutar (₺)', 'miktar'],
  credit: ['alacak', 'alacak tutarı', 'gelen', 'yatan'],
  debit: ['borç', 'borç tutarı', 'giden', 'çekilen'],
  balance: ['bakiye', 'kalan bakiye', 'bakiye (tl)', 'hesap bakiyesi'],
  reference: [
    'referans',
    'referans no',
    'işlem referansı',
    'dekont no',
    'fiş no',
    'işlem no',
    'ref no',
    'ref. no',
    'sorgu no',
  ],
  counterparty: [
    'gönderen',
    'gönderen adı',
    'gönderici',
    'karşı taraf',
    'karşı taraf adı',
    'karşı hesap',
    'karşı hesap sahibi',
  ],
} as const satisfies Record<BankStatementField, readonly string[]>

/** Kullanıcının seçtiği başlık adları; verilen alan otomatik eşlemenin yerine geçer. */
const headerName = z
  .string()
  .trim()
  .min(1, 'Sütun adını girin.')
  .max(60, 'Sütun adı en fazla 60 karakter olabilir.')
export const bankStatementColumnsSchema = z.strictObject({
  date: headerName.optional(),
  description: headerName.optional(),
  amount: headerName.optional(),
  credit: headerName.optional(),
  debit: headerName.optional(),
  balance: headerName.optional(),
  reference: headerName.optional(),
  counterparty: headerName.optional(),
})
export type BankStatementColumns = z.input<typeof bankStatementColumnsSchema>

/** Önizleme ve onay aynı gövdeyi taşır; dosya iki adımda da gönderilir, saklanmaz. */
export const bankStatementImportSchema = z.strictObject({
  ...importFileInputSchema.shape,
  bankAccountId: z.string().trim().min(1, 'Ekstrenin ait olduğu banka hesabını seçin.'),
  columns: bankStatementColumnsSchema.optional(),
})
export type BankStatementImportInput = z.input<typeof bankStatementImportSchema>

export const BANK_STATEMENT_FORMATS = ['csv', 'mt940'] as const
export type BankStatementFormat = (typeof BANK_STATEMENT_FORMATS)[number]

export type BankDirection = 'credit' | 'debit'

export interface BankStatementIssue {
  field: BankStatementField | null
  code: string
  message: string
}

/** Ekstrenin bir satırı; tutar mutlak değer kuruştur, yönü `direction`'dadır. */
export interface BankStatementLine {
  line: number
  /** `false`: tarih ya da tutar boş (devir, toplam, ara başlık); hareket sayılmaz. */
  movement: boolean
  bookingDate: string | null
  amountCents: number | null
  direction: BankDirection | null
  description: string
  reference: string
  counterparty: string
  balanceCents: number | null
  issues: BankStatementIssue[]
}

export interface ParsedBankStatement {
  format: BankStatementFormat
  /** CSV'de seçilen başlık satırının hücreleri (yalnız sütun adları); MT940'ta boş. */
  headers: string[]
  /** Alan → kullanılan başlık adı; MT940'ta boş. */
  columns: Partial<Record<BankStatementField, string>>
  /** MT940 `:25:` alanındaki IBAN; CSV'de ve IBAN olmayan hesap tanımında `null`. */
  accountIban: string | null
  lines: BankStatementLine[]
}

export const BANK_STATEMENT_MESSAGES = {
  bank_statement_invalid: 'Ekstrede düzeltilmesi gereken satırlar var. Hiçbir hareket aktarılmadı.',
  bank_statement_header_missing:
    'Başlık satırı bulunamadı: tarih, açıklama ve tutar (ya da alacak) sütunlarını içeren satır yok. Sütun adlarını eşleyin.',
  bank_statement_column_missing: 'Seçilen sütun başlık satırında yok.',
  bank_statement_empty: 'Ekstrede hareket satırı yok.',
  bank_statement_too_many_rows: `Ekstre en çok ${BANK_STATEMENT_MAX_ROWS.toLocaleString('tr-TR')} satır içerebilir. Dönemi bölerek yükleyin.`,
  bank_statement_account_mismatch:
    'MT940 dosyasındaki hesap seçilen banka hesabıyla aynı değil. Doğru hesabı seçin.',
  date_invalid: 'İşlem tarihini GG.AA.YYYY ya da YYYY-AA-GG biçiminde girin.',
  date_future: 'İşlem tarihi bugünden sonra olamaz.',
  amount_invalid: 'Tutarı 1.234,56 ya da 1234.56 biçiminde, kuruşuyla girin.',
  amount_both: 'Satırda hem alacak hem borç dolu; hareketin yönü anlaşılamadı.',
  balance_invalid: 'Bakiye okunamadı; bakiye sütununu 1.234,56 biçiminde girin.',
  description_missing: 'Açıklama boş; eşleştirme için hareket açıklaması gerekli.',
} as const

const issue = (
  field: BankStatementField | null,
  code: keyof typeof BANK_STATEMENT_MESSAGES,
): BankStatementIssue => ({ field, code, message: BANK_STATEMENT_MESSAGES[code] })

const clip = (value: string, max: number) => value.replace(/\s+/g, ' ').trim().slice(0, max).trim()

// --- Tutar ve tarih --------------------------------------------------------------------------

/** `0,00`, `-0`, `0.00 TL`: hareket yok sayılır (alacak/borç sütunlarında karşı sütun sıfırdır). */
const ZERO_AMOUNT = /^[-+(]?\s*0+(?:[.,]0+)?\s*\)?-?(?:\s*(?:₺|TL|TRY))?$/i

type SignedAmount = { cents: number; negative: boolean } | { problem: true }

/**
 * İşaretli TL hücresi: `-1.234,56`, `1.234,56-`, `(1.234,56)`, `+1234.56`, sonda `₺`/`TL`/`TRY`.
 * Rakam okuma taksit aktarımıyla aynıdır (`parseTlAmount`, DOM-FIN-001): yuvarlama yok, belirsiz
 * `1.234` reddedilir.
 */
export function parseSignedTlAmount(cell: string): SignedAmount {
  let value = cell
    .trim()
    .replace(/\s*(?:₺|TL|TRY)$/i, '')
    .trim()
  let negative = false
  if (/^\(.*\)$/.test(value)) {
    negative = true
    value = value.slice(1, -1).trim()
  }
  if (value.startsWith('-') || value.endsWith('-')) {
    negative = true
    value = value.replace(/^-|-$/g, '').trim()
  } else if (value.startsWith('+')) value = value.slice(1).trim()
  const parsed = parseTlAmount(value)
  return 'cents' in parsed ? { cents: parsed.cents, negative } : { problem: true }
}

/** Bakiye sıfır ya da eksi olabilir; okunamazsa `undefined`. */
function parseBalance(cell: string): number | null | undefined {
  if (cell.trim() === '') return null
  if (ZERO_AMOUNT.test(cell.trim())) return 0
  const parsed = parseSignedTlAmount(cell)
  if ('problem' in parsed) return undefined
  return parsed.negative ? -parsed.cents : parsed.cents
}

/** Tarih hücresi; saat eki atılır (`05.10.2026 14:32`, `05/10/2026-14:32:10`). */
export function parseStatementDay(cell: string): string | null {
  const match = /^\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{4}-\d{2}-\d{2})/.exec(cell)
  return match?.[1] === undefined ? null : parseImportDay(match[1])
}

// --- CSV --------------------------------------------------------------------------------------

type ColumnPositions = Partial<Record<BankStatementField, number>>

function headerPositions(
  cells: readonly string[],
  columns: BankStatementColumns | undefined,
): ColumnPositions {
  const folded = cells.map(foldHeader)
  const taken = new Set<number>()
  const positions: ColumnPositions = {}
  // Kullanıcının seçtiği adlar önce: otomatik eşleme aynı hücreyi başka alana vermesin.
  for (const field of BANK_STATEMENT_FIELDS) {
    const chosen = columns?.[field]
    if (chosen === undefined) continue
    const index = folded.indexOf(foldHeader(chosen))
    if (index >= 0 && !taken.has(index)) {
      positions[field] = index
      taken.add(index)
    }
  }
  for (const field of BANK_STATEMENT_FIELDS) {
    if (positions[field] !== undefined || columns?.[field] !== undefined) continue
    for (const alias of BANK_STATEMENT_ALIASES[field]) {
      const index = folded.findIndex((cell, at) => cell === foldHeader(alias) && !taken.has(at))
      if (index >= 0) {
        positions[field] = index
        taken.add(index)
        break
      }
    }
  }
  return positions
}

const isHeader = (positions: ColumnPositions) =>
  positions.date !== undefined &&
  positions.description !== undefined &&
  (positions.amount !== undefined || positions.credit !== undefined)

function findHeader(
  records: readonly DelimitedRecord[],
  columns: BankStatementColumns | undefined,
): { index: number; positions: ColumnPositions } {
  for (const [index, record] of records.slice(0, HEADER_SEARCH_ROWS).entries()) {
    const positions = headerPositions(record.cells, columns)
    if (isHeader(positions)) return { index, positions }
  }
  // Kullanıcı ad verdiyse ve ad hiçbir satırda yoksa ileti bunu söyler.
  const chosen = BANK_STATEMENT_FIELDS.some((field) => columns?.[field] !== undefined)
  throw new DomainError(
    chosen ? 'bank_statement_column_missing' : 'bank_statement_header_missing',
    chosen
      ? `${BANK_STATEMENT_MESSAGES.bank_statement_column_missing} ${BANK_STATEMENT_MESSAGES.bank_statement_header_missing}`
      : BANK_STATEMENT_MESSAGES.bank_statement_header_missing,
  )
}

function csvLine(
  record: DelimitedRecord,
  positions: ColumnPositions,
  today: string,
): BankStatementLine {
  const cell = (field: BankStatementField) => {
    const position = positions[field]
    return position === undefined ? '' : (record.cells[position] ?? '').trim()
  }
  const dateCell = cell('date')
  const amountCell = cell('amount')
  const creditCell = ZERO_AMOUNT.test(cell('credit')) ? '' : cell('credit')
  const debitCell = ZERO_AMOUNT.test(cell('debit')) ? '' : cell('debit')
  const singleAmount = positions.amount !== undefined && !ZERO_AMOUNT.test(amountCell)
  const hasAmount = (singleAmount && amountCell !== '') || creditCell !== '' || debitCell !== ''
  const base = {
    line: record.line,
    description: clip(cell('description'), BANK_DESCRIPTION_MAX),
    reference: clip(cell('reference'), 100),
    counterparty: clip(cell('counterparty'), SHORT_TEXT_MAX),
  }
  if (dateCell === '' || !hasAmount)
    return {
      ...base,
      movement: false,
      bookingDate: null,
      amountCents: null,
      direction: null,
      balanceCents: null,
      issues: [],
    }
  const issues: BankStatementIssue[] = []
  const bookingDate = parseStatementDay(dateCell)
  if (bookingDate === null) issues.push(issue('date', 'date_invalid'))
  else if (bookingDate > today) issues.push(issue('date', 'date_future'))
  let amountCents: number | null = null
  let direction: BankDirection | null = null
  if (singleAmount && amountCell !== '') {
    const parsed = parseSignedTlAmount(amountCell)
    if ('problem' in parsed) issues.push(issue('amount', 'amount_invalid'))
    else {
      amountCents = parsed.cents
      direction = parsed.negative ? 'debit' : 'credit'
    }
  } else if (creditCell !== '' && debitCell !== '') issues.push(issue('credit', 'amount_both'))
  else {
    const field = creditCell !== '' ? 'credit' : 'debit'
    const parsed = parseSignedTlAmount(creditCell !== '' ? creditCell : debitCell)
    if ('problem' in parsed) issues.push(issue(field, 'amount_invalid'))
    else {
      amountCents = parsed.cents
      // Alacak sütununda eksi tutar (banka iadesi) gelen para değildir.
      direction = field === 'credit' && !parsed.negative ? 'credit' : 'debit'
    }
  }
  const balanceCents = parseBalance(cell('balance'))
  if (balanceCents === undefined) issues.push(issue('balance', 'balance_invalid'))
  if (direction === 'credit' && base.description === '' && base.counterparty === '')
    issues.push(issue('description', 'description_missing'))
  return {
    ...base,
    movement: true,
    bookingDate,
    amountCents,
    direction,
    balanceCents: balanceCents ?? null,
    issues,
  }
}

function parseCsv(
  raw: string,
  columns: BankStatementColumns | undefined,
  today: string,
): ParsedBankStatement {
  const records = delimitedRecords(raw)
  if (records.length === 0)
    throw new DomainError('bank_statement_empty', BANK_STATEMENT_MESSAGES.bank_statement_empty)
  const { index, positions } = findHeader(records, columns)
  const head = records[index]
  const body = records.slice(index + 1)
  if (body.length === 0)
    throw new DomainError('bank_statement_empty', BANK_STATEMENT_MESSAGES.bank_statement_empty)
  if (body.length > BANK_STATEMENT_MAX_ROWS)
    throw new DomainError(
      'bank_statement_too_many_rows',
      BANK_STATEMENT_MESSAGES.bank_statement_too_many_rows,
    )
  const headers = (head?.cells ?? []).map((cell) => clip(cell, 60)).filter(Boolean)
  const used: Partial<Record<BankStatementField, string>> = {}
  for (const field of BANK_STATEMENT_FIELDS) {
    const position = positions[field]
    if (position !== undefined) used[field] = clip(head?.cells[position] ?? '', 60)
  }
  return {
    format: 'csv',
    headers,
    columns: used,
    accountIban: null,
    lines: body.map((record) => csvLine(record, positions, today)),
  }
}

// --- MT940 ------------------------------------------------------------------------------------

/** SWIFT MT940: `:20:` ve `:61:` etiketleri varsa dosya MT940'tır. */
export const isMt940 = (raw: string) => /^:20:/m.test(raw) && /^:61:/m.test(raw)

const TAG = /^:(\d{2}[A-Z]?):(.*)$/
/**
 * `:61:` değer günü (YYMMDD), isteğe bağlı kayıt günü (MMDD), yön (`C`, `D`, `RC`, `RD`), fon kodu,
 * tutar (virgüllü), işlem türü (1 harf + 3 karakter), müşteri referansı ve `//` sonrası banka
 * referansı.
 */
const STATEMENT_LINE =
  /^(\d{2})(\d{2})(\d{2})(?:\d{4})?(RC|RD|C|D)[A-Z]?(\d{1,15},\d{0,2})[NFS][A-Z0-9]{3}([^/]*)(?:\/\/(.*))?$/

function mt940Amount(text: string): number | null {
  const [whole = '', fraction = ''] = text.split(',')
  const parsed = parseTlAmount(`${whole}.${fraction.padEnd(2, '0')}`)
  return 'cents' in parsed ? parsed.cents : null
}

function parseMt940(raw: string, today: string): ParsedBankStatement {
  const physical = raw.replace(/^\uFEFF/, '').split(/\r?\n/)
  type Field = { tag: string; text: string; line: number }
  const fields: Field[] = []
  physical.forEach((text, index) => {
    const tagged = TAG.exec(text)
    if (tagged) fields.push({ tag: tagged[1] ?? '', text: tagged[2] ?? '', line: index + 1 })
    else if (text.trim() !== '' && text.trim() !== '-' && fields.length > 0) {
      const last = fields[fields.length - 1]
      if (last) last.text += `\n${text}`
    }
  })
  const account = fields.find((field) => field.tag === '25')?.text.replace(/\s/g, '') ?? ''
  const iban = /TR\d{24}/i.exec(account)?.[0]?.toUpperCase() ?? null
  const lines: BankStatementLine[] = []
  fields.forEach((field, index) => {
    if (field.tag !== '61') return
    const [first = '', ...rest] = field.text.split('\n')
    const next = fields[index + 1]
    // `:86:` bilgi alanı `?20`…`?29` alt alanlarıyla gelebilir; kodlar boşluğa iner.
    const details =
      next?.tag === '86'
        ? next.text
            .replace(/\?\d{2}/g, ' ')
            .replace(/\n/g, ' ')
            .trim()
        : ''
    const match = STATEMENT_LINE.exec(first.trim())
    const issues: BankStatementIssue[] = []
    let bookingDate: string | null = null
    let amountCents: number | null = null
    let direction: BankDirection | null = null
    let reference = ''
    if (match === null) issues.push(issue('amount', 'amount_invalid'))
    else {
      const [, yy = '', mm = '', dd = '', mark = '', amount = '', customer = '', bank = ''] = match
      bookingDate = parseImportDay(`20${yy}-${mm}-${dd}`)
      if (bookingDate === null) issues.push(issue('date', 'date_invalid'))
      else if (bookingDate > today) issues.push(issue('date', 'date_future'))
      amountCents = mt940Amount(amount)
      if (amountCents === null) issues.push(issue('amount', 'amount_invalid'))
      // Yalnız `C` gelen paradır; `RD` (borcun ters kaydı) banka düzeltmesidir, tahsilat değildir.
      direction = mark === 'C' ? 'credit' : 'debit'
      const customerRef = customer.trim().toUpperCase() === 'NONREF' ? '' : customer.trim()
      reference = clip(bank.trim() || customerRef, 100)
    }
    const description = clip([details, ...rest].join(' '), BANK_DESCRIPTION_MAX)
    if (direction === 'credit' && description === '')
      issues.push(issue('description', 'description_missing'))
    lines.push({
      line: field.line,
      movement: true,
      bookingDate,
      amountCents,
      direction,
      description,
      reference,
      counterparty: '',
      balanceCents: null,
      issues,
    })
  })
  if (lines.length === 0)
    throw new DomainError('bank_statement_empty', BANK_STATEMENT_MESSAGES.bank_statement_empty)
  if (lines.length > BANK_STATEMENT_MAX_ROWS)
    throw new DomainError(
      'bank_statement_too_many_rows',
      BANK_STATEMENT_MESSAGES.bank_statement_too_many_rows,
    )
  return { format: 'mt940', headers: [], columns: {}, accountIban: iban, lines }
}

/** Dosya metnini hareket satırlarına ayırır; dosya düzeyindeki sorun `DomainError` (422). */
export function parseBankStatement(
  raw: string,
  options: { columns?: BankStatementColumns | undefined; today: string },
): ParsedBankStatement {
  daySchema.parse(options.today)
  if (raw.trim() === '')
    throw new DomainError('bank_statement_empty', BANK_STATEMENT_MESSAGES.bank_statement_empty)
  return isMt940(raw)
    ? parseMt940(raw, options.today)
    : parseCsv(raw, options.columns, options.today)
}

// --- Mükerrer anahtarı ve plan ----------------------------------------------------------------

/** Karşılaştırma için katlanmış metin: Türkçe harf ASCII'ye, büyük harf küçüğe, boşluk tek. */
export function foldStatementText(value: string): string {
  return value.split(/\s+/).map(foldHeader).filter(Boolean).join(' ')
}

/**
 * Hareketin mükerrer anahtarı (K-107): hesap + gün + tutar + yön + katlanmış açıklama + referans.
 * Aynı dosyada aynı anahtarlı birden çok hareket (aynı gün aynı açıklamayla iki havale) sıra
 * numarasıyla ayrılır; aynı dosya yeniden yüklenince sıra aynı kalır, ikinci yükleme yazmaz. API
 * anahtarın sha256 özetini saklar.
 */
export function bankTransactionKeys(
  bankAccountId: string,
  lines: readonly BankStatementLine[],
): Map<number, string> {
  const seen = new Map<string, number>()
  const keys = new Map<number, string>()
  for (const line of lines) {
    if (!line.movement || line.direction !== 'credit' || line.issues.length > 0) continue
    const base = [
      bankAccountId,
      line.bookingDate ?? '',
      String(line.amountCents ?? ''),
      foldStatementText(`${line.description} ${line.counterparty}`),
      foldStatementText(line.reference),
    ].join('|')
    const occurrence = (seen.get(base) ?? 0) + 1
    seen.set(base, occurrence)
    keys.set(line.line, `${base}#${String(occurrence)}`)
  }
  return keys
}

export const BANK_IMPORT_ROW_STATUSES = [
  'ready',
  'skipped',
  'outgoing',
  'ignored',
  'invalid',
] as const
export type BankImportRowStatus = (typeof BANK_IMPORT_ROW_STATUSES)[number]

export interface BankImportRow {
  line: number
  status: BankImportRowStatus
  bookingDate: string | null
  amountCents: number | null
  direction: BankDirection | null
  /** Maskeli açıklama (`maskStatementText`); önizlemede gösterilir. */
  description: string
  reference: string
  issues: BankStatementIssue[]
}

export interface PlannedBankTransaction {
  line: number
  key: string
  bookingDate: string
  amountCents: number
  description: string
  reference: string | null
  counterparty: string | null
  balanceCents: number | null
}

export interface BankImportPlan {
  rows: BankImportRow[]
  transactions: PlannedBankTransaction[]
  counts: Record<BankImportRowStatus, number>
  totalCents: number
}

/**
 * 11 ve daha uzun rakam dizileri (T.C. kimlik no, IBAN gövdesi, telefon) son dört hanesi dışında
 * maskelenir: açıklama yanıtta ve önizlemede bu biçimde döner (K-112). Saklanan metin hamdır.
 */
export function maskStatementText(value: string): string {
  return value.replace(
    /(?<!\d)\d{11,}(?!\d)/g,
    (digits) => `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`,
  )
}

/**
 * Satır durumları: hatalı satır onayı engeller; giden hareket ve hareket olmayan satır yazılmaz;
 * daha önce aktarılmış (`isKnown`) gelen hareket atlanır (`skipped`). `keys` `bankTransactionKeys`
 * sonucudur.
 */
export function planBankStatementImport(
  lines: readonly BankStatementLine[],
  keys: ReadonlyMap<number, string>,
  isKnown: (key: string) => boolean,
): BankImportPlan {
  const counts: Record<BankImportRowStatus, number> = {
    ready: 0,
    skipped: 0,
    outgoing: 0,
    ignored: 0,
    invalid: 0,
  }
  const rows: BankImportRow[] = []
  const transactions: PlannedBankTransaction[] = []
  let totalCents = 0
  for (const line of lines) {
    const key = keys.get(line.line)
    const status: BankImportRowStatus = !line.movement
      ? 'ignored'
      : line.issues.length > 0
        ? 'invalid'
        : line.direction !== 'credit'
          ? 'outgoing'
          : key !== undefined && isKnown(key)
            ? 'skipped'
            : 'ready'
    counts[status] += 1
    rows.push({
      line: line.line,
      status,
      bookingDate: line.bookingDate,
      amountCents: line.amountCents,
      direction: line.direction,
      description: maskStatementText(clip(`${line.description} ${line.counterparty}`, 300)),
      reference: line.reference,
      issues: line.issues,
    })
    if (
      status === 'ready' &&
      key !== undefined &&
      line.bookingDate !== null &&
      line.amountCents !== null
    ) {
      totalCents += line.amountCents
      transactions.push({
        line: line.line,
        key,
        bookingDate: line.bookingDate,
        amountCents: line.amountCents,
        description: line.description,
        reference: line.reference === '' ? null : line.reference,
        counterparty: line.counterparty === '' ? null : line.counterparty,
        balanceCents: line.balanceCents,
      })
    }
  }
  return { rows, transactions, counts, totalCents }
}

/** Örnek CSV: yaygın banka dökümü; ilk satırlar hesap bilgisidir, başlık arada bulunur. */
export const BANK_STATEMENT_SAMPLE = [
  'Hesap Hareketleri;;;;',
  'Dönem: 01.10.2026 - 05.10.2026;;;;',
  'Tarih;Açıklama;Tutar;Bakiye;Dekont No',
  '01.10.2026;EFT AYSE YILMAZ DENIZ YILMAZ EKIM TAKSIT;24.500,00;124.500,00;EFT2026100100001',
  '02.10.2026;KIRA ODEMESI;-15.000,00;109.500,00;HVL2026100200007',
  '03.10.2026;HAVALE OGR NO 2026001 TAKSIT;24.500,00;134.000,00;HVL2026100300011',
].join('\n')
