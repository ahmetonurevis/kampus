import { sql } from 'drizzle-orm'
import { check, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

import { E_OZEL_STORED_KINDS } from '@kampus/school-core/lib/finance-e-ozel.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

/**
 * e-Özel "işlendi" işareti (IST-085, DOM-KAY-015). Kursiyer, devamsızlık ve kurs sonu satırı için
 * kaynak kayıt başına bir satır; ücret işareti tahsilatın kendi kolonundadır (DOM-FIN-032). Satır
 * yalnız işaretlenince açılır. Geri alma işaret kolonlarını boşaltır ve sürümü artırır; geçmiş
 * denetim kaydındadır. `recorded_fingerprint` işaretlendiği anki kaynağın kişisel veri içermeyen
 * özetidir; tutmazsa satır "e-Özel'de düzeltilmeli" görünür. `source_id` kaynağın kimliğidir, yabancı
 * anahtar değildir: kaynak `records` ya da başka alanın tablosu olabilir ve yalnız okunur.
 */
export const eOzelRecords = pgTable(
  'e_ozel_records',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    kind: text('kind').notNull(),
    // kvkk: K (school-core kaydı ya da kaynak satır kimliği)
    sourceId: text('source_id').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }),
    // kvkk: K
    recordedByUserId: text('recorded_by_user_id'),
    recordedFingerprint: text('recorded_fingerprint'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'e_ozel_records_pkey',
      columns: [table.institutionId, table.kind, table.sourceId],
    }),
    check('e_ozel_records_kind_check', oneOf(table.kind, E_OZEL_STORED_KINDS)),
    check(
      'e_ozel_records_mark_check',
      sql`(${table.recordedAt} is null) = (${table.recordedByUserId} is null) and (${table.recordedAt} is null) = (${table.recordedFingerprint} is null)`,
    ),
  ],
)
