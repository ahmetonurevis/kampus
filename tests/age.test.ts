import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ADULT_AGE,
  ageOn,
  isCalendarDay,
  isUnderAdultAge,
} from '../packages/school-core/src/lib/age.ts'
import { isMinorOn } from '../packages/school-core/src/cefr/progression.ts'
import { birthDateSchema } from '../packages/school-core/src/lib/domain.ts'

// 18 yaş sınırı tek yerde hesaplanır (packages/school-core/src/lib/age.ts): kesin kayıt
// (DOM-KAY-003, DOM-KAY-012) ve CEFR devamsızlık bildirimi (DOM-DIL-091) aynı kişiyi aynı yaşta
// sayar.

test('isCalendarDay yalnız gerçek takvim gününü kabul eder', () => {
  for (const day of ['2008-02-29', '2026-12-31', '2000-01-01'])
    assert.equal(isCalendarDay(day), true)
  for (const day of ['2008-02-30', '2007-02-29', '2008-13-01', '2008-00-10', '04.11.2008', ''])
    assert.equal(isCalendarDay(day), false, day)
})

test('DOM-KAY-012 DOM-DIL-091: kesin kayıt ve CEFR bildirimi 18 yaşı aynı hesaplar', () => {
  assert.equal(ADULT_AGE, 18)
  const cases: [string, string][] = [
    ['2008-11-04', '2026-11-03T22:30:00.000Z'],
    ['2008-11-04', '2026-11-03T20:00:00.000Z'],
    // 29 Şubat doğumlu artık olmayan yılda 1 Mart'ta (İstanbul günü) yaş alır.
    ['2008-02-29', '2026-02-28T12:00:00.000Z'],
    ['2008-02-29', '2026-02-28T21:30:00.000Z'],
    ['2008-02-29', '2028-02-29T00:00:00.000Z'],
  ]
  for (const [birthDate, now] of cases)
    assert.equal(isUnderAdultAge(birthDate, now), isMinorOn(birthDate, now), `${birthDate} ${now}`)
  assert.equal(ageOn('2008-02-29', '2026-02-28T12:00:00.000Z'), 17)
  assert.equal(ageOn('2008-02-29', '2026-02-28T21:30:00.000Z'), 18)
})

test('DOM-KAY-012: doğum tarihi şeması ortak takvim günü denetimini kullanır', () => {
  assert.equal(birthDateSchema.safeParse('2008-02-29').success, true)
  assert.equal(birthDateSchema.safeParse('2007-02-29').success, false)
})
