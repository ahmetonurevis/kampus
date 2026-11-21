import { sql } from 'drizzle-orm'
import {
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
  CONSENT_STATUSES,
  MEDICATION_TIMES_MAX,
  VISIT_OUTCOMES,
  VISIT_STATUSES,
  type ConsentStatus,
  type VisitOutcome,
  type VisitStatus,
} from '@kampus/school-core/lib/finance-infirmary.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { incidentReports } from './finance-incidents.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Revir ziyareti (DOM-FIN-151; ON-101; K-508, K-510). Öğrenci kaydı (`records`, yabancı anahtar yok);
 * şikâyet, yapılanlar ve not tek şifreli sağlık grubudur (AES-256-GCM, kurum anahtarı
 * `FIELD_ENCRYPTION_KEY`'den; `src/lib/field-crypto.ts`), şifreli değer kurum, satır, tablo, kolon ve
 * öğrenciye bağlıdır. Sağlık profili (IST-020) buraya kopyalanmaz. Kapanan satır değişmez ve
 * silinmez (tetikleyici); öğrencinin aynı anda tek açık ziyareti olur (kısmi tekil indeks).
 */
export const infirmaryVisits = pgTable(
  'infirmary_visits',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: Ç — revire gelen öğrenci kaydı
    studentId: text('student_id').notNull(),
    status: text('status').$type<VisitStatus>().notNull().default('open'),
    arrivedAt: timestamp('arrived_at', { withTimezone: true }).notNull(),
    returnedAt: timestamp('returned_at', { withTimezone: true }),
    // kvkk: Ö — sonuç (sınıfa döndü, eve gitti, sevk); öğretmene gitmez
    outcome: text('outcome').$type<VisitOutcome>(),
    // kvkk: K — öğrenciyi gönderen personel
    referredByMembershipId: text('referred_by_membership_id'),
    // Kaza kaynaklıysa aynı öğrencinin kaza tutanağı (DOM-FIN-146).
    incidentReportId: uuid('incident_report_id'),
    // kvkk: Ö — şifreli sağlık grubu (şikâyet, yapılanlar, not; JSON): base64(IV ‖ GCM etiketi ‖ şifreli metin)
    healthCiphertext: text('health_ciphertext').notNull(),
    // Kişisel veri değil: yalnız anahtar sürümü.
    healthKeyVersion: integer('health_key_version').notNull(),
    // kvkk: K — ziyareti açan kullanıcı
    createdByUserId: text('created_by_user_id').notNull(),
    // kvkk: K — ziyareti kapatan kullanıcı
    closedByUserId: text('closed_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'infirmary_visits_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'infirmary_visits_referred_by_fkey',
      columns: [table.institutionId, table.referredByMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'infirmary_visits_incident_report_fkey',
      columns: [table.institutionId, table.incidentReportId],
      foreignColumns: [incidentReports.institutionId, incidentReports.id],
    }).onDelete('restrict'),
    check('infirmary_visits_status_check', oneOf(table.status, VISIT_STATUSES)),
    check(
      'infirmary_visits_outcome_check',
      sql`${table.outcome} is null or ${oneOf(table.outcome, VISIT_OUTCOMES)}`,
    ),
    // Dönüş anı, sonuç ve kapatan birlikte; yalnız kapanmış ziyarette.
    check(
      'infirmary_visits_closed_check',
      sql`((${table.status} = 'closed') = (${table.returnedAt} is not null))
        and ((${table.returnedAt} is null) = (${table.outcome} is null))
        and ((${table.returnedAt} is null) = (${table.closedByUserId} is null))
        and (${table.returnedAt} is null or ${table.returnedAt} >= ${table.arrivedAt})`,
    ),
    check('infirmary_visits_key_version_check', sql`${table.healthKeyVersion} > 0`),
    uniqueIndex('infirmary_visits_open_student_key')
      .on(table.institutionId, table.studentId)
      .where(sql`${table.status} = 'open' and ${table.archivedAt} is null`),
    index('infirmary_visits_arrived_idx').on(table.institutionId, table.arrivedAt),
    index('infirmary_visits_student_idx').on(table.institutionId, table.studentId, table.arrivedAt),
    index('infirmary_visits_referred_by_idx')
      .on(table.institutionId, table.referredByMembershipId)
      .where(sql`${table.referredByMembershipId} is not null`),
    index('infirmary_visits_incident_report_idx')
      .on(table.institutionId, table.incidentReportId)
      .where(sql`${table.incidentReportId} is not null`),
  ],
)

/**
 * Veli ilaç onayı (DOM-FIN-151; K-509): velinin kendi çocuğu için talebi; ilaç adı, doz ve veli notu
 * şifreli sağlık grubudur, ret gerekçesi ayrı şifreli kolondadır. Doz saatleri ve dönem düz tutulur
 * (gün planı ve uygulama tekilliği için). Reddedilen ve geri çekilen talep değişmez (tetikleyici).
 */
export const infirmaryMedicationConsents = pgTable(
  'infirmary_medication_consents',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: Ç — ilacı kullanacak öğrenci kaydı
    studentId: text('student_id').notNull(),
    status: text('status').$type<ConsentStatus>().notNull().default('pending'),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    // kvkk: Ç — doz saatleri (SS:DD, Europe/Istanbul); ilaç adı olmadan sağlık değeri taşımaz
    doseTimes: text('dose_times').array().notNull(),
    // kvkk: Ö — şifreli sağlık grubu (ilaç adı, doz, veli notu; JSON); düz metin yok
    healthCiphertext: text('health_ciphertext').notNull(),
    // Kişisel veri değil: yalnız anahtar sürümü.
    healthKeyVersion: integer('health_key_version').notNull(),
    // kvkk: K — talebi açan veli üyeliği
    requestedByMembershipId: text('requested_by_membership_id').notNull(),
    // kvkk: K — talebi açan veli kullanıcısı
    requestedByUserId: text('requested_by_user_id').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    // kvkk: K — onaylayan ya da reddeden kullanıcı
    decidedByUserId: text('decided_by_user_id'),
    // kvkk: Ö — şifreli ret gerekçesi; yalnız reddedilen talepte
    decisionCiphertext: text('decision_ciphertext'),
    // Kişisel veri değil: yalnız anahtar sürümü.
    decisionKeyVersion: integer('decision_key_version'),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'infirmary_medication_consents_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'infirmary_medication_consents_requested_by_fkey',
      columns: [table.institutionId, table.requestedByMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check('infirmary_medication_consents_status_check', oneOf(table.status, CONSENT_STATUSES)),
    check(
      'infirmary_medication_consents_period_check',
      sql`${table.endDate} >= ${table.startDate}`,
    ),
    check(
      'infirmary_medication_consents_times_check',
      sql`cardinality(${table.doseTimes}) between 1 and ${n(MEDICATION_TIMES_MAX)}`,
    ),
    check(
      'infirmary_medication_consents_key_version_check',
      sql`${table.healthKeyVersion} > 0 and (${table.decisionKeyVersion} is null or ${table.decisionKeyVersion} > 0)`,
    ),
    // Karar anı ve karar veren birlikte; ret gerekçesi yalnız reddedilen talepte.
    check(
      'infirmary_medication_consents_decision_check',
      sql`((${table.decidedAt} is null) = (${table.decidedByUserId} is null))
        and ((${table.status} = 'pending') or (${table.status} = 'withdrawn') or (${table.decidedAt} is not null))
        and ((${table.status} = 'rejected') = (${table.decisionCiphertext} is not null))
        and ((${table.decisionCiphertext} is null) = (${table.decisionKeyVersion} is null))
        and ((${table.status} = 'withdrawn') = (${table.withdrawnAt} is not null))`,
    ),
    index('infirmary_medication_consents_student_idx').on(
      table.institutionId,
      table.studentId,
      table.startDate,
    ),
    index('infirmary_medication_consents_period_idx').on(
      table.institutionId,
      table.status,
      table.startDate,
      table.endDate,
    ),
    index('infirmary_medication_consents_requested_by_idx').on(
      table.institutionId,
      table.requestedByMembershipId,
    ),
  ],
)

/**
 * İlaç uygulaması (DOM-FIN-151; K-509; ON-161 genişletir): onaylı talebin bir doz saatinin bir günde
 * verilişi. Aynı talepte aynı günün aynı doz saati tekildir; satır yalnız eklenir (tetikleyici).
 */
export const infirmaryMedicationAdministrations = pgTable(
  'infirmary_medication_administrations',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    consentId: uuid('consent_id').notNull(),
    // kvkk: Ç — ilacı alan öğrenci kaydı (talepten kopya; öğrenci listesi için)
    studentId: text('student_id').notNull(),
    // Uygulama anının Europe/Istanbul günü.
    doseDay: date('dose_day', { mode: 'string' }).notNull(),
    // Onaydaki doz saati (SS:DD).
    scheduledTime: text('scheduled_time').notNull(),
    administeredAt: timestamp('administered_at', { withTimezone: true }).notNull(),
    // kvkk: K — ilacı veren personel
    administeredByMembershipId: text('administered_by_membership_id').notNull(),
    // kvkk: K — kaydı yazan kullanıcı
    recordedByUserId: text('recorded_by_user_id').notNull(),
    // kvkk: Ö — şifreli sağlık grubu (verilen doz, not; JSON); düz metin yok
    healthCiphertext: text('health_ciphertext').notNull(),
    // Kişisel veri değil: yalnız anahtar sürümü.
    healthKeyVersion: integer('health_key_version').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'infirmary_medication_administrations_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'infirmary_medication_administrations_consent_fkey',
      columns: [table.institutionId, table.consentId],
      foreignColumns: [infirmaryMedicationConsents.institutionId, infirmaryMedicationConsents.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'infirmary_medication_administrations_administered_by_fkey',
      columns: [table.institutionId, table.administeredByMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check(
      'infirmary_medication_administrations_time_check',
      sql`${table.scheduledTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    check(
      'infirmary_medication_administrations_key_version_check',
      sql`${table.healthKeyVersion} > 0`,
    ),
    uniqueIndex('infirmary_medication_administrations_dose_key').on(
      table.institutionId,
      table.consentId,
      table.doseDay,
      table.scheduledTime,
    ),
    index('infirmary_medication_administrations_student_idx').on(
      table.institutionId,
      table.studentId,
      table.administeredAt,
    ),
    index('infirmary_medication_administrations_day_idx').on(table.institutionId, table.doseDay),
    index('infirmary_medication_administrations_administered_by_idx').on(
      table.institutionId,
      table.administeredByMembershipId,
    ),
  ],
)
