import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
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
  REFERRAL_CANCEL_REASONS,
  REFERRAL_REWARD_STATUSES,
  type ReferralCancelReason,
  type ReferralRewardStatus,
} from '@kampus/school-core/lib/finance-referrals.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

/**
 * Referans indirimi hakkı (DOM-FIN-024; ON-139). Satır kesin kayıtta açılır, ilk taksit ödenince hak
 * doğar, sonraki sözleşmede bir kez kullanılır. Bir aday yalnız bir referansa bağlanır. Değer kesin
 * kayıtta o yılın tarifesinden kuruş olarak sabitlenir (K-14); uygulanan tutar `used_amount_cents`'tir.
 */
export const referralRewards = pgTable(
  'referral_rewards',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K
    prospectId: text('prospect_id').notNull(),
    // kvkk: K
    referrerStudentId: text('referrer_student_id').notNull(),
    // kvkk: K
    referrerParentId: text('referrer_parent_id').notNull(),
    // kvkk: K
    referredStudentId: text('referred_student_id').notNull(),
    academicYear: integer('academic_year').notNull(),
    tariffId: text('tariff_id').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    status: text('status').$type<ReferralRewardStatus>().notNull().default('pending'),
    earnedAt: timestamp('earned_at', { withTimezone: true }),
    usedAt: timestamp('used_at', { withTimezone: true }),
    usedContractId: text('used_contract_id'),
    // kvkk: K
    usedStudentId: text('used_student_id'),
    usedAmountCents: bigint('used_amount_cents', { mode: 'number' }),
    // kvkk: K
    usedByUserId: text('used_by_user_id'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason').$type<ReferralCancelReason>(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'referral_rewards_pkey', columns: [table.institutionId, table.id] }),
    check('referral_rewards_status_check', oneOf(table.status, REFERRAL_REWARD_STATUSES)),
    check(
      'referral_rewards_cancel_reason_check',
      sql`${table.cancelReason} is null or ${oneOf(table.cancelReason, REFERRAL_CANCEL_REASONS)}`,
    ),
    check('referral_rewards_amount_check', sql`${table.amountCents} > 0`),
    check(
      'referral_rewards_used_amount_check',
      sql`${table.usedAmountCents} is null or ${table.usedAmountCents} <= ${table.amountCents}`,
    ),
    check(
      'referral_rewards_used_check',
      sql`(${table.status} = 'used') = (${table.usedContractId} is not null)`,
    ),
    check(
      'referral_rewards_cancelled_check',
      sql`(${table.status} = 'cancelled') = (${table.cancelReason} is not null)`,
    ),
    uniqueIndex('referral_rewards_prospect_key')
      .on(table.institutionId, table.prospectId)
      .where(sql`${table.archivedAt} is null`),
    index('referral_rewards_referrer_parent_idx').on(table.institutionId, table.referrerParentId),
    index('referral_rewards_referrer_student_idx').on(table.institutionId, table.referrerStudentId),
    index('referral_rewards_referred_student_idx').on(table.institutionId, table.referredStudentId),
    index('referral_rewards_used_contract_idx').on(table.institutionId, table.usedContractId),
  ],
)
