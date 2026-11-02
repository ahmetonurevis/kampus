import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CefrProfile } from '@kampus/react-shared/cefr.ts'
import {
  currentLevelRows,
  estimateSkillRows,
  estimateSummary,
  GENERAL_LEVEL_LABEL,
  placementRows,
  timelineRows,
} from '../src/pages/language/cefr-profile-model.ts'

// OG-054 (IST-060; DOM-DIL-010…012, DOM-BEC-034): CEFR profilinin sunumu.

const SESSION_ID = '00000000-0000-4000-8000-0000e0000001'

const base: CefrProfile = {
  view: 'learner',
  studentId: 'student-1',
  title: 'Deniz Yılmaz',
  estimate: {
    context: 'general',
    computedAt: '2026-11-02T09:00:00.000Z',
    overall: { status: 'insufficient', missingSkills: ['speaking', 'writing'] },
    skills: [
      {
        skill: 'speaking',
        label: 'Konuşma',
        status: 'insufficient',
        level: null,
        plus: false,
        demonstratedBy: null,
        missingEvidence: 2,
        missingItems: 0,
        evidenceIds: [],
      },
      {
        skill: 'reading',
        label: 'Okuma',
        status: 'suggested',
        level: 'B1',
        plus: false,
        demonstratedBy: 'general',
        missingEvidence: 0,
        missingItems: 0,
        evidenceIds: ['e1', 'e2', 'e3'],
      },
    ],
    label: 'Tahmini seviye',
    evidence: [],
    excluded: [],
  },
  current: [
    {
      skill: 'speaking',
      level: 'A2',
      decisionId: 'd2',
      decidedAt: '2026-10-01T09:00:00.000Z',
    },
    { skill: null, level: 'B1', decisionId: 'd1', decidedAt: '2026-10-01T09:00:00.000Z' },
  ],
  placements: [
    {
      id: 'p1',
      mode: 'remote',
      startedAt: '2026-08-01T09:00:00.000Z',
      completedAt: '2026-08-01T10:00:00.000Z',
      validity: { status: 'expired', preliminary: true },
    },
    {
      id: 'p2',
      mode: 'in_person',
      startedAt: '2026-10-01T08:00:00.000Z',
      completedAt: '2026-10-01T09:00:00.000Z',
      validity: {
        status: 'valid',
        preliminary: false,
        completedAt: '2026-10-01T09:00:00.000Z',
        validUntil: '2026-12-30T09:00:00.000Z',
      },
    },
  ],
  timeline: [
    {
      id: 'd1',
      kind: 'placement',
      skill: null,
      level: 'B1',
      decidedAt: '2026-10-01T09:00:00.000Z',
      placementSessionId: SESSION_ID,
    },
  ],
}

test('IST-060: güncel seviyede genel seviye önce gelir', () => {
  const rows = currentLevelRows(base)
  assert.deepEqual(
    rows.map((row) => [row.label, row.level]),
    [
      [GENERAL_LEVEL_LABEL, 'B1'],
      ['Konuşma', 'A2'],
    ],
  )
})

test('DOM-BEC-034: kanıt yetersizse tahmini seviye eksik becerileri söyler', () => {
  assert.deepEqual(estimateSummary(base.estimate), {
    level: 'Kanıt yetersiz',
    note: 'Eksik beceri: Konuşma, Yazma',
  })
  const suggested = estimateSummary({
    ...base.estimate,
    overall: { status: 'suggested', level: 'B1' },
  })
  assert.equal(suggested.level, 'B1')
  assert.deepEqual(
    estimateSkillRows(base.estimate).map((row) => [row.label, row.level, row.note]),
    [
      ['Okuma', 'B1', '3 kanıt'],
      ['Konuşma', 'Kanıt yetersiz', '2 kanıt daha gerekir'],
    ],
  )
})

test('DOM-DIL-011, DOM-DIL-012: tespitler en yeniden eskiye, geçerlilik ve ön tespit etiketli', () => {
  const rows = placementRows(base)
  assert.deepEqual(
    rows.map((row) => [row.key, row.mode, row.status, row.tone]),
    [
      ['p2', 'Kurumda', 'Geçerli', 'green'],
      ['p1', 'Uzaktan (ön tespit)', 'Süresi doldu', 'gray'],
    ],
  )
  assert.match(rows[0]?.until ?? '', /tarihine kadar$/)
  assert.equal(rows[1]?.until, '')
})

test('IST-060: gerekçe yalnız personel görünümünde gösterilir', () => {
  assert.equal(timelineRows(base)[0]?.rationale, null)
  assert.equal(timelineRows(base)[0]?.title, `${GENERAL_LEVEL_LABEL}: B1`)
  assert.equal(timelineRows(base)[0]?.kind, 'Yerleştirme')
  const staff: CefrProfile = {
    ...base,
    view: 'staff',
    timeline: [{ ...base.timeline[0]!, rationale: 'Tespit sonucu', decidedByUserId: 'user-1' }],
  }
  assert.equal(timelineRows(staff)[0]?.rationale, 'Tespit sonucu')
})
