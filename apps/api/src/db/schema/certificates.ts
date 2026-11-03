import { sql } from 'drizzle-orm'
import {
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
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  CANCELLATION_REASON_MAX,
  CERTIFICATE_STATUSES,
  MEBBIS_NUMBER_MAX,
  certificateContentSchema,
  type CertificateContent,
  type CertificateStatus,
} from '@kampus/school-core/cefr/certificates.ts'

import { institutions, memberships } from './auth.ts'
import { progressionDecisions } from './cefr.ts'
import { keys, oneOf, requiredColumns } from './columns.ts'
import { languageGroupMembers, languageGroups } from './language-groups.ts'

/**
 * Kurum başarı belgesi ve MEBBİS belge izi (OG-088; IST-081; docs/domain/dil-okulu.md DOM-DIL-080,
 * 081, 082). Kural school-core `cefr/certificates.ts`'tedir; bu tablolar onun satırlarıdır.
 *
 * - `certificate_counters` kurum başına belge sıra sayacıdır. Numara sayaçtan kilitli artırmayla
 *   alınır (`insert … on conflict do update … returning`, satır kilidi); belge satırı silinmez ve
 *   sayaç yalnız artar (`kampus_certificate_counter_guard()`), bu yüzden numara yeniden verilmez.
 * - `course_certificates` düzenlenmiş belgedir. İçerik (`content`) düzenleme anının kopyasıdır ve
 *   değişmez; yalnız iptal alanları (`status`, `cancelled_by_user_id`, `cancelled_at`,
 *   `cancellation_reason`) ile `updated_at` ve `version` bir kez, geçerliden iptale yazılır
 *   (`kampus_certificate_guard()`, migration 0053, elle). İptal edilmiş belge hiç değişmez.
 * - Aynı karar için tek geçerli belge kısmi tekil indeksle korunur
 *   (`course_certificates_valid_decision_key`); iptal edilen belgenin yerine en çok bir belge
 *   düzenlenir (`course_certificates_replaces_key`).
 * - Belge kayda, gruba, kursiyere, kura ve karara bileşik yabancı anahtarla kilitlidir (kur sonu
 *   kararıyla aynı kilit); karar aynı kaydın kararıdır.
 * - **Kurumsuz indeks istisnası:** `course_certificates_verification_code_key` yalnız
 *   `verification_code` üzerindedir. Kimliksiz doğrulama ucu (`GET
 *   /api/v1/certificate-verifications/:code`) kurum kimliği okumaz; kodu kurumlar arası tekil
 *   bulmak için indeks kurumla başlayamaz. Kod 140 bit rastgeledir, belge numarasından türetilmez.
 * - `mebbis_certificate_records` resmî Kurs Bitirme Belgesinin MEBBİS'te düzenlendiği izidir
 *   (DOM-DIL-080): belge no, tarih ve işleyen. Platform resmî belgeyi üretmez. Satır değişmez
 *   (`kampus_reject_immutable_change()`); karar başına bir iz.
 * - Tetikleyiciler Drizzle şemasında izlenmez, migration'a elle yazılır. Tablolar yeni ve boştur;
 *   kısıtlar `not valid` adımı olmadan tek adımda eklenir.
 */

const required = requiredColumns

const SNAPSHOT_VERSION = sql.raw(String(certificateContentSchema.shape.schemaVersion.value))
const REASON_MAX = sql.raw(String(CANCELLATION_REASON_MAX))
const MEBBIS_MAX = sql.raw(String(MEBBIS_NUMBER_MAX))

/** Kurum başına belge sıra sayacı (DOM-DIL-082); yalnız artar. */
export const certificateCounters = pgTable(
  'certificate_counters',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    lastSerial: integer('last_serial').notNull(),
    ...required(),
  },
  (table) => [
    primaryKey({ name: 'certificate_counters_pkey', columns: [table.institutionId] }),
    check('certificate_counters_last_serial_check', sql`${table.lastSerial} >= 1`),
  ],
)

/** Kurum başarı belgesi (DOM-DIL-081, 082; core `CertificateRecord`). */
export const courseCertificates = pgTable(
  'course_certificates',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    serial: integer('serial').notNull(),
    number: text('number').notNull(),
    verificationCode: text('verification_code').notNull(),
    enrollmentId: uuid('enrollment_id').notNull(),
    groupId: uuid('group_id').notNull(),
    courseId: uuid('course_id').notNull(),
    // kvkk: K (school-core öğrenci kaydı kimliği)
    learnerId: text('learner_id').notNull(),
    decisionId: uuid('decision_id').notNull(),
    status: text('status').$type<CertificateStatus>().notNull(),
    // kvkk: Ç (kursiyerin adı, devamı ve beceri puanları; loglanmaz)
    content: jsonb('content').$type<CertificateContent>().notNull(),
    replacesCertificateId: uuid('replaces_certificate_id'),
    // kvkk: K
    issuedByUserId: text('issued_by_user_id').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    // kvkk: K
    cancelledByUserId: text('cancelled_by_user_id'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    // kvkk: K (iptal gerekçesi serbest metindir; loglanmaz)
    cancellationReason: text('cancellation_reason'),
    ...required(),
  },
  (table) => [
    primaryKey({ name: 'course_certificates_pkey', columns: [table.institutionId, table.id] }),
    // Yeniden düzenleme yabancı anahtarının hedefi: aynı kaydın belgesi.
    unique('course_certificates_enrollment_id_key').on(
      table.institutionId,
      table.enrollmentId,
      table.id,
    ),
    foreignKey({
      name: 'course_certificates_enrollment_fkey',
      columns: [table.institutionId, table.enrollmentId, table.groupId, table.learnerId],
      foreignColumns: [
        languageGroupMembers.institutionId,
        languageGroupMembers.id,
        languageGroupMembers.groupId,
        languageGroupMembers.studentId,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'course_certificates_group_fkey',
      columns: [table.institutionId, table.groupId, table.courseId],
      foreignColumns: [languageGroups.institutionId, languageGroups.id, languageGroups.courseId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'course_certificates_decision_fkey',
      columns: [table.institutionId, table.enrollmentId, table.decisionId],
      foreignColumns: [
        progressionDecisions.institutionId,
        progressionDecisions.enrollmentId,
        progressionDecisions.id,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'course_certificates_replaces_fkey',
      columns: [table.institutionId, table.enrollmentId, table.replacesCertificateId],
      foreignColumns: [table.institutionId, table.enrollmentId, table.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'course_certificates_issued_by_fkey',
      columns: [table.institutionId, table.issuedByUserId],
      foreignColumns: [memberships.institutionId, memberships.userId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'course_certificates_cancelled_by_fkey',
      columns: [table.institutionId, table.cancelledByUserId],
      foreignColumns: [memberships.institutionId, memberships.userId],
    }).onDelete('restrict'),
    check('course_certificates_status_check', oneOf(table.status, keys(CERTIFICATE_STATUSES))),
    check('course_certificates_serial_check', sql`${table.serial} >= 1`),
    check('course_certificates_number_check', sql`${table.number} ~ '^KB-[0-9]{4}-[0-9]{6,}$'`),
    check(
      'course_certificates_verification_code_check',
      sql`${table.verificationCode} ~ '^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){6}$'`,
    ),
    check(
      'course_certificates_content_check',
      sql`jsonb_typeof(${table.content}) = 'object' and ${table.content} ->> 'schemaVersion' = '${SNAPSHOT_VERSION}'`,
    ),
    // İptal alanları birlikte ve yalnız iptal edilmiş belgede dolar; gerekçe zorunlu.
    check(
      'course_certificates_cancellation_check',
      sql`(${table.status} = 'cancelled') = (${table.cancelledByUserId} is not null)
        and (${table.cancelledByUserId} is null) = (${table.cancelledAt} is null)
        and (${table.cancelledByUserId} is null) = (${table.cancellationReason} is null)
        and (${table.cancellationReason} is null
          or (char_length(btrim(${table.cancellationReason})) >= 1
            and char_length(${table.cancellationReason}) <= ${REASON_MAX}))
        and (${table.cancelledAt} is null or ${table.cancelledAt} >= ${table.issuedAt})`,
    ),
    check(
      'course_certificates_replaces_check',
      sql`${table.replacesCertificateId} is null or ${table.replacesCertificateId} <> ${table.id}`,
    ),
    check('course_certificates_archived_check', sql`${table.archivedAt} is null`),
    uniqueIndex('course_certificates_serial_key').on(table.institutionId, table.serial),
    uniqueIndex('course_certificates_number_key').on(table.institutionId, table.number),
    // Kurumsuz indeks istisnası (yukarıda): kimliksiz doğrulama kodu kurumlar arası tekildir.
    uniqueIndex('course_certificates_verification_code_key').on(table.verificationCode),
    // Aynı karar için tek geçerli belge (core `certificate_already_issued`).
    uniqueIndex('course_certificates_valid_decision_key')
      .on(table.institutionId, table.decisionId)
      .where(sql`${table.status} = 'valid'`),
    // İptal edilen belgenin yerine en çok bir belge (core `certificate_already_replaced`).
    uniqueIndex('course_certificates_replaces_key')
      .on(table.institutionId, table.replacesCertificateId)
      .where(sql`${table.replacesCertificateId} is not null`),
    index('course_certificates_enrollment_idx').on(
      table.institutionId,
      table.enrollmentId,
      table.groupId,
      table.learnerId,
    ),
    index('course_certificates_decision_idx').on(
      table.institutionId,
      table.enrollmentId,
      table.decisionId,
    ),
    index('course_certificates_replaces_idx').on(
      table.institutionId,
      table.enrollmentId,
      table.replacesCertificateId,
    ),
    index('course_certificates_group_idx').on(table.institutionId, table.groupId, table.courseId),
    index('course_certificates_course_idx').on(table.institutionId, table.courseId),
    index('course_certificates_learner_idx').on(table.institutionId, table.learnerId),
    index('course_certificates_issued_by_idx').on(table.institutionId, table.issuedByUserId),
    index('course_certificates_cancelled_by_idx').on(table.institutionId, table.cancelledByUserId),
  ],
)

/**
 * MEBBİS Kurs Bitirme Belgesinin düzenlendiği iz (DOM-DIL-080; core `MebbisRecord`): belge no,
 * MEBBİS'teki tarih ve işleyen. Karar başına bir iz; satır değişmez.
 */
export const mebbisCertificateRecords = pgTable(
  'mebbis_certificate_records',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    enrollmentId: uuid('enrollment_id').notNull(),
    groupId: uuid('group_id').notNull(),
    // kvkk: K (school-core öğrenci kaydı kimliği)
    learnerId: text('learner_id').notNull(),
    decisionId: uuid('decision_id').notNull(),
    // kvkk: K (resmî belge numarası)
    certificateNumber: text('certificate_number').notNull(),
    issuedDate: date('issued_date', { mode: 'string' }).notNull(),
    // kvkk: K
    recordedByUserId: text('recorded_by_user_id').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    ...required(),
  },
  (table) => [
    primaryKey({
      name: 'mebbis_certificate_records_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'mebbis_certificate_records_enrollment_fkey',
      columns: [table.institutionId, table.enrollmentId, table.groupId, table.learnerId],
      foreignColumns: [
        languageGroupMembers.institutionId,
        languageGroupMembers.id,
        languageGroupMembers.groupId,
        languageGroupMembers.studentId,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'mebbis_certificate_records_decision_fkey',
      columns: [table.institutionId, table.enrollmentId, table.decisionId],
      foreignColumns: [
        progressionDecisions.institutionId,
        progressionDecisions.enrollmentId,
        progressionDecisions.id,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'mebbis_certificate_records_recorded_by_fkey',
      columns: [table.institutionId, table.recordedByUserId],
      foreignColumns: [memberships.institutionId, memberships.userId],
    }).onDelete('restrict'),
    check(
      'mebbis_certificate_records_number_check',
      sql`char_length(btrim(${table.certificateNumber})) >= 1 and char_length(${table.certificateNumber}) <= ${MEBBIS_MAX}`,
    ),
    check(
      'mebbis_certificate_records_version_check',
      sql`${table.version} = 1 and ${table.archivedAt} is null`,
    ),
    // Karar başına bir iz; kayıt yabancı anahtarının indeksi aşağıda.
    uniqueIndex('mebbis_certificate_records_decision_key').on(
      table.institutionId,
      table.decisionId,
    ),
    index('mebbis_certificate_records_enrollment_idx').on(
      table.institutionId,
      table.enrollmentId,
      table.groupId,
      table.learnerId,
    ),
    index('mebbis_certificate_records_enrollment_decision_idx').on(
      table.institutionId,
      table.enrollmentId,
      table.decisionId,
    ),
    index('mebbis_certificate_records_group_idx').on(table.institutionId, table.groupId),
    index('mebbis_certificate_records_recorded_by_idx').on(
      table.institutionId,
      table.recordedByUserId,
    ),
  ],
)
