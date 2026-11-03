import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import type {
  EvidenceSnapshot,
  LevelDecisionRow,
} from '../packages/school-core/src/cefr/suggestion.ts'
import {
  LEVEL_CHANGES,
  decisionEvidence,
  levelSeries,
  levelTimeline,
  timelineSkills,
  type TimelineDecision,
} from '../packages/school-core/src/cefr/timeline.ts'
import { PRIMARY_SKILLS } from '../packages/school-core/src/content/taxonomy.ts'

// OG-079 (IST-060; DOM-BEC-030, DOM-BEC-034): CEFR profilinin zaman çizelgesi saklanan
// kararlardan türetilir; değişim, dizi ve kanıt özeti saklanmaz.

const at = (day: number) => new Date(Date.UTC(2026, 8, day, 9)).toISOString()

const decision = (
  id: string,
  skill: TimelineDecision['skill'],
  level: TimelineDecision['level'],
  day: number,
): TimelineDecision => ({ id, skill, level, decidedAt: at(day) })

const snapshot: EvidenceSnapshot = {
  schemaVersion: 2,
  context: 'placement',
  computedAt: at(10),
  overall: { status: 'suggested', level: 'B1' },
  skills: [
    {
      skill: 'speaking',
      status: 'suggested',
      level: 'A2+',
      demonstratedBy: 'placement',
      plus: true,
      missingEvidence: 0,
      evidenceIds: ['ev-speak-1'],
    },
    {
      skill: 'reading',
      status: 'suggested',
      level: 'B1',
      demonstratedBy: 'placement',
      plus: false,
      missingEvidence: 0,
      evidenceIds: ['ev-read-1'],
    },
    {
      skill: 'writing',
      status: 'insufficient',
      level: null,
      demonstratedBy: null,
      plus: false,
      missingEvidence: 2,
      evidenceIds: [],
    },
  ],
  evidence: [
    {
      id: 'ev-read-1',
      taskId: 'task-read',
      title: 'Okuma bölümü',
      source: 'placement',
      skill: 'reading',
      targetLevel: 'B1',
      performedAt: at(9),
      successful: true,
      percent: 80,
      items: 10,
    },
    {
      id: 'ev-speak-1',
      taskId: 'task-speak',
      title: 'Konuşma bölümü',
      source: 'placement',
      skill: 'speaking',
      targetLevel: 'B1',
      performedAt: at(8),
      successful: true,
      percent: 75,
      items: null,
    },
    {
      id: 'ev-speak-0',
      taskId: 'task-speak-old',
      title: 'Eski konuşma görevi',
      source: 'task',
      skill: 'speaking',
      targetLevel: 'B2',
      performedAt: at(7),
      successful: false,
      percent: 40,
      items: null,
    },
  ],
}

const row = (
  skill: LevelDecisionRow['skill'],
  level: LevelDecisionRow['level'],
  evidenceSnapshot: EvidenceSnapshot = snapshot,
): LevelDecisionRow => ({
  id: 'dec-1',
  kind: 'placement',
  skill,
  level,
  rationale: 'Gerekçe',
  decidedByUserId: 'user-1',
  decidedAt: at(10),
  evidenceSnapshot,
})

describe('CEFR zaman çizelgesi (OG-079)', () => {
  test('IST-060 çizelge en yeniden eskiye; değişim aynı becerinin önceki kararına göre', () => {
    const entries = levelTimeline([
      decision('d1', null, 'A2', 1),
      decision('d2', 'speaking', 'A2', 1),
      decision('d3', null, 'B1', 5),
      decision('d4', 'speaking', 'A2', 6),
      decision('d5', null, 'A2+', 9),
    ])
    assert.deepEqual(
      entries.map((e) => [e.id, e.previousLevel, e.change]),
      [
        ['d5', 'B1', 'down'],
        ['d4', 'A2', 'same'],
        ['d3', 'A2', 'up'],
        ['d2', null, 'first'],
        ['d1', null, 'first'],
      ],
    )
    assert.equal(LEVEL_CHANGES[entries[2]!.change].label, 'Yükseldi')
  })

  test('IST-060 girdi sırası ve aynı an çizelgeyi değiştirmez; artı seviye sırası taksonomiden', () => {
    const input = [
      decision('d-b', 'reading', 'B1+', 3),
      decision('d-a', 'reading', 'B1', 3),
      decision('d-c', 'reading', 'B2', 4),
    ]
    const forward = levelTimeline(input)
    const backward = levelTimeline([...input].reverse())
    assert.deepEqual(forward, backward)
    assert.deepEqual(
      forward.map((e) => [e.id, e.change]),
      [
        ['d-c', 'up'],
        ['d-b', 'up'],
        ['d-a', 'first'],
      ],
    )
    // Girdi değişmez.
    assert.deepEqual(
      input.map((d) => d.id),
      ['d-b', 'd-a', 'd-c'],
    )
    assert.deepEqual(levelTimeline([]), [])
  })

  test('IST-060 mini grafik dizisi yalnız o becerinin gerçek kararları, eskiden yeniye', () => {
    const decisions = [
      decision('d3', 'speaking', 'B1', 7),
      decision('d1', 'speaking', 'Pre-A1', 1),
      decision('d2', null, 'A2', 2),
      decision('d4', 'speaking', 'C2', 9),
    ]
    assert.deepEqual(
      levelSeries(decisions, 'speaking').map((p) => [p.decisionId, p.level, p.rank]),
      [
        ['d1', 'Pre-A1', 0],
        ['d3', 'B1', 4],
        ['d4', 'C2', 9],
      ],
    )
    assert.deepEqual(
      levelSeries(decisions, null).map((p) => p.decisionId),
      ['d2'],
    )
    assert.deepEqual(levelSeries(decisions, 'reading'), [])
  })

  test('IST-060 süzgeç becerileri: önce genel seviye, sonra beceri sırası; kararı olmayan yok', () => {
    const decisions = [
      decision('d1', 'speaking', 'A2', 1),
      decision('d2', 'reading', 'A2', 1),
      decision('d3', null, 'A2', 1),
    ]
    assert.deepEqual(timelineSkills(decisions, PRIMARY_SKILLS), [null, 'reading', 'speaking'])
    assert.deepEqual(timelineSkills([decision('d1', 'writing', 'B1', 1)], PRIMARY_SKILLS), [
      'writing',
    ])
  })

  test('IST-060 DOM-BEC-030 beceri kararının kanıtı karar anı kopyasından: yalnız o beceri, dayanak işaretli', () => {
    const summary = decisionEvidence(row('speaking', 'B1'))
    assert.equal(summary.context, 'placement')
    assert.equal(summary.suggestedLevel, 'A2+')
    assert.equal(summary.followsSuggestion, false)
    assert.equal(summary.successful, 1)
    assert.deepEqual(
      summary.items.map((item) => [item.id, item.basis, item.successful, item.percent]),
      [
        ['ev-speak-1', true, true, 75],
        ['ev-speak-0', false, false, 40],
      ],
    )
    // Madde sayısı özetle gelmez (kişinin puan ayrıntısı ekranda gerekmez).
    assert.ok(summary.items.every((item) => !('items' in item)))
  })

  test('IST-060 genel kararın kanıtı bütün beceriler; öneriyle aynıysa öneriye uyar', () => {
    const summary = decisionEvidence(row(null, 'B1'))
    assert.equal(summary.suggestedLevel, 'B1')
    assert.equal(summary.followsSuggestion, true)
    assert.deepEqual(
      summary.items.map((item) => [item.id, item.basis]),
      [
        ['ev-read-1', true],
        ['ev-speak-1', true],
        ['ev-speak-0', false],
      ],
    )
  })

  test('IST-060 kanıt yetersizken öneri yok; kopyada becerisi olmayan karar boş özet verir', () => {
    const empty: EvidenceSnapshot = {
      ...snapshot,
      context: 'general',
      overall: { status: 'insufficient', missingSkills: ['speaking'] },
      skills: [],
      evidence: [],
    }
    const general = decisionEvidence(row(null, 'A2', empty))
    assert.deepEqual(general, {
      context: 'general',
      suggestedLevel: null,
      followsSuggestion: null,
      items: [],
      successful: 0,
    })
    const writing = decisionEvidence(row('writing', 'A2'))
    assert.equal(writing.suggestedLevel, null)
    assert.equal(writing.followsSuggestion, null)
    assert.deepEqual(writing.items, [])
    const mediation = decisionEvidence(row('mediation', 'A2'))
    assert.equal(mediation.suggestedLevel, null)
  })
})
