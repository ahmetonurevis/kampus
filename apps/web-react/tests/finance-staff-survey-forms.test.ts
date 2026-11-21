import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  AssignedStaffSurvey,
  StaffSurveyDetail,
  StaffSurveyResultView,
} from '@kampus/react-shared/use-finance-staff-surveys.ts'
import type { StaffSurveyQuestion } from '@kampus/school-core/lib/finance-staff-surveys.ts'
import {
  assignedSurveyStatus,
  emptyStaffSurvey,
  STAFF_SURVEY_THRESHOLD_OPTIONS,
  staffSurveyAnswerFormSchema,
  staffSurveyAnswersBody,
  staffSurveyAudienceText,
  staffSurveyAverageText,
  staffSurveyCreateBody,
  staffSurveyEnpsText,
  staffSurveyFormSchema,
  staffSurveyHiddenText,
  staffSurveyParticipationText,
  staffSurveyScaleOptions,
  staffSurveyUpdateBody,
  staffSurveyValues,
} from '../src/pages/finance/finance-staff-survey-forms.ts'

// Personel memnuniyet anketi formları (DOM-FIN-143; ON-191; K-484…K-486).

const QUESTIONS: StaffSurveyQuestion[] = [
  { kind: 'likert', text: 'İş yükümü dengeli buluyorum', required: true },
  { kind: 'enps', text: 'Kurumu tavsiye eder misiniz?', required: true },
  { kind: 'open', text: 'Eklemek istedikleriniz', required: false },
]

const detail = (overrides: Partial<StaffSurveyDetail> = {}): StaffSurveyDetail => ({
  id: 's1',
  title: 'Güz anketi',
  revision: 1,
  sourceSurveyId: null,
  status: 'draft',
  phase: 'draft',
  openDate: '2026-10-06',
  closeDate: '2026-10-19',
  anonymityThreshold: 3,
  audience: { roles: [], unitIds: [] },
  questionCount: 3,
  participation: null,
  publishedAt: null,
  createdAt: '2026-10-06T09:00:00.000Z',
  updatedAt: '2026-10-06T09:00:00.000Z',
  version: 1,
  questions: QUESTIONS,
  audienceSize: 4,
  audienceUnits: [],
  ...overrides,
})

test('DOM-FIN-143: yeni anket iki hafta açık, eNPS ve açık uçlu soru önerir; eşik kurum ayarı (K-484)', () => {
  const values = emptyStaffSurvey('2026-10-06')
  assert.equal(values.openDate, '2026-10-06')
  assert.equal(values.closeDate, '2026-10-19')
  assert.equal(values.anonymityThreshold, '')
  assert.deepEqual(
    values.questions.map((question) => question.kind),
    ['likert', 'enps', 'open'],
  )
  const body = staffSurveyCreateBody({ ...values, title: ' Güz ', questions: QUESTIONS })
  assert.equal(body.title, 'Güz')
  assert.equal('anonymityThreshold' in body, false)
  assert.equal(staffSurveyCreateBody({ ...values, anonymityThreshold: '5' }).anonymityThreshold, 5)
  assert.deepEqual(STAFF_SURVEY_THRESHOLD_OPTIONS, ['3', '4', '5', '6', '7', '8', '9', '10'])
})

test('DOM-FIN-143: form şeması tarih sırasını ve soru metnini denetler (K-484)', () => {
  const values = { ...emptyStaffSurvey('2026-10-06'), title: 'Güz anketi', questions: QUESTIONS }
  assert.equal(staffSurveyFormSchema.safeParse(values).success, true)
  assert.equal(
    staffSurveyFormSchema.safeParse({ ...values, closeDate: '2026-10-01' }).success,
    false,
  )
  assert.equal(
    staffSurveyFormSchema.safeParse({ ...values, questions: [{ ...QUESTIONS[0], text: 'kısa' }] })
      .success,
    false,
  )
})

test('DOM-FIN-143: düzeltme yalnız değişen alanları gönderir; değişiklik yoksa boş (K-484)', () => {
  const survey = detail()
  assert.equal(staffSurveyUpdateBody(survey, staffSurveyValues(survey)), null)
  assert.deepEqual(
    staffSurveyUpdateBody(survey, { ...staffSurveyValues(survey), title: 'Bahar anketi' }),
    { title: 'Bahar anketi' },
  )
  assert.deepEqual(
    staffSurveyUpdateBody(survey, { ...staffSurveyValues(survey), roles: ['ogretmen'] }),
    { audience: { roles: ['ogretmen'], unitIds: [] } },
  )
  const questions = [...QUESTIONS.slice(0, 2)]
  assert.deepEqual(staffSurveyUpdateBody(survey, { ...staffSurveyValues(survey), questions }), {
    questions,
  })
})

test('DOM-FIN-143: yanıt formu zorunlu soruyu ister, gövde sayıya çevrilir (K-485)', () => {
  const schema = staffSurveyAnswerFormSchema(QUESTIONS)
  assert.equal(
    schema.safeParse({
      answers: [
        { value: '4', text: '' },
        { value: '', text: '' },
        { value: '', text: '' },
      ],
    }).success,
    false,
  )
  const values = {
    answers: [
      { value: '4', text: '' },
      { value: '0', text: '' },
      { value: '', text: '  ' },
    ],
  }
  assert.equal(schema.safeParse(values).success, true)
  assert.deepEqual(staffSurveyAnswersBody(QUESTIONS, values), {
    answers: [{ value: 4 }, { value: 0 }, {}],
  })
  assert.deepEqual(staffSurveyScaleOptions('likert'), ['1', '2', '3', '4', '5'])
  assert.equal(staffSurveyScaleOptions('enps').length, 11)
  assert.deepEqual(staffSurveyScaleOptions('open'), [])
})

test('DOM-FIN-143: katılım, hedef kitle ve sonuç metinleri (K-486)', () => {
  assert.equal(staffSurveyParticipationText(detail()), 'Taslak; yayımlanınca katılım izlenir.')
  assert.equal(
    staffSurveyParticipationText({ participation: { participants: 5, responded: 3, rate: 60 } }),
    'Katılım 3 / 5 (%60)',
  )
  assert.equal(staffSurveyAudienceText(detail()), 'Bütün personel')
  assert.equal(
    staffSurveyAudienceText(
      detail({
        audience: { roles: ['ogretmen', 'onburo'], unitIds: ['u1'] },
        audienceUnits: [{ id: 'u1', name: 'Fen zümresi' }],
      }),
    ),
    'Öğretmen, Ön büro · Fen zümresi',
  )
  const result = (overrides: Partial<StaffSurveyResultView>): StaffSurveyResultView => ({
    surveyId: 's1',
    title: 'Güz anketi',
    phase: 'open',
    closeDate: '2026-10-19',
    participants: 5,
    responded: 2,
    rate: 40,
    threshold: 3,
    unit: null,
    visible: false,
    hiddenReason: 'not_closed',
    units: [],
    questions: [],
    ...overrides,
  })
  assert.equal(
    staffSurveyHiddenText(result({})),
    'Sonuçlar anket kapanınca gösterilir (şu an 2 yanıt).',
  )
  assert.equal(
    staffSurveyHiddenText(result({ hiddenReason: 'below_threshold' })),
    'Sonuç gizli: anonimlik için en az 3 yanıt gerekir, 2 yanıt var.',
  )
  assert.match(
    staffSurveyHiddenText(result({ hiddenReason: 'unit_below_threshold' })) ?? '',
    /birimin/,
  )
  assert.equal(staffSurveyHiddenText(result({ hiddenReason: null, visible: true })), null)
  assert.equal(staffSurveyAverageText(3.75), '3,75')
  assert.equal(staffSurveyAverageText(null), '—')
  assert.equal(staffSurveyEnpsText(25), '+25')
  assert.equal(staffSurveyEnpsText(-10), '−10')
  assert.equal(staffSurveyEnpsText(0), '0')
})

test('DOM-FIN-143: personelin anket durumu — yanıtlandı, açılmadı, yanıt bekliyor (K-485)', () => {
  const assigned = (overrides: Partial<AssignedStaffSurvey>): AssignedStaffSurvey => ({
    id: 's1',
    title: 'Güz anketi',
    openDate: '2026-10-06',
    closeDate: '2026-10-19',
    phase: 'open',
    anonymityThreshold: 3,
    questions: QUESTIONS,
    responded: false,
    ...overrides,
  })
  assert.deepEqual(assignedSurveyStatus(assigned({ responded: true })), {
    text: 'Yanıtlandı',
    tone: 'green',
  })
  assert.equal(assignedSurveyStatus(assigned({ phase: 'scheduled' })).text, 'Açılmadı')
  assert.equal(assignedSurveyStatus(assigned({})).text, 'Yanıt bekliyor')
})
