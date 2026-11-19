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
  SGK_EXIT_CODES,
  STAFF_SEPARATION_CANCEL_REASON_MAX,
  STAFF_SEPARATION_CANCEL_REASON_MIN,
  STAFF_SEPARATION_NOTE_MAX,
  STAFF_SEPARATION_REASONS,
  STAFF_SEPARATION_STATUSES,
  type SgkExitCode,
  type StaffSeparationReason,
  type StaffSeparationStatus,
} from '@kampus/school-core/lib/finance-staff-separations.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * İşten ayrılış dosyası (DOM-FIN-118; ON-180). Personel kaydı ayrı tablo değildir (üyelik
 * Oğuzhan'ın alanı); dosya üyeliğe bağlanır. Zimmet, hesap kapatma ve hizmet belgesi adımları
 * ilgili tablolardan okunur, saklanmaz; elle adımların (avans/icra, izin, kıdem) işaret anı ve
 * işaretleyeni burada (K-404). Tamamlanınca kullanılmayan izin günü dondurulur. Dosya silinmez;
 * açıkken gerekçeyle iptal edilir. Personelin tek açık dosyası olur (kısmi tekil indeks).
 */
export const staffSeparations = pgTable(
  'staff_separations',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id').notNull(),
    separationDate: date('separation_date', { mode: 'string' }).notNull(),
    // kvkk: K (ayrılış nedeni)
    reason: text('reason').$type<StaffSeparationReason>().notNull(),
    sgkExitCode: text('sgk_exit_code').$type<SgkExitCode>().notNull(),
    hireDate: date('hire_date', { mode: 'string' }),
    noticeGivenDate: date('notice_given_date', { mode: 'string' }),
    // kvkk: K (serbest metin)
    note: text('note'),
    status: text('status').$type<StaffSeparationStatus>().notNull().default('open'),
    deductionsCheckedAt: timestamp('deductions_checked_at', { withTimezone: true }),
    // kvkk: K
    deductionsCheckedByUserId: text('deductions_checked_by_user_id'),
    leaveCheckedAt: timestamp('leave_checked_at', { withTimezone: true }),
    // kvkk: K
    leaveCheckedByUserId: text('leave_checked_by_user_id'),
    severanceCheckedAt: timestamp('severance_checked_at', { withTimezone: true }),
    // kvkk: K
    severanceCheckedByUserId: text('severance_checked_by_user_id'),
    unusedLeaveDays: integer('unused_leave_days'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    // kvkk: K
    completedByUserId: text('completed_by_user_id'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    // kvkk: K
    cancelledByUserId: text('cancelled_by_user_id'),
    cancelReason: text('cancel_reason'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'staff_separations_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'staff_separations_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check('staff_separations_reason_check', oneOf(table.reason, STAFF_SEPARATION_REASONS)),
    check('staff_separations_sgk_code_check', oneOf(table.sgkExitCode, SGK_EXIT_CODES)),
    check('staff_separations_status_check', oneOf(table.status, STAFF_SEPARATION_STATUSES)),
    check(
      'staff_separations_dates_check',
      sql`(${table.hireDate} is null or ${table.hireDate} <= ${table.separationDate})
        and (${table.noticeGivenDate} is null or ${table.noticeGivenDate} <= ${table.separationDate})
        and (${table.hireDate} is null or ${table.noticeGivenDate} is null
          or ${table.noticeGivenDate} >= ${table.hireDate})`,
    ),
    check(
      'staff_separations_note_check',
      sql`${table.note} is null or char_length(${table.note}) between 1 and ${n(STAFF_SEPARATION_NOTE_MAX)}`,
    ),
    // İşaret anı ve işaretleyen birlikte dolu ya da boş.
    check(
      'staff_separations_marks_check',
      sql`(${table.deductionsCheckedAt} is null) = (${table.deductionsCheckedByUserId} is null)
        and (${table.leaveCheckedAt} is null) = (${table.leaveCheckedByUserId} is null)
        and (${table.severanceCheckedAt} is null) = (${table.severanceCheckedByUserId} is null)`,
    ),
    // Tamamlama alanları yalnız `completed`, iptal alanları yalnız `cancelled` durumunda dolu;
    // dondurulan izin günü yalnız tamamlanmış dosyada.
    check(
      'staff_separations_complete_check',
      sql`(${table.status} = 'completed') = (${table.completedAt} is not null)
        and (${table.status} = 'completed') = (${table.completedByUserId} is not null)
        and (${table.unusedLeaveDays} is null or ${table.status} = 'completed')`,
    ),
    check(
      'staff_separations_cancel_check',
      sql`(${table.status} = 'cancelled') = (${table.cancelledAt} is not null)
        and (${table.status} = 'cancelled') = (${table.cancelledByUserId} is not null)
        and (${table.status} = 'cancelled') = (${table.cancelReason} is not null)
        and (${table.cancelReason} is null or char_length(${table.cancelReason})
          between ${n(STAFF_SEPARATION_CANCEL_REASON_MIN)} and ${n(STAFF_SEPARATION_CANCEL_REASON_MAX)})`,
    ),
    uniqueIndex('staff_separations_open_key')
      .on(table.institutionId, table.membershipId)
      .where(sql`${table.status} = 'open'`),
    index('staff_separations_membership_idx').on(table.institutionId, table.membershipId),
    index('staff_separations_status_idx').on(
      table.institutionId,
      table.status,
      table.separationDate,
    ),
  ],
)
