import { randomBytes, randomUUID } from 'node:crypto'

import {
  assertEventArchivable,
  EVENT_TICKET_CODE_BYTES,
  eventTicketState,
  eventTicketsCsv,
  eventTicketSummary,
  normalizeTicketCode,
  planEvent,
  planEventTicketAllocation,
  planEventTicketCancel,
  planEventTicketCheckIn,
  planEventTicketPayment,
  planEventUpdate,
  ticketCodeFromBytes,
  type EventDraft,
  type EventTicketState,
} from '@kampus/school-core/lib/finance-event-tickets.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'

import type { Database } from '../db/client.ts'
import {
  activeEventTickets,
  archiveTicketedEvent,
  changeEventTicket,
  findEventTicket,
  findEventTicketByCode,
  findTicketedEvent,
  findTicketStudent,
  insertEventTickets,
  insertTicketedEvent,
  listEventTickets,
  listTicketedEvents,
  loadTicketRecordNames,
  schoolEventExists,
  updateTicketedEvent,
  type StoredEventTicket,
  type StoredTicketedEvent,
} from '../db/finance-event-tickets.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { foldSearch } from '../db/text-search.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Etkinlik bileti ve oturma servisi (docs/domain/finans.md DOM-FIN-103; ON-159; K-324…K-327). Kural
 * core `lib/finance-event-tickets.ts`'tedir. Her yazma kurum kilidi altında tek transaction'dadır:
 * aynı koltuğa eşzamanlı iki ayırma sıraya girer, ikincisi 409 `event_seat_taken` alır; kısmi tekil
 * indeks (`event_tickets_event_seat_key`) son güvencedir. Rol ve modül denetimi rotadadır. Bilet
 * kodu, bilet sahibi adı ve iptal notu loglanmaz; denetime yalnız alan adları düşer.
 */

const EVENT = 'ticketed_events'
const TICKET = 'event_tickets'

interface Page {
  page: number
  pageSize: number
}
const pageOf = <T>(items: readonly T[], query: Page) => ({
  items: items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
  total: items.length,
})

/** Saklanan etkinliğin core taslağı (kimlik ve sürüm dışında). */
function draftOf(event: StoredTicketedEvent): EventDraft {
  return {
    name: event.name,
    startsAt: event.startsAt,
    venue: event.venue,
    schoolEventId: event.schoolEventId,
    seatingMode: event.seatingMode,
    rowCount: event.rowCount,
    seatsPerRow: event.seatsPerRow,
    blockedSeats: event.blockedSeats,
    capacity: event.capacity,
    ticketTypes: event.ticketTypes,
    perStudentLimit: event.perStudentLimit,
    salesOpen: event.salesOpen,
  }
}

/** Takvim etkinliği kurumda yoksa 422 (başka kurumun kaydı da "bulunamadı"dır). */
async function assertSchoolEvent(tx: Database, ctx: ServiceContext, id: string | null) {
  if (id !== null && !(await schoolEventExists(tx, ctx.institutionId, id)))
    throw new DomainError('event_school_event_not_found', 'Takvim etkinliği bulunamadı.', {
      kind: 'rule',
      path: ['schoolEventId'],
    })
}

// --- Görünümler ----------------------------------------------------------------------------------

async function eventViews(db: Database, ctx: ServiceContext, events: StoredTicketedEvent[]) {
  const [tickets, titles] = await Promise.all([
    listEventTickets(
      db,
      ctx.institutionId,
      events.map((event) => event.id),
    ),
    loadTicketRecordNames(
      db,
      ctx.institutionId,
      'schoolEvents',
      events.flatMap((event) => (event.schoolEventId === null ? [] : [event.schoolEventId])),
    ),
  ])
  const byEvent = new Map<string, StoredEventTicket[]>()
  for (const ticket of tickets) {
    const list = byEvent.get(ticket.eventId) ?? []
    list.push(ticket)
    byEvent.set(ticket.eventId, list)
  }
  return events.map((event) => {
    const own = byEvent.get(event.id) ?? []
    const summary = eventTicketSummary(event, own)
    return {
      ...event,
      schoolEventTitle:
        event.schoolEventId === null ? null : (titles.get(event.schoolEventId) ?? null),
      totalCapacity: summary.capacity,
      activeCount: summary.activeCount,
      availableCount: summary.availableCount,
      invitationCount: summary.invitationCount,
      usedCount: summary.usedCount,
      unpaidCount: summary.unpaidCount,
      collectedCents: summary.collectedCents,
      takenSeats: own.flatMap((ticket) =>
        ticket.status === 'active' && ticket.seat !== null ? [ticket.seat] : [],
      ),
    }
  })
}
export type EventView = Awaited<ReturnType<typeof eventViews>>[number]

async function eventView(db: Database, ctx: ServiceContext, id: string): Promise<EventView> {
  const event = await findTicketedEvent(db, ctx.institutionId, id)
  if (event === null) throw new NotFoundError()
  const [view] = await eventViews(db, ctx, [event])
  if (view === undefined) throw new NotFoundError()
  return view
}

export interface EventListQuery extends Page {
  q?: string | undefined
  when?: 'upcoming' | 'past' | undefined
}

/**
 * Etkinlik listesi (DOM-FIN-103): yaklaşanlar başlangıca göre yakın önce; `when=past` başlangıcı
 * geçenler, `upcoming` başlamayanlar. `q` ad ve salonda arar.
 */
export async function listTicketedEventsFor(ctx: ServiceContext, query: EventListQuery) {
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const now = ctx.now.getTime()
  const events = (await listTicketedEvents(ctx.db, ctx.institutionId)).filter((event) => {
    const started = Date.parse(event.startsAt) <= now
    return (
      (query.when === undefined || (query.when === 'past') === started) &&
      (search === undefined ||
        foldSearch(event.name).includes(search) ||
        foldSearch(event.venue).includes(search))
    )
  })
  if (query.when === 'past') events.reverse()
  const { items, total } = pageOf(events, query)
  return { items: await eventViews(ctx.db, ctx, items), total }
}

export const getTicketedEventFor = (ctx: ServiceContext, id: string) => eventView(ctx.db, ctx, id)

export interface TicketListQuery extends Page {
  q?: string | undefined
  state?: EventTicketState | undefined
  studentId?: string | undefined
}

async function ticketRows(
  ctx: ServiceContext,
  eventId: string,
  query: Omit<TicketListQuery, keyof Page>,
) {
  const event = await findTicketedEvent(ctx.db, ctx.institutionId, eventId)
  if (event === null) throw new NotFoundError()
  const tickets = await listEventTickets(ctx.db, ctx.institutionId, [eventId])
  const names = await loadTicketRecordNames(
    ctx.db,
    ctx.institutionId,
    'students',
    tickets.map((ticket) => ticket.studentId),
  )
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const rows = tickets
    .map((ticket) => ({
      ...ticket,
      studentName: names.get(ticket.studentId) ?? null,
      state: eventTicketState(ticket),
    }))
    .filter(
      (row) =>
        (query.state === undefined || row.state === query.state) &&
        (query.studentId === undefined || row.studentId === query.studentId) &&
        (search === undefined ||
          [row.holderName, row.studentName ?? '', row.seat ?? '', row.code].some((value) =>
            foldSearch(value).includes(search),
          )),
    )
  return { event, rows }
}

/** Etkinliğin satış listesi (DOM-FIN-103): ayırma sırasıyla; başka kurumun etkinliği 404. */
export async function listEventTicketsFor(
  ctx: ServiceContext,
  eventId: string,
  query: TicketListQuery,
) {
  const { rows } = await ticketRows(ctx, eventId, query)
  return pageOf(rows, query)
}

/**
 * Satış listesi CSV'si (K-327): süzgeçle eşleşen bütün biletler; bilet kodu yazılmaz. Bilet sahibi
 * ve öğrenci adı taşıdığı için rota taze oturum ister; dosya denetime düşer
 * (`finance.event_ticket_export`).
 */
export async function eventTicketsCsvFor(
  ctx: ServiceContext,
  eventId: string,
  query: Omit<TicketListQuery, keyof Page>,
) {
  const { rows } = await ticketRows(ctx, eventId, query)
  const csv = eventTicketsCsv(rows)
  await ctx.db.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action: 'finance.event_ticket_export',
    entityType: EVENT,
    entityId: eventId,
    changes: { fields: [] },
    createdAt: ctx.now,
  })
  return { csv, filename: `etkinlik-biletleri-${dayKey(ctx.now)}.csv` }
}

// --- Etkinlik komutları --------------------------------------------------------------------------

/** Etkinlik açar (K-325). 201. */
export function createTicketedEventCommand(
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
      action: 'ticketed_event.create',
      collections: [],
      entity,
      run: () => planEvent(input, { now: ctx.now, newKey: randomUUID }),
      after: async (tx, draft) => {
        await assertSchoolEvent(tx, ctx, draft.schoolEventId)
        await insertTicketedEvent(tx, ctx.institutionId, {
          id,
          draft,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'ticketed_event.create', entity, Object.keys(draft))
        body = { data: await eventView(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Etkinlik düzeltmesi ve satışı açma/kapama (K-325); `If-Match` etkinliğin sürümüdür. */
export function updateTicketedEventCommand(
  ctx: ServiceContext,
  eventId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: EVENT, id: eventId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'ticketed_event.update',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await findTicketedEvent(tx, ctx.institutionId, eventId)
        if (current === null) throw new NotFoundError()
        if (current.version !== expectedVersion) throw new ConflictError()
        const active = await activeEventTickets(tx, ctx.institutionId, eventId)
        return {
          run: () =>
            planEventUpdate(draftOf(current), input, { now: ctx.now, newKey: randomUUID, active }),
        }
      },
      after: async (tx, { next, changed }) => {
        if (changed.includes('schoolEventId')) await assertSchoolEvent(tx, ctx, next.schoolEventId)
        const saved = await updateTicketedEvent(tx, ctx.institutionId, {
          id: eventId,
          expectedVersion,
          draft: next,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'ticketed_event.update', entity, changed)
        body = { data: await eventView(tx, ctx, eventId) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Etkinliği arşivler; etkin bileti varsa 422 `event_has_tickets`. */
export function archiveTicketedEventCommand(
  ctx: ServiceContext,
  eventId: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: EVENT, id: eventId }
  return runCommand(
    ctx,
    {
      action: 'ticketed_event.archive',
      collections: [],
      entity,
      load: async (tx) => {
        const current = await findTicketedEvent(tx, ctx.institutionId, eventId)
        if (current === null) throw new NotFoundError()
        if (current.version !== expectedVersion) throw new ConflictError()
        const active = await activeEventTickets(tx, ctx.institutionId, eventId)
        return { run: () => assertEventArchivable(active) }
      },
      after: async (tx) => {
        const saved = await archiveTicketedEvent(tx, ctx.institutionId, {
          id: eventId,
          expectedVersion,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'ticketed_event.archive', entity, ['archivedAt'])
      },
    },
    () => ({ statusCode: 200, body: { data: { id: eventId, archivedAt: ctx.now.toISOString() } } }),
    idempotency,
  )
}

// --- Bilet komutları -----------------------------------------------------------------------------

async function ticketView(tx: Database, ctx: ServiceContext, ticket: StoredEventTicket) {
  const names = await loadTicketRecordNames(tx, ctx.institutionId, 'students', [ticket.studentId])
  return {
    ...ticket,
    studentName: names.get(ticket.studentId) ?? null,
    state: eventTicketState(ticket),
  }
}
export type EventTicketView = Awaited<ReturnType<typeof ticketView>>

async function reloadTicket(tx: Database, ctx: ServiceContext, id: string) {
  const ticket = await findEventTicket(tx, ctx.institutionId, id)
  if (ticket === null) throw new NotFoundError()
  return ticketView(tx, ctx, ticket)
}

/**
 * Bilet ayırma (K-325, K-326): öğrencinin ailesine 1–10 bilet; her bilete kriptografik rastgele kod
 * verilir. 201; yanıt yeni biletlerdir.
 */
export function allocateEventTicketsCommand(
  ctx: ServiceContext,
  eventId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: EVENT, id: eventId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'event_ticket.allocate',
      collections: [],
      entity,
      load: async (tx) => {
        const event = await findTicketedEvent(tx, ctx.institutionId, eventId)
        if (event === null) throw new NotFoundError()
        const active = await activeEventTickets(tx, ctx.institutionId, eventId)
        const studentId =
          typeof input === 'object' && input !== null && 'studentId' in input
            ? String(input.studentId).trim()
            : ''
        const student =
          studentId === '' ? null : await findTicketStudent(tx, ctx.institutionId, studentId)
        return { run: () => planEventTicketAllocation(input, { event, active, student }) }
      },
      after: async (tx, plan) => {
        const tickets = plan.tickets.map((ticket) => ({
          ...ticket,
          id: randomUUID(),
          code: ticketCodeFromBytes(randomBytes(EVENT_TICKET_CODE_BYTES)),
        }))
        await insertEventTickets(tx, ctx.institutionId, {
          eventId,
          studentId: plan.studentId,
          tickets,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        for (const ticket of tickets)
          await auditWork(tx, ctx, 'event_ticket.allocate', { type: TICKET, id: ticket.id }, [
            'eventId',
            'studentId',
            'ticketTypeKey',
            'seat',
            'holderName',
          ])
        body = {
          data: await Promise.all(tickets.map((ticket) => reloadTicket(tx, ctx, ticket.id))),
        }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

type TicketCommand = 'pay' | 'cancel'

/** Ödeme işareti (nakit/havale) ya da iptal (K-326); `If-Match` verilirse biletin sürümüdür. */
export function changeEventTicketCommand(
  ctx: ServiceContext,
  command: TicketCommand,
  ticketId: string,
  input: unknown,
  expectedVersion: number | null,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: TICKET, id: ticketId }
  const action = command === 'pay' ? 'event_ticket.pay' : 'event_ticket.cancel'
  let body: unknown
  return runCommand(
    ctx,
    {
      action,
      collections: [],
      entity,
      load: async (tx) => {
        const ticket = await findEventTicket(tx, ctx.institutionId, ticketId)
        if (ticket === null) throw new NotFoundError()
        if (expectedVersion !== null && ticket.version !== expectedVersion)
          throw new ConflictError()
        return {
          run: () =>
            command === 'pay'
              ? {
                  ticket,
                  change: { kind: 'pay' as const, ...planEventTicketPayment(input, ticket) },
                }
              : {
                  ticket,
                  change: { kind: 'cancel' as const, ...planEventTicketCancel(input, ticket) },
                },
        }
      },
      after: async (tx, { ticket, change }) => {
        const saved = await changeEventTicket(tx, ctx.institutionId, {
          id: ticketId,
          expectedVersion: ticket.version,
          userId: ctx.actor.userId,
          now: ctx.now,
          change,
        })
        if (!saved) throw new ConflictError()
        await auditWork(
          tx,
          ctx,
          action,
          entity,
          change.kind === 'pay'
            ? ['paymentStatus', 'paymentMethod', 'paidAt']
            : ['status', 'cancelledAt', ...(change.refunded ? ['refundedAt'] : [])],
        )
        body = { data: await reloadTicket(tx, ctx, ticketId) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Girişte kodla "kullanıldı" işareti (K-326). Kod normalleşir; kurumda olmayan kod 404 (başka
 * kurumun kodu da). Başka etkinliğin bileti 422, ikinci okutma 409 `event_ticket_already_used`.
 */
export function checkInEventTicketCommand(
  ctx: ServiceContext,
  eventId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const raw =
    typeof input === 'object' && input !== null && 'code' in input ? String(input.code) : ''
  const code = normalizeTicketCode(raw)
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'event_ticket.check_in',
      collections: [],
      entity: { type: EVENT, id: eventId },
      load: async (tx) => {
        const event = await findTicketedEvent(tx, ctx.institutionId, eventId)
        if (event === null) throw new NotFoundError()
        const ticket =
          code === null ? null : await findEventTicketByCode(tx, ctx.institutionId, code)
        if (ticket === null) throw new NotFoundError()
        return {
          run: () => {
            planEventTicketCheckIn(ticket, eventId)
            return ticket
          },
        }
      },
      after: async (tx, ticket) => {
        const saved = await changeEventTicket(tx, ctx.institutionId, {
          id: ticket.id,
          expectedVersion: ticket.version,
          userId: ctx.actor.userId,
          now: ctx.now,
          change: { kind: 'use' },
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'event_ticket.check_in', { type: TICKET, id: ticket.id }, [
          'usedAt',
        ])
        body = { data: await reloadTicket(tx, ctx, ticket.id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
