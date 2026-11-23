import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  PROGRESS_SKILLS,
  TREND_THRESHOLD,
  countsForProgress,
  skillProgress,
  trendOf,
  type SkillResult,
} from '../packages/school-core/src/skills/progress.ts'

const result = (overrides: Partial<SkillResult> = {}): SkillResult => ({
  skill: 'reading',
  kind: 'evaluation',
  assignmentId: 'as-1',
  attemptId: 'at-1',
  submissionId: null,
  title: 'Okuma görevi',
  performedAt: '2026-10-01T09:00:00.000Z',
  percent: 60,
  removed: false,
  cancelled: false,
  ...overrides,
})

describe('DOM-BEC-035 beceri ilerleme panosu', () => {
  test('dört beceri her zaman sırasıyla döner; sonucu olmayan beceri boş eğridir', () => {
    const curves = skillProgress([])
    assert.deepEqual(
      curves.map((curve) => [curve.skill, curve.label, curve.points.length, curve.latest]),
      [
        ['reading', 'Okuma', 0, null],
        ['listening', 'Dinleme', 0, null],
        ['writing', 'Yazma', 0, null],
        ['speaking', 'Konuşma', 0, null],
      ],
    )
    assert.deepEqual(PROGRESS_SKILLS, ['reading', 'listening', 'writing', 'speaking'])
    assert.ok(curves.every((curve) => curve.trend === null))
  })

  test('noktalar beceriye ayrılır, tarihe göre sıralanır ve görev sonucunun kimliklerini taşır', () => {
    const curves = skillProgress([
      result({
        assignmentId: 'as-2',
        attemptId: 'at-2',
        performedAt: '2026-10-05T09:00:00Z',
        percent: 80,
      }),
      result({
        assignmentId: 'as-1',
        attemptId: 'at-1',
        performedAt: '2026-10-01T09:00:00Z',
        percent: 40,
      }),
      result({
        skill: 'writing',
        assignmentId: 'as-3',
        attemptId: null,
        submissionId: 'sub-3',
        percent: 75,
      }),
    ])
    const reading = curves.find((curve) => curve.skill === 'reading')
    assert.deepEqual(
      reading?.points.map((p) => [p.assignmentId, p.attemptId, p.submissionId, p.percent]),
      [
        ['as-1', 'at-1', null, 40],
        ['as-2', 'at-2', null, 80],
      ],
    )
    assert.equal(reading?.latest, 80)
    assert.equal(reading?.trend, 'up')
    assert.equal(reading?.points[0]?.performedAt, '2026-10-01T09:00:00.000Z')
    const writing = curves.find((curve) => curve.skill === 'writing')
    assert.deepEqual(
      writing?.points.map((p) => [p.submissionId, p.attemptId]),
      [['sub-3', null]],
    )
    assert.equal(writing?.trend, null)
  })

  test('aynı anda yapılan iki görev atama kimliğiyle kararlı sıralanır', () => {
    const at = '2026-10-01T09:00:00Z'
    const curves = skillProgress([
      result({ assignmentId: 'b', attemptId: 'x', performedAt: at }),
      result({ assignmentId: 'a', attemptId: 'y', performedAt: at }),
    ])
    assert.deepEqual(
      curves[0]?.points.map((p) => p.assignmentId),
      ['a', 'b'],
    )
  })

  test('puanı açılmamış, kaldırılmış (DOM-KYN-051), iptal edilmiş ve alıştırma sonucu panoya girmez', () => {
    const excluded = [
      result({ assignmentId: 'p', percent: null }),
      result({ assignmentId: 'r', removed: true }),
      result({ assignmentId: 'c', cancelled: true }),
      result({ assignmentId: 'pr', kind: 'practice' }),
      result({ assignmentId: 'm', skill: 'mediation' }),
      result({ assignmentId: 'l', skill: 'language_use' }),
      result({ assignmentId: 'n', skill: null }),
      result({ assignmentId: 'both', submissionId: 'sub' }),
      result({ assignmentId: 'none', attemptId: null }),
    ]
    for (const item of excluded) assert.equal(countsForProgress(item), false, item.assignmentId)
    const curves = skillProgress(excluded)
    assert.ok(curves.every((curve) => curve.points.length === 0))
    assert.equal(countsForProgress(result()), true)
  })

  test('aynı atamanın ikinci sonucu yok sayılır; yüzde 0–100 aralığına sıkıştırılır', () => {
    const curves = skillProgress([
      result({ percent: 120 }),
      result({ attemptId: 'at-other', percent: 10 }),
      result({
        assignmentId: 'as-9',
        attemptId: 'at-9',
        percent: -5,
        performedAt: '2026-10-02T09:00:00Z',
      }),
    ])
    assert.deepEqual(
      curves[0]?.points.map((p) => p.percent),
      [100, 0],
    )
  })

  test('eğilim son noktayı önceki en çok üç noktanın ortalamasıyla karşılaştırır', () => {
    const points = (...values: number[]) => values.map((percent) => ({ percent }))
    assert.equal(trendOf(points()), null)
    assert.equal(trendOf(points(50)), null)
    assert.equal(trendOf(points(50, 50 + TREND_THRESHOLD)), 'up')
    assert.equal(trendOf(points(50, 50 - TREND_THRESHOLD)), 'down')
    assert.equal(trendOf(points(50, 54)), 'steady')
    assert.equal(trendOf(points(50, 46)), 'steady')
    // Dördüncü önceki nokta (0) pencerenin dışındadır: ortalama 70, son 72 → dengeli.
    assert.equal(trendOf(points(0, 60, 70, 80, 72)), 'steady')
  })
})
