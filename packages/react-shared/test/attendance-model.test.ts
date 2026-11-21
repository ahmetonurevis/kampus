import assert from 'node:assert/strict'
import { test } from 'node:test'

import { LATE_MINUTES_MIN, lateMinutesSchema } from '@kampus/school-core/lib/domain.ts'

import {
  attendanceMarks,
  bulkMark,
  lateMinutesIssueErrors,
  lateMinutesPayload,
  markCounts,
  minuteChangedIds,
  savedLateMinutes,
} from '../src/attendance-model.ts'

test('yoklama işaretleri: varsayılan geldi, kayıtlı gün yüklenir, düzenleme üste biner', () => {
  const ids = ['s1', 's2', 's3']
  assert.deepEqual(attendanceMarks(ids, []), { s1: 'present', s2: 'present', s3: 'present' })
  const saved = [
    { studentId: 's1', status: 'absent' },
    { studentId: 's2', status: 'late' },
    { studentId: 's9', status: 'absent' },
    { studentId: 's3', status: 'bilinmeyen' },
  ]
  assert.deepEqual(attendanceMarks(ids, saved), { s1: 'absent', s2: 'late', s3: 'present' })
  assert.deepEqual(attendanceMarks(ids, saved, { s1: 'excused' }), {
    s1: 'excused',
    s2: 'late',
    s3: 'present',
  })
})

test('işaret sayımı dört durumu ayrı sayar', () => {
  assert.deepEqual(
    markCounts({ a: 'present', b: 'present', c: 'late', d: 'excused', e: 'absent' }),
    { present: 2, absent: 1, late: 1, excused: 1 },
  )
})

test('IST-093: toplu işaretleme yalnız seçili öğrencileri değiştirir, öncekileri korur', () => {
  const edits = { s1: 'absent', s4: 'excused' } as const
  assert.deepEqual(bulkMark(edits, new Set(['s1', 's2']), 'late'), {
    s1: 'late',
    s2: 'late',
    s4: 'excused',
  })
  assert.deepEqual(bulkMark(edits, [], 'present'), edits)
  assert.deepEqual(edits, { s1: 'absent', s4: 'excused' }, 'girdi değişmez')
})

test('DOM-AKD-036: kayıtlı dakikalar metne çevrilir, dakikasız kayıt alan üretmez', () => {
  assert.deepEqual(
    savedLateMinutes([
      { studentId: 's1', lateMinutes: 12 },
      { studentId: 's2' },
      { studentId: 's3', lateMinutes: undefined },
    ]),
    { s1: '12' },
  )
})

test('DOM-AKD-036: dakika yalnız geç gelen öğrenci için gönderilir; boş alan dakikasızdır', () => {
  const marks = { s1: 'late', s2: 'late', s3: 'present', s4: 'absent' } as const
  assert.deepEqual(lateMinutesPayload(marks, { s1: ' 15 ', s3: '7', s4: '9' }), {
    minutes: { s1: 15 },
    errors: {},
  })
  assert.deepEqual(lateMinutesPayload(marks, {}), { minutes: {}, errors: {} })
})

test('DOM-AKD-036: geçersiz dakika o öğrencinin hatasıdır ve ileti core şemasındandır', () => {
  const marks = { s1: 'late', s2: 'late', s3: 'late', s4: 'late', s5: 'late' } as const
  const result = lateMinutesPayload(marks, {
    s1: '0',
    s2: '-5',
    s3: '2,5',
    s4: 'on',
    s5: '10',
  })
  assert.deepEqual(result.minutes, { s5: 10 })
  assert.deepEqual(Object.keys(result.errors).sort(), ['s1', 's2', 's3', 's4'])
  // İletiler `attendanceInputSchema.lateMinutes` ile birebir aynıdır (elle yazılmış metin yok).
  const core = (value: unknown) =>
    lateMinutesSchema.safeParse(value).error?.issues[0]?.message ?? ''
  assert.equal(result.errors.s1, core(0))
  assert.equal(result.errors.s2, core(-5))
  assert.equal(result.errors.s4, core(Number.NaN))
  assert.equal(result.errors.s1, 'Geç kalma süresi en az 1 dakika olmalıdır.')
})

test('DOM-AKD-036: şemanın ürettiği dakika sınırı alanın min değeriyle aynıdır', () => {
  assert.equal(LATE_MINUTES_MIN, 1)
  assert.equal(lateMinutesSchema.safeParse(LATE_MINUTES_MIN).success, true)
  assert.equal(lateMinutesSchema.safeParse(LATE_MINUTES_MIN - 1).success, false)
})

test('DOM-AKD-036: sunucunun dakika maddesi o öğrencinin alanına eşlenir', () => {
  const limit = 'Geç kalma süresi 1 ile 40 dakika arasında olmalıdır (ders süresi).'
  assert.deepEqual(
    lateMinutesIssueErrors([
      { path: ['lateMinutes', 's1'], message: limit },
      { path: ['lateMinutes', 's1'], message: 'ikinci madde ilkini ezmez' },
      { path: ['marks', 's2'], message: 'başka alan' },
      { path: ['lateMinutes'], message: 'öğrencisiz' },
      { path: [], message: 'yolsuz' },
    ]),
    { s1: limit },
  )
  assert.deepEqual(lateMinutesIssueErrors([]), {})
})

test('DOM-AKD-036: kayıtlı değerden farklı dakika kaydedilmemiş değişikliktir', () => {
  const marks = { s1: 'late', s2: 'late', s3: 'present', s4: 'late' } as const
  const saved = { s1: '12', s2: '8' }
  // s1 12 -> 15 düzeltildi; s2 dokunulmadı; s3 geç gelmeyen; s4 dakikasız kayıttan dakika eklendi.
  assert.deepEqual(minuteChangedIds(marks, saved, { ...saved, s1: '15', s3: '5', s4: '7' }), [
    's1',
    's4',
  ])
  assert.deepEqual(minuteChangedIds(marks, saved, saved), [])
  // Boşluk farkı değişiklik değildir; dakikanın silinmesi değişikliktir.
  assert.deepEqual(minuteChangedIds(marks, saved, { ...saved, s1: ' 12 ' }), [])
  assert.deepEqual(minuteChangedIds(marks, saved, { ...saved, s1: '' }), ['s1'])
  // Geç gelmeyen öğrencinin eski dakika alanı sayılmaz.
  assert.deepEqual(minuteChangedIds({ s1: 'absent' }, saved, { s1: '99' }), [])
})
