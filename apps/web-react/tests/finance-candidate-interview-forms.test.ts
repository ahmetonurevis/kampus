import assert from 'node:assert/strict'
import test from 'node:test'

import {
  defaultInterviewTemplateValues,
  evaluationBody,
  evaluationDefaults,
  evaluationFormSchema,
  evaluationNeedsNote,
  interviewPlanBody,
  interviewPlanDefaults,
  interviewPlanField,
  interviewPlanSchema,
  interviewStatusTone,
  interviewSummaryText,
  interviewTemplateBody,
  interviewTemplateFormSchema,
  percentText,
  scoreOptions,
  usesObservationForm,
} from '../src/pages/finance/finance-candidate-interview-forms.ts'

// Aday mülakatı web formlarının saf mantığı (DOM-FIN-138; ON-178; K-469…K-471).

const NOW = new Date('2026-10-06T09:17:00.000Z')
const levels = [0, 1, 2, 3, 4, 5].map((level) => ({ level, description: `Seviye ${level}` }))
const INTERVIEW_FORM = {
  kind: 'interview' as const,
  templateId: 't1',
  versionId: 'v1',
  versionNumber: 1,
  name: 'Mülakat formu',
  scaleMin: 1,
  scaleMax: 5,
  criteria: [
    { id: 'k1', title: 'Alan bilgisi', description: null, weight: 2, levels: [] },
    { id: 'k2', title: 'İletişim', description: null, weight: 1, levels: [] },
  ],
}
const OBSERVATION_FORM = {
  ...INTERVIEW_FORM,
  kind: 'observation' as const,
  scaleMin: 0,
  criteria: INTERVIEW_FORM.criteria.map((criterion) => ({ ...criterion, levels })),
}

test('DOM-FIN-138: yeni mülakat formu önerisi şemadan geçer; gövde boşlukları kırpar (K-470)', () => {
  const values = defaultInterviewTemplateValues()
  assert.equal(values.scaleMax, 5)
  assert.equal(interviewTemplateFormSchema.safeParse(values).success, true)
  assert.deepEqual(
    interviewTemplateBody({
      name: ' Form ',
      scaleMax: 4,
      criteria: [{ title: ' Alan ', description: ' ', weight: 2 }],
    }),
    { name: 'Form', scaleMax: 4, criteria: [{ title: 'Alan', description: '', weight: 2 }] },
  )
})

test('DOM-FIN-138: plan formu ertesi günü önerir; yer ve bağlantı türe göre zorunlu; an Türkiye saati (K-469)', () => {
  const values = interviewPlanDefaults(NOW)
  assert.equal(values.scheduledAt, '2026-10-07T12:00')
  const filled = {
    ...values,
    location: 'Müdür odası',
    templateId: 't1',
    evaluatorMembershipIds: ['m1'],
  }
  assert.equal(interviewPlanSchema.safeParse(filled).success, true)
  const pathOf = (input: unknown) =>
    interviewPlanSchema.safeParse(input).error?.issues[0]?.path.join('.')
  assert.equal(pathOf({ ...filled, location: '' }), 'location')
  assert.equal(pathOf({ ...filled, type: 'online', location: '' }), 'meetingUrl')
  assert.equal(pathOf({ ...filled, type: 'online', meetingUrl: 'http://a.b' }), 'meetingUrl')
  assert.equal(pathOf({ ...filled, evaluatorMembershipIds: [] }), 'evaluatorMembershipIds')
  assert.equal(pathOf({ ...filled, type: 'pre_screen', location: '' }), undefined)
  assert.deepEqual(interviewPlanBody(filled), {
    type: 'in_person',
    scheduledAt: '2026-10-07T12:00:00+03:00',
    location: 'Müdür odası',
    meetingUrl: null,
    templateId: 't1',
    evaluatorMembershipIds: ['m1'],
  })
  assert.equal(interviewPlanField('evaluatorMembershipIds.0'), 'evaluatorMembershipIds')
  assert.equal(interviewPlanField('institutionId'), null)
  assert.equal(usesObservationForm('sample_lesson'), true)
  assert.equal(usesObservationForm('in_person'), false)
})

test('DOM-FIN-138: değerlendirme formu ölçek seçenekleri, örnek derste hedef altı not zorunlu (K-470, K-471)', () => {
  assert.deepEqual(
    scoreOptions(INTERVIEW_FORM).map((option) => option.value),
    ['1', '2', '3', '4', '5'],
  )
  assert.equal(scoreOptions(OBSERVATION_FORM)[0]?.value, '0')
  const defaults = evaluationDefaults(INTERVIEW_FORM)
  assert.deepEqual(
    defaults.ratings.map((rating) => rating.criterionId),
    ['k1', 'k2'],
  )
  assert.equal(evaluationFormSchema(INTERVIEW_FORM).safeParse(defaults).success, false)
  assert.equal(evaluationNeedsNote(INTERVIEW_FORM, '1'), false)
  assert.equal(evaluationNeedsNote(OBSERVATION_FORM, '2'), true)
  assert.equal(evaluationNeedsNote(OBSERVATION_FORM, '3'), false)
  const below = {
    ratings: [
      { criterionId: 'k1', score: '2', note: '' },
      { criterionId: 'k2', score: '4', note: '' },
    ],
    generalNote: 'Gelişime açık.',
  }
  assert.equal(
    evaluationFormSchema(OBSERVATION_FORM).safeParse(below).error?.issues[0]?.path.join('.'),
    'ratings.0.note',
  )
  assert.equal(evaluationFormSchema(INTERVIEW_FORM).safeParse(below).success, true)
  assert.deepEqual(evaluationBody(below), {
    ratings: [
      { criterionId: 'k1', score: 2, note: null },
      { criterionId: 'k2', score: 4, note: null },
    ],
    generalNote: 'Gelişime açık.',
  })
})

test('DOM-FIN-138: özet metni ve durum tonu (K-469)', () => {
  assert.equal(percentText(null), '—')
  assert.equal(
    interviewSummaryText({
      plannedCount: 1,
      completedCount: 2,
      cancelledCount: 1,
      submittedCount: 3,
      interviewAveragePercent: 74,
      sampleLessonAveragePercent: 53,
    }),
    '2 yapıldı · 1 planlı · 1 iptal · mülakat ortalaması 74/100 · örnek ders ortalaması 53/100',
  )
  assert.equal(
    interviewSummaryText({
      plannedCount: 0,
      completedCount: 0,
      cancelledCount: 0,
      submittedCount: 0,
      interviewAveragePercent: null,
      sampleLessonAveragePercent: null,
    }),
    '0 yapıldı · 0 planlı',
  )
  assert.equal(interviewStatusTone('completed'), 'green')
  assert.equal(interviewStatusTone('planned'), 'amber')
  assert.equal(interviewStatusTone('cancelled'), 'gray')
})
