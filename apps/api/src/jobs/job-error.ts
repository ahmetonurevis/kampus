import { DrizzleQueryError } from 'drizzle-orm/errors'

/** Loga ve pg-boss çıktısına giden hata özeti: yalnız kod ve mesaj, başka alan yok. */
export interface JobErrorInfo {
  code: string | null
  message: string
}

const MAX_MESSAGE_LENGTH = 300

/**
 * İşleyici hatasını loglanabilir özete çevirir. Hata nesnesi olduğu gibi loglanmaz ve pg-boss
 * çıktısına verilmez: pg `detail` alanı kolon değeri, Drizzle `Failed query` mesajı sorgu
 * parametreleri taşıyabilir. Drizzle sarmalı açılır, yalnız sürücü hatasının `code` (SQLSTATE
 * dahil) ve ilk mesaj satırı kalır.
 */
export function jobErrorInfo(error: unknown): JobErrorInfo {
  const root = error instanceof DrizzleQueryError && error.cause ? error.cause : error
  if (typeof root !== 'object' || root === null) return { code: null, message: 'unknown error' }
  const code: unknown = Reflect.get(root, 'code')
  const message = root instanceof Error ? (root.message.split('\n')[0] ?? '') : ''
  return {
    code: typeof code === 'string' || typeof code === 'number' ? String(code) : null,
    message: message.slice(0, MAX_MESSAGE_LENGTH) || 'unknown error',
  }
}
