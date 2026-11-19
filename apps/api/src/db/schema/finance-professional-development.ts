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
  PROFESSIONAL_DEVELOPMENT_CAPACITY_MAX,
  PROFESSIONAL_DEVELOPMENT_ENROLLMENT_ORIGINS,
  PROFESSIONAL_DEVELOPMENT_ENROLLMENT_STATUSES,
  PROFESSIONAL_DEVELOPMENT_FEE_MAX_CENTS,
  PROFESSIONAL_DEVELOPMENT_KINDS,
  PROFESSIONAL_DEVELOPMENT_LOCATION_MAX,
  PROFESSIONAL_DEVELOPMENT_MAX_MINUTES,
  PROFESSIONAL_DEVELOPMENT_NAME_MAX,
  PROFESSIONAL_DEVELOPMENT_NAME_MIN,
  PROFESSIONAL_DEVELOPMENT_PROVIDER_MAX,
  PROFESSIONAL_DEVELOPMENT_STATUSES,
  PROFESSIONAL_DEVELOPMENT_URL_MAX,
  type ProfessionalDevelopmentEnrollmentOrigin,
  type ProfessionalDevelopmentEnrollmentStatus,
  type ProfessionalDevelopmentKind,
  type ProfessionalDevelopmentStatus,
} from '@kampus/school-core/lib/finance-professional-development.ts'
import type { StaffRole } from '@kampus/school-core/lib/staff-accounts.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { costCenters } from './finance-budget.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Mesleki gelişim kataloğu (DOM-FIN-125; ON-214). Kurs, seminer, konferans, kurum içi ve çevrim içi
 * eğitimler; durum taslak → yayında → arşiv (K-431). Süre dakika tutulur (yarım saat adımlı).
 * Satır silinmez, arşivlenir.
 */
export const professionalDevelopmentPrograms = pgTable(
  'professional_development_programs',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    name: text('name').notNull(),
    kind: text('kind').$type<ProfessionalDevelopmentKind>().notNull(),
    provider: text('provider').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    ongoing: boolean('ongoing').notNull().default(false),
    startDate: date('start_date', { mode: 'string' }),
    endDate: date('end_date', { mode: 'string' }),
    location: text('location'),
    onlineUrl: text('online_url'),
    audienceRoles: jsonb('audience_roles').$type<StaffRole[]>().notNull(),
    audienceBranches: jsonb('audience_branches').$type<string[]>().notNull(),
    feeCents: bigint('fee_cents', { mode: 'number' }),
    costCenterId: uuid('cost_center_id'),
    capacity: integer('capacity'),
    status: text('status').$type<ProfessionalDevelopmentStatus>().notNull(),
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'professional_development_programs_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'professional_development_programs_cost_center_fkey',
      columns: [table.institutionId, table.costCenterId],
      foreignColumns: [costCenters.institutionId, costCenters.id],
    }).onDelete('restrict'),
    check(
      'professional_development_programs_kind_check',
      oneOf(table.kind, PROFESSIONAL_DEVELOPMENT_KINDS),
    ),
    check(
      'professional_development_programs_status_check',
      oneOf(table.status, PROFESSIONAL_DEVELOPMENT_STATUSES),
    ),
    check(
      'professional_development_programs_text_check',
      sql`char_length(${table.name}) between ${n(PROFESSIONAL_DEVELOPMENT_NAME_MIN)} and ${n(PROFESSIONAL_DEVELOPMENT_NAME_MAX)}
        and char_length(${table.provider}) between 2 and ${n(PROFESSIONAL_DEVELOPMENT_PROVIDER_MAX)}
        and (${table.location} is null or char_length(${table.location}) between 1 and ${n(PROFESSIONAL_DEVELOPMENT_LOCATION_MAX)})
        and (${table.onlineUrl} is null or (char_length(${table.onlineUrl}) <= ${n(PROFESSIONAL_DEVELOPMENT_URL_MAX)} and ${table.onlineUrl} like 'https://%'))
        and (${table.location} is not null or ${table.onlineUrl} is not null)`,
    ),
    check(
      'professional_development_programs_duration_check',
      sql`${table.durationMinutes} > 0 and ${table.durationMinutes} <= ${n(PROFESSIONAL_DEVELOPMENT_MAX_MINUTES)} and ${table.durationMinutes} % 30 = 0`,
    ),
    // Sürekli eğitimde tarih yok; değilse iki gün de var ve sıralı.
    check(
      'professional_development_programs_dates_check',
      sql`(${table.ongoing} and ${table.startDate} is null and ${table.endDate} is null)
        or (not ${table.ongoing} and ${table.startDate} is not null and ${table.endDate} is not null
          and ${table.endDate} >= ${table.startDate})`,
    ),
    check(
      'professional_development_programs_fee_check',
      sql`(${table.feeCents} is null or ${table.feeCents} between 0 and ${n(PROFESSIONAL_DEVELOPMENT_FEE_MAX_CENTS)})
        and (${table.costCenterId} is null or ${table.feeCents} is not null)`,
    ),
    check(
      'professional_development_programs_capacity_check',
      sql`${table.capacity} is null or ${table.capacity} between 1 and ${n(PROFESSIONAL_DEVELOPMENT_CAPACITY_MAX)}`,
    ),
    check(
      'professional_development_programs_audience_check',
      sql`jsonb_typeof(${table.audienceRoles}) = 'array' and jsonb_typeof(${table.audienceBranches}) = 'array'`,
    ),
    index('professional_development_programs_status_idx').on(
      table.institutionId,
      table.status,
      table.startDate,
    ),
    index('professional_development_programs_cost_center_idx').on(
      table.institutionId,
      table.costCenterId,
    ),
  ],
)

/**
 * Personelin eğitime ataması ya da katılım isteği (DOM-FIN-125; K-432). Personel kurum üyeliğidir;
 * aynı personel aynı eğitime bir kez. Katılım saati yalnız "katıldı" durumunda. Sertifika (ON-215)
 * burada tutulmaz.
 */
export const professionalDevelopmentEnrollments = pgTable(
  'professional_development_enrollments',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    programId: uuid('program_id').notNull(),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id').notNull(),
    origin: text('origin').$type<ProfessionalDevelopmentEnrollmentOrigin>().notNull(),
    status: text('status').$type<ProfessionalDevelopmentEnrollmentStatus>().notNull(),
    attendedMinutes: integer('attended_minutes'),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }).notNull(),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'professional_development_enrollments_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'professional_development_enrollments_program_fkey',
      columns: [table.institutionId, table.programId],
      foreignColumns: [
        professionalDevelopmentPrograms.institutionId,
        professionalDevelopmentPrograms.id,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'professional_development_enrollments_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check(
      'professional_development_enrollments_origin_check',
      oneOf(table.origin, PROFESSIONAL_DEVELOPMENT_ENROLLMENT_ORIGINS),
    ),
    check(
      'professional_development_enrollments_status_check',
      oneOf(table.status, PROFESSIONAL_DEVELOPMENT_ENROLLMENT_STATUSES),
    ),
    check(
      'professional_development_enrollments_attended_check',
      sql`((${table.status} = 'attended') = (${table.attendedMinutes} is not null))
        and (${table.attendedMinutes} is null or (${table.attendedMinutes} > 0 and ${table.attendedMinutes} % 30 = 0))`,
    ),
    uniqueIndex('professional_development_enrollments_member_key').on(
      table.institutionId,
      table.programId,
      table.membershipId,
    ),
    index('professional_development_enrollments_membership_idx').on(
      table.institutionId,
      table.membershipId,
    ),
  ],
)
