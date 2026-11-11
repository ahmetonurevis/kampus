import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed } from '../packages/school-core/src/data/seed.ts'

function yinelenenler<T>(rows: T[], key: (row: T) => string) {
  const seen = new Set<string>()
  const dup: string[] = []
  for (const row of rows) {
    const k = key(row)
    if (seen.has(k)) dup.push(k)
    seen.add(k)
  }
  return dup
}

test('örnek veri: ödev teslimi (ödev, öğrenci) çifti tekildir ve Deniz hw-review için sub-deniz kullanır', () => {
  const seed = createSeed(new Date('2026-03-04T09:00:00.000Z'))
  assert.deepEqual(
    yinelenenler(seed.submissions, (s) => `${s.homeworkId}|${s.studentId}`),
    [],
  )
  const deniz = seed.submissions.filter((s) => s.homeworkId === 'hw-review' && s.studentId === 's1')
  assert.equal(deniz.length, 1)
  assert.equal(deniz[0]?.id, 'sub-deniz')
  assert.equal(deniz[0]?.score, 88)
})

test('örnek veri: yoklama (öğrenci, gün), quiz denemesi (sınav, öğrenci) ve not kimliği tekildir', () => {
  const seed = createSeed(new Date('2026-03-04T09:00:00.000Z'))
  assert.deepEqual(
    yinelenenler(seed.attendance, (a) => `${a.studentId}|${a.date.slice(0, 10)}`),
    [],
  )
  assert.deepEqual(
    yinelenenler(seed.quizAttempts, (a) => `${a.quizId}|${a.studentId}`),
    [],
  )
  assert.deepEqual(
    yinelenenler(seed.grades, (g) => g.id),
    [],
  )
})
