import { and, asc, count, eq, gte, inArray, isNull, lt, lte, sql, type SQL } from 'drizzle-orm'

import type {
  SchoolEventAudience,
  SchoolEventFields,
  SchoolEventKind,
  SchoolEventStatus,
} from '@kampus/school-core/lib/finance-school-calendar.ts'

import type { Database } from './client.ts'
import { eventTickets, ticketedEvents } from './schema/finance-event-tickets.ts'
import { schoolCalendarEvents } from './schema/finance-school-calendar.ts'
import { tripDayMembers } from './schema/finance-trip-day.ts'
import { tripPlans, tripPlanStaff } from './schema/finance-trip-plans.ts'
import { foldSearch, foldSql } from './text-search.ts'

/**
 * Okul etkinlik takvimi deposu (DOM-FIN-163; ON-090; K-544…K-546). Kurum kapsamlıdır: ilk
 * parametre `institutionId`. Etkinlik arşivlenmez; arşivli satır yine de okunmaz. Gezi planı ve
 * biletli etkinlik bağlantıları (K-546) kendi tablolarından salt okunur; kopya yazılmaz.
 */

export interface StoredSchoolEvent extends SchoolEventFields {
  id: string
  status: SchoolEventStatus
  publishedAt: Date | null
  cancelledAt: Date | null
  cancelReason: string | null
  createdAt: Date
  updatedAt: Date
  version: number
}

const EVENT = {
  id: schoolCalendarEvents.id,
  title: schoolCalendarEvents.title,
  kind: schoolCalendarEvents.kind,
  allDay: schoolCalendarEvents.allDay,
  startDate: schoolCalendarEvents.startDate,
  endDate: schoolCalendarEvents.endDate,
  startTime: schoolCalendarEvents.startTime,
  endTime: schoolCalendarEvents.endTime,
  location: schoolCalendarEvents.location,
  description: schoolCalendarEvents.description,
  audienceKind: schoolCalendarEvents.audienceKind,
  audienceIds: schoolCalendarEvents.audienceIds,
  status: schoolCalendarEvents.status,
  publishedAt: schoolCalendarEvents.publishedAt,
  cancelledAt: schoolCalendarEvents.cancelledAt,
  cancelReason: schoolCalendarEvents.cancelReason,
  createdAt: schoolCalendarEvents.createdAt,
  updatedAt: schoolCalendarEvents.updatedAt,
  version: schoolCalendarEvents.version,
}

const live = (institutionId: string) =>
  and(
    eq(schoolCalendarEvents.institutionId, institutionId),
    isNull(schoolCalendarEvents.archivedAt),
  )

/** Aralığa değen etkinlikler (`start_date <= to` ve `end_date >= from`). */
const overlapping = (from: string, to: string) =>
  and(lte(schoolCalendarEvents.startDate, to), gte(schoolCalendarEvents.endDate, from))

const ORDER = [
  asc(schoolCalendarEvents.startDate),
  sql`${schoolCalendarEvents.allDay} desc`,
  sql`${schoolCalendarEvents.startTime} asc nulls first`,
  asc(schoolCalendarEvents.title),
  asc(schoolCalendarEvents.id),
]

export interface SchoolEventFilters {
  from: string
  to: string
  kind?: SchoolEventKind | undefined
  status?: SchoolEventStatus | undefined
  audienceKind?: SchoolEventAudience | undefined
  q?: string | undefined
}

function filtersOf(institutionId: string, query: SchoolEventFilters): SQL | undefined {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  return and(
    live(institutionId),
    overlapping(query.from, query.to),
    query.kind === undefined ? undefined : eq(schoolCalendarEvents.kind, query.kind),
    query.status === undefined ? undefined : eq(schoolCalendarEvents.status, query.status),
    query.audienceKind === undefined
      ? undefined
      : eq(schoolCalendarEvents.audienceKind, query.audienceKind),
    search === undefined
      ? undefined
      : sql`strpos(${foldSql(schoolCalendarEvents.title)}, ${search}) > 0`,
  )
}

export async function findSchoolEvent(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredSchoolEvent | null> {
  const [row] = await db
    .select(EVENT)
    .from(schoolCalendarEvents)
    .where(and(live(institutionId), eq(schoolCalendarEvents.id, id)))
    .limit(1)
  return row ?? null
}

/** Liste görünümü: süzgeçli ve sayfalı, başlangıç sırasıyla. */
export async function listSchoolEvents(
  db: Database,
  institutionId: string,
  query: SchoolEventFilters & { page: number; pageSize: number },
): Promise<{ items: StoredSchoolEvent[]; total: number }> {
  const where = filtersOf(institutionId, query)
  const [totalRow] = await db.select({ total: count() }).from(schoolCalendarEvents).where(where)
  const items = await db
    .select(EVENT)
    .from(schoolCalendarEvents)
    .where(where)
    .orderBy(...ORDER)
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)
  return { items, total: totalRow?.total ?? 0 }
}

/**
 * Ay/hafta görünümü: aralığa değen bütün etkinlikler (aralık en çok 62 gün olduğundan sayfasız).
 * `statuses` verilirse yalnız o durumlar.
 */
export async function rangeSchoolEvents(
  db: Database,
  institutionId: string,
  query: SchoolEventFilters & { statuses?: readonly SchoolEventStatus[] },
): Promise<StoredSchoolEvent[]> {
  return db
    .select(EVENT)
    .from(schoolCalendarEvents)
    .where(
      and(
        filtersOf(institutionId, query),
        query.statuses === undefined
          ? undefined
          : inArray(schoolCalendarEvents.status, [...query.statuses]),
      ),
    )
    .orderBy(...ORDER)
}

/** Aralığa değen yayımlanmış, tüm kurum hedefli tatiller (K-545). */
export async function institutionHolidayRows(
  db: Database,
  institutionId: string,
  range: { from: string; to: string },
): Promise<StoredSchoolEvent[]> {
  return db
    .select(EVENT)
    .from(schoolCalendarEvents)
    .where(
      and(
        live(institutionId),
        overlapping(range.from, range.to),
        eq(schoolCalendarEvents.kind, 'holiday'),
        eq(schoolCalendarEvents.status, 'published'),
        eq(schoolCalendarEvents.audienceKind, 'institution'),
      ),
    )
    .orderBy(...ORDER)
}

export async function insertSchoolEvent(
  tx: Database,
  institutionId: string,
  input: { id: string; values: SchoolEventFields; createdByUserId: string; now: Date },
) {
  await tx.insert(schoolCalendarEvents).values({
    institutionId,
    id: input.id,
    ...input.values,
    createdByUserId: input.createdByUserId,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

/** Etkinliği sürüm koşuluyla günceller ve sürümü artırır; tutmazsa `false` (409). */
export async function updateSchoolEvent(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    expectedVersion: number
    now: Date
    values: Partial<
      SchoolEventFields & {
        status: SchoolEventStatus
        publishedAt: Date
        publishedByUserId: string
        cancelledAt: Date
        cancelledByUserId: string
        cancelReason: string
      }
    >
  },
): Promise<boolean> {
  const rows = await tx
    .update(schoolCalendarEvents)
    .set({
      ...input.values,
      updatedAt: input.now,
      version: sql`${schoolCalendarEvents.version} + 1`,
    })
    .where(
      and(
        live(institutionId),
        eq(schoolCalendarEvents.id, input.id),
        eq(schoolCalendarEvents.version, input.expectedVersion),
      ),
    )
    .returning({ id: schoolCalendarEvents.id })
  return rows.length === 1
}

// --- Bağlantılar (K-546) -------------------------------------------------------------------------

export interface LinkedTripPlan {
  id: string
  sequence: number
  name: string
  departureAt: Date
  returnAt: Date
  status: 'approved' | 'completed'
  updatedAt: Date
  version: number
}

export interface LinkedTicketedEvent {
  id: string
  name: string
  startsAt: Date
  venue: string
  updatedAt: Date
  version: number
}

/**
 * Anlar arasında süren onaylı ya da tamamlanmış geziler (`departure_at < until` ve
 * `return_at >= since`). `planIds` verilirse yalnız onlar.
 */
export async function linkedTripPlans(
  db: Database,
  institutionId: string,
  window: { since: Date; until: Date; planIds?: readonly string[] },
): Promise<LinkedTripPlan[]> {
  if (window.planIds !== undefined && window.planIds.length === 0) return []
  const rows = await db
    .select({
      id: tripPlans.id,
      sequence: tripPlans.sequence,
      name: tripPlans.name,
      departureAt: tripPlans.departureAt,
      returnAt: tripPlans.returnAt,
      status: tripPlans.status,
      updatedAt: tripPlans.updatedAt,
      version: tripPlans.version,
    })
    .from(tripPlans)
    .where(
      and(
        eq(tripPlans.institutionId, institutionId),
        isNull(tripPlans.archivedAt),
        inArray(tripPlans.status, ['approved', 'completed']),
        lt(tripPlans.departureAt, window.until),
        gte(tripPlans.returnAt, window.since),
        window.planIds === undefined ? undefined : inArray(tripPlans.id, [...window.planIds]),
      ),
    )
    .orderBy(asc(tripPlans.departureAt), asc(tripPlans.id))
  return rows.map((row) => ({
    ...row,
    status: row.status === 'completed' ? 'completed' : 'approved',
  }))
}

/** Anlar arasında başlayan, arşivlenmemiş biletli etkinlikler. `eventIds` verilirse yalnız onlar. */
export async function linkedTicketedEvents(
  db: Database,
  institutionId: string,
  window: { since: Date; until: Date; eventIds?: readonly string[] },
): Promise<LinkedTicketedEvent[]> {
  if (window.eventIds !== undefined && window.eventIds.length === 0) return []
  return db
    .select({
      id: ticketedEvents.id,
      name: ticketedEvents.name,
      startsAt: ticketedEvents.startsAt,
      venue: ticketedEvents.venue,
      updatedAt: ticketedEvents.updatedAt,
      version: ticketedEvents.version,
    })
    .from(ticketedEvents)
    .where(
      and(
        eq(ticketedEvents.institutionId, institutionId),
        isNull(ticketedEvents.archivedAt),
        gte(ticketedEvents.startsAt, window.since),
        lt(ticketedEvents.startsAt, window.until),
        window.eventIds === undefined
          ? undefined
          : inArray(ticketedEvents.id, [...window.eventIds]),
      ),
    )
    .orderBy(asc(ticketedEvents.startsAt), asc(ticketedEvents.id))
}

/** Öğrencilerin gezi günü grubunda olduğu planlar (aile görünümü, K-546). */
export async function tripPlanIdsOfStudents(
  db: Database,
  institutionId: string,
  studentIds: readonly string[],
): Promise<string[]> {
  if (studentIds.length === 0) return []
  const rows = await db
    .selectDistinct({ planId: tripDayMembers.planId })
    .from(tripDayMembers)
    .where(
      and(
        eq(tripDayMembers.institutionId, institutionId),
        isNull(tripDayMembers.archivedAt),
        inArray(tripDayMembers.studentId, [...studentIds]),
      ),
    )
  return rows.map((row) => row.planId)
}

/** Üyeliğin görevli olduğu gezi planları (öğretmen görünümü, K-546). */
export async function tripPlanIdsOfStaff(
  db: Database,
  institutionId: string,
  membershipId: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ planId: tripPlanStaff.planId })
    .from(tripPlanStaff)
    .where(
      and(
        eq(tripPlanStaff.institutionId, institutionId),
        isNull(tripPlanStaff.archivedAt),
        eq(tripPlanStaff.membershipId, membershipId),
      ),
    )
  return rows.map((row) => row.planId)
}

/** Öğrencilerin adına etkin bileti olan biletli etkinlikler (aile görünümü, K-546). */
export async function ticketedEventIdsOfStudents(
  db: Database,
  institutionId: string,
  studentIds: readonly string[],
): Promise<string[]> {
  if (studentIds.length === 0) return []
  const rows = await db
    .selectDistinct({ eventId: eventTickets.eventId })
    .from(eventTickets)
    .where(
      and(
        eq(eventTickets.institutionId, institutionId),
        isNull(eventTickets.archivedAt),
        eq(eventTickets.status, 'active'),
        inArray(eventTickets.studentId, [...studentIds]),
      ),
    )
  return rows.map((row) => row.eventId)
}
