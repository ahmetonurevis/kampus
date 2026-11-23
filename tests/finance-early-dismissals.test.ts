import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  authorizedPickups,
  canPickUpStudent,
  dismissalDeparture,
  dismissalLessonEffects,
  earlyDismissalCancelSchema,
  earlyDismissalCreateSchema,
  earlyDismissalRejectSchema,
  earlyDismissalReleaseSchema,
  maskIdLast4,
  planEarlyDismissal,
  planEarlyDismissalApproval,
  planEarlyDismissalCancel,
  planEarlyDismissalRejection,
  planEarlyDismissalRelease,
  plannedInstant,
  type DismissalScheduleLesson,
  type EarlyDismissalCreateChecks,
  type EarlyDismissalState,
} from '../packages/school-core/src/lib/finance-early-dismissals.ts'
import type { GuardianLink } from '../packages/school-core/src/lib/guardianship.ts'

/**
 * Erken çıkış ve izinli ayrılış kuralları (DOM-FIN-161; ON-168; K-538…K-540). NOW 2026-10-06
 * 09:00Z = Europe/Istanbul 12:00.
 */

const NOW = new Date('2026-10-06T09:00:00.000Z')
const TODAY = '2026-10-06'
const MOTHER = '00000000-0000-4000-8000-000000000001'
const GRANDPA = '00000000-0000-4000-8000-000000000002'
const FATHER = '00000000-0000-4000-8000-000000000003'
const STEP = '00000000-0000-4000-8000-000000000004'

const link = (overrides: Partial<GuardianLink> & Pick<GuardianLink, 'id'>): GuardianLink => ({
  studentId: 's-1',
  parentId: null,
  membershipId: null,
  relationship: 'other',
  custody: 'full',
  contactRestricted: false,
  isPayer: false,
  canPickUp: false,
  ...overrides,
})
/** Anne (velayetli, hesaplı), dede (velayetsiz, teslim yetkili), kısıtlı baba, velayetsiz üvey. */
const LINKS: GuardianLink[] = [
  link({ id: MOTHER, membershipId: 'm-mother', relationship: 'mother' }),
  link({ id: GRANDPA, parentId: 'p-grandpa', custody: 'none', canPickUp: true }),
  link({
    id: FATHER,
    membershipId: 'm-father',
    relationship: 'father',
    custody: 'none',
    contactRestricted: true,
  }),
  link({ id: STEP, membershipId: 'm-step', custody: 'none' }),
]

const body = (overrides: Record<string, unknown> = {}) =>
  earlyDismissalCreateSchema.parse({
    studentId: 's-1',
    date: TODAY,
    time: '13:40',
    reason: 'appointment',
    pickup: { kind: 'self' },
    ...overrides,
  })
const checks = (
  overrides: Partial<EarlyDismissalCreateChecks> = {},
): EarlyDismissalCreateChecks => ({
  now: NOW,
  requester: { kind: 'guardian', membershipId: 'm-mother' },
  student: { active: true, classId: '9-A' },
  links: LINKS,
  activeExists: false,
  ...overrides,
})
const school = { kind: 'school' } as const

function rejects(run: () => unknown, code: string, kind?: DomainError['kind']) {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof DomainError, String(error))
    assert.equal(error.code, code)
    if (kind !== undefined) assert.equal(error.kind, kind)
    return true
  })
}

describe('DOM-FIN-161: erken çıkış talebi (K-538)', () => {
  test('DOM-FIN-161: şema saati, nedeni, açıklamayı ve kayıtlı olmayan kişinin son dört hanesini denetler', () => {
    const parsed = body({
      reasonNote: '  ',
      pickup: {
        kind: 'other',
        name: ' Hasan Yılmaz ',
        idLast4: ' ab12 ',
        relationship: 'grandparent',
      },
    })
    assert.equal(parsed.reasonNote, null)
    assert.deepEqual(parsed.pickup, {
      kind: 'other',
      name: 'Hasan Yılmaz',
      idLast4: 'AB12',
      relationship: 'grandparent',
    })
    for (const invalid of [
      { time: '25:00' },
      { time: '9:30' },
      { date: '2026-02-30' },
      { reason: 'other' },
      { reason: 'tatil' },
      { pickup: { kind: 'other', name: 'Hasan', idLast4: '12345678901', relationship: 'other' } },
      { pickup: { kind: 'other', name: 'Hasan', idLast4: '12', relationship: 'other' } },
      { pickup: { kind: 'other', name: 'H', idLast4: '1234', relationship: 'other' } },
      { pickup: { kind: 'guardian', guardianLinkId: 'bağ' } },
      { pickup: { kind: 'unknown' } },
      { identityNumber: '12345678901' },
    ])
      assert.equal(
        earlyDismissalCreateSchema.safeParse({ ...body(), ...invalid }).success,
        false,
        JSON.stringify(invalid),
      )
  })

  test('DOM-FIN-161: velinin talebi onay bekler, "kendisi" kendi bağıdır; okulun açtığı talep onaylı doğar', () => {
    const own = planEarlyDismissal(body(), checks())
    assert.equal(own.status, 'pending')
    assert.equal(own.source, 'guardian')
    assert.equal(own.plannedAt, '2026-10-06T10:40:00.000Z')
    assert.equal(own.dismissalOn, TODAY)
    assert.equal(own.classId, '9-A')
    assert.deepEqual(own.pickup, { kind: 'guardian', guardianLinkId: MOTHER })

    const grandpa = planEarlyDismissal(
      body({ pickup: { kind: 'guardian', guardianLinkId: GRANDPA } }),
      checks({ requester: school }),
    )
    assert.equal(grandpa.status, 'approved')
    assert.equal(grandpa.source, 'school')
    assert.deepEqual(grandpa.pickup, { kind: 'guardian', guardianLinkId: GRANDPA })

    const other = planEarlyDismissal(
      body({
        pickup: { kind: 'other', name: 'Hasan Yılmaz', idLast4: '1234', relationship: 'relative' },
      }),
      checks(),
    )
    assert.equal(other.status, 'pending')
    assert.equal(other.pickup.kind, 'other')
  })

  test('DOM-FIN-161: velayeti olmayan ya da iletişim kısıtlı veli talep edemez; bağı olmayan öğrenci bulunamaz', () => {
    rejects(
      () =>
        planEarlyDismissal(
          body(),
          checks({ requester: { kind: 'guardian', membershipId: 'm-father' } }),
        ),
      'early_dismissal_custody_required',
      'forbidden',
    )
    rejects(
      () =>
        planEarlyDismissal(
          body(),
          checks({ requester: { kind: 'guardian', membershipId: 'm-step' } }),
        ),
      'early_dismissal_custody_required',
      'forbidden',
    )
    rejects(
      () =>
        planEarlyDismissal(
          body(),
          checks({ requester: { kind: 'guardian', membershipId: 'm-yabanci' } }),
        ),
      'early_dismissal_student_not_found',
      'not_found',
    )
    rejects(
      () => planEarlyDismissal(body(), checks({ student: null })),
      'early_dismissal_student_not_found',
      'not_found',
    )
    rejects(
      () => planEarlyDismissal(body(), checks({ student: { active: false, classId: '9-A' } })),
      'early_dismissal_student_inactive',
      'rule',
    )
  })

  test('DOM-FIN-161: teslim alacak kişi yetkili olmalı; okul "kendisi" seçemez', () => {
    for (const id of [FATHER, STEP, '00000000-0000-4000-8000-000000000099'])
      rejects(
        () =>
          planEarlyDismissal(body({ pickup: { kind: 'guardian', guardianLinkId: id } }), checks()),
        'early_dismissal_pickup_not_authorized',
      )
    rejects(
      () => planEarlyDismissal(body(), checks({ requester: school })),
      'early_dismissal_pickup_self_school',
    )
  })

  test('DOM-FIN-161: gün bugün ya da 30 gün içinde; bugünkü saat en çok 30 dakika geçmişte; aynı gün ikinci talep 409', () => {
    rejects(
      () => planEarlyDismissal(body({ date: '2026-10-05' }), checks()),
      'early_dismissal_date_past',
    )
    rejects(
      () => planEarlyDismissal(body({ date: '2026-11-06' }), checks()),
      'early_dismissal_date_too_far',
    )
    assert.equal(
      planEarlyDismissal(body({ date: '2026-11-05' }), checks()).dismissalOn,
      '2026-11-05',
    )
    // İstanbul 11:30 = şimdiden 30 dakika önce: sınırda kabul, 11:29 ret.
    assert.equal(planEarlyDismissal(body({ time: '11:30' }), checks()).status, 'pending')
    rejects(
      () => planEarlyDismissal(body({ time: '11:29' }), checks()),
      'early_dismissal_time_past',
    )
    rejects(
      () => planEarlyDismissal(body(), checks({ activeExists: true })),
      'early_dismissal_exists',
      'conflict',
    )
  })
})

const state = (overrides: Partial<EarlyDismissalState> = {}): EarlyDismissalState => ({
  status: 'approved',
  dismissalOn: TODAY,
  pickupKind: 'guardian',
  pickupIdLast4: null,
  ...overrides,
})
const release = (overrides: Record<string, unknown> = {}) =>
  earlyDismissalReleaseSchema.parse({
    pickup: { kind: 'guardian', guardianLinkId: MOTHER },
    identityVerified: true,
    ...overrides,
  })
const releaseChecks = { now: NOW, links: LINKS, studentId: 's-1' }

describe('DOM-FIN-161: onay, ret ve iptal (K-538)', () => {
  test('DOM-FIN-161: yalnız bekleyen talep onaylanır ve reddedilir; günü geçen onaylanmaz', () => {
    planEarlyDismissalApproval(state({ status: 'pending' }), NOW)
    planEarlyDismissalRejection(state({ status: 'pending' }))
    rejects(() => planEarlyDismissalApproval(state(), NOW), 'early_dismissal_not_pending')
    rejects(() => planEarlyDismissalRejection(state()), 'early_dismissal_not_pending')
    rejects(
      () =>
        planEarlyDismissalApproval(state({ status: 'pending', dismissalOn: '2026-10-05' }), NOW),
      'early_dismissal_expired',
    )
    for (const status of ['rejected', 'cancelled'] as const) {
      rejects(() => planEarlyDismissalApproval(state({ status }), NOW), 'early_dismissal_closed')
      rejects(() => planEarlyDismissalCancel(state({ status })), 'early_dismissal_closed')
    }
    rejects(
      () => planEarlyDismissalCancel(state({ status: 'released' })),
      'early_dismissal_already_released',
    )
    planEarlyDismissalCancel(state({ status: 'pending' }))
    planEarlyDismissalCancel(state())
  })

  test('DOM-FIN-161: ret gerekçesi 5–300 karakter; iptal gerekçesi isteğe bağlı', () => {
    assert.equal(earlyDismissalRejectSchema.safeParse({ reason: 'kısa' }).success, false)
    assert.equal(earlyDismissalRejectSchema.safeParse({ reason: 'x'.repeat(301) }).success, false)
    assert.equal(
      earlyDismissalRejectSchema.parse({ reason: ' Veli aranamadı ' }).reason,
      'Veli aranamadı',
    )
    assert.equal(earlyDismissalCancelSchema.parse({}).reason, null)
    assert.equal(earlyDismissalCancelSchema.parse({ reason: ' ' }).reason, null)
  })
})

describe('DOM-FIN-161: teslim doğrulaması (K-539)', () => {
  test('DOM-FIN-161: kimlik görüldü işareti zorunlu; tam kimlik numarası alınmaz', () => {
    assert.equal(
      earlyDismissalReleaseSchema.safeParse({ ...release(), identityVerified: false }).success,
      false,
    )
    assert.equal(earlyDismissalReleaseSchema.safeParse({ pickup: release().pickup }).success, false)
    assert.equal(
      earlyDismissalReleaseSchema.safeParse({
        ...release(),
        pickup: { kind: 'other', idLast4: '12345678901' },
      }).success,
      false,
    )
  })

  test('DOM-FIN-161: teslim yetkilisine teslim edilir, gerçek çıkış anı kaydedilir', () => {
    assert.deepEqual(planEarlyDismissalRelease(state(), release(), releaseChecks), {
      releasedAt: NOW.toISOString(),
      releasedTo: { kind: 'guardian', guardianLinkId: MOTHER },
    })
    const grandpa = planEarlyDismissalRelease(
      state(),
      release({
        pickup: { kind: 'guardian', guardianLinkId: GRANDPA },
        releasedAt: '2026-10-06T08:45:00.000Z',
      }),
      releaseChecks,
    )
    assert.equal(grandpa.releasedAt, '2026-10-06T08:45:00.000Z')
  })

  test('DOM-FIN-161: yetkisiz kişiye teslim engellenir; kayıtlı olmayan kişi yalnız onaylı ve son dört hanesi eşleşirse alır', () => {
    for (const id of [FATHER, STEP])
      rejects(
        () =>
          planEarlyDismissalRelease(
            state(),
            release({ pickup: { kind: 'guardian', guardianLinkId: id } }),
            releaseChecks,
          ),
        'early_dismissal_pickup_not_authorized',
      )
    rejects(
      () =>
        planEarlyDismissalRelease(
          state(),
          release({ pickup: { kind: 'other', idLast4: '1234' } }),
          releaseChecks,
        ),
      'early_dismissal_pickup_not_authorized',
    )
    const other = state({ pickupKind: 'other', pickupIdLast4: '1234' })
    rejects(
      () =>
        planEarlyDismissalRelease(
          other,
          release({ pickup: { kind: 'other', idLast4: '4321' } }),
          releaseChecks,
        ),
      'early_dismissal_pickup_mismatch',
    )
    assert.deepEqual(
      planEarlyDismissalRelease(
        other,
        release({ pickup: { kind: 'other', idLast4: '1234' } }),
        releaseChecks,
      ).releasedTo,
      { kind: 'other' },
    )
    // Kayıtlı olmayan kişi onaylı olsa da yetkili veli de teslim alabilir.
    assert.equal(
      planEarlyDismissalRelease(other, release(), releaseChecks).releasedTo.kind,
      'guardian',
    )
  })

  test('DOM-FIN-161: yalnız onaylı talep, yalnız çıkış gününde; ikinci teslim yok; gelecek ve başka gün reddedilir', () => {
    rejects(
      () => planEarlyDismissalRelease(state({ status: 'pending' }), release(), releaseChecks),
      'early_dismissal_not_approved',
    )
    rejects(
      () => planEarlyDismissalRelease(state({ status: 'released' }), release(), releaseChecks),
      'early_dismissal_already_released',
    )
    rejects(
      () =>
        planEarlyDismissalRelease(state({ dismissalOn: '2026-10-07' }), release(), releaseChecks),
      'early_dismissal_not_today',
    )
    rejects(
      () =>
        planEarlyDismissalRelease(
          state(),
          release({ releasedAt: '2026-10-06T09:05:00.000Z' }),
          releaseChecks,
        ),
      'early_dismissal_release_future',
    )
    rejects(
      () =>
        planEarlyDismissalRelease(
          state(),
          release({ releasedAt: '2026-10-05T20:00:00.000Z' }),
          releaseChecks,
        ),
      'early_dismissal_release_other_day',
    )
  })

  test('DOM-FIN-161, DOM-ILT-074: teslim yetkilisi velayetli ya da yetkili işaretli, kısıtsız bağdır', () => {
    assert.deepEqual(
      authorizedPickups(LINKS, 's-1').map((item) => item.id),
      [MOTHER, GRANDPA],
    )
    assert.deepEqual(authorizedPickups(LINKS, 's-2'), [])
    assert.equal(
      canPickUpStudent({ custody: 'joint', contactRestricted: false, canPickUp: false }),
      true,
    )
    assert.equal(
      canPickUpStudent({ custody: 'full', contactRestricted: true, canPickUp: true }),
      false,
    )
    assert.equal(maskIdLast4('1234'), '•••• 1234')
    assert.equal(maskIdLast4(null), null)
  })
})

describe('DOM-FIN-161: yoklamaya yansıma (K-540)', () => {
  // 9-A'nın 6 Ekim dersleri İstanbul 08:30'dan 40'ar dakika; 3. ders iptal; 9-B ve ertesi gün ayrı.
  const lesson = (id: string, at: string, extra: Partial<DismissalScheduleLesson> = {}) => ({
    id,
    date: at,
    duration: 40,
    classId: '9-A',
    subjectId: 'mat',
    title: null,
    cancelledAt: null,
    ...extra,
  })
  const LESSONS: DismissalScheduleLesson[] = [
    lesson('l-4', '2026-10-06T08:20:00.000Z', { subjectId: 'fen', title: 'Fen' }),
    lesson('l-1', '2026-10-06T05:30:00.000Z'),
    lesson('l-2', '2026-10-06T06:20:00.000Z'),
    lesson('l-x', '2026-10-06T07:10:00.000Z', { cancelledAt: '2026-10-05T10:00:00.000Z' }),
    lesson('l-3', '2026-10-06T07:30:00.000Z'),
    lesson('l-5', '2026-10-06T09:10:00.000Z', { duration: 0 }),
    lesson('l-b', '2026-10-06T07:30:00.000Z', { classId: '9-B' }),
    lesson('l-ertesi', '2026-10-07T05:30:00.000Z'),
  ]

  test('DOM-FIN-161: çıkıştan sonra biten dersler sırasıyla; ders sırasında çıkışta ders kısmi', () => {
    const effect = dismissalLessonEffects(LESSONS, '9-A', TODAY, '2026-10-06T08:40:00.000Z')
    assert.equal(effect.fromPeriod, 4)
    assert.deepEqual(
      effect.lessons.map((item) => [item.lessonId, item.period, item.partial]),
      [
        ['l-4', 4, true],
        ['l-5', 5, false],
      ],
    )
    assert.equal(effect.lessons[0]?.endsAt, '2026-10-06T09:00:00.000Z')
    // Süresi yazılmamış ders 40 dakika sayılır.
    assert.equal(effect.lessons[1]?.endsAt, '2026-10-06T09:50:00.000Z')
  })

  test('DOM-FIN-161: ders bittikten sonra çıkışta etkilenen ders yok; sınıfsız öğrencide de yok', () => {
    assert.deepEqual(dismissalLessonEffects(LESSONS, '9-A', TODAY, '2026-10-06T10:00:00.000Z'), {
      fromPeriod: null,
      lessons: [],
    })
    assert.deepEqual(dismissalLessonEffects(LESSONS, null, TODAY, '2026-10-06T05:00:00.000Z'), {
      fromPeriod: null,
      lessons: [],
    })
    assert.equal(
      dismissalLessonEffects(LESSONS, '9-A', TODAY, '2026-10-06T05:00:00.000Z').fromPeriod,
      1,
    )
  })

  test('DOM-FIN-161: yansıyan an teslimde gerçek çıkış, onaylıda planlanan saattir; diğerleri yansımaz', () => {
    const planned = plannedInstant(TODAY, '13:40')
    assert.deepEqual(
      dismissalDeparture({ status: 'approved', plannedAt: planned, releasedAt: null }),
      {
        basis: 'planned',
        at: planned,
      },
    )
    assert.deepEqual(
      dismissalDeparture({ status: 'released', plannedAt: planned, releasedAt: NOW.toISOString() }),
      { basis: 'released', at: NOW.toISOString() },
    )
    for (const status of ['pending', 'rejected', 'cancelled'] as const)
      assert.equal(dismissalDeparture({ status, plannedAt: planned, releasedAt: null }), null)
  })
})
