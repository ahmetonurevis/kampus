import assert from 'node:assert/strict'
import test from 'node:test'

import {
  emptySelfEvaluationAnswers,
  FINANCE_SELF_EVALUATION_ROLES,
  isSelfEvaluationOpen,
  normalizeSelfEvaluationAnswers,
  planSelfEvaluation,
  planSelfEvaluationReopen,
  planSelfEvaluationSubmit,
  planSelfEvaluationTemplate,
  planSelfEvaluationTemplateUpdate,
  planSelfEvaluationUpdate,
  selfEvaluationAnsweredCount,
  selfEvaluationCreateSchema,
  selfEvaluationReopenSchema,
  selfEvaluationSummary,
  selfEvaluationTemplateInputSchema,
  selfEvaluationUpdateSchema,
  type SelfEvaluationChecks,
  type SelfEvaluationQuestion,
} from '../packages/school-core/src/lib/finance-self-evaluations.ts'
import type { PerformancePeriodStatus } from '../packages/school-core/src/lib/finance-performance.ts'

import { isDomainError } from './support/domain-error.ts'

// Öz değerlendirme formu (DOM-FIN-131; ON-210). Kararlar K-448…K-450.

const QUESTIONS: SelfEvaluationQuestion[] = [
  { kind: 'scale', text: 'Ders planlarımı zamanında hazırladım', required: true },
  { kind: 'open', text: 'Bu dönemin en güçlü yanınız neydi?', required: true },
  { kind: 'open', text: 'Eklemek istedikleriniz', required: false },
]
const at = (status: PerformancePeriodStatus) => ({ status })
const create = (input: unknown) => selfEvaluationCreateSchema.parse(input)
const update = (input: unknown) => selfEvaluationUpdateSchema.parse(input)
const template = (input: unknown) => selfEvaluationTemplateInputSchema.parse(input)
const checks = (patch: Partial<SelfEvaluationChecks> = {}): SelfEvaluationChecks => ({
  period: at('active'),
  questions: QUESTIONS,
  enrolled: true,
  duplicate: false,
  ...patch,
})
const FULL = [
  { score: 4, text: null },
  { score: null, text: 'Veli iletişimi' },
  { score: null, text: null },
]

test('DOM-FIN-131 K-450: öz değerlendirme yalnız yöneticiye açıktır', () => {
  assert.deepEqual([...FINANCE_SELF_EVALUATION_ROLES], ['yonetici'])
})

test('DOM-FIN-131 K-448: şablon 1–20 soru, soru metni 5–300 ve tür zorunlu', () => {
  assert.equal(template({ questions: QUESTIONS }).questions.length, 3)
  assert.equal(
    template({ questions: [{ ...QUESTIONS[0], text: '  Kısa yanıt  ' }] }).questions[0]?.text,
    'Kısa yanıt',
  )
  for (const bad of [
    { questions: [] },
    { questions: Array.from({ length: 21 }, () => QUESTIONS[0]) },
    { questions: [{ ...QUESTIONS[0], text: 'Kısa' }] },
    { questions: [{ ...QUESTIONS[0], text: 'x'.repeat(301) }] },
    { questions: [{ ...QUESTIONS[0], kind: 'multiple' }] },
    { questions: [{ kind: 'scale', text: 'Soru metni burada' }] },
    { questions: QUESTIONS, institutionId: 'b' },
  ])
    assert.equal(selfEvaluationTemplateInputSchema.safeParse(bad).success, false)
})

test('DOM-FIN-131 K-448: şablon kapanmamış dönemde tek açılır; yanıt açılınca değişmez', () => {
  const input = template({ questions: QUESTIONS })
  assert.equal(planSelfEvaluationTemplate(at('planning'), input, { exists: false }).length, 3)
  assert.throws(
    () => planSelfEvaluationTemplate(at('active'), input, { exists: true }),
    isDomainError('self_evaluation_template_exists', 'conflict'),
  )
  assert.throws(
    () => planSelfEvaluationTemplate(at('closed'), input, { exists: false }),
    isDomainError('performance_period_closed', 'conflict'),
  )
  assert.equal(
    planSelfEvaluationTemplateUpdate(at('evaluation'), input, { responseCount: 0 }).length,
    3,
  )
  assert.throws(
    () => planSelfEvaluationTemplateUpdate(at('active'), input, { responseCount: 2 }),
    isDomainError('self_evaluation_template_in_use', 'conflict'),
  )
  assert.throws(
    () => planSelfEvaluationTemplateUpdate(at('closed'), input, { responseCount: 0 }),
    isDomainError('performance_period_closed', 'conflict'),
  )
})

test('DOM-FIN-131 K-449: yanıt kanal ister; cevap şablona göre doğrulanır', () => {
  assert.equal(selfEvaluationCreateSchema.safeParse({ membershipId: 'm-1' }).success, false)
  assert.equal(
    selfEvaluationCreateSchema.safeParse({ membershipId: 'm-1', channel: 'self_service' }).success,
    false,
  )
  assert.equal(
    selfEvaluationCreateSchema.safeParse({
      membershipId: 'm-1',
      channel: 'paper',
      answers: [{ score: 6 }],
    }).success,
    false,
  )
  assert.deepEqual(normalizeSelfEvaluationAnswers(QUESTIONS, [{ score: 3 }, { text: '' }, {}]), [
    { score: 3, text: null },
    { score: null, text: null },
    { score: null, text: null },
  ])
  assert.throws(
    () => normalizeSelfEvaluationAnswers(QUESTIONS, [{ score: 3 }]),
    isDomainError('self_evaluation_answers_mismatch', 'rule'),
  )
  assert.throws(
    () => normalizeSelfEvaluationAnswers(QUESTIONS, [{ text: 'metin' }, {}, {}]),
    isDomainError('self_evaluation_answer_kind', 'rule'),
  )
  assert.throws(
    () => normalizeSelfEvaluationAnswers(QUESTIONS, [{}, { score: 2 }, {}]),
    isDomainError('self_evaluation_answer_kind', 'rule'),
  )
})

test('DOM-FIN-131 K-449: yeni yanıt yalnız açık dönemde, şablonla ve dönemdeki personele; tekil', () => {
  const input = create({ membershipId: 'm-1', channel: 'email' })
  assert.deepEqual(planSelfEvaluation(input, checks()), emptySelfEvaluationAnswers(QUESTIONS))
  assert.deepEqual(
    planSelfEvaluation(create({ membershipId: 'm-1', channel: 'paper', answers: FULL }), checks()),
    FULL,
  )
  const cases: [Partial<SelfEvaluationChecks>, string, string][] = [
    [{ period: at('closed') }, 'performance_period_closed', 'conflict'],
    [{ period: at('planning') }, 'self_evaluation_not_open', 'rule'],
    [{ questions: null }, 'self_evaluation_template_missing', 'rule'],
    [{ enrolled: false }, 'self_evaluation_not_enrolled', 'rule'],
    [{ duplicate: true }, 'self_evaluation_exists', 'conflict'],
  ]
  for (const [patch, code, kind] of cases)
    assert.throws(() => planSelfEvaluation(input, checks(patch)), isDomainError(code, kind))
  for (const status of ['active', 'interim', 'evaluation'] as const)
    assert.equal(isSelfEvaluationOpen(status), true)
  assert.equal(isSelfEvaluationOpen('planning'), false)
})

test('DOM-FIN-131 K-449 K-450: taslakta cevap ve kanal, gönderilmişte yalnız yönetici görüşü', () => {
  const draft = { status: 'draft' as const }
  const submitted = { status: 'submitted' as const }
  assert.deepEqual(
    planSelfEvaluationUpdate(
      draft,
      at('interim'),
      QUESTIONS,
      update({ answers: FULL, channel: 'paper' }),
    ),
    {
      answers: FULL,
      channel: 'paper',
    },
  )
  assert.throws(
    () => planSelfEvaluationUpdate(submitted, at('interim'), QUESTIONS, update({ answers: FULL })),
    isDomainError('self_evaluation_submitted', 'conflict'),
  )
  assert.throws(
    () =>
      planSelfEvaluationUpdate(
        draft,
        at('interim'),
        QUESTIONS,
        update({ managerComment: 'Görüş' }),
      ),
    isDomainError('self_evaluation_not_submitted', 'rule'),
  )
  assert.deepEqual(
    planSelfEvaluationUpdate(
      submitted,
      at('evaluation'),
      QUESTIONS,
      update({ managerComment: '  ' }),
    ),
    { managerComment: null },
  )
  assert.throws(
    () =>
      planSelfEvaluationUpdate(
        submitted,
        at('closed'),
        QUESTIONS,
        update({ managerComment: 'Geç' }),
      ),
    isDomainError('performance_period_closed', 'conflict'),
  )
  assert.equal(selfEvaluationUpdateSchema.safeParse({}).success, false)
  assert.equal(
    selfEvaluationUpdateSchema.safeParse({ managerComment: 'x'.repeat(2001) }).success,
    false,
  )
})

test('DOM-FIN-131 K-449: gönderim zorunlu soruları ister; gönderilen yeniden gönderilmez', () => {
  const draft = { status: 'draft' as const, answers: FULL }
  assert.doesNotThrow(() => planSelfEvaluationSubmit(draft, at('evaluation'), QUESTIONS))
  assert.throws(
    () =>
      planSelfEvaluationSubmit(
        { status: 'draft', answers: emptySelfEvaluationAnswers(QUESTIONS) },
        at('active'),
        QUESTIONS,
      ),
    (error: unknown) =>
      isDomainError('self_evaluation_incomplete', 'rule')(error) &&
      (error as Error).message.includes('Zorunlu 2 soru'),
  )
  assert.throws(
    () => planSelfEvaluationSubmit({ ...draft, status: 'submitted' }, at('active'), QUESTIONS),
    isDomainError('self_evaluation_already_submitted', 'conflict'),
  )
  assert.throws(
    () => planSelfEvaluationSubmit(draft, at('closed'), QUESTIONS),
    isDomainError('performance_period_closed', 'conflict'),
  )
  assert.equal(selfEvaluationAnsweredCount(QUESTIONS, FULL), 2)
})

test('DOM-FIN-131 K-449: geri açma gerekçe ister, yalnız gönderilmiş yanıtı taslağa döndürür', () => {
  assert.equal(
    planSelfEvaluationReopen({ status: 'submitted' }, at('evaluation'), {
      reason: '  Yanlış form girildi ',
    }),
    'Yanlış form girildi',
  )
  assert.equal(selfEvaluationReopenSchema.safeParse({ reason: 'kısa' }).success, false)
  assert.throws(() => planSelfEvaluationReopen({ status: 'submitted' }, at('active'), {}))
  assert.throws(
    () => planSelfEvaluationReopen({ status: 'draft' }, at('active'), { reason: 'Gerekçe metni' }),
    isDomainError('self_evaluation_not_submitted', 'conflict'),
  )
  assert.throws(
    () =>
      planSelfEvaluationReopen({ status: 'submitted' }, at('closed'), { reason: 'Gerekçe metni' }),
    isDomainError('performance_period_closed', 'conflict'),
  )
})

test('DOM-FIN-131 K-450: gönderen oranı dönemdeki personele göre, bir ondalık', () => {
  assert.deepEqual(selfEvaluationSummary({ enrolled: 3, submitted: 1, draft: 1 }), {
    enrolled: 3,
    submitted: 1,
    draft: 1,
    missing: 1,
    rate: 33.3,
  })
  assert.equal(selfEvaluationSummary({ enrolled: 0, submitted: 0, draft: 0 }).rate, null)
  assert.equal(selfEvaluationSummary({ enrolled: 2, submitted: 2, draft: 0 }).rate, 100)
})
