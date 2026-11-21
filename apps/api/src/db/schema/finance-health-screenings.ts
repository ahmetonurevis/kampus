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
  HEALTH_SCREENING_CLASSES_MAX,
  HEALTH_SCREENING_KINDS,
  HEALTH_SCREENING_NOTIFICATION_STATUSES,
  HEALTH_SCREENING_OUTCOMES,
  HEALTH_SCREENING_PERFORMER_NAME_MAX,
  HEALTH_SCREENING_PERFORMER_NAME_MIN,
  HEALTH_SCREENING_STATUSES,
  type HealthScreeningKind,
  type HealthScreeningNotificationStatus,
  type HealthScreeningOutcome,
  type HealthScreeningStatus,
  type HealthScreeningThresholds,
} from '@kampus/school-core/lib/finance-health-screenings.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Okul sağlığı tarama oturumu (DOM-FIN-153; ON-163; K-514…K-516). Tür, gün, hedef sınıflar
 * (records `classes` kimlikleri; yabancı anahtar yok), yapan (kurum üyeliği ya da dış sağlık
 * personelinin adı; personel tablosu yok) ve kurumun eşikleri (JSON; kişisel veri değil). Oturum
 * açık başlar, yayımlanınca kendisi ve sonuçları değişmez (tetikleyici). Silinmez.
 */
export const healthScreeningSessions = pgTable(
  'health_screening_sessions',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    kind: text('kind').$type<HealthScreeningKind>().notNull(),
    status: text('status').$type<HealthScreeningStatus>().notNull().default('open'),
    screenedOn: date('screened_on', { mode: 'string' }).notNull(),
    classIds: text('class_ids').array().notNull(),
    // kvkk: K — taramayı yapan personel üyeliği
    performerMembershipId: text('performer_membership_id'),
    // kvkk: K — dış sağlık personelinin adı
    performerName: text('performer_name'),
    // Kişisel veri değil: kurumun bu tarama için tanımladığı eşikler.
    thresholds: jsonb('thresholds').$type<HealthScreeningThresholds>().notNull(),
    // kvkk: K — oturumu açan kullanıcı
    createdByUserId: text('created_by_user_id').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    // kvkk: K — yayımlayan kullanıcı
    publishedByUserId: text('published_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'health_screening_sessions_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'health_screening_sessions_performer_fkey',
      columns: [table.institutionId, table.performerMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check('health_screening_sessions_kind_check', oneOf(table.kind, HEALTH_SCREENING_KINDS)),
    check('health_screening_sessions_status_check', oneOf(table.status, HEALTH_SCREENING_STATUSES)),
    check(
      'health_screening_sessions_classes_check',
      sql`cardinality(${table.classIds}) between 1 and ${n(HEALTH_SCREENING_CLASSES_MAX)}`,
    ),
    // Yapan ya personel üyeliği ya da dış personelin adıdır.
    check(
      'health_screening_sessions_performer_check',
      sql`(${table.performerMembershipId} is null) <> (${table.performerName} is null)
        and (${table.performerName} is null or char_length(${table.performerName}) between ${n(HEALTH_SCREENING_PERFORMER_NAME_MIN)} and ${n(HEALTH_SCREENING_PERFORMER_NAME_MAX)})`,
    ),
    // Yayım anı ve yayımlayan birlikte; yalnız yayımlanmış oturumda.
    check(
      'health_screening_sessions_published_check',
      sql`((${table.status} = 'published') = (${table.publishedAt} is not null))
        and ((${table.publishedAt} is null) = (${table.publishedByUserId} is null))`,
    ),
    index('health_screening_sessions_screened_idx').on(table.institutionId, table.screenedOn),
    index('health_screening_sessions_performer_idx')
      .on(table.institutionId, table.performerMembershipId)
      .where(sql`${table.performerMembershipId} is not null`),
  ],
)

/**
 * Tarama sonucu (K-514): oturumda öğrenci başına tek satır. Durum (tarandı, katılmadı, reddetti) ve
 * ileri değerlendirme işareti düz tutulur (rapor ve bildirim için); ölçüm ve kısa not uygulama
 * düzeyinde şifrelidir (AES-256-GCM, kurum anahtarı; değer satıra, oturuma ve öğrenciye bağlı).
 * Sınıf, sonuç girildiği andaki sınıftır. Yayımlanmış oturumun sonucu değişmez (tetikleyici).
 */
export const healthScreeningResults = pgTable(
  'health_screening_results',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    sessionId: uuid('session_id').notNull(),
    // kvkk: Ç — taranan öğrenci kaydı
    studentId: text('student_id').notNull(),
    classId: text('class_id').notNull(),
    outcome: text('outcome').$type<HealthScreeningOutcome>().notNull(),
    // kvkk: Ö — ileri değerlendirme önerisi (sağlık verisi niteliğinde; rapor ve bildirim için düz)
    referralRecommended: boolean('referral_recommended').notNull(),
    // kvkk: Ö — şifreli ölçüm ve kısa not (JSON); düz metin yok
    healthCiphertext: text('health_ciphertext').notNull(),
    // Kişisel veri değil: yalnız anahtar sürümü.
    healthKeyVersion: integer('health_key_version').notNull(),
    // kvkk: K — sonucu son yazan kullanıcı
    recordedByUserId: text('recorded_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'health_screening_results_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'health_screening_results_session_fkey',
      columns: [table.institutionId, table.sessionId],
      foreignColumns: [healthScreeningSessions.institutionId, healthScreeningSessions.id],
    }).onDelete('restrict'),
    uniqueIndex('health_screening_results_student_key').on(
      table.institutionId,
      table.sessionId,
      table.studentId,
    ),
    check(
      'health_screening_results_outcome_check',
      oneOf(table.outcome, HEALTH_SCREENING_OUTCOMES),
    ),
    // Taranmayan öğrenciye öneri yazılmaz.
    check(
      'health_screening_results_referral_check',
      sql`${table.outcome} = 'screened' or not ${table.referralRecommended}`,
    ),
    check('health_screening_results_key_version_check', sql`${table.healthKeyVersion} > 0`),
    index('health_screening_results_student_idx').on(table.institutionId, table.studentId),
    index('health_screening_results_class_idx').on(
      table.institutionId,
      table.sessionId,
      table.classId,
    ),
  ],
)

/**
 * Veli bildirim kaydı (K-515): yayımlamada ileri değerlendirme önerilen her sonuç için
 * "gönderilecek" satırı. Gerçek gönderim yoktur; satır silinmez (tetikleyici).
 */
export const healthScreeningNotifications = pgTable(
  'health_screening_notifications',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    sessionId: uuid('session_id').notNull(),
    resultId: uuid('result_id').notNull(),
    // kvkk: Ç — bildirimi alacak velinin çocuğu
    studentId: text('student_id').notNull(),
    status: text('status').$type<HealthScreeningNotificationStatus>().notNull().default('pending'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'health_screening_notifications_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'health_screening_notifications_session_fkey',
      columns: [table.institutionId, table.sessionId],
      foreignColumns: [healthScreeningSessions.institutionId, healthScreeningSessions.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'health_screening_notifications_result_fkey',
      columns: [table.institutionId, table.resultId],
      foreignColumns: [healthScreeningResults.institutionId, healthScreeningResults.id],
    }).onDelete('restrict'),
    uniqueIndex('health_screening_notifications_result_key').on(
      table.institutionId,
      table.resultId,
    ),
    check(
      'health_screening_notifications_status_check',
      oneOf(table.status, HEALTH_SCREENING_NOTIFICATION_STATUSES),
    ),
    index('health_screening_notifications_session_idx').on(
      table.institutionId,
      table.sessionId,
      table.status,
    ),
    index('health_screening_notifications_student_idx').on(table.institutionId, table.studentId),
  ],
)
