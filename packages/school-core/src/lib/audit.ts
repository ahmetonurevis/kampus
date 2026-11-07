import type { Role } from '../modules/navigation.ts'

/**
 * Denetim kaydı (DOM-ILT-041, DOM-YTK-053). Core işlemleri kaydın eski ve yeni değerini JSON
 * kopyası olarak yazar; API kendi denetim tablosunu tutar ve core'a boş liste verir.
 */

/** JSON'a yazılabilir değer. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
/** Denetim kaydındaki eski/yeni değer: kaydın işlem anındaki JSON kopyası (API'de jsonb). */
export type AuditValue = JsonValue
/** Değeri JSON kopyasına çevirir; sonradan kayıt değişse de denetim değeri değişmez. */
export const toAuditValue = (value: unknown): AuditValue =>
  JSON.parse(JSON.stringify(value ?? null)) as AuditValue
/**
 * Denetim kaydı. Çevrimdışı telefon yalnız kimlik, rol, işlem ve tarih yazar; tablo, kayıt ve
 * değer alanlarını core işlemleri doldurur (`RecordAuditEntry`).
 */
export type AuditEntry = {
  id: string
  actor: Role
  action: string
  date: string
  user_id?: string
  table_name?: string
  record_id?: string
  changed_at?: string
  old_value?: AuditValue
  new_value?: AuditValue
  /** Değeri denetim kaydına yazılmayan, değişen gizli alanların adları (DOM-ILT-041). */
  masked_fields?: string[]
}
/** Core işleminin yazdığı denetim kaydı; kayıt alanları her zaman doludur. */
export type RecordAuditEntry = AuditEntry & {
  user_id: string
  table_name: string | undefined
  record_id: string
  changed_at: string
  old_value: AuditValue
  new_value: AuditValue
}
