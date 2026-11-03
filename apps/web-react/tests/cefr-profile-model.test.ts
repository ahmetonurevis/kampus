import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  CefrProfile,
  CefrProfileStaff,
  CefrStaffTimelineEntry,
} from '@kampus/react-shared/cefr.ts'
import {
  currentLevelRows,
  estimateEvidenceRows,
  estimateSkillRows,
  estimateSummary,
  evidenceHref,
  excludedEvidenceRows,
  GENERAL_LEVEL_LABEL,
  insufficientReason,
  levelChart,
  placementRows,
  resolveTimelineFilter,
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

const staff: CefrProfileStaff = {
  ...base,
  view: 'staff',
  estimate: { ...base.estimate, excluded: [] },
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

test('IST-060: kararlar tek becerideyse süzgeç çıkmaz, grafik "Tümü"nde o beceriyle çizilir', () => {
  const single: CefrProfileStaff = {
    ...staff,
    timeline: staff.timeline.filter((row) => row.skill === 'speaking'),
  }
  assert.deepEqual(timelineFilterOptions(single), [])
  const chart = levelChart(single, 'all')
  assert.equal(chart?.label, 'Konuşma seviye grafiği')
  assert.deepEqual(
    chart?.points.map((point) => point.key),
    ['d2', 'd4'],
  )
  // Tek beceride tek karar: grafik yok.
  assert.equal(levelChart({ ...single, timeline: [single.timeline[0]!] }, 'all'), null)
})

test('IST-060: süzgeç yeni kursiyerin seçeneklerinde yoksa "Tümü"ne döner', () => {
  const options = timelineFilterOptions(staff)
  assert.equal(resolveTimelineFilter(options, 'speaking'), 'speaking')
  assert.equal(resolveTimelineFilter(options, 'reading'), 'all')
  // Süzgeci çıkmayan (tek becerili) kursiyere geçince eski seçim kalmaz.
  assert.equal(resolveTimelineFilter(timelineFilterOptions(base), 'speaking'), 'all')
})

// OG-247 (DOM-BEC-031…034): tahmini seviyenin kanıt görevleri, bağlantıları ve yetersiz kanıt nedeni.

const ASSIGNMENT_ID = '00000000-0000-4000-8000-0000a0000001'
const withEvidence: CefrProfileStaff['estimate'] = {
  ...base.estimate,
  evidence: [
    {
      id: 'attempt-1',
      title: 'Okuma değerlendirmesi',
      source: 'task',
      task: { assignmentId: ASSIGNMENT_ID, scoring: 'auto', linkable: true },
      skill: 'reading',
      targetLevel: 'B1',
      performedAt: '2026-10-01T09:00:00.000Z',
      expiresAt: '2027-01-29T09:00:00.000Z',
      successful: true,
      percent: 80,
    },
    {
      id: 'section-1',
      title: 'Seviye tespiti · Konuşma',
      source: 'placement',
      task: null,
      skill: 'speaking',
      targetLevel: 'A2',
      performedAt: '2026-10-20T09:00:00.000Z',
      expiresAt: '2027-01-18T09:00:00.000Z',
      successful: false,
      percent: 40,
    },
  ],
  excluded: [
    {
      id: 'version-1',
      title: '',
      reason: 'unscored',
      task: { assignmentId: ASSIGNMENT_ID, scoring: 'rubric', linkable: true },
    },
  ],
}

test('DOM-BEC-034 OG-247: kanıtlar en yeniden eskiye; görev kanıtı görevine bağlanır, tespit bölümü bağlantısız', () => {
  const rows = estimateEvidenceRows(withEvidence, { kind: 'student' })
  assert.deepEqual(
    rows.map((row) => [row.key, row.note, row.successful, row.href]),
    [
      ['section-1', 'Konuşma · hedef A2 · %40 · başarısız · Seviye tespiti', false, null],
      [
        'attempt-1',
        'Okuma · hedef B1 · %80 · başarılı',
        true,
        `/ogrenci/soru-coz?coz=${ASSIGNMENT_ID}`,
      ],
    ],
  )
  assert.match(rows[1]!.until, /tarihine kadar geçerli$/)
  assert.equal(rows[1]!.dateTime, '2026-10-01T09:00:00.000Z')
  // Görev modülü kapalıysa (`null`) bağlantı çizilmez.
  assert.ok(estimateEvidenceRows(withEvidence, null).every((row) => row.href === null))
})

test('OG-247: kanıt görevinin adresi role göre kurulur', () => {
  const auto = { assignmentId: ASSIGNMENT_ID, scoring: 'auto', linkable: true } as const
  const rubric = { assignmentId: ASSIGNMENT_ID, scoring: 'rubric', linkable: true } as const
  assert.equal(
    evidenceHref(auto, { kind: 'staff', role: 'yonetici' }),
    `/yonetici/odevler?gorev=${ASSIGNMENT_ID}`,
  )
  assert.equal(
    evidenceHref(rubric, { kind: 'staff', role: 'ogretmen' }),
    `/ogretmen/odevler?sekme=gorevler&gorev=${ASSIGNMENT_ID}`,
  )
  assert.equal(evidenceHref(rubric, { kind: 'student' }), `/ogrenci/odevler?yaz=${ASSIGNMENT_ID}`)
  assert.equal(
    evidenceHref(auto, { kind: 'parent', childId: 'student-1' }),
    `/veli/akademik-takip?cocuk=student-1&sekme=gorevler&gorev=${ASSIGNMENT_ID}`,
  )
})

test('DOM-BEC-034 OG-247: izleyicinin göremediği atamaya bağlantı çizilmez; kanıt yine listelenir', () => {
  const hidden = (estimate: CefrProfileStaff['estimate']): CefrProfileStaff['estimate'] => ({
    ...estimate,
    evidence: estimate.evidence.map((item) =>
      item.task ? { ...item, task: { ...item.task, linkable: false } } : item,
    ),
    excluded: estimate.excluded.map((item) =>
      item.task ? { ...item, task: { ...item.task, linkable: false } } : item,
    ),
  })
  const teacher = { kind: 'staff', role: 'ogretmen' } as const
  const rows = estimateEvidenceRows(hidden(withEvidence), teacher)
  assert.deepEqual(
    rows.map((row) => [row.key, row.href]),
    [
      ['section-1', null],
      ['attempt-1', null],
    ],
  )
  assert.deepEqual(
    excludedEvidenceRows(hidden(withEvidence), teacher).map((row) => [row.key, row.href]),
    [['version-1', null]],
  )
  assert.ok(
    estimateEvidenceRows(hidden(withEvidence), { kind: 'student' }).every(
      (row) => row.href === null,
    ),
  )
})

test('DOM-BEC-031 OG-247: kanıt sayılmayan sonuç Türkçe nedeniyle listelenir', () => {
  assert.deepEqual(excludedEvidenceRows(withEvidence, { kind: 'staff', role: 'ogretmen' }), [
    {
      key: 'version-1',
      title: 'Adsız görev',
      reason: 'Sonuç henüz puanlanmadı.',
      href: `/ogretmen/odevler?sekme=gorevler&gorev=${ASSIGNMENT_ID}`,
    },
  ])
})

test('DOM-BEC-032 OG-247: yetersiz kanıtın nedeni eksik kanıt ve madde sayısını söyler', () => {
  const row = base.estimate.skills[0]!
  assert.equal(
    insufficientReason({ ...row, missingEvidence: 2, missingItems: 8 }),
    '2 kanıt ve 8 madde daha gerekir',
  )
  assert.equal(
    insufficientReason({ ...row, missingEvidence: 0, missingItems: 4 }),
    '4 madde daha gerekir',
  )
  assert.equal(
    insufficientReason({ ...row, missingEvidence: 0, missingItems: 0 }),
    'Geçerli kanıt yok',
  )
  assert.equal(
    insufficientReason({ ...row, missingEvidence: 0, missingItems: 0, evidenceIds: ['e1'] }),
    'Başarılı kanıt payı ya da farklı gün koşulu sağlanmadı',
  )
})
