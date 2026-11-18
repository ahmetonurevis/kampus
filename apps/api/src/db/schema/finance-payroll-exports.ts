import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  PAYROLL_LESSON_HOURS_MAX,
  PAYROLL_EXPORT_FORMATS,
  PAYROLL_LESSON_NOTE_MAX,
  type PayrollExportFormat,
  type PayrollExportProfile,
} from '@kampus/school-core/lib/finance-payroll-exports.ts'
import { LESSON_PAY_TYPES, type LessonPayType } from '@kampus/school-core/lib/finance-pay-rates.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Bordro programına aktarım (DOM-FIN-105; ON-202). Üç tablo:
 *
 * - `payroll_lesson_hours`: ay için elle girilen ek ders saati (K-337). Personel üyeliğine
 *   restrict yabancı anahtar; aynı personel, ay ve türde tek etkin kayıt (kısmi tekil indeks).
 *   Düzeltilir ve arşivlenir; ders saati özeti (OG-116) gelince okuma kaynağı olur.
 * - `payroll_export_profiles`: kurumun sütun eşleme şablonu (K-339); satır yoksa genel dosya.
 * - `payroll_exports`: her dosya üretiminin özeti (K-338): ay, biçim, satır ve personel sayısı,
 *   toplamlar ve dosyanın SHA-256 özeti. Dosya saklanmaz. Satır değişmez
 *   (`kampus_reject_immutable_change()`, tetikleyici migration'a elle yazılır); aynı ay
 *   yeniden üretilebilir (dönem kilidi yok, ON-200).
 */
export const payrollLessonHours = pgTable(
  'payroll_lesson_hours',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id').notNull(),
    monthStart: date('month_start', { mode: 'string' }).notNull(),
    lessonType: text('lesson_type').$type<LessonPayType>().notNull(),
    // kvkk: K (çalışma süresi)
    hours: integer('hours').notNull(),
    note: text('note'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'payroll_lesson_hours_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'payroll_lesson_hours_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check('payroll_lesson_hours_lesson_type_check', oneOf(table.lessonType, LESSON_PAY_TYPES)),
    check(
      'payroll_lesson_hours_hours_check',
      sql`${table.hours} between 1 and ${n(PAYROLL_LESSON_HOURS_MAX)}`,
    ),
    check('payroll_lesson_hours_month_check', sql`extract(day from ${table.monthStart}) = 1`),
    check(
      'payroll_lesson_hours_note_check',
      sql`${table.note} is null or char_length(${table.note}) between 1 and ${n(PAYROLL_LESSON_NOTE_MAX)}`,
    ),
    uniqueIndex('payroll_lesson_hours_entry_key')
      .on(table.institutionId, table.membershipId, table.monthStart, table.lessonType)
      .where(sql`${table.archivedAt} is null`),
    index('payroll_lesson_hours_membership_idx').on(
      table.institutionId,
      table.membershipId,
      table.monthStart,
    ),
    index('payroll_lesson_hours_month_idx').on(table.institutionId, table.monthStart),
  ],
)

export const payrollExportProfiles = pgTable('payroll_export_profiles', {
  institutionId: text('institution_id')
    .primaryKey()
    .references(() => institutions.id),
  profile: jsonb('profile').$type<PayrollExportProfile | null>(),
  ...requiredColumns(),
})

export const payrollExports = pgTable(
  'payroll_exports',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    monthStart: date('month_start', { mode: 'string' }).notNull(),
    format: text('format').$type<PayrollExportFormat>().notNull(),
    lineCount: integer('line_count').notNull(),
    staffCount: integer('staff_count').notNull(),
    earningCents: bigint('earning_cents', { mode: 'number' }).notNull(),
    deductionCents: bigint('deduction_cents', { mode: 'number' }).notNull(),
    missingTotalCount: integer('missing_total_count').notNull(),
    currency: text('currency').notNull().default('TRY'),
    contentSha256: text('content_sha256').notNull(),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'payroll_exports_pkey', columns: [table.institutionId, table.id] }),
    check('payroll_exports_format_check', oneOf(table.format, PAYROLL_EXPORT_FORMATS)),
    check('payroll_exports_month_check', sql`extract(day from ${table.monthStart}) = 1`),
    check(
      'payroll_exports_counts_check',
      sql`${table.lineCount} >= 0 and ${table.staffCount} >= 0 and ${table.staffCount} <= ${table.lineCount}
        and ${table.missingTotalCount} >= 0 and ${table.missingTotalCount} <= ${table.lineCount}`,
    ),
    check(
      'payroll_exports_amounts_check',
      sql`${table.earningCents} >= 0 and ${table.deductionCents} >= 0`,
    ),
    check('payroll_exports_currency_check', sql`${table.currency} = 'TRY'`),
    check('payroll_exports_sha_check', sql`${table.contentSha256} ~ '^[0-9a-f]{64}$'`),
    index('payroll_exports_month_idx').on(table.institutionId, table.monthStart, table.createdAt),
    index('payroll_exports_created_idx').on(table.institutionId, table.createdAt),
  ],
)
