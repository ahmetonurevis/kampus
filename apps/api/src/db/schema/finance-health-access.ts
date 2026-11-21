import { desc, sql } from 'drizzle-orm'
import { check, index, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core'

import {
  HEALTH_ACCESS_REASON_CODES,
  type HealthAccessReasonCode,
} from '@kampus/school-core/lib/finance-health-access.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

/**
 * Sağlık verisi okuma gerekçesi (DOM-FIN-156; ON-164; K-523…K-525; DOM-YTK-052). Gerekçeli her
 * sağlık okumasının `audit_log` satırına (aynı transaction'da) eşlik eder: gerekçe kodu, okuyan
 * üyelik ve okunan kaydın öğrencisi. Kim, ne zaman, hangi eylem ve hangi kayıt `audit_log`'dadır;
 * "diğer" gerekçenin açıklaması `audit_log.reason` kolonundadır (DOM-YTK-053 maskesi). `audit_log`
 * satırı silinmediğinden (tetikleyici, migration 0043) yabancı anahtar yoktur. Satır yalnız eklenir
 * (`kampus_reject_immutable_change`); saklama süresi dolunca yalnız imha işi siler.
 */
export const healthAccessReasons = pgTable(
  'health_access_reasons',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    // Eşlik ettiği `audit_log` satırının kimliği.
    auditLogId: uuid('audit_log_id').notNull(),
    // kvkk: K — sağlık verisini okuyan üyelik
    actorMembershipId: text('actor_membership_id').notNull(),
    // kvkk: Ç — okunan kaydın öğrencisi (records students); personel yaralanmasında boş
    studentId: text('student_id'),
    reasonCode: text('reason_code').$type<HealthAccessReasonCode>().notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'health_access_reasons_pkey',
      columns: [table.institutionId, table.auditLogId],
    }),
    check(
      'health_access_reasons_reason_code_check',
      oneOf(table.reasonCode, HEALTH_ACCESS_REASON_CODES),
    ),
    index('health_access_reasons_created_idx').on(table.institutionId, desc(table.createdAt)),
    index('health_access_reasons_actor_idx').on(
      table.institutionId,
      table.actorMembershipId,
      desc(table.createdAt),
    ),
    index('health_access_reasons_student_idx')
      .on(table.institutionId, table.studentId, desc(table.createdAt))
      .where(sql`${table.studentId} is not null`),
  ],
)
