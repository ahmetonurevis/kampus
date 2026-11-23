import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  EXTRA_TIME_REASONS,
  canManageExtraTime,
  currentExtraTime,
  extraTimeSchema,
  extraTimeVersion,
  learnerTiming,
  planExtraTime,
  type ExtraTimePlanInput,
  type ExtraTimeRow,
} from '../packages/school-core/src/skills/extra-time.ts'
import {
  attemptEndsAt,
  attemptExtraMinutes,
  attemptState,
  deadlineSchema,
  planAttemptStart,
  type AttemptRow,
} from '../packages/school-core/src/skills/scoring.ts'
import { isDomainError } from './support/domain-error.ts'

const now = '2026-11-05T10:00:00.000Z'
const due = '2026-11-05T20:59:00.000Z'
const deadline = deadlineSchema.parse({ dueAt: due })
const assignment = {
  assignedByUserId: 'test-u-teacher',
  timeLimitMinutes: 30,
  deadline,
  archivedAt: null,
}
const teacher = { role: 'ogretmen', userId: 'test-u-teacher' }
const otherTeacher = { role: 'ogretmen', userId: 'test-u-other' }
const admin = { role: 'yonetici', userId: 'test-u-admin' }

const row = (input: Partial<ExtraTimeRow> = {}): ExtraTimeRow => ({
  sequence: 1,
  minutes: 15,
  reason: 'accommodation',
  grantedAt: '2026-11-05T09:00:00.000Z',
  grantedByUserId: 'test-u-teacher',
  ...input,
})
const attempt = (input: Partial<AttemptRow> = {}): AttemptRow => ({
  id: 'test-a1',
  startedAt: '2026-11-05T09:50:00.000Z',
  submittedAt: null,
  answers: {},
  ...input,
})

const plan = (input: Partial<ExtraTimePlanInput> = {}) =>
  planExtraTime({
    actor: teacher,
    modules: { learning: true },
    assignment,
    learnerTargeted: true,
    rows: [],
    attempts: [],
    change: { kind: 'grant', input: { minutes: 15, reason: 'accommodation' } },
    now,
    ...input,
  })

const isZodError = (error: unknown) => error instanceof Error && error.name === 'ZodError'

/** Başarısız planın girdisi değişmez (saf işlem). */
function unchangedOnFailure(
  input: Partial<ExtraTimePlanInput>,
  check: (error: unknown) => boolean,
) {
  const snapshot = structuredClone(input)
  assert.throws(() => plan(input), check)
  assert.deepEqual(input, snapshot)
}

describe('bireysel ek süre (DOM-BEC-043)', () => {
  test('DOM-BEC-043 gerekçe seçilmiş kategoridir, serbest metin kabul edilmez', () => {
    assert.deepEqual(Object.keys(EXTRA_TIME_REASONS), ['accommodation', 'technical_issue', 'other'])
    assert.equal(extraTimeSchema.safeParse({ minutes: 20, reason: 'other' }).success, true)
    assert.equal(
      extraTimeSchema.safeParse({ minutes: 20, reason: 'Okuma güçlüğü raporu' }).success,
      false,
    )
    assert.equal(extraTimeSchema.safeParse({ minutes: 0, reason: 'other' }).success, false)
    assert.equal(extraTimeSchema.safeParse({ minutes: 301, reason: 'other' }).success, false)
    assert.equal(extraTimeSchema.safeParse({ minutes: 1.5, reason: 'other' }).success, false)
    assert.equal(
      extraTimeSchema.safeParse({ minutes: 20, reason: 'other', note: 'Rapor' }).data?.minutes,
      20,
    )
    assert.equal(
      'note' in extraTimeSchema.parse({ minutes: 20, reason: 'other', note: 'x' }),
      false,
    )
  })

  test('DOM-BEC-043 ek süre verilir: ilk kayıt sıra 1, sunucu saati', () => {
    assert.deepEqual(plan(), {
      sequence: 1,
      minutes: 15,
      reason: 'accommodation',
      grantedAt: now,
    })
    assert.equal(plan({ actor: admin }).sequence, 1)
  })

  test('DOM-BEC-043 değiştirme ve kaldırma yeni kayıttır, sürüm son sıradır', () => {
    const rows = [row()]
    assert.deepEqual(
      plan({
        rows,
        change: {
          kind: 'change',
          input: { minutes: 25, reason: 'technical_issue' },
          expectedVersion: 1,
        },
      }),
      { sequence: 2, minutes: 25, reason: 'technical_issue', grantedAt: now },
    )
    assert.deepEqual(plan({ rows, change: { kind: 'remove', expectedVersion: 1 } }), {
      sequence: 2,
      minutes: 0,
      reason: null,
      grantedAt: now,
    })
    // Kaldırılmış ek süre yeniden verilir.
    const removed = [row(), row({ sequence: 2, minutes: 0, reason: null })]
    assert.equal(currentExtraTime(removed), null)
    assert.equal(extraTimeVersion(removed), 2)
    assert.equal(plan({ rows: removed }).sequence, 3)
  })

  test('DOM-BEC-043 mükerrer verme 409, eski sürümle değiştirme 409, olmayanı kaldırma 404', () => {
    unchangedOnFailure({ rows: [row()] }, isDomainError('extra_time_exists', 'conflict'))
    unchangedOnFailure(
      {
        rows: [row(), row({ sequence: 2, minutes: 20 })],
        change: { kind: 'change', input: { minutes: 25, reason: 'other' }, expectedVersion: 1 },
      },
      isDomainError('version_conflict', 'conflict'),
    )
    unchangedOnFailure(
      { change: { kind: 'remove', expectedVersion: 0 } },
      isDomainError('extra_time_not_found', 'not_found'),
    )
  })

  test('DOM-BEC-043 doğrulama hatasında kayıt yazılmaz', () => {
    unchangedOnFailure(
      { change: { kind: 'grant', input: { minutes: 0, reason: 'other' } } },
      isZodError,
    )
    unchangedOnFailure(
      { change: { kind: 'grant', input: { minutes: 10, reason: 'Disleksi raporu' } } },
      isZodError,
    )
  })

  test('DOM-BEC-043 yalnız süreli görevde, açık pencerede ve görevin süresi kadar', () => {
    unchangedOnFailure(
      { assignment: { ...assignment, timeLimitMinutes: null } },
      isDomainError('extra_time_untimed'),
    )
    unchangedOnFailure(
      { change: { kind: 'grant', input: { minutes: 31, reason: 'other' } } },
      isDomainError('extra_time_too_long'),
    )
    assert.equal(
      plan({ change: { kind: 'grant', input: { minutes: 30, reason: 'other' } } }).minutes,
      30,
    )
    unchangedOnFailure({ now: '2026-11-05T21:00:00.000Z' }, isDomainError('submission_closed'))
  })

  test('DOM-BEC-043 süren denemeyi geçmişte bitirecek kısaltma reddedilir', () => {
    // 09:30'da başlayan 30 dakikalık deneme 15 dk ek süreyle 10:15'te biter; şimdi 10:00.
    const running = attempt({ startedAt: '2026-11-05T09:30:00.000Z' })
    const rows = [row({ grantedAt: '2026-11-05T09:00:00.000Z' })]
    unchangedOnFailure(
      { rows, attempts: [running], change: { kind: 'remove', expectedVersion: 1 } },
      isDomainError('extra_time_below_elapsed'),
    )
    // 10:05'e kısaltmak süren denemeyi bitirmez.
    assert.equal(
      plan({
        rows,
        attempts: [running],
        change: { kind: 'change', input: { minutes: 5, reason: 'other' }, expectedVersion: 1 },
      }).minutes,
      5,
    )
    // Teslim edilmiş deneme kısaltmayı engellemez.
    assert.equal(
      plan({
        rows,
        attempts: [{ ...running, submittedAt: '2026-11-05T09:40:00.000Z' }],
        change: { kind: 'remove', expectedVersion: 1 },
      }).minutes,
      0,
    )
  })

  test('DOM-BEC-043 kayıt saati son kaydın gerisine inmez; eski saatle yazılan kayıt bitmiş denemeyi açmaz', () => {
    const last = row({ grantedAt: '2026-11-05T09:58:00.000Z' })
    // Kilitte bekleyen isteğin saati son kayıttan eskidir: kayıt saati son kaydınki olur.
    const planned = plan({
      rows: [last],
      change: { kind: 'change', input: { minutes: 20, reason: 'other' }, expectedVersion: 1 },
      now: '2026-11-05T09:40:00.000Z',
    })
    assert.equal(planned.sequence, 2)
    assert.equal(planned.grantedAt, last.grantedAt)
    // Saat ilerliyorsa istek anı kullanılır.
    assert.equal(
      plan({
        rows: [last],
        change: { kind: 'change', input: { minutes: 20, reason: 'other' }, expectedVersion: 1 },
      }).grantedAt,
      now,
    )
    // 09:20'de başlayan deneme 09:50'de bitti; son kayıt 09:55'te. 09:10 saatli eski istek
    // kayıt saatini 09:55 yapar, denemenin bitişinden önceye düşüp onu yeniden açamaz.
    const ended = attempt({ startedAt: '2026-11-05T09:20:00.000Z' })
    const granted = plan({
      attempts: [ended],
      rows: [row({ minutes: 5, grantedAt: '2026-11-05T09:55:00.000Z' })],
      change: { kind: 'change', input: { minutes: 20, reason: 'other' }, expectedVersion: 1 },
      now: '2026-11-05T09:10:00.000Z',
    })
    const timing = learnerTiming(assignment, [
      row({ minutes: 5, grantedAt: '2026-11-05T09:55:00.000Z' }),
      { ...granted, grantedByUserId: 'test-u-teacher' },
    ])
    assert.equal(granted.grantedAt, '2026-11-05T09:55:00.000Z')
    assert.equal(attemptExtraMinutes(ended, timing), 0)
    assert.equal(attemptState(ended, timing, now).status, 'expired')
  })

  test('DOM-BEC-043 rol kapsamı: atayan öğretmen ve yönetici verir; diğerleri 403', () => {
    assert.equal(canManageExtraTime(teacher, assignment), true)
    assert.equal(canManageExtraTime(admin, assignment), true)
    assert.equal(canManageExtraTime(otherTeacher, assignment), false)
    unchangedOnFailure({ actor: otherTeacher }, isDomainError('extra_time_forbidden', 'forbidden'))
    for (const role of ['ogrenci', 'veli', 'onburo']) {
      unchangedOnFailure(
        { actor: { role, userId: 'test-u-teacher' } },
        isDomainError('extra_time_forbidden', 'forbidden'),
      )
    }
  })

  test('DOM-BEC-043 hedef dışı kursiyer ve arşivli atama 404', () => {
    unchangedOnFailure({ learnerTargeted: false }, isDomainError('not_found', 'not_found'))
    unchangedOnFailure(
      { assignment: { ...assignment, archivedAt: '2026-11-04T00:00:00.000Z' } },
      isDomainError('not_found', 'not_found'),
    )
  })

  test('DOM-BEC-043 modül kapalıyken ret', () => {
    unchangedOnFailure(
      { modules: { learning: false } },
      isDomainError('module_disabled', 'forbidden'),
    )
    unchangedOnFailure({ modules: {} }, isDomainError('module_disabled', 'forbidden'))
  })
})

describe('denemenin ek süresi kayıt geçmişinden (DOM-BEC-043)', () => {
  const base = { timeLimitMinutes: 30, deadline }

  test('DOM-BEC-043 süren deneme yeni ek süreyle uzar, bitiş anı saklanmaz', () => {
    const running = attempt({ startedAt: '2026-11-05T09:50:00.000Z' })
    assert.equal(
      attemptEndsAt(running.startedAt, learnerTiming(base, [])),
      '2026-11-05T10:20:00.000Z',
    )
    const timing = learnerTiming(base, [row({ grantedAt: '2026-11-05T10:00:00.000Z' })])
    assert.equal(attemptExtraMinutes(running, timing), 15)
    const state = attemptState(running, timing, '2026-11-05T10:25:00.000Z')
    assert.equal(state.status, 'in_progress')
    assert.equal(state.endsAt, '2026-11-05T10:35:00.000Z')
    assert.equal(state.remainingMs, 10 * 60_000)
  })

  test('DOM-BEC-043 yeni deneme güncel ek süreyle başlar', () => {
    const timing = learnerTiming(base, [row()])
    assert.equal(timing.extraMinutes, 15)
    assert.equal(
      planAttemptStart({
        rules: { kind: 'evaluation', maxAttempts: 2, countPolicy: 'first' },
        timing,
        attempts: [],
        now,
      }).endsAt,
      '2026-11-05T10:45:00.000Z',
    )
  })

  test('DOM-BEC-043 biten deneme sonradan verilen ek süreyle yeniden açılmaz', () => {
    // 09:00'da başlayan deneme 09:30'da süresi dolarak bitti; ek süre 09:40'ta verildi.
    const expired = attempt({ startedAt: '2026-11-05T09:00:00.000Z' })
    const timing = learnerTiming(base, [
      row({ minutes: 30, grantedAt: '2026-11-05T09:40:00.000Z' }),
    ])
    assert.equal(attemptExtraMinutes(expired, timing), 0)
    const state = attemptState(expired, timing, '2026-11-05T09:45:00.000Z')
    assert.equal(state.status, 'expired')
    assert.equal(state.completedAt, '2026-11-05T09:30:00.000Z')
    // Teslim edilmiş denemeye teslimden sonraki kayıt sayılmaz.
    const submitted = attempt({
      startedAt: '2026-11-05T09:00:00.000Z',
      submittedAt: '2026-11-05T09:10:00.000Z',
    })
    const later = learnerTiming(base, [row({ grantedAt: '2026-11-05T09:20:00.000Z' })])
    assert.equal(attemptExtraMinutes(submitted, later), 0)
    // Kaldırma süren denemede ek süreyi sıfırlar.
    const removed = learnerTiming(base, [
      row({ grantedAt: '2026-11-05T08:00:00.000Z' }),
      row({ sequence: 2, minutes: 0, reason: null, grantedAt: '2026-11-05T09:05:00.000Z' }),
    ])
    assert.equal(
      attemptExtraMinutes(attempt({ startedAt: '2026-11-05T09:00:00.000Z' }), removed),
      0,
    )
    assert.equal(removed.extraMinutes, 0)
  })

  test('DOM-BEC-043 ek süre teslim kapanışını aşmaz', () => {
    const timing = learnerTiming(base, [
      row({ minutes: 30, grantedAt: '2026-11-05T20:00:00.000Z' }),
    ])
    assert.equal(attemptEndsAt('2026-11-05T20:50:00.000Z', timing), due)
  })
})
