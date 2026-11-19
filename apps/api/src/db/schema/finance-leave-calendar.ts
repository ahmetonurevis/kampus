import { sql } from 'drizzle-orm'
import { check, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core'

import {
  EXAM_WEEKS_MAX,
  LEAVE_CONCURRENT_THRESHOLD_DEFAULT,
  LEAVE_CONCURRENT_THRESHOLD_MAX,
  LEAVE_CONCURRENT_THRESHOLD_MIN,
  type ExamWeek,
} from '@kampus/school-core/lib/finance-leave-calendar.ts'

import { institutions } from './auth.ts'
import { requiredColumns } from './columns.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * İzin takvimi ayarı (DOM-FIN-123; ON-183; K-421, K-422). Kurum başına bir satır; satır yoksa
 * varsayılan geçerlidir (eşik 2, sınav haftası yok, sürüm 1). Sınav haftaları kısa bir aralık
 * listesidir ve bütün olarak yazılır; yazmadan önce core `leaveCalendarSettingsSchema` ile
 * doğrulanır (çakışmasız, en çok 40). Eğitim yılı takvimi (IST-011) sınav haftası taşıyınca oradan
 * okunması değerlendirilir.
 */
export const leaveCalendarSettings = pgTable(
  'leave_calendar_settings',
  {
    institutionId: text('institution_id')
      .primaryKey()
      .references(() => institutions.id),
    concurrentThreshold: integer('concurrent_threshold')
      .notNull()
      .default(LEAVE_CONCURRENT_THRESHOLD_DEFAULT),
    examWeeks: jsonb('exam_weeks').$type<ExamWeek[]>().notNull().default([]),
    ...requiredColumns(),
  },
  (table) => [
    check(
      'leave_calendar_settings_threshold_check',
      sql`${table.concurrentThreshold} between ${n(LEAVE_CONCURRENT_THRESHOLD_MIN)} and ${n(LEAVE_CONCURRENT_THRESHOLD_MAX)}`,
    ),
    check(
      'leave_calendar_settings_exam_weeks_check',
      sql`jsonb_typeof(${table.examWeeks}) = 'array' and jsonb_array_length(${table.examWeeks}) <= ${n(EXAM_WEEKS_MAX)}`,
    ),
  ],
)
