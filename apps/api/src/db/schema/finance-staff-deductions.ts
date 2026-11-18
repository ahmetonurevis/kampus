import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  STAFF_ADVANCE_MAX_CENTS,
  STAFF_ADVANCE_MAX_INSTALLMENTS,
  STAFF_ADVANCE_PAYMENT_METHODS,
  STAFF_ADVANCE_STATUSES,
  STAFF_DEDUCTION_REASON_MAX,
  STAFF_DEDUCTION_REASON_MIN,
  STAFF_GARNISHMENT_CLOSE_REASONS,
  STAFF_GARNISHMENT_FILE_MAX,
  STAFF_GARNISHMENT_OFFICE_MAX,
  STAFF_GARNISHMENT_STATUSES,
  STAFF_PENSION_MIN_RATE_BPS,
  type StaffAdvancePaymentMethod,
  type StaffAdvanceStatus,
  type StaffGarnishmentCloseReason,
  type StaffGarnishmentStatus,
  type StaffPensionPause,
} from '@kampus/school-core/lib/finance-staff-deductions.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

const n = (value: number) => sql.raw(String(value))
const MONTH = sql.raw(`'^[0-9]{4}-(0[1-9]|1[0-2])$'`)

/**
 * Personel avansı (DOM-FIN-101; ON-199, K-312). Personel üyeliğine verilen avans; taksit planı
 * saklanmaz, tutar, taksit sayısı ve ilk aydan hesaplanır. Satır silinmez: erken kapama ve iptal
 * birer kez yazılır. Üyelik silinirse geçmiş korunur (`restrict`).
 */
export const staffAdvances = pgTable(
  'staff_advances',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id').notNull(),
    // kvkk: K (personelin borcu)
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    givenDate: date('given_date', { mode: 'string' }).notNull(),
    paymentMethod: text('payment_method').$type<StaffAdvancePaymentMethod>().notNull(),
    installmentCount: integer('installment_count').notNull(),
    firstMonth: text('first_month').notNull(),
    status: text('status').$type<StaffAdvanceStatus>().notNull().default('active'),
    closedDate: date('closed_date', { mode: 'string' }),
    closedFromMonth: text('closed_from_month'),
    closeMethod: text('close_method').$type<StaffAdvancePaymentMethod>(),
    // kvkk: K
    closedByUserId: text('closed_by_user_id'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    // kvkk: K
    cancelledByUserId: text('cancelled_by_user_id'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'staff_advances_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'staff_advances_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check(
      'staff_advances_amount_check',
      sql`${table.amountCents} between ${table.installmentCount} and ${n(STAFF_ADVANCE_MAX_CENTS)}
        and ${table.currency} = 'TRY'`,
    ),
    check(
      'staff_advances_installment_check',
      sql`${table.installmentCount} between 1 and ${n(STAFF_ADVANCE_MAX_INSTALLMENTS)}
        and ${table.firstMonth} ~ ${MONTH}`,
    ),
    check(
      'staff_advances_payment_method_check',
      oneOf(table.paymentMethod, STAFF_ADVANCE_PAYMENT_METHODS),
    ),
    check('staff_advances_status_check', oneOf(table.status, STAFF_ADVANCE_STATUSES)),
    // Erken kapama alanları yalnız `closed`, iptal alanları yalnız `cancelled` durumunda dolu.
    check(
      'staff_advances_close_check',
      sql`(${table.status} = 'closed') = (${table.closedDate} is not null)
        and (${table.status} = 'closed') = (${table.closedFromMonth} is not null)
        and (${table.status} = 'closed') = (${table.closeMethod} is not null)
        and (${table.status} = 'closed') = (${table.closedByUserId} is not null)
        and (${table.closedFromMonth} is null or ${table.closedFromMonth} ~ ${MONTH})
        and (${table.closeMethod} is null or ${oneOf(table.closeMethod, STAFF_ADVANCE_PAYMENT_METHODS)})`,
    ),
    check(
      'staff_advances_cancel_check',
      sql`(${table.status} = 'cancelled') = (${table.cancelledAt} is not null)
        and (${table.status} = 'cancelled') = (${table.cancelReason} is not null)
        and (${table.status} = 'cancelled') = (${table.cancelledByUserId} is not null)
        and (${table.cancelReason} is null or char_length(${table.cancelReason})
          between ${n(STAFF_DEDUCTION_REASON_MIN)} and ${n(STAFF_DEDUCTION_REASON_MAX)})`,
    ),
    index('staff_advances_membership_idx').on(
      table.institutionId,
      table.membershipId,
      table.givenDate,
    ),
  ],
)

/**
 * İcra (maaş haczi) kesintisi (DOM-FIN-101; ON-199, K-313). İcra dairesi müzekkeresi: daire, dosya,
 * alacak, oran, nafaka işareti ve tebliğ günü; kalan alacak daire yazısıyla güncellenir. Hassas
 * kişisel veridir (Ç): yalnız yönetici okur, okuma denetim kaydına düşer, değerler loglanmaz.
 * Kesinti sırası saklanmaz (nafaka önce, tebliğ günü, aynı gün `sequence`).
 */
export const staffGarnishments = pgTable(
  'staff_garnishments',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id').notNull(),
    // kvkk: Ç
    office: text('office').notNull(),
    // kvkk: Ç
    fileNumber: text('file_number').notNull(),
    // kvkk: Ç
    claimCents: bigint('claim_cents', { mode: 'number' }).notNull(),
    // kvkk: Ç
    remainingCents: bigint('remaining_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    rateBasisPoints: integer('rate_basis_points').notNull(),
    // kvkk: Ç
    isAlimony: boolean('is_alimony').notNull().default(false),
    receivedDate: date('received_date', { mode: 'string' }).notNull(),
    sequence: integer('sequence').notNull(),
    status: text('status').$type<StaffGarnishmentStatus>().notNull().default('active'),
    closedDate: date('closed_date', { mode: 'string' }),
    closeReason: text('close_reason').$type<StaffGarnishmentCloseReason>(),
    // kvkk: K
    closedByUserId: text('closed_by_user_id'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'staff_garnishments_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'staff_garnishments_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check(
      'staff_garnishments_text_check',
      sql`char_length(${table.office}) between 3 and ${n(STAFF_GARNISHMENT_OFFICE_MAX)}
        and char_length(${table.fileNumber}) between 3 and ${n(STAFF_GARNISHMENT_FILE_MAX)}`,
    ),
    check(
      'staff_garnishments_amount_check',
      sql`${table.claimCents} > 0 and ${table.remainingCents} between 0 and ${table.claimCents}
        and ${table.currency} = 'TRY'
        and ${table.rateBasisPoints} between 1 and 10000 and ${table.sequence} > 0`,
    ),
    check('staff_garnishments_status_check', oneOf(table.status, STAFF_GARNISHMENT_STATUSES)),
    check(
      'staff_garnishments_close_check',
      sql`(${table.status} = 'closed') = (${table.closedDate} is not null)
        and (${table.status} = 'closed') = (${table.closeReason} is not null)
        and (${table.status} = 'closed') = (${table.closedByUserId} is not null)
        and (${table.closedDate} is null or ${table.closedDate} >= ${table.receivedDate})
        and (${table.closeReason} is null or ${oneOf(table.closeReason, STAFF_GARNISHMENT_CLOSE_REASONS)})`,
    ),
    // Aynı personele aynı dairenin aynı dosyası iki kez yazılmaz (409).
    uniqueIndex('staff_garnishments_file_key')
      .on(table.institutionId, table.membershipId, table.office, table.fileNumber)
      .where(sql`${table.archivedAt} is null`),
    uniqueIndex('staff_garnishments_sequence_key').on(
      table.institutionId,
      table.membershipId,
      table.sequence,
    ),
  ],
)

/**
 * BES otomatik katılım kaydı (DOM-FIN-101; ON-199, K-314). Oran, başlangıç, ara vermeler ve cayma
 * ya da ayrılma günü; yalnız kayıttır, katkı emeklilik şirketine buradan aktarılmaz. Personelin
 * tek açık (ayrılmamış) katılımı `staff_pension_enrollments_open_key` ile güvencededir.
 */
export const staffPensionEnrollments = pgTable(
  'staff_pension_enrollments',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id').notNull(),
    rateBasisPoints: integer('rate_basis_points').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    pauses: jsonb('pauses').$type<StaffPensionPause[]>().notNull().default([]),
    optOutDate: date('opt_out_date', { mode: 'string' }),
    // kvkk: K
    optedOutByUserId: text('opted_out_by_user_id'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'staff_pension_enrollments_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'staff_pension_enrollments_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check(
      'staff_pension_enrollments_rate_check',
      sql`${table.rateBasisPoints} between ${n(STAFF_PENSION_MIN_RATE_BPS)} and 10000`,
    ),
    check('staff_pension_enrollments_pauses_check', sql`jsonb_typeof(${table.pauses}) = 'array'`),
    check(
      'staff_pension_enrollments_opt_out_check',
      sql`(${table.optOutDate} is null) = (${table.optedOutByUserId} is null)
        and (${table.optOutDate} is null or ${table.optOutDate} >= ${table.startDate})`,
    ),
    uniqueIndex('staff_pension_enrollments_open_key')
      .on(table.institutionId, table.membershipId)
      .where(sql`${table.optOutDate} is null and ${table.archivedAt} is null`),
    index('staff_pension_enrollments_membership_idx').on(table.institutionId, table.membershipId),
  ],
)
