import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  LessonObservationDetail,
  LessonObservationTemplate,
} from '@kampus/react-shared/use-finance-lesson-observations.ts'
import {
  defaultTemplateFormValues,
  emptyCriterion,
  emptyObservationCreate,
  levelLabel,
  needsNote,
  observationCreateBody,
  observationCreateFormSchema,
  observationEditFormSchema,
  observationEditValues,
  observationUpdateBody,
  previewScore,
  scoreText,
  templateFormSchema,
  templateFormValues,
} from '../src/pages/finance/finance-lesson-observation-forms.ts'

// Ders gözlem formu (DOM-FIN-130; ON-206; K-445, K-446).

const levels = [0, 1, 2, 3, 4, 5].map((level) => ({ level, description: `Seviye ${level}` }))
const CRITERIA = [
  { id: 'k1', title: 'Sınıf yönetimi', description: null, weight: 2, levels },
  { id: 'k2', title: 'Öğrenci katılımı', description: 'Katılım', weight: 1, levels },
]
const TEMPLATE: LessonObservationTemplate = {
  id: 't-1',
  versionId: 'v-1',
  versionNumber: 2,
  name: 'Ders gözlem formu',
  criteria: CRITERIA,
  observationCount: 1,
  used: true,
  archivedAt: null,
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
  version: 3,
}
const DETAIL: LessonObservationDetail = {
  id: 'o-1',
  templateId: 't-1',
  templateVersionId: 'v-1',
  templateName: 'Ders gözlem formu',
  templateVersionNumber: 2,
  teacherMembershipId: 'm-selin',
  teacherName: 'Selin Kaya',
  observerMembershipId: 'm-mudur',
  observerName: 'Müdür',
  observedDate: '2026-10-01',
  classId: null,
  className: null,
  subjectId: null,
  subjectName: null,
  performancePeriodId: null,
  ratings: [
    { criterionId: 'k1', level: 4, note: null },
    { criterionId: 'k2', level: null, note: 'Not' },
  ],
  generalNote: null,
  status: 'draft',
  completedAt: null,
  criterionCount: 2,
  ratedCount: 1,
  score: null,
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
  version: 1,
  criteria: CRITERIA,
}

test('DOM-FIN-130 K-445: yeni form önerisi core şemasından geçer; ölçüt altı seviye tanımı taşır', () => {
  const values = defaultTemplateFormValues()
  assert.ok(values.criteria.length >= 3)
  assert.equal(values.criteria[0]?.levels.length, 6)
  assert.equal(templateFormSchema.safeParse(values).success, true)
  assert.equal(emptyCriterion().weight, 1)
  assert.equal(
    templateFormSchema.safeParse({ ...values, criteria: [emptyCriterion()] }).success,
    false,
  )
})

test('DOM-FIN-130 K-445: var olan formun son sürümü düzeltme ya da yeni sürüm başlangıcıdır', () => {
  const values = templateFormValues(TEMPLATE)
  assert.equal(values.name, 'Ders gözlem formu')
  assert.equal(values.criteria[0]?.description, '')
  assert.equal(values.criteria[1]?.description, 'Katılım')
  assert.equal(values.criteria[0]?.weight, 2)
  const parsed = templateFormSchema.parse(values)
  assert.equal(parsed.criteria[0]?.description, null)
})

test('DOM-FIN-130 K-446: gözlem açma gövdesi boş seçimleri göndermez', () => {
  const empty = emptyObservationCreate('2026-11-20')
  assert.equal(empty.observedDate, '2026-11-20')
  assert.equal(observationCreateFormSchema.safeParse(empty).success, false)
  const body = observationCreateBody({
    ...empty,
    templateId: 't-1',
    teacherMembershipId: 'm-selin',
  })
  assert.deepEqual(body, {
    templateId: 't-1',
    teacherMembershipId: 'm-selin',
    observedDate: '2026-11-20',
  })
  const full = observationCreateBody({
    ...empty,
    templateId: 't-1',
    teacherMembershipId: 'm-selin',
    observerMembershipId: 'm-zumre',
    classId: 'c1',
    subjectId: 's1',
    performancePeriodId: 'p-1',
  })
  assert.equal(full.observerMembershipId, 'm-zumre')
  assert.equal(full.classId, 'c1')
  assert.equal(full.subjectId, 's1')
  assert.equal(full.performancePeriodId, 'p-1')
})

test('DOM-FIN-130 K-446: düzeltme formu ölçüt sırasıyla seviye ve notu taşır; gövdede puan yok', () => {
  const values = observationEditValues(DETAIL)
  assert.deepEqual(
    values.ratings.map((rating) => rating.level),
    ['4', ''],
  )
  assert.equal(values.ratings[1]?.note, 'Not')
  assert.equal(observationEditFormSchema.safeParse(values).success, true)
  const body = observationUpdateBody({
    ...values,
    ratings: [
      { criterionId: 'k1', level: '4', note: '' },
      { criterionId: 'k2', level: '2', note: 'Katılım düşük' },
    ],
    generalNote: 'İyi ders',
  })
  assert.deepEqual(body.ratings, [
    { criterionId: 'k1', level: 4, note: '' },
    { criterionId: 'k2', level: 2, note: 'Katılım düşük' },
  ])
  assert.equal('score' in body, false)
})

test('DOM-FIN-130 K-446: puan önizlemesi rubrik kuralıyla; eksik seviyede ilerleme metni', () => {
  assert.equal(previewScore(DETAIL.criteria, observationEditValues(DETAIL).ratings), null)
  const score = previewScore(DETAIL.criteria, [
    { criterionId: 'k1', level: '4', note: '' },
    { criterionId: 'k2', level: '3', note: '' },
  ])
  assert.deepEqual(score, { total: 11, max: 15, percent: 73 })
  assert.equal(scoreText(score, 2, 2), '%73 (11 / 15)')
  assert.equal(scoreText(null, 1, 2), '1 / 2 ölçüt')
  assert.equal(needsNote('2'), true)
  assert.equal(needsNote('3'), false)
  assert.equal(needsNote(''), false)
  assert.equal(levelLabel(3), '3 · Yeterli')
})
