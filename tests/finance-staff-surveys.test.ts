import assert from 'node:assert/strict'
import test from 'node:test'

import { meetsAnonymityThreshold } from '../packages/school-core/src/lib/finance-staff-feedback.ts'
import {
  FINANCE_STAFF_SURVEY_ROLES,
  normalizeStaffSurveyAnswers,
  planStaffSurveyArchive,
  planStaffSurveyCopy,
  planStaffSurveyCreate,
  planStaffSurveyPublish,
  planStaffSurveyResponse,
  planStaffSurveyUpdate,
  STAFF_SURVEY_NO_UNIT,
  STAFF_SURVEY_RESPONDENT_ROLES,
  staffSurveyCreateSchema,
  staffSurveyParticipants,
  staffSurveyParticipation,
  staffSurveyPhase,
  staffSurveyResponseSchema,
  staffSurveyResult,
  staffSurveyUpdateSchema,
  visibleAnonymousGroups,
  type StaffSurveyAnswer,
  type StaffSurveyDraft,
  type StaffSurveyQuestion,
  type StaffSurveyStoredResponse,
} from '../packages/school-core/src/lib/finance-staff-surveys.ts'
import { isDomainError } from './support/domain-error.ts'

// Anonim personel memnuniyet anketi (DOM-FIN-143; ON-191; K-484…K-486).

const QUESTIONS: StaffSurveyQuestion[] = [
  { kind: 'likert', text: 'İş yükümü dengeli buluyorum', required: true },
  { kind: 'enps', text: 'Kurumu çalışma yeri olarak tavsiye eder misiniz?', required: true },
  { kind: 'open', text: 'Eklemek istedikleriniz', required: false },
]
const UNIT_A = '00000000-0000-4000-8000-00000000000a'
const UNIT_B = '00000000-0000-4000-8000-00000000000b'
const UNIT_C = '00000000-0000-4000-8000-00000000000c'

const draft = (overrides: Partial<StaffSurveyDraft> = {}): StaffSurveyDraft => ({
  title: '2026 güz memnuniyet anketi',
  openDate: '2026-10-05',
  closeDate: '2026-10-20',
  anonymityThreshold: 3,
  audience: { roles: [], unitIds: [] },
  questions: QUESTIONS,
  ...overrides,
})
const survey = (
  status: 'draft' | 'published' | 'archived',
  overrides: Partial<StaffSurveyDraft> = {},
) => ({
  ...draft(overrides),
  status,
  revision: 1,
})
const sequence = (values: number[]) => {
  let index = 0
  return () => values[index++ % values.length] ?? 0
}
const response = (
  unitId: string | null,
  value: number,
  enps: number,
  text: string | null = null,
): StaffSurveyStoredResponse => ({
  unitId,
  answers: [
    { value, text: null },
    { value: enps, text: null },
    { value: null, text },
  ],
})

test('DOM-FIN-143: roller — anketi yönetici yönetir, personel yanıtlar (K-484, K-485)', () => {
  assert.deepEqual([...FINANCE_STAFF_SURVEY_ROLES], ['yonetici'])
  assert.deepEqual([...STAFF_SURVEY_RESPONDENT_ROLES], ['yonetici', 'ogretmen', 'onburo'])
})

test('DOM-FIN-143: anket şeması — tarih sırası, 90 gün sınırı, eşik 3–10, benzersiz süzgeç (K-484)', () => {
  const valid = {
    title: '  Güz anketi ',
    openDate: '2026-10-05',
    closeDate: '2026-10-20',
    audience: { roles: ['ogretmen'], unitIds: [UNIT_A] },
    questions: QUESTIONS,
  }
  const parsed = staffSurveyCreateSchema.parse(valid)
  assert.equal(parsed.title, 'Güz anketi')
  assert.equal(parsed.anonymityThreshold, undefined)
  assert.equal(
    staffSurveyCreateSchema.safeParse({ ...valid, closeDate: '2026-10-04' }).success,
    false,
  )
  assert.equal(
    staffSurveyCreateSchema.safeParse({ ...valid, closeDate: '2027-01-02' }).success,
    true,
  )
  assert.equal(
    staffSurveyCreateSchema.safeParse({ ...valid, closeDate: '2027-01-03' }).success,
    false,
  )
  assert.equal(
    staffSurveyCreateSchema.safeParse({ ...valid, anonymityThreshold: 2 }).success,
    false,
  )
  assert.equal(
    staffSurveyCreateSchema.safeParse({ ...valid, anonymityThreshold: 11 }).success,
    false,
  )
  assert.equal(
    staffSurveyCreateSchema.safeParse({ ...valid, audience: { roles: ['veli'], unitIds: [] } })
      .success,
    false,
  )
  assert.equal(
    staffSurveyCreateSchema.safeParse({
      ...valid,
      audience: { roles: ['ogretmen', 'ogretmen'], unitIds: [] },
    }).success,
    false,
  )
  assert.equal(staffSurveyCreateSchema.safeParse({ ...valid, questions: [] }).success, false)
  assert.equal(
    staffSurveyCreateSchema.safeParse({
      ...valid,
      questions: [{ kind: 'nps', text: 'Soru metni', required: true }],
    }).success,
    false,
  )
  assert.equal(staffSurveyCreateSchema.safeParse({ ...valid, institutionId: 'x' }).success, false)
  assert.equal(staffSurveyUpdateSchema.safeParse({}).success, false)
  assert.equal(staffSurveyUpdateSchema.safeParse({ title: 'Yeni başlık' }).success, true)
})

test('DOM-FIN-143: taslak açma eşiği kurum ayarından alır, bilinmeyen birimi reddeder (K-484)', () => {
  const input = staffSurveyCreateSchema.parse({
    title: 'Güz anketi',
    openDate: '2026-10-05',
    closeDate: '2026-10-20',
    audience: { roles: [], unitIds: [] },
    questions: QUESTIONS,
  })
  assert.equal(
    planStaffSurveyCreate(input, { defaultThreshold: 5, unknownUnitIds: [] }).anonymityThreshold,
    5,
  )
  assert.equal(
    planStaffSurveyCreate(
      { ...input, anonymityThreshold: 4 },
      { defaultThreshold: 5, unknownUnitIds: [] },
    ).anonymityThreshold,
    4,
  )
  assert.throws(
    () => planStaffSurveyCreate(input, { defaultThreshold: 3, unknownUnitIds: [UNIT_A] }),
    isDomainError('staff_survey_unit_not_found', 'rule'),
  )
})

test('DOM-FIN-143: taslak düzeltilir; yayımlanmış anket değişmez, birleşen tarih denetlenir (K-484)', () => {
  const next = planStaffSurveyUpdate(
    survey('draft'),
    { title: 'Bahar anketi' },
    { unknownUnitIds: [] },
  )
  assert.equal(next.title, 'Bahar anketi')
  assert.deepEqual(next.questions, QUESTIONS)
  assert.throws(
    () =>
      planStaffSurveyUpdate(survey('published'), { title: 'Bahar anketi' }, { unknownUnitIds: [] }),
    isDomainError('staff_survey_not_draft', 'conflict'),
  )
  assert.throws(
    () =>
      planStaffSurveyUpdate(survey('draft'), { closeDate: '2026-10-01' }, { unknownUnitIds: [] }),
    isDomainError('staff_survey_dates_invalid', 'rule'),
  )
  assert.throws(
    () =>
      planStaffSurveyUpdate(survey('draft'), { openDate: '2026-01-01' }, { unknownUnitIds: [] }),
    isDomainError('staff_survey_dates_invalid', 'rule'),
  )
  assert.throws(
    () =>
      planStaffSurveyUpdate(
        survey('draft'),
        { audience: { roles: [], unitIds: [UNIT_A] } },
        { unknownUnitIds: [UNIT_A] },
      ),
    isDomainError('staff_survey_unit_not_found', 'rule'),
  )
})

test('DOM-FIN-143: yayım — yalnız taslak, kapanış geçmemiş, hedef kitle eşik kadar (K-484, K-486)', () => {
  assert.doesNotThrow(() =>
    planStaffSurveyPublish(survey('draft'), { today: '2026-10-20', audienceSize: 3 }),
  )
  assert.throws(
    () => planStaffSurveyPublish(survey('published'), { today: '2026-10-06', audienceSize: 3 }),
    isDomainError('staff_survey_not_draft', 'conflict'),
  )
  assert.throws(
    () => planStaffSurveyPublish(survey('draft'), { today: '2026-10-21', audienceSize: 3 }),
    isDomainError('staff_survey_closes_past', 'rule'),
  )
  assert.throws(
    () =>
      planStaffSurveyPublish(survey('draft', { anonymityThreshold: 4 }), {
        today: '2026-10-06',
        audienceSize: 3,
      }),
    isDomainError('staff_survey_audience_below_threshold', 'rule'),
  )
})

test('DOM-FIN-143: kaldırma yalnız taslakta; yeni sürüm yalnız yayımlanmıştan ve bir kez (K-484)', () => {
  assert.doesNotThrow(() => planStaffSurveyArchive({ status: 'draft' }))
  assert.throws(
    () => planStaffSurveyArchive({ status: 'published' }),
    isDomainError('staff_survey_not_draft', 'conflict'),
  )
  const copy = planStaffSurveyCopy(survey('published'), { copyExists: false })
  assert.equal(copy.revision, 2)
  assert.deepEqual(copy.questions, QUESTIONS)
  assert.notEqual(copy.questions[0], QUESTIONS[0])
  assert.throws(
    () => planStaffSurveyCopy(survey('draft'), { copyExists: false }),
    isDomainError('staff_survey_copy_draft', 'conflict'),
  )
  assert.throws(
    () => planStaffSurveyCopy(survey('published'), { copyExists: true }),
    isDomainError('staff_survey_copy_exists', 'conflict'),
  )
})

test('DOM-FIN-143: aşama İstanbul gününe göre — açılmadı, açık (uçlar dahil), kapandı (K-484)', () => {
  const dates = { openDate: '2026-10-05', closeDate: '2026-10-20' }
  assert.equal(staffSurveyPhase({ status: 'draft', ...dates }, '2026-10-06'), 'draft')
  assert.equal(staffSurveyPhase({ status: 'archived', ...dates }, '2026-10-06'), 'draft')
  assert.equal(staffSurveyPhase({ status: 'published', ...dates }, '2026-10-04'), 'scheduled')
  assert.equal(staffSurveyPhase({ status: 'published', ...dates }, '2026-10-05'), 'open')
  assert.equal(staffSurveyPhase({ status: 'published', ...dates }, '2026-10-20'), 'open')
  assert.equal(staffSurveyPhase({ status: 'published', ...dates }, '2026-10-21'), 'closed')
})

test('DOM-FIN-143: hedef kitle — etkin personel, rol ve birim süzgeci, birim yayım gününde (K-484)', () => {
  const candidates = [
    { membershipId: 'm-yon', role: 'yonetici', active: true, unitIds: [] },
    { membershipId: 'm-ogr', role: 'ogretmen', active: true, unitIds: [UNIT_B, UNIT_A] },
    { membershipId: 'm-onb', role: 'onburo', active: true, unitIds: [UNIT_B] },
    { membershipId: 'm-pasif', role: 'ogretmen', active: false, unitIds: [UNIT_A] },
    { membershipId: 'm-veli', role: 'veli', active: true, unitIds: [] },
  ]
  assert.deepEqual(staffSurveyParticipants(candidates, { roles: [], unitIds: [] }), [
    { membershipId: 'm-yon', unitId: null },
    { membershipId: 'm-ogr', unitId: UNIT_B },
    { membershipId: 'm-onb', unitId: UNIT_B },
  ])
  assert.deepEqual(staffSurveyParticipants(candidates, { roles: ['ogretmen'], unitIds: [] }), [
    { membershipId: 'm-ogr', unitId: UNIT_B },
  ])
  assert.deepEqual(staffSurveyParticipants(candidates, { roles: [], unitIds: [UNIT_A] }), [
    { membershipId: 'm-ogr', unitId: UNIT_A },
  ])
})

test('DOM-FIN-143: cevaplar sorulara göre doğrulanır; Likert 1–5, eNPS 0–10 (K-485)', () => {
  assert.deepEqual(
    normalizeStaffSurveyAnswers(QUESTIONS, [{ value: 4 }, { value: 0 }, { text: '' }]),
    [
      { value: 4, text: null },
      { value: 0, text: null },
      { value: null, text: null },
    ],
  )
  assert.throws(
    () => normalizeStaffSurveyAnswers(QUESTIONS, [{ value: 4 }]),
    isDomainError('staff_survey_answers_mismatch', 'rule'),
  )
  assert.throws(
    () => normalizeStaffSurveyAnswers(QUESTIONS, [{ value: 4, text: 'x' }, { value: 9 }, {}]),
    isDomainError('staff_survey_answer_kind', 'rule'),
  )
  assert.throws(
    () => normalizeStaffSurveyAnswers(QUESTIONS, [{ value: 4 }, { value: 9 }, { value: 3 }]),
    isDomainError('staff_survey_answer_kind', 'rule'),
  )
  assert.throws(
    () => normalizeStaffSurveyAnswers(QUESTIONS, [{ value: 0 }, { value: 9 }, {}]),
    isDomainError('staff_survey_answer_range', 'rule'),
  )
  assert.throws(
    () => normalizeStaffSurveyAnswers(QUESTIONS, [{ value: 5 }, { value: 11 }, {}]),
    isDomainError('staff_survey_answer_range', 'rule'),
  )
  assert.throws(
    () => normalizeStaffSurveyAnswers(QUESTIONS, [{ value: 5 }, {}, {}]),
    isDomainError('staff_survey_incomplete', 'rule'),
  )
  assert.equal(staffSurveyResponseSchema.safeParse({ answers: [{ value: 1.5 }] }).success, false)
  assert.equal(
    staffSurveyResponseSchema.safeParse({ answers: [], membershipId: 'm' }).success,
    false,
  )
})

test('DOM-FIN-143: yanıt yalnız açık ankete ve bir kez; kapanıştan sonra alınmaz (K-485)', () => {
  const published = survey('published')
  const input = { answers: [{ value: 4 }, { value: 9 }, { text: 'Teşekkürler' }] }
  const answers: StaffSurveyAnswer[] = planStaffSurveyResponse(
    published,
    { responded: false },
    input,
    '2026-10-06',
  )
  assert.equal(answers[2]?.text, 'Teşekkürler')
  assert.throws(
    () => planStaffSurveyResponse(published, { responded: true }, input, '2026-10-06'),
    isDomainError('staff_survey_already_responded', 'conflict'),
  )
  assert.throws(
    () => planStaffSurveyResponse(published, { responded: false }, input, '2026-10-04'),
    isDomainError('staff_survey_not_open', 'rule'),
  )
  assert.throws(
    () => planStaffSurveyResponse(published, { responded: false }, input, '2026-10-21'),
    isDomainError('staff_survey_closed', 'rule'),
  )
  assert.throws(
    () => planStaffSurveyResponse(survey('draft'), { responded: false }, input, '2026-10-06'),
    isDomainError('staff_survey_not_open', 'rule'),
  )
})

test('DOM-FIN-143: katılım oranı bir ondalık; katılımcı yoksa boş (K-486)', () => {
  assert.deepEqual(staffSurveyParticipation(3, 1), { participants: 3, responded: 1, rate: 33.3 })
  assert.deepEqual(staffSurveyParticipation(0, 0), { participants: 0, responded: 0, rate: null })
})

test('DOM-FIN-143: tamamlayıcı gizleme — gizli toplam eşik altındaysa en küçük görünen de gizlenir (K-486)', () => {
  assert.equal(meetsAnonymityThreshold(3, 3), true)
  assert.equal(meetsAnonymityThreshold(2, 3), false)
  const visible = (entries: [string, number][]) =>
    [...visibleAnonymousGroups(new Map(entries), 3)].sort()
  assert.deepEqual(
    visible([
      ['a', 5],
      ['b', 4],
    ]),
    ['a', 'b'],
  )
  assert.deepEqual(
    visible([
      ['a', 5],
      ['b', 4],
      ['c', 2],
    ]),
    ['a'],
  )
  assert.deepEqual(
    visible([
      ['a', 5],
      ['b', 2],
      ['c', 1],
    ]),
    ['a'],
  )
  assert.deepEqual(
    visible([
      ['a', 3],
      ['b', 1],
    ]),
    [],
  )
  assert.deepEqual(
    visible([
      ['a', 4],
      ['b', 4],
      ['c', 1],
    ]),
    ['b'],
  )
})

test('DOM-FIN-143: sonuç kapanmadan ve eşik altında gizli (K-486)', () => {
  const rows = [response(UNIT_A, 4, 9), response(UNIT_A, 5, 10), response(UNIT_B, 2, 3)]
  const base = { questions: QUESTIONS, threshold: 3, participants: 5, unit: null, random: () => 0 }
  const open = staffSurveyResult({ ...base, closed: false, responses: rows })
  assert.equal(open.visible, false)
  assert.equal(open.hiddenReason, 'not_closed')
  assert.equal(open.responded, 3)
  assert.equal(open.rate, 60)
  assert.ok(open.questions.every((question) => question.hidden && question.answered === null))
  const few = staffSurveyResult({ ...base, closed: true, responses: rows.slice(0, 2) })
  assert.equal(few.hiddenReason, 'below_threshold')
  assert.deepEqual(few.units, [])
})

test('DOM-FIN-143: dağılım, ortalama, eNPS ve karıştırılmış açık uçlu cevaplar (K-486)', () => {
  const rows = [
    response(UNIT_A, 5, 10, 'Birinci'),
    response(UNIT_A, 4, 9, 'İkinci'),
    response(UNIT_A, 4, 7, null),
    response(UNIT_A, 2, 3, 'Üçüncü'),
  ]
  const result = staffSurveyResult({
    questions: QUESTIONS,
    threshold: 3,
    closed: true,
    participants: 4,
    responses: rows,
    unit: null,
    random: sequence([0.99, 0, 0.5]),
  })
  assert.equal(result.visible, true)
  const [likert, enps, open] = result.questions
  assert.deepEqual(likert?.distribution, [0, 1, 0, 2, 1])
  assert.equal(likert?.average, 3.75)
  assert.equal(likert?.enps, null)
  assert.equal(enps?.distribution.length, 11)
  assert.deepEqual(enps?.enps, { score: 25, promoters: 2, passives: 1, detractors: 1 })
  assert.equal(enps?.average, 7.25)
  assert.equal(open?.answered, 3)
  assert.deepEqual([...(open?.texts ?? [])].sort(), ['Birinci', 'Üçüncü', 'İkinci'].sort())
  assert.notDeepEqual(open?.texts, ['Birinci', 'İkinci', 'Üçüncü'])
  assert.deepEqual(result.units, [{ unit: UNIT_A, responses: 4 }])
})

test('DOM-FIN-143: soru başına eşik — az cevaplanan isteğe bağlı soru gizli (K-486)', () => {
  const rows = [response(null, 5, 10, 'Tek cevap'), response(null, 4, 9), response(null, 3, 8)]
  const result = staffSurveyResult({
    questions: QUESTIONS,
    threshold: 3,
    closed: true,
    participants: 3,
    responses: rows,
    unit: null,
    random: () => 0,
  })
  assert.equal(result.questions[0]?.hidden, false)
  assert.equal(result.questions[2]?.hidden, true)
  assert.deepEqual(result.questions[2]?.texts, [])
  assert.deepEqual(result.units, [{ unit: STAFF_SURVEY_NO_UNIT, responses: 3 }])
})

test('DOM-FIN-143: birim süzgeci eşik altına düşürürse sonuç gösterilmez (K-486)', () => {
  const rows = [
    ...[5, 4, 4, 3].map((value) => response(UNIT_A, value, 9, 'A birimi')),
    ...[2, 3, 3].map((value) => response(UNIT_B, value, 6)),
    response(UNIT_C, 1, 0, 'C birimi'),
    response(null, 5, 10),
  ]
  const base = {
    questions: QUESTIONS,
    threshold: 3,
    closed: true,
    participants: 12,
    responses: rows,
    random: () => 0,
  }
  // C (1) ve birimsiz (1) gizli; gizli toplam 2 < 3 olduğu için en küçük görünen B (3) de gizlenir.
  const all = staffSurveyResult({ ...base, unit: null })
  assert.equal(all.visible, true)
  assert.deepEqual(all.units, [{ unit: UNIT_A, responses: 4 }])
  const unitA = staffSurveyResult({ ...base, unit: UNIT_A })
  assert.equal(unitA.visible, true)
  assert.equal(unitA.questions[0]?.average, 4)
  // Açık uçlu soruyu A'da 4, C'de 1 kişi cevapladı: bütün yanıtlar ile A farkı C'nin tek
  // cevabını verirdi; soru A kırılımında da gizlenir (tamamlayıcı gizleme).
  assert.equal(unitA.questions[2]?.hidden, true)
  assert.deepEqual(unitA.questions[2]?.texts, [])
  assert.equal(all.questions[2]?.hidden, false)
  assert.equal(all.questions[2]?.texts.length, 5)
  for (const unit of [UNIT_B, UNIT_C, STAFF_SURVEY_NO_UNIT]) {
    const hidden = staffSurveyResult({ ...base, unit })
    assert.equal(hidden.visible, false)
    assert.equal(hidden.hiddenReason, 'unit_below_threshold')
    assert.ok(hidden.questions.every((question) => question.hidden))
  }
})

test('DOM-FIN-143: birim kırılımında soru bazında tamamlayıcı gizleme (K-486)', () => {
  // A ve B birimleri görünür (4 + 4); açık uçlu soruyu A'da 3, B'de 1 kişi cevapladı: B'nin tek
  // cevabı bütün yanıtlar ile A farkından bulunamasın diye A'da da gizlenir.
  const rows = [
    response(UNIT_A, 4, 9, 'a1'),
    response(UNIT_A, 4, 9, 'a2'),
    response(UNIT_A, 4, 9, 'a3'),
    response(UNIT_A, 4, 9),
    response(UNIT_B, 3, 6, 'b1'),
    response(UNIT_B, 3, 6),
    response(UNIT_B, 3, 6),
    response(UNIT_B, 3, 6),
  ]
  const base = {
    questions: QUESTIONS,
    threshold: 3,
    closed: true,
    participants: 8,
    responses: rows,
    random: () => 0,
  }
  const unitA = staffSurveyResult({ ...base, unit: UNIT_A })
  assert.equal(unitA.visible, true)
  assert.equal(unitA.questions[0]?.hidden, false)
  assert.equal(unitA.questions[2]?.hidden, true)
  const all = staffSurveyResult({ ...base, unit: null })
  assert.equal(all.questions[2]?.hidden, false)
  assert.equal(all.questions[2]?.answered, 4)
})
