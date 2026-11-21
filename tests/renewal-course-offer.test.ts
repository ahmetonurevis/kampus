import assert from 'node:assert/strict'
import test from 'node:test'

import type { ProgressionDecisionRecord } from '../packages/school-core/src/cefr/progression.ts'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import type { EnrollmentTariff } from '../packages/school-core/src/lib/enrollment.ts'
import {
  assertCourseOfferReady,
  renewalCourseOffer,
  type CourseOfferCourse,
  type CourseOfferEnrollment,
} from '../packages/school-core/src/lib/renewal-course-offer.ts'
import {
  planRenewal,
  quoteRenewal,
  type RenewalContext,
} from '../packages/school-core/src/lib/renewals.ts'

import { isDomainError } from './support/domain-error.ts'

/**
 * Dil okulu yenileme teklifi kur sonu kararından başlar (DOM-DIL-070, DOM-DIL-007; ON-295, #30).
 * Teklif son kurun geçerli kararını `progressionNextStep` ile okur; onaysız kararda önizleme açılır,
 * plan yazılmaz.
 */

const NOW = '2026-10-06T09:00:00.000Z'
const STUDENT = 'test-st1'
const A2: CourseOfferCourse = { id: 'test-course-a2', level: 'A2', nextCourseId: 'test-course-b1' }
const B1: CourseOfferCourse = { id: 'test-course-b1', level: 'B1', nextCourseId: null }
const C2: CourseOfferCourse = { id: 'test-course-c2', level: 'C2', nextCourseId: null }
const COURSES = [A2, B1, C2]

const enrollment = (over: Partial<CourseOfferEnrollment> = {}): CourseOfferEnrollment => ({
  id: 'test-enr-a2',
  studentId: STUDENT,
  courseId: A2.id,
  startDate: '2026-02-01',
  cancelled: false,
  ...over,
})

/** Kur sonu karar satırı; teklif yalnız kimlik, kayıt, sonuç ve durum alanlarını okur. */
const decision = (over: Partial<ProgressionDecisionRecord> = {}): ProgressionDecisionRecord => ({
  id: 'test-pd1',
  enrollmentId: 'test-enr-a2',
  learnerId: STUDENT,
  courseId: A2.id,
  outcome: 'passed',
  status: 'approved',
  rationale: 'Dört beceride eşik aşıldı.',
  correctsDecisionId: null,
  decidedByUserId: 'test-u-teacher',
  decidedAt: '2026-06-01T09:00:00.000Z',
  reviewedByUserId: 'test-u-coord',
  reviewedAt: '2026-06-02T09:00:00.000Z',
  rejectionReason: null,
  basis: {} as ProgressionDecisionRecord['basis'],
  evidenceSnapshot: {} as ProgressionDecisionRecord['evidenceSnapshot'],
  ...over,
})

const offer = (
  decisions: readonly ProgressionDecisionRecord[],
  over: { enrollments?: CourseOfferEnrollment[]; courses?: CourseOfferCourse[] } = {},
) =>
  renewalCourseOffer({
    studentId: STUDENT,
    enrollments: over.enrollments ?? [enrollment()],
    courses: over.courses ?? COURSES,
    decisions,
  })

test('DOM-DIL-070, DOM-DIL-007: onaylı geçti kararında teklif sonraki kura ve onun seviyesine açılır', () => {
  assert.deepEqual(offer([decision()]), {
    status: 'ready',
    decisionId: 'test-pd1',
    outcome: 'passed',
    fromCourseId: A2.id,
    fromLevel: 'A2',
    courseId: B1.id,
    level: 'B1',
  })
})

test('DOM-DIL-070: zincirsiz kurda geçti kararı bir üst seviyeye açılır, kur seçimi kayda kalır', () => {
  const result = offer([decision({ enrollmentId: 'test-enr-b1', courseId: B1.id })], {
    enrollments: [enrollment({ id: 'test-enr-b1', courseId: B1.id })],
  })
  assert.equal(result.status, 'ready')
  assert.equal(result.courseId, null)
  assert.equal(result.level, 'B1+')
})

test('DOM-DIL-070, DOM-DIL-071: tekrar ve devamsızlık kararında teklif aynı kur ve seviyede kalır', () => {
  for (const outcome of ['repeat', 'incomplete_attendance'] as const) {
    const result = offer([decision({ outcome })])
    assert.equal(result.status, 'ready', outcome)
    assert.equal(result.outcome, outcome)
    assert.equal(result.courseId, A2.id)
    assert.equal(result.level, 'A2')
    assert.doesNotThrow(() => assertCourseOfferReady(result))
  }
})

test('DOM-DIL-070: onay bekleyen karar ve bekleyen düzeltme teklifi bekletir; plan reddedilir', () => {
  const pending = offer([decision({ status: 'pending', reviewedAt: null, reviewedByUserId: null })])
  assert.equal(pending.status, 'pending')
  assert.equal(pending.decisionId, 'test-pd1')
  assert.equal(pending.level, null)
  assert.throws(
    () => assertCourseOfferReady(pending),
    (error: Error & { code?: string; kind?: string }) =>
      error.code === 'course_decision_pending' &&
      error.kind === 'rule' &&
      error.message === 'Kur sonu kararı onay bekliyor; karar onaylanmadan yenileme planlanamaz.',
  )
  // Onaylı geçti kararının bekleyen düzeltmesi sonucu değiştirebilir: teklif yine bekler.
  const fix = decision({
    id: 'test-pd2',
    outcome: 'repeat',
    status: 'pending',
    correctsDecisionId: 'test-pd1',
  })
  assert.equal(offer([decision(), fix]).status, 'pending')
  // Onaylanan düzeltme öncekinin yerine geçer: tekrar kararı aynı seviyeye açar.
  const approvedFix = offer([decision(), { ...fix, status: 'approved' }])
  assert.equal(approvedFix.decisionId, 'test-pd2')
  assert.equal(approvedFix.level, 'A2')
})

test('DOM-DIL-070: kararsız, yalnız reddedilmiş ya da kursuz kursiyerde teklif karar yok olarak işaretlenir', () => {
  for (const decisions of [[], [decision({ status: 'rejected' })]]) {
    const result = offer(decisions)
    assert.equal(result.status, 'missing')
    assert.equal(result.fromCourseId, A2.id)
    assert.throws(() => assertCourseOfferReady(result), isDomainError('course_decision_missing'))
  }
  assert.deepEqual(offer([decision()], { enrollments: [] }), {
    status: 'missing',
    decisionId: null,
    outcome: null,
    fromCourseId: null,
    fromLevel: null,
    courseId: null,
    level: null,
  })
  // Kur okunamıyorsa (başka kurumun ya da arşivlenmiş kur) dayanak yoktur.
  assert.equal(offer([decision()], { courses: [] }).status, 'missing')
})

test('DOM-DIL-070: C2 geçti ya da sonraki kur okunamıyorsa teklif üst seviye yok olarak reddedilir', () => {
  const top = offer([decision({ enrollmentId: 'test-enr-c2', courseId: C2.id })], {
    enrollments: [enrollment({ id: 'test-enr-c2', courseId: C2.id })],
  })
  assert.equal(top.status, 'no_next_level')
  assert.throws(() => assertCourseOfferReady(top), isDomainError('course_next_level_missing'))
  assert.equal(offer([decision()], { courses: [A2] }).status, 'no_next_level')
})

test('DOM-DIL-070: son kur en geç başlayan, iptal edilmemiş gruptur; önceki kurun kararı sayılmaz', () => {
  const enrollments = [
    enrollment(),
    enrollment({ id: 'test-enr-b1', courseId: B1.id, startDate: '2026-09-01' }),
    enrollment({ id: 'test-enr-c2', courseId: C2.id, startDate: '2026-12-01', cancelled: true }),
  ]
  // A2'nin geçti kararı B1 kaydına teklif açmaz: B1'in kararı henüz yok.
  assert.equal(offer([decision()], { enrollments }).status, 'missing')
  const b1 = decision({ id: 'test-pd-b1', enrollmentId: 'test-enr-b1', courseId: B1.id })
  const result = offer([decision(), b1], { enrollments })
  assert.equal(result.decisionId, 'test-pd-b1')
  assert.equal(result.level, 'B1+')
})

test('DOM-DIL-070: başka kursiyerin kaydı ve kararı teklife girmez', () => {
  const other = 'test-st-baska'
  const result = renewalCourseOffer({
    studentId: STUDENT,
    enrollments: [
      enrollment(),
      enrollment({ id: 'test-enr-baska', studentId: other, startDate: '2026-12-01' }),
    ],
    courses: COURSES,
    decisions: [
      decision({ id: 'test-pd-baska', learnerId: other }),
      decision({ id: 'test-pd-baska2', enrollmentId: 'test-enr-baska', learnerId: other }),
    ],
  })
  assert.equal(result.status, 'missing')
  assert.equal(result.fromCourseId, A2.id)
})

// --- Yenileme planına bağlanması ---------------------------------------------------------------

const YEAR = 2027
const TARIFF: EnrollmentTariff = {
  id: 'test-tariff',
  versionNumber: 1,
  items: [
    {
      kind: 'tuition',
      level: null,
      amountCents: 3_000_000,
      unit: 'year',
      vatBasisPoints: 1000,
      vatEffectiveDate: '2026-01-01',
      announcedAmountCents: null,
    },
  ],
  discounts: [],
}
const CONTEXT: RenewalContext = {
  tariff: TARIFF,
  previousTariff: null,
  priceIndexes: [{ academicYear: YEAR, ppiBasisPoints: 4_000, cpiBasisPoints: 3_000 }],
}
const QUOTE = { studentId: 's3', targetClassId: 'c1', academicYear: YEAR, installmentCount: 2 }
const PLAN = { ...QUOTE, mode: 'renew', tariffId: TARIFF.id, firstDueDate: '2027-01-31' }
const ADMIN = { role: 'yonetici' } as const

function makeIds() {
  let serial = 0
  return (prefix: string) => `${prefix}-test-${String(++serial)}`
}
const plan = (state: State, context: RenewalContext) =>
  planRenewal(state, ADMIN, PLAN, makeIds(), NOW, { ...context, approvedByUserId: 'u-test' })

test('DOM-DIL-070: onay bekleyen kararda önizleme işaretli açılır, plan Türkçe iletiyle reddedilir ve kayıt değişmez', () => {
  const state = createSeed(new Date(NOW))
  const pending = offer([decision({ status: 'pending' })])
  const context = { ...CONTEXT, courseOffer: pending }
  const quote = quoteRenewal(state, ADMIN, QUOTE, context)
  assert.equal(quote.courseOffer?.status, 'pending')
  assert.ok(quote.netCents > 0)
  const before = structuredClone(state)
  assert.throws(() => plan(state, context), isDomainError('course_decision_pending'))
  assert.deepEqual(state, before)
})

test('DOM-DIL-070: onaylı kararda plan yazılır, teklifin dayanağı ücret kararında kalır', () => {
  const state = createSeed(new Date(NOW))
  const ready = offer([decision()])
  const made = plan(state, { ...CONTEXT, courseOffer: ready })
  assert.ok(made.renewal.mode === 'renew')
  assert.deepEqual(made.renewal.pricing?.courseOffer, ready)
})

test('DOM-DIL-070: okul kurumunda teklif kurdan bağımsızdır; dayanak yok, plan değişmez', () => {
  const state = createSeed(new Date(NOW))
  assert.equal(quoteRenewal(state, ADMIN, QUOTE, CONTEXT).courseOffer, null)
  const made = plan(state, { ...CONTEXT, courseOffer: null })
  assert.ok(made.renewal.mode === 'renew')
  assert.ok(made.renewal.pricing)
  assert.equal('courseOffer' in made.renewal.pricing, false)
})
