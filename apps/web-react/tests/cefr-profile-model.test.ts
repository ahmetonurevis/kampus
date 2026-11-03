import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CefrProfile, CefrStaffTimelineEntry } from '@kampus/react-shared/cefr.ts'
import {
  currentLevelRows,
  estimateSkillRows,
  estimateSummary,
  GENERAL_LEVEL_LABEL,
  levelChart,
  placementRows,
  timelineFilterOptions,
  timelineRows,
} from '../src/pages/language/cefr-profile-model.ts'

// OG-054, OG-079 (IST-060; DOM-DIL-010…012, DOM-BEC-034): CEFR profilinin sunumu.

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
      previousLevel: null,
      change: 'first',
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

test('IST-060: gerekçe, kararı veren ve kanıt yalnız personel görünümünde gösterilir', () => {
  const [row] = timelineRows(base)
  assert.equal(row?.rationale, null)
  assert.equal(row?.decidedBy, null)
  assert.equal(row?.evidence, null)
  assert.equal(row?.title, `${GENERAL_LEVEL_LABEL}: B1`)
  assert.equal(row?.kind, 'Yerleştirme')
  assert.equal(row?.dateTime, '2026-10-01T09:00:00.000Z')
  assert.deepEqual(row?.change, { label: 'İlk karar', detail: '', tone: 'gray' })
  const [staffRow] = timelineRows(staff)
  assert.equal(staffRow?.rationale, 'Tespit sonucu')
  assert.equal(staffRow?.decidedBy, 'Selin Kaya')
})

// OG-079 (IST-060): çizelge süzgeci, değişim, kanıt özeti ve mini grafik.

const decision = (
  id: string,
  skill: CefrStaffTimelineEntry['skill'],
  level: CefrStaffTimelineEntry['level'],
  decidedAt: string,
  previousLevel: CefrStaffTimelineEntry['previousLevel'] = null,
  change: CefrStaffTimelineEntry['change'] = 'first',
): CefrStaffTimelineEntry => ({
  id,
  kind: previousLevel === null ? 'placement' : 'correction',
  skill,
  level,
  decidedAt,
  placementSessionId: null,
  rationale: 'Tespit sonucu',
  decidedByUserId: 'user-1',
  decidedByName: 'Selin Kaya',
  previousLevel,
  change,
  evidence: {
    context: 'placement',
    suggestedLevel: 'A2+',
    followsSuggestion: level === 'A2+',
    successful: 1,
    items: [
      {
        id: 'ev-1',
        taskId: 'task-1',
        title: 'Konuşma bölümü',
        source: 'placement',
        skill: 'speaking',
        targetLevel: 'B1',
        performedAt: '2026-09-30T09:00:00.000Z',
        successful: true,
        percent: 75,
        basis: true,
      },
      {
        id: 'ev-2',
        taskId: 'task-2',
        title: 'Eski görev',
        source: 'task',
        skill: 'speaking',
        targetLevel: 'B2',
        performedAt: '2026-09-20T09:00:00.000Z',
        successful: false,
        percent: 40,
        basis: false,
      },
    ],
  },
})

const staff: CefrProfile = {
  ...base,
  view: 'staff',
  timeline: [
    decision('d4', 'speaking', 'B1', '2026-11-01T09:00:00.000Z', 'A2', 'up'),
    decision('d3', null, 'A2', '2026-10-15T09:00:00.000Z', 'B1', 'down'),
    decision('d2', 'speaking', 'A2', '2026-10-01T09:00:00.000Z'),
    decision('d1', null, 'B1', '2026-10-01T09:00:00.000Z'),
  ],
}

test('IST-060: süzgeç "Tümü" ve kararı olan beceriler; tek becerili çizelgede süzgeç yok', () => {
  assert.deepEqual(
    timelineFilterOptions(staff).map((option) => [option.value, option.label, option.count]),
    [
      ['all', 'Tümü', 4],
      ['general', GENERAL_LEVEL_LABEL, 2],
      ['speaking', 'Konuşma', 2],
    ],
  )
  assert.deepEqual(timelineFilterOptions(base), [])
})

test('IST-060: süzgeç satırları daraltır; değişim önceki seviyeyle yazılır', () => {
  assert.deepEqual(
    timelineRows(staff).map((row) => row.key),
    ['d4', 'd3', 'd2', 'd1'],
  )
  const speaking = timelineRows(staff, 'speaking')
  assert.deepEqual(
    speaking.map((row) => [row.key, row.change.label, row.change.detail, row.change.tone]),
    [
      ['d4', 'Yükseldi', 'A2 → B1', 'green'],
      ['d2', 'İlk karar', '', 'gray'],
    ],
  )
  assert.deepEqual(
    timelineRows(staff, 'general').map((row) => [row.key, row.change.label]),
    [
      ['d3', 'Düştü'],
      ['d1', 'İlk karar'],
    ],
  )
})

test('IST-060: kanıt özeti karar anının önerisini ve görevlerini anlatır', () => {
  const evidence = timelineRows(staff, 'speaking')[0]?.evidence
  assert.equal(evidence?.summary, '2 kanıt görevi, 1 başarılı')
  assert.equal(evidence?.suggestion, 'Seviye tespiti önerisi: A2+ (karar öneriden farklı)')
  assert.deepEqual(
    evidence?.items.map((item) => [item.title, item.note]),
    [
      ['Konuşma bölümü', 'Konuşma · hedef B1 · %75 · başarılı · öneriye dayanak'],
      ['Eski görev', 'Konuşma · hedef B2 · %40 · başarısız'],
    ],
  )
  const empty = timelineRows({
    ...staff,
    timeline: [
      {
        ...decision('d9', null, 'A2+', '2026-10-01T09:00:00.000Z'),
        evidence: {
          context: 'general',
          suggestedLevel: null,
          followsSuggestion: null,
          successful: 0,
          items: [],
        },
      },
    ],
  })[0]?.evidence
  assert.equal(empty?.summary, 'Karar anında kayıtlı kanıt yok')
  assert.equal(empty?.suggestion, 'Genel öneri: kanıt yetersizdi')
})

test('IST-060: mini grafik yalnız seçili becerinin gerçek kararlarından; "Tümü"nde ve tek kararda yok', () => {
  const chart = levelChart(staff, 'speaking')
  assert.ok(chart)
  assert.equal(chart.label, 'Konuşma seviye grafiği')
  assert.deepEqual(
    chart.points.map((point) => [point.key, point.x, point.level]),
    [
      ['d2', 0, 'A2'],
      ['d4', 1, 'B1'],
    ],
  )
  assert.ok(chart.points[1]!.y > chart.points[0]!.y)
  assert.match(chart.summary, /^2 karar: A2 \(.+\) → B1 \(.+\)$/)
  assert.equal(levelChart(staff, 'all'), null)
  assert.equal(levelChart(base, 'general'), null)
  assert.equal(levelChart(staff, 'reading'), null)
})
