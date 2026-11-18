import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  EventTicketRow,
  TicketedEventRow,
} from '@kampus/react-shared/use-finance-event-tickets.ts'
import {
  centsOf,
  eventBody,
  eventDefaults,
  eventFormField,
  eventFormSchema,
  isoOfLocal,
  localInputOf,
  priceTextOf,
} from '../src/pages/finance/finance-event-ticket-forms.ts'
import {
  eventTicketsDocument,
  eventTicketsFilename,
  ticketPaymentText,
} from '../src/lib/pdf/templates/finance-event-ticket.ts'
import { allTexts, measurer } from './support/pdf-measurer.ts'

// Etkinlik bileti formu ve PDF bileti (DOM-FIN-103; ON-159; K-325, K-326).

const EVENT: TicketedEventRow = {
  id: 'e0000000-0000-4000-8000-000000000001',
  name: 'Yıl sonu gösterisi',
  startsAt: '2026-12-20T13:00:00.000Z',
  venue: 'Konferans salonu',
  schoolEventId: null,
  schoolEventTitle: null,
  seatingMode: 'seated',
  rowCount: 3,
  seatsPerRow: 4,
  blockedSeats: ['A1', 'C4'],
  capacity: null,
  ticketTypes: [
    { key: 'k1', name: 'Davetiye', kind: 'invitation', priceCents: 0 },
    { key: 'k2', name: 'Veli bileti', kind: 'paid', priceCents: 15050 },
  ],
  perStudentLimit: 2,
  limitScope: 'student',
  salesOpen: true,
  totalCapacity: 10,
  activeCount: 1,
  availableCount: 9,
  invitationCount: 0,
  usedCount: 0,
  unpaidCount: 0,
  collectedCents: 15050,
  pendingRefundCount: 0,
  pendingRefundCents: 0,
  takenSeats: ['B2'],
  version: 3,
}

const TICKET: EventTicketRow = {
  id: 't0000000-0000-4000-8000-000000000001',
  eventId: EVENT.id,
  code: 'AB12-CD34-EF56',
  ticketTypeKey: 'k2',
  ticketTypeName: 'Veli bileti',
  ticketKind: 'paid',
  priceCents: 15050,
  seat: 'B2',
  studentId: 's1',
  studentName: 'Deniz Yılmaz',
  holderName: 'Ayşe Yılmaz',
  status: 'active',
  paymentStatus: 'paid',
  paymentMethod: 'transfer',
  paidAt: '2026-11-16T09:00:00.000Z',
  refundCents: null,
  refundMethod: null,
  refundedAt: null,
  refundStatus: 'none',
  usedAt: null,
  cancelledAt: null,
  cancelReason: null,
  state: 'valid',
  checkInUndoCount: 0,
  canUndoCheckIn: false,
  createdAt: '2026-11-16T08:00:00.000Z',
  version: 2,
}

test('DOM-FIN-103: başlangıç Türkiye saatiyle girilir; fiyat TL metninden kuruşa döner', () => {
  assert.equal(localInputOf('2026-12-20T13:00:00.000Z'), '2026-12-20T16:00')
  assert.equal(isoOfLocal('2026-12-20T16:00'), '2026-12-20T16:00:00+03:00')
  assert.equal(centsOf('150'), 15000)
  assert.equal(centsOf('150,5'), 15050)
  assert.equal(centsOf('1.250,75'), 125075)
  assert.equal(centsOf('abc'), null)
  assert.equal(centsOf('1,234'), null)
  assert.equal(priceTextOf(15050), '150,50')
  assert.equal(priceTextOf(15000), '150')
  assert.equal(priceTextOf(0), '0')
})

test('DOM-FIN-103, K-325, K-379: düzeltme formu etkinlikten dolar ve aynı gövdeye döner; sınır kapsamı taşınır', () => {
  const values = eventDefaults(EVENT)
  assert.equal(values.blockedSeats, 'A1, C4')
  assert.equal(values.startsAt, '2026-12-20T16:00')
  assert.equal(eventFormSchema.safeParse(values).success, true)
  const body = eventBody({ ...values, blockedSeats: 'a1 c4,b1' })
  assert.deepEqual(body.blockedSeats, ['A1', 'C4', 'B1'])
  assert.equal(body.startsAt, '2026-12-20T16:00:00+03:00')
  assert.equal(body.capacity, null)
  assert.deepEqual(body.ticketTypes, [
    { key: 'k1', name: 'Davetiye', kind: 'invitation', priceCents: 0 },
    { key: 'k2', name: 'Veli bileti', kind: 'paid', priceCents: 15050 },
  ])
  const general = eventBody({ ...values, seatingMode: 'general', capacity: '200' })
  assert.deepEqual(
    [general.rowCount, general.seatsPerRow, general.blockedSeats, general.capacity],
    [null, null, [], 200],
  )
  assert.equal(body.limitScope, 'student')
  assert.equal(eventBody({ ...values, limitScope: 'family' }).limitScope, 'family')
  assert.equal(eventDefaults({ ...EVENT, limitScope: 'family' }).limitScope, 'family')
  const fresh = eventDefaults()
  assert.equal(fresh.limitScope, 'student')
  assert.equal(fresh.ticketTypes[0]?.kind, 'invitation')
  assert.equal(eventBody({ ...fresh, startsAt: '2026-12-01T10:00' }).ticketTypes[0]?.key, undefined)
})

test('DOM-FIN-103, K-325: form eksik düzeni ve geçersiz fiyatı yakalar; sunucu yolu alana eşlenir', () => {
  const values = eventDefaults(EVENT)
  const issues = (input: unknown) =>
    eventFormSchema.safeParse(input).error?.issues.map((issue) => issue.path.join('.')) ?? []
  assert.deepEqual(issues({ ...values, rowCount: '' }), ['rowCount'])
  assert.deepEqual(issues({ ...values, seatingMode: 'general', capacity: '' }), ['capacity'])
  assert.deepEqual(
    issues({
      ...values,
      ticketTypes: [{ key: '', name: 'Bilet', kind: 'paid', price: '0' }],
    }),
    ['ticketTypes.0.price'],
  )
  assert.equal(eventFormField('blockedSeats.1'), 'blockedSeats')
  assert.equal(eventFormField('ticketTypes.0.priceCents'), 'ticketTypes')
  assert.equal(eventFormField('limitScope'), 'limitScope')
  assert.equal(eventFormField('salesOpen'), null)
})

test('DOM-FIN-103, K-326: PDF bilet başına sayfa; kod, koltuk ve ödeme yazılır', () => {
  const qr = { size: 21, dark: Array.from({ length: 21 }, () => Array<boolean>(21).fill(false)) }
  const other: EventTicketRow = {
    ...TICKET,
    id: 't2',
    code: 'ZZ99-ZZ99-ZZ99',
    seat: null,
    ticketKind: 'invitation',
    priceCents: 0,
    paymentStatus: 'not_required',
    paymentMethod: null,
  }
  const doc = eventTicketsDocument(
    measurer,
    EVENT,
    [
      { ...TICKET, qr },
      { ...other, qr },
    ],
    { institution: 'Akademi Özel Okulları', generatedAt: new Date('2026-11-16T09:00:00Z') },
  )
  assert.equal(doc.pages.length, 2)
  const texts = allTexts(doc)
  for (const value of ['Yıl sonu gösterisi', 'AB12-CD34-EF56', 'ZZ99-ZZ99-ZZ99', 'Numarasız', 'B2'])
    assert.ok(
      texts.some((line) => line.includes(value)),
      value,
    )
  assert.ok(
    texts.some((line) => line.includes('16:00')),
    'İstanbul saati',
  )
  assert.equal(ticketPaymentText(TICKET), '150,50 ₺ · Ödendi (Havale/EFT)')
  assert.equal(ticketPaymentText(other), 'Ücretsiz davetiye')
  assert.equal(
    ticketPaymentText({ ...TICKET, paymentStatus: 'unpaid', paymentMethod: null }),
    '150,50 ₺ · Ödenmedi',
  )
  assert.equal(eventTicketsFilename(EVENT, 1), 'etkinlik-bileti-2026-12-20.pdf')
  assert.equal(eventTicketsFilename(EVENT, 3), 'etkinlik-biletleri-2026-12-20-3.pdf')
  assert.throws(() =>
    eventTicketsDocument(measurer, EVENT, [], { institution: 'Akademi Özel Okulları' }),
  )
})
