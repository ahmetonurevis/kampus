import { sql } from 'drizzle-orm'
import {
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
  VISITOR_ANONYMIZATION_REASONS,
  VISITOR_BADGE_RELEASES,
  VISITOR_ID_DOCUMENT_TYPES,
  VISITOR_NAME_MAX,
  VISITOR_NOTICE_VERSION_MAX,
  VISITOR_PURPOSE_NOTE_MAX,
  VISITOR_PURPOSES,
  VISITOR_RETENTION_DEFAULT_DAYS,
  VISITOR_RETENTION_MAX_DAYS,
  VISITOR_RETENTION_MIN_DAYS,
  type VisitorAnonymizationReason,
  type VisitorBadgeRelease,
  type VisitorIdDocumentType,
  type VisitorPurpose,
} from '@kampus/school-core/lib/finance-visitors.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Ziyaretçi kaydı (DOM-FIN-141; ON-166, K-478…K-480). Girişte ad, kimlik görüldü işareti ve belge
 * türü (numara yok), isteğe bağlı telefon, amaç, ziyaret edilen üyelik, veli görüşmesinde öğrenci
 * (`records` kimliği), giriş anı, kart ve aydınlatma sürümü. `visit_on` girişin Europe/Istanbul
 * günüdür; gün süzgeci ve saklama süresinin başlangıcıdır. Kart iade ya da kayıp işaretlenene kadar
 * kartın tek açık kaydı olur (kısmi tekil indeks). Anonimleştirmede ad sabit metne, telefon, açıklama
 * ve öğrenci bağı boşa çekilir; satır silinmez.
 */
export const visitorLogs = pgTable(
  'visitor_logs',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K (ziyaretçi kimliği)
    visitorName: text('visitor_name').notNull(),
    identityVerified: boolean('identity_verified').notNull(),
    identityDocumentType: text('identity_document_type').$type<VisitorIdDocumentType>(),
    // kvkk: K (ziyaretçi iletişimi; yalnız maskeli gösterilir)
    phone: text('phone'),
    purpose: text('purpose').$type<VisitorPurpose>().notNull(),
    // kvkk: K (serbest metin)
    purposeNote: text('purpose_note'),
    // kvkk: K (ziyaret edilen personel üyeliği)
    hostMembershipId: text('host_membership_id'),
    // kvkk: K (records öğrenci kimliği)
    studentId: text('student_id'),
    visitOn: date('visit_on', { mode: 'string' }).notNull(),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }).notNull(),
    checkedOutAt: timestamp('checked_out_at', { withTimezone: true }),
    badgeNumber: text('badge_number'),
    badgeReleasedAt: timestamp('badge_released_at', { withTimezone: true }),
    badgeRelease: text('badge_release').$type<VisitorBadgeRelease>(),
    privacyNoticeVersion: text('privacy_notice_version').notNull(),
    anonymizedAt: timestamp('anonymized_at', { withTimezone: true }),
    anonymizationReason: text('anonymization_reason').$type<VisitorAnonymizationReason>(),
    // kvkk: K
    checkedInByUserId: text('checked_in_by_user_id').notNull(),
    // kvkk: K
    checkedOutByUserId: text('checked_out_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'visitor_logs_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'visitor_logs_host_membership_fkey',
      columns: [table.institutionId, table.hostMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check('visitor_logs_purpose_check', oneOf(table.purpose, VISITOR_PURPOSES)),
    check(
      'visitor_logs_identity_check',
      sql`(${table.identityVerified} and ${table.identityDocumentType} is not null and ${oneOf(table.identityDocumentType, VISITOR_ID_DOCUMENT_TYPES)}) or (not ${table.identityVerified} and ${table.identityDocumentType} is null)`,
    ),
    check(
      'visitor_logs_name_check',
      sql`char_length(${table.visitorName}) between 2 and ${n(VISITOR_NAME_MAX)}`,
    ),
    check(
      'visitor_logs_phone_check',
      sql`${table.phone} is null or ${table.phone} ~ '^0[0-9]{10}$'`,
    ),
    check(
      'visitor_logs_purpose_note_check',
      sql`(${table.purposeNote} is null or char_length(${table.purposeNote}) between 1 and ${n(VISITOR_PURPOSE_NOTE_MAX)}) and (${table.purpose} <> 'other' or ${table.purposeNote} is not null or ${table.anonymizedAt} is not null)`,
    ),
    check(
      'visitor_logs_student_check',
      sql`${table.studentId} is null or ${table.purpose} = 'parent_meeting'`,
    ),
    check(
      'visitor_logs_badge_check',
      sql`${table.badgeNumber} is null or ${table.badgeNumber} ~ '^[A-Z0-9-]{1,20}$'`,
    ),
    check(
      'visitor_logs_badge_release_check',
      sql`(${table.badgeReleasedAt} is null) = (${table.badgeRelease} is null) and (${table.badgeRelease} is null or (${table.badgeNumber} is not null and ${oneOf(table.badgeRelease, VISITOR_BADGE_RELEASES)}))`,
    ),
    check(
      'visitor_logs_check_out_check',
      sql`${table.checkedOutAt} is null or ${table.checkedOutAt} >= ${table.checkedInAt}`,
    ),
    check(
      'visitor_logs_checked_out_by_check',
      sql`(${table.checkedOutAt} is null) = (${table.checkedOutByUserId} is null)`,
    ),
    check(
      'visitor_logs_notice_check',
      sql`char_length(${table.privacyNoticeVersion}) between 1 and ${n(VISITOR_NOTICE_VERSION_MAX)}`,
    ),
    check(
      'visitor_logs_anonymized_check',
      sql`(${table.anonymizedAt} is null) = (${table.anonymizationReason} is null) and (${table.anonymizationReason} is null or ${oneOf(table.anonymizationReason, VISITOR_ANONYMIZATION_REASONS)}) and (${table.anonymizedAt} is null or (${table.checkedOutAt} is not null and ${table.phone} is null and ${table.purposeNote} is null and ${table.studentId} is null))`,
    ),
    index('visitor_logs_visit_on_idx').on(table.institutionId, table.visitOn),
    index('visitor_logs_inside_idx')
      .on(table.institutionId, table.checkedInAt)
      .where(sql`${table.checkedOutAt} is null`),
    index('visitor_logs_host_idx').on(table.institutionId, table.hostMembershipId),
    uniqueIndex('visitor_logs_badge_outstanding_key')
      .on(table.institutionId, table.badgeNumber)
      .where(sql`${table.badgeNumber} is not null and ${table.badgeReleasedAt} is null`),
  ],
)

/**
 * Ziyaretçi kaydı ayarı (DOM-FIN-141; K-479, K-480). Kurum başına bir satır; satır yoksa varsayılan
 * (30 gün, sürüm boş, kart havuzu boş, ayar sürümü 1).
 */
export const visitorSettings = pgTable(
  'visitor_settings',
  {
    institutionId: text('institution_id')
      .primaryKey()
      .references(() => institutions.id),
    retentionDays: integer('retention_days').notNull().default(VISITOR_RETENTION_DEFAULT_DAYS),
    privacyNoticeVersion: text('privacy_notice_version'),
    badgeNumbers: jsonb('badge_numbers').$type<string[]>().notNull().default([]),
    ...requiredColumns(),
  },
  (table) => [
    check(
      'visitor_settings_retention_check',
      sql`${table.retentionDays} between ${n(VISITOR_RETENTION_MIN_DAYS)} and ${n(VISITOR_RETENTION_MAX_DAYS)}`,
    ),
    check(
      'visitor_settings_notice_check',
      sql`${table.privacyNoticeVersion} is null or char_length(${table.privacyNoticeVersion}) between 1 and ${n(VISITOR_NOTICE_VERSION_MAX)}`,
    ),
    check('visitor_settings_badges_check', sql`jsonb_typeof(${table.badgeNumbers}) = 'array'`),
  ],
)
