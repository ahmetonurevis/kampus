import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  ACADEMIC_YEAR_MAX,
  ACADEMIC_YEAR_MIN,
  ACADEMIC_YEAR_STATUSES,
  type AcademicYearStatus,
} from '@kampus/school-core/lib/academic-years.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

/**
 * Eğitim yılı ve dönemleri (IST-011; docs/domain/yetki-ve-kapsam.md DOM-YTK-063…067; kurallar
 * core `lib/academic-years.ts`). Yıl kurum içinde başlangıç yılıyla tanımlanır: birincil anahtar
 * `(institution_id, start_year)`'dır ve mevcut sayı temsiliyle (`fee_tariffs.academic_year`,
 * `institution_settings.academic_year`) aynı değerdir. Tablolar yenidir; kısıtlar tek adımda
 * eklenir. Migration, ayar satırı olan her kurum için o yılı varsayılan aralıkla etkin yazar.
 *
 * Yılın satır `version`'ı yıl ve dönemlerinin bütününün iyimser kilididir: dönem eklemek,
 * değiştirmek ve kaldırmak da yılın sürümünü artırır (`If-Match`). Yılların ve dönemlerin
 * örtüşmemesi tablolar arası/aralık kısıtı ister (`btree_gist` yok); core kuralı kurum kilidi
 * altında denetler.
 */
export const academicYears = pgTable(
  'academic_years',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    startYear: integer('start_year').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    status: text('status').$type<AcademicYearStatus>().notNull(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'academic_years_pkey', columns: [table.institutionId, table.startYear] }),
    check(
      'academic_years_start_year_check',
      sql`${table.startYear} between ${sql.raw(String(ACADEMIC_YEAR_MIN))} and ${sql.raw(String(ACADEMIC_YEAR_MAX))}`,
    ),
    check('academic_years_status_check', oneOf(table.status, ACADEMIC_YEAR_STATUSES)),
    // Başlangıç günü başlangıç yılındadır; bitiş sonradır ve bir yılı geçmez (core `addOneYear`).
    check(
      'academic_years_dates_check',
      sql`extract(year from ${table.startDate}) = ${table.startYear}
        and ${table.endDate} > ${table.startDate}
        and ${table.endDate} < ${table.startDate} + interval '1 year'`,
    ),
    // Durum ve işlem anları birlikte: planlı yıl hiç etkinleşmemiştir, kapanan yıl önce etkindi.
    check(
      'academic_years_lifecycle_check',
      sql`(${table.status} = 'planned' and ${table.activatedAt} is null and ${table.closedAt} is null)
        or (${table.status} = 'active' and ${table.activatedAt} is not null and ${table.closedAt} is null)
        or (${table.status} = 'closed' and ${table.activatedAt} is not null and ${table.closedAt} is not null)`,
    ),
    // Kurumda tek etkin yıl (DOM-YTK-065); eşzamanlı ikinci etkinleştirme 23505 → 409.
    uniqueIndex('academic_years_active_key')
      .on(table.institutionId)
      .where(sql`${table.status} = 'active' and ${table.archivedAt} is null`),
  ],
)

/** Yılın dönemi (DOM-YTK-064); sıra başlangıç gününden hesaplanır, saklanmaz. Kaldırma arşivdir. */
export const academicTerms = pgTable(
  'academic_terms',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    startYear: integer('start_year').notNull(),
    name: text('name').notNull(),
    /**
     * Ad tekilliği anahtarı: core `academicTermNameKey(name)` (NFC, kırpılmış, Türkçe küçük harf).
     * Depo her yazmada addan türetir; `lower()` yerel ayara bağlı olduğundan core ile ayrışırdı.
     */
    nameKey: text('name_key').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'academic_terms_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'academic_terms_year_fkey',
      columns: [table.institutionId, table.startYear],
      foreignColumns: [academicYears.institutionId, academicYears.startYear],
    }).onDelete('restrict'),
    check('academic_terms_name_check', sql`char_length(${table.name}) between 1 and 100`),
    check('academic_terms_dates_check', sql`${table.endDate} >= ${table.startDate}`),
    // Yılda ad tekildir (core ile aynı anahtar, DOM-YTK-064).
    uniqueIndex('academic_terms_year_name_key')
      .on(table.institutionId, table.startYear, table.nameKey)
      .where(sql`${table.archivedAt} is null`),
    // Yabancı anahtar indeksi (arşivli dönemler dahil; kısmi indeks onları kapsamaz) ve yılın
    // dönemlerinin gün sırasıyla okunması.
    index('academic_terms_year_idx').on(table.institutionId, table.startYear, table.startDate),
  ],
)
