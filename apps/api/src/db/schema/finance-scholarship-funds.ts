import { sql } from 'drizzle-orm'
import {
  bigint,
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
  SCHOLARSHIP_FUND_CHANNELS,
  SCHOLARSHIP_FUND_DONOR_KINDS,
} from '@kampus/school-core/lib/finance-scholarship-funds.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { scholarshipAwards } from './finance-scholarships.ts'

/**
 * Burs fonu (DOM-FIN-068; ON-259). Bağış kaynaklı fon; bakiye bağış ve atama satırlarından
 * hesaplanır, saklanmaz. Fon silinmez: sıfır bakiyede kapanır (`closed_at`). Bağışçı en az veriyle
 * tutulur (K-95): kişi ya da kurum adı, anonimde boş.
 */
export const scholarshipFunds = pgTable(
  'scholarship_funds',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    donorKind: text('donor_kind').notNull(),
    // kvkk: K (kişi bağışçının adı)
    donorName: text('donor_name'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    // kvkk: K
    closedByUserId: text('closed_by_user_id'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'scholarship_funds_pkey', columns: [table.institutionId, table.id] }),
    check(
      'scholarship_funds_donor_kind_check',
      oneOf(table.donorKind, SCHOLARSHIP_FUND_DONOR_KINDS),
    ),
    check(
      'scholarship_funds_donor_name_check',
      sql`(${table.donorKind} = 'anonymous') = (${table.donorName} is null)`,
    ),
    check(
      'scholarship_funds_closed_check',
      sql`(${table.closedAt} is null) = (${table.closedByUserId} is null)`,
    ),
    uniqueIndex('scholarship_funds_name_key')
      .on(table.institutionId, table.name)
      .where(sql`${table.archivedAt} is null and ${table.closedAt} is null`),
  ],
)

/** Fona bağış girişi; silinmez, gerekçeyle iptal edilir. Bakiyeyi eksiye düşüren iptal reddedilir. */
export const scholarshipFundDonations = pgTable(
  'scholarship_fund_donations',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    fundId: uuid('fund_id').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    donatedOn: date('donated_on', { mode: 'string' }).notNull(),
    channel: text('channel').notNull(),
    // kvkk: K (serbest metin; loglanmaz)
    note: text('note'),
    // kvkk: K
    recordedByUserId: text('recorded_by_user_id').notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    // kvkk: K
    cancelledByUserId: text('cancelled_by_user_id'),
    // kvkk: K (serbest metin; loglanmaz)
    cancelReason: text('cancel_reason'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'scholarship_fund_donations_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'scholarship_fund_donations_fund_fkey',
      columns: [table.institutionId, table.fundId],
      foreignColumns: [scholarshipFunds.institutionId, scholarshipFunds.id],
    }),
    check('scholarship_fund_donations_amount_check', sql`${table.amountCents} > 0`),
    check('scholarship_fund_donations_currency_check', sql`${table.currency} = 'TRY'`),
    check(
      'scholarship_fund_donations_channel_check',
      oneOf(table.channel, SCHOLARSHIP_FUND_CHANNELS),
    ),
    check(
      'scholarship_fund_donations_cancel_check',
      sql`(${table.cancelledAt} is null) = (${table.cancelledByUserId} is null) and (${table.cancelledAt} is null) = (${table.cancelReason} is null)`,
    ),
    index('scholarship_fund_donations_fund_idx').on(table.institutionId, table.fundId),
  ],
)

/**
 * Fondan burs ataması: mevcut burs atamasının (DOM-FIN-025) fondan karşılanan kısmı. Öğrenci ve
 * eğitim yılı atamadan kopyalanır. Aynı fondan aynı bursa tek geçerli atama; bursun bütün fonlardan
 * karşılanan toplamı burs tutarını aşamaz (servis kurum kilidi altında denetler, K-96).
 */
export const scholarshipFundAllocations = pgTable(
  'scholarship_fund_allocations',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    fundId: uuid('fund_id').notNull(),
    awardId: uuid('award_id').notNull(),
    // kvkk: K
    studentId: text('student_id').notNull(),
    academicYear: integer('academic_year').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    allocatedOn: date('allocated_on', { mode: 'string' }).notNull(),
    // kvkk: K
    allocatedByUserId: text('allocated_by_user_id').notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    // kvkk: K
    cancelledByUserId: text('cancelled_by_user_id'),
    // kvkk: K (serbest metin; loglanmaz)
    cancelReason: text('cancel_reason'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'scholarship_fund_allocations_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'scholarship_fund_allocations_fund_fkey',
      columns: [table.institutionId, table.fundId],
      foreignColumns: [scholarshipFunds.institutionId, scholarshipFunds.id],
    }),
    foreignKey({
      name: 'scholarship_fund_allocations_award_fkey',
      columns: [table.institutionId, table.awardId],
      foreignColumns: [scholarshipAwards.institutionId, scholarshipAwards.id],
    }),
    check('scholarship_fund_allocations_amount_check', sql`${table.amountCents} > 0`),
    check('scholarship_fund_allocations_currency_check', sql`${table.currency} = 'TRY'`),
    check(
      'scholarship_fund_allocations_cancel_check',
      sql`(${table.cancelledAt} is null) = (${table.cancelledByUserId} is null) and (${table.cancelledAt} is null) = (${table.cancelReason} is null)`,
    ),
    uniqueIndex('scholarship_fund_allocations_fund_award_key')
      .on(table.institutionId, table.fundId, table.awardId)
      .where(sql`${table.cancelledAt} is null and ${table.archivedAt} is null`),
    index('scholarship_fund_allocations_fund_idx').on(table.institutionId, table.fundId),
    index('scholarship_fund_allocations_award_idx').on(table.institutionId, table.awardId),
  ],
)
