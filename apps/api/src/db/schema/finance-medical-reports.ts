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
  uuid,
} from 'drizzle-orm/pg-core'

import {
  MEDICAL_REPORT_CANCEL_REASON_MAX,
  MEDICAL_REPORT_CANCEL_REASON_MIN,
  MEDICAL_REPORT_ISSUERS,
  MEDICAL_REPORT_MAX_DAYS,
  MEDICAL_REPORT_TYPES,
  type MedicalReportIssuer,
  type MedicalReportType,
} from '@kampus/school-core/lib/finance-medical-reports.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { files } from './files.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Personel sağlık raporu (DOM-FIN-110; ON-185). Bir personel üyeliğine istirahat raporunun yalnız
 * tarih aralığı ve sigorta türü; tanı, hastalık adı, ICD kodu ve serbest not tutulmaz (K-363).
 * Aynı personelin iptal edilmemiş raporlarının çakışmaması kurum kilidi altında servis denetimidir
 * (K-364). Rapor düzeltilmez: yalnız iki SGK işareti ve dosya değişir, yanlış kayıt gerekçeyle
 * iptal (arşiv) edilir; iptalde dosya bağı kalkar. Gün sayısı aralıktan türetilir ve denetlenir.
 */
export const staffMedicalReports = pgTable(
  'staff_medical_reports',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id').notNull(),
    // kvkk: Ö (sağlık; yalnız sigorta türü, tanı değil)
    reportType: text('report_type').$type<MedicalReportType>().notNull(),
    // kvkk: Ö (istirahat aralığı)
    startDate: date('start_date', { mode: 'string' }).notNull(),
    // kvkk: Ö
    endDate: date('end_date', { mode: 'string' }).notNull(),
    dayCount: integer('day_count').notNull(),
    issuerType: text('issuer_type').$type<MedicalReportIssuer>(),
    // kvkk: Ö (rapor dosyası)
    fileId: uuid('file_id'),
    employerNotifiedAt: timestamp('employer_notified_at', { withTimezone: true }),
    // kvkk: K
    employerNotifiedByUserId: text('employer_notified_by_user_id'),
    sgkApprovedAt: timestamp('sgk_approved_at', { withTimezone: true }),
    // kvkk: K
    sgkApprovedByUserId: text('sgk_approved_by_user_id'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    cancelReason: text('cancel_reason'),
    // kvkk: K
    cancelledByUserId: text('cancelled_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'staff_medical_reports_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'staff_medical_reports_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'staff_medical_reports_file_fkey',
      columns: [table.institutionId, table.fileId],
      foreignColumns: [files.institutionId, files.id],
    }).onDelete('restrict'),
    check('staff_medical_reports_type_check', oneOf(table.reportType, MEDICAL_REPORT_TYPES)),
    check(
      'staff_medical_reports_issuer_check',
      sql`${table.issuerType} is null or ${oneOf(table.issuerType, MEDICAL_REPORT_ISSUERS)}`,
    ),
    // Gün sayısı takvim günüdür, uçlar dahil; tek rapor en çok 366 gün (K-364).
    check(
      'staff_medical_reports_dates_check',
      sql`${table.endDate} >= ${table.startDate}
        and ${table.dayCount} = (${table.endDate} - ${table.startDate}) + 1
        and ${table.dayCount} <= ${n(MEDICAL_REPORT_MAX_DAYS)}`,
    ),
    // İşaret anı ve işaretleyen birlikte; SGK onayı işverene bildirimi ister (K-365).
    check(
      'staff_medical_reports_flags_check',
      sql`((${table.employerNotifiedAt} is null) = (${table.employerNotifiedByUserId} is null))
        and ((${table.sgkApprovedAt} is null) = (${table.sgkApprovedByUserId} is null))
        and (${table.sgkApprovedAt} is null or ${table.employerNotifiedAt} is not null)`,
    ),
    // İptal (arşiv) gerekçe ve iptal edeni birlikte taşır; iptal edilen raporun dosyası yoktur.
    check(
      'staff_medical_reports_cancel_check',
      sql`((${table.archivedAt} is null) = (${table.cancelReason} is null))
        and ((${table.archivedAt} is null) = (${table.cancelledByUserId} is null))
        and (${table.archivedAt} is null or ${table.fileId} is null)
        and (${table.cancelReason} is null or char_length(${table.cancelReason})
          between ${n(MEDICAL_REPORT_CANCEL_REASON_MIN)} and ${n(MEDICAL_REPORT_CANCEL_REASON_MAX)})`,
    ),
    index('staff_medical_reports_membership_idx').on(
      table.institutionId,
      table.membershipId,
      table.startDate,
    ),
    index('staff_medical_reports_period_idx')
      .on(table.institutionId, table.startDate, table.endDate)
      .where(sql`${table.archivedAt} is null`),
    index('staff_medical_reports_file_idx')
      .on(table.institutionId, table.fileId)
      .where(sql`${table.fileId} is not null`),
  ],
)
