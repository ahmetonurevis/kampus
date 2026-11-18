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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  SGK_FULL_MONTH_DAYS,
  SGK_NOTE_MAX,
  SGK_SELECTABLE_REASON_CODES,
  type SgkReasonCode,
} from '@kampus/school-core/lib/finance-sgk-preparation.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * SGK hazırlık listesinin elle eksik gün satırı (DOM-FIN-107; ON-203, K-353). Personel üyeliği ve
 * ay (ayın ilk günü) başına birden çok satır olabilir; ayın toplamı 30 günü aşamaz (kurum kilidi
 * altında servis denetimi). Neden kodu isteğe bağlıdır; boşsa liste uyarı verir. Satır düzeltilmez,
 * kaldırılır (arşiv). Sağlık raporu (ON-185) ve izinlerden (ON-181) besleme yoktur.
 */
export const sgkMissingDays = pgTable(
  'sgk_missing_days',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id').notNull(),
    month: date('month', { mode: 'string' }).notNull(),
    days: integer('days').notNull(),
    // kvkk: K (eksik gün nedeni; tanı yok)
    reasonCode: text('reason_code').$type<SgkReasonCode>(),
    note: text('note'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    // kvkk: K
    archivedByUserId: text('archived_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'sgk_missing_days_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'sgk_missing_days_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check('sgk_missing_days_month_check', sql`extract(day from ${table.month}) = 1`),
    check(
      'sgk_missing_days_days_check',
      sql`${table.days} between 1 and ${n(SGK_FULL_MONTH_DAYS)}`,
    ),
    check(
      'sgk_missing_days_reason_check',
      sql`${table.reasonCode} is null or ${oneOf(table.reasonCode, SGK_SELECTABLE_REASON_CODES)}`,
    ),
    check(
      'sgk_missing_days_note_check',
      sql`${table.note} is null or char_length(${table.note}) between 1 and ${n(SGK_NOTE_MAX)}`,
    ),
    check(
      'sgk_missing_days_archive_check',
      sql`(${table.archivedAt} is null) = (${table.archivedByUserId} is null)`,
    ),
    index('sgk_missing_days_month_idx').on(table.institutionId, table.month, table.membershipId),
    index('sgk_missing_days_membership_idx').on(
      table.institutionId,
      table.membershipId,
      table.month,
    ),
  ],
)

/**
 * SGK hazırlık listesinin elle giriş/çıkış günü (DOM-FIN-107; ON-203, K-352). Ücret tanımından
 * çıkan giriş/çıkış gününün yerine geçer. Üyelik ve ay başına tek etkin satır (kısmi tekil indeks);
 * günler ayın içindedir, çıkış girişten önce olamaz. Satır düzeltilmez, kaldırılır (arşiv).
 */
export const sgkEmploymentDates = pgTable(
  'sgk_employment_dates',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id').notNull(),
    month: date('month', { mode: 'string' }).notNull(),
    // kvkk: K
    entryDate: date('entry_date', { mode: 'string' }),
    // kvkk: K
    exitDate: date('exit_date', { mode: 'string' }),
    note: text('note'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    // kvkk: K
    archivedByUserId: text('archived_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'sgk_employment_dates_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'sgk_employment_dates_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check('sgk_employment_dates_month_check', sql`extract(day from ${table.month}) = 1`),
    // En az bir gün; ikisi de ayın içinde, çıkış girişten önce değil.
    check(
      'sgk_employment_dates_days_check',
      sql`(${table.entryDate} is not null or ${table.exitDate} is not null)
        and (${table.entryDate} is null or date_trunc('month', ${table.entryDate})::date = ${table.month})
        and (${table.exitDate} is null or date_trunc('month', ${table.exitDate})::date = ${table.month})
        and (${table.entryDate} is null or ${table.exitDate} is null or ${table.exitDate} >= ${table.entryDate})`,
    ),
    check(
      'sgk_employment_dates_note_check',
      sql`${table.note} is null or char_length(${table.note}) between 1 and ${n(SGK_NOTE_MAX)}`,
    ),
    check(
      'sgk_employment_dates_archive_check',
      sql`(${table.archivedAt} is null) = (${table.archivedByUserId} is null)`,
    ),
    uniqueIndex('sgk_employment_dates_member_month_key')
      .on(table.institutionId, table.membershipId, table.month)
      .where(sql`${table.archivedAt} is null`),
    index('sgk_employment_dates_membership_idx').on(
      table.institutionId,
      table.membershipId,
      table.month,
    ),
    index('sgk_employment_dates_month_idx').on(table.institutionId, table.month),
  ],
)
