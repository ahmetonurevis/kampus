import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
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
  DONATION_CAMPAIGN_STATUSES,
  DONATION_KINDS,
  DONATION_METHODS,
  DONOR_KINDS,
  DONOR_RELATIONS,
} from '@kampus/school-core/lib/finance-donations.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { bankAccounts } from './payments.ts'

/**
 * Bağış kampanyası (DOM-FIN-097; ON-258). Taslak → açık → kapandı; toplanan tutar bağış
 * satırlarından hesaplanır, saklanmaz. Banka hesabı isteğe bağlıdır, havale bağışının varsayılanıdır.
 */
export const donationCampaigns = pgTable(
  'donation_campaigns',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    name: text('name').notNull(),
    purpose: text('purpose').notNull(),
    targetCents: bigint('target_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    endsOn: date('ends_on', { mode: 'string' }).notNull(),
    bankAccountId: uuid('bank_account_id'),
    status: text('status').notNull().default('draft'),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    // kvkk: K
    openedByUserId: text('opened_by_user_id'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    // kvkk: K
    closedByUserId: text('closed_by_user_id'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'donation_campaigns_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'donation_campaigns_bank_account_fkey',
      columns: [table.institutionId, table.bankAccountId],
      foreignColumns: [bankAccounts.institutionId, bankAccounts.id],
    }).onDelete('restrict'),
    check('donation_campaigns_target_check', sql`${table.targetCents} > 0`),
    check('donation_campaigns_currency_check', sql`${table.currency} = 'TRY'`),
    check('donation_campaigns_dates_check', sql`${table.endsOn} >= ${table.startsOn}`),
    check('donation_campaigns_status_check', oneOf(table.status, DONATION_CAMPAIGN_STATUSES)),
    check(
      'donation_campaigns_opened_check',
      sql`(${table.status} = 'draft') = (${table.openedAt} is null) and (${table.openedAt} is null) = (${table.openedByUserId} is null)`,
    ),
    check(
      'donation_campaigns_closed_check',
      sql`(${table.status} = 'closed') = (${table.closedAt} is not null) and (${table.closedAt} is null) = (${table.closedByUserId} is null)`,
    ),
    uniqueIndex('donation_campaigns_name_key')
      .on(table.institutionId, table.name)
      .where(sql`${table.archivedAt} is null`),
    index('donation_campaigns_bank_account_idx').on(table.institutionId, table.bankAccountId),
  ],
)

/**
 * Bağışçı (DOM-FIN-097, K-298): kişi ya da kurum. Kimlik numarası, iletişim ve veli/mezun bağı
 * isteğe bağlıdır; kimlik numarası kurumda tekildir. Anonim bağışçı kaydı yoktur.
 */
export const donors = pgTable(
  'donors',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    kind: text('kind').notNull(),
    // kvkk: K (kişi bağışçının adı)
    name: text('name').notNull(),
    // kvkk: K (kişide TCKN; listede maskeli, loglanmaz)
    identityNumber: text('identity_number'),
    // kvkk: K
    phone: text('phone'),
    // kvkk: K
    email: text('email'),
    // kvkk: K
    address: text('address'),
    // kvkk: K (records öğrenci kimliği)
    studentId: text('student_id'),
    relation: text('relation'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'donors_pkey', columns: [table.institutionId, table.id] }),
    check('donors_kind_check', oneOf(table.kind, DONOR_KINDS)),
    check(
      'donors_identity_number_check',
      sql`${table.identityNumber} is null or ${table.identityNumber} ~ '^[0-9]{10,11}$'`,
    ),
    check(
      'donors_relation_check',
      sql`(${table.studentId} is null) = (${table.relation} is null) and (${table.relation} is null or ${oneOf(table.relation, DONOR_RELATIONS)})`,
    ),
    uniqueIndex('donors_identity_number_key')
      .on(table.institutionId, table.identityNumber)
      .where(sql`${table.identityNumber} is not null and ${table.archivedAt} is null`),
  ],
)

/**
 * Bağış ve makbuzu (DOM-FIN-097, K-297): her satır kurumda yıl bazlı sıralı bir makbuz numarasıdır.
 * Silinmez, tutarı değişmez; iptal aynı satıra gerekçeyle yazılır, numara yeniden kullanılmaz.
 * Bağışçının adı, türü ve kimlik numarası makbuz için kopyalanır; anonim bağışta üçü de boştur.
 */
export const donations = pgTable(
  'donations',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    campaignId: uuid('campaign_id').notNull(),
    donorId: uuid('donor_id'),
    donorKind: text('donor_kind'),
    // kvkk: K
    donorName: text('donor_name'),
    // kvkk: K (kişide TCKN; loglanmaz)
    donorIdentityNumber: text('donor_identity_number'),
    kind: text('kind').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }),
    currency: text('currency').notNull().default('TRY'),
    method: text('method'),
    bankAccountId: uuid('bank_account_id'),
    // kvkk: K (dekont ya da slip numarası; loglanmaz)
    reference: text('reference'),
    description: text('description'),
    declaredValueCents: bigint('declared_value_cents', { mode: 'number' }),
    donatedOn: date('donated_on', { mode: 'string' }).notNull(),
    // kvkk: K (serbest metin; loglanmaz)
    note: text('note'),
    receiptYear: integer('receipt_year').notNull(),
    receiptNumber: integer('receipt_number').notNull(),
    taxNotice: text('tax_notice'),
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
    primaryKey({ name: 'donations_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'donations_campaign_fkey',
      columns: [table.institutionId, table.campaignId],
      foreignColumns: [donationCampaigns.institutionId, donationCampaigns.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'donations_donor_fkey',
      columns: [table.institutionId, table.donorId],
      foreignColumns: [donors.institutionId, donors.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'donations_bank_account_fkey',
      columns: [table.institutionId, table.bankAccountId],
      foreignColumns: [bankAccounts.institutionId, bankAccounts.id],
    }).onDelete('restrict'),
    check('donations_kind_check', oneOf(table.kind, DONATION_KINDS)),
    check('donations_currency_check', sql`${table.currency} = 'TRY'`),
    check(
      'donations_method_check',
      sql`${table.method} is null or ${oneOf(table.method, DONATION_METHODS)}`,
    ),
    check(
      'donations_cash_check',
      sql`(${table.kind} = 'cash') = (${table.amountCents} is not null and ${table.method} is not null) and (${table.kind} = 'in_kind') = (${table.description} is not null)`,
    ),
    check('donations_amount_check', sql`${table.amountCents} is null or ${table.amountCents} > 0`),
    check(
      'donations_declared_value_check',
      sql`${table.declaredValueCents} is null or (${table.kind} = 'in_kind' and ${table.declaredValueCents} > 0)`,
    ),
    check(
      'donations_bank_account_check',
      sql`(${table.bankAccountId} is not null) = (${table.method} is not null and ${table.method} = 'bank_transfer')`,
    ),
    check(
      'donations_donor_check',
      sql`(${table.donorId} is null) = (${table.donorName} is null) and (${table.donorId} is null) = (${table.donorKind} is null) and (${table.donorId} is not null or (${table.donorIdentityNumber} is null and ${table.taxNotice} is null))`,
    ),
    check(
      'donations_cancel_check',
      sql`(${table.cancelledAt} is null) = (${table.cancelledByUserId} is null) and (${table.cancelledAt} is null) = (${table.cancelReason} is null)`,
    ),
    uniqueIndex('donations_receipt_key').on(
      table.institutionId,
      table.receiptYear,
      table.receiptNumber,
    ),
    index('donations_campaign_idx').on(table.institutionId, table.campaignId, table.donatedOn),
    index('donations_donor_idx').on(table.institutionId, table.donorId),
    index('donations_bank_account_idx').on(table.institutionId, table.bankAccountId),
  ],
)

/**
 * Kurumun bağış ayarı (K-299): makbuza yazılacak vergi indirimi ibaresi. Satır yoksa ibare kapalı,
 * sürüm 1 sayılır; ilk değişiklik satırı sürüm 2 ile açar.
 */
export const donationSettings = pgTable(
  'donation_settings',
  {
    institutionId: text('institution_id')
      .primaryKey()
      .references(() => institutions.id),
    taxNoticeEnabled: boolean('tax_notice_enabled').notNull().default(false),
    taxNoticeText: text('tax_notice_text'),
    ...requiredColumns(),
  },
  (table) => [
    check(
      'donation_settings_tax_notice_check',
      sql`not ${table.taxNoticeEnabled} or ${table.taxNoticeText} is not null`,
    ),
  ],
)
