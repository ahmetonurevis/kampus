import { DomainError } from './errors.ts'

/** Ayrıştırılmış CSV kaydı: hücreler ve kaydın dosyada başladığı satır (1'den). */
export interface DelimitedRecord {
  line: number
  cells: string[]
}

// CSV alanları tırnak içinde ayraç, çift tırnak ve satır sonu içerebilir. Boş satırlar atlanır;
// satır numarası dosyadaki fiziksel satırdır (tırnak içindeki satır sonu da sayılır), böylece
// hata iletisi kullanıcının düzenleyicide gördüğü satırı gösterir.
export function delimitedRecords(raw: string): DelimitedRecord[] {
  const source = raw.replace(/^\uFEFF/, '')
  const [firstLine = ''] = source.split(/\r?\n/, 1)
  const separator = firstLine.includes(';') ? ';' : ','
  const records: DelimitedRecord[] = [],
    row: string[] = []
  let cell = '',
    quoted = false,
    closed = false,
    line = 1,
    start = 1
  for (let index = 0; index <= source.length; index++) {
    const char = source[index]
    if (char === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"'
        index++
      } else if (quoted) {
        quoted = false
        closed = true
      } else if (!cell && !closed) quoted = true
      else
        throw new DomainError(
          'csv_invalid_quote',
          `CSV ${line}. satırda geçersiz tırnak kullanımı var.`,
        )
    } else if (!quoted && (char === separator || char === '\n' || char === undefined)) {
      row.push(cell)
      cell = ''
      closed = false
      if (char !== separator) {
        if (row.some((v) => v.trim())) records.push({ line: start, cells: [...row] })
        row.length = 0
        line++
        start = line
      }
    } else if (char !== undefined && char !== '\r') {
      if (closed && char.trim())
        throw new DomainError(
          'csv_invalid_character',
          `CSV ${line}. satırda kapanan tırnaktan sonra geçersiz karakter var.`,
        )
      if (char === '\n') line++
      if (!closed) cell += char
    }
  }
  if (quoted) throw new DomainError('csv_unclosed_quote', 'CSV içinde kapanmamış tırnak var.')
  return records
}

export function delimitedRows(raw: string) {
  return delimitedRecords(raw).map((record) => record.cells)
}

export function csvObjects<const H extends readonly string[]>(
  raw: string,
  header: H,
  maximumRows = 1000,
): Record<H[number], string>[] {
  const rows = delimitedRows(raw)
  if (rows[0]?.map((v) => v.trim()).join('|') !== header.join('|'))
    throw new DomainError('csv_invalid_header', `CSV başlıkları ${header.join(';')} olmalıdır.`)
  if (rows.length < 2 || rows.length > maximumRows + 1)
    throw new DomainError(
      'csv_invalid_row_count',
      `Dosya 1–${maximumRows} veri satırı içermelidir.`,
    )
  return rows.slice(1).map((values, index) => {
    if (values.length !== header.length)
      throw new DomainError(
        'csv_invalid_column_count',
        `CSV ${index + 2}. satırda sütun sayısı geçersiz.`,
      )
    // Dosya sınırı: başlık ve sütun sayısı doğrulandığı için her başlık anahtarı dolu bir dizedir;
    // Object.fromEntries anahtar birleşimini koruyamadığından tip burada daraltılır.
    return Object.fromEntries(header.map((key, i) => [key, values[i] ?? ''])) as Record<
      H[number],
      string
    >
  })
}

/**
 * Başlık eşleştirmesi için katlanmış ad: Türkçe harfler ASCII'ye, büyük harf küçüğe; boşluk, tire
 * ve alt çizgi atılır ("E-posta", "eposta", "E posta" aynıdır).
 */
export function foldHeader(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşü]/g, (char) => FOLD[char] ?? char)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s_-]+/g, '')
}

const FOLD: Readonly<Record<string, string>> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
}

/** Tablo sütunu: kabul edilen başlık adları (katlanmış karşılaştırılır) ve zorunluluk. */
export interface CsvColumn {
  aliases: readonly string[]
  required: boolean
}

export interface CsvTableRow<K extends string> {
  /** Kaydın dosyadaki satırı (başlık 1. satırdır). */
  line: number
  /** Sütun değerleri, kırpılmış; dosyada olmayan isteğe bağlı sütun boş dizedir. */
  values: Record<K, string>
  /** Satırda başlıktan fazla dolu hücre var (eksik hücre boş sayılır). */
  extraCells: boolean
}

/**
 * Başlıklı CSV tablosu (toplu aktarımların ortak girişi, IST-007): başlık adları takma adlarla ve
 * sırasız eşleşir, isteğe bağlı sütun bulunmayabilir. Dosya düzeyindeki sorunlar (bilinmeyen ya da
 * yinelenen sütun, eksik zorunlu sütun, veri satırı yok, satır sınırı aşıldı) `DomainError` olarak
 * fırlatılır; satır içeriği doğrulanmaz, onu çağıran satır numarasıyla raporlar.
 */
export function csvTable<K extends string>(
  raw: string,
  columns: Readonly<Record<K, CsvColumn>>,
  maximumRows: number,
): CsvTableRow<K>[] {
  const [head, ...body] = delimitedRecords(raw)
  if (head === undefined)
    throw new DomainError('csv_empty', 'Dosya boş. Başlık satırı ve en az bir veri satırı gerekli.')
  // Object.keys anahtar birleşimini koruyamaz; anahtarlar `columns` nesnesinin kendisinden gelir.
  const keys = Object.keys(columns) as K[]
  const byAlias = new Map<string, K>()
  for (const key of keys)
    for (const alias of columns[key].aliases) byAlias.set(foldHeader(alias), key)
  const positions = new Map<K, number>()
  head.cells.forEach((cell, index) => {
    if (!cell.trim()) return
    const key = byAlias.get(foldHeader(cell))
    if (key === undefined)
      throw new DomainError(
        'csv_unknown_column',
        `Başlıktaki "${cell.trim().slice(0, 40)}" sütunu tanınmadı. Örnek dosyadaki başlıkları kullanın.`,
      )
    if (positions.has(key))
      throw new DomainError(
        'csv_duplicate_column',
        `Başlıkta "${cell.trim().slice(0, 40)}" sütunu birden çok kez var.`,
      )
    positions.set(key, index)
  })
  const missing = keys.filter((key) => columns[key].required && !positions.has(key))
  if (missing.length > 0)
    throw new DomainError(
      'csv_missing_column',
      `Başlıkta zorunlu sütun eksik: ${missing.map((key) => columns[key].aliases[0]).join(', ')}.`,
    )
  if (body.length === 0)
    throw new DomainError('csv_no_rows', 'Dosyada başlıktan sonra en az bir veri satırı olmalı.')
  if (body.length > maximumRows)
    throw new DomainError(
      'csv_too_many_rows',
      `Dosya en çok ${maximumRows.toLocaleString('tr-TR')} veri satırı içerebilir; bu dosyada ${body.length.toLocaleString('tr-TR')} satır var.`,
    )
  const used = new Set(positions.values())
  return body.map((record) => {
    const values = Object.fromEntries(
      keys.map((key) => {
        const position = positions.get(key)
        return [key, position === undefined ? '' : (record.cells[position] ?? '').trim()]
      }),
    ) as Record<K, string>
    return {
      line: record.line,
      values,
      extraCells: record.cells.some((cell, index) => !used.has(index) && cell.trim() !== ''),
    }
  })
}
