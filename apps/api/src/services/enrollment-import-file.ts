import { unzipSync } from 'fflate'
import { readSheet } from 'read-excel-file/universal'

import {
  IMPORT_FILE_MAX_BYTES,
  IMPORT_FILE_MESSAGE,
} from '@kampus/school-core/lib/enrollment-import-cells.ts'

import { RuleViolationError } from '../errors.ts'

/**
 * Pilot aktarımı dosya girişi (IST-007, ON-060, ON-061): gelen dosya sunucuda metne çözülür,
 * diske ya da veritabanına yazılmaz; bu fonksiyon dönünce bellekte de tutulmaz. Tür adından değil
 * içeriğinden anlaşılır (guvenlik-kvkk.md): `.xlsx` ZIP'tir, eski `.xls` OLE'dur ve reddedilir, öteki
 * bayt dizisi metindir. Hata iletisi dosya içeriği taşımaz.
 */

/** ZIP içindeki dosyaların açılmış toplam sınırı (sıkıştırma bombası): 1.000 satırı rahat taşır. */
const XLSX_MAX_UNPACKED_BYTES = 64 * 1024 * 1024
const XLSX_MAX_ENTRIES = 2_000

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0]

const startsWith = (bytes: Uint8Array, magic: readonly number[]) =>
  magic.every((value, index) => bytes[index] === value)

const unreadableExcel = () =>
  new RuleViolationError(
    'import_file_unreadable',
    'Excel dosyası okunamadı. Dosyayı Excel’de açıp yeniden kaydedin ya da CSV olarak yükleyin.',
  )

/** UTF-16 BOM'lu ("Unicode Metin"), katı UTF-8, olmazsa Excel'in Türkçe CSV'si (Windows-1254). */
function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1254').decode(bytes)
  }
}

/** Excel'in sayı hücresinde gösterdiği anlamlı basamak sayısı. */
const EXCEL_SIGNIFICANT_DIGITS = 15

/**
 * Excel `1250,10`'u dosyaya ikili karşılığıyla yazar (`1250.0999999999999`). Bu fazlalık kullanıcının
 * girdiği değer değildir: Excel'in gördüğü 15 basamağa rakam metni üzerinde indirilir, kayan noktaya
 * geçilmez. Daha az basamaklı değer dokunulmadan kalır; `1250.125` satır doğrulamasında reddedilir.
 */
function excelDecimalText(value: string): string {
  const match = /^(\d+)\.(\d+)$/.exec(value)
  if (match === null) return value
  const fraction = match[2] ?? ''
  const digits = `${match[1] ?? ''}${fraction}`
  const dropped = digits.replace(/^0+/, '').length - EXCEL_SIGNIFICANT_DIGITS
  if (dropped <= 0) return value
  const unit = 10n ** BigInt(dropped)
  const rounded = ((BigInt(digits) + unit / 2n) / unit) * unit
  const text = String(rounded).padStart(digits.length, '0')
  const whole = text.slice(0, text.length - fraction.length)
  const kept = text.slice(text.length - fraction.length).replace(/0+$/, '')
  return kept === '' ? whole : `${whole}.${kept}`
}

/**
 * Sayı hücresi metin olarak gelir (`parseNumber`): kimlik ve tutarda kayan nokta kaybı olmaz.
 * Bazı yazıcılar tamsayıyı `1.2345678901E10` ya da `125000.0` diye yazar; yalnız tam sayı olan
 * değer sadeleşir, ondalıklı değer olduğu gibi kalır ve satır doğrulaması karar verir.
 */
function numericText(value: string): string {
  if (/^\d+\.0+$/.test(value)) return value.slice(0, value.indexOf('.'))
  if (/^\d+(\.\d+)?[eE]\+?\d+$/.test(value)) {
    const parsed = Number(value)
    if (Number.isSafeInteger(parsed)) return String(parsed)
  }
  return value
}

function cellText(cell: unknown): string {
  if (cell === null || cell === undefined) return ''
  // Tarih hücresi UTC gece yarısıdır; gün olarak okunur.
  if (cell instanceof Date) return cell.toISOString().slice(0, 10)
  if (typeof cell === 'string') return excelDecimalText(numericText(cell.trim()))
  if (typeof cell === 'number' || typeof cell === 'boolean') return String(cell)
  throw unreadableExcel()
}

/**
 * Excel'in ilk sayfası `;` ayraçlı metne çevrilir: bundan sonrası CSV ile aynı yoldur
 * (`csvTable`). Satır sonu içeren hücre boşluğa iner, satır numarası kullanıcının Excel'de gördüğü
 * satırla aynı kalsın. Boş satırlar boş kalır (`delimitedRecords` sayar, atlar).
 */
async function xlsxToText(bytes: Uint8Array): Promise<string> {
  let unpacked = 0
  let entries = 0
  let rows: readonly (readonly unknown[])[]
  try {
    // Yalnız başlıklar okunur (`false`: açma): açılmış boyut açmadan önce sınırlanır.
    unzipSync(bytes, {
      filter: (file) => {
        unpacked += file.originalSize
        entries += 1
        if (unpacked > XLSX_MAX_UNPACKED_BYTES || entries > XLSX_MAX_ENTRIES)
          throw unreadableExcel()
        return false
      },
    })
    // Buffer havuzun görünümü olabilir; okuyucu ArrayBuffer'ın tamamını okur, kopya verilir.
    const copy = Uint8Array.from(bytes).buffer
    rows = await readSheet(copy, { parseNumber: (value: string) => value })
  } catch {
    throw unreadableExcel()
  }
  return rows
    .map((row) =>
      row
        .map(
          (cell) =>
            `"${cellText(cell)
              .replace(/\s*[\r\n]+\s*/g, ' ')
              .replace(/"/g, '""')}"`,
        )
        .join(';'),
    )
    .join('\n')
}

/** Base64 dosyayı aktarımın okuyacağı metne çevirir (CSV ya da Excel'in ilk sayfası). */
export async function decodeImportFile(fileBase64: string): Promise<string> {
  const bytes = Buffer.from(fileBase64, 'base64')
  if (bytes.length === 0)
    throw new RuleViolationError('import_file_empty', 'Dosya boş. Dolu bir dosya seçin.')
  if (bytes.length > IMPORT_FILE_MAX_BYTES)
    throw new RuleViolationError('import_file_too_large', IMPORT_FILE_MESSAGE)
  if (startsWith(bytes, OLE_MAGIC))
    throw new RuleViolationError(
      'import_file_legacy_excel',
      'Eski Excel biçimi (.xls) okunmuyor. Dosyayı .xlsx ya da CSV olarak kaydedip yükleyin.',
    )
  if (startsWith(bytes, ZIP_MAGIC)) return xlsxToText(bytes)
  const text = decodeText(bytes)
  if (text.includes('\0'))
    throw new RuleViolationError('import_file_unsupported', IMPORT_FILE_MESSAGE)
  return text
}
