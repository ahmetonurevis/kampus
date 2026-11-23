import assert from 'node:assert/strict'
import test from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  assertEventArchivable,
  canManageEvents,
  canOverrideEventRefund,
  canSellEventTickets,
  compareSeats,
  eventCapacity,
  eventDayOf,
  eventRefundQuote,
  eventTicketCheckInUndoBlocker,
  eventTicketRefundStatus,
  eventTicketState,
  eventTicketsCsv,
  eventTicketSummary,
  layoutSeats,
  normalizeTicketCode,
  parseSeat,
  planEvent,
  planEventTicketAllocation,
  planEventTicketCancel,
  planEventTicketCheckIn,
  planEventTicketCheckInUndo,
  planEventTicketPayment,
  planEventTicketRefund,
  planEventUpdate,
  seatLabel,
  ticketCodeFromBytes,
  type ActiveEventTicket,
  type EventDraft,
  type EventTicketFacts,
} from '../packages/school-core/src/lib/finance-event-tickets.ts'

/** Etkinlik bileti ve oturma kuralları (DOM-FIN-103; ON-159, ON-345; K-324…K-327, K-378…K-380). */

const NOW = new Date('2026-11-16T09:00:00.000Z')
let keyCount = 0
const newKey = () => `tt-${String((keyCount += 1))}`
const tools = { now: NOW, newKey }

const SEATED = {
  name: 'Yıl sonu gösterisi',
  startsAt: '2026-12-20T16:00:00+03:00',
  venue: 'Konferans salonu',
  seatingMode: 'seated',
  rowCount: 3,
  seatsPerRow: 4,
  blockedSeats: ['a1', 'C4'],
  ticketTypes: [
    { name: 'Davetiye', kind: 'invitation', priceCents: 0 },
    { name: 'Veli bileti', kind: 'paid', priceCents: 15000 },
  ],
  perStudentLimit: 2,
}
const GENERAL = {
  name: 'Mezuniyet töreni',
  startsAt: '2026-12-21T10:00:00Z',
  venue: 'Bahçe',
  seatingMode: 'general',
  capacity: 3,
  ticketTypes: [{ name: 'Davetiye', kind: 'invitation', priceCents: 0 }],
}

function rejects(run: () => unknown, code: string, kind = 'rule') {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof DomainError, String(error))
    assert.equal(error.code, code)
    assert.equal(error.kind, kind)
    return true
  })
}
const ZodError = (error: unknown) => error instanceof Error && error.name === 'ZodError'
const invalid = (run: () => unknown) => assert.throws(run, ZodError)

const seated = (): EventDraft => planEvent(SEATED, tools)
const general = (): EventDraft => planEvent(GENERAL, tools)
const keyOf = (event: EventDraft, kind: 'invitation' | 'paid') =>
  event.ticketTypes.find((type) => type.kind === kind)?.key ?? ''

test('DOM-FIN-103, K-324: etkinliği yönetici açar; bilet işlemleri yönetici ve ön büroda', () => {
  assert.equal(canManageEvents('yonetici'), true)
  assert.equal(canManageEvents('onburo'), false)
  assert.equal(canSellEventTickets('onburo'), true)
  for (const role of ['ogretmen', 'veli', 'ogrenci']) assert.equal(canSellEventTickets(role), false)
})

test('DOM-FIN-103, K-325: koltuk etiketi sıra harfi ve numaradır; salon koltukları sırayla', () => {
  assert.equal(seatLabel(0, 1), 'A1')
  assert.equal(seatLabel(25, 60), 'Z60')
  assert.deepEqual(parseSeat('C12'), { row: 2, seat: 12 })
  assert.equal(parseSeat('A0'), null)
  assert.equal(parseSeat('AA1'), null)
  assert.deepEqual(layoutSeats(2, 2), ['A1', 'A2', 'B1', 'B2'])
  assert.deepEqual(['B1', 'A10', 'A2'].sort(compareSeats), ['A2', 'A10', 'B1'])
})

test('DOM-FIN-103, K-325: numaralı etkinlik açılır; kapalı koltuk büyük harfe çevrilir, türler anahtar alır', () => {
  const event = seated()
  assert.equal(event.startsAt, '2026-12-20T13:00:00.000Z')
  assert.deepEqual(event.blockedSeats, ['A1', 'C4'])
  assert.equal(event.salesOpen, true)
  assert.equal(event.capacity, null)
  assert.equal(eventCapacity(event), 10)
  assert.equal(event.ticketTypes.length, 2)
  assert.ok(event.ticketTypes.every((type) => type.key.startsWith('tt-')))
  assert.equal(eventCapacity(general()), 3)
})

test('DOM-FIN-103, K-325: geçersiz düzen, fiyat ve geçmiş başlangıç reddedilir', () => {
  invalid(() => planEvent({ ...SEATED, rowCount: null }, tools))
  invalid(() => planEvent({ ...SEATED, rowCount: 27 }, tools))
  invalid(() => planEvent({ ...SEATED, capacity: 10 }, tools))
  invalid(() => planEvent({ ...SEATED, blockedSeats: ['D1'] }, tools))
  invalid(() => planEvent({ ...SEATED, blockedSeats: ['A2', 'a2'] }, tools))
  invalid(() => planEvent({ ...SEATED, rowCount: 1, seatsPerRow: 1, blockedSeats: ['A1'] }, tools))
  invalid(() => planEvent({ ...GENERAL, capacity: null }, tools))
  invalid(() => planEvent({ ...GENERAL, rowCount: 2 }, tools))
  invalid(() => planEvent({ ...GENERAL, blockedSeats: ['A1'] }, tools))
  invalid(() =>
    planEvent(
      { ...GENERAL, ticketTypes: [{ name: 'Davetiye', kind: 'invitation', priceCents: 5 }] },
      tools,
    ),
  )
  invalid(() =>
    planEvent({ ...GENERAL, ticketTypes: [{ name: 'Bilet', kind: 'paid', priceCents: 0 }] }, tools),
  )
  invalid(() =>
    planEvent(
      {
        ...GENERAL,
        ticketTypes: [
          { name: 'Bilet', kind: 'paid', priceCents: 100 },
          { name: 'bilet', kind: 'paid', priceCents: 200 },
        ],
      },
      tools,
    ),
  )
  invalid(() => planEvent({ ...GENERAL, ticketTypes: [] }, tools))
  invalid(() => planEvent({ ...GENERAL, startsAt: '20 Aralık' }, tools))
  rejects(
    () => planEvent({ ...GENERAL, startsAt: '2026-11-16T08:59:00Z' }, tools),
    'event_starts_in_past',
  )
})

const ticket = (
  seat: string | null,
  ticketTypeKey: string,
  studentId = 's1',
): ActiveEventTicket => ({
  seat,
  ticketTypeKey,
  studentId,
})

test('DOM-FIN-103, K-325: düzeltme alanları birleştirir; değişmeyen düzeltme 422', () => {
  const current = seated()
  const { next, changed } = planEventUpdate(
    current,
    { name: 'Kış gösterisi', salesOpen: false },
    { ...tools, active: [] },
  )
  assert.equal(next.name, 'Kış gösterisi')
  assert.equal(next.salesOpen, false)
  assert.deepEqual(changed.sort(), ['name', 'salesOpen'])
  rejects(
    () => planEventUpdate(current, { name: current.name }, { ...tools, active: [] }),
    'event_unchanged',
  )
  rejects(
    () => planEventUpdate(current, { startsAt: '2026-11-01T10:00:00Z' }, { ...tools, active: [] }),
    'event_starts_in_past',
  )
  invalid(() => planEventUpdate(current, { capacity: 50 }, { ...tools, active: [] }))
  invalid(() => planEventUpdate(current, { unknown: 1 }, { ...tools, active: [] }))
})

test('DOM-FIN-103, K-325: satılmış koltuk kapatılamaz, salondan çıkarılamaz; düzen türü kilitlenir', () => {
  const current = seated()
  const paid = keyOf(current, 'paid')
  const active = [ticket('B2', paid)]
  rejects(
    () => planEventUpdate(current, { blockedSeats: ['A1', 'B2'] }, { ...tools, active }),
    'event_seat_in_use',
  )
  rejects(
    () => planEventUpdate(current, { rowCount: 1, blockedSeats: ['A1'] }, { ...tools, active }),
    'event_seat_in_use',
  )
  rejects(
    () =>
      planEventUpdate(
        current,
        {
          seatingMode: 'general',
          rowCount: null,
          seatsPerRow: null,
          blockedSeats: [],
          capacity: 50,
        },
        { ...tools, active },
      ),
    'event_seating_locked',
  )
  // Bilet yokken düzen türü değişir.
  const { next } = planEventUpdate(
    current,
    { seatingMode: 'general', rowCount: null, seatsPerRow: null, blockedSeats: [], capacity: 50 },
    { ...tools, active: [] },
  )
  assert.equal(next.seatingMode, 'general')
  assert.equal(eventCapacity(next), 50)
})

test('DOM-FIN-103, K-325: kontenjan bilet sayısının altına inmez; bileti olan tür kalkmaz, fiyatı değişir', () => {
  const current = general()
  const key = keyOf(current, 'invitation')
  const active = [ticket(null, key), ticket(null, key, 's2')]
  rejects(
    () => planEventUpdate(current, { capacity: 1 }, { ...tools, active }),
    'event_capacity_below_sold',
  )
  rejects(
    () =>
      planEventUpdate(
        current,
        { ticketTypes: [{ name: 'Bilet', kind: 'paid', priceCents: 500 }] },
        { ...tools, active },
      ),
    'event_ticket_type_in_use',
  )
  rejects(
    () =>
      planEventUpdate(
        current,
        { ticketTypes: [{ key: 'yok', name: 'Bilet', kind: 'paid', priceCents: 500 }] },
        { ...tools, active },
      ),
    'event_ticket_type_unknown',
  )
  const { next } = planEventUpdate(
    current,
    {
      ticketTypes: [
        { key, name: 'Ücretli davetiye', kind: 'paid', priceCents: 2500 },
        { name: 'Protokol', kind: 'invitation', priceCents: 0 },
      ],
    },
    { ...tools, active },
  )
  assert.equal(next.ticketTypes[0]?.key, key)
  assert.equal(next.ticketTypes[0]?.priceCents, 2500)
  assert.ok(next.ticketTypes[1]?.key.startsWith('tt-'))
  assert.doesNotThrow(() => assertEventArchivable([]))
  rejects(() => assertEventArchivable(active), 'event_has_tickets')
})

const STUDENT = { isActive: true }

test('DOM-FIN-103, K-325: bilet ayırma koltuk, tür ve ödeme durumunu planlar', () => {
  const event = seated()
  const plan = planEventTicketAllocation(
    {
      studentId: 's1',
      items: [
        { ticketTypeKey: keyOf(event, 'invitation'), seat: 'a2', holderName: ' Ayşe Yılmaz ' },
        { ticketTypeKey: keyOf(event, 'paid'), seat: 'B3', holderName: 'Misafir Can' },
      ],
    },
    { event, active: [], student: STUDENT },
  )
  assert.equal(plan.studentId, 's1')
  assert.deepEqual(
    plan.tickets.map((item) => [item.seat, item.holderName, item.paymentStatus, item.priceCents]),
    [
      ['A2', 'Ayşe Yılmaz', 'not_required', 0],
      ['B3', 'Misafir Can', 'unpaid', 15000],
    ],
  )
  assert.equal(plan.tickets[1]?.ticketTypeName, 'Veli bileti')
})

test('DOM-FIN-103, K-325: aynı koltuk iki kez verilmez; kapalı, olmayan ve eksik koltuk reddedilir', () => {
  const event = seated()
  const key = keyOf(event, 'invitation')
  const allocate = (items: unknown[], active: ActiveEventTicket[] = []) =>
    planEventTicketAllocation({ studentId: 's9', items }, { event, active, student: STUDENT })
  const item = (seat: string | null) => ({ ticketTypeKey: key, seat, holderName: 'Veli Ad' })
  rejects(() => allocate([item('A2')], [ticket('A2', key, 's1')]), 'event_seat_taken', 'conflict')
  rejects(() => allocate([item('A2'), item('A2')]), 'event_seat_duplicate')
  rejects(() => allocate([item('A1')]), 'event_seat_blocked')
  rejects(() => allocate([item('D1')]), 'event_seat_unknown')
  rejects(() => allocate([item(null)]), 'event_seat_required')
  rejects(
    () => allocate([{ ticketTypeKey: 'yok', seat: 'A2', holderName: 'Veli Ad' }]),
    'event_ticket_type_unknown',
  )
  invalid(() => allocate([]))
  invalid(() => allocate([{ ticketTypeKey: key, seat: 'A2', holderName: 'X' }]))
  invalid(() => allocate(Array.from({ length: 11 }, (_, index) => item(`B${String(index + 1)}`))))
})

test('DOM-FIN-103, K-325: numarasızda kontenjan, öğrenci başına üst sınır ve satış kapalı', () => {
  const event = { ...general(), perStudentLimit: 2 }
  const key = keyOf(event, 'invitation')
  const item = (seat: string | null = null) => ({ ticketTypeKey: key, seat, holderName: 'Veli Ad' })
  const allocate = (
    items: unknown[],
    active: ActiveEventTicket[] = [],
    extra: Partial<EventDraft> = {},
  ) =>
    planEventTicketAllocation(
      { studentId: 's1', items },
      { event: { ...event, ...extra }, active, student: STUDENT },
    )
  rejects(() => allocate([item('A1')]), 'event_seat_not_allowed')
  rejects(
    () => allocate([item(), item()], [ticket(null, key, 's2'), ticket(null, key, 's3')]),
    'event_sold_out',
  )
  rejects(
    () => allocate([item(), item()], [ticket(null, key, 's1')]),
    'event_ticket_limit_exceeded',
  )
  // Başka öğrencinin bileti sınıra sayılmaz; iptal edilen bilet zaten etkin listede yoktur.
  assert.equal(allocate([item(), item()], [ticket(null, key, 's2')]).tickets.length, 2)
  assert.equal(allocate([item(), item(), item()], [], { perStudentLimit: null }).tickets.length, 3)
  rejects(() => allocate([item()], [], { salesOpen: false }), 'event_sales_closed')
  rejects(
    () =>
      planEventTicketAllocation(
        { studentId: 's1', items: [item()] },
        { event, active: [], student: null },
      ),
    'event_ticket_student_not_found',
  )
  rejects(
    () =>
      planEventTicketAllocation(
        { studentId: 's1', items: [item()] },
        { event, active: [], student: { isActive: false } },
      ),
    'event_ticket_student_inactive',
  )
})

test('DOM-FIN-103, K-379: aile kapsamında kardeşlerin biletleri birlikte sayılır; öğrenci kapsamında ayrı', () => {
  const event = { ...general(), capacity: 20, perStudentLimit: 3 }
  const key = keyOf(event, 'invitation')
  const item = () => ({ ticketTypeKey: key, seat: null, holderName: 'Veli Ad' })
  const siblings = [ticket(null, key, 's1'), ticket(null, key, 's2')]
  const allocate = (scope: 'student' | 'family', family?: readonly string[], count = 2) =>
    planEventTicketAllocation(
      { studentId: 's1', items: Array.from({ length: count }, item) },
      {
        event: { ...event, limitScope: scope },
        active: [...siblings, ticket(null, key, 's9')],
        student: STUDENT,
        ...(family ? { family } : {}),
      },
    )
  // Öğrenci kapsamı: s1'in 1 bileti + 2 = 3, sınırda.
  assert.equal(allocate('student', ['s1', 's2']).tickets.length, 2)
  // Aile kapsamı: s1 ve kardeşi s2'nin 2 bileti + 2 = 4 > 3; başka ailenin (s9) bileti sayılmaz.
  assert.throws(
    () => allocate('family', ['s1', 's2']),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === 'event_ticket_limit_exceeded' &&
      error.message.includes('Aile başına en çok 3') &&
      error.message.includes('2 bileti'),
  )
  assert.equal(allocate('family', ['s1', 's2'], 1).tickets.length, 1)
  // Küme verilmezse aile öğrencinin kendisidir (velisiz öğrenci).
  assert.equal(allocate('family').tickets.length, 2)
  // Sınır yoksa kapsam etkisizdir.
  assert.equal(
    planEventTicketAllocation(
      { studentId: 's1', items: [item(), item(), item(), item()] },
      {
        event: { ...event, perStudentLimit: null, limitScope: 'family' },
        active: siblings,
        student: STUDENT,
        family: ['s1', 's2'],
      },
    ).tickets.length,
    4,
  )
})

test('DOM-FIN-103, K-379: kapsam açılışta öğrenci başına başlar, düzeltmeyle aileye geçer; geçersiz kapsam 400', () => {
  const event = seated()
  assert.equal(event.limitScope, 'student')
  assert.equal(planEvent({ ...SEATED, limitScope: 'family' }, tools).limitScope, 'family')
  const { next, changed } = planEventUpdate(
    event,
    { limitScope: 'family' },
    { ...tools, active: [ticket('A2', keyOf(event, 'invitation'), 's1')] },
  )
  assert.equal(next.limitScope, 'family')
  assert.deepEqual(changed, ['limitScope'])
  invalid(() => planEvent({ ...SEATED, limitScope: 'class' }, tools))
})

const facts = (overrides: Partial<EventTicketFacts> = {}): EventTicketFacts => ({
  eventId: 'e1',
  status: 'active',
  ticketKind: 'paid',
  priceCents: 15000,
  paymentStatus: 'unpaid',
  usedAt: null,
  usedByUserId: null,
  refundCents: null,
  refundedAt: null,
  ...overrides,
})

test('DOM-FIN-103, K-326: ödeme yalnız ödenmemiş ücretli bilette; ikinci ödeme 409', () => {
  assert.deepEqual(planEventTicketPayment({ method: 'cash' }, facts()), { method: 'cash' })
  invalid(() => planEventTicketPayment({ method: 'card' }, facts()))
  rejects(
    () => planEventTicketPayment({ method: 'cash' }, facts({ paymentStatus: 'paid' })),
    'event_ticket_already_paid',
    'conflict',
  )
  rejects(
    () =>
      planEventTicketPayment(
        { method: 'transfer' },
        facts({ ticketKind: 'invitation', paymentStatus: 'not_required' }),
      ),
    'event_ticket_free',
  )
  rejects(
    () => planEventTicketPayment({ method: 'cash' }, facts({ status: 'cancelled' })),
    'event_ticket_cancelled',
  )
})

/** Etkinlik 2026-12-20 16:00 İstanbul; NOW 2026-11-16 12:00 İstanbul. */
const STARTS = '2026-12-20T13:00:00.000Z'
const at = (iso: string) => new Date(iso)
const cancelContext = (now = NOW, role = 'onburo') => ({ startsAt: STARTS, now, role })

test('DOM-FIN-103, K-380: iade kuralı İstanbul gününe göre; 7 gün ve öncesi tam, 1–6 gün %50, etkinlik günü yok', () => {
  assert.deepEqual(eventRefundQuote(15000, STARTS, NOW), {
    rule: 'full',
    refundCents: 15000,
    daysBefore: 34,
  })
  // 13 Aralık 23:30 İstanbul (20:30 UTC): 7 gün kala, tam.
  assert.equal(eventRefundQuote(15000, STARTS, at('2026-12-13T20:30:00Z')).rule, 'full')
  // 14 Aralık 00:30 İstanbul (13 Aralık 21:30 UTC): 6 gün kala, yarı.
  assert.deepEqual(eventRefundQuote(15001, STARTS, at('2026-12-13T21:30:00Z')), {
    rule: 'partial',
    refundCents: 7501,
    daysBefore: 6,
  })
  assert.equal(eventRefundQuote(15000, STARTS, at('2026-12-19T20:00:00Z')).rule, 'partial')
  // Etkinlik günü (20 Aralık 00:30 İstanbul) ve sonrası iade yok.
  assert.deepEqual(eventRefundQuote(15000, STARTS, at('2026-12-19T21:30:00Z')), {
    rule: 'none',
    refundCents: 0,
    daysBefore: 0,
  })
  assert.equal(eventRefundQuote(15000, STARTS, at('2026-12-22T09:00:00Z')).daysBefore, -2)
  assert.equal(eventDayOf('2026-12-19T21:30:00Z'), '2026-12-20')
  assert.equal(canOverrideEventRefund('yonetici'), true)
  assert.equal(canOverrideEventRefund('onburo'), false)
})

test('DOM-FIN-103, K-326, K-380: iptal ödenmişte kural tutarını yazar; kullanılmış ve iptal edilmiş bilet reddedilir', () => {
  assert.deepEqual(planEventTicketCancel({}, facts(), cancelContext()), {
    reason: null,
    refundCents: null,
  })
  const paid = facts({ paymentStatus: 'paid' })
  assert.deepEqual(planEventTicketCancel({ reason: ' Gelemeyecek ' }, paid, cancelContext()), {
    reason: 'Gelemeyecek',
    refundCents: 15000,
  })
  const late = cancelContext(at('2026-12-18T09:00:00Z'))
  assert.equal(planEventTicketCancel({}, paid, late).refundCents, 7500)
  // Kurala eşit tutar ön büroda da geçer.
  assert.equal(planEventTicketCancel({ refundCents: 7500 }, paid, late).refundCents, 7500)
  rejects(
    () => planEventTicketCancel({}, facts({ usedAt: NOW.toISOString() }), cancelContext()),
    'event_ticket_used',
  )
  rejects(
    () => planEventTicketCancel({}, facts({ status: 'cancelled' }), cancelContext()),
    'event_ticket_already_cancelled',
    'conflict',
  )
  invalid(() => planEventTicketCancel({ reason: 'x'.repeat(201) }, facts(), cancelContext()))
  invalid(() => planEventTicketCancel({ refundCents: -1 }, paid, cancelContext()))
  invalid(() => planEventTicketCancel({ refundCents: 10.5 }, paid, cancelContext()))
})

test('DOM-FIN-103, K-380: kuraldan farklı iade yalnız yönetici ve notla; bedeli aşamaz; ödenmemişte tutar girilmez', () => {
  const paid = facts({ paymentStatus: 'paid' })
  const late = (role: string) => cancelContext(at('2026-12-18T09:00:00Z'), role)
  rejects(
    () =>
      planEventTicketCancel(
        { refundCents: 15000, reason: 'Etkinlik ertelendi' },
        paid,
        late('onburo'),
      ),
    'event_ticket_refund_override_forbidden',
    'forbidden',
  )
  rejects(
    () => planEventTicketCancel({ refundCents: 15000 }, paid, late('yonetici')),
    'event_ticket_refund_reason_required',
  )
  rejects(
    () => planEventTicketCancel({ refundCents: 15001, reason: 'Fazla' }, paid, late('yonetici')),
    'event_ticket_refund_exceeds_price',
  )
  assert.deepEqual(
    planEventTicketCancel(
      { refundCents: 15000, reason: 'Etkinlik ertelendi' },
      paid,
      late('yonetici'),
    ),
    { reason: 'Etkinlik ertelendi', refundCents: 15000 },
  )
  assert.equal(
    planEventTicketCancel({ refundCents: 0, reason: 'Kesintili' }, paid, late('yonetici'))
      .refundCents,
    0,
  )
  rejects(
    () => planEventTicketCancel({ refundCents: 0 }, facts(), cancelContext()),
    'event_ticket_refund_not_applicable',
  )
})

test('DOM-FIN-103, K-380: iade ödendi işareti iptal edilmiş, tutarı olan bilette bir kez', () => {
  const pending = facts({ status: 'cancelled', paymentStatus: 'paid', refundCents: 7500 })
  assert.deepEqual(planEventTicketRefund({ method: 'cash' }, pending), { method: 'cash' })
  invalid(() => planEventTicketRefund({ method: 'card' }, pending))
  rejects(
    () => planEventTicketRefund({ method: 'cash' }, facts({ paymentStatus: 'paid' })),
    'event_ticket_not_cancelled',
  )
  rejects(
    () => planEventTicketRefund({ method: 'cash' }, { ...pending, refundCents: 0 }),
    'event_ticket_no_refund',
  )
  rejects(
    () => planEventTicketRefund({ method: 'cash' }, { ...pending, refundCents: null }),
    'event_ticket_no_refund',
  )
  rejects(
    () =>
      planEventTicketRefund({ method: 'transfer' }, { ...pending, refundedAt: NOW.toISOString() }),
    'event_ticket_already_refunded',
    'conflict',
  )
  assert.equal(eventTicketRefundStatus(pending), 'pending')
  assert.equal(eventTicketRefundStatus({ ...pending, refundedAt: NOW.toISOString() }), 'paid')
  assert.equal(eventTicketRefundStatus({ refundCents: 0, refundedAt: null }), 'none')
  assert.equal(eventTicketRefundStatus({ refundCents: null, refundedAt: null }), 'none')
})

test('DOM-FIN-103, K-378: girişi yönetici ya da okutan görevli etkinlik günü bitene dek gerekçeyle geri alır', () => {
  const used = facts({
    paymentStatus: 'paid',
    usedAt: '2026-12-20T12:50:00.000Z',
    usedByUserId: 'desk-1',
  })
  const eventDay = at('2026-12-20T15:00:00Z')
  const context = (userId: string, role = 'onburo', now = eventDay) => ({
    startsAt: STARTS,
    now,
    actor: { role, userId },
  })
  assert.deepEqual(
    planEventTicketCheckInUndo({ reason: ' Yanlış bilet okundu ' }, used, context('desk-1')),
    { reason: 'Yanlış bilet okundu', usedAt: '2026-12-20T12:50:00.000Z', usedByUserId: 'desk-1' },
  )
  assert.equal(eventTicketCheckInUndoBlocker(used, context('admin-1', 'yonetici')), null)
  // Etkinlikten önce yanlışlıkla okutulan bilet de geri alınır.
  assert.equal(eventTicketCheckInUndoBlocker(used, context('desk-1', 'onburo', NOW)), null)
  rejects(
    () => planEventTicketCheckInUndo({ reason: 'Yanlış bilet' }, used, context('desk-2')),
    'event_ticket_check_in_not_owner',
    'forbidden',
  )
  // Etkinlik günü İstanbul'da 23:59'a kadar sürer; ertesi gün (21 Aralık 00:10) geri alınmaz.
  assert.equal(
    eventTicketCheckInUndoBlocker(used, context('desk-1', 'onburo', at('2026-12-20T20:59:00Z'))),
    null,
  )
  rejects(
    () =>
      planEventTicketCheckInUndo(
        { reason: 'Yanlış bilet' },
        used,
        context('admin-1', 'yonetici', at('2026-12-20T21:10:00Z')),
      ),
    'event_ticket_check_in_undo_expired',
  )
  rejects(
    () => planEventTicketCheckInUndo({ reason: 'Yanlış bilet' }, facts(), context('desk-1')),
    'event_ticket_not_used',
    'conflict',
  )
  rejects(
    () =>
      planEventTicketCheckInUndo(
        { reason: 'Yanlış bilet' },
        { ...used, status: 'cancelled' },
        context('desk-1'),
      ),
    'event_ticket_cancelled',
  )
  invalid(() => planEventTicketCheckInUndo({ reason: 'kısa' }, used, context('desk-1')))
  invalid(() => planEventTicketCheckInUndo({}, used, context('desk-1')))
  invalid(() => planEventTicketCheckInUndo({ reason: 'x'.repeat(201) }, used, context('desk-1')))
})

test('DOM-FIN-103, K-326: giriş bir kez; başka etkinlik, iptal ve ödenmemiş bilet girmez', () => {
  assert.doesNotThrow(() => planEventTicketCheckIn(facts({ paymentStatus: 'paid' }), 'e1'))
  assert.doesNotThrow(() =>
    planEventTicketCheckIn(
      facts({ ticketKind: 'invitation', paymentStatus: 'not_required' }),
      'e1',
    ),
  )
  rejects(
    () => planEventTicketCheckIn(facts({ paymentStatus: 'paid' }), 'e2'),
    'event_ticket_wrong_event',
  )
  rejects(() => planEventTicketCheckIn(facts(), 'e1'), 'event_ticket_unpaid')
  rejects(
    () => planEventTicketCheckIn(facts({ status: 'cancelled' }), 'e1'),
    'event_ticket_cancelled',
  )
  rejects(
    () => planEventTicketCheckIn(facts({ paymentStatus: 'paid', usedAt: NOW.toISOString() }), 'e1'),
    'event_ticket_already_used',
    'conflict',
  )
})

test('DOM-FIN-103, K-326: bilet kodu rastgele baytlardan 12 karakter; okunan kod normalleşir', () => {
  const bytes = Uint8Array.from({ length: 12 }, (_, index) => index * 37 + 5)
  const code = ticketCodeFromBytes(bytes)
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/)
  assert.equal(ticketCodeFromBytes(new Uint8Array(12)), '0000-0000-0000')
  assert.equal(ticketCodeFromBytes(new Uint8Array(12).fill(255)), 'ZZZZ-ZZZZ-ZZZZ')
  assert.throws(() => ticketCodeFromBytes(new Uint8Array(8)))
  assert.equal(normalizeTicketCode(code.toLowerCase().replaceAll('-', ' ')), code)
  assert.equal(normalizeTicketCode('oooo iiii llll'), '0000-1111-1111')
  assert.equal(normalizeTicketCode('ABCD-EFGH'), null)
  assert.equal(normalizeTicketCode('ABCD-EFGH-JKMU'), null)
})

test('DOM-FIN-103, K-327, K-380: özet ve CSV; kod CSV’ye yazılmaz, iade düşülür, kesinti kalır', () => {
  const event = general()
  const base = {
    ticketTypeName: 'Veli bileti',
    ticketKind: 'paid' as const,
    seat: null,
    studentName: 'Deniz Yılmaz',
    holderName: '=Ayşe',
    priceCents: 15000,
    paymentMethod: null,
    paidAt: null,
    usedAt: null,
    cancelledAt: null,
    refundCents: null,
    refundedAt: null,
  }
  const rows = [
    {
      ...base,
      status: 'active' as const,
      paymentStatus: 'paid' as const,
      paymentMethod: 'cash' as const,
      paidAt: '2026-11-16T09:30:00.000Z',
      usedAt: '2026-12-21T07:00:00.000Z',
    },
    { ...base, status: 'active' as const, paymentStatus: 'unpaid' as const },
    {
      ...base,
      status: 'cancelled' as const,
      paymentStatus: 'paid' as const,
      refundCents: 15000,
      refundedAt: NOW.toISOString(),
      cancelledAt: NOW.toISOString(),
    },
    {
      ...base,
      status: 'cancelled' as const,
      paymentStatus: 'paid' as const,
      refundCents: 7500,
      cancelledAt: NOW.toISOString(),
    },
    {
      ...base,
      status: 'cancelled' as const,
      paymentStatus: 'paid' as const,
      refundCents: 0,
      cancelledAt: NOW.toISOString(),
    },
  ]
  assert.deepEqual(eventTicketSummary(event, rows), {
    capacity: 3,
    activeCount: 2,
    availableCount: 1,
    invitationCount: 0,
    usedCount: 1,
    unpaidCount: 1,
    // 15000 (etkin) + 0 (tam iade) + 7500 (yarı kesinti) + 15000 (iade yok)
    collectedCents: 37500,
    pendingRefundCount: 1,
    pendingRefundCents: 7500,
  })
  assert.deepEqual(rows.map(eventTicketState), [
    'used',
    'unpaid',
    'cancelled',
    'cancelled',
    'cancelled',
  ])
  assert.equal(
    eventTicketState({ status: 'active', paymentStatus: 'not_required', usedAt: null }),
    'valid',
  )
  const csv = eventTicketsCsv(rows)
  const lines = csv.split('\r\n')
  assert.equal(lines.length, 6)
  assert.ok(lines[0]?.startsWith('"Bilet türü";"Tür";"Koltuk"'))
  assert.ok(lines[0]?.endsWith('"İade tutarı";"İade";"İade zamanı"'))
  assert.ok(lines[1]?.includes(`"'=Ayşe"`), 'formül kaçışı')
  assert.ok(lines[1]?.includes('150,00'))
  assert.ok(lines[1]?.includes('"16.11.2026 12:30"'), 'İstanbul saati')
  assert.ok(lines[1]?.includes('"Kullanıldı"'))
  assert.ok(lines[1]?.endsWith(';"";""'), 'iptal edilmemiş bilette iade boş')
  assert.ok(lines[3]?.endsWith('150,00;"İade ödendi";"16.11.2026 12:00"'))
  assert.ok(lines[4]?.endsWith('75,00;"İade bekliyor";""'))
  assert.ok(lines[5]?.endsWith('0,00;"İade yok";""'))
  assert.ok(!lines[0]?.includes('Kod'), 'bilet kodu sütunu yok')
})
