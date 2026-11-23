import { randomBytes, randomUUID } from 'node:crypto'

import {
  assertEventArchivable,
  EVENT_TICKET_CODE_BYTES,
  eventTicketCheckInUndoBlocker,
  eventTicketRefundStatus,
  eventTicketState,
  eventTicketsCsv,
  eventTicketSummary,
  normalizeTicketCode,
  planEvent,
  planEventTicketAllocation,
  planEventTicketCancel,
  planEventTicketCheckIn,
  planEventTicketCheckInUndo,
  planEventTicketPayment,
  planEventTicketRefund,
  planEventUpdate,
  ticketCodeFromBytes,
  type EventDraft,
  type EventTicketFacts,
  type EventTicketState,
} from '@kampus/school-core/lib/finance-event-tickets.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'

import type { Database } from '../db/client.ts'
import {
  activeEventTickets,
  archiveTicketedEvent,
  changeEventTicket,
  countCheckInReversals,
  findEventTicket,
  findEventTicketByCode,
  findTicketedEvent,
  findTicketStudent,
  insertCheckInReversal,
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
import { loadStudentFamilies } from '../db/finance-renewal-candidates.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { foldSearch } from '../db/text-search.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Etkinlik bileti ve oturma servisi (docs/domain/finans.md DOM-FIN-103; ON-159, ON-345;
 * K-324…K-327, K-378…K-380). Kural core `lib/finance-event-tickets.ts`'tedir. Her yazma kurum kilidi
 * altında tek transaction'dadır: aynı koltuğa eşzamanlı iki ayırma sıraya girer, ikincisi 409
 * `event_seat_taken` alır; kısmi tekil indeks (`event_tickets_event_seat_key`) son güvencedir. Aile
 * sınırında kardeş kümesi ve etkin biletler aynı kilit altında okunur; iki kardeşe eşzamanlı ayırma
 * sınırı aşamaz. Rol ve modül denetimi rotadadır. Bilet kodu, bilet sahibi adı, iptal notu ve girişi
 * geri alma gerekçesi loglanmaz; denetime yalnız alan adları düşer.
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
    limitScope: event.limitScope,
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
      pendingRefundCount: summary.pendingRefundCount,
      pendingRefundCents: summary.pendingRefundCents,
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
  const search = query.q === undefined ? undefined : foldSearch(query.q)
  const rows = (await ticketViews(ctx.db, ctx, event, tickets)).filter(
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

/**
 * Biletlerin yanıt görünümü: öğrenci adı, durum, iade durumu, geri alınmış giriş sayısı ve isteği
 * yapanın girişi geri alıp alamayacağı (K-378; düğme yalnız alınabilecekse görünür). Okutan
 * personelin kimliği yanıta girmez.
 */
async function ticketViews(
  db: Database,
  ctx: ServiceContext,
  event: Pick<StoredTicketedEvent, 'startsAt'> | null,
  tickets: readonly StoredEventTicket[],
) {
  const ids = tickets.map((ticket) => ticket.id)
  const [names, undos] = await Promise.all([
    loadTicketRecordNames(
      db,
      ctx.institutionId,
      'students',
      tickets.map((ticket) => ticket.studentId),
    ),
    countCheckInReversals(db, ctx.institutionId, ids),
  ])
  return tickets.map(({ usedByUserId, ...ticket }) => ({
    ...ticket,
    studentName: names.get(ticket.studentId) ?? null,
    state: eventTicketState(ticket),
    refundStatus: eventTicketRefundStatus(ticket),
    checkInUndoCount: undos.get(ticket.id) ?? 0,
    canUndoCheckIn:
      event !== null &&
      eventTicketCheckInUndoBlocker(
        { status: ticket.status, usedAt: ticket.usedAt, usedByUserId },
        { startsAt: event.startsAt, now: ctx.now, actor: ctx.actor },
      ) === null,
  }))
}
export type EventTicketView = Awaited<ReturnType<typeof ticketViews>>[number]

async function reloadTicket(tx: Database, ctx: ServiceContext, id: string) {
  const ticket = await findEventTicket(tx, ctx.institutionId, id)
  if (ticket === null) throw new NotFoundError()
  const event = await findTicketedEvent(tx, ctx.institutionId, ticket.eventId)
  const [view] = await ticketViews(tx, ctx, event, [ticket])
  if (view === undefined) throw new NotFoundError()
  return view
}

/**
 * Bilet ayırma (K-325, K-326, K-379): öğrencinin ailesine 1–10 bilet; her bilete kriptografik
 * rastgele kod verilir. Aile sınırında aynı veliye bağlı kardeşlerin etkin biletleri birlikte
 * sayılır. 201; yanıt yeni biletlerdir.
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
        // Aile sınırında kardeş kümesi kurum kilidi altında okunur (K-379): aynı aileye eşzamanlı
        // iki ayırma sıraya girer, ikincisi birincinin biletlerini sayar.
        const family =
          student !== null && event.limitScope === 'family' && event.perStudentLimit !== null
            ? await loadStudentFamilies(tx, ctx.institutionId, [studentId])
            : [studentId]
        return {
          run: () => planEventTicketAllocation(input, { event, active, student, family }),
        }
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

type TicketCommand = 'pay' | 'cancel' | 'refund' | 'undo-check-in'

const TICKET_ACTIONS = {
  pay: 'event_ticket.pay',
  cancel: 'event_ticket.cancel',
  refund: 'event_ticket.refund',
  'undo-check-in': 'event_ticket.undo_check_in',
} as const satisfies Record<TicketCommand, string>

type TicketPlan =
  | { kind: 'pay'; method: 'cash' | 'transfer' }
  | { kind: 'cancel'; reason: string | null; refundCents: number | null }
  | { kind: 'refund'; method: 'cash' | 'transfer' }
  | { kind: 'undo'; reason: string; usedAt: string; usedByUserId: string }

/** Denetime düşen alan adları; tutar, not ve gerekçe yazılmaz. */
function auditFields(plan: TicketPlan): string[] {
  switch (plan.kind) {
    case 'pay':
      return ['paymentStatus', 'paymentMethod', 'paidAt']
    case 'cancel':
      return ['status', 'cancelledAt', ...(plan.refundCents === null ? [] : ['refundCents'])]
    case 'refund':
      return ['refundMethod', 'refundedAt']
    case 'undo':
      return ['usedAt', 'checkInReversal']
    default:
      return plan satisfies never
  }
}

/**
 * Bilet komutları: ödeme işareti (nakit/havale), iptal ve iade tutarı (K-326, K-380), iadenin
 * ödendiği işareti (K-380) ve girişi geri alma (K-378). İptal ve geri alma etkinliğin başlangıcını
 * okur (iade kuralı, etkinlik günü); geri almada eski kullanım `event_ticket_check_in_reversals`
 * satırına taşınır. `If-Match` verilirse biletin sürümüdür.
 */
export function changeEventTicketCommand(
  ctx: ServiceContext,
  command: TicketCommand,
  ticketId: string,
  input: unknown,
  expectedVersion: number | null,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: TICKET, id: ticketId }
  const action = TICKET_ACTIONS[command]
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
        const facts: EventTicketFacts = ticket
        const startsAt = async () => {
          const event = await findTicketedEvent(tx, ctx.institutionId, ticket.eventId)
          if (event === null) throw new NotFoundError()
          return event.startsAt
        }
        switch (command) {
          case 'pay':
            return {
              run: () => ({
                ticket,
                plan: { kind: 'pay' as const, ...planEventTicketPayment(input, facts) },
              }),
            }
          case 'refund':
            return {
              run: () => ({
                ticket,
                plan: { kind: 'refund' as const, ...planEventTicketRefund(input, facts) },
              }),
            }
          case 'cancel': {
            const context = { startsAt: await startsAt(), now: ctx.now, role: ctx.actor.role }
            return {
              run: () => ({
                ticket,
                plan: {
                  kind: 'cancel' as const,
                  ...planEventTicketCancel(input, facts, context),
                },
              }),
            }
          }
          case 'undo-check-in': {
            const context = { startsAt: await startsAt(), now: ctx.now, actor: ctx.actor }
            return {
              run: () => ({
                ticket,
                plan: {
                  kind: 'undo' as const,
                  ...planEventTicketCheckInUndo(input, facts, context),
                },
              }),
            }
          }
          default:
            return command satisfies never
        }
      },
      after: async (tx, { ticket, plan }: { ticket: StoredEventTicket; plan: TicketPlan }) => {
        if (plan.kind === 'undo')
          await insertCheckInReversal(tx, ctx.institutionId, {
            id: randomUUID(),
            ticketId,
            usedAt: plan.usedAt,
            usedByUserId: plan.usedByUserId,
            reason: plan.reason,
            userId: ctx.actor.userId,
            now: ctx.now,
          })
        const saved = await changeEventTicket(tx, ctx.institutionId, {
          id: ticketId,
          expectedVersion: ticket.version,
          userId: ctx.actor.userId,
          now: ctx.now,
          change: plan.kind === 'undo' ? { kind: 'undo_use' } : plan,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, action, entity, auditFields(plan))
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
