import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PlacementSession, PlacementSessionRow } from '@kampus/react-shared/cefr.ts'
import {
  answeredCount,
  canScoreSection,
  decisionBlockedReason,
  decisionBody,
  decisionDefaults,
  decisionFormSchema,
  learnerOptions,
  openBody,
  openFormSchema,
  placedLevel,
  placementListRow,
  rubricSectionBody,
  rubricSectionSchema,
  sectionRows,
  skillSuggestionRows,
  suggestedLevel,
  validityText,
} from '../src/pages/language/placement-model.ts'

// OG-078 (IST-058; DOM-DIL-010…012): seviye tespiti ekranının sunumu ve form kuralları.

type Section = PlacementSession['sections'][number]
type Suggestion = PlacementSession['suggestion']

const section = (
  key: Section['section'],
  scoring: Section['scoring'],
  status: Section['status'],
  percent: number | null = null,
): Section => ({
  section: key,
  label: key,
  scoring,
  status,
  percent,
  targetLevel: null,
  enteredByUserId: null,
  enteredAt: null,
})

const freshSections = (): Section[] => [
  section('language_use', 'auto', 'pending'),
  section('reading', 'auto', 'pending'),
  section('listening', 'auto', 'pending'),
  section('writing', 'rubric', 'pending'),
  section('speaking', 'rubric', 'pending'),
]

const insufficient = (missing: Array<'reading' | 'writing'>): Suggestion => ({
  context: 'placement',
  computedAt: '2026-11-02T09:00:00.000Z',
  overall: { status: 'insufficient', missingSkills: missing },
  skills: [],
})

const suggested = (level: 'B1' | 'B2'): Suggestion => ({
  context: 'placement',
  computedAt: '2026-11-02T09:00:00.000Z',
  overall: { status: 'suggested', level },
  skills: [
    {
      skill: 'reading',
      label: 'Okuma',
      status: 'suggested',
      level,
      plus: false,
      demonstratedBy: 'placement',
      missingEvidence: 0,
      missingItems: 0,
      evidenceIds: [],
    },
    {
      skill: 'writing',
      label: 'Yazma',
      status: 'insufficient',
      level: null,
      plus: false,
      demonstratedBy: null,
      missingEvidence: 1,
      missingItems: 0,
      evidenceIds: [],
    },
  ],
})

const session = (patch: Partial<PlacementSession> = {}): PlacementSession => ({
  id: 's1',
  learnerKind: 'student',
  learnerId: 'student-1',
  formId: 'f1',
  formVersionId: 'fv1',
  mode: 'in_person',
  startedAt: '2026-11-02T09:00:00.000Z',
  completedAt: null,
  version: 1,
  updatedAt: '2026-11-02T09:00:00.000Z',
  sections: freshSections(),
  validity: { status: 'in_progress', preliminary: false },
  preliminary: false,
  suggestion: insufficient(['reading', 'writing']),
  decisions: [],
  ...patch,
})

const completed = (patch: Partial<PlacementSession> = {}) =>
  session({
    completedAt: '2026-11-02T10:00:00.000Z',
    validity: {
      status: 'valid',
      preliminary: false,
      completedAt: '2026-11-02T10:00:00.000Z',
      validUntil: '2027-01-31T10:00:00.000Z',
    },
    sections: [
      section('language_use', 'auto', 'scored', 70),
      section('reading', 'auto', 'scored', 80),
      section('listening', 'auto', 'scored', 60),
      section('writing', 'rubric', 'scored', 50),
      section('speaking', 'rubric', 'scored', 50),
    ],
    suggestion: suggested('B1'),
    ...patch,
  })

test('IST-058 liste satırı: başlangıç, yer, durum ve geçerlilik sonu (DOM-DIL-011, DOM-DIL-012)', () => {
  const row: PlacementSessionRow = {
    id: 's1',
    learnerKind: 'student',
    learnerId: 'student-1',
    formId: 'f1',
    formVersionId: 'fv1',
    mode: 'remote',
    startedAt: '2026-11-02T09:00:00.000Z',
    completedAt: '2026-11-02T10:00:00.000Z',
    version: 1,
    updatedAt: '2026-11-02T10:00:00.000Z',
    validity: {
      status: 'valid',
      preliminary: true,
      completedAt: '2026-11-02T10:00:00.000Z',
      validUntil: '2027-01-31T10:00:00.000Z',
    },
  } as PlacementSessionRow
  const view = placementListRow(row)
  assert.equal(view.started, '2 Kasım 2026')
  assert.equal(view.mode, 'Uzaktan (ön tespit)')
  assert.equal(view.status, 'Geçerli')
  assert.equal(view.tone, 'green')
  assert.equal(view.completed, '2 Kasım 2026')
  assert.equal(view.until, '31 Ocak 2027')

  const open = placementListRow({
    ...row,
    completedAt: null,
    validity: { status: 'in_progress', preliminary: true },
  })
  assert.equal(open.status, 'Sürüyor')
  assert.equal(open.completed, '')
  assert.equal(open.until, '')
})

test('DOM-DIL-010 önerilen seviye: öneri varsa seviye, yoksa eksik bölümler söylenir', () => {
  const ok = suggestedLevel(completed())
  assert.equal(ok.level, 'B1')
  assert.match(ok.note, /karar değildir/)

  const missing = suggestedLevel(session())
  assert.equal(missing.level, 'Öneri yok')
  assert.equal(missing.note, 'Öneri için eksik bölüm: Okuma, Yazma')

  const none = suggestedLevel(session({ suggestion: insufficient([]) }))
  assert.equal(none.note, 'Öneri için yeterli sonuç yok.')
})

test('DOM-DIL-012 geçerlilik metni: süren, geçerli ve süresi dolmuş', () => {
  assert.equal(validityText(session()), 'Tespit sürüyor')
  assert.equal(validityText(completed()), '31 Ocak 2027 tarihine kadar geçerli')
  assert.equal(
    validityText(
      completed({
        validity: { status: 'expired', preliminary: false, validUntil: '2027-01-31T10:00:00.000Z' },
      }),
    ),
    'Süresi doldu (31 Ocak 2027)',
  )
})

test('IST-058 bölüm girişi: otomatik bölüm yalnız süren oturumda, rubrikli bölüm bittikten sonra da açık', () => {
  const open = session()
  assert.equal(canScoreSection(open, 'reading'), true)
  assert.equal(canScoreSection(open, 'writing'), true)

  const done = session({ completedAt: '2026-11-02T10:00:00.000Z' })
  assert.equal(canScoreSection(done, 'reading'), false)
  assert.equal(canScoreSection(done, 'writing'), true)

  const scored = session({
    sections: [section('reading', 'auto', 'scored', 90), section('writing', 'rubric', 'missing')],
  })
  assert.equal(canScoreSection(scored, 'reading'), false)
  assert.equal(canScoreSection(scored, 'writing'), false)
  assert.equal(canScoreSection(scored, 'speaking'), false)

  const decided = session({
    decisions: [
      {
        id: 'd1',
        kind: 'placement',
        skill: null,
        level: 'B1',
        rationale: 'Uygun',
        decidedByUserId: 'u1',
        decidedAt: '2026-11-02T11:00:00.000Z',
        placementSessionId: 's1',
      },
    ],
  })
  assert.equal(canScoreSection(decided, 'writing'), false)
})

test('IST-058 bölüm satırları: puanlama türü, durum ve yüzde', () => {
  const rows = sectionRows(
    session({
      sections: [
        { ...section('reading', 'auto', 'scored', 80), targetLevel: 'B1' },
        section('listening', 'auto', 'missing'),
        section('writing', 'rubric', 'pending'),
      ],
    }),
  )
  assert.deepEqual(
    rows.map((row) => [row.scoring, row.status, row.result, row.targetLevel, row.canScore]),
    [
      ['Otomatik', 'Puanlandı', '%80', 'B1', false],
      ['Otomatik', 'Formda yok', '—', '—', false],
      ['Rubrikle', 'Girilmedi', '—', '—', true],
    ],
  )
})

test('DOM-DIL-010 beceri önerileri: puanlanmamış becerinin önerisi çıkmaz', () => {
  assert.deepEqual(skillSuggestionRows(session({ suggestion: suggested('B2') })), [
    { key: 'reading', label: 'Okuma', value: 'B2' },
    { key: 'writing', label: 'Yazma', value: 'Sonuç yetersiz' },
  ])
})

test('DOM-DIL-010, DOM-DIL-011, DOM-DIL-012 karar engeli sunucu sırasıyla açıklanır', () => {
  assert.equal(decisionBlockedReason(completed()), null)
  assert.equal(decisionBlockedReason(session()), 'Karar için önce seviye tespitini bitirin.')
  assert.equal(
    decisionBlockedReason(
      completed({ validity: { status: 'valid', preliminary: true, validUntil: 'x' } }),
    ),
    'Uzaktan yapılan ön tespitle yerleştirme kararı verilmez.',
  )
  assert.match(
    decisionBlockedReason(
      completed({ validity: { status: 'expired', preliminary: false, validUntil: 'x' } }),
    ) ?? '',
    /90 günlük geçerliliği doldu/,
  )
  const noProduction = completed({
    sections: [
      section('reading', 'auto', 'scored', 80),
      section('writing', 'rubric', 'pending'),
      section('speaking', 'rubric', 'missing'),
    ].map((row, index) => ({ ...row, label: ['Okuma', 'Yazma', 'Konuşma'][index] ?? row.label })),
  })
  assert.equal(
    decisionBlockedReason(noProduction),
    'Karar için yazma ve konuşma bölümü puanlanmalı.',
  )
  assert.equal(
    decisionBlockedReason(
      completed({
        decisions: [
          {
            id: 'd1',
            kind: 'placement',
            skill: null,
            level: 'B1',
            rationale: 'Uygun',
            decidedByUserId: 'u1',
            decidedAt: '2026-11-02T11:00:00.000Z',
            placementSessionId: 's1',
          },
        ],
      }),
    ),
    'Bu tespit için yerleştirme kararı verildi.',
  )
})

test('DOM-DIL-010 yerleştirilen seviye: genel karar yoksa boş', () => {
  assert.equal(placedLevel({ decisions: [] }), null)
  const decision = (skill: 'reading' | null, level: 'A2' | 'B1') => ({
    id: `d-${level}`,
    kind: 'placement' as const,
    skill,
    level,
    rationale: 'Uygun',
    decidedByUserId: 'u1',
    decidedAt: '2026-11-02T11:00:00.000Z',
    placementSessionId: 's1',
  })
  assert.equal(placedLevel({ decisions: [decision('reading', 'A2'), decision(null, 'B1')] }), 'B1')
})

test('DOM-DIL-010 karar formu başlangıcı: genel seviye ve beceriler önerilerden gelir', () => {
  const defaults = decisionDefaults(session({ suggestion: suggested('B1') }))
  assert.equal(defaults.level, 'B1')
  assert.equal(defaults.skillLevels.reading, 'B1')
  assert.equal(defaults.skillLevels.writing, '')
  assert.equal(defaults.skillLevels.speaking, '')
  assert.equal(defaults.rationale, '')

  assert.equal(decisionDefaults(session()).level, '')
})

test('DOM-DIL-010 karar gövdesi: boş beceri seviyesi gönderilmez, gerekçe zorunlu', () => {
  const defaults = decisionDefaults(session({ suggestion: suggested('B1') }))
  const parsed = decisionFormSchema.safeParse({ ...defaults, rationale: '   ' })
  assert.equal(parsed.success, false)

  const ok = decisionFormSchema.parse({ ...defaults, rationale: ' Rubrik sonuçları uyumlu ' })
  assert.deepEqual(decisionBody(ok, 4), {
    version: 4,
    level: 'B1',
    skillLevels: [{ skill: 'reading', level: 'B1' }],
    rationale: 'Rubrik sonuçları uyumlu',
  })
})

test('IST-058 oturum açma: form tek alanda seçilir ve gövdede ayrılır', () => {
  assert.equal(
    openFormSchema.safeParse({
      learnerKind: 'student',
      learnerId: 's1',
      mode: 'in_person',
      form: '',
    }).success,
    false,
  )
  const values = openFormSchema.parse({
    learnerKind: 'student',
    learnerId: 's1',
    mode: 'in_person',
    form: 'res-1:ver-1',
  })
  assert.deepEqual(openBody(values), {
    learnerKind: 'student',
    learnerId: 's1',
    formId: 'res-1',
    formVersionId: 'ver-1',
    mode: 'in_person',
  })
})

test('IST-058 kişi seçici: ada göre Türkçe sıralı, aramada içerik eşleşir', () => {
  const records = [
    { id: 'a', name: 'Zeynep' },
    { id: 'b', name: 'İlker Yıldız' },
    { id: 'c', name: null },
    { id: 'd', name: 'Ayşe' },
  ]
  assert.deepEqual(
    learnerOptions(records, '').map((option) => option.label),
    ['Ayşe', 'c', 'İlker Yıldız', 'Zeynep'],
  )
  assert.deepEqual(
    learnerOptions(records, ' ilker ').map((option) => option.id),
    ['b'],
  )
  assert.deepEqual(
    learnerOptions(records, 'yşe').map((option) => option.id),
    ['d'],
  )
})

test('IST-058 cevap sayısı: cevaplanan sorular sayılır', () => {
  const items = [{ questionVersionId: 'q1' }, { questionVersionId: 'q2' }]
  assert.equal(answeredCount(items, {}), 0)
  assert.equal(answeredCount(items, { q1: 'a', other: 'x' }), 1)
})

test('DOM-BEC-020 rubrikli bölüm: hedefin altındaki banda yorum gerekir, bant boş olamaz', () => {
  const base = { rubricVersionId: 'rv1', targetLevel: 'B1' }
  const missingBand = rubricSectionSchema.safeParse({
    ...base,
    criteria: [{ criterionId: 'c1', band: null, comment: '' }],
  })
  assert.equal(missingBand.success, false)
  assert.equal(missingBand.error?.issues[0]?.message, 'Bu kritere bant verin.')

  const lowNoComment = rubricSectionSchema.safeParse({
    ...base,
    criteria: [{ criterionId: 'c1', band: 1, comment: '  ' }],
  })
  assert.equal(lowNoComment.success, false)
  assert.equal(
    lowNoComment.error?.issues[0]?.message,
    'Hedefin altındaki banda kısa bir yorum yazın.',
  )

  const badTarget = rubricSectionSchema.safeParse({
    ...base,
    targetLevel: '',
    criteria: [{ criterionId: 'c1', band: 3, comment: '' }],
  })
  assert.equal(badTarget.success, false)

  const ok = rubricSectionSchema.parse({
    ...base,
    criteria: [
      { criterionId: 'c1', band: 4, comment: '' },
      { criterionId: 'c2', band: 1, comment: ' Sınırlı söz varlığı ' },
    ],
  })
  assert.deepEqual(rubricSectionBody('writing', 3, ok), {
    version: 3,
    section: 'writing',
    rubricVersionId: 'rv1',
    targetLevel: 'B1',
    criteria: [
      { criterionId: 'c1', band: 4, comment: null },
      { criterionId: 'c2', band: 1, comment: 'Sınırlı söz varlığı' },
    ],
  })
})
