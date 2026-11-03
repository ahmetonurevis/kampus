import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  answerKeySchema,
  contentUnitSchema,
  questionBodySchema,
  resourceContentSchema,
  type AnswerKey,
  type QuestionBody,
} from '../packages/school-core/src/content/resource.ts'
import {
  ITEM_CHECK_LIMIT,
  itemCheckInputSchema,
  itemFeedback,
  lockedAnswers,
  planItemCheck,
  practiceGradebook,
  practiceShownAttempt,
  withLockedAnswers,
  type ItemCheckRow,
  type PracticeResult,
} from '../packages/school-core/src/skills/practice.ts'
import {
  deadlineSchema,
  scoreAttempt,
  type AttemptRow,
  type AttemptTiming,
  type CompletedAttempt,
  type ScoringItem,
  type TaskResponse,
} from '../packages/school-core/src/skills/scoring.ts'
import { scoringItemsFor } from '../packages/school-core/src/skills/assignment.ts'
import { isDomainError } from './support/domain-error.ts'

// Ünite alıştırma seti (IST-056): anında geri bildirim DOM-BEC-047, not defteri DOM-BEC-048.

const explanation = 'Metnin ikinci paragrafında geçer.'
const options = (...ids: string[]) => ids.map((id) => ({ id, text: `Seçenek ${id}` }))
const item = (
  questionVersionId: string,
  question: unknown,
  answerKey: unknown,
  extra: Partial<ScoringItem> = {},
): ScoringItem => ({
  questionVersionId,
  points: 1,
  locale: 'en',
  question: questionBodySchema.parse(question) as QuestionBody,
  answerKey: answerKeySchema.parse(answerKey) as AnswerKey,
  ...extra,
})

const mc = item(
  'test-q-mc',
  { questionType: 'multiple_choice', stem: 'Where?', options: options('a', 'b', 'c', 'd') },
  { questionType: 'multiple_choice', correctOptionId: 'b', explanation },
  { points: 2, skill: 'reading', outcomes: [{ outcomeSource: 'platform', outcomeId: 'E7.1.R1' }] },
)
const match = item(
  'test-q-match',
  {
    questionType: 'matching',
    stem: 'Eşleştirin.',
    prompts: options('p1', 'p2'),
    choices: options('c1', 'c2'),
  },
  {
    questionType: 'matching',
    pairs: [
      { promptId: 'p1', choiceId: 'c1' },
      { promptId: 'p2', choiceId: 'c2' },
    ],
    explanation,
  },
  { skill: 'language_use', outcomes: [] },
)
const items = [mc, match]

const timing: AttemptTiming = {
  timeLimitMinutes: null,
  extraMinutes: 0,
  deadline: deadlineSchema.parse({}),
}
const startedAt = '2026-11-05T10:00:00.000Z'
const now = '2026-11-05T10:05:00.000Z'
const attempt = (input: Partial<AttemptRow> = {}): AttemptRow => ({
  id: 'test-attempt',
  startedAt,
  submittedAt: null,
  answers: {},
  ...input,
})
const choose = (optionId: string): TaskResponse => ({ questionType: 'multiple_choice', optionId })
const check = (
  questionVersionId: string,
  checkNumber: number,
  response: TaskResponse,
): ItemCheckRow => ({ questionVersionId, checkNumber, response, checkedAt: now })
const plan = (input: Partial<Parameters<typeof planItemCheck>[0]> = {}) =>
  planItemCheck({
    kind: 'practice',
    attempt: attempt(),
    timing,
    items,
    checks: [],
    check: { questionVersionId: 'test-q-mc', response: choose('a') },
    now,
    ...input,
  })

describe('DOM-BEC-047 anında geri bildirim', () => {
  test('DOM-BEC-047 ilk kontrol cevabı kaydeder, yeni satır açar, anahtarı açmaz', () => {
    const result = plan()
    assert.equal(result.kind, 'new')
    if (result.kind !== 'new') return
    assert.deepEqual(result.answers, { 'test-q-mc': choose('a') })
    assert.deepEqual(result.check, check('test-q-mc', 1, choose('a')))
    const [feedback] = itemFeedback(items, [result.check])
    assert.equal(feedback?.correct, false)
    assert.equal(feedback?.locked, false)
    assert.equal(feedback?.remaining, ITEM_CHECK_LIMIT - 1)
    assert.equal(feedback?.answerKey, null)
  })

  test('DOM-BEC-047 doğru cevap maddeyi kilitler ve yalnız o maddenin anahtarını açar', () => {
    const checks = [
      check('test-q-mc', 1, choose('b')),
      check('test-q-match', 1, {
        questionType: 'matching',
        pairs: [{ promptId: 'p1', choiceId: 'c2' }],
      }),
    ]
    const feedback = itemFeedback(items, checks)
    assert.deepEqual(
      feedback.map((entry) => [entry.questionVersionId, entry.correct, entry.locked]),
      [
        ['test-q-mc', true, true],
        ['test-q-match', false, false],
      ],
    )
    assert.equal(feedback[0]?.answerKey?.questionType, 'multiple_choice')
    assert.equal(feedback[1]?.answerKey, null)
    assert.equal(feedback[1]?.correctParts, 0)
    assert.equal(feedback[1]?.parts, 2)
  })

  test('DOM-BEC-047 hak bitince madde kilitlenir, anahtar açılır, yeni kontrol 422', () => {
    const checks = [check('test-q-mc', 1, choose('a')), check('test-q-mc', 2, choose('c'))]
    const [feedback] = itemFeedback(items, checks)
    assert.equal(feedback?.locked, true)
    assert.equal(feedback?.correct, false)
    assert.equal(feedback?.remaining, 0)
    assert.notEqual(feedback?.answerKey, null)
    assert.throws(
      () => plan({ checks, check: { questionVersionId: 'test-q-mc', response: choose('b') } }),
      isDomainError('item_check_locked'),
    )
  })

  test('DOM-BEC-047 mükerrer kontrol hak tüketmez; sıra farklı eşleştirme de aynı cevaptır', () => {
    const first = check('test-q-mc', 1, choose('a'))
    assert.deepEqual(plan({ checks: [first] }), { kind: 'duplicate' })
    const pairs = [
      { promptId: 'p1', choiceId: 'c1' },
      { promptId: 'p2', choiceId: 'c1' },
    ]
    const matchCheck = check('test-q-match', 1, { questionType: 'matching', pairs })
    const reordered = { questionType: 'matching' as const, pairs: [...pairs].reverse() }
    assert.deepEqual(
      plan({
        checks: [matchCheck],
        check: { questionVersionId: 'test-q-match', response: reordered },
      }),
      { kind: 'duplicate' },
    )
    // Kilitli maddede aynı cevabın yeniden gönderimi de mükerrerdir (ret değil).
    const locked = [check('test-q-mc', 1, choose('b'))]
    assert.deepEqual(
      plan({ checks: locked, check: { questionVersionId: 'test-q-mc', response: choose('b') } }),
      { kind: 'duplicate' },
    )
  })

  test('DOM-BEC-047 ikinci kontrol sıra numarasını artırır, kilitli cevaplar korunur', () => {
    const checks = [
      check('test-q-mc', 1, choose('b')),
      check('test-q-match', 1, { questionType: 'matching', pairs: [] }),
    ]
    const result = plan({
      attempt: attempt({ answers: { 'test-q-mc': choose('b') } }),
      checks,
      check: {
        questionVersionId: 'test-q-match',
        response: { questionType: 'matching', pairs: [{ promptId: 'p1', choiceId: 'c1' }] },
      },
    })
    assert.equal(result.kind, 'new')
    if (result.kind !== 'new') return
    assert.equal(result.check.checkNumber, 2)
    assert.deepEqual(result.answers['test-q-mc'], choose('b'))
  })

  test('DOM-BEC-047 değerlendirmede anında geri bildirim yok; kayıt kuralları geçerli', () => {
    assert.throws(() => plan({ kind: 'evaluation' }), isDomainError('instant_feedback_unavailable'))
    assert.throws(
      () => plan({ attempt: attempt({ submittedAt: now }) }),
      isDomainError('attempt_already_submitted', 'conflict'),
    )
    assert.throws(
      () => plan({ check: { questionVersionId: 'test-q-yok', response: choose('a') } }),
      isDomainError('answer_invalid'),
    )
    assert.throws(
      () => plan({ check: { questionVersionId: 'test-q-mc', response: choose('z') } }),
      isDomainError('answer_invalid'),
    )
  })

  test('DOM-BEC-047 kilitli maddenin cevabı kayıtta ve teslimde değişmez', () => {
    const checks = [check('test-q-mc', 1, choose('b'))]
    assert.deepEqual(lockedAnswers(items, checks), { 'test-q-mc': choose('b') })
    const saved = withLockedAnswers(
      { 'test-q-mc': choose('a'), 'test-q-match': { questionType: 'matching', pairs: [] } },
      items,
      checks,
    )
    assert.deepEqual(saved['test-q-mc'], choose('b'))
    assert.deepEqual(saved['test-q-match'], { questionType: 'matching', pairs: [] })
    // Kilitlenmemiş madde serbesttir.
    assert.deepEqual(lockedAnswers(items, [check('test-q-mc', 1, choose('a'))]), {})
  })

  test('DOM-BEC-047 kontrol gövdesi katıdır', () => {
    assert.equal(
      itemCheckInputSchema.safeParse({
        questionVersionId: 'test-q-mc',
        response: choose('a'),
        correct: true,
      }).success,
      false,
    )
    assert.equal(
      itemCheckInputSchema.safeParse({ questionVersionId: '', response: choose('a') }).success,
      false,
    )
  })
})

describe('DOM-BEC-048 alıştırma not defteri', () => {
  const result = (
    learnerId: string,
    unit: PracticeResult['unit'],
    answers: Parameters<typeof scoreAttempt>[1],
  ): PracticeResult => ({
    learnerId,
    assignmentId: `test-assignment-${unit?.number ?? 0}`,
    unit,
    items,
    score: scoreAttempt(items, answers),
  })
  const allCorrect = {
    'test-q-mc': choose('b'),
    'test-q-match': {
      questionType: 'matching' as const,
      pairs: [
        { promptId: 'p1', choiceId: 'c1' },
        { promptId: 'p2', choiceId: 'c2' },
      ],
    },
  }

  test('DOM-BEC-048 ünite, beceri ve kazanım kırılımı madde puanlarından hesaplanır', () => {
    const book = practiceGradebook([
      result('test-learner-b', { number: 2, title: null }, {}),
      result('test-learner-a', { number: 1, title: 'My Family' }, allCorrect),
      result(
        'test-learner-a',
        { number: 2, title: 'Daily Routines' },
        { 'test-q-mc': choose('b') },
      ),
      result('test-learner-a', null, {}),
    ])
    assert.deepEqual(
      book.learners.map((learner) => learner.learnerId),
      ['test-learner-a', 'test-learner-b'],
    )
    const a = book.learners[0]
    assert.equal(a?.sets, 3)
    assert.deepEqual(a?.overall, { items: 6, earned: 5, possible: 9, percent: 56 })
    assert.deepEqual(a?.units, [
      { number: 1, title: 'My Family', sets: 1, items: 2, earned: 3, possible: 3, percent: 100 },
      {
        number: 2,
        title: 'Daily Routines',
        sets: 1,
        items: 2,
        earned: 2,
        possible: 3,
        percent: 67,
      },
    ])
    assert.deepEqual(a?.skills, [
      { skill: 'reading', items: 3, earned: 4, possible: 6, percent: 67 },
      { skill: 'language_use', items: 3, earned: 1, possible: 3, percent: 33 },
    ])
    assert.deepEqual(a?.outcomes, [
      {
        outcomeSource: 'platform',
        outcomeId: 'E7.1.R1',
        items: 3,
        earned: 4,
        possible: 6,
        percent: 67,
      },
    ])
    // Sınıf toplamı; ünite başlığı ilk dolu başlıktır.
    assert.equal(book.totals.sets, 4)
    assert.deepEqual(
      book.totals.units.map((unit) => [unit.number, unit.title, unit.sets, unit.percent]),
      [
        [1, 'My Family', 1, 100],
        [2, 'Daily Routines', 2, 33],
      ],
    )
    assert.deepEqual(practiceGradebook([]).totals, {
      sets: 0,
      overall: { items: 0, earned: 0, possible: 0, percent: 0 },
      units: [],
      skills: [],
      outcomes: [],
    })
  })

  test('DOM-BEC-048 gösterilen deneme son tamamlanandır (alıştırmada sayılan deneme yok)', () => {
    const scored = (id: string, completedAt: string, percent: number): CompletedAttempt => ({
      id,
      completedAt,
      score: { earned: percent, possible: 100, percent, ratio: percent / 100, items: [] },
    })
    assert.equal(practiceShownAttempt([]), null)
    assert.equal(
      practiceShownAttempt([
        scored('test-a1', '2026-11-05T10:00:00.000Z', 90),
        scored('test-a3', '2026-11-05T12:00:00.000Z', 40),
        scored('test-a2', '2026-11-05T11:00:00.000Z', 70),
      ])?.id,
      'test-a3',
    )
    assert.equal(
      practiceShownAttempt([
        scored('test-a2', '2026-11-05T10:00:00.000Z', 1),
        scored('test-a1', '2026-11-05T10:00:00.000Z', 1),
      ])?.id,
      'test-a2',
    )
  })

  test('DOM-BEC-048 madde etiketi yoksa setin becerisi ve kazanımları kullanılır', () => {
    const question = (id: string, tags: Record<string, unknown>) => ({
      id,
      tags: { cefrLevel: null, primarySkill: null, skills: [], subskill: null, ...tags },
      content: {
        type: 'question' as const,
        question: mc.question,
      },
      answerKey: mc.answerKey,
    })
    const built = scoringItemsFor({
      parentTags: {
        cefrLevel: 'A2',
        primarySkill: 'language_use',
        skills: ['language_use'],
        outcomes: [{ outcomeSource: 'institution', outcomeId: 'K-1' }],
      },
      items: [
        { questionVersionId: 'test-q1', points: 1 },
        { questionVersionId: 'test-q2', points: 1 },
      ],
      questions: new Map([
        ['test-q1', question('test-q1', {})],
        [
          'test-q2',
          question('test-q2', {
            primarySkill: 'reading',
            outcomes: [{ outcomeSource: 'platform', outcomeId: 'E7.1.R1' }],
          }),
        ],
      ] as never),
    })
    assert.deepEqual(
      built.map((entry) => [entry.skill, entry.outcomes?.map((o) => o.outcomeId)]),
      [
        ['language_use', ['K-1']],
        ['reading', ['E7.1.R1']],
      ],
    )
  })
})

describe('DOM-BEC-047 ünite etiketi', () => {
  test('DOM-BEC-047 alıştırma seti ve quiz üniteyi taşır; sınır ve boş başlık', () => {
    const set = resourceContentSchema.parse({
      type: 'exercise_set',
      items: [{ questionVersionId: 'test-q1' }],
      unit: { number: 3, title: '  ' },
    })
    assert.equal(set.type, 'exercise_set')
    if (set.type === 'exercise_set') assert.deepEqual(set.unit, { number: 3, title: null })
    const quiz = resourceContentSchema.parse({
      type: 'quiz',
      items: [{ questionVersionId: 'test-q1' }],
    })
    if (quiz.type === 'quiz') assert.equal(quiz.unit, null)
    for (const number of [0, 41, 2.5]) {
      assert.equal(contentUnitSchema.safeParse({ number }).success, false, String(number))
    }
    assert.equal(contentUnitSchema.safeParse({ number: 1, title: 'x'.repeat(121) }).success, false)
  })
})
