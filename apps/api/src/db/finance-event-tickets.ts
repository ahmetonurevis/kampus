import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm'

import type {
  ActiveEventTicket,
  EventDraft,
  EventTicketPaymentMethod,
  PlannedEventTicket,
} from '@kampus/school-core/lib/finance-event-tickets.ts'

import type { Database } from './client.ts'
import { records } from './schema/records.ts'
import {
  eventTicketCheckInReversals,
  eventTickets,
  ticketedEvents,
} from './schema/finance-event-tickets.ts'

/**
 * Etkinlik bileti deposu (DOM-FIN-103; ON-159, ON-345). Kurum kapsamlıdır: ilk parametre `institutionId`.
 * Etkinlik arşivlenir, bilet arşivlenmez (iptal edilir). Güncellemeler sürümle yazılır; 0 satır
 * döndüren güncelleme çağırana `false` olur (409).
 */

export interface StoredTicketedEvent extends EventDraft {
  id: string
  version: number
}

const EVENT_COLUMNS = {
  id: ticketedEvents.id,
  name: ticketedEvents.name,
  startsAt: ticketedEvents.startsAt,
  venue: ticketedEvents.venue,
  schoolEventId: ticketedEvents.schoolEventId,
  seatingMode: ticketedEvents.seatingMode,
  rowCount: ticketedEvents.rowCount,
  seatsPerRow: ticketedEvents.seatsPerRow,
  blockedSeats: ticketedEvents.blockedSeats,
  capacity: ticketedEvents.capacity,
  ticketTypes: ticketedEvents.ticketTypes,
  perStudentLimit: ticketedEvents.perStudentLimit,
  limitScope: ticketedEvents.limitScope,
  salesOpen: ticketedEvents.salesOpen,
  version: ticketedEvents.version,
}

const eventsOf = (institutionId: string) =>
  and(eq(ticketedEvents.institutionId, institutionId), isNull(ticketedEvents.archivedAt))

const toEvent = (row: Omit<StoredTicketedEvent, 'startsAt'> & { startsAt: Date }) => ({
  ...row,
  startsAt: row.startsAt.toISOString(),
})

/** Kurumun arşivlenmemiş etkinlikleri, başlangıca göre (yakın önce), eşitlikte ad. */
export async function listTicketedEvents(
  db: Database,
  institutionId: string,
): Promise<StoredTicketedEvent[]> {
  const rows = await db
    .select(EVENT_COLUMNS)
    .from(ticketedEvents)
    .where(eventsOf(institutionId))
    .orderBy(asc(ticketedEvents.startsAt), asc(ticketedEvents.name), asc(ticketedEvents.id))
  return rows.map(toEvent)
}

/** Tek etkinlik; yoksa, arşivliyse ya da başka kurumdaysa `null`. */
export async function findTicketedEvent(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredTicketedEvent | null> {
  const [row] = await db
    .select(EVENT_COLUMNS)
    .from(ticketedEvents)
    .where(and(eventsOf(institutionId), eq(ticketedEvents.id, id)))
  return row === undefined ? null : toEvent(row)
}

export async function insertTicketedEvent(
  tx: Database,
  institutionId: string,
  input: { id: string; draft: EventDraft; createdByUserId: string; now: Date },
): Promise<void> {
  const { draft } = input
  await tx.insert(ticketedEvents).values({
    ...draft,
    startsAt: new Date(draft.startsAt),
    institutionId,
    id: input.id,
    createdByUserId: input.createdByUserId,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

/** Etkinliğin bütün alanlarını yazar; sürüm tutmazsa `false`. */
export async function updateTicketedEvent(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; draft: EventDraft; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(ticketedEvents)
    .set({
      ...input.draft,
      startsAt: new Date(input.draft.startsAt),
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        eventsOf(institutionId),
        eq(ticketedEvents.id, input.id),
        eq(ticketedEvents.version, input.expectedVersion),
      ),
    )
    .returning({ id: ticketedEvents.id })
  return rows.length === 1
}

export async function archiveTicketedEvent(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(ticketedEvents)
    .set({ archivedAt: input.now, updatedAt: input.now, version: input.expectedVersion + 1 })
    .where(
      and(
        eventsOf(institutionId),
        eq(ticketedEvents.id, input.id),
        eq(ticketedEvents.version, input.expectedVersion),
      ),
    )
    .returning({ id: ticketedEvents.id })
  return rows.length === 1
}

// --- Bilet ---------------------------------------------------------------------------------------

export interface StoredEventTicket {
  id: string
  eventId: string
  code: string
  ticketTypeKey: string
  ticketTypeName: string
  ticketKind: PlannedEventTicket['ticketKind']
  priceCents: number
  seat: string | null
  studentId: string
  holderName: string
  status: 'active' | 'cancelled'
  paymentStatus: PlannedEventTicket['paymentStatus']
  paymentMethod: EventTicketPaymentMethod | null
  paidAt: string | null
  refundCents: number | null
  refundMethod: EventTicketPaymentMethod | null
  refundedAt: string | null
  usedAt: string | null
  usedByUserId: string | null
  cancelledAt: string | null
  cancelReason: string | null
  createdAt: string
  version: number
}

const TICKET_COLUMNS = {
  id: eventTickets.id,
  eventId: eventTickets.eventId,
  code: eventTickets.code,
  ticketTypeKey: eventTickets.ticketTypeKey,
  ticketTypeName: eventTickets.ticketTypeName,
  ticketKind: eventTickets.ticketKind,
  priceCents: eventTickets.priceCents,
  seat: eventTickets.seat,
  studentId: eventTickets.studentId,
  holderName: eventTickets.holderName,
  status: eventTickets.status,
  paymentStatus: eventTickets.paymentStatus,
  paymentMethod: eventTickets.paymentMethod,
  paidAt: eventTickets.paidAt,
  refundCents: eventTickets.refundCents,
  refundMethod: eventTickets.refundMethod,
  refundedAt: eventTickets.refundedAt,
  usedAt: eventTickets.usedAt,
  usedByUserId: eventTickets.usedByUserId,
  cancelledAt: eventTickets.cancelledAt,
  cancelReason: eventTickets.cancelReason,
  createdAt: eventTickets.createdAt,
  version: eventTickets.version,
}

type TicketRow = {
  [K in keyof StoredEventTicket]: K extends 'paidAt' | 'refundedAt' | 'usedAt' | 'cancelledAt'
    ? Date | null
    : K extends 'createdAt'
      ? Date
      : StoredEventTicket[K]
}

const iso = (value: Date | null) => value?.toISOString() ?? null
const toTicket = (row: TicketRow): StoredEventTicket => ({
  ...row,
  paidAt: iso(row.paidAt),
  refundedAt: iso(row.refundedAt),
  usedAt: iso(row.usedAt),
  cancelledAt: iso(row.cancelledAt),
  createdAt: row.createdAt.toISOString(),
})

const ticketsOf = (institutionId: string) => eq(eventTickets.institutionId, institutionId)

/** Etkinliklerin bütün biletleri (iptaller dahil), ayırma sırasıyla. */
export async function listEventTickets(
  db: Database,
  institutionId: string,
  eventIds: readonly string[],
): Promise<StoredEventTicket[]> {
  if (eventIds.length === 0) return []
  const rows = await db
    .select(TICKET_COLUMNS)
    .from(eventTickets)
    .where(and(ticketsOf(institutionId), inArray(eventTickets.eventId, [...new Set(eventIds)])))
    .orderBy(asc(eventTickets.createdAt), asc(eventTickets.seat), asc(eventTickets.id))
  return rows.map(toTicket)
}

/** Etkinliğin etkin biletleri (ayırma ve düzeltme denetimi). */
export async function activeEventTickets(
  db: Database,
  institutionId: string,
  eventId: string,
): Promise<ActiveEventTicket[]> {
  return db
    .select({
      seat: eventTickets.seat,
      ticketTypeKey: eventTickets.ticketTypeKey,
      studentId: eventTickets.studentId,
    })
    .from(eventTickets)
    .where(
      and(
        ticketsOf(institutionId),
        eq(eventTickets.eventId, eventId),
        eq(eventTickets.status, 'active'),
      ),
    )
}

export async function findEventTicket(
  db: Database,
  institutionId: string,
  id: string,
): Promise<StoredEventTicket | null> {
  const [row] = await db
    .select(TICKET_COLUMNS)
    .from(eventTickets)
    .where(and(ticketsOf(institutionId), eq(eventTickets.id, id)))
  return row === undefined ? null : toTicket(row)
}

export async function findEventTicketByCode(
  db: Database,
  institutionId: string,
  code: string,
): Promise<StoredEventTicket | null> {
  const [row] = await db
    .select(TICKET_COLUMNS)
    .from(eventTickets)
    .where(and(ticketsOf(institutionId), eq(eventTickets.code, code)))
  return row === undefined ? null : toTicket(row)
}

export async function insertEventTickets(
  tx: Database,
  institutionId: string,
  input: {
    eventId: string
    studentId: string
    tickets: readonly (PlannedEventTicket & { id: string; code: string })[]
    createdByUserId: string
    now: Date
  },
): Promise<void> {
  await tx.insert(eventTickets).values(
    input.tickets.map((ticket) => ({
      ...ticket,
      institutionId,
      eventId: input.eventId,
      studentId: input.studentId,
      createdByUserId: input.createdByUserId,
      createdAt: input.now,
      updatedAt: input.now,
    })),
  )
}

type TicketChange =
  | { kind: 'pay'; method: EventTicketPaymentMethod }
  | { kind: 'cancel'; reason: string | null; refundCents: number | null }
  | { kind: 'refund'; method: EventTicketPaymentMethod }
  | { kind: 'use' }
  | { kind: 'undo_use' }

function changeFields(change: TicketChange, now: Date, userId: string) {
  switch (change.kind) {
    case 'pay':
      return {
        paymentStatus: 'paid' as const,
        paymentMethod: change.method,
        paidAt: now,
        paidByUserId: userId,
      }
    case 'cancel':
      return {
        status: 'cancelled' as const,
        cancelledAt: now,
        cancelledByUserId: userId,
        cancelReason: change.reason,
        refundCents: change.refundCents,
      }
    case 'refund':
      return { refundMethod: change.method, refundedAt: now, refundedByUserId: userId }
    case 'use':
      return { usedAt: now, usedByUserId: userId }
    case 'undo_use':
      return { usedAt: null, usedByUserId: null }
    default:
      return change satisfies never
  }
}

/** Biletin ödeme, iptal, iade, giriş ya da girişi geri alma işareti; sürüm tutmazsa `false`. */
export async function changeEventTicket(
  tx: Database,
  institutionId: string,
  input: { id: string; expectedVersion: number; userId: string; now: Date; change: TicketChange },
): Promise<boolean> {
  const { now } = input
  const rows = await tx
    .update(eventTickets)
    .set({
      ...changeFields(input.change, now, input.userId),
      updatedAt: now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        ticketsOf(institutionId),
        eq(eventTickets.id, input.id),
        eq(eventTickets.version, input.expectedVersion),
      ),
    )
    .returning({ id: eventTickets.id })
  return rows.length === 1
}

/** Geri alınan girişin izi (K-378): eski kullanım anı, okutan, gerekçe ve geri alan. */
export async function insertCheckInReversal(
  tx: Database,
  institutionId: string,
  input: {
    id: string
    ticketId: string
    usedAt: string
    usedByUserId: string
    reason: string
    userId: string
    now: Date
  },
): Promise<void> {
  await tx.insert(eventTicketCheckInReversals).values({
    institutionId,
    id: input.id,
    ticketId: input.ticketId,
    usedAt: new Date(input.usedAt),
    usedByUserId: input.usedByUserId,
    reason: input.reason,
    createdByUserId: input.userId,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

/** Biletlerin geri alınmış giriş sayısı; satırı olmayan bilet haritada yoktur. */
export async function countCheckInReversals(
  db: Database,
  institutionId: string,
  ticketIds: readonly string[],
): Promise<Map<string, number>> {
  if (ticketIds.length === 0) return new Map()
  const rows = await db
    .select({ ticketId: eventTicketCheckInReversals.ticketId, total: count() })
    .from(eventTicketCheckInReversals)
    .where(
      and(
        eq(eventTicketCheckInReversals.institutionId, institutionId),
        inArray(eventTicketCheckInReversals.ticketId, [...new Set(ticketIds)]),
      ),
    )
    .groupBy(eventTicketCheckInReversals.ticketId)
  return new Map(rows.map((row) => [row.ticketId, row.total]))
}

// --- Bağlı kayıtlar ------------------------------------------------------------------------------

/** Öğrenci kaydı (arşivlenmemiş); `isActive` alanı yoksa etkin sayılır. */
export async function findTicketStudent(
  db: Database,
  institutionId: string,
  studentId: string,
): Promise<{ isActive: boolean } | null> {
  const [row] = await db
    .select({ isActive: sql<boolean | null>`(${records.data} ->> 'isActive')::boolean` })
    .from(records)
    .where(
      and(
        eq(records.institutionId, institutionId),
        eq(records.collection, 'students'),
        eq(records.id, studentId),
        isNull(records.archivedAt),
      ),
    )
  return row === undefined ? null : { isActive: row.isActive !== false }
}

/** Kayıt adları (`students` `name`, `schoolEvents` `title`); arşivlenen kayıt dahil. */
export async function loadTicketRecordNames(
  db: Database,
  institutionId: string,
  collection: 'students' | 'schoolEvents',
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const field = collection === 'students' ? 'name' : 'title'
  const rows = await db
    .select({ id: records.id, name: sql<string | null>`${records.data} ->> ${field}` })
    .from(records)
    .where(
      and(
        eq(records.institutionId, institutionId),
        eq(records.collection, collection),
        inArray(records.id, [...new Set(ids)]),
      ),
    )
  return new Map(rows.flatMap((row) => (row.name === null ? [] : [[row.id, row.name] as const])))
}

/** Okul takvimi etkinliği kurumda var mı (arşivlenmemiş). */
export async function schoolEventExists(
  db: Database,
  institutionId: string,
  id: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: records.id })
    .from(records)
    .where(
      and(
        eq(records.institutionId, institutionId),
        eq(records.collection, 'schoolEvents'),
        eq(records.id, id),
        isNull(records.archivedAt),
      ),
    )
  return row !== undefined
}
