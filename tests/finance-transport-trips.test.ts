import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  planTransportTripClose,
  planTransportTripMark,
  planTransportTripStart,
  transportTripAccess,
  transportTripCounts,
  transportTripCountsLabel,
  transportTripMarkSchema,
  type TransportMarkState,
  type TransportTripAccess,
  type TransportTripMarkChecks,
} from '../packages/school-core/src/lib/finance-transport-trips.ts'

/** Servis seferi ve biniş-iniş kaydı kuralları (DOM-FIN-149; ON-145; IST-144; K-502…K-504). */

const NOW = new Date('2026-10-06T06:30:00Z') // 09:30 İstanbul
const DAY = '2026-10-06'
const OPERATOR: TransportTripAccess = { read: true, operate: true, correct: false }
const MANAGER: TransportTripAccess = { read: true, operate: true, correct: true }
const READER: TransportTripAccess = { read: true, operate: false, correct: false }

function rejects(fn: () => unknown, code: string, kind: DomainError['kind'] = 'rule') {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof DomainError)
    assert.equal(error.code, code)
    assert.equal(error.kind, kind)
    return true
  })
}

const mark = (body: Record<string, unknown>) =>
  transportTripMarkSchema.parse({ studentId: 's1', ...body })
const checks = (extra: Partial<TransportTripMarkChecks> = {}): TransportTripMarkChecks => ({
  trip: { status: 'open', tripDate: DAY },
  access: OPERATOR,
  onRoster: true,
  current: null,
  now: NOW,
  ...extra,
})
const boarded = (at = '2026-10-06T04:10:00Z'): TransportMarkState => ({
  status: 'boarded',
  boardedAt: new Date(at),
  alightedAt: null,
})

describe('DOM-FIN-149: servis seferi ve biniş-iniş kuralları', () => {
  test('DOM-FIN-149: yetki rehberliğe göre daralır (K-502)', () => {
    const guide = 'm-guide'
    assert.deepEqual(transportTripAccess({ role: 'yonetici', membershipId: 'm1' }, null), MANAGER)
    assert.deepEqual(transportTripAccess({ role: 'onburo', membershipId: 'm1' }, guide), READER)
    assert.deepEqual(transportTripAccess({ role: 'onburo', membershipId: guide }, guide), OPERATOR)
    assert.deepEqual(
      transportTripAccess({ role: 'ogretmen', membershipId: guide }, guide),
      OPERATOR,
    )
    assert.deepEqual(transportTripAccess({ role: 'ogretmen', membershipId: 'm1' }, guide), {
      read: false,
      operate: false,
      correct: false,
    })
    assert.deepEqual(
      transportTripAccess({ role: 'ogretmen', membershipId: 'm1' }, null).read,
      false,
    )
    assert.equal(transportTripAccess({ role: 'veli', membershipId: guide }, guide).read, false)
  })

  test('DOM-FIN-149: sefer başlatma yalnız rehber ya da yönetici; günde bir sefer (K-502)', () => {
    planTransportTripStart({ access: OPERATOR, tripExists: false })
    rejects(
      () => planTransportTripStart({ access: READER, tripExists: false }),
      'transport_trip_not_guide',
      'forbidden',
    )
    rejects(
      () => planTransportTripStart({ access: MANAGER, tripExists: true }),
      'transport_trip_exists',
      'conflict',
    )
  })

  test('DOM-FIN-149: işaret şeması saat alanlarını duruma göre sınırlar', () => {
    assert.equal(transportTripMarkSchema.safeParse({ studentId: 's1', status: 'x' }).success, false)
    assert.equal(
      transportTripMarkSchema.safeParse({
        studentId: 's1',
        status: 'boarded',
        alightedAt: '2026-10-06T04:10:00Z',
      }).success,
      false,
    )
    assert.equal(
      transportTripMarkSchema.safeParse({
        studentId: 's1',
        status: 'absent',
        boardedAt: '2026-10-06T04:10:00Z',
      }).success,
      false,
    )
    assert.equal(
      transportTripMarkSchema.safeParse({ studentId: 's1', status: 'absent', latitude: 41 })
        .success,
      false,
      'konum alanı kabul edilmez',
    )
    assert.equal(
      transportTripMarkSchema.safeParse({ studentId: 's1', status: 'absent', reason: 'kısa' })
        .success,
      false,
    )
  })

  test('DOM-FIN-149: bindi, indi ve gelmedi işaretleri; saat verilmezse işaret anı', () => {
    const board = planTransportTripMark(mark({ status: 'boarded' }), checks())
    assert.deepEqual(board, {
      kind: 'write',
      next: { status: 'boarded', boardedAt: NOW, alightedAt: null },
      changed: ['status', 'boardedAt'],
      correction: false,
    })
    const alight = planTransportTripMark(
      mark({ status: 'alighted' }),
      checks({ current: boarded() }),
    )
    assert.equal(alight.kind, 'write')
    if (alight.kind === 'write') {
      assert.deepEqual(alight.next.boardedAt, new Date('2026-10-06T04:10:00Z'))
      assert.deepEqual(alight.next.alightedAt, NOW)
      assert.deepEqual(alight.changed, ['status', 'alightedAt'])
    }
    const absent = planTransportTripMark(mark({ status: 'absent' }), checks({ current: boarded() }))
    assert.equal(absent.kind, 'write')
    if (absent.kind === 'write')
      assert.deepEqual(absent.next, { status: 'absent', boardedAt: null, alightedAt: null })
    // Gelmedi işaretlenen öğrenci sonradan binebilir; iniş geri alınınca biniş saati korunur.
    const late = planTransportTripMark(
      mark({ status: 'boarded' }),
      checks({ current: { status: 'absent', boardedAt: null, alightedAt: null } }),
    )
    assert.equal(late.kind === 'write' && late.next.boardedAt?.getTime(), NOW.getTime())
    const undo = planTransportTripMark(
      mark({ status: 'boarded' }),
      checks({
        current: {
          status: 'alighted',
          boardedAt: new Date('2026-10-06T04:10:00Z'),
          alightedAt: new Date('2026-10-06T05:00:00Z'),
        },
      }),
    )
    assert.equal(
      undo.kind === 'write' && undo.next.boardedAt?.toISOString(),
      '2026-10-06T04:10:00.000Z',
    )
  })

  test('DOM-FIN-149: aynı işaretin yinelenmesi değişiklik değildir (çevrimdışı yeniden deneme)', () => {
    assert.deepEqual(
      planTransportTripMark(mark({ status: 'boarded' }), checks({ current: boarded() })),
      { kind: 'unchanged' },
    )
    // Cihazın gönderdiği işaret anı saklanır.
    const offline = planTransportTripMark(
      mark({ status: 'boarded', boardedAt: '2026-10-06T07:12:00+03:00' }),
      checks(),
    )
    assert.equal(
      offline.kind === 'write' && offline.next.boardedAt?.toISOString(),
      '2026-10-06T04:12:00.000Z',
    )
  })

  test('DOM-FIN-149: saat kuralları ve önce biniş', () => {
    rejects(
      () => planTransportTripMark(mark({ status: 'alighted' }), checks()),
      'transport_mark_not_boarded',
    )
    rejects(
      () =>
        planTransportTripMark(
          mark({ status: 'alighted' }),
          checks({ current: { status: 'absent', boardedAt: null, alightedAt: null } }),
        ),
      'transport_mark_not_boarded',
    )
    rejects(
      () =>
        planTransportTripMark(
          mark({ status: 'boarded', boardedAt: '2026-10-06T07:00:00Z' }),
          checks(),
        ),
      'transport_mark_future',
    )
    // Beş dakikalık saat payı kabul edilir.
    assert.equal(
      planTransportTripMark(
        mark({ status: 'boarded', boardedAt: '2026-10-06T06:34:00Z' }),
        checks(),
      ).kind,
      'write',
    )
    rejects(
      () =>
        planTransportTripMark(
          mark({ status: 'boarded', boardedAt: '2026-10-05T20:00:00Z' }),
          checks(),
        ),
      'transport_mark_other_day',
    )
    rejects(
      () =>
        planTransportTripMark(
          mark({ status: 'alighted', alightedAt: '2026-10-06T04:00:00Z' }),
          checks({ current: boarded() }),
        ),
      'transport_mark_alight_before_board',
    )
    // Gün İstanbul günüdür: 21:30Z bir sonraki gündür.
    rejects(
      () =>
        planTransportTripMark(
          mark({ status: 'boarded' }),
          checks({ now: new Date('2026-10-06T21:30:00Z') }),
        ),
      'transport_mark_other_day',
    )
  })

  test('DOM-FIN-149: listede olmayan öğrenci ve rehber olmayan personel reddedilir (K-502)', () => {
    rejects(
      () => planTransportTripMark(mark({ status: 'absent' }), checks({ onRoster: false })),
      'transport_trip_student_not_on_route',
    )
    rejects(
      () => planTransportTripMark(mark({ status: 'absent' }), checks({ access: READER })),
      'transport_trip_not_guide',
      'forbidden',
    )
  })

  test('DOM-FIN-149: kapanmış seferi yalnız yönetici gerekçeyle düzeltir (K-503)', () => {
    const closed = { status: 'closed' as const, tripDate: DAY }
    rejects(
      () =>
        planTransportTripMark(
          mark({ status: 'absent', reason: 'Yanlış işaret' }),
          checks({ trip: closed, current: boarded() }),
        ),
      'transport_trip_closed',
    )
    rejects(
      () =>
        planTransportTripMark(
          mark({ status: 'absent' }),
          checks({ trip: closed, access: MANAGER, current: boarded() }),
        ),
      'transport_mark_reason_required',
    )
    rejects(
      () =>
        planTransportTripMark(
          mark({ status: 'boarded', reason: 'Yanlış işaret' }),
          checks({
            trip: closed,
            access: MANAGER,
            current: { status: 'absent', boardedAt: null, alightedAt: null },
          }),
        ),
      'transport_trip_closed_on_board',
    )
    rejects(
      () =>
        planTransportTripMark(
          mark({ status: 'absent', reason: 'Yanlış işaret' }),
          checks({
            trip: closed,
            access: MANAGER,
            current: { status: 'absent', boardedAt: null, alightedAt: null },
          }),
        ),
      'transport_mark_unchanged',
    )
    const fixed = planTransportTripMark(
      mark({
        status: 'alighted',
        boardedAt: '2026-10-06T07:10:00+03:00',
        alightedAt: '2026-10-06T07:40:00+03:00',
        reason: 'Rehber inişi işaretlemeyi unuttu',
      }),
      checks({
        trip: closed,
        access: MANAGER,
        current: { status: 'absent', boardedAt: null, alightedAt: null },
      }),
    )
    assert.equal(fixed.kind, 'write')
    if (fixed.kind === 'write') {
      assert.equal(fixed.correction, true)
      assert.deepEqual(fixed.changed, ['status', 'boardedAt', 'alightedAt'])
    }
  })

  test('DOM-FIN-149: araçta öğrenci ya da işaretsiz öğrenci varken sefer kapanmaz (K-504)', () => {
    rejects(
      () =>
        planTransportTripClose({
          status: 'open',
          access: OPERATOR,
          roster: ['alighted', 'boarded', 'pending'],
        }),
      'transport_trip_students_on_board',
    )
    rejects(
      () => planTransportTripClose({ status: 'open', access: OPERATOR, roster: ['pending'] }),
      'transport_trip_unmarked',
    )
    rejects(
      () => planTransportTripClose({ status: 'closed', access: OPERATOR, roster: [] }),
      'transport_trip_already_closed',
      'conflict',
    )
    rejects(
      () => planTransportTripClose({ status: 'open', access: READER, roster: [] }),
      'transport_trip_not_guide',
      'forbidden',
    )
    planTransportTripClose({ status: 'open', access: OPERATOR, roster: ['alighted', 'absent'] })
    planTransportTripClose({ status: 'open', access: OPERATOR, roster: [] })
  })

  test('DOM-FIN-149: sefer özeti binen, inen, gelmeyen ve araçta sayar', () => {
    const counts = transportTripCounts(['boarded', 'alighted', 'alighted', 'absent', 'pending'])
    assert.deepEqual(counts, {
      total: 5,
      pending: 1,
      boarded: 3,
      alighted: 2,
      absent: 1,
      onBoard: 1,
    })
    assert.equal(transportTripCountsLabel(counts), '3 bindi · 2 indi · 1 gelmedi · 1 işaretlenmedi')
    assert.equal(
      transportTripCountsLabel(transportTripCounts(['absent'])),
      '0 bindi · 0 indi · 1 gelmedi',
    )
  })
})
