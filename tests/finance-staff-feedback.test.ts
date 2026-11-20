import assert from 'node:assert/strict'
import test from 'node:test'

import type { PerformancePeriodStatus } from '../packages/school-core/src/lib/finance-performance.ts'
import {
  DEFAULT_STAFF_FEEDBACK_SETTINGS,
  FINANCE_STAFF_FEEDBACK_ROLES,
  isStaffFeedbackAssignable,
  isStaffFeedbackOpen,
  isStaffFeedbackResultOpen,
  multiSourceFeedbackResult,
  multiSourceFeedbackSummary,
  normalizeStaffFeedbackAnswers,
  planStaffFeedbackAssignment,
  planStaffFeedbackAssignmentRemove,
  planStaffFeedbackResponse,
  planStaffFeedbackSettings,
  planStaffFeedbackTemplate,
  planStaffFeedbackTemplateUpdate,
  planStaffFeedbackWithdraw,
  staffFeedbackAssignmentCreateSchema,
  staffFeedbackResponseSchema,
  staffFeedbackSettingsSchema,
  staffFeedbackTemplateInputSchema,
  staffFeedbackWithdrawSchema,
  type StaffFeedbackAssignmentChecks,
  type StaffFeedbackQuestion,
  type StaffFeedbackResponseChecks,
  type StaffFeedbackResultInput,
} from '../packages/school-core/src/lib/finance-staff-feedback.ts'

import { isDomainError } from './support/domain-error.ts'

// Çok kaynaklı geri bildirim (DOM-FIN-134; ON-212). Kararlar K-457…K-459.

const QUESTIONS: StaffFeedbackQuestion[] = [
  { kind: 'scale', text: 'Ekip çalışmasına katkısı', required: true },
  { kind: 'open', text: 'Güçlü yanları neler?', required: true },
  { kind: 'open', text: 'Eklemek istedikleriniz', required: false },
]
const at = (status: PerformancePeriodStatus) => ({ status })
const assignment = (input: unknown) => staffFeedbackAssignmentCreateSchema.parse(input)
const response = (input: unknown) => staffFeedbackResponseSchema.parse(input)
const ASSIGN = assignment({
  subjectMembershipId: 'm-1',
  reviewerMembershipId: 'm-2',
  relation: 'peer',
})
const assignChecks = (
  patch: Partial<StaffFeedbackAssignmentChecks> = {},
): StaffFeedbackAssignmentChecks => ({
  period: at('active'),
  enrolled: true,
  reviewer: { role: 'ogretmen', active: true },
  duplicate: false,
  ...patch,
})
const responseChecks = (
  patch: Partial<StaffFeedbackResponseChecks> = {},
): StaffFeedbackResponseChecks => ({
  period: at('active'),
  questions: QUESTIONS,
  subjectUserId: 'u-subject',
  actorUserId: 'u-admin',
  ...patch,
})
const FULL = [{ score: 4 }, { text: 'Paylaşımcı' }, {}]
const pending = { status: 'pending' as const }
const submitted = { status: 'submitted' as const }

test('DOM-FIN-134 K-459: geri bildirim yalnız yöneticiye açıktır; eşik varsayılanı 3', () => {
  assert.deepEqual([...FINANCE_STAFF_FEEDBACK_ROLES], ['yonetici'])
  assert.deepEqual(DEFAULT_STAFF_FEEDBACK_SETTINGS, { peerAnonymityThreshold: 3 })
})

test('DOM-FIN-134 K-457: şablon 1–20 soru; dönemde tek şablon, kapanan dönemde açılmaz', () => {
  const fields = staffFeedbackTemplateInputSchema.parse({ questions: QUESTIONS })
  assert.equal(planStaffFeedbackTemplate(at('planning'), fields, { exists: false }).length, 3)
  assert.equal(staffFeedbackTemplateInputSchema.safeParse({ questions: [] }).success, false)
  assert.throws(
    () => planStaffFeedbackTemplate(at('active'), fields, { exists: true }),
    isDomainError('staff_feedback_template_exists', 'conflict'),
  )
  assert.throws(
    () => planStaffFeedbackTemplate(at('closed'), fields, { exists: false }),
    isDomainError('performance_period_closed', 'conflict'),
  )
})

test('DOM-FIN-134 K-457: yanıt girilen şablonun soruları değişmez', () => {
  const fields = staffFeedbackTemplateInputSchema.parse({ questions: QUESTIONS.slice(0, 1) })
  assert.equal(
    planStaffFeedbackTemplateUpdate(at('active'), fields, { responseCount: 0 }).length,
    1,
  )
  assert.throws(
    () => planStaffFeedbackTemplateUpdate(at('active'), fields, { responseCount: 2 }),
    isDomainError('staff_feedback_template_in_use', 'conflict'),
  )
  assert.throws(
    () => planStaffFeedbackTemplateUpdate(at('closed'), fields, { responseCount: 0 }),
    isDomainError('performance_period_closed', 'conflict'),
  )
})

test('DOM-FIN-134 K-458: aşama listeleri atama, yanıt ve sonuç için ayrıdır', () => {
  assert.deepEqual(
    (['planning', 'active', 'interim', 'evaluation', 'closed'] as const).map((status) => [
      isStaffFeedbackAssignable(status),
      isStaffFeedbackOpen(status),
      isStaffFeedbackResultOpen(status),
    ]),
    [
      [true, false, false],
      [true, true, false],
      [true, true, false],
      [false, false, true],
      [false, false, true],
    ],
  )
})

test('DOM-FIN-134 K-458: atama şeması ilişki türünü ister, kurum kimliği kabul etmez', () => {
  assert.equal(ASSIGN.relation, 'peer')
  assert.equal(
    staffFeedbackAssignmentCreateSchema.safeParse({ ...ASSIGN, relation: 'self' }).success,
    false,
  )
  assert.equal(
    staffFeedbackAssignmentCreateSchema.safeParse({ ...ASSIGN, institutionId: 'x' }).success,
    false,
  )
  assert.equal(
    staffFeedbackAssignmentCreateSchema.safeParse({ ...ASSIGN, reviewerMembershipId: '  ' })
      .success,
    false,
  )
})

test('DOM-FIN-134 K-458: değerlendiren ataması; kendini değerlendirme yok', () => {
  assert.doesNotThrow(() => planStaffFeedbackAssignment(ASSIGN, assignChecks()))
  assert.doesNotThrow(() =>
    planStaffFeedbackAssignment(ASSIGN, assignChecks({ period: at('planning') })),
  )
  const cases: [Partial<StaffFeedbackAssignmentChecks>, string, string][] = [
    [{ period: at('closed') }, 'performance_period_closed', 'conflict'],
    [{ period: at('evaluation') }, 'staff_feedback_assign_closed', 'conflict'],
    [{ enrolled: false }, 'staff_feedback_not_enrolled', 'rule'],
    [{ reviewer: null }, 'staff_feedback_reviewer_not_found', 'rule'],
    [{ reviewer: { role: 'veli', active: true } }, 'staff_feedback_reviewer_not_staff', 'rule'],
    [{ reviewer: { role: 'onburo', active: false } }, 'staff_feedback_reviewer_inactive', 'rule'],
    [{ duplicate: true }, 'staff_feedback_assignment_exists', 'conflict'],
  ]
  for (const [patch, code, kind] of cases)
    assert.throws(
      () => planStaffFeedbackAssignment(ASSIGN, assignChecks(patch)),
      isDomainError(code, kind),
    )
  assert.throws(
    () =>
      planStaffFeedbackAssignment(
        { ...ASSIGN, reviewerMembershipId: 'm-1' },
        assignChecks({ reviewer: { role: 'ogretmen', active: true } }),
      ),
    isDomainError('staff_feedback_self', 'rule'),
  )
})

test('DOM-FIN-134 K-458: yalnız yanıtı girilmemiş atama kaldırılır', () => {
  assert.doesNotThrow(() => planStaffFeedbackAssignmentRemove(pending, at('interim')))
  assert.throws(
    () => planStaffFeedbackAssignmentRemove(submitted, at('active')),
    isDomainError('staff_feedback_responded', 'conflict'),
  )
  assert.throws(
    () => planStaffFeedbackAssignmentRemove(pending, at('evaluation')),
    isDomainError('staff_feedback_assign_closed', 'conflict'),
  )
  assert.throws(
    () => planStaffFeedbackAssignmentRemove(pending, at('closed')),
    isDomainError('performance_period_closed', 'conflict'),
  )
})

test('DOM-FIN-134 K-458: cevaplar şablona uyar; boş metin cevaplanmamıştır', () => {
  assert.deepEqual(
    normalizeStaffFeedbackAnswers(QUESTIONS, [{ score: 3 }, { text: 'x' }, { text: '' }]),
    [
      { score: 3, text: null },
      { score: null, text: 'x' },
      { score: null, text: null },
    ],
  )
  assert.throws(
    () => normalizeStaffFeedbackAnswers(QUESTIONS, [{ score: 3 }]),
    isDomainError('staff_feedback_answers_mismatch', 'rule'),
  )
  assert.throws(
    () => normalizeStaffFeedbackAnswers(QUESTIONS, [{ text: 'metin' }, {}, {}]),
    isDomainError('staff_feedback_answer_kind', 'rule'),
  )
  assert.throws(
    () => normalizeStaffFeedbackAnswers(QUESTIONS, [{ score: 3 }, { score: 2 }, {}]),
    isDomainError('staff_feedback_answer_kind', 'rule'),
  )
})

test('DOM-FIN-134 K-458: yanıt girişi zorunlu soruları ister ve yanıtı gönderir', () => {
  const plan = planStaffFeedbackResponse(
    pending,
    response({ channel: 'email', answers: FULL }),
    responseChecks(),
  )
  assert.equal(plan.channel, 'email')
  assert.deepEqual(plan.answers[1], { score: null, text: 'Paylaşımcı' })
  assert.equal(
    staffFeedbackResponseSchema.safeParse({ channel: 'self_service', answers: [] }).success,
    false,
  )
  assert.equal(
    staffFeedbackResponseSchema.safeParse({ channel: 'paper', answers: [{ score: 6 }] }).success,
    false,
  )
  const cases: [
    { status: 'pending' | 'submitted' },
    Partial<StaffFeedbackResponseChecks>,
    unknown,
    string,
    string,
  ][] = [
    [pending, { period: at('closed') }, FULL, 'performance_period_closed', 'conflict'],
    [pending, { period: at('planning') }, FULL, 'staff_feedback_not_open', 'rule'],
    [pending, { period: at('evaluation') }, FULL, 'staff_feedback_not_open', 'rule'],
    [submitted, {}, FULL, 'staff_feedback_already_responded', 'conflict'],
    [pending, { questions: null }, FULL, 'staff_feedback_template_missing', 'rule'],
    [pending, { actorUserId: 'u-subject' }, FULL, 'staff_feedback_subject_entry', 'rule'],
    [pending, {}, [{ score: 4 }, {}, {}], 'staff_feedback_incomplete', 'rule'],
  ]
  for (const [state, patch, answers, code, kind] of cases)
    assert.throws(
      () =>
        planStaffFeedbackResponse(
          state,
          response({ channel: 'paper', answers }),
          responseChecks(patch),
        ),
      isDomainError(code, kind),
    )
})

test('DOM-FIN-134 K-458: yanıt gerekçeyle geri alınır; yalnız girilmiş yanıtta ve açık dönemde', () => {
  assert.equal(
    planStaffFeedbackWithdraw(submitted, at('interim'), { reason: '  Yanlış form girildi ' }),
    'Yanlış form girildi',
  )
  assert.equal(staffFeedbackWithdrawSchema.safeParse({ reason: 'kısa' }).success, false)
  assert.throws(() => planStaffFeedbackWithdraw(submitted, at('active'), { reason: 'kısa' }))
  assert.throws(
    () => planStaffFeedbackWithdraw(pending, at('active'), { reason: 'Gerekçe metni' }),
    isDomainError('staff_feedback_not_responded', 'conflict'),
  )
  assert.throws(
    () => planStaffFeedbackWithdraw(submitted, at('evaluation'), { reason: 'Gerekçe metni' }),
    isDomainError('staff_feedback_not_open', 'rule'),
  )
  assert.throws(
    () => planStaffFeedbackWithdraw(submitted, at('closed'), { reason: 'Gerekçe metni' }),
    isDomainError('performance_period_closed', 'conflict'),
  )
})

test('DOM-FIN-134 K-459: anonimlik eşiği 3–10; aynı değer 422', () => {
  assert.equal(staffFeedbackSettingsSchema.safeParse({ peerAnonymityThreshold: 2 }).success, false)
  assert.equal(staffFeedbackSettingsSchema.safeParse({ peerAnonymityThreshold: 11 }).success, false)
  assert.equal(
    staffFeedbackSettingsSchema.safeParse({ peerAnonymityThreshold: 3.5 }).success,
    false,
  )
  assert.deepEqual(
    planStaffFeedbackSettings(DEFAULT_STAFF_FEEDBACK_SETTINGS, { peerAnonymityThreshold: 5 }),
    { peerAnonymityThreshold: 5 },
  )
  assert.throws(
    () => planStaffFeedbackSettings(DEFAULT_STAFF_FEEDBACK_SETTINGS, { peerAnonymityThreshold: 3 }),
    isDomainError('staff_feedback_settings_unchanged', 'rule'),
  )
})

test('DOM-FIN-134 K-458: atanan / yanıtlanan oranı toplam ve ilişki türüne göre', () => {
  assert.deepEqual(multiSourceFeedbackSummary([]), {
    assigned: 0,
    responded: 0,
    rate: null,
    pending: 0,
    byRelation: {
      manager: { assigned: 0, responded: 0, rate: null },
      peer: { assigned: 0, responded: 0, rate: null },
    },
  })
  assert.deepEqual(
    multiSourceFeedbackSummary([
      { relation: 'manager', status: 'submitted', total: 1 },
      { relation: 'peer', status: 'submitted', total: 1 },
      { relation: 'peer', status: 'pending', total: 2 },
    ]),
    {
      assigned: 4,
      responded: 2,
      rate: 50,
      pending: 2,
      byRelation: {
        manager: { assigned: 1, responded: 1, rate: 100 },
        peer: { assigned: 3, responded: 1, rate: 33.3 },
      },
    },
  )
})

const peer = (
  answers: StaffFeedbackResultInput['answers'],
  name = 'Meslektaş',
): StaffFeedbackResultInput => ({
  relation: 'peer',
  status: 'submitted',
  reviewerName: name,
  submittedAt: '2026-10-01T09:00:00.000Z',
  answers,
})
const MANAGER: StaffFeedbackResultInput = {
  relation: 'manager',
  status: 'submitted',
  reviewerName: 'Murat Yılmaz',
  submittedAt: '2026-10-02T09:00:00.000Z',
  answers: [
    { score: 5, text: null },
    { score: null, text: 'Planlı' },
    { score: null, text: null },
  ],
}
const answersOf = (score: number, text: string, extra: string | null = null) => [
  { score, text: null },
  { score: null, text },
  { score: null, text: extra },
]

test('DOM-FIN-134 K-459: yönetici yanıtı adıyla döner; meslektaş sonucu açık dönemde gizlidir', () => {
  const result = multiSourceFeedbackResult({
    periodStatus: 'interim',
    questions: QUESTIONS,
    threshold: 3,
    assignments: [
      MANAGER,
      peer(answersOf(4, 'Gizli-1')),
      peer(answersOf(3, 'Gizli-2')),
      peer(answersOf(5, 'Gizli-3')),
      { ...peer(null), status: 'pending' },
    ],
  })
  assert.equal(result.manager.responses.length, 1)
  assert.equal(result.manager.responses[0]?.reviewerName, 'Murat Yılmaz')
  assert.deepEqual(
    { assigned: result.peer.assigned, responded: result.peer.responded, rate: result.peer.rate },
    { assigned: 4, responded: 3, rate: 75 },
  )
  assert.equal(result.peer.visible, false)
  assert.equal(result.peer.hiddenReason, 'period_open')
  assert.deepEqual(result.peer.questions, [])
  assert.equal(JSON.stringify(result).includes('Gizli'), false)
})

test('DOM-FIN-134 K-459: eşik altındaki meslektaş yanıtı hiç gösterilmez', () => {
  const result = multiSourceFeedbackResult({
    periodStatus: 'evaluation',
    questions: QUESTIONS,
    threshold: 3,
    assignments: [peer(answersOf(4, 'Gizli-1')), peer(answersOf(2, 'Gizli-2'))],
  })
  assert.equal(result.peer.visible, false)
  assert.equal(result.peer.hiddenReason, 'below_threshold')
  assert.equal(JSON.stringify(result).includes('Gizli'), false)
  assert.equal(JSON.stringify(result).includes('Meslektaş'), false)
})

test('DOM-FIN-134 K-459: eşik üstünde meslektaş sonucu topludur; az cevaplı soru gizlidir', () => {
  const result = multiSourceFeedbackResult({
    periodStatus: 'closed',
    questions: QUESTIONS,
    threshold: 3,
    assignments: [
      MANAGER,
      peer(answersOf(4, 'Zeki', 'Tek ek'), 'Ali'),
      peer(answersOf(3, 'Çalışkan'), 'Büşra'),
      peer(answersOf(4, 'Ağırbaşlı'), 'Can'),
    ],
  })
  assert.equal(result.peer.visible, true)
  assert.equal(result.peer.hiddenReason, null)
  assert.deepEqual(result.peer.questions, [
    {
      kind: 'scale',
      text: 'Ekip çalışmasına katkısı',
      answered: 3,
      hidden: false,
      average: 3.67,
      texts: [],
    },
    {
      kind: 'open',
      text: 'Güçlü yanları neler?',
      answered: 3,
      hidden: false,
      average: null,
      texts: ['Ağırbaşlı', 'Çalışkan', 'Zeki'],
    },
    {
      kind: 'open',
      text: 'Eklemek istedikleriniz',
      answered: 1,
      hidden: true,
      average: null,
      texts: [],
    },
  ])
  // Meslektaşın adı ve tek ek cevabı hiçbir yerde dönmez.
  const json = JSON.stringify(result.peer)
  for (const secret of ['Ali', 'Büşra', 'Can', 'Tek ek']) assert.equal(json.includes(secret), false)
})

test('DOM-FIN-134 K-459: şablon yokken sonuç boştur; eşik kurumdan gelir', () => {
  const result = multiSourceFeedbackResult({
    periodStatus: 'evaluation',
    questions: null,
    threshold: 5,
    assignments: [peer(answersOf(4, 'a')), peer(answersOf(4, 'b')), peer(answersOf(4, 'c'))],
  })
  assert.equal(result.threshold, 5)
  assert.deepEqual(result.questions, [])
  assert.equal(result.peer.hiddenReason, 'below_threshold')
  assert.equal(result.manager.rate, null)
})
