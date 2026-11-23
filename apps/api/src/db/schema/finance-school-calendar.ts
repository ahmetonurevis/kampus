import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  SCHOOL_EVENT_AUDIENCE_IDS_MAX,
  SCHOOL_EVENT_AUDIENCES,
  SCHOOL_EVENT_CANCEL_REASON_MAX,
  SCHOOL_EVENT_CANCEL_REASON_MIN,
  SCHOOL_EVENT_DESCRIPTION_MAX,
  SCHOOL_EVENT_KINDS,
  SCHOOL_EVENT_LOCATION_MAX,
  SCHOOL_EVENT_STATUSES,
  SCHOOL_EVENT_TITLE_MAX,
  SCHOOL_EVENT_TITLE_MIN,
  type SchoolEventAudience,
  type SchoolEventKind,
  type SchoolEventStatus,
} from '@kampus/school-core/lib/finance-school-calendar.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Okul etkinlik takvimi (DOM-FIN-163; ON-090; IST-099; K-544…K-546). Etkinlik bir ya da birkaç
 * Europe/Istanbul takvim günüdür (`start_date`…`end_date`, dahil); tüm gün değilse başlangıç ve
 * bitiş saati İstanbul duvar saatidir (`SS:DD`). Hedef kitle tüm kurum, kademe (sınıf düzeyi),
 * sınıf (`records` `classes` kimliği) ya da dil okulu grubudur (`language_groups` kimliği);
 * kimlikler kısa bir listedir ve yabancı anahtar değildir (sınıf `records`'tadır, grup başka
 * alanın tablosudur), varlığı yazarken core kuralıyla denetlenir. Etkinlik silinmez (arşiv yolu
 * yok), gerekçeyle iptal edilir; yayımlanmışken iptal edilenin yayım anı kalır ki hedef kitle
 * iptali görsün. Tarih aralığı sorgusu `school_calendar_events_range_idx` ile daralır.
 */
export const schoolCalendarEvents = pgTable(
  'school_calendar_events',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    title: text('title').notNull(),
    kind: text('kind').$type<SchoolEventKind>().notNull(),
    allDay: boolean('all_day').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    startTime: text('start_time'),
    endTime: text('end_time'),
    location: text('location'),
    description: text('description'),
    audienceKind: text('audience_kind').$type<SchoolEventAudience>().notNull(),
    audienceIds: text('audience_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: text('status').$type<SchoolEventStatus>().notNull().default('draft'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    // kvkk: K
    publishedByUserId: text('published_by_user_id'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    // kvkk: K
    cancelledByUserId: text('cancelled_by_user_id'),
    cancelReason: text('cancel_reason'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'school_calendar_events_pkey', columns: [table.institutionId, table.id] }),
    check('school_calendar_events_kind_check', oneOf(table.kind, SCHOOL_EVENT_KINDS)),
    check('school_calendar_events_status_check', oneOf(table.status, SCHOOL_EVENT_STATUSES)),
    check(
      'school_calendar_events_audience_kind_check',
      oneOf(table.audienceKind, SCHOOL_EVENT_AUDIENCES),
    ),
    check(
      'school_calendar_events_title_check',
      sql`char_length(${table.title}) between ${n(SCHOOL_EVENT_TITLE_MIN)} and ${n(SCHOOL_EVENT_TITLE_MAX)}`,
    ),
    check(
      'school_calendar_events_text_check',
      sql`(${table.location} is null or char_length(${table.location}) between 1 and ${n(SCHOOL_EVENT_LOCATION_MAX)})
        and (${table.description} is null or char_length(${table.description}) between 1 and ${n(SCHOOL_EVENT_DESCRIPTION_MAX)})`,
    ),
    check('school_calendar_events_dates_check', sql`${table.endDate} >= ${table.startDate}`),
    // Tüm günde saat yok; saatlide iki saat de `SS:DD` ve tek günlükte bitiş başlangıçtan sonra.
    check(
      'school_calendar_events_times_check',
      sql`case when ${table.allDay}
        then ${table.startTime} is null and ${table.endTime} is null
        else ${table.startTime} is not null and ${table.endTime} is not null
          and ${table.startTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          and ${table.endTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          and (${table.endDate} > ${table.startDate} or ${table.endTime} > ${table.startTime})
        end`,
    ),
    check(
      'school_calendar_events_all_day_kind_check',
      sql`${table.allDay} or ${table.kind} not in ('holiday', 'exam_week')`,
    ),
    check(
      'school_calendar_events_audience_check',
      sql`(${table.audienceKind} = 'institution') = (cardinality(${table.audienceIds}) = 0)
        and cardinality(${table.audienceIds}) <= ${n(SCHOOL_EVENT_AUDIENCE_IDS_MAX)}`,
    ),
    check(
      'school_calendar_events_published_check',
      sql`(${table.status} <> 'draft' or ${table.publishedAt} is null)
        and (${table.status} <> 'published' or ${table.publishedAt} is not null)
        and (${table.publishedAt} is null) = (${table.publishedByUserId} is null)`,
    ),
    check(
      'school_calendar_events_cancelled_check',
      sql`(${table.status} = 'cancelled') = (${table.cancelledAt} is not null)
        and (${table.cancelledAt} is null) = (${table.cancelledByUserId} is null)
        and (${table.cancelledAt} is null) = (${table.cancelReason} is null)
        and (${table.cancelReason} is null or char_length(${table.cancelReason}) between ${n(SCHOOL_EVENT_CANCEL_REASON_MIN)} and ${n(SCHOOL_EVENT_CANCEL_REASON_MAX)})`,
    ),
    index('school_calendar_events_range_idx')
      .on(table.institutionId, table.startDate, table.endDate)
      .where(sql`${table.archivedAt} is null`),
  ],
)
