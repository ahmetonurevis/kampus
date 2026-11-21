import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  eventTicketCheckInReversals,
  eventTickets,
  ticketedEvents,
} from '../src/db/schema/finance-event-tickets.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
  type InstitutionOverrides,
} from './support/app.ts'

/**
 * Etkinlik bileti ve oturma uçları (DOM-FIN-103; ON-159, ON-345; K-324…K-327, K-378…K-380). Her test
 * kendi kurumunu kurar: seed öğrencileri (Deniz s1 ve Ece s2 kardeş, veli p1), pasif bir öğrenci ve
 * okul takvimi etkinlikleri. FIXED_NOW 2026-10-06 12:00 İstanbul; etkinlikler çoğunlukla Aralık'tadır,
 * giriş ve iade kuralı testlerinde aynı gün (`TODAY`) ya da 3 gün sonra (`SOON`).
 */

const SEED = createSeed(FIXED_NOW)
const EVENTS = '/api/v1/finance/ticketed-events'
const TICKETS = '/api/v1/finance/event-tickets'
const CODE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

const SEATED = {
  name: 'Yıl sonu gösterisi',
  startsAt: '2026-12-20T16:00:00+03:00',
  venue: 'Konferans salonu',
  seatingMode: 'seated',
  rowCount: 3,
  seatsPerRow: 4,
  blockedSeats: ['A1'],
  ticketTypes: [
    { name: 'Davetiye', kind: 'invitation', priceCents: 0 },
    { name: 'Veli bileti', kind: 'paid', priceCents: 15000 },
  ],
  perStudentLimit: 3,
}
/** FIXED_NOW ile aynı İstanbul günü, akşam. */
const TODAY = '2026-10-06T18:00:00+03:00'
/** FIXED_NOW'dan 3 gün sonra: iptalde yarı iade (K-380). */
const SOON = '2026-10-09T18:00:00+03:00'
const GENERAL = {
  name: 'Mezuniyet töreni',
  startsAt: '2026-12-21T10:00:00Z',
  venue: 'Bahçe',
  seatingMode: 'general',
  capacity: 2,
  ticketTypes: [{ name: 'Davetiye', kind: 'invitation', priceCents: 0 }],
}

describe('DOM-FIN-103: etkinlik bileti uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.159.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    cookie: string | null,
    payload?: unknown,
    headers: Record<string, string> = {},
    target: App = app,
  ) {
    return target.inject({
      method,
      url,
      remoteAddress: clientIp,
      headers: {
        origin: TEST_ORIGIN,
        ...(cookie === null ? {} : { cookie }),
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
  }
  const get = (url: string, cookie: string | null, headers: Record<string, string> = {}) =>
    call('GET', url, cookie, undefined, headers)
  const ifMatch = (version: unknown) => ({ 'if-match': `"${String(version)}"` })
  const key = () => ({ 'idempotency-key': randomUUID() })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  type Tenant = { id: string; admin: string }

  async function institution(overrides: Partial<InstitutionOverrides> = {}): Promise<Tenant> {
    clientIp = `10.159.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    const admin = await signInAs(app, created.admin)
    const [first] = SEED.students
    await insertMissingRecords(
      db,
      created.id,
      [
        ...SEED.students.map((data) => ({ collection: 'students' as const, id: data.id, data })),
        ...(first
          ? [
              {
                collection: 'students' as const,
                id: 'evt-passive',
                data: { ...first, id: 'evt-passive', name: 'Pasif Öğrenci', isActive: false },
              },
            ]
          : []),
        ...SEED.schoolEvents.map((data) => ({
          collection: 'schoolEvents' as const,
          id: data.id,
          data,
        })),
      ],
      FIXED_NOW,
    )
    return { id: created.id, admin }
  }
  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))
  const createEvent = (cookie: string, body: unknown = SEATED) => call('POST', EVENTS, cookie, body)
  const typeKey = (event: Json, kind: string) =>
    String((event.ticketTypes as Json[]).find((type) => type.kind === kind)?.key)
  const allocate = (
    cookie: string,
    event: Json,
    items: unknown[],
    studentId = 's1',
    headers: Record<string, string> = key(),
  ) => call('POST', `${EVENTS}/${String(event.id)}/tickets`, cookie, { studentId, items }, headers)
  const seat = (event: Json, kind: string, place: string | null, holderName = 'Ayşe Yılmaz') => ({
    ticketTypeKey: typeKey(event, kind),
    seat: place,
    holderName,
  })
  const pay = (cookie: string, ticket: Json, method = 'cash') =>
    call('POST', `${TICKETS}/${String(ticket.id)}/pay`, cookie, { method }, key())
  const cancel = (
    cookie: string,
    ticket: Json,
    target: App = app,
    body: Json = { reason: 'Gelemeyecek' },
  ) => call('POST', `${TICKETS}/${String(ticket.id)}/cancel`, cookie, body, key(), target)
  const refund = (
    cookie: string,
    ticket: Json,
    method = 'cash',
    headers: Record<string, string> = key(),
    target: App = app,
  ) => call('POST', `${TICKETS}/${String(ticket.id)}/refund`, cookie, { method }, headers, target)
  const undo = (
    cookie: string,
    ticket: Json,
    reason = 'Yanlış bilet okutuldu',
    headers: Record<string, string> = key(),
    target: App = app,
  ) =>
    call(
      'POST',
      `${TICKETS}/${String(ticket.id)}/undo-check-in`,
      cookie,
      { reason },
      headers,
      target,
    )
  const checkIn = (cookie: string, event: Json, code: unknown) =>
    call('POST', `${EVENTS}/${String(event.id)}/check-in`, cookie, { code })
  const rows = (institutionId: string) =>
    Promise.all([
      db.select().from(ticketedEvents).where(eq(ticketedEvents.institutionId, institutionId)),
      db.select().from(eventTickets).where(eq(eventTickets.institutionId, institutionId)),
    ])

  test('DOM-FIN-103, K-324: kimliksiz 401; öğretmen ve veli 403; ön büro etkinlik açamaz; modül kapalı 403', async () => {
    const t = await institution()
    assertError(await get(EVENTS, null), 401)
    assertError(await createEvent(''), 401)
    for (const role of ['ogretmen', 'veli'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(EVENTS, cookie), 403)
      assertError(await createEvent(cookie), 403)
    }
    const desk = await member(t.id, 'onburo')
    assertError(await createEvent(desk), 403)
    ok(await get(EVENTS, desk))
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(EVENTS, closed.admin), 403, 'module_disabled')
    assert.deepEqual((await rows(t.id))[0], [])
  })

  test('DOM-FIN-103, K-325: yönetici numaralı etkinlik açar; geçersiz gövde 400, geçmiş başlangıç 422 ve kayıt yazılmaz', async () => {
    const t = await institution()
    assertError(await createEvent(t.admin, { ...SEATED, rowCount: null }), 400, 'validation_failed')
    assertError(
      await createEvent(t.admin, { ...SEATED, startsAt: '2026-10-01T10:00:00Z' }),
      422,
      'event_starts_in_past',
    )
    assertError(
      await createEvent(t.admin, { ...SEATED, schoolEventId: 'yok' }),
      422,
      'event_school_event_not_found',
    )
    assert.deepEqual((await rows(t.id))[0], [])
    const event = ok(await createEvent(t.admin, { ...SEATED, schoolEventId: 'event-science' }), 201)
    assert.equal(event.startsAt, '2026-12-20T13:00:00.000Z')
    assert.equal(event.schoolEventTitle, 'Bilim müzesi gezisi')
    assert.equal(event.totalCapacity, 11)
    assert.equal(event.availableCount, 11)
    assert.equal(event.salesOpen, true)
    assert.deepEqual(event.takenSeats, [])
    const [stored] = (await rows(t.id))[0]
    assert.equal(stored?.seatingMode, 'seated')
    const audit = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.entityId, String(event.id))))
    assert.deepEqual(
      audit.map((row) => row.action),
      ['ticketed_event.create'],
    )
  })

  test('DOM-FIN-103, K-325, K-326: bilet ayırma koltuk alır, kod üretir; Idempotency-Key zorunlu ve tekrar aynı yanıtı verir', async () => {
    const t = await institution()
    const event = ok(await createEvent(t.admin), 201)
    const items = [seat(event, 'invitation', 'a2'), seat(event, 'paid', 'B3', 'Misafir Can')]
    assertError(await allocate(t.admin, event, items, 's1', {}), 400, 'idempotency_key_required')
    const headers = key()
    const first = await allocate(t.admin, event, items, 's1', headers)
    const tickets = ok(first, 201) as unknown as Json[]
    assert.deepEqual(
      tickets.map((ticket) => [ticket.seat, ticket.state, ticket.priceCents, ticket.studentName]),
      [
        ['A2', 'valid', 0, 'Deniz Yılmaz'],
        ['B3', 'unpaid', 15000, 'Deniz Yılmaz'],
      ],
    )
    assert.ok(tickets.every((ticket) => CODE.test(String(ticket.code))))
    assert.notEqual(tickets[0]?.code, tickets[1]?.code)
    const again = await allocate(t.admin, event, items, 's1', headers)
    assert.equal(again.statusCode, 201)
    assert.equal(again.headers['idempotent-replayed'], 'true')
    assert.deepEqual(again.json(), first.json())
    assert.equal((await rows(t.id))[1].length, 2)
    const detail = ok(await get(`${EVENTS}/${String(event.id)}`, t.admin))
    assert.deepEqual(detail.takenSeats, ['A2', 'B3'])
    assert.equal(detail.activeCount, 2)
    assert.equal(detail.unpaidCount, 1)
  })

  test('DOM-FIN-103, K-325: aynı koltuk iki kez satılmaz (eşzamanlı istekte de); kapalı koltuk, sınır ve pasif öğrenci reddedilir', async () => {
    const t = await institution()
    const event = ok(await createEvent(t.admin), 201)
    const desk = await member(t.id, 'onburo')
    const [left, right] = await Promise.all([
      allocate(t.admin, event, [seat(event, 'invitation', 'C1')], 's1'),
      allocate(desk, event, [seat(event, 'invitation', 'C1')], 's2'),
    ])
    const statuses = [left.statusCode, right.statusCode].sort()
    assert.deepEqual(statuses, [201, 409])
    assert.equal(
      [left, right].find((item) => item.statusCode === 409)?.json().code,
      'event_seat_taken',
    )
    const before = await rows(t.id)
    assertError(
      await allocate(t.admin, event, [seat(event, 'invitation', 'C1')], 's3'),
      409,
      'event_seat_taken',
    )
    assertError(
      await allocate(t.admin, event, [seat(event, 'invitation', 'A1')]),
      422,
      'event_seat_blocked',
    )
    assertError(
      await allocate(t.admin, event, [seat(event, 'invitation', 'D1')]),
      422,
      'event_seat_unknown',
    )
    assertError(
      await allocate(t.admin, event, [seat(event, 'invitation', 'B1')], 'evt-passive'),
      422,
      'event_ticket_student_inactive',
    )
    assertError(
      await allocate(t.admin, event, [seat(event, 'invitation', 'B1')], 'yok'),
      422,
      'event_ticket_student_not_found',
    )
    const owner = [left, right].find((item) => item.statusCode === 201)
    const studentId = owner === left ? 's1' : 's2'
    assertError(
      await allocate(
        t.admin,
        event,
        [
          seat(event, 'invitation', 'B1'),
          seat(event, 'invitation', 'B2'),
          seat(event, 'invitation', 'B4'),
        ],
        studentId,
      ),
      422,
      'event_ticket_limit_exceeded',
    )
    assert.deepEqual(await rows(t.id), before)
    // Kısmi tekil indeks: core denetimi atlansa da aynı koltuğa ikinci etkin bilet yazılamaz.
    const [stored] = before[1]
    assert.ok(stored)
    await assert.rejects(
      db.insert(eventTickets).values({ ...stored, id: randomUUID(), code: 'ZZZZ-ZZZZ-ZZZZ' }),
    )
  })

  test('DOM-FIN-103, K-325: numarasız etkinlikte kontenjan dolar; satış kapalıyken ayırma 422', async () => {
    const t = await institution()
    const event = ok(await createEvent(t.admin, GENERAL), 201)
    assertError(
      await allocate(t.admin, event, [seat(event, 'invitation', 'A1')]),
      422,
      'event_seat_not_allowed',
    )
    ok(
      await allocate(t.admin, event, [
        seat(event, 'invitation', null),
        seat(event, 'invitation', null, 'Ali Veli'),
      ]),
      201,
    )
    assertError(
      await allocate(t.admin, event, [seat(event, 'invitation', null)], 's2'),
      422,
      'event_sold_out',
    )
    const current = ok(await get(`${EVENTS}/${String(event.id)}`, t.admin))
    const closed = ok(
      await call(
        'PATCH',
        `${EVENTS}/${String(event.id)}`,
        t.admin,
        { salesOpen: false, capacity: 5 },
        ifMatch(current.version),
      ),
    )
    assert.equal(closed.salesOpen, false)
    assertError(
      await allocate(t.admin, event, [seat(event, 'invitation', null)], 's2'),
      422,
      'event_sales_closed',
    )
  })

  test('DOM-FIN-103, K-326: ödeme elle işaretlenir; giriş kodla bir kez, ödenmemiş ve başka etkinliğin bileti girmez', async () => {
    const t = await institution()
    const event = ok(await createEvent(t.admin), 201)
    const other = ok(await createEvent(t.admin, GENERAL), 201)
    const desk = await member(t.id, 'onburo')
    const [invitation, paid] = ok(
      await allocate(desk, event, [seat(event, 'invitation', 'A2'), seat(event, 'paid', 'A3')]),
      201,
    ) as unknown as Json[]
    assert.ok(invitation && paid)
    assertError(await pay(desk, invitation), 422, 'event_ticket_free')
    assertError(await checkIn(desk, event, paid.code), 422, 'event_ticket_unpaid')
    assertError(
      await call('POST', `${TICKETS}/${String(paid.id)}/pay`, desk, { method: 'cash' }),
      400,
      'idempotency_key_required',
    )
    const paidNow = ok(await pay(desk, paid, 'transfer'))
    assert.equal(paidNow.paymentStatus, 'paid')
    assert.equal(paidNow.paymentMethod, 'transfer')
    assert.equal(paidNow.paidAt, FIXED_NOW.toISOString())
    assertError(await pay(desk, paid), 409, 'event_ticket_already_paid')
    assertError(await checkIn(desk, other, paid.code), 422, 'event_ticket_wrong_event')
    assertError(await checkIn(desk, event, 'ZZZZ-ZZZZ-ZZZZ'), 404)
    assertError(await checkIn(desk, event, 'kısa'), 404)
    const used = ok(
      await checkIn(desk, event, String(paid.code).toLowerCase().replaceAll('-', ' ')),
    )
    assert.equal(used.state, 'used')
    assert.equal(used.usedAt, FIXED_NOW.toISOString())
    assertError(await checkIn(desk, event, paid.code), 409, 'event_ticket_already_used')
    assertError(await cancel(desk, paid), 422, 'event_ticket_used')
    const summary = ok(await get(`${EVENTS}/${String(event.id)}`, desk))
    assert.equal(summary.collectedCents, 15000)
    assert.equal(summary.usedCount, 1)
    const actions = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.entityId, String(paid.id))))
    assert.deepEqual(actions.map((row) => row.action).sort(), [
      'event_ticket.allocate',
      'event_ticket.check_in',
      'event_ticket.pay',
    ])
  })

  test('DOM-FIN-103, K-326, K-380: iptal koltuğu boşa çıkarır, ödenmişte iade tutarı yazar; eski oturumla iptal 403 reauthentication_required', async () => {
    const t = await institution()
    const event = ok(await createEvent(t.admin), 201)
    const [ticket] = ok(
      await allocate(t.admin, event, [seat(event, 'paid', 'B2')]),
      201,
    ) as unknown as Json[]
    assert.ok(ticket)
    ok(await pay(t.admin, ticket))
    const later = await buildTestApp(db, { clock: () => new Date(Date.now() + 16 * 60 * 1000) })
    try {
      assertError(await cancel(t.admin, ticket, later), 403, 'reauthentication_required')
    } finally {
      await later.close()
    }
    const cancelled = ok(await cancel(t.admin, ticket))
    assert.equal(cancelled.state, 'cancelled')
    // Etkinliğe 7+ gün var: tam iade yazılır, ödendiği ayrıca işaretlenir (K-380).
    assert.equal(cancelled.refundCents, 15000)
    assert.equal(cancelled.refundStatus, 'pending')
    assert.equal(cancelled.refundedAt, null)
    assert.equal(cancelled.cancelReason, 'Gelemeyecek')
    assertError(await cancel(t.admin, ticket), 409, 'event_ticket_already_cancelled')
    assertError(await checkIn(t.admin, event, ticket.code), 422, 'event_ticket_cancelled')
    const detail = ok(await get(`${EVENTS}/${String(event.id)}`, t.admin))
    assert.deepEqual(detail.takenSeats, [])
    assert.equal(detail.collectedCents, 0)
    ok(await allocate(t.admin, event, [seat(event, 'invitation', 'B2')], 's2'), 201)
  })

  test('DOM-FIN-103, K-378: girişi okutan ön büro ya da yönetici gerekçeyle geri alır; eski kullanım izi kalır, başka görevli 403', async () => {
    const t = await institution()
    const event = ok(await createEvent(t.admin, { ...GENERAL, startsAt: TODAY, capacity: 5 }), 201)
    const deskA = await member(t.id, 'onburo')
    const deskB = await member(t.id, 'onburo')
    const [ticket] = ok(
      await allocate(deskA, event, [seat(event, 'invitation', null)]),
      201,
    ) as unknown as Json[]
    assert.ok(ticket)
    assertError(await undo(deskA, ticket), 409, 'event_ticket_not_used')
    const used = ok(await checkIn(deskA, event, ticket.code))
    assert.equal(used.canUndoCheckIn, true)
    const listFor = async (cookie: string, target: App = app) =>
      (
        (
          await call('GET', `${EVENTS}/${String(event.id)}/tickets`, cookie, undefined, {}, target)
        ).json().data as Json[]
      )[0]
    assert.equal((await listFor(deskB))?.canUndoCheckIn, false)
    assert.equal((await listFor(t.admin))?.canUndoCheckIn, true)
    assertError(await undo(deskB, ticket), 403, 'event_ticket_check_in_not_owner')
    assertError(
      await call('POST', `${TICKETS}/${String(ticket.id)}/undo-check-in`, deskA, {
        reason: 'Yanlış bilet',
      }),
      400,
      'idempotency_key_required',
    )
    assertError(await undo(deskA, ticket, 'kısa'), 400, 'validation_failed')
    const headers = key()
    const first = await undo(deskA, ticket, 'Yanlış bilet okutuldu', headers)
    const undone = ok(first)
    assert.equal(undone.state, 'valid')
    assert.equal(undone.usedAt, null)
    assert.equal(undone.checkInUndoCount, 1)
    assert.equal(undone.canUndoCheckIn, false)
    const replay = await undo(deskA, ticket, 'Yanlış bilet okutuldu', headers)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.deepEqual(replay.json(), first.json())
    // Yeniden okutulur; yönetici başkasının okuttuğu girişi de geri alır.
    ok(await checkIn(deskA, event, ticket.code))
    ok(await undo(t.admin, ticket, 'Kapıda iki kez okundu'))
    const again = ok(await checkIn(t.admin, event, ticket.code))
    assert.equal(again.state, 'used')
    assert.equal(again.checkInUndoCount, 2)
    const reversals = await db
      .select()
      .from(eventTicketCheckInReversals)
      .where(eq(eventTicketCheckInReversals.institutionId, t.id))
    assert.deepEqual(reversals.map((row) => row.reason).sort(), [
      'Kapıda iki kez okundu',
      'Yanlış bilet okutuldu',
    ])
    assert.ok(reversals.every((row) => row.usedAt.toISOString() === FIXED_NOW.toISOString()))
    // Geri alma izinde okutan ile geri alan ayrı tutulur: ilkini ön büro okuttu ve geri aldı,
    // ikincisini ön büro okuttu, yönetici geri aldı.
    const [byAdmin, byDesk] = [...reversals].sort((a, b) => a.reason.localeCompare(b.reason, 'tr'))
    assert.ok(byAdmin && byDesk)
    assert.equal(byAdmin.usedByUserId, byDesk.usedByUserId)
    assert.equal(byDesk.createdByUserId, byDesk.usedByUserId)
    assert.notEqual(byAdmin.createdByUserId, byAdmin.usedByUserId)
    const audits = await db
      .select({ action: auditLog.action, changes: auditLog.changes })
      .from(auditLog)
      .where(
        and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'event_ticket.undo_check_in')),
      )
    assert.equal(audits.length, 2)
    assert.ok(!JSON.stringify(audits).includes('Yanlış bilet'), 'gerekçe denetime yazılmaz')
    // Etkinlik günü (İstanbul) bitince geri alınmaz: 7 Ekim 00:10 İstanbul.
    const nextDay = await buildTestApp(db, { clock: () => new Date('2026-10-06T21:10:00.000Z') })
    try {
      assert.equal((await listFor(t.admin, nextDay))?.canUndoCheckIn, false)
      assertError(
        await undo(t.admin, ticket, 'Geç fark edildi', key(), nextDay),
        422,
        'event_ticket_check_in_undo_expired',
      )
    } finally {
      await nextDay.close()
    }
    assert.equal(
      (
        await db
          .select()
          .from(eventTicketCheckInReversals)
          .where(eq(eventTicketCheckInReversals.institutionId, t.id))
      ).length,
      2,
    )
  })

  test('DOM-FIN-103, K-379: aile sınırında kardeşlerin biletleri birlikte sayılır, eşzamanlı ayırmada da; kapsam öğrenciye dönünce ayrı', async () => {
    const t = await institution()
    const familyEvent = { ...GENERAL, capacity: 20, perStudentLimit: 2, limitScope: 'family' }
    const event = ok(await createEvent(t.admin, familyEvent), 201)
    assert.equal(event.limitScope, 'family')
    const invite = (holder = 'Ayşe Yılmaz') => seat(event, 'invitation', null, holder)
    ok(await allocate(t.admin, event, [invite()], 's1'), 201)
    ok(await allocate(t.admin, event, [invite()], 's2'), 201)
    const exceeded = await allocate(t.admin, event, [invite()], 's1')
    assertError(exceeded, 422, 'event_ticket_limit_exceeded')
    assert.match(exceeded.json().message, /Aile başına en çok 2/)
    // Başka ailenin öğrencisi (s3) etkilenmez.
    ok(await allocate(t.admin, event, [invite(), invite('Can Demir')], 's3'), 201)
    // İki kardeşe eşzamanlı ayırma kurum kilidiyle sıraya girer; ikincisi birinciyi sayar.
    const racing = ok(await createEvent(t.admin, { ...familyEvent, name: 'Bahar şenliği' }), 201)
    const desk = await member(t.id, 'onburo')
    const both = [seat(racing, 'invitation', null), seat(racing, 'invitation', null, 'Can')]
    const results = await Promise.all([
      allocate(t.admin, racing, both, 's1'),
      allocate(desk, racing, both, 's2'),
    ])
    assert.deepEqual(results.map((item) => item.statusCode).sort(), [201, 422])
    const tickets = (await rows(t.id))[1].filter((row) => row.eventId === racing.id)
    assert.equal(tickets.length, 2)
    // Kapsam öğrenciye dönünce kardeş ayrı sayılır.
    const current = ok(await get(`${EVENTS}/${String(event.id)}`, t.admin))
    const switched = ok(
      await call(
        'PATCH',
        `${EVENTS}/${String(event.id)}`,
        t.admin,
        { limitScope: 'student' },
        ifMatch(current.version),
      ),
    )
    assert.equal(switched.limitScope, 'student')
    ok(await allocate(t.admin, event, [invite()], 's1'), 201)
    assertError(
      await call('POST', EVENTS, t.admin, { ...familyEvent, limitScope: 'sinif' }),
      400,
      'validation_failed',
    )
  })

  test('DOM-FIN-103, K-380: 3 gün kala iptalde yarı iade; kuraldan farklı tutarı yalnız yönetici notla yazar; iade ödendi bir kez ve taze oturumla', async () => {
    const t = await institution()
    const event = ok(await createEvent(t.admin, { ...SEATED, startsAt: SOON }), 201)
    const desk = await member(t.id, 'onburo')
    const [first, second, unpaid] = ok(
      await allocate(desk, event, [
        seat(event, 'paid', 'A2'),
        seat(event, 'paid', 'A3', 'Misafir Can'),
        seat(event, 'paid', 'A4', 'Misafir Ali'),
      ]),
      201,
    ) as unknown as Json[]
    assert.ok(first && second && unpaid)
    ok(await pay(desk, first))
    ok(await pay(desk, second))
    assertError(await refund(desk, first), 422, 'event_ticket_not_cancelled')
    const half = ok(await cancel(desk, first))
    assert.equal(half.refundCents, 7500)
    assert.equal(half.refundStatus, 'pending')
    const summary = ok(await get(`${EVENTS}/${String(event.id)}`, desk))
    assert.equal(summary.collectedCents, 15000 + 7500)
    assert.equal(summary.pendingRefundCount, 1)
    assert.equal(summary.pendingRefundCents, 7500)
    const before = await rows(t.id)
    assertError(
      await cancel(desk, second, app, { reason: 'Kurum erteledi', refundCents: 15000 }),
      403,
      'event_ticket_refund_override_forbidden',
    )
    assertError(
      await cancel(t.admin, second, app, { reason: null, refundCents: 15000 }),
      422,
      'event_ticket_refund_reason_required',
    )
    assertError(
      await cancel(t.admin, second, app, { reason: 'Fazla', refundCents: 15001 }),
      422,
      'event_ticket_refund_exceeds_price',
    )
    assertError(
      await cancel(t.admin, unpaid, app, { reason: null, refundCents: 0 }),
      422,
      'event_ticket_refund_not_applicable',
    )
    assert.deepEqual(await rows(t.id), before)
    const full = ok(
      await cancel(t.admin, second, app, { reason: 'Kurum erteledi', refundCents: 15000 }),
    )
    assert.equal(full.refundCents, 15000)
    const later = await buildTestApp(db, { clock: () => new Date(Date.now() + 16 * 60 * 1000) })
    try {
      assertError(await refund(desk, first, 'cash', key(), later), 403, 'reauthentication_required')
    } finally {
      await later.close()
    }
    assertError(
      await call('POST', `${TICKETS}/${String(first.id)}/refund`, desk, { method: 'cash' }),
      400,
      'idempotency_key_required',
    )
    const paidOut = ok(await refund(desk, first, 'transfer'))
    assert.equal(paidOut.refundStatus, 'paid')
    assert.equal(paidOut.refundMethod, 'transfer')
    assert.equal(paidOut.refundedAt, FIXED_NOW.toISOString())
    assertError(await refund(desk, first), 409, 'event_ticket_already_refunded')
    const noRefund = ok(await cancel(desk, unpaid))
    assert.equal(noRefund.refundCents, null)
    assert.equal(noRefund.refundStatus, 'none')
    assertError(await refund(desk, unpaid), 422, 'event_ticket_no_refund')
    const after = ok(await get(`${EVENTS}/${String(event.id)}`, desk))
    assert.equal(after.collectedCents, 7500)
    assert.equal(after.pendingRefundCount, 1)
    const actions = await db
      .select({ action: auditLog.action, changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.entityId, String(first.id))))
    assert.deepEqual(actions.map((row) => row.action).sort(), [
      'event_ticket.allocate',
      'event_ticket.cancel',
      'event_ticket.pay',
      'event_ticket.refund',
    ])
    assert.ok(!JSON.stringify(actions).includes('7500'), 'tutar denetime yazılmaz')
    // Etkinlik günü iptalde iade yok: tutar 0, ödenecek iade yok.
    const tonight = ok(
      await createEvent(t.admin, { ...SEATED, name: 'Akşam provası', startsAt: TODAY }),
      201,
    )
    const [late] = ok(
      await allocate(t.admin, tonight, [seat(tonight, 'paid', 'B2')]),
      201,
    ) as unknown as Json[]
    assert.ok(late)
    ok(await pay(t.admin, late))
    const kept = ok(await cancel(t.admin, late))
    assert.equal(kept.refundCents, 0)
    assert.equal(kept.refundStatus, 'none')
    assertError(await refund(t.admin, late), 422, 'event_ticket_no_refund')
    const csv = await get(`${EVENTS}/${String(event.id)}/tickets`, t.admin, { accept: 'text/csv' })
    assert.equal(csv.statusCode, 200, csv.body)
    assert.ok(csv.body.includes('"İade ödendi"'))
    assert.ok(csv.body.includes('"İade bekliyor"'))
  })

  test('DOM-FIN-103, K-325: düzeltme If-Match ister; biletli koltuk kapanmaz, biletli etkinlik silinmez', async () => {
    const t = await institution()
    const event = ok(await createEvent(t.admin), 201)
    const url = `${EVENTS}/${String(event.id)}`
    assertError(await call('PATCH', url, t.admin, { name: 'Yeni ad' }), 400, 'if_match_required')
    assertError(
      await call('PATCH', url, t.admin, { name: 'Yeni ad' }, ifMatch(9)),
      409,
      'version_conflict',
    )
    const [ticket] = ok(
      await allocate(t.admin, event, [seat(event, 'invitation', 'C2')]),
      201,
    ) as unknown as Json[]
    assert.ok(ticket)
    assertError(
      await call('PATCH', url, t.admin, { blockedSeats: ['A1', 'C2'] }, ifMatch(event.version)),
      422,
      'event_seat_in_use',
    )
    assertError(
      await call('PATCH', url, t.admin, { name: SEATED.name }, ifMatch(event.version)),
      422,
      'event_unchanged',
    )
    const renamed = ok(
      await call(
        'PATCH',
        url,
        t.admin,
        {
          name: 'Kış gösterisi',
          ticketTypes: (event.ticketTypes as Json[]).map((type) => ({
            ...type,
            priceCents: type.kind === 'paid' ? 20000 : 0,
          })),
        },
        ifMatch(event.version),
      ),
    )
    assert.equal(renamed.name, 'Kış gösterisi')
    assert.equal(renamed.version, 2)
    assertError(
      await call('DELETE', url, t.admin, undefined, ifMatch(renamed.version)),
      422,
      'event_has_tickets',
    )
    ok(await cancel(t.admin, ticket))
    const archived = ok(await call('DELETE', url, t.admin, undefined, ifMatch(renamed.version)))
    assert.equal(archived.id, event.id)
    assertError(await get(url, t.admin), 404)
    const desk = await member(t.id, 'onburo')
    assertError(await call('PATCH', url, desk, { name: 'X ad' }, ifMatch(3)), 403)
  })

  test('DOM-FIN-103, K-327: liste ve satış listesi süzülür; CSV taze oturum ister, kod taşımaz ve denetime düşer', async () => {
    const t = await institution()
    const event = ok(await createEvent(t.admin), 201)
    ok(await createEvent(t.admin, { ...GENERAL, name: 'Bahar şenliği' }), 201)
    const list = await get(`${EVENTS}?q=bahar`, t.admin)
    assert.deepEqual(
      (list.json().data as Json[]).map((item) => item.name),
      ['Bahar şenliği'],
    )
    assert.equal(list.json().meta.total, 1)
    assert.equal((await get(`${EVENTS}?when=past`, t.admin)).json().meta.total, 0)
    assertError(await get(`${EVENTS}?bilinmeyen=1`, t.admin), 400)
    const tickets = ok(
      await allocate(t.admin, event, [
        seat(event, 'invitation', 'A2'),
        seat(event, 'paid', 'A3', '=Misafir'),
      ]),
      201,
    ) as unknown as Json[]
    const ticketUrl = `${EVENTS}/${String(event.id)}/tickets`
    const unpaid = await get(`${ticketUrl}?state=unpaid`, t.admin)
    assert.deepEqual(
      (unpaid.json().data as Json[]).map((item) => item.seat),
      ['A3'],
    )
    assert.equal((await get(`${ticketUrl}?q=misaf`, t.admin)).json().meta.total, 1)
    const later = await buildTestApp(db, { clock: () => new Date(Date.now() + 16 * 60 * 1000) })
    try {
      const stale = await call('GET', ticketUrl, t.admin, undefined, { accept: 'text/csv' }, later)
      assertError(stale, 403, 'reauthentication_required')
    } finally {
      await later.close()
    }
    const csv = await get(ticketUrl, t.admin, { accept: 'text/csv' })
    assert.equal(csv.statusCode, 200, csv.body)
    assert.match(String(csv.headers['content-type']), /text\/csv/)
    assert.ok(csv.body.startsWith('\uFEFF"Bilet türü"'))
    assert.ok(csv.body.includes(`"'=Misafir"`))
    for (const ticket of tickets) assert.ok(!csv.body.includes(String(ticket.code)))
    const exports = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(
        and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'finance.event_ticket_export')),
      )
    assert.equal(exports.length, 1)
  })

  test('DOM-FIN-103: başka kurumun etkinliği, bileti ve kodu 404 (iade ve girişi geri alma dahil, K-378, K-380); listede B yok; gövdedeki institutionId etkisiz ve B değişmez', async () => {
    const a = await institution()
    const b = await institution()
    const bEvent = ok(await createEvent(b.admin), 201)
    const [bTicket] = ok(
      await allocate(b.admin, bEvent, [seat(bEvent, 'paid', 'A2')]),
      201,
    ) as unknown as Json[]
    assert.ok(bTicket)
    const aEvent = ok(await createEvent(a.admin), 201)
    const bBefore = await rows(b.id)
    const bUrl = `${EVENTS}/${String(bEvent.id)}`
    assertError(await get(bUrl, a.admin), 404)
    assertError(
      await call('PATCH', bUrl, a.admin, { name: 'Ele geçir' }, ifMatch(bEvent.version)),
      404,
    )
    assertError(await call('DELETE', bUrl, a.admin, undefined, ifMatch(bEvent.version)), 404)
    assertError(await get(`${bUrl}/tickets`, a.admin), 404)
    assertError(await allocate(a.admin, bEvent, [seat(bEvent, 'invitation', 'B1')]), 404)
    assertError(await checkIn(a.admin, bEvent, bTicket.code), 404)
    assertError(await pay(a.admin, bTicket), 404)
    assertError(await cancel(a.admin, bTicket), 404)
    assertError(await refund(a.admin, bTicket), 404)
    assertError(await undo(a.admin, bTicket), 404)
    // A'nın kendi etkinliğinde B'nin kodu "bulunamadı"dır; B'nin öğrencisi A'da yoktur.
    assertError(await checkIn(a.admin, aEvent, bTicket.code), 404)
    assertError(
      await createEvent(a.admin, { ...SEATED, institutionId: b.id }),
      400,
      'validation_failed',
    )
    const aList = await get(EVENTS, a.admin)
    assert.deepEqual(
      (aList.json().data as Json[]).map((item) => item.id),
      [aEvent.id],
    )
    assert.deepEqual(await rows(b.id), bBefore)
  })
})
