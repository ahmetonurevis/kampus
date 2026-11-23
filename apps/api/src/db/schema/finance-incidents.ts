import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  INCIDENT_KINDS,
  INCIDENT_LOCATION_MAX,
  INCIDENT_LOCATION_MIN,
  INCIDENT_NOTIFICATION_CHANNELS,
  INCIDENT_STATUSES,
  INJURED_KINDS,
  type IncidentKind,
  type IncidentNotificationChannel,
  type IncidentStatus,
  type InjuredKind,
} from '@kampus/school-core/lib/finance-incidents.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Kaza ve yaralanma tutanağı (DOM-FIN-146; ON-162; K-493…K-495). Yaralanan öğrenci kaydı
 * (`records`, yabancı anahtar yok) ya da personel üyeliğidir. Açıklama ile sağlık grubu (bölge,
 * şiddet, yaralanma notu, ilk müdahale, sevk) uygulama düzeyinde şifrelidir (AES-256-GCM, kurum
 * anahtarı `FIELD_ENCRYPTION_KEY`'den; `src/lib/field-crypto.ts`); şifreli değer kurum, satır,
 * tablo, kolon ve yaralanana bağlıdır. Sağlık profili (IST-020) buraya kopyalanmaz. Kesinleşen
 * satır değişmez ve silinmez (tetikleyici); düzeltme `incident_report_addenda`'dadır.
 */
export const incidentReports = pgTable(
  'incident_reports',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    status: text('status').$type<IncidentStatus>().notNull().default('draft'),
    injuredKind: text('injured_kind').$type<InjuredKind>().notNull(),
    // kvkk: Ç — yaralanan öğrenci kaydı
    studentId: text('student_id'),
    // kvkk: K — yaralanan personel üyeliği
    injuredMembershipId: text('injured_membership_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    location: text('location').notNull(),
    kind: text('kind').$type<IncidentKind>().notNull(),
    // kvkk: Ç — şifreli olay anlatımı: base64(IV ‖ GCM etiketi ‖ şifreli metin); düz metin yok
    descriptionCiphertext: text('description_ciphertext').notNull(),
    // Kişisel veri değil: yalnız anahtar sürümü.
    descriptionKeyVersion: integer('description_key_version').notNull(),
    // kvkk: Ö — şifreli sağlık grubu (bölge, şiddet, not, ilk müdahale, sevk; JSON); düz metin yok
    healthCiphertext: text('health_ciphertext').notNull(),
    // Kişisel veri değil: yalnız anahtar sürümü.
    healthKeyVersion: integer('health_key_version').notNull(),
    // kvkk: K — ilk müdahaleyi yapan personel (kurum dışındaysa boş)
    firstAidByMembershipId: text('first_aid_by_membership_id'),
    // kvkk: K — sorumlu personel
    responsibleMembershipId: text('responsible_membership_id').notNull(),
    // kvkk: K — tutanağı açan (erişim bu kullanıcıya bağlıdır, K-494)
    createdByUserId: text('created_by_user_id').notNull(),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    // kvkk: K
    finalizedByUserId: text('finalized_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'incident_reports_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'incident_reports_injured_membership_fkey',
      columns: [table.institutionId, table.injuredMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'incident_reports_first_aid_by_fkey',
      columns: [table.institutionId, table.firstAidByMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'incident_reports_responsible_fkey',
      columns: [table.institutionId, table.responsibleMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check('incident_reports_status_check', oneOf(table.status, INCIDENT_STATUSES)),
    check('incident_reports_kind_check', oneOf(table.kind, INCIDENT_KINDS)),
    // Yaralanan ya öğrenci kaydı ya personel üyeliğidir.
    check(
      'incident_reports_injured_check',
      sql`${oneOf(table.injuredKind, INJURED_KINDS)}
        and ((${table.injuredKind} = 'student' and ${table.studentId} is not null and ${table.injuredMembershipId} is null)
          or (${table.injuredKind} = 'staff' and ${table.studentId} is null and ${table.injuredMembershipId} is not null))`,
    ),
    check(
      'incident_reports_location_check',
      sql`char_length(${table.location}) between ${n(INCIDENT_LOCATION_MIN)} and ${n(INCIDENT_LOCATION_MAX)}`,
    ),
    check(
      'incident_reports_key_version_check',
      sql`${table.descriptionKeyVersion} > 0 and ${table.healthKeyVersion} > 0`,
    ),
    // Kesinleşme anı ve kesinleştiren birlikte; yalnız kesinleşmiş tutanakta.
    check(
      'incident_reports_finalized_check',
      sql`((${table.status} = 'finalized') = (${table.finalizedAt} is not null))
        and ((${table.finalizedAt} is null) = (${table.finalizedByUserId} is null))`,
    ),
    index('incident_reports_occurred_idx').on(table.institutionId, table.occurredAt),
    index('incident_reports_student_idx')
      .on(table.institutionId, table.studentId, table.occurredAt)
      .where(sql`${table.studentId} is not null`),
    index('incident_reports_injured_membership_idx')
      .on(table.institutionId, table.injuredMembershipId)
      .where(sql`${table.injuredMembershipId} is not null`),
    index('incident_reports_first_aid_by_idx')
      .on(table.institutionId, table.firstAidByMembershipId)
      .where(sql`${table.firstAidByMembershipId} is not null`),
    index('incident_reports_responsible_idx').on(
      table.institutionId,
      table.responsibleMembershipId,
    ),
    index('incident_reports_created_by_idx').on(
      table.institutionId,
      table.createdByUserId,
      table.occurredAt,
    ),
  ],
)

/** Tanıklar (K-493): kurumun personel üyeliği; taslakta bütün olarak yazılır, kesinleşince donar. */
export const incidentReportWitnesses = pgTable(
  'incident_report_witnesses',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    reportId: uuid('report_id').notNull(),
    // kvkk: K — tanık personel
    membershipId: text('membership_id').notNull(),
    position: integer('position').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'incident_report_witnesses_pkey',
      columns: [table.institutionId, table.reportId, table.membershipId],
    }),
    foreignKey({
      name: 'incident_report_witnesses_report_fkey',
      columns: [table.institutionId, table.reportId],
      foreignColumns: [incidentReports.institutionId, incidentReports.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'incident_report_witnesses_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check('incident_report_witnesses_position_check', sql`${table.position} >= 0`),
    index('incident_report_witnesses_membership_idx').on(table.institutionId, table.membershipId),
  ],
)

/** Veli bildirimi kaydı (K-493): dış gönderim yok; satır değişmez (tetikleyici). */
export const incidentReportNotifications = pgTable(
  'incident_report_notifications',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    reportId: uuid('report_id').notNull(),
    notifiedAt: timestamp('notified_at', { withTimezone: true }).notNull(),
    channel: text('channel').$type<IncidentNotificationChannel>().notNull(),
    // kvkk: K — veliye bildiren personel
    notifiedByMembershipId: text('notified_by_membership_id').notNull(),
    // kvkk: K — kaydı yazan kullanıcı
    recordedByUserId: text('recorded_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'incident_report_notifications_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'incident_report_notifications_report_fkey',
      columns: [table.institutionId, table.reportId],
      foreignColumns: [incidentReports.institutionId, incidentReports.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'incident_report_notifications_notified_by_fkey',
      columns: [table.institutionId, table.notifiedByMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check(
      'incident_report_notifications_channel_check',
      oneOf(table.channel, INCIDENT_NOTIFICATION_CHANNELS),
    ),
    index('incident_report_notifications_report_idx').on(
      table.institutionId,
      table.reportId,
      table.notifiedAt,
    ),
    index('incident_report_notifications_notified_by_idx').on(
      table.institutionId,
      table.notifiedByMembershipId,
    ),
  ],
)

/** Kesinleşmiş tutanağa ek not (K-493): şifreli, yalnız eklenir (tetikleyici). */
export const incidentReportAddenda = pgTable(
  'incident_report_addenda',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    reportId: uuid('report_id').notNull(),
    // kvkk: Ö — şifreli ek not: base64(IV ‖ GCM etiketi ‖ şifreli metin); düz metin yok
    noteCiphertext: text('note_ciphertext').notNull(),
    // Kişisel veri değil: yalnız anahtar sürümü.
    noteKeyVersion: integer('note_key_version').notNull(),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'incident_report_addenda_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'incident_report_addenda_report_fkey',
      columns: [table.institutionId, table.reportId],
      foreignColumns: [incidentReports.institutionId, incidentReports.id],
    }).onDelete('restrict'),
    check('incident_report_addenda_key_version_check', sql`${table.noteKeyVersion} > 0`),
    index('incident_report_addenda_report_idx').on(
      table.institutionId,
      table.reportId,
      table.createdAt,
    ),
  ],
)
