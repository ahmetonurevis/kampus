import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  lessonAlreadyRecorded,
  lessonPackageUsageSchema,
  pickLessonPackageSale,
  planLessonPackageHours,
  type LessonPackageCandidate,
} from '../packages/school-core/src/lib/finance-package-lessons.ts'
import type { PackageHourEntry } from '../packages/school-core/src/lib/finance-packages.ts'

/**
 * Yoklama köprüsünün finans ucu (ON-084; IST-078, DOM-DIL-051, DOM-DIL-054; K-250): satış seçimi ve
 * elle girilen kullanılan saatle birleşme. Bugün 2026-10-06.
 */

const TODAY = '2026-10-06'
const candidate = (overrides: Partial<LessonPackageCandidate> = {}): LessonPackageCandidate => ({
  id: 'test-sale-1',
  kind: 'hours',
  courseId: null,
  soldAt: '2026-09-01T09:00:00.000Z',
  expiresDate: '2027-03-01',
  remainingHours: 10,
  ...overrides,
})
const group = (courseId: string | null = 'test-course-a') => ({
  courseId,
  lessonKind: 'group' as const,
  occurredDate: '2026-10-05',
})
const sale = { purchasedHours: 40, expiresDate: '2027-03-01' }
const lesson = (lessonHourId = 'test-lh-1', hours = 1) => ({
  lessonHourId,
  occurredDate: '2026-10-05',
  hours,
})
const manual = (hours: number): PackageHourEntry => ({
  kind: 'consumed',
  hours,
  sourceType: 'manual',
  sourceId: 'test-sale-1',
  occurredDate: '2026-10-01',
})

describe('IST-078, K-250: dersin düşüleceği satış', () => {
  test('grup dersi önce aynı kurun kur satışından, yoksa genel saat paketinden düşer', () => {
    const sales = [
      candidate({ id: 'hours' }),
      candidate({ id: 'course-a', kind: 'course', courseId: 'test-course-a' }),
      candidate({ id: 'course-b', kind: 'course', courseId: 'test-course-b' }),
      candidate({ id: 'private', kind: 'private' }),
    ]
    assert.equal(pickLessonPackageSale(sales, group()), 'course-a')
    assert.equal(pickLessonPackageSale(sales, group('test-course-c')), 'hours')
    assert.equal(pickLessonPackageSale(sales, group(null)), 'hours')
  })

  test('özel ders yalnız özel ders paketinden düşer', () => {
    const lessonOf = { courseId: null, lessonKind: 'private' as const, occurredDate: '2026-10-05' }
    assert.equal(pickLessonPackageSale([candidate()], lessonOf), null)
    assert.equal(
      pickLessonPackageSale([candidate(), candidate({ id: 'p', kind: 'private' })], lessonOf),
      'p',
    )
  })

  test('DOM-DIL-051: satıştan önceki, son kullanmadan sonraki ders ve saati biten satış seçilmez', () => {
    assert.equal(
      pickLessonPackageSale([candidate({ soldAt: '2026-10-06T08:00:00Z' })], group(null)),
      null,
    )
    assert.equal(
      pickLessonPackageSale([candidate({ expiresDate: '2026-10-04' })], group(null)),
      null,
    )
    assert.equal(
      pickLessonPackageSale([candidate({ expiresDate: '2026-10-05' })], group(null)),
      'test-sale-1',
    )
    assert.equal(pickLessonPackageSale([candidate({ remainingHours: 0 })], group(null)), null)
  })

  test('birden çok uygun satışta önce süresi en erken dolan, süresiz en son, sonra en eski satış', () => {
    const sales = [
      candidate({ id: 'endless', expiresDate: null, soldAt: '2026-01-01T00:00:00Z' }),
      candidate({ id: 'late', expiresDate: '2027-06-01' }),
      candidate({ id: 'soon-new', expiresDate: '2026-12-01', soldAt: '2026-09-10T00:00:00Z' }),
      candidate({ id: 'soon-old', expiresDate: '2026-12-01', soldAt: '2026-09-02T00:00:00Z' }),
    ]
    assert.equal(pickLessonPackageSale(sales, group(null)), 'soon-old')
    assert.equal(pickLessonPackageSale(sales.slice(0, 2), group(null)), 'late')
    assert.equal(pickLessonPackageSale(sales.slice(0, 1), group(null)), 'endless')
  })
})

describe('K-21, K-250: elle girilen saatle birleşme', () => {
  test('elle girilmiş fark yoksa yalnız ders hareketi planlanır', () => {
    assert.deepEqual(planLessonPackageHours(sale, [], lesson(), TODAY), {
      entry: {
        kind: 'consumed',
        hours: 1,
        occurredDate: '2026-10-05',
        sourceType: 'lesson',
        sourceId: 'test-lh-1',
      },
      manualHours: null,
    })
  })

  test('ders saati önce elle girilen farktan düşer; toplam iki kez sayılmaz', () => {
    assert.equal(
      planLessonPackageHours(sale, [manual(10)], lesson('test-lh-a', 2), TODAY)?.manualHours,
      8,
    )
    assert.equal(
      planLessonPackageHours(sale, [manual(1)], lesson('test-lh-a', 2), TODAY)?.manualHours,
      0,
    )
    assert.equal(
      planLessonPackageHours(sale, [manual(0)], lesson('test-lh-a', 2), TODAY)?.manualHours,
      null,
    )
  })

  test('IST-078: elle girilen toplam bakiyeyi bitirmişse ders yine yazılır, bakiye eksiye inmez', () => {
    assert.equal(planLessonPackageHours(sale, [manual(40)], lesson(), TODAY)?.manualHours, 39)
    const full: PackageHourEntry[] = [
      {
        kind: 'consumed',
        hours: 40,
        sourceType: 'lesson',
        sourceId: 'eski',
        occurredDate: '2026-10-01',
      },
    ]
    assert.throws(
      () => planLessonPackageHours(sale, full, lesson(), TODAY),
      (error: Error & { code?: string }) => error.code === 'package_balance_insufficient',
    )
  })

  test('aynı ders yeniden gelirse hiçbir şey planlanmaz; başka satıştaki kaydı da bulunur', () => {
    const recorded: PackageHourEntry = {
      kind: 'consumed',
      hours: 1,
      sourceType: 'lesson',
      sourceId: 'test-lh-1',
      occurredDate: '2026-10-05',
    }
    assert.equal(planLessonPackageHours(sale, [recorded, manual(5)], lesson(), TODAY), null)
    const bySale = new Map([
      ['a', [manual(3)]],
      ['b', [recorded]],
    ])
    assert.equal(lessonAlreadyRecorded(bySale, 'test-lh-1'), 'b')
    assert.equal(lessonAlreadyRecorded(bySale, 'test-lh-2'), null)
  })

  test('girdi şeması: gelecek güne ve sıfır saate izin vermez; bilinmeyen alan reddedilir', () => {
    const valid = {
      studentId: 's3',
      courseId: null,
      lessonKind: 'group',
      lessonHourId: 'test-lh-1',
      occurredDate: '2026-10-05',
      hours: 1,
    }
    assert.equal(lessonPackageUsageSchema.safeParse(valid).success, true)
    assert.equal(lessonPackageUsageSchema.safeParse({ ...valid, hours: 0 }).success, false)
    assert.equal(lessonPackageUsageSchema.safeParse({ ...valid, extra: 1 }).success, false)
    assert.throws(
      () => planLessonPackageHours(sale, [], { ...lesson(), occurredDate: '2026-10-07' }, TODAY),
      (error: Error & { code?: string }) => error.code === 'package_hours_date_future',
    )
  })
})
