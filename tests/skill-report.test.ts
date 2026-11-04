import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  REPORT_GROUPINGS,
  skillReport,
  type LearnerSkillResult,
} from '../packages/school-core/src/cefr/skill-report.ts'
import type { CefrLevel } from '../packages/school-core/src/content/taxonomy.ts'

const now = new Date('2026-11-04T09:00:00.000Z')

let seq = 0
const result = (overrides: Partial<LearnerSkillResult> = {}): LearnerSkillResult => {
  seq += 1
  return {
    learnerId: 's1',
    skill: 'reading',
    kind: 'evaluation',
    assignmentId: `as-${seq}`,
    attemptId: `at-${seq}`,
    submissionId: null,
    title: 'Görev',
    performedAt: '2026-10-01T09:00:00.000Z',
    percent: 60,
    removed: false,
    cancelled: false,
    ...overrides,
  }
}

const levels = (entries: [string, CefrLevel][]) => new Map(entries)
const skillOf = (report: ReturnType<typeof skillReport>, group: number, skill: string) =>
  report.groups[group]?.skills.find((s) => s.skill === skill)

describe('IST-118 beceri ve CEFR raporu (DOM-BEC-037)', () => {
  test('boş veride grup sayıları sıfır, ortalama null, dağılım boş', () => {
    const report = skillReport({ groups: [], results: [], levels: new Map(), now })
    assert.equal(report.computedAt, now.toISOString())
    assert.deepEqual(report.groups, [])
    assert.equal(report.totals.studentCount, 0)
    assert.equal(report.totals.noLevelCount, 0)
    assert.deepEqual(
      report.totals.skills.map((s) => [s.skill, s.average, s.evidenceCount, s.studentCount]),
      [
        ['reading', null, 0, 0],
        ['listening', null, 0, 0],
        ['writing', null, 0, 0],
        ['speaking', null, 0, 0],
      ],
    )
    assert.deepEqual(REPORT_GROUPINGS, ['class', 'level'])
  })

  test('kanıtı olmayan beceri null döner, sıfır değil; kanıtlı beceri ortalanır', () => {
    const report = skillReport({
      groups: [{ id: 'g1', name: 'A1 Sabah', studentIds: ['s1', 's2'] }],
      results: [result({ percent: 80 }), result({ learnerId: 's2', percent: 61 })],
      levels: new Map(),
      now,
    })
    assert.deepEqual(skillOf(report, 0, 'reading'), {
      skill: 'reading',
      label: 'Okuma',
      average: 70.5,
      evidenceCount: 2,
      studentCount: 2,
    })
    assert.equal(skillOf(report, 0, 'speaking')?.average, null)
    assert.equal(skillOf(report, 0, 'speaking')?.evidenceCount, 0)
    // Puanı 0 olan gerçek sonuç, kanıtsızlıktan ayrıdır.
    const zero = skillReport({
      groups: [{ id: 'g1', name: 'A1', studentIds: ['s1'] }],
      results: [result({ percent: 0 })],
      levels: new Map(),
      now,
    })
    assert.equal(skillOf(zero, 0, 'reading')?.average, 0)
  })

  test('her kursiyer eşit ağırlıklıdır; yuvarlama yalnız sonda, bir ondalık', () => {
    const report = skillReport({
      groups: [{ id: 'g1', name: 'A1', studentIds: ['s1', 's2'] }],
      results: [
        // s1 ortalaması 100, s2 ortalaması (50 + 50 + 51) / 3 = 50,333…; grup (100 + 50,333…) / 2.
        result({ percent: 100 }),
        result({ learnerId: 's2', percent: 50 }),
        result({ learnerId: 's2', percent: 50 }),
        result({ learnerId: 's2', percent: 51 }),
      ],
      levels: new Map(),
      now,
    })
    const reading = skillOf(report, 0, 'reading')
    assert.equal(reading?.average, 75.2)
    assert.equal(reading?.evidenceCount, 4)
    assert.equal(reading?.studentCount, 2)
  })

  test('çok gruplu: her grup yalnız kendi kursiyerlerini, toplam kursiyeri bir kez sayar', () => {
    const report = skillReport({
      groups: [
        { id: 'g1', name: 'A1 Sabah', studentIds: ['s1', 's2'] },
        { id: 'g2', name: 'B1 Akşam', studentIds: ['s2', 's3'] },
      ],
      results: [
        result({ learnerId: 's1', percent: 40 }),
        result({ learnerId: 's2', percent: 60 }),
        result({ learnerId: 's3', skill: 'listening', percent: 90 }),
      ],
      levels: levels([
        ['s1', 'A1'],
        ['s2', 'A1'],
        ['s3', 'B1'],
      ]),
      now,
    })
    assert.equal(report.groups[0]?.studentCount, 2)
    assert.equal(skillOf(report, 0, 'reading')?.average, 50)
    assert.equal(skillOf(report, 0, 'listening')?.average, null)
    assert.equal(skillOf(report, 1, 'reading')?.average, 60)
    assert.equal(skillOf(report, 1, 'listening')?.average, 90)
    assert.deepEqual(report.groups[1]?.levels, [
      { level: 'A1', label: 'A1', count: 1 },
      { level: 'B1', label: 'B1', count: 1 },
    ])
    // s2 iki grupta; toplamda bir kez (3 kursiyer) ve kanıtı bir kez sayılır.
    assert.equal(report.totals.studentCount, 3)
    assert.equal(report.totals.skills[0]?.evidenceCount, 2)
    assert.equal(report.totals.skills[0]?.average, 50)
  })

  test('seviye dağılımı seviye sırasıyla; kararı olmayan ayrı sayılır', () => {
    const report = skillReport({
      groups: [{ id: 'g1', name: 'Karma', studentIds: ['a', 'b', 'c', 'd'] }],
      results: [],
      levels: levels([
        ['a', 'B2'],
        ['b', 'A2+'],
        ['c', 'B2'],
      ]),
      now,
    })
    assert.deepEqual(
      report.groups[0]?.levels.map((l) => [l.level, l.count]),
      [
        ['A2+', 1],
        ['B2', 2],
      ],
    )
    assert.equal(report.groups[0]?.noLevelCount, 1)
  })

  test('kapsam dışı kursiyerin sonucu ve seviyesi hesaba girmez', () => {
    const report = skillReport({
      groups: [{ id: 'g1', name: 'Benim grubum', studentIds: ['s1'] }],
      results: [
        result({ learnerId: 's1', percent: 50 }),
        result({ learnerId: 'baska', percent: 100 }),
      ],
      levels: levels([
        ['s1', 'A1'],
        ['baska', 'C2'],
      ]),
      now,
    })
    assert.equal(report.totals.studentCount, 1)
    assert.equal(skillOf(report, 0, 'reading')?.average, 50)
    assert.equal(skillOf(report, 0, 'reading')?.evidenceCount, 1)
    assert.deepEqual(
      report.totals.levels.map((l) => l.level),
      ['A1'],
    )
  })

  test('sayılmayan sonuçlar girmez: alıştırma, açılmamış puan, kaldırılmış, iptal, aracılık', () => {
    const report = skillReport({
      groups: [{ id: 'g1', name: 'A1', studentIds: ['s1'] }],
      results: [
        result({ kind: 'practice', percent: 100 }),
        result({ percent: null }),
        result({ removed: true, percent: 100 }),
        result({ cancelled: true, percent: 100 }),
        result({ skill: 'mediation', percent: 100 }),
        result({ skill: null, percent: 100 }),
        result({ percent: 70 }),
      ],
      levels: new Map(),
      now,
    })
    assert.equal(skillOf(report, 0, 'reading')?.average, 70)
    assert.equal(skillOf(report, 0, 'reading')?.evidenceCount, 1)
  })

  test('aynı atamanın ikinci sonucu sayılmaz', () => {
    const first = result({ percent: 40 })
    const report = skillReport({
      groups: [{ id: 'g1', name: 'A1', studentIds: ['s1'] }],
      results: [first, { ...first, attemptId: 'at-x', percent: 100 }],
      levels: new Map(),
      now,
    })
    assert.equal(skillOf(report, 0, 'reading')?.average, 40)
    assert.equal(skillOf(report, 0, 'reading')?.evidenceCount, 1)
  })

  test('aynı kursiyer grupta iki kez geçse bir kez sayılır', () => {
    const report = skillReport({
      groups: [{ id: 'g1', name: 'A1', studentIds: ['s1', 's1'] }],
      results: [result({ percent: 50 })],
      levels: new Map(),
      now,
    })
    assert.equal(report.groups[0]?.studentCount, 1)
  })
})
