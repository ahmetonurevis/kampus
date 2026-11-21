import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  TransportTripDayRow,
  TransportTripRosterRow,
} from '@kampus/react-shared/use-finance-transport-trips.ts'

import {
  canStartTrip,
  correctionBody,
  correctionDefaults,
  correctionFormField,
  correctionFormSchema,
  markTimeText,
  onBoardAlerts,
  rosterGroups,
  rosterStatusLine,
  tripStatusText,
} from '../src/pages/finance/finance-transport-trip-forms.ts'

// Servis "Seferler" görünümünün saf mantığı (DOM-FIN-149; ON-145; K-502…K-504).

const row = (extra: Partial<TransportTripRosterRow> = {}): TransportTripRosterRow => ({
  studentId: 's1',
  studentName: 'Deniz Yılmaz',
  stopId: 'stop-1',
  stopName: 'Moda',
  stopPosition: 1,
  stopTime: '07:10',
  status: 'pending',
  boardedAt: null,
  alightedAt: null,
  correctedAt: null,
  correctionReason: null,
  ...extra,
})
const counts = { total: 2, pending: 0, boarded: 1, alighted: 0, absent: 1, onBoard: 1 }
const dayRow = (extra: Partial<TransportTripDayRow> = {}): TransportTripDayRow => ({
  routeId: 'r1',
  routeName: 'Moda hattı',
  direction: 'morning',
  vehiclePlate: '34KMP101',
  guideName: 'Rehber',
  assigned: 2,
  canOperate: true,
  trip: null,
  ...extra,
})

test('DOM-FIN-149: durum satırı İstanbul saatini gösterir', () => {
  assert.equal(markTimeText(null), '')
  assert.equal(markTimeText('2026-10-06T04:24:00.000Z'), '07:24')
  assert.equal(rosterStatusLine(row()), 'İşaretlenmedi')
  assert.equal(rosterStatusLine(row({ status: 'absent' })), 'Gelmedi')
  assert.equal(
    rosterStatusLine(row({ status: 'boarded', boardedAt: '2026-10-06T04:24:00.000Z' })),
    'Bindi 07:24',
  )
  assert.equal(
    rosterStatusLine(
      row({
        status: 'alighted',
        boardedAt: '2026-10-06T04:24:00.000Z',
        alightedAt: '2026-10-06T04:50:00.000Z',
      }),
    ),
    'İndi 07:50 (biniş 07:24)',
  )
  assert.equal(tripStatusText(null), 'Başlamadı')
  assert.equal(tripStatusText('open'), 'Sürüyor')
  assert.equal(tripStatusText('closed'), 'Kapandı')
})

test('DOM-FIN-149: işaretleme listesi durak sırasıyla gruplanır', () => {
  const groups = rosterGroups([
    row({ studentId: 's2' }),
    row({ studentId: 's3' }),
    row({ studentId: 's1', stopId: 'stop-2', stopName: 'Bahariye', stopPosition: 2 }),
  ])
  assert.deepEqual(
    groups.map((group) => [group.position, group.stopName, group.rows.map((r) => r.studentId)]),
    [
      [1, 'Moda', ['s2', 's3']],
      [2, 'Bahariye', ['s1']],
    ],
  )
  assert.deepEqual(rosterGroups([]), [])
})

test('DOM-FIN-149: araçta öğrenci uyarısı yalnız sürmekte olan seferde (K-504)', () => {
  const open = {
    id: 't1',
    status: 'open' as const,
    startedAt: '',
    closedAt: null,
    counts,
    version: 1,
  }
  assert.deepEqual(onBoardAlerts([dayRow({ trip: open }), dayRow({ routeId: 'r2' })]), [
    { routeId: 'r1', routeName: 'Moda hattı', count: 1 },
  ])
  assert.deepEqual(onBoardAlerts([dayRow({ trip: { ...open, status: 'closed' } })]), [])
  assert.deepEqual(
    onBoardAlerts([dayRow({ trip: { ...open, counts: { ...counts, onBoard: 0 } } })]),
    [],
  )
})

test('DOM-FIN-149: sefer yalnız bugün ve yürütebilen kullanıcıca başlatılır (K-502)', () => {
  assert.equal(canStartTrip(dayRow(), '2026-10-06', '2026-10-06'), true)
  assert.equal(canStartTrip(dayRow({ canOperate: false }), '2026-10-06', '2026-10-06'), false)
  assert.equal(canStartTrip(dayRow(), '2026-10-05', '2026-10-06'), false)
})

test('DOM-FIN-149: düzeltme formu gerekçe ve saat ister, gövdeyi UTC kurar (K-503)', () => {
  const boarded = row({
    status: 'boarded',
    boardedAt: '2026-10-06T04:24:00.000Z',
  })
  assert.deepEqual(correctionDefaults(boarded), {
    status: 'alighted',
    boardedTime: '07:24',
    alightedTime: '',
    reason: '',
  })
  assert.equal(correctionDefaults(row({ status: 'absent' })).status, 'absent')
  const missing = correctionFormSchema.safeParse({ ...correctionDefaults(boarded), reason: 'abc' })
  assert.equal(missing.success, false)
  assert.deepEqual(missing.error?.issues.map((issue) => issue.path.join('.')).sort(), [
    'alightedTime',
    'reason',
  ])
  const reversed = correctionFormSchema.safeParse({
    status: 'alighted',
    boardedTime: '07:30',
    alightedTime: '07:10',
    reason: 'Rehber unuttu',
  })
  assert.deepEqual(
    reversed.error?.issues.map((issue) => issue.path.join('.')),
    ['alightedTime'],
  )
  const parsed = correctionFormSchema.parse({
    status: 'alighted',
    boardedTime: '07:24',
    alightedTime: '07:50',
    reason: '  Rehber unuttu  ',
  })
  assert.deepEqual(correctionBody(parsed, '2026-10-06', 's1'), {
    studentId: 's1',
    status: 'alighted',
    boardedAt: '2026-10-06T04:24:00.000Z',
    alightedAt: '2026-10-06T04:50:00.000Z',
    reason: 'Rehber unuttu',
  })
  const absent = correctionFormSchema.parse({
    status: 'absent',
    boardedTime: '',
    alightedTime: '',
    reason: 'Öğrenci gelmedi',
  })
  assert.deepEqual(correctionBody(absent, '2026-10-06', 's1'), {
    studentId: 's1',
    status: 'absent',
    reason: 'Öğrenci gelmedi',
  })
  assert.equal(correctionFormField('boardedAt'), 'boardedTime')
  assert.equal(correctionFormField('alightedAt'), 'alightedTime')
  assert.equal(correctionFormField('reason'), 'reason')
  assert.equal(correctionFormField('studentId'), null)
})
