import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  assertHealthScreeningPublish,
  bmiOf,
  healthScreeningHealthSchema,
  healthScreeningReport,
  healthScreeningResultsInputSchema,
  healthScreeningSessionInputSchema,
  healthScreeningSessionUpdateSchema,
  measurementView,
  planHealthScreeningResults,
  planHealthScreeningSession,
  planHealthScreeningSessionUpdate,
  referralVisible,
  thresholdExceeded,
  type ExistingHealthScreeningResult,
  type HealthScreeningSessionValues,
  type HealthScreeningStudent,
} from '../packages/school-core/src/lib/finance-health-screenings.ts'

/** Okul sağlığı taramaları kuralları (DOM-FIN-153; ON-163; K-514…K-516). */

// Europe/Istanbul 2026-10-06 12:00.
const NOW = new Date('2026-10-06T09:00:00.000Z')
const CLASSES = new Set(['9-A', '9-B'])

function rejects(run: () => unknown, code: string, kind: DomainError['kind'] = 'rule') {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof DomainError)
    assert.equal(error.code, code)
    assert.equal(error.kind, kind)
    return true
  })
}

const growthInput = (extra: Record<string, unknown> = {}) =>
  healthScreeningSessionInputSchema.parse({
    kind: 'growth',
    screenedOn: '2026-10-06',
    classIds: ['9-A'],
    performer: { kind: 'external', name: ' ASM hemşiresi ' },
    thresholds: { bmiBelow: 14, bmiAbove: 25 },
    ...extra,
  })

const session = (
  extra: Partial<HealthScreeningSessionValues & { status: 'open' | 'published' }> = {},
) => ({
  status: 'open' as const,
  kind: 'growth' as const,
  screenedOn: '2026-10-06',
  classIds: ['9-A', '9-B'],
  performer: { kind: 'external' as const, name: 'ASM' },
  thresholds: { bmiBelow: 14, bmiAbove: 25 },
  ...extra,
})

const students = new Map<string, HealthScreeningStudent>([
  ['s-1', { classId: '9-A', active: true }],
  ['s-2', { classId: '9-B', active: true }],
  ['s-3', { classId: '10-A', active: true }],
  ['s-4', { classId: '9-A', active: false }],
])

const results = (items: Record<string, unknown>[]) =>
  healthScreeningResultsInputSchema.parse({ results: items })

describe('DOM-FIN-153: birimler ve eşik (K-514)', () => {
  test('BKİ tamsayı birimlerden tek ondalıkla hesaplanır', () => {
    assert.equal(bmiOf(1500, 450), 20)
    assert.equal(bmiOf(1425, 382), 18.8)
    assert.deepEqual(measurementView({ kind: 'growth', heightMm: 1425, weightHg: 382 }), {
      kind: 'growth',
      heightCm: 142.5,
      weightKg: 38.2,
      bmi: 18.8,
    })
    assert.deepEqual(
      measurementView({
        kind: 'vision',
        rightHundredths: 100,
        leftHundredths: 70,
        wearsGlasses: true,
      }),
      { kind: 'vision', rightAcuity: 1, leftAcuity: 0.7, wearsGlasses: true },
    )
  })

  test('eşik yalnız kurumun sınırıdır; eşik yoksa ya da ölçüm yoksa işaret yok', () => {
    const growth = { kind: 'growth' as const, heightMm: 1500, weightHg: 300 } // BKİ 13,3
    assert.equal(thresholdExceeded({ bmiBelow: 14, bmiAbove: null }, growth), true)
    assert.equal(thresholdExceeded({ bmiBelow: null, bmiAbove: 25 }, growth), false)
    assert.equal(
      thresholdExceeded({ bmiBelow: null, bmiAbove: 20 }, { ...growth, weightHg: 600 }),
      true,
    )
    assert.equal(thresholdExceeded({ acuityBelow: 0.8 }, growth), false)
    assert.equal(thresholdExceeded({ bmiBelow: 14, bmiAbove: 25 }, null), false)
    const vision = {
      kind: 'vision' as const,
      rightHundredths: 100,
      leftHundredths: 70,
      wearsGlasses: false,
    }
    assert.equal(thresholdExceeded({ acuityBelow: 0.8 }, vision), true)
    assert.equal(thresholdExceeded({ acuityBelow: 0.7 }, vision), false)
    assert.equal(thresholdExceeded({ acuityBelow: null }, vision), false)
    assert.equal(thresholdExceeded({ bmiBelow: 14, bmiAbove: null }, vision), false)
  })
})

describe('DOM-FIN-153: tarama oturumu (K-514)', () => {
  test('şema: tür, gün, sınıflar, yapan ve türün eşikleri', () => {
    const parsed = growthInput()
    assert.equal(parsed.performer.kind === 'external' && parsed.performer.name, 'ASM hemşiresi')
    assert.deepEqual(
      healthScreeningSessionInputSchema.parse({ ...growthInput(), thresholds: undefined })
        .thresholds,
      { bmiBelow: null, bmiAbove: null },
    )
    const bad = [
      { kind: 'hearing' },
      { classIds: [] },
      { classIds: ['9-A', '9-A'] },
      { thresholds: { bmiBelow: 25, bmiAbove: 14 } },
      { thresholds: { bmiBelow: 14.25, bmiAbove: null } },
      { thresholds: { acuityBelow: 0.8 } },
      { performer: { kind: 'external', name: 'A' } },
      { screenedOn: '2026-02-30' },
      { allergies: 'Fıstık' },
    ]
    for (const extra of bad)
      assert.equal(
        healthScreeningSessionInputSchema.safeParse({
          kind: 'growth',
          screenedOn: '2026-10-06',
          classIds: ['9-A'],
          performer: { kind: 'external', name: 'ASM' },
          ...extra,
        }).success,
        false,
        JSON.stringify(extra),
      )
    assert.equal(
      healthScreeningSessionInputSchema.safeParse({
        kind: 'vision',
        screenedOn: '2026-10-06',
        classIds: ['9-A'],
        performer: { kind: 'staff', membershipId: 'm-1' },
        thresholds: { acuityBelow: 0.8 },
      }).success,
      true,
    )
  })

  test('gün penceresi, sınıf ve personel denetimi', () => {
    const values = planHealthScreeningSession(growthInput(), { now: NOW, classIds: CLASSES })
    assert.equal(values.screenedOn, '2026-10-06')
    rejects(
      () =>
        planHealthScreeningSession(growthInput({ screenedOn: '2026-04-08' }), {
          now: NOW,
          classIds: CLASSES,
        }),
      'health_screening_date_too_old',
    )
    planHealthScreeningSession(growthInput({ screenedOn: '2026-04-09' }), {
      now: NOW,
      classIds: CLASSES,
    })
    rejects(
      () =>
        planHealthScreeningSession(growthInput({ screenedOn: '2027-01-05' }), {
          now: NOW,
          classIds: CLASSES,
        }),
      'health_screening_date_too_far',
    )
    rejects(
      () =>
        planHealthScreeningSession(growthInput({ classIds: ['9-A', '12-Z'] }), {
          now: NOW,
          classIds: CLASSES,
        }),
      'health_screening_class_not_found',
    )
    const staffInput = growthInput({ performer: { kind: 'staff', membershipId: 'm-1' } })
    rejects(
      () =>
        planHealthScreeningSession(staffInput, { now: NOW, classIds: CLASSES, performer: null }),
      'health_screening_performer_not_found',
    )
    rejects(
      () =>
        planHealthScreeningSession(staffInput, {
          now: NOW,
          classIds: CLASSES,
          performer: { role: 'veli', active: true },
        }),
      'health_screening_performer_not_staff',
    )
    rejects(
      () =>
        planHealthScreeningSession(staffInput, {
          now: NOW,
          classIds: CLASSES,
          performer: { role: 'onburo', active: false },
        }),
      'health_screening_performer_inactive',
    )
    planHealthScreeningSession(staffInput, {
      now: NOW,
      classIds: CLASSES,
      performer: { role: 'onburo', active: true },
    })
  })

  test('düzeltme: değişen alanlar; sonuç varken eşik, gün ve sonuçlu sınıf kilitli', () => {
    const current = session()
    const checks = {
      now: NOW,
      classIds: new Set(['9-A', '9-B', '10-A']),
      resultCount: 0,
      classesWithResults: new Set<string>(),
    }
    const patch = (value: Record<string, unknown>) =>
      healthScreeningSessionUpdateSchema.parse(value)
    assert.equal(healthScreeningSessionUpdateSchema.safeParse({}).success, false)
    const updated = planHealthScreeningSessionUpdate(
      current,
      patch({ screenedOn: '2026-10-20', thresholds: { bmiBelow: 13, bmiAbove: null } }),
      checks,
    )
    assert.deepEqual(updated.changed, ['screenedOn', 'thresholds'])
    rejects(
      () => planHealthScreeningSessionUpdate(current, patch({ screenedOn: '2026-10-06' }), checks),
      'health_screening_unchanged',
    )
    rejects(
      () =>
        planHealthScreeningSessionUpdate(
          current,
          patch({ thresholds: { acuityBelow: 0.8 } }),
          checks,
        ),
      'health_screening_thresholds_kind',
    )
    rejects(
      () =>
        planHealthScreeningSessionUpdate(
          { ...current, status: 'published' },
          patch({ screenedOn: '2026-10-05' }),
          checks,
        ),
      'health_screening_published',
      'conflict',
    )
    const withResults = { ...checks, resultCount: 2, classesWithResults: new Set(['9-A']) }
    rejects(
      () =>
        planHealthScreeningSessionUpdate(
          current,
          patch({ thresholds: { bmiBelow: 13, bmiAbove: 25 } }),
          withResults,
        ),
      'health_screening_thresholds_locked',
    )
    rejects(
      () =>
        planHealthScreeningSessionUpdate(current, patch({ screenedOn: '2026-10-07' }), withResults),
      'health_screening_date_locked',
    )
    rejects(
      () => planHealthScreeningSessionUpdate(current, patch({ classIds: ['9-B'] }), withResults),
      'health_screening_class_has_results',
    )
    rejects(
      () =>
        planHealthScreeningSessionUpdate(
          current,
          patch({ classIds: ['9-A', '9-B', '11-Z'] }),
          withResults,
        ),
      'health_screening_class_not_found',
    )
    assert.deepEqual(
      planHealthScreeningSessionUpdate(current, patch({ classIds: ['9-A', '10-A'] }), withResults)
        .changed,
      ['classIds'],
    )
    rejects(
      () =>
        planHealthScreeningSessionUpdate(
          current,
          patch({ performer: { kind: 'staff', membershipId: 'm-9' } }),
          { ...checks, performer: null },
        ),
      'health_screening_performer_not_found',
    )
  })
})

describe('DOM-FIN-153: sonuç girişi (K-514)', () => {
  const checks = (existing = new Map<string, ExistingHealthScreeningResult>()) => ({
    now: NOW,
    students,
    existing,
  })

  test('şema: ölçüm birimleri, tek öğrenci, en çok 100 satır', () => {
    assert.equal(
      healthScreeningResultsInputSchema.safeParse({
        results: [
          { studentId: 's-1', outcome: 'screened' },
          { studentId: 's-1', outcome: 'absent' },
        ],
      }).success,
      false,
    )
    for (const measurement of [
      { heightCm: 142.55, weightKg: 38 },
      { heightCm: 30, weightKg: 38 },
      { heightCm: 140, weightKg: 300 },
      { rightAcuity: 1.234, leftAcuity: 1, wearsGlasses: false },
      { rightAcuity: 1, leftAcuity: 1 },
      { heightCm: 140, weightKg: 38, bmi: 19 },
    ])
      assert.equal(
        healthScreeningResultsInputSchema.safeParse({
          results: [{ studentId: 's-1', outcome: 'screened', measurement }],
        }).success,
        false,
        JSON.stringify(measurement),
      )
    assert.equal(
      healthScreeningResultsInputSchema.safeParse({
        results: Array.from({ length: 101 }, (_, i) => ({
          studentId: `s-${String(i)}`,
          outcome: 'absent',
        })),
      }).success,
      false,
    )
    const parsed = results([{ studentId: 's-1', outcome: 'absent', note: '  ' }])
    assert.equal(parsed.results[0]?.note, null)
    assert.equal(parsed.results[0]?.referralRecommended, false)
  })

  test('yeni sonuç: hedef sınıftaki etkin öğrenci; eşik aşılırsa işaret konur', () => {
    const plan = planHealthScreeningResults(
      session(),
      results([
        {
          studentId: 's-1',
          outcome: 'screened',
          measurement: { heightCm: 150, weightKg: 30 },
          note: 'Beslenme',
        },
        { studentId: 's-2', outcome: 'screened', measurement: { heightCm: 150, weightKg: 45 } },
      ]),
      checks(),
    )
    assert.equal(plan.unchanged, 0)
    assert.deepEqual(
      plan.writes.map((item) => [item.studentId, item.kind, item.referralRecommended]),
      [
        ['s-1', 'create', true],
        ['s-2', 'create', false],
      ],
    )
    const first = plan.writes[0]
    assert.ok(first?.kind === 'create')
    assert.equal(first.classId, '9-A')
    assert.deepEqual(first.health, {
      measurement: { kind: 'growth', heightMm: 1500, weightHg: 300 },
      note: 'Beslenme',
    })
    assert.equal(healthScreeningHealthSchema.safeParse(first.health).success, true)
    const manual = planHealthScreeningResults(
      session(),
      results([
        {
          studentId: 's-2',
          outcome: 'screened',
          measurement: { heightCm: 150, weightKg: 45 },
          referralRecommended: true,
        },
      ]),
      checks(),
    )
    assert.equal(manual.writes[0]?.referralRecommended, true)
  })

  test('ret: oturum, gün, öğrenci, sınıf, ölçüm türü ve katılmayanın ölçümü', () => {
    const one = (item: Record<string, unknown>) => results([item])
    const screened = {
      studentId: 's-1',
      outcome: 'screened',
      measurement: { heightCm: 150, weightKg: 45 },
    }
    rejects(
      () => planHealthScreeningResults(session({ status: 'published' }), one(screened), checks()),
      'health_screening_published',
      'conflict',
    )
    rejects(
      () =>
        planHealthScreeningResults(session({ screenedOn: '2026-10-07' }), one(screened), checks()),
      'health_screening_not_started',
    )
    rejects(
      () => planHealthScreeningResults(session(), one({ ...screened, studentId: 's-9' }), checks()),
      'health_screening_student_not_found',
    )
    rejects(
      () => planHealthScreeningResults(session(), one({ ...screened, studentId: 's-4' }), checks()),
      'health_screening_student_not_found',
    )
    rejects(
      () => planHealthScreeningResults(session(), one({ ...screened, studentId: 's-3' }), checks()),
      'health_screening_student_not_in_classes',
    )
    rejects(
      () =>
        planHealthScreeningResults(
          session(),
          one({ ...screened, measurement: { rightAcuity: 1, leftAcuity: 1, wearsGlasses: false } }),
          checks(),
        ),
      'health_screening_measurement_kind',
    )
    rejects(
      () =>
        planHealthScreeningResults(
          session({ kind: 'vision', thresholds: { acuityBelow: 0.8 } }),
          one(screened),
          checks(),
        ),
      'health_screening_measurement_kind',
    )
    rejects(
      () =>
        planHealthScreeningResults(
          session(),
          one({ studentId: 's-1', outcome: 'screened' }),
          checks(),
        ),
      'health_screening_measurement_required',
    )
    rejects(
      () =>
        planHealthScreeningResults(session(), one({ ...screened, outcome: 'absent' }), checks()),
      'health_screening_measurement_not_allowed',
    )
    rejects(
      () =>
        planHealthScreeningResults(
          session(),
          one({ studentId: 's-1', outcome: 'refused', referralRecommended: true }),
          checks(),
        ),
      'health_screening_referral_not_screened',
    )
    rejects(
      () =>
        planHealthScreeningResults(session(), one({ ...screened, expectedVersion: 1 }), checks()),
      'health_screening_result_missing',
      'conflict',
    )
  })

  test('öğrenci başına tek sonuç: var olan sonuç yalnız sürümle düzeltilir; aynısı yazılmaz', () => {
    const existing = new Map<string, ExistingHealthScreeningResult>([
      [
        's-1',
        {
          id: 'r-1',
          version: 2,
          outcome: 'absent',
          referralRecommended: false,
          health: { measurement: null, note: null },
        },
      ],
    ])
    rejects(
      () =>
        planHealthScreeningResults(
          session(),
          results([{ studentId: 's-1', outcome: 'absent' }]),
          checks(existing),
        ),
      'health_screening_result_exists',
      'conflict',
    )
    rejects(
      () =>
        planHealthScreeningResults(
          session(),
          results([{ studentId: 's-1', outcome: 'absent', expectedVersion: 1 }]),
          checks(existing),
        ),
      'version_conflict',
      'conflict',
    )
    const same = planHealthScreeningResults(
      session(),
      results([{ studentId: 's-1', outcome: 'absent', expectedVersion: 2 }]),
      checks(existing),
    )
    assert.deepEqual(same, { writes: [], unchanged: 1 })
    // Sınıf değiştirmiş öğrencinin var olan sonucu düzeltilir.
    const moved = new Map(students)
    moved.set('s-1', { classId: '10-A', active: true })
    const updated = planHealthScreeningResults(
      session(),
      results([
        {
          studentId: 's-1',
          outcome: 'screened',
          expectedVersion: 2,
          measurement: { heightCm: 150, weightKg: 45 },
        },
      ]),
      { now: NOW, students: moved, existing },
    )
    assert.equal(updated.writes[0]?.kind, 'update')
    assert.equal(updated.writes[0]?.kind === 'update' && updated.writes[0].expectedVersion, 2)
  })
})

describe('DOM-FIN-153: yayımlama ve sınıf raporu (K-515, K-516)', () => {
  test('yayımlama açık, günü gelmiş ve sonuçlu oturumda', () => {
    const base = { status: 'open' as const, screenedOn: '2026-10-06', resultCount: 1, now: NOW }
    assertHealthScreeningPublish(base)
    rejects(
      () => assertHealthScreeningPublish({ ...base, status: 'published' }),
      'health_screening_published',
      'conflict',
    )
    rejects(
      () => assertHealthScreeningPublish({ ...base, screenedOn: '2026-10-07' }),
      'health_screening_not_started',
    )
    rejects(
      () => assertHealthScreeningPublish({ ...base, resultCount: 0 }),
      'health_screening_no_results',
    )
  })

  test('küçük grup kuralı: taranan < 5, öneri 1–4 ya da önerilmeyen 1–4 gizli', () => {
    assert.equal(referralVisible(4, 0), false)
    assert.equal(referralVisible(5, 0), true)
    assert.equal(referralVisible(10, 3), false)
    assert.equal(referralVisible(10, 5), true)
    assert.equal(referralVisible(10, 8), false)
    assert.equal(referralVisible(10, 10), true)
  })

  test('rapor: katılım açık, öneri gizli; tek gizli sınıfta toplam da gizli', () => {
    const ids = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, i) => `${prefix}${String(i)}`)
    const screened = (studentIds: string[], referred: number) =>
      studentIds.map((studentId, index) => ({
        studentId,
        outcome: 'screened' as const,
        referralRecommended: index < referred,
      }))
    const a = ids('a', 12)
    const b = ids('b', 8)
    const c = ids('c', 10)
    const report = healthScreeningReport([
      { classId: '9-A', rosterStudentIds: a, results: screened(a.slice(0, 10), 5) },
      {
        classId: '9-B',
        rosterStudentIds: b,
        results: [
          ...screened(b.slice(0, 6), 2),
          { studentId: 'b6', outcome: 'absent', referralRecommended: false },
          { studentId: 'b7', outcome: 'refused', referralRecommended: false },
        ],
      },
      { classId: '9-C', rosterStudentIds: c, results: screened(c, 0) },
    ])
    assert.deepEqual(report.classes[0], {
      classId: '9-A',
      roster: 12,
      screened: 10,
      absent: 0,
      refused: 0,
      missing: 2,
      referral: 5,
      referralSuppressed: false,
    })
    assert.equal(report.classes[1]?.referral, null)
    assert.equal(report.classes[1]?.referralSuppressed, true)
    assert.equal(report.classes[1]?.absent, 1)
    assert.equal(report.classes[1]?.refused, 1)
    assert.equal(report.classes[2]?.referral, 0)
    assert.equal(report.total.screened, 26)
    assert.equal(report.total.referral, null, 'tek gizli sınıf toplamdan çıkarılamaz')

    const two = healthScreeningReport([
      { classId: '9-A', rosterStudentIds: a, results: screened(a, 6) },
      { classId: '9-B', rosterStudentIds: b, results: screened(b, 2) },
      { classId: '9-C', rosterStudentIds: c, results: screened(c, 3) },
    ])
    assert.equal(two.total.referral, 11)
    assert.equal(two.total.referralSuppressed, false)
    assert.deepEqual(healthScreeningReport([]).total, {
      roster: 0,
      screened: 0,
      absent: 0,
      refused: 0,
      missing: 0,
      referral: null,
      referralSuppressed: true,
    })
  })
})
