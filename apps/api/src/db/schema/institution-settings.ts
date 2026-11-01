import { sql } from 'drizzle-orm'
import { bigint, check, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

import { institutions } from './auth.ts'

/**
 * Kurum başına 1:1 ayarlar (veritabani.md §2 "sık değişen veya büyüyen ayarlar"). Açık modüller
 * Better Auth kurum alanında (`institutions.enabled_modules`) kalır; burada school-core State'inin
 * dizi olmayan alanları tutulur. `academic_year` core `academicYear`'ıdır: eğitim-öğretim yılının
 * başlangıç yılı (2026 → 2026–2027). Core'da "dönem" bu yıldır; ayrı yarıyıl kavramı yoktur.
 */
export const institutionSettings = pgTable(
  'institution_settings',
  {
    institutionId: text('institution_id')
      .primaryKey()
      .references(() => institutions.id, { onDelete: 'cascade' }),
    academicYear: integer('academic_year').notNull(),
    /**
     * Kurumun dosya depolama kotası, bayt (ADR 0003 karar 3, DOM-KYN-004). Boşsa platform
     * varsayılanı (`DEFAULT_STORAGE_QUOTA_BYTES`, 50 GB; Açık soru 6-a) geçerlidir.
     * TODO(F3c2-quota): platform yöneticisinin kotayı değiştirdiği uç ve ekran.
     */
    storageQuotaBytes: bigint('storage_quota_bytes', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    check(
      'institution_settings_academic_year_check',
      sql`${table.academicYear} between 2000 and 2100`,
    ),
    check(
      'institution_settings_storage_quota_bytes_check',
      sql`${table.storageQuotaBytes} is null or ${table.storageQuotaBytes} > 0`,
    ),
  ],
)
