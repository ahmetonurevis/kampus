import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  allocateEventTicketsSchema,
  cancelEventTicketSchema,
  checkInEventTicketSchema,
  createEventSchema,
  EVENT_MANAGE_ROLES,
  EVENT_TICKET_ROLES,
  payEventTicketSchema,
  updateEventSchema,
} from '@kampus/school-core/lib/finance-event-tickets.ts'

import type { Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  allocateEventTicketsCommand,
  archiveTicketedEventCommand,
  changeEventTicketCommand,
  checkInEventTicketCommand,
  createTicketedEventCommand,
  eventTicketsCsvFor,
  getTicketedEventFor,
  listEventTicketsFor,
  listTicketedEventsFor,
  updateTicketedEventCommand,
} from '../services/finance-event-tickets.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  eventTicketAllocationResponse,
  eventTicketListQuery,
  eventTicketListResponse,
  eventTicketParams,
  eventTicketResponse,
  ticketedEventArchiveResponse,
  ticketedEventListQuery,
  ticketedEventListResponse,
  ticketedEventParams,
  ticketedEventResponse,
} from './finance-event-tickets.schemas.ts'

/**
 * Etkinlik bileti ve oturma uçları (docs/domain/finans.md DOM-FIN-103; ON-159; K-324…K-327). Modül
 * `finance`. Etkinliği yönetici açar, düzeltir ve arşivler; yönetici ve ön büro okur, bilet ayırır,
 * ödeme işaretler, iptal eder ve girişte kod okutur (K-324). Bilet ayırma, ödeme ve iptal
 * `Idempotency-Key` ister (çift tıklama ikinci bileti ya da ikinci ödemeyi yazmaz); iptal ödenmiş
 * bilette bedel iadesi olduğu için taze oturum ister. Sıra: 401 → 403 modül → 403 rol → `If-Match`
 * → 400 → işlem.
 */

const READERS = 'Roller: `yonetici`, `onburo` (K-324). Modül `finance`.'
const MANAGER = 'Rol: `yonetici` (K-324). Modül `finance`.'
const EVENTS = '/api/v1/finance/ticketed-events'
const TICKETS = '/api/v1/finance/event-tickets'
const CSV_PER_MINUTE = 10
const READS_PER_MINUTE = 300

const wantsCsv = (request: FastifyRequest) => (request.headers.accept ?? '').includes('text/csv')

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceEventTicketRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')
  const guarded = (roles: readonly Role[]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    finance,
    app.requireRole(roles),
  ]
  const readers = guarded(EVENT_TICKET_ROLES)
  const managers = guarded(EVENT_MANAGE_ROLES)
  const freshForCsv: preValidationAsyncHookHandler = async function (request, reply) {
    if (wantsCsv(request)) await app.requireFreshSession.call(app, request, reply)
  }
  const tags = ['finance-event-tickets']
  const eventFields =
    'Ad (2–120), başlangıç anı (ISO 8601, gelecekte; 422 `event_starts_in_past`), salon (2–120), isteğe bağlı okul takvimi etkinliği (`schoolEventId`; kurumda yoksa 422 `event_school_event_not_found`), oturma düzeni: `seated` sıra sayısı (1–26, A–Z) × sıra başına koltuk (1–60) ve kapalı koltuklar (`A1` biçimi) ya da `general` kontenjan (1–5000); bilet türleri (1–5; `invitation` fiyat 0, `paid` fiyat > 0 kuruş, ad tekil) ve öğrenci başına üst sınır (1–20, boşsa sınırsız).'

  typed.get(
    EVENTS,
    {
      preValidation: readers,
      schema: {
        operationId: 'listTicketedEvents',
        tags,
        summary: 'Biletli etkinlikleri listele',
        description: `Etkinlikler başlangıca göre yakın önce (\`when=past\` en yeni önce); kontenjan, etkin, boş, kullanılan, ödeme bekleyen bilet ve tahsil edilen tutar her okumada hesaplanır (DOM-FIN-103). \`q\` ad ve salonda arar. ${READERS}`,
        querystring: ticketedEventListQuery,
        response: { 200: ticketedEventListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, ...filters } = request.query
      const { items, total } = await listTicketedEventsFor(contextOf(request), {
        page,
        pageSize,
        ...filters,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    EVENTS,
    {
      preValidation: [...managers, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createTicketedEvent',
        tags,
        summary: 'Biletli etkinlik aç',
        description: `Gösteri ya da tören için etkinlik açar (DOM-FIN-103, K-325): ${eventFields} Satış açık başlar. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        body: createEventSchema,
        response: { 201: ticketedEventResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createTicketedEventCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      return ticketedEventResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${EVENTS}/:eventId`,
    {
      preValidation: readers,
      schema: {
        operationId: 'getTicketedEvent',
        tags,
        summary: 'Etkinlik ayrıntısı ve koltuk haritası',
        description: `Etkinlik, özet sayılar ve etkin bileti olan koltuklar (\`takenSeats\`); koltuk haritası salon düzeni, kapalı ve alınmış koltuklardan çizilir. Olmayan, arşivli ya da başka kurumun etkinliği 404. ${READERS}`,
        params: ticketedEventParams,
        response: { 200: ticketedEventResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getTicketedEventFor(contextOf(request), request.params.eventId),
    }),
  )

  typed.patch(
    `${EVENTS}/:eventId`,
    {
      preValidation: [...managers, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateTicketedEvent',
        tags,
        summary: 'Etkinliği düzelt, satışı aç ya da kapat',
        description: `Kısmi düzeltme (K-325): verilen alanlar mevcut kayıtla birleşip bütün olarak denetlenir; \`salesOpen\` satışı açar ya da kapatır. Etkin bilet varken oturma düzeni türü değişmez (422 \`event_seating_locked\`), biletli koltuk kapatılamaz ya da salondan çıkarılamaz (422 \`event_seat_in_use\`), kontenjan bilet sayısının altına inmez (422 \`event_capacity_below_sold\`), bileti olan tür kaldırılamaz (422 \`event_ticket_type_in_use\`); var olan türün anahtarı korunur, bilinmeyen anahtar 422 \`event_ticket_type_unknown\`. Değişiklik yoksa 422 \`event_unchanged\`. Satılmış bilet ayırma anındaki ad ve fiyatı taşır. \`If-Match\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: ticketedEventParams,
        body: updateEventSchema,
        response: { 200: ticketedEventResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateTicketedEventCommand(
        contextOf(request),
        request.params.eventId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return ticketedEventResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    `${EVENTS}/:eventId`,
    {
      preValidation: [...managers, requireIfMatch()],
      schema: {
        operationId: 'archiveTicketedEvent',
        tags,
        summary: 'Etkinliği arşivle',
        description: `Etkin bileti olan etkinlik arşivlenmez (422 \`event_has_tickets\`; önce biletler iptal edilir). Olmayan ya da başka kurumun etkinliği 404; \`If-Match\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: ticketedEventParams,
        response: { 200: ticketedEventArchiveResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await archiveTicketedEventCommand(
        contextOf(request),
        request.params.eventId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return ticketedEventArchiveResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${EVENTS}/:eventId/tickets`,
    {
      config: {
        rateLimit: {
          max: (request: FastifyRequest) => (wantsCsv(request) ? CSV_PER_MINUTE : READS_PER_MINUTE),
          timeWindow: '1 minute',
          hook: 'preHandler' as const,
          keyGenerator: (request: FastifyRequest) =>
            wantsCsv(request)
              ? `event-ticket-csv:${request.auth?.userId ?? request.ip}`
              : request.ip,
        },
      },
      preValidation: [...readers, freshForCsv],
      schema: {
        operationId: 'listEventTickets',
        tags,
        summary: 'Etkinliğin satış listesi',
        description: `Biletler ayırma sırasıyla; \`state\` (\`valid\`, \`unpaid\`, \`used\`, \`cancelled\`), \`studentId\` süzer, \`q\` bilet sahibi, öğrenci adı, koltuk ve kodda arar (DOM-FIN-103). Başka kurumun etkinliği 404. \`Accept: text/csv\` süzgeçle eşleşen bütün biletleri verir (\`;\` ayırıcı, UTF-8 BOM, formül kaçışı, zamanlar Europe/Istanbul); bilet kodu yazılmaz. Bilet sahibi ve öğrenci adı taşıdığı için taze oturum ister (eskiyse 403 \`reauthentication_required\`), kullanıcı başına 10/dk, denetim \`finance.event_ticket_export\` (K-327). ${READERS}`,
        params: ticketedEventParams,
        querystring: eventTicketListQuery,
        // CSV gövdesi `reply.serializer` ile gider; şemada yalnız JSON durur, istemci tipi tek kalsın.
        response: { 200: eventTicketListResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const ctx = contextOf(request)
      const { page, pageSize, ...filters } = request.query
      if (wantsCsv(request)) {
        const { csv, filename } = await eventTicketsCsvFor(ctx, request.params.eventId, filters)
        return (reply as FastifyReply)
          .type('text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="${filename}"`)
          .serializer((payload: unknown) => String(payload))
          .send(`\uFEFF${csv}`)
      }
      const { items, total } = await listEventTicketsFor(ctx, request.params.eventId, {
        page,
        pageSize,
        ...filters,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    `${EVENTS}/:eventId/tickets`,
    {
      preValidation: [...readers, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'allocateEventTickets',
        tags,
        summary: 'Öğrenci ailesine bilet ayır',
        description: `Bir öğrencinin ailesine 1–10 bilet ayırır (K-325): bilet başına tür, bilet sahibinin adı (veli ya da misafir) ve numaralı salonda koltuk. Satış kapalıysa 422 \`event_sales_closed\`; öğrenci kurumda yoksa 422 \`event_ticket_student_not_found\` (başka kurumun öğrencisi de), etkin değilse \`event_ticket_student_inactive\`. Koltuk: eksik \`event_seat_required\`, salonda yok \`event_seat_unknown\`, kapalı \`event_seat_blocked\`, istekte iki kez \`event_seat_duplicate\`, başka bilette 409 \`event_seat_taken\` (eşzamanlı ayırma kurum kilidiyle sıraya girer; kısmi tekil indeks son güvencedir). Numarasızda koltuk 422 \`event_seat_not_allowed\`, kontenjan aşımı \`event_sold_out\`; öğrenci başına üst sınır \`event_ticket_limit_exceeded\` (iptal edilen bilet sayılmaz). Ücretli bilet ödenmemiş başlar. Her bilete tahmin edilemez kod verilir (K-326). \`Idempotency-Key\` zorunlu. ${READERS}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: ticketedEventParams,
        body: allocateEventTicketsSchema,
        response: { 201: eventTicketAllocationResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await allocateEventTicketsCommand(
        contextOf(request),
        request.params.eventId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return eventTicketAllocationResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${EVENTS}/:eventId/check-in`,
    {
      preValidation: [...readers, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'checkInEventTicket',
        tags,
        summary: 'Girişte bilet kodunu okut',
        description: `Kodu okunan bileti "kullanıldı" işaretler (K-326). Kod boşluk, tire ve küçük harf fark etmeden okunur (\`O\`→\`0\`, \`I\`/\`L\`→\`1\`). Kurumda olmayan kod 404; başka etkinliğin bileti 422 \`event_ticket_wrong_event\`, iptal edilmiş 422 \`event_ticket_cancelled\`, ödemesi alınmamış 422 \`event_ticket_unpaid\`, ikinci okutma 409 \`event_ticket_already_used\`. ${READERS}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        params: ticketedEventParams,
        body: checkInEventTicketSchema,
        response: { 200: eventTicketResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await checkInEventTicketCommand(
        contextOf(request),
        request.params.eventId,
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      return eventTicketResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${TICKETS}/:ticketId/pay`,
    {
      preValidation: [...readers, captureInput()],
      schema: {
        operationId: 'payEventTicket',
        tags,
        summary: 'Bilet ödemesini işaretle',
        description: `Ücretli biletin ödemesini elle işaretler: \`cash\` nakit, \`transfer\` havale/EFT; çevrim içi ödeme yoktur (K-326). Ödeme gün sonuna ve muhasebe aktarımına girmez (M-49). Davetiye 422 \`event_ticket_free\`, iptal edilmiş 422 \`event_ticket_cancelled\`, ödenmiş 409 \`event_ticket_already_paid\`. Başka kurumun bileti 404. \`Idempotency-Key\` zorunlu; \`If-Match\` verilirse biletin sürümüdür. ${READERS}`,
        headers: commandHeadersSchema('required'),
        params: eventTicketParams,
        body: payEventTicketSchema,
        response: { 200: eventTicketResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'required')
      const result = await changeEventTicketCommand(
        contextOf(request),
        'pay',
        request.params.ticketId,
        request.commandInput,
        opts.expectedVersion,
        opts.idempotency,
      )
      return eventTicketResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${TICKETS}/:ticketId/cancel`,
    {
      preValidation: [...readers, app.requireFreshSession, captureInput()],
      schema: {
        operationId: 'cancelEventTicket',
        tags,
        summary: 'Bileti iptal et',
        description: `Bileti iptal eder; koltuk boşa çıkar ve yeniden ayrılabilir (K-326). Ödenmiş biletin bedeli iptalle elle iade edilmiş sayılır (\`refundedAt\`; kısmi iade yok), bu yüzden taze oturum ister (eskiyse 403 \`reauthentication_required\`). Kullanılmış bilet 422 \`event_ticket_used\`, iptal edilmiş 409 \`event_ticket_already_cancelled\`. İsteğe bağlı not (≤ 200) denetime yazılmaz. Başka kurumun bileti 404. \`Idempotency-Key\` zorunlu; \`If-Match\` verilirse biletin sürümüdür. ${READERS}`,
        headers: commandHeadersSchema('required'),
        params: eventTicketParams,
        body: cancelEventTicketSchema,
        response: { 200: eventTicketResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'required')
      const result = await changeEventTicketCommand(
        contextOf(request),
        'cancel',
        request.params.ticketId,
        request.commandInput,
        opts.expectedVersion,
        opts.idempotency,
      )
      return eventTicketResponse.parse(sendBody(reply, result))
    },
  )
}
