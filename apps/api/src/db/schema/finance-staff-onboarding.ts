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
  PAY_RATE_AMOUNT_MAX_CENTS,
  WAGE_TYPES,
  type WageType,
} from '@kampus/school-core/lib/finance-pay-rates.ts'
import {
  CANDIDATE_EMAIL_MAX,
  CANDIDATE_NAME_MAX,
  CANDIDATE_NAME_MIN,
  JOB_OFFER_NOTE_MAX,
  JOB_OFFER_REASON_MAX,
  JOB_OFFER_STATUSES,
  JOB_POSITION_MAX,
  JOB_POSITION_MIN,
  ONBOARDING_STEP_KINDS,
  ONBOARDING_STEP_LABEL_MAX,
  ONBOARDING_STEP_LABEL_MIN,
  ONBOARDING_STEP_NOTE_MAX,
  type JobOfferStatus,
  type OnboardingStepKind,
  type OrientationStep,
} from '@kampus/school-core/lib/finance-staff-onboarding.ts'
import {
  STAFF_DOCUMENT_TYPES,
  type StaffDocumentType,
} from '@kampus/school-core/lib/finance-staff-documents.ts'
import { STAFF_ROLES, type StaffRole } from '@kampus/school-core/lib/staff-accounts.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * İşe başlama kurum ayarı (DOM-FIN-121; ON-179, K-413): yeni listelere kopyalanan oryantasyon
 * adımları. Satır yoksa core varsayılanı (`DEFAULT_ORIENTATION_STEPS`) kullanılır.
 */
export const staffOnboardingSettings = pgTable('staff_onboarding_settings', {
  institutionId: text('institution_id')
    .primaryKey()
    .references(() => institutions.id),
  orientationSteps: jsonb('orientation_steps').$type<OrientationStep[]>().notNull(),
  updatedByUserId: text('updated_by_user_id').notNull(),
  ...requiredColumns(),
})

/**
 * İş teklifi (DOM-FIN-121; ON-179, K-412). Aday kurumda personel değilse yalnız adı ve iletişimi
 * tutulur (personel tablosu yoktur); personelse üyeliğine bağlanır. Kabulden sonra işe başlama
 * listesinin hesap adımı da aynı `membership_id`'dir (davetle açılan hesap bağlanır; IST-007).
 * Gönderilen teklif değişmez; satır silinmez.
 */
export const staffJobOffers = pgTable(
  'staff_job_offers',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    membershipId: text('membership_id'),
    candidateName: text('candidate_name'),
    candidateEmail: text('candidate_email'),
    candidatePhone: text('candidate_phone'),
    position: text('position').notNull(),
    staffRole: text('staff_role').$type<StaffRole>().notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    wageType: text('wage_type').$type<WageType>().notNull(),
    offeredAmountCents: bigint('offered_amount_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    respondBy: date('respond_by', { mode: 'string' }),
    note: text('note'),
    status: text('status').$type<JobOfferStatus>().notNull(),
    sentOn: date('sent_on', { mode: 'string' }),
    acceptedOn: date('accepted_on', { mode: 'string' }),
    closedOn: date('closed_on', { mode: 'string' }),
    closeReason: text('close_reason'),
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'staff_job_offers_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'staff_job_offers_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check('staff_job_offers_status_check', oneOf(table.status, JOB_OFFER_STATUSES)),
    check('staff_job_offers_role_check', oneOf(table.staffRole, STAFF_ROLES)),
    check('staff_job_offers_wage_type_check', oneOf(table.wageType, WAGE_TYPES)),
    check('staff_job_offers_currency_check', sql`${table.currency} = 'TRY'`),
    check(
      'staff_job_offers_amount_check',
      sql`${table.offeredAmountCents} > 0 and ${table.offeredAmountCents} <= ${n(PAY_RATE_AMOUNT_MAX_CENTS)}`,
    ),
    check(
      'staff_job_offers_candidate_check',
      sql`(${table.membershipId} is not null or ${table.candidateName} is not null)
        and (${table.candidateName} is null
          or char_length(${table.candidateName}) between ${n(CANDIDATE_NAME_MIN)} and ${n(CANDIDATE_NAME_MAX)})
        and (${table.candidateEmail} is null
          or char_length(${table.candidateEmail}) between 3 and ${n(CANDIDATE_EMAIL_MAX)})
        and (${table.candidatePhone} is null or ${table.candidatePhone} ~ '^0[0-9]{10}$')`,
    ),
    check(
      'staff_job_offers_position_check',
      sql`char_length(${table.position}) between ${n(JOB_POSITION_MIN)} and ${n(JOB_POSITION_MAX)}`,
    ),
    check(
      'staff_job_offers_text_check',
      sql`(${table.note} is null or char_length(${table.note}) between 1 and ${n(JOB_OFFER_NOTE_MAX)})
        and (${table.closeReason} is null
          or char_length(${table.closeReason}) between 1 and ${n(JOB_OFFER_REASON_MAX)})`,
    ),
    check(
      'staff_job_offers_dates_check',
      sql`(${table.status} <> 'draft' or ${table.sentOn} is null)
        and (${table.status} not in ('sent', 'accepted', 'rejected') or ${table.sentOn} is not null)
        and ((${table.status} = 'accepted') <= (${table.acceptedOn} is not null))
        and (${table.status} not in ('draft', 'sent', 'rejected') or ${table.acceptedOn} is null)
        and ((${table.status} in ('rejected', 'withdrawn')) = (${table.closedOn} is not null))
        and (${table.closedOn} is not null or ${table.closeReason} is null)
        and (${table.acceptedOn} is null or ${table.acceptedOn} >= ${table.sentOn})
        and (${table.closedOn} is null or ${table.sentOn} is null or ${table.closedOn} >= ${table.sentOn})
        and (${table.closedOn} is null or ${table.acceptedOn} is null or ${table.closedOn} >= ${table.acceptedOn})`,
    ),
    index('staff_job_offers_status_idx').on(table.institutionId, table.status, table.startDate),
    index('staff_job_offers_membership_idx').on(table.institutionId, table.membershipId),
  ],
)

/**
 * İşe başlama listesinin adımı (DOM-FIN-121; ON-179, K-413, K-414). Adımlar teklif kabul edilince
 * açılır ve silinmez; sıra `position`. Özlük belgesi adımı türünü taşır. Tamamlanma günü, anı ve
 * işaretleyen birlikte yazılır, geri alınınca birlikte silinir.
 */
export const staffOnboardingSteps = pgTable(
  'staff_onboarding_steps',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    offerId: uuid('offer_id').notNull(),
    position: integer('position').notNull(),
    kind: text('kind').$type<OnboardingStepKind>().notNull(),
    documentType: text('document_type').$type<StaffDocumentType>(),
    label: text('label').notNull(),
    required: boolean('required').notNull(),
    responsibleMembershipId: text('responsible_membership_id'),
    dueDate: date('due_date', { mode: 'string' }),
    completedOn: date('completed_on', { mode: 'string' }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedByUserId: text('completed_by_user_id'),
    note: text('note'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'staff_onboarding_steps_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'staff_onboarding_steps_offer_fkey',
      columns: [table.institutionId, table.offerId],
      foreignColumns: [staffJobOffers.institutionId, staffJobOffers.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'staff_onboarding_steps_responsible_fkey',
      columns: [table.institutionId, table.responsibleMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check('staff_onboarding_steps_kind_check', oneOf(table.kind, ONBOARDING_STEP_KINDS)),
    check(
      'staff_onboarding_steps_document_check',
      sql`((${table.kind} = 'document') = (${table.documentType} is not null))
        and (${table.documentType} is null or ${oneOf(table.documentType, STAFF_DOCUMENT_TYPES)})`,
    ),
    check(
      'staff_onboarding_steps_label_check',
      sql`char_length(${table.label}) between ${n(ONBOARDING_STEP_LABEL_MIN)} and ${n(ONBOARDING_STEP_LABEL_MAX)}`,
    ),
    check(
      'staff_onboarding_steps_completed_check',
      sql`((${table.completedOn} is null) = (${table.completedAt} is null))
        and ((${table.completedOn} is null) = (${table.completedByUserId} is null))
        and (${table.completedOn} is not null or ${table.note} is null)
        and (${table.note} is null or char_length(${table.note}) between 1 and ${n(ONBOARDING_STEP_NOTE_MAX)})`,
    ),
    uniqueIndex('staff_onboarding_steps_position_key').on(
      table.institutionId,
      table.offerId,
      table.position,
    ),
    index('staff_onboarding_steps_responsible_idx').on(
      table.institutionId,
      table.responsibleMembershipId,
    ),
  ],
)
