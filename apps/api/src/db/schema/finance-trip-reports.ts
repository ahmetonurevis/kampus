import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  TRIP_EVALUATION_COMMENT_MAX,
  TRIP_EVALUATION_SCORE_MAX,
  TRIP_EVALUATION_SCORE_MIN,
  TRIP_REPORT_CAPTION_MAX,
  TRIP_REPORT_FAMILY_ROLES,
  TRIP_REPORT_INCIDENT_NOTE_MAX,
  TRIP_REPORT_OUTCOME_MAX,
  TRIP_REPORT_REASON_MAX,
  TRIP_REPORT_REASON_MIN,
  TRIP_REPORT_STATUSES,
  TRIP_REPORT_SUMMARY_MAX,
  type TripReportStatus,
} from '@kampus/school-core/lib/finance-trip-reports.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { files } from './files.ts'
import { incidentReports } from './finance-incidents.ts'
import { tripPlans } from './finance-trip-plans.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Gezi sonrası rapor (DOM-FIN-158; ON-158; K-529): gezi planına (DOM-FIN-111) bağlı tek rapor.
 * Taslak → gönderildi → onaylandı ya da iade edildi; onaylanan rapor değişmez ve silinmez
 * (tetikleyici). Katılım sayıları gönderimde gezi günü yoklamasından dondurulur.
 */
export const tripReports = pgTable(
  'trip_reports',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    planId: uuid('plan_id').notNull(),
    status: text('status').$type<TripReportStatus>().notNull(),
    // kvkk: K (serbest metin)
    summary: text('summary'),
    // kvkk: K (serbest metin; kaza ayrıntısı tutanaktadır)
    incidentNote: text('incident_note'),
    // kvkk: K (serbest metin)
    outcomeNote: text('outcome_note'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    // kvkk: K
    submittedByUserId: text('submitted_by_user_id'),
    attendanceSource: text('attendance_source').$type<'trip_day' | 'none'>(),
    rosterCount: integer('roster_count'),
    attendedCount: integer('attended_count'),
    absentCount: integer('absent_count'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    // kvkk: K
    decidedByUserId: text('decided_by_user_id'),
    // kvkk: K (serbest metin)
    returnReason: text('return_reason'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'trip_reports_pkey', columns: [table.institutionId, table.id] }),
    unique('trip_reports_id_plan_key').on(table.institutionId, table.id, table.planId),
    foreignKey({
      name: 'trip_reports_plan_fkey',
      columns: [table.institutionId, table.planId],
      foreignColumns: [tripPlans.institutionId, tripPlans.id],
    }).onDelete('restrict'),
    check('trip_reports_status_check', oneOf(table.status, TRIP_REPORT_STATUSES)),
    check(
      'trip_reports_text_check',
      sql`(${table.summary} is null or char_length(${table.summary}) <= ${n(TRIP_REPORT_SUMMARY_MAX)})
        and (${table.incidentNote} is null or char_length(${table.incidentNote}) <= ${n(TRIP_REPORT_INCIDENT_NOTE_MAX)})
        and (${table.outcomeNote} is null or char_length(${table.outcomeNote}) <= ${n(TRIP_REPORT_OUTCOME_MAX)})
        and (${table.returnReason} is null
          or char_length(${table.returnReason}) between ${n(TRIP_REPORT_REASON_MIN)} and ${n(TRIP_REPORT_REASON_MAX)})`,
    ),
    // Gönderilmiş ve onaylanmış raporda gönderim ve dondurulan katılım dolu; karar alanları
    // onay ve iadede dolu; iade gerekçesi yalnız iadede.
    check(
      'trip_reports_state_check',
      sql`(${table.submittedAt} is null) = (${table.submittedByUserId} is null)
        and (${table.status} not in ('submitted', 'approved') or (${table.submittedAt} is not null
          and ${table.attendanceSource} in ('trip_day', 'none')
          and ${table.rosterCount} >= 0 and ${table.attendedCount} >= 0 and ${table.absentCount} >= 0))
        and (${table.decidedAt} is null) = (${table.decidedByUserId} is null)
        and (${table.status} not in ('approved', 'returned') or ${table.decidedAt} is not null)
        and (${table.status} = 'returned') = (${table.returnReason} is not null)`,
    ),
    uniqueIndex('trip_reports_plan_key')
      .on(table.institutionId, table.planId)
      .where(sql`${table.archivedAt} is null`),
    index('trip_reports_status_idx').on(table.institutionId, table.status),
  ],
)

/**
 * Raporun bağlandığı kaza tutanakları (K-529): yalnız bağ; tutanağın ayrıntısı kopyalanmaz.
 * Taslakta bütün olarak yeniden yazılır (eski satır arşivlenir); rapor onaylanınca donar.
 */
export const tripReportIncidents = pgTable(
  'trip_report_incidents',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    reportId: uuid('report_id').notNull(),
    incidentId: uuid('incident_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'trip_report_incidents_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'trip_report_incidents_report_fkey',
      columns: [table.institutionId, table.reportId],
      foreignColumns: [tripReports.institutionId, tripReports.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'trip_report_incidents_incident_fkey',
      columns: [table.institutionId, table.incidentId],
      foreignColumns: [incidentReports.institutionId, incidentReports.id],
    }).onDelete('restrict'),
    uniqueIndex('trip_report_incidents_report_key')
      .on(table.institutionId, table.reportId, table.incidentId)
      .where(sql`${table.archivedAt} is null`),
    index('trip_report_incidents_incident_idx').on(table.institutionId, table.incidentId),
  ],
)

/**
 * Rapor fotoğrafı (K-530): platform dosyası (`files`, bağ türü `trip_report`), kısa açıklama,
 * "öğrenci görünmüyor" işareti ve aileye yayım isteği. Yayım saklanmaz; okuma anında etiketli
 * öğrencilerin rızasından hesaplanır. Kaldırılan fotoğraf arşivlenir; rapor onaylanınca donar.
 */
export const tripReportPhotos = pgTable(
  'trip_report_photos',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    reportId: uuid('report_id').notNull(),
    fileId: uuid('file_id').notNull(),
    // kvkk: K (serbest metin)
    caption: text('caption'),
    noStudentsVisible: boolean('no_students_visible').notNull(),
    shareWithFamilies: boolean('share_with_families').notNull(),
    position: integer('position').notNull(),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'trip_report_photos_pkey', columns: [table.institutionId, table.id] }),
    unique('trip_report_photos_report_key').on(table.institutionId, table.id, table.reportId),
    foreignKey({
      name: 'trip_report_photos_report_fkey',
      columns: [table.institutionId, table.reportId],
      foreignColumns: [tripReports.institutionId, tripReports.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'trip_report_photos_file_fkey',
      columns: [table.institutionId, table.fileId],
      foreignColumns: [files.institutionId, files.id],
    }).onDelete('restrict'),
    check(
      'trip_report_photos_text_check',
      sql`(${table.caption} is null or char_length(${table.caption}) <= ${n(TRIP_REPORT_CAPTION_MAX)})
        and ${table.position} >= 0`,
    ),
    uniqueIndex('trip_report_photos_file_key')
      .on(table.institutionId, table.fileId)
      .where(sql`${table.archivedAt} is null`),
    index('trip_report_photos_report_idx').on(table.institutionId, table.reportId, table.position),
  ],
)

/**
 * Fotoğrafta görünen öğrenci (K-530): fotoğrafta öğrenci başına tek etkin satır. Rıza öğrenciye
 * bağlıdır (`photo_video_sharing`); etiket kaldırılınca arşivlenir. `student_id` `records`
 * kimliğidir.
 */
export const tripReportPhotoTags = pgTable(
  'trip_report_photo_tags',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    reportId: uuid('report_id').notNull(),
    photoId: uuid('photo_id').notNull(),
    // kvkk: K (öğrenci)
    studentId: text('student_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'trip_report_photo_tags_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'trip_report_photo_tags_photo_fkey',
      columns: [table.institutionId, table.photoId, table.reportId],
      foreignColumns: [
        tripReportPhotos.institutionId,
        tripReportPhotos.id,
        tripReportPhotos.reportId,
      ],
    }).onDelete('restrict'),
    uniqueIndex('trip_report_photo_tags_student_key')
      .on(table.institutionId, table.photoId, table.studentId)
      .where(sql`${table.archivedAt} is null`),
    index('trip_report_photo_tags_photo_idx').on(
      table.institutionId,
      table.photoId,
      table.reportId,
    ),
    index('trip_report_photo_tags_report_idx').on(table.institutionId, table.reportId),
    index('trip_report_photo_tags_student_idx').on(table.institutionId, table.studentId),
  ],
)

/**
 * Katılımcı değerlendirmesi (K-531): geziye katılan öğrenci ya da velisinin 1–5 puanı ve isteğe
 * bağlı yorumu; gezide üyelik başına bir kez. Değişmez ve silinmez (tetikleyici). Personele ad ve
 * rol olmadan, en az 5 yanıtta özetlenir.
 */
export const tripEvaluations = pgTable(
  'trip_evaluations',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    planId: uuid('plan_id').notNull(),
    // kvkk: K (öğrenci)
    studentId: text('student_id').notNull(),
    // kvkk: K (yanıtlayan üyelik)
    membershipId: text('membership_id').notNull(),
    respondentRole: text('respondent_role').notNull(),
    score: integer('score').notNull(),
    // kvkk: K (serbest metin)
    comment: text('comment'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'trip_evaluations_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'trip_evaluations_plan_fkey',
      columns: [table.institutionId, table.planId],
      foreignColumns: [tripPlans.institutionId, tripPlans.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'trip_evaluations_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check('trip_evaluations_role_check', oneOf(table.respondentRole, TRIP_REPORT_FAMILY_ROLES)),
    check(
      'trip_evaluations_value_check',
      sql`${table.score} between ${n(TRIP_EVALUATION_SCORE_MIN)} and ${n(TRIP_EVALUATION_SCORE_MAX)}
        and (${table.comment} is null or char_length(${table.comment}) between 1 and ${n(TRIP_EVALUATION_COMMENT_MAX)})`,
    ),
    uniqueIndex('trip_evaluations_respondent_key').on(
      table.institutionId,
      table.planId,
      table.membershipId,
    ),
    index('trip_evaluations_membership_idx').on(table.institutionId, table.membershipId),
    index('trip_evaluations_student_idx').on(table.institutionId, table.studentId),
  ],
)
