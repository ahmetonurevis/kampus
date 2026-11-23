import { randomUUID } from 'node:crypto'

import { istanbulInstant } from '@kampus/school-core/lib/finance-infirmary-schedule.ts'
import { addDays } from '@kampus/school-core/lib/finance-opening-watch.ts'
import {
  assertSchoolEventCancellable,
  assertSchoolEventPublishable,
  institutionHolidays,
  planSchoolEventCreate,
  planSchoolEventUpdate,
  SCHOOL_CALENDAR_LINK_LABELS,
  SCHOOL_EVENT_KIND_LABELS,
  schoolCalendarIcs,
  schoolEventCancelSchema,
  schoolEventCreateSchema,
  schoolEventInstants,
  schoolEventUpdateSchema,
  schoolEventVisibleTo,
  type AudienceCheck,
  type CalendarViewer,
  type IcsEvent,
  type SchoolCalendarLinkSource,
  type SchoolEventFields,
} from '@kampus/school-core/lib/finance-school-calendar.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import {
  findSchoolEvent,
  insertSchoolEvent,
  institutionHolidayRows,
  linkedTicketedEvents,
  linkedTripPlans,
  listSchoolEvents,
  rangeSchoolEvents,
  ticketedEventIdsOfStudents,
  tripPlanIdsOfStaff,
  tripPlanIdsOfStudents,
  updateSchoolEvent,
  type SchoolEventFilters,
  type StoredSchoolEvent,
} from '../db/finance-school-calendar.ts'
import { loadGroups, loadMembershipsOfStudents } from '../db/language-groups.ts'
import { loadRecordsByIds } from '../db/records.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { assertReadable, readScope, readSource } from './read-scope.ts'
import { auditWork } from './task-work.ts'

/**
 * Okul etkinlik takvimi (DOM-FIN-163; ON-090; IST-099; K-544…K-546). Kural core
 * `lib/finance-school-calendar.ts`'tedir; servis kurum kilidi altında yükler ve aynı transaction'da
 * yazar. Denetime alan adları yazılır (başlık, açıklama ve iptal gerekçesi yazılmaz). Yönetici ve
 * ön büro kurumun bütün etkinliklerini okur; öğretmen, veli ve öğrenci yalnız yayımlanmış ve
 * kendi kademe, sınıf ya da grubunu hedefleyen etkinliği okur (core `schoolEventVisibleTo`;
 * kapsam `schoolEvents` kuralı ve `scope.studentIds`/`scope.classIds`). Gezi planı ve biletli
 * etkinlik okuma anında bağlantı olarak eklenir (K-546). Rol ve modül (`calendar`) rotadadır.
 */

const EVENT = 'school_calendar_events'
const CALENDAR_NAME = 'Okul takvimi'

// --- Görünüm -------------------------------------------------------------------------------------

/** Kademe, sınıf ve grup adları (arşivli sınıf da adıyla görünür). */
async function audienceNames(
  db: Database,
  institutionId: string,
  events: readonly StoredSchoolEvent[],
) {
  const classIds = [
    ...new Set(events.filter((e) => e.audienceKind === 'class').flatMap((e) => e.audienceIds)),
  ]
  const needsGroups = events.some((event) => event.audienceKind === 'group')
  const [classes, groups] = await Promise.all([
    loadRecordsByIds(db, institutionId, 'classes', classIds, { includeArchived: true }),
    needsGroups ? loadGroups(db, institutionId) : Promise.resolve([]),
  ])
  const names = new Map<string, string>()
  for (const row of classes)
    names.set(`class:${row.id}`, typeof row.data.name === 'string' ? row.data.name : row.id)
  for (const group of groups) names.set(`group:${group.id}`, group.name)
  return (event: StoredSchoolEvent): string[] =>
    event.audienceKind === 'institution'
      ? []
      : event.audienceIds.map((id) =>
          event.audienceKind === 'grade'
            ? `${id}. sınıf`
            : (names.get(`${event.audienceKind}:${id}`) ?? id),
        )
}

const timing = (event: SchoolEventFields) => schoolEventInstants(event)

const baseView = (event: StoredSchoolEvent) => ({
  id: event.id,
  title: event.title,
  kind: event.kind,
  allDay: event.allDay,
  startDate: event.startDate,
  endDate: event.endDate,
  startTime: event.startTime,
  endTime: event.endTime,
  ...timing(event),
  location: event.location,
  description: event.description,
  audienceKind: event.audienceKind,
  cancelReason: event.cancelReason,
})

/** Yönetim görünümü: hedef kimlikleri ve adları, durum anları ve sürüm. */
async function managerViews(
  db: Database,
  ctx: ServiceContext,
  events: readonly StoredSchoolEvent[],
) {
  const labels = await audienceNames(db, ctx.institutionId, events)
  return events.map((event) => ({
    ...baseView(event),
    audienceIds: [...event.audienceIds],
    audienceLabels: labels(event),
    status: event.status,
    publishedAt: event.publishedAt?.toISOString() ?? null,
    cancelledAt: event.cancelledAt?.toISOString() ?? null,
    updatedAt: event.updatedAt.toISOString(),
    version: event.version,
  }))
}

/** Hedef kitle görünümü: kimlik ve sürüm yok; durum yalnız yayımlandı ya da iptal edildi. */
const viewerView = (event: StoredSchoolEvent) => ({
  ...baseView(event),
  status: event.status === 'cancelled' ? ('cancelled' as const) : ('published' as const),
})

async function requireEvent(db: Database, ctx: ServiceContext, id: string) {
  const event = await findSchoolEvent(db, ctx.institutionId, id)
  if (event === null) throw new NotFoundError()
  return event
}

async function versionedEvent(tx: Database, ctx: ServiceContext, id: string, version: number) {
  const event = await requireEvent(tx, ctx, id)
  if (event.version !== version) throw new ConflictError()
  return event
}

async function eventDetail(db: Database, ctx: ServiceContext, id: string) {
  const [view] = await managerViews(db, ctx, [await requireEvent(db, ctx, id)])
  if (view === undefined) throw new NotFoundError()
  return view
}

// --- Bağlantılar (K-546) -------------------------------------------------------------------------

/** Günlerin UTC pencere anları: ilk günün İstanbul gece yarısı ile son günden sonraki gün. */
const windowOf = (from: string, to: string) => ({
  since: new Date(istanbulInstant(from, '00:00')),
  until: new Date(istanbulInstant(addDays(to, 1), '00:00')),
})

interface LinkView {
  source: SchoolCalendarLinkSource
  sourceId: string
  reference: string | null
  title: string
  startsAt: string
  endsAt: string | null
  location: string | null
  updatedAt: string
  version: number
}

/**
 * Takvime eklenen bağlantılar: aralıkta süren onaylı ya da tamamlanmış gezi planları ve aralıkta
 * başlayan biletli etkinlikler. `only` verilirse yalnız o kimlikler (kapsam süzgeci).
 */
async function linksFor(
  db: Database,
  institutionId: string,
  range: { from: string; to: string },
  only?: { planIds: readonly string[]; eventIds: readonly string[] },
): Promise<LinkView[]> {
  const window = windowOf(range.from, range.to)
  const [trips, tickets] = await Promise.all([
    linkedTripPlans(db, institutionId, {
      ...window,
      ...(only === undefined ? {} : { planIds: only.planIds }),
    }),
    linkedTicketedEvents(db, institutionId, {
      ...window,
      ...(only === undefined ? {} : { eventIds: only.eventIds }),
    }),
  ])
  return [
    ...trips.map((trip): LinkView => ({
      source: 'trip_plan',
      sourceId: trip.id,
      reference: `GZ-${String(trip.sequence)}`,
      title: trip.name,
      startsAt: trip.departureAt.toISOString(),
      endsAt: trip.returnAt.toISOString(),
      location: null,
      updatedAt: trip.updatedAt.toISOString(),
      version: trip.version,
    })),
    ...tickets.map((ticket): LinkView => ({
      source: 'ticketed_event',
      sourceId: ticket.id,
      reference: null,
      title: ticket.name,
      startsAt: ticket.startsAt.toISOString(),
      endsAt: null,
      location: ticket.venue,
      updatedAt: ticket.updatedAt.toISOString(),
      version: ticket.version,
    })),
  ].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title, 'tr'))
}

// --- Okuyan kapsamı ------------------------------------------------------------------------------

interface ViewerScope {
  viewer: CalendarViewer
  planIds: string[]
  eventIds: string[]
}

/**
 * Öğretmen, veli ve öğrencinin takvim kapsamı (K-544, K-546). Veli bağlı çocuklarının, öğrenci
 * kendinin sınıfı, kademesi (sınıf düzeyi) ve dil okulu grupları; öğretmen ders verdiği ve rehberi
 * olduğu sınıflar, onların kademeleri ve öğretmeni olduğu gruplar. Gezi: veli ve öğrencide
 * öğrencinin gezi günü grubunda olduğu, öğretmende görevli olduğu planlar; bilet: öğrenci adına
 * etkin bileti olan biletli etkinlikler (öğretmende yok).
 */
async function viewerScope(ctx: ServiceContext): Promise<ViewerScope> {
  const scope = await readScope(ctx)
  assertReadable(ctx, scope, 'schoolEvents')
  const source = await readSource(ctx)
  const classGrade = new Map(source.classes.map((row) => [row.id, row.grade]))
  if (ctx.actor.role === 'ogretmen') {
    const [groups, planIds] = await Promise.all([
      loadGroups(ctx.db, ctx.institutionId),
      tripPlanIdsOfStaff(ctx.db, ctx.institutionId, ctx.actor.membershipId),
    ])
    const classIds = new Set(scope.classIds)
    return {
      viewer: {
        classIds,
        grades: new Set(
          [...classIds].flatMap((id) => {
            const grade = classGrade.get(id)
            return grade === undefined ? [] : [grade]
          }),
        ),
        groupIds: new Set(
          groups
            .filter(
              (group) =>
                group.teacherMembershipId === ctx.actor.membershipId && group.state !== 'cancelled',
            )
            .map((group) => group.id),
        ),
      },
      planIds,
      eventIds: [],
    }
  }
  const students = source.students.filter((student) => scope.studentIds.has(student.id))
  const studentIds = students.map((student) => student.id)
  const [memberships, planIds, eventIds] = await Promise.all([
    loadMembershipsOfStudents(ctx.db, ctx.institutionId, studentIds),
    tripPlanIdsOfStudents(ctx.db, ctx.institutionId, studentIds),
    ticketedEventIdsOfStudents(ctx.db, ctx.institutionId, studentIds),
  ])
  return {
    viewer: {
      classIds: new Set(students.map((student) => student.classId)),
      grades: new Set(
        students.flatMap((student) => {
          const grade = classGrade.get(student.classId)
          return grade === undefined ? [] : [grade]
        }),
      ),
      groupIds: new Set(memberships.map((member) => member.groupId)),
    },
    planIds,
    eventIds,
  }
}

// --- Okuma ---------------------------------------------------------------------------------------

/** Liste görünümü (yönetici ve ön büro): süzgeçli, sayfalı. */
export async function listSchoolEventsFor(
  ctx: ServiceContext,
  query: SchoolEventFilters & { page: number; pageSize: number },
) {
  const { items, total } = await listSchoolEvents(ctx.db, ctx.institutionId, query)
  return { items: await managerViews(ctx.db, ctx, items), total }
}

/** Ay/hafta görünümü (yönetici ve ön büro): aralığın bütün etkinlikleri ve bağlantılar. */
export async function schoolCalendarFor(ctx: ServiceContext, query: SchoolEventFilters) {
  const [events, links] = await Promise.all([
    rangeSchoolEvents(ctx.db, ctx.institutionId, query),
    // Tür süzgeci yalnız etkinliklere uygulanır; gezi süzgeci seçiliyse bağlı gezi planları da gelir.
    query.kind === undefined || query.kind === 'trip'
      ? linksFor(ctx.db, ctx.institutionId, query)
      : Promise.resolve([]),
  ])
  return {
    from: query.from,
    to: query.to,
    events: await managerViews(ctx.db, ctx, events),
    links: (query.kind === 'trip'
      ? links.filter((link) => link.source === 'trip_plan')
      : links
    ).map(stripLinkMeta),
  }
}

/** Yanıttaki bağlantı: iCal'in kullandığı değişiklik anı ve sürüm dışarıda kalır. */
const stripLinkMeta = (link: LinkView) => ({
  source: link.source,
  sourceId: link.sourceId,
  reference: link.reference,
  title: link.title,
  startsAt: link.startsAt,
  endsAt: link.endsAt,
  location: link.location,
})

export async function getSchoolEventFor(ctx: ServiceContext, id: string) {
  return eventDetail(ctx.db, ctx, id)
}

async function visibleRange(ctx: ServiceContext, range: { from: string; to: string }) {
  const scope = await viewerScope(ctx)
  const [events, links] = await Promise.all([
    rangeSchoolEvents(ctx.db, ctx.institutionId, {
      ...range,
      statuses: ['published', 'cancelled'],
    }),
    linksFor(ctx.db, ctx.institutionId, range, {
      planIds: scope.planIds,
      eventIds: scope.eventIds,
    }),
  ])
  return { events: events.filter((event) => schoolEventVisibleTo(event, scope.viewer)), links }
}

/** Öğretmen, veli ve öğrenci takvimi (K-544, K-546): yalnız kendi kapsamı, yalnız yayımlanmış. */
export async function mySchoolCalendarFor(
  ctx: ServiceContext,
  range: { from: string; to: string },
) {
  const { events, links } = await visibleRange(ctx, range)
  return {
    from: range.from,
    to: range.to,
    events: events.map(viewerView),
    links: links.map(stripLinkMeta),
  }
}

/**
 * iCal dışa aktarımı (RFC 5545): yönetim rolleri kurumun yayımlanmış etkinliklerini (yayımdan sonra
 * iptal edilenler `CANCELLED`), diğer roller kendi takvimini ve bağlantılarını indirir. Taslak
 * dosyaya girmez. Kişisel abonelik bağlantısı yoktur; dosya oturumla indirilir.
 */
export async function schoolCalendarIcsFor(
  ctx: ServiceContext,
  range: { from: string; to: string },
  manager: boolean,
): Promise<{ ics: string; filename: string }> {
  const { events, links } = manager
    ? await Promise.all([
        rangeSchoolEvents(ctx.db, ctx.institutionId, {
          ...range,
          statuses: ['published', 'cancelled'],
        }),
        linksFor(ctx.db, ctx.institutionId, range),
      ]).then(([rows, linked]) => ({
        events: rows.filter((event) => event.publishedAt !== null),
        links: linked,
      }))
    : await visibleRange(ctx, range)
  const items: IcsEvent[] = [
    ...events.map((event): IcsEvent => ({
      uid: `${event.id}@kampus`,
      summary: event.title,
      category: SCHOOL_EVENT_KIND_LABELS[event.kind],
      location: event.location,
      description:
        event.status === 'cancelled' && event.cancelReason !== null
          ? `İptal edildi: ${event.cancelReason}`
          : event.description,
      cancelled: event.status === 'cancelled',
      sequence: event.version,
      lastModifiedAt: event.updatedAt.toISOString(),
      timing: event.allDay
        ? { allDay: true, startDate: event.startDate, endDate: event.endDate }
        : { allDay: false, ...schoolEventInstants(event) },
    })),
    ...links.map((link): IcsEvent => ({
      uid: `${link.source}-${link.sourceId}@kampus`,
      summary: link.reference === null ? link.title : `${link.reference} ${link.title}`,
      category: SCHOOL_CALENDAR_LINK_LABELS[link.source],
      location: link.location,
      description: null,
      cancelled: false,
      sequence: link.version,
      lastModifiedAt: link.updatedAt,
      timing: { allDay: false, startsAt: link.startsAt, endsAt: link.endsAt },
    })),
  ]
  return {
    ics: schoolCalendarIcs({ calendarName: CALENDAR_NAME, now: ctx.now, events: items }),
    filename: `okul-takvimi-${range.from}-${range.to}.ics`,
  }
}

/** Kurumun tatilleri (K-545): izin takvimi ve diğer çalışma günü hesapları buradan okur. */
export async function institutionHolidaysFor(
  db: Database,
  institutionId: string,
  range: { from: string; to: string },
) {
  return institutionHolidays(await institutionHolidayRows(db, institutionId, range))
}

// --- Yazma ---------------------------------------------------------------------------------------

/** Hedef sınıfların ve grupların kurumda varlığı (iptal edilmiş grup hedef olamaz). */
async function audienceCheck(
  tx: Database,
  ctx: ServiceContext,
  input: { audienceKind?: string | undefined; audienceIds?: readonly string[] | undefined },
): Promise<AudienceCheck> {
  const ids = [...new Set(input.audienceIds ?? [])]
  const [classes, groups] = await Promise.all([
    input.audienceKind === 'class'
      ? loadRecordsByIds(tx, ctx.institutionId, 'classes', ids)
      : Promise.resolve([]),
    input.audienceKind === 'group' ? loadGroups(tx, ctx.institutionId) : Promise.resolve([]),
  ])
  return {
    classIds: new Set(classes.map((row) => row.id)),
    groupIds: new Set(
      groups.filter((group) => group.state !== 'cancelled').map((group) => group.id),
    ),
  }
}

/** Yeni etkinlik (K-544): taslak açılır. `Idempotency-Key` rotada zorunlu. 201. */
export function createSchoolEventCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: EVENT, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.school_calendar.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = schoolEventCreateSchema.parse(input)
        const checks = await audienceCheck(tx, ctx, parsed)
        return { run: () => planSchoolEventCreate(parsed, checks) }
      },
      after: async (tx, values) => {
        await insertSchoolEvent(tx, ctx.institutionId, {
          id,
          values,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.school_calendar.create', entity, [
          'title',
          'kind',
          'startDate',
          'endDate',
          'audienceKind',
          ...(values.audienceIds.length === 0 ? [] : ['audienceIds']),
        ])
        body = { data: await eventDetail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Düzenleme (K-544): gönderilen alanlar birleşir, bütün olarak doğrulanır. `If-Match`. */
export function updateSchoolEventCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: EVENT, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.school_calendar.update',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = schoolEventUpdateSchema.parse(input)
        const event = await versionedEvent(tx, ctx, id, expectedVersion)
        const checks = await audienceCheck(tx, ctx, {
          audienceKind: parsed.audienceKind ?? event.audienceKind,
          audienceIds: parsed.audienceIds ?? event.audienceIds,
        })
        return { run: () => planSchoolEventUpdate(event, parsed, checks) }
      },
      after: async (tx, plan) => {
        const saved = await updateSchoolEvent(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: plan.values,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.school_calendar.update', entity, plan.changed)
        body = { data: await eventDetail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Yayım (K-544): yalnız taslak; hedef kitle görür. `If-Match`. */
export function publishSchoolEventCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: EVENT, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.school_calendar.publish',
      collections: [],
      entity,
      load: async (tx) => {
        const event = await versionedEvent(tx, ctx, id, expectedVersion)
        return { run: () => assertSchoolEventPublishable(event.status) }
      },
      after: async (tx) => {
        const saved = await updateSchoolEvent(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: {
            status: 'published',
            publishedAt: ctx.now,
            publishedByUserId: ctx.actor.userId,
          },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.school_calendar.publish', entity, [
          'status',
          'publishedAt',
        ])
        body = { data: await eventDetail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** İptal (K-544): gerekçeli; silme yok. `If-Match`. */
export function cancelSchoolEventCommand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: EVENT, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.school_calendar.cancel',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = schoolEventCancelSchema.parse(input)
        const event = await versionedEvent(tx, ctx, id, expectedVersion)
        return {
          run: () => {
            assertSchoolEventCancellable(event, dayKey(ctx.now))
            return parsed
          },
        }
      },
      after: async (tx, parsed) => {
        const saved = await updateSchoolEvent(tx, ctx.institutionId, {
          id,
          expectedVersion,
          now: ctx.now,
          values: {
            status: 'cancelled',
            cancelledAt: ctx.now,
            cancelledByUserId: ctx.actor.userId,
            cancelReason: parsed.reason,
          },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.school_calendar.cancel', entity, [
          'status',
          'cancelledAt',
          'cancelReason',
        ])
        body = { data: await eventDetail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
