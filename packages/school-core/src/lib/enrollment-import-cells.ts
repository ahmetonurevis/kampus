import { z } from 'zod'

import { isCalendarDay } from './age.ts'
import { DomainError } from './errors.ts'

/**
 * Pilot verisi aktarımının ortak girişi (IST-007, ON-060, ON-061): dosya gövdesi, satır sorunları
 * ve hücre çözümleri. Dosya sunucuda çözülür, saklanmaz; içerik ve kişisel veri loglanmaz, sorun
 * iletileri hücre değeri taşımaz (yalnız satır numarası ve kural). Saf modüldür.
 */

/** Seçilen dosyanın üst sınırı (CSV ya da .xlsx). */
export const IMPORT_FILE_MAX_BYTES = 5 * 1024 * 1024
export const IMPORT_FILE_MESSAGE = 'En fazla 5 MB boyutunda CSV ya da Excel (.xlsx) dosyası seçin.'
/** Dosyanın base64 uzunluğu; sınır aşılırsa dosya çözülmeden reddedilir. */
const IMPORT_FILE_MAX_BASE64 = Math.ceil(IMPORT_FILE_MAX_BYTES / 3) * 4

/** Önizleme ve onay aynı gövdeyi taşır: dosya iki adımda da yeniden gönderilir, saklanmaz. */
export const importFileInputSchema = z.strictObject({
  // kvkk: Ç — öğrenci ve velinin kimlik, iletişim ve finans verisi; loglanmaz, denetime yazılmaz.
  fileBase64: z
    .string()
    .min(1, 'Dosya içeriği boş.')
    .max(IMPORT_FILE_MAX_BASE64, IMPORT_FILE_MESSAGE)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Dosya içeriği okunamadı. Dosyayı yeniden seçin.'),
  /** Önizleme: doğrular, hiçbir şey yazmaz. */
  dryRun: z.boolean().default(false),
})
export type ImportFileInput = z.input<typeof importFileInputSchema>

/** Satır sorunu: dosyadaki satır, alan (satırın bütünü için `null`), kararlı kod, Türkçe ileti. */
export const importIssueSchema = z.object({
  line: z.number().int().min(1),
  field: z.string().nullable(),
  code: z.string(),
  message: z.string(),
})
export type ImportIssue = z.infer<typeof importIssueSchema>

/** Satırın kaydı engellemeyen bilgisi: önizlemede yöneticinin onayına sunulur. */
export const importNoticeSchema = z.object({ code: z.string(), message: z.string() })
export type ImportNotice = z.infer<typeof importNoticeSchema>

/** Satırın sonucu: yazılacak, zaten kayıtlı olduğu için atlanacak ya da düzeltilmesi gereken. */
export const IMPORT_ROW_STATUSES = ['ready', 'skipped', 'invalid'] as const
export type ImportRowStatus = (typeof IMPORT_ROW_STATUSES)[number]

/**
 * Dosya okuma; başlık sorunu iletisi hücre değeri taşımaz. Başlıksız dosyada ilk satır veridir:
 * ortak okuyucunun (`csvTable`) "… sütunu tanınmadı" iletisi kişinin adını ya da kimliğini yanıta
 * ve hata kaydına taşırdı.
 */
export function readImportTable<T>(read: () => T): T {
  try {
    return read()
  } catch (error) {
    if (error instanceof DomainError && error.code === 'csv_unknown_column')
      throw new DomainError(
        error.code,
        'Başlıkta tanınmayan sütun var. Örnek şablondaki başlıkları kullanın.',
      )
    if (error instanceof DomainError && error.code === 'csv_duplicate_column')
      throw new DomainError(error.code, 'Başlıkta aynı sütun birden çok kez var.')
    throw error
  }
}

/** Tarih hücresi: `YYYY-MM-DD`, `GG.AA.YYYY`, `GG/AA/YYYY` ya da `GG-AA-YYYY`; geçersizse `null`. */
export function parseImportDay(cell: string): string | null {
  const value = cell.trim()
  const local = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(value)
  const day = local
    ? `${local[3]}-${(local[2] ?? '').padStart(2, '0')}-${(local[1] ?? '').padStart(2, '0')}`
    : value
  return isCalendarDay(day) ? day : null
}

/**
 * Telefon hücresi `05XXXXXXXXX` biçimine çevrilir: Excel sayı hücresi baştaki sıfırı düşürür
 * (`5321234567`), `+90`/`90` öneki ve ayraçlar atılır. Geçersizse `null`.
 */
export function parseImportPhone(cell: string): string | null {
  const digits = cell.replace(/[\s().+-]/g, '')
  const phone =
    digits.length === 12 && digits.startsWith('90')
      ? `0${digits.slice(2)}`
      : digits.length === 10 && digits.startsWith('5')
        ? `0${digits}`
        : digits
  return /^0\d{10}$/.test(phone) ? phone : null
}

/** Kimlik numarası hücresi: araya giren boşluklar atılır (`123 456 789 01`). */
export const normalizeImportIdentity = (cell: string) => cell.replace(/\s/g, '')
