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
  AGREEMENT_AMOUNT_MAX_CENTS,
  AGREEMENT_BENEFIT_NOTE_MAX,
  AGREEMENT_BENEFITS,
  AGREEMENT_DESCRIPTION_MAX,
  AGREEMENT_DESCRIPTION_MIN,
  AGREEMENT_NOTICE_DAYS_MAX,
  AGREEMENT_REASON_MAX,
  AGREEMENT_REASON_MIN,
  AGREEMENT_STATUSES,
  AGREEMENT_SUBJECT_MAX,
  AGREEMENT_SUBJECT_MIN,
  CONTRIBUTION_TYPES,
  STAKEHOLDER_CONTACT_NAME_MAX,
  STAKEHOLDER_EMAIL_MAX,
  STAKEHOLDER_NAME_MAX,
  STAKEHOLDER_NAME_MIN,
  STAKEHOLDER_TAGS_MAX,
  STAKEHOLDER_TYPES,
  type AgreementBenefit,
  type AgreementStatus,
  type ContributionType,
  type StakeholderType,
} from '@kampus/school-core/lib/finance-stakeholders.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { files } from './files.ts'

const n = (value: number) => sql.raw(String(value))
const BENEFIT_LIST = sql.raw(
  `array[${AGREEMENT_BENEFITS.map((value) => `'${value}'`).join(', ')}]::text[]`,
)

/**
 * Kurumsal paydaş (DOM-FIN-102; ON-262): sponsor, iş birliği kurumu, kurumsal paydaş, üniversite,
 * belediye/STK, veli derneği. VKN isteğe bağlı, verilmişse kurumda tekil (pasif dahil). Silinmez,
 * `is_active` ile pasifleşir (K-316). İletişim kişisi kişisel veridir; listede maskeli (K-317).
 */
export const stakeholders = pgTable(
  'stakeholders',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    name: text('name').notNull(),
    type: text('type').$type<StakeholderType>().notNull(),
    taxNumber: text('tax_number'),
    // kvkk: K
    contactName: text('contact_name'),
    // kvkk: K (listede maskeli)
    contactEmail: text('contact_email'),
    // kvkk: K (listede maskeli)
    contactPhone: text('contact_phone'),
    tags: text('tags')
      .array()
      .$type<string[]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    isActive: boolean('is_active').notNull().default(true),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'stakeholders_pkey', columns: [table.institutionId, table.id] }),
    check('stakeholders_type_check', oneOf(table.type, STAKEHOLDER_TYPES)),
    check(
      'stakeholders_text_check',
      sql`char_length(${table.name}) between ${n(STAKEHOLDER_NAME_MIN)} and ${n(STAKEHOLDER_NAME_MAX)}
        and (${table.taxNumber} is null or ${table.taxNumber} ~ '^[0-9]{10}$')
        and (${table.contactName} is null or char_length(${table.contactName}) between 2 and ${n(STAKEHOLDER_CONTACT_NAME_MAX)})
        and (${table.contactEmail} is null or char_length(${table.contactEmail}) <= ${n(STAKEHOLDER_EMAIL_MAX)})
        and (${table.contactPhone} is null or ${table.contactPhone} ~ '^0[0-9]{10}$')`,
    ),
    check('stakeholders_tags_check', sql`cardinality(${table.tags}) <= ${n(STAKEHOLDER_TAGS_MAX)}`),
    uniqueIndex('stakeholders_tax_number_key')
      .on(table.institutionId, table.taxNumber)
      .where(sql`${table.archivedAt} is null and ${table.taxNumber} is not null`),
    index('stakeholders_active_name_idx').on(table.institutionId, table.isActive, table.name),
  ],
)

/**
 * İş birliği ya da sponsorluk anlaşması (DOM-FIN-102). Saklanan durum taslak, yürürlükte,
 * feshedildi; "sona erdi" bitiş gününden hesaplanır (K-318). Sözleşme dosyası platform dosya
 * altyapısındadır (`files`, amaç `document`, bağ türü `stakeholder_agreement`).
 */
export const stakeholderAgreements = pgTable(
  'stakeholder_agreements',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    stakeholderId: uuid('stakeholder_id').notNull(),
    subject: text('subject').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    renewalNoticeDays: integer('renewal_notice_days').notNull(),
    contributionType: text('contribution_type').$type<ContributionType>().notNull(),
    contributionAmountCents: bigint('contribution_amount_cents', { mode: 'number' }),
    currency: text('currency').notNull().default('TRY'),
    contributionDescription: text('contribution_description'),
    benefits: text('benefits')
      .array()
      .$type<AgreementBenefit[]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    benefitNote: text('benefit_note'),
    contractFileId: uuid('contract_file_id'),
    status: text('status').$type<AgreementStatus>().notNull().default('draft'),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    terminationDate: date('termination_date', { mode: 'string' }),
    terminationReason: text('termination_reason'),
    terminatedAt: timestamp('terminated_at', { withTimezone: true }),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'stakeholder_agreements_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'stakeholder_agreements_stakeholder_fkey',
      columns: [table.institutionId, table.stakeholderId],
      foreignColumns: [stakeholders.institutionId, stakeholders.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'stakeholder_agreements_contract_file_fkey',
      columns: [table.institutionId, table.contractFileId],
      foreignColumns: [files.institutionId, files.id],
    }).onDelete('restrict'),
    check('stakeholder_agreements_status_check', oneOf(table.status, AGREEMENT_STATUSES)),
    check(
      'stakeholder_agreements_contribution_type_check',
      oneOf(table.contributionType, CONTRIBUTION_TYPES),
    ),
    check(
      'stakeholder_agreements_text_check',
      sql`char_length(${table.subject}) between ${n(AGREEMENT_SUBJECT_MIN)} and ${n(AGREEMENT_SUBJECT_MAX)}
        and (${table.contributionDescription} is null
          or char_length(${table.contributionDescription}) between 1 and ${n(AGREEMENT_DESCRIPTION_MAX)})
        and (${table.benefitNote} is null or char_length(${table.benefitNote}) between 1 and ${n(AGREEMENT_BENEFIT_NOTE_MAX)})`,
    ),
    check(
      'stakeholder_agreements_terms_check',
      sql`${table.endDate} >= ${table.startDate}
        and ${table.renewalNoticeDays} between 0 and ${n(AGREEMENT_NOTICE_DAYS_MAX)}
        and ${table.currency} = 'TRY'
        and (${table.contributionAmountCents} is null
          or ${table.contributionAmountCents} between 1 and ${n(AGREEMENT_AMOUNT_MAX_CENTS)})
        and (${table.contributionType} <> 'cash' or ${table.contributionAmountCents} is not null)
        and (${table.contributionType} = 'cash'
          or char_length(coalesce(${table.contributionDescription}, '')) >= ${n(AGREEMENT_DESCRIPTION_MIN)})
        and ${table.benefits} <@ ${BENEFIT_LIST}`,
    ),
    // Fesih alanları yalnız feshedilmiş anlaşmada ve birlikte dolar; yürürlüğe alma zamanı
    // taslakta boştur.
    check(
      'stakeholder_agreements_status_fields_check',
      sql`((${table.status} = 'terminated') = (${table.terminationDate} is not null))
        and ((${table.status} = 'terminated') = (${table.terminatedAt} is not null))
        and ((${table.status} = 'terminated') = (${table.terminationReason} is not null))
        and ((${table.status} = 'draft') = (${table.activatedAt} is null))
        and (${table.terminationReason} is null
          or char_length(${table.terminationReason}) between ${n(AGREEMENT_REASON_MIN)} and ${n(AGREEMENT_REASON_MAX)})
        and (${table.terminationDate} is null
          or ${table.terminationDate} between ${table.startDate} and ${table.endDate})`,
    ),
    index('stakeholder_agreements_stakeholder_idx').on(
      table.institutionId,
      table.stakeholderId,
      table.startDate,
    ),
    index('stakeholder_agreements_end_idx').on(table.institutionId, table.status, table.endDate),
    index('stakeholder_agreements_contract_file_idx').on(table.institutionId, table.contractFileId),
  ],
)
