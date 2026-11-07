import assert from 'node:assert/strict'
import test from 'node:test'

import type { ProgressionDecisionRecord } from '../packages/school-core/src/cefr/progression.ts'
import type { EnrollmentTariff } from '../packages/school-core/src/lib/enrollment.ts'
import {
  packageTariffPrice,
  type LessonPackage,
} from '../packages/school-core/src/lib/finance-packages.ts'
import {
  COURSE_OFFER_PACKAGE_MISSING,
  courseOfferRows,
  type CourseOfferListCourse,
  type CourseOfferSale,
  type CourseOfferStudent,
} from '../packages/school-core/src/lib/renewal-course-offer-list.ts'
import type { CourseOfferEnrollment } from '../packages/school-core/src/lib/renewal-course-offer.ts'

import { isDomainError } from './support/domain-error.ts'

/**
 * Kur yenileme ve üst kur teklif listesi (IST-088, ON-082; DOM-DIL-070, DOM-DIL-071, DOM-DIL-050,
 * DOM-FIN-020). Satır son kurun geçerli onaylı kararından gelir (`renewalCourseOffer`, ON-295);
 * fiyat kurum tarifesinin saat ücretidir, indirim yoktur.
 */

const HOURLY = 50_000
const TARIFF: Pick<EnrollmentTariff, 'items'> = {
  items: [
    {
      kind: 'tuition',
      level: null,
      amountCents: HOURLY,
      unit: 'lesson_hour',
      announcedAmountCents: null,
      vatBasisPoints: 1000,
      vatEffectiveDate: '2026-01-01',
    },
  ],
}

const course = (over: Partial<CourseOfferListCourse> & { id: string }): CourseOfferListCourse => ({
  name: over.id,
  level: 'A2',
  nextCourseId: null,
  totalHours: 48,
  status: 'active',
  ...over,
})
const A2 = course({ id: 'test-a2', name: 'Genel İngilizce A2', nextCourseId: 'test-b1' })
const B1 = course({ id: 'test-b1', name: 'Genel İngilizce B1', level: 'B1', totalHours: 60 })
const C2 = course({ id: 'test-c2', name: 'Genel İngilizce C2', level: 'C2' })
const COURSES = [A2, B1, C2]

const pkg = (over: Partial<LessonPackage> & { id: string }): LessonPackage => ({
  kind: 'course',
  name: over.id,
  courseId: null,
  level: null,
  lessonHours: null,
  hourlyCents: null,
  validityDays: null,
  ...over,
})
const B1_PACKAGE = pkg({ id: 'test-pkg-b1', name: 'B1 kur ücreti', courseId: B1.id })
const A2_PACKAGE = pkg({ id: 'test-pkg-a2', name: 'A2 kur ücreti', courseId: A2.id })
const PACKAGES = [A2_PACKAGE, B1_PACKAGE]

const student = (id: string, name: string, isActive = true): CourseOfferStudent => ({
  id,
  name,
  isActive,
})
const enrollment = (studentId: string, courseId = A2.id): CourseOfferEnrollment => ({
  id: `test-enr-${studentId}`,
  studentId,
  courseId,
  startDate: '2026-02-01',
  cancelled: false,
})
const APPROVED_AT = '2026-06-02T09:00:00.000Z'
const decision = (
  learnerId: string,
  over: Partial<ProgressionDecisionRecord> = {},
): ProgressionDecisionRecord => ({
  id: `test-pd-${learnerId}`,
  enrollmentId: `test-enr-${learnerId}`,
  learnerId,
  courseId: A2.id,
  outcome: 'passed',
  status: 'approved',
  rationale: 'Öğretmenin gizli notu: konuşmada çekingen.',
  correctsDecisionId: null,
  decidedByUserId: 'test-u-teacher',
  decidedAt: '2026-06-01T09:00:00.000Z',
  reviewedByUserId: 'test-u-coord',
  reviewedAt: APPROVED_AT,
  rejectionReason: null,
  basis: {} as ProgressionDecisionRecord['basis'],
  evidenceSnapshot: {} as ProgressionDecisionRecord['evidenceSnapshot'],
  ...over,
})

function rows(
  over: Partial<Parameters<typeof courseOfferRows>[0]> & {
    decisions: ProgressionDecisionRecord[]
  },
) {
  return courseOfferRows({
    students: [student('test-st1', 'Deniz Yılmaz')],
    enrollments: [enrollment('test-st1')],
    courses: COURSES,
    packages: PACKAGES,
    sales: [],
    tariff: TARIFF,
    ...over,
  })
}

test('IST-088, DOM-DIL-070, DOM-DIL-050: onaylı geçti kararında teklif sonraki kura, tarife fiyatıyla açılır', () => {
  const [row, ...rest] = rows({ decisions: [decision('test-st1')] })
  assert.equal(rest.length, 0)
  assert.deepEqual(row, {
    studentId: 'test-st1',
    studentName: 'Deniz Yılmaz',
    status: 'ready',
    decisionId: 'test-pd-test-st1',
    outcome: 'passed',
    approvedAt: APPROVED_AT,
    fromCourseId: A2.id,
    fromCourseName: 'Genel İngilizce A2',
    fromLevel: 'A2',
    courseId: B1.id,
    courseName: 'Genel İngilizce B1',
    level: 'B1',
    options: [
      {
        packageId: B1_PACKAGE.id,
        packageName: 'B1 kur ücreti',
        kind: 'course',
        hours: 60,
        announcedCents: 60 * HOURLY,
        priceCents: 60 * HOURLY,
      },
    ],
    saleId: null,
    problem: null,
  })
  // Kararın gerekçesi, dayanağı ve öğretmen notu teklif satırına girmez.
  assert.doesNotMatch(JSON.stringify(row), /gizli notu|rationale|basis|evidence/)
})

test('DOM-DIL-071: tekrar ve devamsızlık kararında teklif aynı kur ve seviyede kalır', () => {
  for (const outcome of ['repeat', 'incomplete_attendance'] as const) {
    const [row] = rows({ decisions: [decision('test-st1', { outcome })] })
    assert.equal(row?.status, 'ready', outcome)
    assert.equal(row.outcome, outcome)
    assert.equal(row.courseId, A2.id)
    assert.equal(row.level, 'A2')
    assert.deepEqual(
      row.options.map((option) => option.packageId),
      [A2_PACKAGE.id],
    )
  }
})

test('DOM-DIL-070: onay bekleyen, reddedilen ya da verilmemiş karar listeye girmez', () => {
  const pending = decision('test-st1', { status: 'pending', reviewedAt: null })
  const rejected = decision('test-st1', { status: 'rejected' })
  for (const decisions of [[pending], [rejected], []]) assert.deepEqual(rows({ decisions }), [])
  // Onaylı kararın bekleyen düzeltmesi sonucu değiştirebilir: teklif onayı bekler.
  const fix = decision('test-st1', {
    id: 'test-pd-fix',
    outcome: 'repeat',
    status: 'pending',
    correctsDecisionId: 'test-pd-test-st1',
    reviewedAt: null,
  })
  assert.deepEqual(rows({ decisions: [decision('test-st1'), fix] }), [])
})

test('DOM-DIL-070: C2 geçti kararında üst seviye yok; satır görünür, teklif açılmaz', () => {
  const [row] = rows({
    enrollments: [enrollment('test-st1', C2.id)],
    decisions: [decision('test-st1', { courseId: C2.id })],
  })
  assert.equal(row?.status, 'no_next_level')
  assert.equal(row.level, null)
  assert.deepEqual(row.options, [])
  assert.equal(row.problem?.code, 'course_next_level_missing')
})

test('DOM-DIL-070, DOM-DIL-050: zincirsiz kurdan geçişte teklif bir üst seviyenin paketlerine açılır', () => {
  const hours = pkg({ id: 'test-pkg-b1p', kind: 'hours', name: 'B1+ saat', level: 'B1+' })
  const hoursOther = pkg({ id: 'test-pkg-b2', kind: 'hours', name: 'B2 saat', level: 'B2' })
  const [row] = rows({
    enrollments: [enrollment('test-st1', B1.id)],
    decisions: [decision('test-st1', { courseId: B1.id })],
    packages: [...PACKAGES, { ...hours, lessonHours: 30, hourlyCents: 40_000 }, hoursOther],
  })
  assert.equal(row?.courseId, null)
  assert.equal(row.level, 'B1+')
  // İlan altı saat ücreti fiyatı düşürür; ilan fiyatı ayrıca görünür.
  assert.deepEqual(row.options, [
    {
      packageId: 'test-pkg-b1p',
      packageName: 'B1+ saat',
      kind: 'hours',
      hours: 30,
      announcedCents: 30 * HOURLY,
      priceCents: 30 * 40_000,
    },
  ])
})

test('DOM-FIN-002, DOM-DIL-050: tarife, paket ya da etkin kur yoksa satır nedeni söyler', () => {
  const decisions = [decision('test-st1')]
  assert.equal(rows({ decisions, tariff: null })[0]?.problem?.code, 'tariff_not_published')
  const none = rows({ decisions, packages: [A2_PACKAGE] })[0]
  assert.deepEqual(none?.problem, {
    code: 'course_offer_package_missing',
    message: COURSE_OFFER_PACKAGE_MISSING,
  })
  const draft = rows({ decisions, courses: [A2, { ...B1, status: 'draft' }, C2] })[0]
  assert.equal(draft?.problem?.code, 'package_course_inactive')
  assert.deepEqual(draft.options, [])
  const above = rows({ decisions, packages: [{ ...B1_PACKAGE, hourlyCents: HOURLY + 1 }] })[0]
  assert.equal(above?.problem?.code, 'package_above_tariff')
  const noLevel = rows({ decisions, tariff: { items: [] } })[0]
  assert.equal(noLevel?.problem?.code, 'tariff_tuition_missing')
})

test('IST-088: karar onayından sonraki satış teklifi kapatır; önceki satış ve başka kur sayılmaz', () => {
  const sale = (over: Partial<CourseOfferSale>): CourseOfferSale => ({
    id: 'test-sale',
    studentId: 'test-st1',
    courseId: B1.id,
    level: 'B1',
    soldAt: '2026-06-03T09:00:00.000Z',
    ...over,
  })
  const decisions = [decision('test-st1')]
  assert.equal(rows({ decisions, sales: [sale({})] })[0]?.saleId, 'test-sale')
  assert.equal(
    rows({ decisions, sales: [sale({ soldAt: '2026-06-01T09:00:00.000Z' })] })[0]?.saleId,
    null,
  )
  assert.equal(rows({ decisions, sales: [sale({ courseId: A2.id })] })[0]?.saleId, null)
  assert.equal(rows({ decisions, sales: [sale({ studentId: 'test-st2' })] })[0]?.saleId, null)
  const latest = rows({
    decisions,
    sales: [sale({ id: 'test-sale-old' }), sale({ id: 'test-sale-new', soldAt: '2026-07-01' })],
  })[0]
  assert.equal(latest?.saleId, 'test-sale-new')
})

test('IST-088: başka kursiyerin kararı sızmaz; pasif kursiyer yok; sıra Türkçe ada göre', () => {
  const result = courseOfferRows({
    students: [
      student('test-st1', 'Şule Arı'),
      student('test-st2', 'Can Ece'),
      student('test-st3', 'Zeki Ok'),
      student('test-st4', 'Ali Pasif', false),
    ],
    enrollments: ['test-st1', 'test-st2', 'test-st3', 'test-st4'].map((id) => enrollment(id)),
    courses: COURSES,
    // st3'ün kaydına st2 adına yazılmış karar st3'e geçmez.
    decisions: [
      decision('test-st1'),
      decision('test-st2', { outcome: 'repeat' }),
      decision('test-st2', { id: 'test-pd-x', enrollmentId: 'test-enr-test-st3' }),
      decision('test-st4'),
    ],
    packages: PACKAGES,
    sales: [],
    tariff: TARIFF,
  })
  assert.deepEqual(
    result.map((row) => [row.studentName, row.outcome]),
    [
      ['Can Ece', 'repeat'],
      ['Şule Arı', 'passed'],
    ],
  )
})

test('DOM-DIL-050: paketin tarife fiyatı satıştakiyle aynı kuraldır', () => {
  const price = packageTariffPrice(B1_PACKAGE, B1, TARIFF)
  assert.equal(price.purchasedHours, 60)
  assert.equal(price.grossCents, 60 * HOURLY)
  assert.throws(
    () => packageTariffPrice({ ...B1_PACKAGE, kind: 'hours' }, B1, TARIFF),
    isDomainError('lesson_hours_required'),
  )
})
