import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeStaffSurveyAnswers } from '../packages/school-core/src/lib/finance-staff-surveys.ts'
import {
  FINANCE_TEACHER_FEEDBACK_ROLES,
  isTeacherFeedbackRespondent,
  planTeacherFeedbackArchive,
  planTeacherFeedbackClose,
  planTeacherFeedbackCreate,
  planTeacherFeedbackPublish,
  planTeacherFeedbackResponse,
  planTeacherFeedbackUpdate,
  TEACHER_FEEDBACK_OTHER_GROUP,
  TEACHER_FEEDBACK_RESPONDENT_ROLES,
  TEACHER_FEEDBACK_TEACHER_ROLES,
  TEACHER_FEEDBACK_THRESHOLD_DEFAULT,
  TEACHER_FEEDBACK_TREND_MAX,
  teacherFeedbackCreateSchema,
  teacherFeedbackPhase,
  teacherFeedbackResponseSchema,
  teacherFeedbackResults,
  teacherFeedbackTeacherResult,
  teacherFeedbackTeachersFor,
  teacherFeedbackTrend,
  teacherFeedbackUpdateSchema,
  type TeacherFeedbackDraft,
  type TeacherFeedbackQuestion,
  type TeacherFeedbackSource,
  type TeacherFeedbackStoredResponse,
} from '../packages/school-core/src/lib/finance-teacher-feedback.ts'
import { isDomainError } from './support/domain-error.ts'

// Öğrenci ve veli geri bildirimi: öğretmene yönelik anket (DOM-FIN-159; ON-213; K-532…K-534).

const QUESTIONS: TeacherFeedbackQuestion[] = [
  { kind: 'likert', text: 'Dersi anlaşılır anlatıyor', required: true },
  { kind: 'likert', text: 'Sorularıma zaman ayırıyor', required: false },
  { kind: 'open', text: 'Eklemek istedikleriniz', required: false },
]
const TODAY = '2026-10-06'
const DRAFT: TeacherFeedbackDraft = {
  title: 'Güz dönemi öğretmen geri bildirimi',
  term: '2026–2027 1. dönem',
  openDate: '2026-10-06',
  closeDate: '2026-10-20',
  anonymityThreshold: 5,
  audience: { respondents: ['ogrenci', 'veli'], classIds: [] },
  questions: QUESTIONS,
}
const published = (overrides: Partial<{ closedAt: string | null; openDate: string }> = {}) => ({
  ...DRAFT,
  status: 'published' as const,
  closedAt: null,
  ...overrides,
})
const row = (
  teacherId: string,
  classId: string,
  first: number,
  text: string | null = null,
  second: number | null = null,
): TeacherFeedbackStoredResponse => ({
  teacherId,
  classId,
  answers: [
    { value: first, text: null },
    { value: second, text: null },
    { value: null, text },
  ],
})
const fixedRandom = () => 0

test('DOM-FIN-159: roller — yönetici yönetir, öğretmen kendi sonucunu, öğrenci ve veli yanıtlar (K-532, K-533)', () => {
  assert.deepEqual([...FINANCE_TEACHER_FEEDBACK_ROLES], ['yonetici'])
  assert.deepEqual([...TEACHER_FEEDBACK_TEACHER_ROLES], ['ogretmen'])
  assert.deepEqual([...TEACHER_FEEDBACK_RESPONDENT_ROLES], ['ogrenci', 'veli'])
  assert.equal(isTeacherFeedbackRespondent(DRAFT.audience, 'veli'), true)
  assert.equal(
    isTeacherFeedbackRespondent({ respondents: ['ogrenci'], classIds: [] }, 'veli'),
    false,
  )
  assert.equal(isTeacherFeedbackRespondent(DRAFT.audience, 'ogretmen'), false)
})

test('DOM-FIN-159: taslak şeması — eşik en az 5, hedef kitle ve ölçek sorusu zorunlu (K-532)', () => {
  const body = {
    title: 'Güz anketi',
    term: '1. dönem',
    openDate: '2026-10-06',
    closeDate: '2026-10-20',
    audience: { respondents: ['ogrenci'], classIds: ['9-A'] },
    questions: QUESTIONS,
  }
  assert.equal(teacherFeedbackCreateSchema.safeParse(body).success, true)
  assert.equal(
    teacherFeedbackCreateSchema.safeParse({ ...body, anonymityThreshold: 4 }).success,
    false,
  )
  assert.equal(
    teacherFeedbackCreateSchema.safeParse({ ...body, anonymityThreshold: 21 }).success,
    false,
  )
  assert.equal(
    teacherFeedbackCreateSchema.safeParse({ ...body, audience: { respondents: [], classIds: [] } })
      .success,
    false,
  )
  assert.equal(
    teacherFeedbackCreateSchema.safeParse({
      ...body,
      audience: { respondents: ['ogrenci', 'ogrenci'], classIds: [] },
    }).success,
    false,
  )
  assert.equal(
    teacherFeedbackCreateSchema.safeParse({
      ...body,
      audience: { respondents: ['ogretmen'], classIds: [] },
    }).success,
    false,
  )
  assert.equal(
    teacherFeedbackCreateSchema.safeParse({
      ...body,
      questions: [{ kind: 'open', text: 'Yalnız açık uçlu', required: false }],
    }).success,
    false,
  )
  const dates = teacherFeedbackCreateSchema.safeParse({ ...body, closeDate: '2026-10-01' })
  assert.equal(dates.success, false)
  assert.deepEqual(dates.error?.issues[0]?.path, ['closeDate'])
  assert.equal(
    teacherFeedbackCreateSchema.safeParse({ ...body, closeDate: '2027-01-10' }).success,
    false,
  )
  assert.equal(
    teacherFeedbackCreateSchema.safeParse({ ...body, institutionId: 'x' }).success,
    false,
  )
  assert.equal(teacherFeedbackUpdateSchema.safeParse({}).success, false)
  assert.equal(teacherFeedbackUpdateSchema.safeParse({ term: 'Bahar' }).success, true)
  assert.equal(
    teacherFeedbackResponseSchema.safeParse({ teacherId: '', answers: [] }).success,
    false,
  )
})

test('DOM-FIN-159: taslak açılır, eşik verilmezse 5; bilinmeyen sınıf 422 (K-532)', () => {
  const parsed = teacherFeedbackCreateSchema.parse({
    title: 'Güz anketi',
    term: '1. dönem',
    openDate: '2026-10-06',
    closeDate: '2026-10-20',
    audience: { respondents: ['veli'], classIds: [] },
    questions: QUESTIONS,
  })
  const draft = planTeacherFeedbackCreate(parsed, { unknownClassIds: [] })
  assert.equal(draft.anonymityThreshold, TEACHER_FEEDBACK_THRESHOLD_DEFAULT)
  assert.equal(draft.anonymityThreshold, 5)
  assert.equal(
    planTeacherFeedbackCreate({ ...parsed, anonymityThreshold: 8 }, { unknownClassIds: [] })
      .anonymityThreshold,
    8,
  )
  assert.throws(
    () => planTeacherFeedbackCreate(parsed, { unknownClassIds: ['9-Z'] }),
    isDomainError('teacher_feedback_class_not_found'),
  )
})

test('DOM-FIN-159: taslak düzeltilir; yayımlanmış anket değişmez, birleşen tarih 422', () => {
  const draft = { ...DRAFT, status: 'draft' as const }
  const next = planTeacherFeedbackUpdate(draft, { term: 'Bahar' }, { unknownClassIds: [] })
  assert.equal(next.term, 'Bahar')
  assert.equal(next.title, DRAFT.title)
  assert.throws(
    () => planTeacherFeedbackUpdate(draft, { closeDate: '2026-10-01' }, { unknownClassIds: [] }),
    isDomainError('teacher_feedback_dates_invalid'),
  )
  assert.throws(
    () => planTeacherFeedbackUpdate(draft, { term: 'x1' }, { unknownClassIds: ['9-Z'] }),
    isDomainError('teacher_feedback_class_not_found'),
  )
  assert.throws(
    () =>
      planTeacherFeedbackUpdate(
        { ...DRAFT, status: 'published' },
        { term: 'Bahar' },
        { unknownClassIds: [] },
      ),
    isDomainError('teacher_feedback_not_draft', 'conflict'),
  )
  assert.equal(draft.term, DRAFT.term)
})

test('DOM-FIN-159: aşama ve yaşam döngüsü — yayım, kaldırma, erken kapatma', () => {
  const draft = { ...DRAFT, status: 'draft' as const, closedAt: null }
  assert.equal(teacherFeedbackPhase(draft, TODAY), 'draft')
  assert.equal(teacherFeedbackPhase(published({ openDate: '2026-10-08' }), TODAY), 'scheduled')
  assert.equal(teacherFeedbackPhase(published(), TODAY), 'open')
  assert.equal(teacherFeedbackPhase(published(), '2026-10-20'), 'open')
  assert.equal(teacherFeedbackPhase(published(), '2026-10-21'), 'closed')
  assert.equal(
    teacherFeedbackPhase(published({ closedAt: '2026-10-06T10:00:00.000Z' }), TODAY),
    'closed',
  )

  planTeacherFeedbackPublish(draft, { today: TODAY, unknownClassIds: [] })
  assert.throws(
    () => planTeacherFeedbackPublish(draft, { today: '2026-10-21', unknownClassIds: [] }),
    isDomainError('teacher_feedback_closes_past'),
  )
  assert.throws(
    () => planTeacherFeedbackPublish(draft, { today: TODAY, unknownClassIds: ['9-A'] }),
    isDomainError('teacher_feedback_class_not_found'),
  )
  assert.throws(
    () => planTeacherFeedbackPublish(published(), { today: TODAY, unknownClassIds: [] }),
    isDomainError('teacher_feedback_not_draft', 'conflict'),
  )
  planTeacherFeedbackArchive(draft)
  assert.throws(
    () => planTeacherFeedbackArchive(published()),
    isDomainError('teacher_feedback_not_draft', 'conflict'),
  )

  planTeacherFeedbackClose(published(), TODAY)
  planTeacherFeedbackClose(published({ openDate: '2026-10-08' }), TODAY)
  assert.throws(
    () => planTeacherFeedbackClose(draft, TODAY),
    isDomainError('teacher_feedback_close_draft', 'conflict'),
  )
  assert.throws(
    () => planTeacherFeedbackClose(published({ closedAt: '2026-10-06T10:00:00.000Z' }), TODAY),
    isDomainError('teacher_feedback_already_closed', 'conflict'),
  )
  assert.throws(
    () => planTeacherFeedbackClose(published(), '2026-10-21'),
    isDomainError('teacher_feedback_already_closed', 'conflict'),
  )
})

const SOURCE: TeacherFeedbackSource = {
  students: [
    { id: 's-1', classId: '9-A', isActive: true },
    { id: 's-2', classId: '9-B', isActive: true },
    { id: 's-3', classId: '9-A', isActive: false },
    { id: 's-4', classId: '10-A' },
  ],
  classes: [
    { id: '9-A', teacherId: 't-1' },
    { id: '9-B', teacherId: 't-3' },
    { id: '10-A', teacherId: 't-5' },
  ],
  assignments: [
    { classId: '9-A', teacherId: 't-2' },
    { classId: '9-A', teacherId: 't-4' },
    { classId: '9-B', teacherId: 't-2' },
    { classId: '10-A', teacherId: 't-1' },
  ],
  teachers: [
    { id: 't-1' },
    { id: 't-2', isActive: true },
    { id: 't-3', deletedAt: null },
    { id: 't-4', isActive: false },
    { id: 't-5', deletedAt: '2026-09-01T00:00:00.000Z' },
  ],
}

test('DOM-FIN-159: öğrenci kendi sınıfının, veli çocuklarının öğretmenlerini değerlendirir (K-533)', () => {
  const student = teacherFeedbackTeachersFor(SOURCE, new Set(['s-1']), [])
  // t-4 pasif; sınıf öğretmeni ve derse giren öğretmen.
  assert.deepEqual(
    [...student],
    [
      ['t-1', '9-A'],
      ['t-2', '9-A'],
    ],
  )
  const parent = teacherFeedbackTeachersFor(SOURCE, new Set(['s-1', 's-2']), [])
  assert.deepEqual([...parent].sort(), [
    ['t-1', '9-A'],
    ['t-2', '9-A'],
    ['t-3', '9-B'],
  ])
  // Sınıf süzgeci: yalnız 9-B; t-2 kırılımda 9-B'ye düşer.
  assert.deepEqual(
    [...teacherFeedbackTeachersFor(SOURCE, new Set(['s-1', 's-2']), ['9-B'])],
    [
      ['t-3', '9-B'],
      ['t-2', '9-B'],
    ],
  )
  // Pasif öğrenci kapsam vermez; silinmiş öğretmen sayılmaz.
  assert.equal(teacherFeedbackTeachersFor(SOURCE, new Set(['s-3']), []).size, 0)
  assert.deepEqual([...teacherFeedbackTeachersFor(SOURCE, new Set(['s-4']), [])], [['t-1', '10-A']])
  assert.equal(teacherFeedbackTeachersFor(SOURCE, new Set(), []).size, 0)
})

test('DOM-FIN-159: yanıt yalnız açık ankette, uygun öğretmene ve bir kez; cevaplar denetlenir (K-533)', () => {
  const eligible = new Map([['t-1', '9-A']])
  const input = { teacherId: 't-1', answers: [{ value: 4 }, {}, { text: 'Çok iyi' }] }
  const plan = planTeacherFeedbackResponse(
    published(),
    { eligible, responded: false, today: TODAY },
    input,
  )
  assert.equal(plan.classId, '9-A')
  assert.deepEqual(plan.answers, [
    { value: 4, text: null },
    { value: null, text: null },
    { value: null, text: 'Çok iyi' },
  ])
  const checks = { eligible, responded: false, today: TODAY }
  assert.throws(
    () => planTeacherFeedbackResponse(published({ openDate: '2026-10-08' }), checks, input),
    isDomainError('teacher_feedback_not_open'),
  )
  assert.throws(
    () => planTeacherFeedbackResponse(published(), { ...checks, today: '2026-10-21' }, input),
    isDomainError('teacher_feedback_closed'),
  )
  assert.throws(
    () =>
      planTeacherFeedbackResponse(
        published({ closedAt: '2026-10-06T08:00:00.000Z' }),
        checks,
        input,
      ),
    isDomainError('teacher_feedback_closed'),
  )
  assert.throws(
    () => planTeacherFeedbackResponse(published(), checks, { ...input, teacherId: 't-9' }),
    isDomainError('teacher_feedback_teacher_not_eligible'),
  )
  assert.throws(
    () => planTeacherFeedbackResponse(published(), { ...checks, responded: true }, input),
    isDomainError('teacher_feedback_already_responded', 'conflict'),
  )
  assert.throws(
    () => planTeacherFeedbackResponse(published(), checks, { ...input, answers: [{ value: 4 }] }),
    isDomainError('teacher_feedback_answers_mismatch'),
  )
  assert.throws(
    () =>
      planTeacherFeedbackResponse(published(), checks, {
        ...input,
        answers: [{ value: 6 }, {}, {}],
      }),
    isDomainError('teacher_feedback_answer_range'),
  )
  assert.throws(
    () =>
      planTeacherFeedbackResponse(published(), checks, {
        ...input,
        answers: [{ text: 'puan değil' }, {}, {}],
      }),
    isDomainError('teacher_feedback_answer_kind'),
  )
  assert.throws(
    () => planTeacherFeedbackResponse(published(), checks, { ...input, answers: [{}, {}, {}] }),
    isDomainError('teacher_feedback_incomplete'),
  )
  // Personel anketinin kodları değişmedi.
  assert.throws(
    () => normalizeStaffSurveyAnswers(QUESTIONS, [{ value: 4 }]),
    isDomainError('staff_survey_answers_mismatch'),
  )
})

test('DOM-FIN-159: sonuç kapanmadan ve 5 yanıttan azken gizli; yorum hiç dönmez (K-532)', () => {
  const four = ['a', 'b', 'c', 'd'].map((text) => row('t-1', '9-A', 5, text))
  const open = teacherFeedbackTeacherResult({
    teacherId: 't-1',
    questions: QUESTIONS,
    threshold: 5,
    closed: false,
    responses: [...four, row('t-1', '9-A', 4, 'e')],
    random: fixedRandom,
  })
  assert.equal(open.visible, false)
  assert.equal(open.hiddenReason, 'not_closed')
  assert.equal(open.responses, 5)
  assert.ok(open.questions.every((question) => question.hidden && question.texts.length === 0))
  const few = teacherFeedbackTeacherResult({
    teacherId: 't-1',
    questions: QUESTIONS,
    threshold: 5,
    closed: true,
    responses: four,
    random: fixedRandom,
  })
  assert.equal(few.hiddenReason, 'below_threshold')
  assert.equal(few.average, null)
  assert.ok(!JSON.stringify(few).includes('"a"'))
})

test('DOM-FIN-159: eşik üstünde ortalama, dağılım ve karışık yorumlar; az cevaplanan soru gizli (K-532)', () => {
  const responses = [
    row('t-1', '9-A', 5, 'Bir', 4),
    row('t-1', '9-A', 4, 'İki', 4),
    row('t-1', '9-A', 3, null, 5),
    row('t-1', '9-A', 4, 'Üç'),
    row('t-1', '9-A', 2, 'Dört'),
    row('t-1', '9-A', 5, 'Beş'),
  ]
  const result = teacherFeedbackTeacherResult({
    teacherId: 't-1',
    questions: QUESTIONS,
    threshold: 5,
    closed: true,
    responses,
    random: fixedRandom,
  })
  assert.equal(result.visible, true)
  assert.equal(result.responses, 6)
  const [first, second, open] = result.questions
  assert.equal(first?.average, 3.83)
  assert.deepEqual(first?.distribution, [0, 1, 1, 2, 2])
  assert.equal(first?.answered, 6)
  // İkinci soruyu 3 kişi cevapladı: eşik altında gizli.
  assert.equal(second?.hidden, true)
  assert.equal(second?.average, null)
  assert.equal(open?.answered, 5)
  assert.deepEqual([...(open?.texts ?? [])].sort(), ['Beş', 'Bir', 'Dört', 'İki', 'Üç'].sort())
  assert.equal(open?.texts.length, 5)
  // Genel ortalama bütün ölçek cevaplarından: (23 + 13) / 9.
  assert.equal(result.average, 4)
  assert.deepEqual(result.groups, [])
})

test('DOM-FIN-159: eşik altındaki sınıflar birleşir; birleşim eşik altındaysa en küçük sınıf da katılır (K-532)', () => {
  const many = (classId: string, count: number, value: number) =>
    Array.from({ length: count }, () => row('t-1', classId, value))
  const args = { teacherId: 't-1', questions: QUESTIONS, threshold: 5, closed: true }
  const split = teacherFeedbackTeacherResult({
    ...args,
    responses: [
      ...many('9-A', 6, 5),
      ...many('9-B', 5, 3),
      ...many('9-C', 2, 1),
      ...many('9-D', 3, 2),
    ],
    random: fixedRandom,
  })
  assert.deepEqual(split.groups, [
    { key: '9-A', classIds: ['9-A'], responses: 6, average: 5 },
    { key: '9-B', classIds: ['9-B'], responses: 5, average: 3 },
    { key: TEACHER_FEEDBACK_OTHER_GROUP, classIds: ['9-C', '9-D'], responses: 5, average: 1.6 },
  ])
  const complement = teacherFeedbackTeacherResult({
    ...args,
    responses: [...many('9-A', 7, 5), ...many('9-B', 6, 3), ...many('9-C', 2, 1)],
    random: fixedRandom,
  })
  assert.deepEqual(complement.groups, [
    { key: '9-A', classIds: ['9-A'], responses: 7, average: 5 },
    { key: TEACHER_FEEDBACK_OTHER_GROUP, classIds: ['9-B', '9-C'], responses: 8, average: 2.5 },
  ])
  // Tek sınıf ya da hepsi birleşince kırılım boştur.
  const single = teacherFeedbackTeacherResult({
    ...args,
    responses: [...many('9-A', 3, 5), ...many('9-B', 3, 4)],
    random: fixedRandom,
  })
  assert.equal(single.visible, true)
  assert.deepEqual(single.groups, [])
})

test('DOM-FIN-159: anket sonucu öğretmen başına ayrılır', () => {
  const results = teacherFeedbackResults({
    questions: QUESTIONS,
    threshold: 5,
    closed: true,
    responses: [
      ...Array.from({ length: 5 }, () => row('t-2', '9-A', 4)),
      row('t-1', '9-A', 1, 'Tek yorum'),
    ],
    random: fixedRandom,
  })
  assert.deepEqual(
    results.map((result) => [result.teacherId, result.responses, result.visible]),
    [
      ['t-1', 1, false],
      ['t-2', 5, true],
    ],
  )
  assert.ok(!JSON.stringify(results).includes('Tek yorum'))
})

test('DOM-FIN-159: eğilim kapanışa göre sıralı, eşik altı dönem ortalamasız, en çok 12 dönem (K-532)', () => {
  const survey = (index: number, count: number, value: number) => ({
    surveyId: `sv-${String(index).padStart(2, '0')}`,
    title: `Anket ${String(index)}`,
    term: `Dönem ${String(index)}`,
    closeDate: `2026-${String(index).padStart(2, '0')}-01`,
    questions: QUESTIONS,
    threshold: 5,
    responses: Array.from({ length: count }, () => row('t-1', '9-A', value)),
  })
  const trend = teacherFeedbackTrend([survey(3, 5, 4), survey(1, 6, 3), survey(2, 2, 5)])
  assert.deepEqual(
    trend.map((point) => [point.surveyId, point.visible, point.average, point.responses]),
    [
      ['sv-01', true, 3, 6],
      ['sv-02', false, null, 2],
      ['sv-03', true, 4, 5],
    ],
  )
  const long = teacherFeedbackTrend(
    Array.from({ length: 14 }, (_, index) => ({
      ...survey(1, 5, 4),
      surveyId: `sv-${String(index).padStart(2, '0')}`,
      closeDate: `2025-01-${String(index + 1).padStart(2, '0')}`,
    })),
  )
  assert.equal(long.length, TEACHER_FEEDBACK_TREND_MAX)
  assert.equal(long[0]?.surveyId, 'sv-02')
})
