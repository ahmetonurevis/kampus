import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canViewLessonObservation,
  DEFAULT_OBSERVATION_CRITERIA,
  DEFAULT_OBSERVATION_LEVEL_DESCRIPTIONS,
  LESSON_OBSERVATION_MANAGE_ROLES,
  LESSON_OBSERVATION_READ_ROLES,
  lessonObservationCreateSchema,
  lessonObservationScore,
  lessonObservationTemplateInputSchema,
  lessonObservationUpdateSchema,
  OBSERVATION_LEVELS,
  planLessonObservation,
  planLessonObservationArchive,
  planLessonObservationComplete,
  planLessonObservationTemplate,
  planLessonObservationTemplateArchive,
  planLessonObservationTemplateUpdate,
  planLessonObservationTemplateVersion,
  planLessonObservationUpdate,
  ratedCount,
  type LessonObservationChecks,
  type ObservationCriterion,
  type ObservationRating,
} from '../packages/school-core/src/lib/finance-lesson-observations.ts'
import { rubricScore } from '../packages/school-core/src/skills/rubric.ts'

import { isDomainError } from './support/domain-error.ts'

// Ders gözlem formu (DOM-FIN-130; ON-206). Kararlar K-445…K-447.

const TODAY = '2026-11-19'
const levels = () =>
  OBSERVATION_LEVELS.map((level) => ({
    level,
    description: DEFAULT_OBSERVATION_LEVEL_DESCRIPTIONS[level] ?? 'Tanım',
  }))
const TEMPLATE = {
  name: 'Ders gözlem formu',
  criteria: [
    { title: 'Sınıf yönetimi', weight: 2, levels: levels() },
    { title: 'Ders planı', description: 'Akış ve kazanım', weight: 1, levels: levels() },
    { title: 'Öğrenci katılımı', levels: levels() },
  ],
}
const CRITERIA: ObservationCriterion[] = planLessonObservationTemplate(TEMPLATE).criteria
const rated = (...values: (number | null)[]): ObservationRating[] =>
  CRITERIA.map((criterion, index) => ({
    criterionId: criterion.id,
    level: values[index] ?? null,
    note: null,
  }))
const checks = (patch: Partial<LessonObservationChecks> = {}): LessonObservationChecks => ({
  template: { archived: false, criteria: CRITERIA },
  teacher: { membershipId: 'm-selin', role: 'ogretmen', active: true },
  observer: { membershipId: 'm-mudur', role: 'yonetici', active: true },
  classFound: null,
  subjectFound: null,
  period: undefined,
  today: TODAY,
  ...patch,
})
const DAY = { observedDate: '2026-11-10' }
const DRAFT = { status: 'draft' as const, observedDate: '2026-11-10', ratings: rated() }
const recordChecks = { classFound: null, subjectFound: null, period: undefined, today: TODAY }

test('DOM-FIN-130 K-447: şablon ve gözlem yazımı yalnız yönetici; okuma yönetici ve öğretmen', () => {
  assert.deepEqual([...LESSON_OBSERVATION_MANAGE_ROLES], ['yonetici'])
  assert.deepEqual([...LESSON_OBSERVATION_READ_ROLES], ['yonetici', 'ogretmen'])
})

test('DOM-FIN-130 K-445: şablon ölçütleri sırayla kimlik alır, seviyeler 0–5 sıralanır, ağırlık varsayılan 1', () => {
  const plan = planLessonObservationTemplate({
    ...TEMPLATE,
    criteria: [{ title: 'Sınıf yönetimi', levels: levels().reverse() }],
  })
  assert.equal(plan.criteria[0]?.id, 'k1')
  assert.equal(plan.criteria[0]?.weight, 1)
  assert.equal(plan.criteria[0]?.description, null)
  assert.deepEqual(
    plan.criteria[0]?.levels.map((l) => l.level),
    [0, 1, 2, 3, 4, 5],
  )
  assert.deepEqual(
    CRITERIA.map((c) => c.id),
    ['k1', 'k2', 'k3'],
  )
  assert.equal(DEFAULT_OBSERVATION_CRITERIA.length >= 3, true)
})

test('DOM-FIN-130 K-445: eksik seviye, yinelenen ölçüt, sınır dışı ağırlık ve fazladan alan 400', () => {
  const invalid = [
    { ...TEMPLATE, criteria: [{ title: 'Sınıf', levels: levels().slice(1) }] },
    {
      ...TEMPLATE,
      criteria: [
        { title: 'Sınıf', levels: [...levels().slice(1), { level: 1, description: 'x' }] },
      ],
    },
    { ...TEMPLATE, criteria: [TEMPLATE.criteria[0], { ...TEMPLATE.criteria[0], weight: 1 }] },
    { ...TEMPLATE, criteria: [{ ...TEMPLATE.criteria[0], weight: 11 }] },
    { ...TEMPLATE, criteria: [] },
    { ...TEMPLATE, name: 'x' },
    { ...TEMPLATE, institutionId: 'kurum-b' },
  ]
  for (const input of invalid)
    assert.equal(lessonObservationTemplateInputSchema.safeParse(input).success, false)
})

test('DOM-FIN-130 K-445: kullanılmış ya da arşivli sürüm yerinde değişmez; yeni sürüm açılır', () => {
  const patch = planLessonObservationTemplateUpdate(
    { archived: false, used: false },
    { name: 'Yeni ad' },
  )
  assert.deepEqual(patch, { name: 'Yeni ad' })
  assert.throws(
    () => planLessonObservationTemplateUpdate({ archived: false, used: true }, { name: 'Yeni' }),
    isDomainError('observation_template_used', 'conflict'),
  )
  assert.throws(
    () => planLessonObservationTemplateUpdate({ archived: true, used: false }, { name: 'Yeni' }),
    isDomainError('observation_template_archived', 'conflict'),
  )
  assert.throws(() => planLessonObservationTemplateUpdate({ archived: false, used: false }, {}))
  assert.equal(
    planLessonObservationTemplateVersion({ archived: false }, TEMPLATE).criteria.length,
    3,
  )
  assert.throws(
    () => planLessonObservationTemplateVersion({ archived: true }, TEMPLATE),
    isDomainError('observation_template_archived', 'conflict'),
  )
  planLessonObservationTemplateArchive({ archived: false })
  assert.throws(
    () => planLessonObservationTemplateArchive({ archived: true }),
    isDomainError('observation_template_archived', 'conflict'),
  )
})

test('DOM-FIN-130 K-446: gözlem taslağı boş seviyelerle açılır; öğretmen, gözlemci ve kayıt denetimleri', () => {
  assert.deepEqual(planLessonObservation(DAY, checks()), rated())
  const cases: [Partial<LessonObservationChecks>, string, string?][] = [
    [{ template: null }, 'observation_template_not_found'],
    [
      { template: { archived: true, criteria: CRITERIA } },
      'observation_template_archived',
      'conflict',
    ],
    [{ teacher: null }, 'observation_teacher_not_found'],
    [
      { teacher: { membershipId: 'm-veli', role: 'veli', active: true } },
      'observation_not_teacher',
    ],
    [
      { teacher: { membershipId: 'm-selin', role: 'ogretmen', active: false } },
      'observation_teacher_inactive',
    ],
    [{ observer: null }, 'observation_observer_not_found'],
    [
      { observer: { membershipId: 'm-onburo', role: 'onburo', active: true } },
      'observation_observer_invalid',
    ],
    [
      { observer: { membershipId: 'm-eski', role: 'ogretmen', active: false } },
      'observation_observer_invalid',
    ],
    [{ observer: { membershipId: 'm-selin', role: 'ogretmen', active: true } }, 'observation_self'],
    [{ classFound: false }, 'observation_class_not_found'],
    [{ subjectFound: false }, 'observation_subject_not_found'],
  ]
  for (const [patch, code, kind] of cases)
    assert.throws(() => planLessonObservation(DAY, checks(patch)), isDomainError(code, kind))
  // Öğretmen gözlemci olabilir (zümre başkanı, mentor).
  planLessonObservation(
    DAY,
    checks({ observer: { membershipId: 'm-zumre', role: 'ogretmen', active: true } }),
  )
})

test('DOM-FIN-130 K-446: gözlem günü bugünden sonra olamaz; dönem kapalıysa ya da gün dışındaysa ret', () => {
  const period = { status: 'active' as const, startDate: '2026-09-01', endDate: '2027-01-31' }
  const plan = (observedDate: string, patch: Partial<LessonObservationChecks> = {}) =>
    planLessonObservation({ observedDate }, checks(patch))
  plan('2026-11-19')
  plan('2026-11-10', { period })
  assert.throws(() => plan('2026-11-20'), isDomainError('observation_date_future'))
  assert.throws(
    () => plan('2026-11-10', { period: null }),
    isDomainError('observation_period_not_found'),
  )
  assert.throws(
    () => plan('2026-11-10', { period: { ...period, status: 'closed' } }),
    isDomainError('observation_period_closed'),
  )
  assert.throws(
    () => plan('2026-08-31', { period }),
    isDomainError('observation_date_outside_period'),
  )
})

test('DOM-FIN-130 K-446: oluşturma şeması gövdedeki kurum kimliğini ve fazladan puanı reddeder', () => {
  const body = {
    templateId: '7d1b8c58-0a8f-4f55-9f5a-1f1f1f1f1f1f',
    teacherMembershipId: 'm-selin',
    observedDate: '2026-11-10',
  }
  const parsed = lessonObservationCreateSchema.parse({ ...body, classId: '' })
  assert.equal(parsed.classId, null)
  assert.equal(
    lessonObservationCreateSchema.safeParse({ ...body, institutionId: 'b' }).success,
    false,
  )
  assert.equal(lessonObservationCreateSchema.safeParse({ ...body, templateId: '' }).success, false)
  assert.equal(
    lessonObservationUpdateSchema.safeParse({
      ratings: [{ criterionId: 'k1', level: 3, note: null, weighted: 9 }],
    }).success,
    false,
  )
  assert.equal(lessonObservationUpdateSchema.safeParse({ score: 100 }).success, false)
  assert.equal(lessonObservationUpdateSchema.safeParse({}).success, false)
})

test('DOM-FIN-130 K-446: taslak düzeltmesi seviyeleri ölçüt kimliğiyle birleştirir', () => {
  const patch = planLessonObservationUpdate(
    DRAFT,
    CRITERIA,
    lessonObservationUpdateSchema.parse({
      ratings: [{ criterionId: 'k2', level: 4, note: 'İyi akış' }],
      generalNote: 'Genel olarak iyi',
    }),
    recordChecks,
  )
  assert.deepEqual(
    patch.ratings?.map((r) => r.level),
    [null, 4, null],
  )
  assert.equal(patch.ratings?.[1]?.note, 'İyi akış')
  assert.equal(patch.generalNote, 'Genel olarak iyi')
  assert.throws(
    () =>
      planLessonObservationUpdate(
        DRAFT,
        CRITERIA,
        lessonObservationUpdateSchema.parse({
          ratings: [{ criterionId: 'k9', level: 4 }],
        }),
        recordChecks,
      ),
    isDomainError('observation_criterion_invalid'),
  )
  assert.throws(
    () =>
      planLessonObservationUpdate(
        DRAFT,
        CRITERIA,
        lessonObservationUpdateSchema.parse({
          ratings: [
            { criterionId: 'k1', level: 4 },
            { criterionId: 'k1', level: 2 },
          ],
        }),
        recordChecks,
      ),
    isDomainError('observation_criterion_invalid'),
  )
  assert.throws(
    () =>
      planLessonObservationUpdate(
        { ...DRAFT, status: 'completed' },
        CRITERIA,
        lessonObservationUpdateSchema.parse({ generalNote: 'Geç not' }),
        recordChecks,
      ),
    isDomainError('observation_completed', 'conflict'),
  )
})

test('DOM-FIN-130 K-446: gün ya da dönem değişince yeniden denetlenir; yalnız not değişince denetlenmez', () => {
  const closed = { status: 'closed' as const, startDate: '2026-09-01', endDate: '2027-01-31' }
  const noteOnly = planLessonObservationUpdate(
    DRAFT,
    CRITERIA,
    lessonObservationUpdateSchema.parse({ generalNote: 'Not' }),
    { ...recordChecks, period: closed },
  )
  assert.deepEqual(noteOnly, { generalNote: 'Not' })
  assert.throws(
    () =>
      planLessonObservationUpdate(
        DRAFT,
        CRITERIA,
        lessonObservationUpdateSchema.parse({ observedDate: '2026-11-11' }),
        { ...recordChecks, period: closed },
      ),
    isDomainError('observation_period_closed'),
  )
  assert.throws(
    () =>
      planLessonObservationUpdate(
        DRAFT,
        CRITERIA,
        lessonObservationUpdateSchema.parse({ observedDate: '2026-12-01' }),
        recordChecks,
      ),
    isDomainError('observation_date_future'),
  )
  const unlinked = planLessonObservationUpdate(
    DRAFT,
    CRITERIA,
    lessonObservationUpdateSchema.parse({ performancePeriodId: null, classId: '' }),
    recordChecks,
  )
  assert.deepEqual(unlinked, { performancePeriodId: null, classId: null })
  assert.throws(
    () =>
      planLessonObservationUpdate(
        DRAFT,
        CRITERIA,
        lessonObservationUpdateSchema.parse({ subjectId: 'yok' }),
        { ...recordChecks, subjectFound: false },
      ),
    isDomainError('observation_subject_not_found'),
  )
})

test('DOM-FIN-130 K-446: puan rubrik motorunun kuralıyla hesaplanır; eksik seviyede boş', () => {
  assert.equal(lessonObservationScore(CRITERIA, rated(4, 3)), null)
  const score = lessonObservationScore(CRITERIA, rated(4, 3, 5))
  // (4×2 + 3×1 + 5×1) / (5×4) = 16/20 → %80
  assert.deepEqual(score, { total: 16, max: 20, percent: 80 })
  const engine = rubricScore(
    {
      criteria: CRITERIA.map((c) => ({ id: c.id, aspect: 'overall', weight: c.weight, bands: [] })),
    },
    rated(4, 3, 5).map((r) => ({ criterionId: r.criterionId, band: r.level ?? 0 })),
  )
  assert.equal(score?.percent, engine.percent)
  // Tam yarım yukarı yuvarlanır (rubrik kuralı): 3 + 3 + 3 + ... → 9×...
  const half = lessonObservationScore(CRITERIA, rated(2, 1, 2))
  assert.deepEqual(half, { total: 7, max: 20, percent: 35 })
  assert.equal(ratedCount(rated(4, null, 1)), 2)
  assert.equal(lessonObservationScore([], []), null)
})

test('DOM-FIN-130 K-446: tamamlama her seviyeyi, hedef altına notu ve genel değerlendirmeyi ister', () => {
  const full = rated(4, 3, 5)
  const done = { status: 'draft' as const, ratings: full, generalNote: 'Güçlü bir ders' }
  assert.deepEqual(planLessonObservationComplete(done, CRITERIA), {
    total: 16,
    max: 20,
    percent: 80,
  })
  assert.throws(
    () => planLessonObservationComplete({ ...done, ratings: rated(4, 3) }, CRITERIA),
    isDomainError('observation_unrated'),
  )
  assert.throws(
    () => planLessonObservationComplete({ ...done, ratings: rated(4, 2, 5) }, CRITERIA),
    isDomainError('observation_note_required'),
  )
  const withNote = rated(4, 2, 5).map((r) =>
    r.criterionId === 'k2' ? { ...r, note: 'Kazanım belirsizdi' } : r,
  )
  assert.equal(planLessonObservationComplete({ ...done, ratings: withNote }, CRITERIA).total, 15)
  assert.throws(
    () => planLessonObservationComplete({ ...done, generalNote: null }, CRITERIA),
    isDomainError('observation_general_note_required'),
  )
  assert.throws(
    () => planLessonObservationComplete({ ...done, status: 'completed' }, CRITERIA),
    isDomainError('observation_completed', 'conflict'),
  )
})

test('DOM-FIN-130 K-447: yönetici hepsini, gözlemci kendi kaydını, gözlenen yalnız tamamlananı görür', () => {
  const row = {
    teacherMembershipId: 'm-selin',
    observerMembershipId: 'm-zumre',
    status: 'draft' as const,
  }
  const completed = { ...row, status: 'completed' as const }
  assert.equal(canViewLessonObservation({ role: 'yonetici', membershipId: 'm-x' }, row), true)
  assert.equal(canViewLessonObservation({ role: 'ogretmen', membershipId: 'm-zumre' }, row), true)
  assert.equal(canViewLessonObservation({ role: 'ogretmen', membershipId: 'm-selin' }, row), false)
  assert.equal(
    canViewLessonObservation({ role: 'ogretmen', membershipId: 'm-selin' }, completed),
    true,
  )
  assert.equal(
    canViewLessonObservation({ role: 'ogretmen', membershipId: 'm-baska' }, completed),
    false,
  )
  for (const role of ['onburo', 'veli', 'ogrenci'])
    assert.equal(canViewLessonObservation({ role, membershipId: 'm-selin' }, completed), false)
})

test('DOM-FIN-130 K-446: yalnız taslak arşivlenir; tamamlanan gözlem 409', () => {
  planLessonObservationArchive({ status: 'draft' })
  assert.throws(
    () => planLessonObservationArchive({ status: 'completed' }),
    isDomainError('observation_completed', 'conflict'),
  )
})
