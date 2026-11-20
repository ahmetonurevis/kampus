import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  PERFORMANCE_REPORT_ACK_CHANNELS,
  PERFORMANCE_REPORT_OPINION_MAX,
  PERFORMANCE_REPORT_OPINION_MIN,
  type PerformanceReportAckChannel,
} from '@kampus/school-core/lib/finance-performance-reports.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { performanceReviews } from './finance-performance.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Performans raporu kesinleştirme ve "okudum" kaydı (DOM-FIN-137; ON-220). Rapor içeriği
 * saklanmaz, kaynak kayıtlardan (performans kaydı, öz değerlendirme, ders gözlemi) okunur; satır
 * yalnız kesinleştirmede açılır ve yöneticinin görüşünü, kesinleştireni ve personelin okuma
 * kaydını (gün, kanal, giren) taşır (K-467). Performans kaydı başına tek satır.
 */
export const performanceReports = pgTable(
  'performance_reports',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    reviewId: uuid('review_id').notNull(),
    // kvkk: K (serbest metin; loglanmaz, denetime yazılmaz)
    managerOpinion: text('manager_opinion').notNull(),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }).notNull(),
    // kvkk: K
    finalizedByUserId: text('finalized_by_user_id').notNull(),
    // kvkk: K
    finalizedByName: text('finalized_by_name').notNull(),
    acknowledgedDate: date('acknowledged_date', { mode: 'string' }),
    acknowledgementChannel: text('acknowledgement_channel').$type<PerformanceReportAckChannel>(),
    acknowledgementRecordedAt: timestamp('acknowledgement_recorded_at', { withTimezone: true }),
    // kvkk: K
    acknowledgementRecordedByUserId: text('acknowledgement_recorded_by_user_id'),
    // kvkk: K
    acknowledgementRecordedByName: text('acknowledgement_recorded_by_name'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'performance_reports_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'performance_reports_review_fkey',
      columns: [table.institutionId, table.reviewId],
      foreignColumns: [performanceReviews.institutionId, performanceReviews.id],
    }).onDelete('restrict'),
    check(
      'performance_reports_opinion_check',
      sql`char_length(${table.managerOpinion}) between ${n(PERFORMANCE_REPORT_OPINION_MIN)} and ${n(PERFORMANCE_REPORT_OPINION_MAX)}`,
    ),
    check(
      'performance_reports_channel_check',
      sql`${table.acknowledgementChannel} is null or ${oneOf(table.acknowledgementChannel, PERFORMANCE_REPORT_ACK_CHANNELS)}`,
    ),
    check(
      'performance_reports_ack_check',
      sql`((${table.acknowledgedDate} is null) = (${table.acknowledgementChannel} is null))
        and ((${table.acknowledgedDate} is null) = (${table.acknowledgementRecordedAt} is null))
        and ((${table.acknowledgedDate} is null) = (${table.acknowledgementRecordedByUserId} is null))
        and ((${table.acknowledgedDate} is null) = (${table.acknowledgementRecordedByName} is null))`,
    ),
    uniqueIndex('performance_reports_review_key').on(table.institutionId, table.reviewId),
  ],
)
