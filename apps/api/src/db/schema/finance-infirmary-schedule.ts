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
  DOSE_CORRECTION_KINDS,
  DOSE_RECORD_KINDS,
  LATE_TOLERANCE_DEFAULT_MINUTES,
  LATE_TOLERANCE_MAX_MINUTES,
  LATE_TOLERANCE_MIN_MINUTES,
  type DoseCorrectionKind,
  type DoseRecordKind,
} from '@kampus/school-core/lib/finance-infirmary-schedule.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import {
  infirmaryMedicationAdministrations,
  infirmaryMedicationConsents,
} from './finance-infirmary.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Atlanan doz (DOM-FIN-152; ON-161; K-512): onaylı talebin bir doz saatinin bir günde verilmeyişi.
 * Gerekçe (öğrenci yok, reddetti, veli iptal, diğer) ve açıklama tek şifreli sağlık grubudur
 * (AES-256-GCM, kurum anahtarı; değer satıra ve talebe bağlı). Satır yalnız eklenir (tetikleyici);
 * düzeltme ve iptal `infirmary_medication_dose_corrections`'tadır. Doz saatinin ilk atlaması
 * tekildir; iptal edilen atlamanın yerine yazılan kayıt `replaces_skip_id` ile zinciri sürdürür.
 */
export const infirmaryMedicationSkips = pgTable(
  'infirmary_medication_skips',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    consentId: uuid('consent_id').notNull(),
    // kvkk: Ç — dozu atlanan öğrenci kaydı (talepten kopya; veli listesi için)
    studentId: text('student_id').notNull(),
    // Doz günü (Europe/Istanbul).
    doseDay: date('dose_day', { mode: 'string' }).notNull(),
    // Onaydaki doz saati (SS:DD).
    scheduledTime: text('scheduled_time').notNull(),
    // İptal edilen aynı doz saati atlamasının yerine geçiyorsa onun kimliği.
    replacesSkipId: uuid('replaces_skip_id'),
    // kvkk: Ö — şifreli sağlık grubu (gerekçe, açıklama; JSON); düz metin yok
    healthCiphertext: text('health_ciphertext').notNull(),
    // Kişisel veri değil: yalnız anahtar sürümü.
    healthKeyVersion: integer('health_key_version').notNull(),
    // kvkk: K — atlamayı yazan kullanıcı
    recordedByUserId: text('recorded_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'infirmary_medication_skips_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'infirmary_medication_skips_consent_fkey',
      columns: [table.institutionId, table.consentId],
      foreignColumns: [infirmaryMedicationConsents.institutionId, infirmaryMedicationConsents.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'infirmary_medication_skips_replaces_fkey',
      columns: [table.institutionId, table.replacesSkipId],
      foreignColumns: [table.institutionId, table.id],
    }).onDelete('restrict'),
    check(
      'infirmary_medication_skips_time_check',
      sql`${table.scheduledTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    check('infirmary_medication_skips_key_version_check', sql`${table.healthKeyVersion} > 0`),
    uniqueIndex('infirmary_medication_skips_dose_key')
      .on(table.institutionId, table.consentId, table.doseDay, table.scheduledTime)
      .where(sql`${table.replacesSkipId} is null`),
    uniqueIndex('infirmary_medication_skips_replaces_key')
      .on(table.institutionId, table.replacesSkipId)
      .where(sql`${table.replacesSkipId} is not null`),
    index('infirmary_medication_skips_consent_idx').on(
      table.institutionId,
      table.consentId,
      table.doseDay,
    ),
    index('infirmary_medication_skips_student_idx').on(
      table.institutionId,
      table.studentId,
      table.doseDay,
    ),
    index('infirmary_medication_skips_day_idx').on(table.institutionId, table.doseDay),
  ],
)

/**
 * Doz kaydı düzeltmesi (DOM-FIN-152; K-513): yönetici uygulama ya da atlama kaydına gerekçeli iptal
 * ya da düzeltme ekler; asıl kayıt değişmez. Gerekçe ve düzeltilmiş not/atlama gerekçesi şifreli
 * gruptadır; düzeltilmiş uygulama anı ve uygulayan düz kolondur. Her kaydın en çok bir iptali olur
 * (kısmi tekil indeks); satır yalnız eklenir (tetikleyici).
 */
export const infirmaryMedicationDoseCorrections = pgTable(
  'infirmary_medication_dose_corrections',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    consentId: uuid('consent_id').notNull(),
    targetKind: text('target_kind').$type<DoseRecordKind>().notNull(),
    administrationId: uuid('administration_id'),
    skipId: uuid('skip_id'),
    kind: text('kind').$type<DoseCorrectionKind>().notNull(),
    // Düzeltilmiş uygulama anı (yalnız uygulama düzeltmesinde).
    administeredAt: timestamp('administered_at', { withTimezone: true }),
    // kvkk: K — düzeltilmiş uygulayan personel (yalnız uygulama düzeltmesinde)
    administeredByMembershipId: text('administered_by_membership_id'),
    // kvkk: Ö — şifreli grup (gerekçe, düzeltilmiş not ya da atlama gerekçesi; JSON)
    healthCiphertext: text('health_ciphertext').notNull(),
    // Kişisel veri değil: yalnız anahtar sürümü.
    healthKeyVersion: integer('health_key_version').notNull(),
    // kvkk: K — düzeltmeyi yazan yönetici
    correctedByUserId: text('corrected_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'infirmary_medication_dose_corrections_pkey',
      columns: [table.institutionId, table.id],
    }),
    foreignKey({
      name: 'infirmary_medication_dose_corrections_consent_fkey',
      columns: [table.institutionId, table.consentId],
      foreignColumns: [infirmaryMedicationConsents.institutionId, infirmaryMedicationConsents.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'infirmary_medication_dose_corrections_administration_fkey',
      columns: [table.institutionId, table.administrationId],
      foreignColumns: [
        infirmaryMedicationAdministrations.institutionId,
        infirmaryMedicationAdministrations.id,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'infirmary_medication_dose_corrections_skip_fkey',
      columns: [table.institutionId, table.skipId],
      foreignColumns: [infirmaryMedicationSkips.institutionId, infirmaryMedicationSkips.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'infirmary_medication_dose_corrections_administered_by_fkey',
      columns: [table.institutionId, table.administeredByMembershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    check(
      'infirmary_medication_dose_corrections_kind_check',
      sql`${oneOf(table.kind, DOSE_CORRECTION_KINDS)} and ${oneOf(table.targetKind, DOSE_RECORD_KINDS)}`,
    ),
    // Hedef tam olarak bir kayıttır ve türüyle uyumludur; düz düzeltme alanları yalnız uygulama
    // düzeltmesinde dolar.
    check(
      'infirmary_medication_dose_corrections_target_check',
      sql`((${table.targetKind} = 'administration') = (${table.administrationId} is not null))
        and ((${table.targetKind} = 'skip') = (${table.skipId} is not null))
        and ((${table.kind} = 'amend' and ${table.targetKind} = 'administration')
          or (${table.administeredAt} is null and ${table.administeredByMembershipId} is null))`,
    ),
    check(
      'infirmary_medication_dose_corrections_key_version_check',
      sql`${table.healthKeyVersion} > 0`,
    ),
    uniqueIndex('infirmary_medication_dose_corrections_void_administration_key')
      .on(table.institutionId, table.administrationId)
      .where(sql`${table.kind} = 'void' and ${table.administrationId} is not null`),
    uniqueIndex('infirmary_medication_dose_corrections_void_skip_key')
      .on(table.institutionId, table.skipId)
      .where(sql`${table.kind} = 'void' and ${table.skipId} is not null`),
    index('infirmary_medication_dose_corrections_administration_idx')
      .on(table.institutionId, table.administrationId)
      .where(sql`${table.administrationId} is not null`),
    index('infirmary_medication_dose_corrections_skip_idx')
      .on(table.institutionId, table.skipId)
      .where(sql`${table.skipId} is not null`),
    index('infirmary_medication_dose_corrections_consent_idx').on(
      table.institutionId,
      table.consentId,
    ),
    index('infirmary_medication_dose_corrections_administered_by_idx')
      .on(table.institutionId, table.administeredByMembershipId)
      .where(sql`${table.administeredByMembershipId} is not null`),
  ],
)

/**
 * İlaç çizelgesi ayarı (DOM-FIN-152; K-511). Kurum başına bir satır; satır yoksa varsayılan
 * (gecikme payı 30 dk, ayar sürümü 1).
 */
export const infirmaryMedicationSettings = pgTable(
  'infirmary_medication_settings',
  {
    institutionId: text('institution_id')
      .primaryKey()
      .references(() => institutions.id),
    lateToleranceMinutes: integer('late_tolerance_minutes')
      .notNull()
      .default(LATE_TOLERANCE_DEFAULT_MINUTES),
    ...requiredColumns(),
  },
  (table) => [
    check(
      'infirmary_medication_settings_tolerance_check',
      sql`${table.lateToleranceMinutes} between ${n(LATE_TOLERANCE_MIN_MINUTES)} and ${n(LATE_TOLERANCE_MAX_MINUTES)}`,
    ),
  ],
)
