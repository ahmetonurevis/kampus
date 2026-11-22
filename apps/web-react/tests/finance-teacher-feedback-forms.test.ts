import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TeacherFeedbackDetail } from '@kampus/react-shared/use-finance-teacher-feedback.ts'
import {
  emptyTeacherFeedback,
  TEACHER_FEEDBACK_THRESHOLD_OPTIONS,
  teacherFeedbackAudienceText,
  teacherFeedbackAverageText,
  teacherFeedbackCreateBody,
  teacherFeedbackFormSchema,
  teacherFeedbackHiddenText,
  teacherFeedbackParticipationText,
  teacherFeedbackTrendDelta,
  teacherFeedbackUpdateBody,
  teacherFeedbackValues,
} from '../src/pages/finance/finance-teacher-feedback-forms.ts'

// Öğretmen geri bildirim anketi formları (DOM-FIN-159; ON-213; K-532…K-534).

const detail = (overrides: Partial<TeacherFeedbackDetail> = {}): TeacherFeedbackDetail => ({
  id: 'f1',
  title: 'Güz geri bildirimi',
  term: '1. dönem',
  status: 'draft',
  phase: 'draft',
  openDate: '2026-10-06',
  closeDate: '2026-10-19',
  anonymityThreshold: 5,
  audience: { respondents: ['ogrenci'], classIds: ['9-A'] },
  questionCount: 1,
  participation: null,
  publishedAt: null,
  closedAt: null,
  createdAt: '2026-10-06T09:00:00.000Z',
  updatedAt: '2026-10-06T09:00:00.000Z',
  version: 1,
  questions: [{ kind: 'likert', text: 'Dersi anlaşılır anlatıyor', required: true }],
  audienceClasses: [{ id: '9-A', name: '9-A' }],
  ...overrides,
})

test('DOM-FIN-159: yeni form iki hafta açık, eşik 5, öğrenci ve veli; eşik seçenekleri 5–20 (K-532)', () => {
  const values = emptyTeacherFeedback('2026-10-06')
  assert.equal(values.closeDate, '2026-10-19')
  assert.equal(values.anonymityThreshold, '5')
  assert.deepEqual(values.respondents, ['ogrenci', 'veli'])
  assert.equal(TEACHER_FEEDBACK_THRESHOLD_OPTIONS[0], '5')
  assert.equal(TEACHER_FEEDBACK_THRESHOLD_OPTIONS.at(-1), '20')
  assert.equal(TEACHER_FEEDBACK_THRESHOLD_OPTIONS.includes('4'), false)
})

test('DOM-FIN-159: form şeması — başlık, dönem, yanıtlayan ve ölçek sorusu zorunlu', () => {
  const values = { ...emptyTeacherFeedback('2026-10-06'), title: 'Güz anketi', term: '1. dönem' }
  assert.equal(teacherFeedbackFormSchema.safeParse(values).success, true)
  assert.equal(teacherFeedbackFormSchema.safeParse({ ...values, respondents: [] }).success, false)
  assert.equal(teacherFeedbackFormSchema.safeParse({ ...values, term: 'x' }).success, false)
  const onlyOpen = teacherFeedbackFormSchema.safeParse({
    ...values,
    questions: [{ kind: 'open', text: 'Eklemek istedikleriniz', required: false }],
  })
  assert.equal(onlyOpen.success, false)
  const dates = teacherFeedbackFormSchema.safeParse({ ...values, closeDate: '2026-10-01' })
  assert.deepEqual(dates.error?.issues[0]?.path, ['closeDate'])
})

test('DOM-FIN-159: gövde kırpılır; düzeltmede yalnız değişen alanlar gider', () => {
  const survey = detail()
  const values = teacherFeedbackValues(survey)
  assert.equal(teacherFeedbackUpdateBody(survey, values), null)
  const body = teacherFeedbackCreateBody({ ...values, title: '  Bahar anketi  ' })
  assert.equal(body.title, 'Bahar anketi')
  assert.equal(body.anonymityThreshold, 5)
  assert.deepEqual(
    teacherFeedbackUpdateBody(survey, {
      ...values,
      term: '2. dönem',
      anonymityThreshold: '7',
      classIds: ['9-A', '9-B'],
    }),
    {
      term: '2. dönem',
      anonymityThreshold: 7,
      audience: { respondents: ['ogrenci'], classIds: ['9-A', '9-B'] },
    },
  )
})

test('DOM-FIN-159: hedef kitle, katılım ve gizli sonuç metinleri (K-532, K-533)', () => {
  assert.equal(teacherFeedbackAudienceText(detail()), 'Öğrenci · 9-A')
  assert.equal(
    teacherFeedbackAudienceText({ audience: { respondents: ['ogrenci', 'veli'], classIds: [] } }),
    'Öğrenci, Veli · bütün sınıflar',
  )
  assert.equal(
    teacherFeedbackAudienceText({ audience: { respondents: ['veli'], classIds: ['a', 'b'] } }),
    'Veli · 2 sınıf',
  )
  assert.equal(teacherFeedbackParticipationText(detail()), 'Taslak; yayımlanınca katılım izlenir.')
  assert.equal(
    teacherFeedbackParticipationText({ participation: { responses: 12, respondents: 7 } }),
    '12 değerlendirme · 7 kişi',
  )
  assert.equal(teacherFeedbackHiddenText({ hiddenReason: null, responses: 6, threshold: 5 }), null)
  assert.match(
    teacherFeedbackHiddenText({ hiddenReason: 'not_closed', responses: 3, threshold: 5 }) ?? '',
    /kapanınca/,
  )
  assert.match(
    teacherFeedbackHiddenText({ hiddenReason: 'below_threshold', responses: 3, threshold: 5 }) ??
      '',
    /en az 5 yanıt.*3 yanıt.*Yorumlar gösterilmez/,
  )
  assert.equal(teacherFeedbackAverageText(4.25), '4,25')
  assert.equal(teacherFeedbackAverageText(null), '—')
})

test('DOM-FIN-159: eğilim değişimi önceki görünür döneme göre (K-532)', () => {
  const trend = [
    { visible: true, average: 3.5 },
    { visible: false, average: null },
    { visible: true, average: 3.9 },
    { visible: true, average: 3.65 },
    { visible: true, average: 3.65 },
  ]
  assert.equal(teacherFeedbackTrendDelta(trend, 0), null)
  assert.equal(teacherFeedbackTrendDelta(trend, 1), null)
  assert.equal(teacherFeedbackTrendDelta(trend, 2), '+0,40')
  assert.equal(teacherFeedbackTrendDelta(trend, 3), '−0,25')
  assert.equal(teacherFeedbackTrendDelta(trend, 4), '0,00')
  assert.equal(teacherFeedbackTrendDelta(trend, 9), null)
})
