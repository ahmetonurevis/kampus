import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  answerKeySchema,
  questionBodySchema,
  type AnswerKey,
  type QuestionBody,
} from '../packages/school-core/src/content/resource.ts'
import {
  AUTO_SCORED_QUESTION_TYPES,
  answerKeyReleased,
  answersSchema,
  assertAutoScored,
  assertResponsesFit,
  attemptEndsAt,
  attemptRulesSchema,
  attemptState,
  countedAttempt,
  deadlineSchema,
  extraTimeSchema,
  isClosed,
  isLate,
  istanbulLocalDueSchema,
  istanbulLocalToUtc,
  learnerResultLevel,
  answerLocaleForTags,
  normalizeShortAnswer,
  planAnswerSave,
  planAttemptStart,
  planAttemptSubmit,
  scoreAttempt,
  scoreItem,
  scoringModeFor,
  submissionWindow,
  teacherFeedbackReleased,
  type Answers,
  type AttemptRow,
  type AttemptRules,
  type AttemptTiming,
  type CompletedAttempt,
  type DeadlineInput,
  type AnswerLocale,
  type ScoringItem,
} from '../packages/school-core/src/skills/scoring.ts'
import { isDomainError } from './support/domain-error.ts'

const item = (
  questionVersionId: string,
  question: unknown,
  answerKey: unknown,
  points = 1,
  locale: AnswerLocale = 'tr',
): ScoringItem => ({
  questionVersionId,
  points,
  locale,
  question: questionBodySchema.parse(question) as QuestionBody,
  answerKey: answerKeySchema.parse(answerKey) as AnswerKey,
})
const explanation = 'Metnin ikinci paragrafında geçer.'
const options = (...ids: string[]) => ids.map((id) => ({ id, text: `Seçenek ${id}` }))

const mc = item(
  'test-q-mc',
  {
    questionType: 'multiple_choice',
    stem: 'Where does Tom live?',
    options: options('a', 'b', 'c', 'd'),
  },
  { questionType: 'multiple_choice', correctOptionId: 'b', explanation },
  2,
)
const tf = item(
  'test-q-tf',
  { questionType: 'true_false', stem: 'Tom likes tea.', allowNotGiven: true },
  { questionType: 'true_false', answer: 'not_given', explanation },
)
const match = item(
  'test-q-match',
  {
    questionType: 'matching',
    stem: 'Eşleştirin.',
    prompts: options('p1', 'p2', 'p3', 'p4'),
    choices: options('c1', 'c2', 'c3', 'c4'),
  },
  {
    questionType: 'matching',
    pairs: [
      { promptId: 'p1', choiceId: 'c1' },
      { promptId: 'p2', choiceId: 'c2' },
      { promptId: 'p3', choiceId: 'c3' },
      { promptId: 'p4', choiceId: 'c4' },
    ],
    explanation,
  },
  4,
)
const order = item(
  'test-q-order',
  { questionType: 'ordering', stem: 'Sıralayın.', items: options('x', 'y', 'z') },
  { questionType: 'ordering', order: ['x', 'y', 'z'], explanation },
  3,
)
const gap = item(
  'test-q-gap',
  {
    questionType: 'gap_fill',
    stem: 'I {{g1}} to school {{g2}} bus.',
    gaps: [
      { id: 'g1', options: [] },
      { id: 'g2', options: ['by', 'on', 'with'] },
    ],
  },
  {
    questionType: 'gap_fill',
    gaps: [
      { gapId: 'g1', accepted: ['go', 'walk'] },
      { gapId: 'g2', accepted: ['by'] },
    ],
    explanation,
  },
  2,
)
const short = item(
  'test-q-short',
  { questionType: 'short_answer', stem: 'Başkent?', maxLength: 40 },
  { questionType: 'short_answer', accepted: ['IŞIK', 'İstanbul Boğazı'], explanation },
)
const all = [mc, tf, match, order, gap, short]

const deadline = (input: DeadlineInput = {}) => deadlineSchema.parse(input)
const due = '2026-11-05T20:59:00.000Z'
const timing = (input: Partial<AttemptTiming> = {}): AttemptTiming => ({
  timeLimitMinutes: 30,
  extraMinutes: 0,
  deadline: deadline({ dueAt: due }),
  ...input,
})
const startedAt = '2026-11-05T10:00:00.000Z'
const attempt = (input: Partial<AttemptRow> = {}): AttemptRow => ({
  id: 'test-a1',
  startedAt,
  submittedAt: null,
  answers: {},
  ...input,
})
const evaluation = (input: Record<string, unknown> = {}) =>
  attemptRulesSchema.parse({ kind: 'evaluation', ...input }) as Extract<
    AttemptRules,
    { kind: 'evaluation' }
  >
const practice = attemptRulesSchema.parse({ kind: 'practice' })
const plusMs = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString()

describe('otomatik puan (DOM-BEC-010)', () => {
  test('DOM-BEC-010 tam doğru deneme 100 puandır, puan cevaplardan hesaplanır', () => {
    const answers: Answers = {
      'test-q-mc': { questionType: 'multiple_choice', optionId: 'b' },
      'test-q-tf': { questionType: 'true_false', answer: 'not_given' },
      'test-q-match': {
        questionType: 'matching',
        pairs: ['1', '2', '3', '4'].map((n) => ({ promptId: `p${n}`, choiceId: `c${n}` })),
      },
      'test-q-order': { questionType: 'ordering', order: ['x', 'y', 'z'] },
      'test-q-gap': {
        questionType: 'gap_fill',
        gaps: [
          { gapId: 'g1', value: ' Walk ' },
          { gapId: 'g2', value: 'by' },
        ],
      },
      'test-q-short': { questionType: 'short_answer', value: 'ışık' },
    }
    const score = scoreAttempt(all, answers)
    assert.equal(score.possible, 13)
    assert.equal(score.earned, 13)
    assert.equal(score.percent, 100)
    assert.equal(score.ratio, 1)
    assert.ok(score.items.every((i) => i.answered && i.correctParts === i.parts))
  })

  test('DOM-BEC-010 çok maddeli soruda her madde ayrı puanlanır, yanlış eksi puan getirmez', () => {
    const answers: Answers = {
      'test-q-mc': { questionType: 'multiple_choice', optionId: 'a' },
      'test-q-match': {
        questionType: 'matching',
        pairs: [
          { promptId: 'p1', choiceId: 'c1' },
          { promptId: 'p2', choiceId: 'c3' },
          { promptId: 'p3', choiceId: 'c2' },
        ],
      },
      'test-q-order': { questionType: 'ordering', order: ['x', 'z', 'y'] },
      'test-q-gap': {
        questionType: 'gap_fill',
        gaps: [
          { gapId: 'g1', value: 'went' },
          { gapId: 'g2', value: 'by' },
        ],
      },
    }
    const score = scoreAttempt(all, answers)
    const byId = new Map(score.items.map((i) => [i.questionVersionId, i]))
    assert.equal(byId.get('test-q-mc')?.earned, 0)
    assert.deepEqual(
      { parts: byId.get('test-q-match')?.parts, correct: byId.get('test-q-match')?.correctParts },
      { parts: 4, correct: 1 },
    )
    assert.equal(byId.get('test-q-match')?.earned, 1)
    assert.equal(byId.get('test-q-order')?.correctParts, 1)
    assert.equal(byId.get('test-q-order')?.earned, 1)
    assert.equal(byId.get('test-q-gap')?.earned, 1)
    assert.equal(byId.get('test-q-tf')?.answered, false)
    assert.equal(score.earned, 3)
    assert.equal(score.percent, 23)
    assert.ok(score.items.every((i) => i.earned >= 0))
  })

  test('DOM-BEC-010 yanıtsız ve soruyla uyuşmayan cevap yanlış sayılır', () => {
    const score = scoreAttempt(all, {
      'test-q-mc': { questionType: 'short_answer', value: 'b' },
      'test-q-tf': { questionType: 'true_false', answer: null },
      'test-q-order': { questionType: 'ordering', order: ['x'] },
    })
    assert.equal(score.earned, 0)
    assert.equal(score.percent, 0)
    assert.equal(scoreAttempt([], {}).ratio, 0)
  })

  test('DOM-BEC-010 kısmi puanın gösterimi iki ondalığa yuvarlanır, oran yuvarlanmaz', () => {
    const score = scoreAttempt([order], {
      'test-q-order': { questionType: 'ordering', order: ['x', 'z', 'y'] },
    })
    assert.equal(score.earned, 1)
    const thirds = scoreAttempt([item('test-q-o2', order.question, order.answerKey, 1)], {
      'test-q-o2': { questionType: 'ordering', order: ['x', 'z', 'y'] },
    })
    assert.equal(thirds.earned, 0.33)
    assert.equal(thirds.ratio, 1 / 3)
    assert.equal(thirds.percent, 33)
  })

  test('DOM-BEC-011 anahtar düzeltmesinde aynı cevaplar yeni anahtarla yeniden puanlanır', () => {
    const answers: Answers = { 'test-q-mc': { questionType: 'multiple_choice', optionId: 'c' } }
    assert.equal(scoreAttempt([mc], answers).percent, 0)
    const corrected = item('test-q-mc', mc.question, { ...mc.answerKey, correctOptionId: 'c' }, 2)
    assert.equal(scoreAttempt([corrected], answers).percent, 100)
    assert.deepEqual(answers, { 'test-q-mc': { questionType: 'multiple_choice', optionId: 'c' } })
  })

  test('DOM-BEC-010 anahtar soru türüyle uyuşmazsa puanlanmaz', () => {
    const broken: ScoringItem = { ...mc, answerKey: tf.answerKey }
    assert.throws(
      () => scoreItem(broken, undefined),
      isDomainError('answer_key_mismatch', 'conflict'),
    )
  })
})

describe('kısa cevap normalleştirmesi (DOM-BEC-010)', () => {
  test('DOM-BEC-010 Türkçe İ/ı tr-TR kuralıyla küçültülür', () => {
    assert.equal(normalizeShortAnswer('IŞIK', 'tr'), 'ışık')
    assert.equal(normalizeShortAnswer('İstanbul', 'tr'), 'istanbul')
    // Ayrışık "İ" (I + U+0307) NFC ile tek harfe birleşir.
    assert.equal(normalizeShortAnswer('İstanbul', 'tr'), 'istanbul')
    assert.equal(scoreItem(short, { questionType: 'short_answer', value: 'Işık' }).correctParts, 1)
    assert.equal(
      scoreItem(short, { questionType: 'short_answer', value: 'istanbul boğazı' }).correctParts,
      1,
    )
  })

  test('DOM-BEC-010 yazım farkı katlanmaz: ı/i ve ş/s ayrıdır', () => {
    for (const value of ['isik', 'işık', 'ışik', 'ISIK']) {
      assert.equal(scoreItem(short, { questionType: 'short_answer', value }).correctParts, 0, value)
    }
  })

  test('DOM-BEC-010 baştaki, sondaki ve art arda boşluk normalleşir; noktalama korunur', () => {
    assert.equal(normalizeShortAnswer('  İstanbul \t\n  Boğazı  ', 'tr'), 'istanbul boğazı')
    assert.equal(
      scoreItem(short, { questionType: 'short_answer', value: ' İSTANBUL   BOĞAZI ' }).correctParts,
      1,
    )
    assert.equal(scoreItem(short, { questionType: 'short_answer', value: 'ışık.' }).correctParts, 0)
    assert.equal(scoreItem(short, { questionType: 'short_answer', value: '   ' }).answered, false)
  })

  test('DOM-BEC-010 \'en\': "I" ile "i" eşit, "I\'m" ile "i’m" eşit', () => {
    assert.equal(normalizeShortAnswer('I', 'en'), normalizeShortAnswer('i', 'en'))
    assert.equal(normalizeShortAnswer("I'm", 'en'), normalizeShortAnswer('i’m', 'en'))
  })

  test('DOM-BEC-010 \'tr\': IŞIK ve İstanbul korunur, "I" ile "i" eşit değil', () => {
    assert.equal(normalizeShortAnswer('IŞIK', 'tr'), 'ışık')
    assert.equal(normalizeShortAnswer('İstanbul', 'tr'), 'istanbul')
    assert.notEqual(normalizeShortAnswer('I', 'tr'), normalizeShortAnswer('i', 'tr'))
  })

  test('DOM-BEC-010 answerLocaleForTags: beceri veya CEFR varsa en, yoksa tr', () => {
    const base = { cefrLevel: null, primarySkill: null, skills: [] } satisfies Parameters<
      typeof answerLocaleForTags
    >[0]
    assert.equal(answerLocaleForTags(base), 'tr')
    assert.equal(answerLocaleForTags({ ...base, cefrLevel: 'B1' }), 'en')
    assert.equal(answerLocaleForTags({ ...base, primarySkill: 'reading' }), 'en')
    assert.equal(answerLocaleForTags({ ...base, skills: ['listening'] }), 'en')
  })

  test('DOM-BEC-010 tipografik kesme işareti, tırnak ve Unicode boşluk tek karaktere iner', () => {
    for (const locale of ['tr', 'en'] as const) {
      assert.equal(normalizeShortAnswer('don’t', locale), normalizeShortAnswer("don't", locale))
      for (const mark of ['‘', 'ʼ', '′', '´', '`']) {
        assert.equal(normalizeShortAnswer(`don${mark}t`, locale), "don't", mark)
      }
      assert.equal(normalizeShortAnswer('“yes”', locale), normalizeShortAnswer('"yes"', locale))
      assert.equal(normalizeShortAnswer('„yes″', locale), '"yes"', locale)
      assert.equal(normalizeShortAnswer('a  b c　d', locale), 'a b c d')
      assert.equal(normalizeShortAnswer(' yes ', locale), 'yes')
      // Diğer noktalama korunur; sondaki nokta anlamlıdır.
      assert.notEqual(normalizeShortAnswer('yes.', locale), normalizeShortAnswer('yes', locale))
    }
  })

  test("DOM-BEC-010 scoreAttempt: aynı cevap 'en' ile doğru, 'tr' ile yanlış", () => {
    const question = { questionType: 'short_answer', stem: 'Subject pronoun?', maxLength: 10 }
    const key = { questionType: 'short_answer', accepted: ['I'], explanation }
    const answers = { 'test-q-pronoun': { questionType: 'short_answer', value: 'i' } } as const
    const english = item('test-q-pronoun', question, key, 1, 'en')
    const turkish = item('test-q-pronoun', question, key, 1, 'tr')
    assert.equal(scoreAttempt([english], answers).percent, 100)
    assert.equal(scoreAttempt([turkish], answers).percent, 0)
    const smart = { 'test-q-pronoun': { questionType: 'short_answer', value: 'I' } } as const
    assert.equal(scoreAttempt([turkish], smart).percent, 100)
  })
})

describe('cevap denetimi', () => {
  test('DOM-BEC-010 soruda olmayan seçenek ve bilinmeyen soru reddedilir', () => {
    const cases: [Answers, string][] = [
      [{ 'test-q-mc': { questionType: 'multiple_choice', optionId: 'zz' } }, 'test-q-mc'],
      [{ 'test-q-yok': { questionType: 'multiple_choice', optionId: 'a' } }, 'test-q-yok'],
      [{ 'test-q-mc': { questionType: 'true_false', answer: 'true' } }, 'test-q-mc'],
      [
        {
          'test-q-match': {
            questionType: 'matching',
            pairs: [{ promptId: 'p1', choiceId: 'c9' }],
          },
        },
        'test-q-match',
      ],
      [
        { 'test-q-gap': { questionType: 'gap_fill', gaps: [{ gapId: 'g9', value: 'x' }] } },
        'test-q-gap',
      ],
      [
        { 'test-q-gap': { questionType: 'gap_fill', gaps: [{ gapId: 'g2', value: 'at' }] } },
        'test-q-gap',
      ],
      [{ 'test-q-order': { questionType: 'ordering', order: ['x', 'x', 'y'] } }, 'test-q-order'],
      [{ 'test-q-short': { questionType: 'short_answer', value: 'a'.repeat(41) } }, 'test-q-short'],
    ]
    for (const [answers, id] of cases) {
      assert.throws(
        () => assertResponsesFit(all, answers),
        (error: unknown) =>
          isDomainError('answer_invalid')(error) &&
          (error as { path: string[] }).path.join('.') === `answers.${id}`,
        id,
      )
    }
    const notGiven = item(
      'test-q-tf2',
      { ...tf.question, allowNotGiven: false },
      {
        ...tf.answerKey,
        answer: 'false',
      },
    )
    assert.throws(
      () =>
        assertResponsesFit([notGiven], {
          'test-q-tf2': { questionType: 'true_false', answer: 'not_given' },
        }),
      isDomainError('answer_invalid'),
    )
    assert.doesNotThrow(() =>
      assertResponsesFit(all, {
        'test-q-mc': { questionType: 'multiple_choice', optionId: null },
        'test-q-order': { questionType: 'ordering', order: [] },
        'test-q-gap': { questionType: 'gap_fill', gaps: [{ gapId: 'g2', value: '' }] },
      }),
    )
  })

  test('DOM-BEC-010 cevap şeması yinelenen öncül ve boşluğu reddeder', () => {
    assert.equal(
      answersSchema.safeParse({
        q: {
          questionType: 'matching',
          pairs: [
            { promptId: 'p1', choiceId: 'c1' },
            { promptId: 'p1', choiceId: 'c2' },
          ],
        },
      }).success,
      false,
    )
    assert.equal(
      answersSchema.safeParse({
        q: {
          questionType: 'gap_fill',
          gaps: [
            { gapId: 'g1', value: 'a' },
            { gapId: 'g1', value: 'b' },
          ],
        },
      }).success,
      false,
    )
    const many = Object.fromEntries(
      Array.from({ length: 201 }, (_, i) => [
        `q${i}`,
        { questionType: 'short_answer', value: 'a' },
      ]),
    )
    assert.equal(answersSchema.safeParse(many).success, false)
  })
})

describe('puanlama yolu (DOM-BEC-023)', () => {
  test('DOM-BEC-023 yazma/konuşma görevi otomatik puanlanmaz', () => {
    assert.equal(scoringModeFor('quiz'), 'auto')
    assert.equal(scoringModeFor('exercise_set'), 'auto')
    assert.equal(scoringModeFor('question'), 'auto')
    assert.equal(scoringModeFor('homework_template'), 'teacher')
    assert.equal(scoringModeFor('reading_passage'), null)
    assert.doesNotThrow(() => assertAutoScored('quiz'))
    assert.throws(() => assertAutoScored('homework_template'), isDomainError('not_auto_scored'))
    assert.deepEqual([...AUTO_SCORED_QUESTION_TYPES].sort(), [
      'gap_fill',
      'matching',
      'multiple_choice',
      'ordering',
      'short_answer',
      'true_false',
    ])
  })
})

describe('deneme hakkı ve sayım (DOM-BEC-041, 042)', () => {
  test('DOM-BEC-042 deneme hakkı varsayılan 1, 1–3 arası; en yüksek politikası hak >1 ister', () => {
    assert.deepEqual(evaluation(), { kind: 'evaluation', maxAttempts: 1, countPolicy: 'first' })
    assert.equal(
      attemptRulesSchema.safeParse({ kind: 'evaluation', maxAttempts: 4 }).success,
      false,
    )
    assert.equal(
      attemptRulesSchema.safeParse({ kind: 'evaluation', maxAttempts: 0 }).success,
      false,
    )
    const highestOne = attemptRulesSchema.safeParse({ kind: 'evaluation', countPolicy: 'highest' })
    assert.equal(highestOne.success, false)
    assert.deepEqual(highestOne.error?.issues[0]?.path, ['countPolicy'])
    assert.equal(evaluation({ maxAttempts: 3, countPolicy: 'highest' }).countPolicy, 'highest')
  })

  test('DOM-BEC-042 hakkı biten kursiyer yeni deneme başlatamaz', () => {
    const rules = evaluation({ maxAttempts: 2 })
    const now = '2026-11-05T12:00:00.000Z'
    const first = planAttemptStart({ rules, timing: timing(), attempts: [], now })
    assert.deepEqual(first, {
      attemptNumber: 1,
      startedAt: now,
      endsAt: '2026-11-05T12:30:00.000Z',
    })
    const done = attempt({ submittedAt: plusMs(startedAt, 60_000) })
    assert.equal(
      planAttemptStart({ rules, timing: timing(), attempts: [done], now }).attemptNumber,
      2,
    )
    const attempts = [done, attempt({ id: 'test-a2', submittedAt: plusMs(startedAt, 120_000) })]
    assert.throws(
      () => planAttemptStart({ rules, timing: timing(), attempts, now }),
      isDomainError('attempt_limit_reached'),
    )
    assert.equal(attempts.length, 2)
  })

  test('DOM-BEC-042 süresi dolup teslim edilmemiş deneme de hak tüketir', () => {
    const expired = attempt({ startedAt: '2026-11-05T09:00:00.000Z' })
    assert.throws(
      () =>
        planAttemptStart({
          rules: evaluation(),
          timing: timing(),
          attempts: [expired],
          now: '2026-11-05T12:00:00.000Z',
        }),
      isDomainError('attempt_limit_reached'),
    )
  })

  test('DOM-BEC-041 alıştırma sınırsız denenir ama süren deneme varken ikincisi açılmaz', () => {
    const now = '2026-11-05T12:00:00.000Z'
    const finished = Array.from({ length: 10 }, (_, i) =>
      attempt({ id: `test-a${i}`, submittedAt: plusMs(startedAt, i * 1000) }),
    )
    assert.equal(
      planAttemptStart({ rules: practice, timing: timing(), attempts: finished, now })
        .attemptNumber,
      11,
    )
    const running = attempt({ startedAt: '2026-11-05T11:50:00.000Z' })
    assert.throws(
      () => planAttemptStart({ rules: practice, timing: timing(), attempts: [running], now }),
      isDomainError('attempt_in_progress', 'conflict'),
    )
  })

  test('DOM-BEC-044 teslim kapandıktan sonra deneme başlamaz', () => {
    assert.throws(
      () =>
        planAttemptStart({
          rules: practice,
          timing: timing(),
          attempts: [],
          now: plusMs(due, 1),
        }),
      isDomainError('submission_closed'),
    )
    assert.doesNotThrow(() =>
      planAttemptStart({ rules: practice, timing: timing(), attempts: [], now: due }),
    )
  })

  const completed = (id: string, minute: number, ratio: number): CompletedAttempt => ({
    id,
    completedAt: plusMs(startedAt, minute * 60_000),
    score: { earned: ratio * 10, possible: 10, percent: Math.round(ratio * 100), ratio, items: [] },
  })

  test('DOM-BEC-042 sayılan sonuç varsayılan olarak ilk tamamlanan denemedir', () => {
    const list = [completed('test-c2', 20, 0.9), completed('test-c1', 10, 0.4)]
    assert.equal(countedAttempt(evaluation({ maxAttempts: 2 }), list)?.id, 'test-c1')
    assert.equal(countedAttempt(evaluation(), []), null)
  })

  test('DOM-BEC-042 en yüksek politikasında en yüksek oran, eşitlikte önce tamamlanan sayılır', () => {
    const rules = evaluation({ maxAttempts: 3, countPolicy: 'highest' })
    const list = [
      completed('test-c3', 30, 0.8),
      completed('test-c1', 10, 0.5),
      completed('test-c2', 20, 0.8),
    ]
    assert.equal(countedAttempt(rules, list)?.id, 'test-c2')
    assert.equal(countedAttempt(rules, []), null)
  })

  test('DOM-BEC-041 alıştırma sayılan sonuç üretmez (not ve kanıta girmez)', () => {
    assert.equal(countedAttempt(practice, [completed('test-c1', 10, 1)]), null)
  })
})

describe('süreli görev (DOM-BEC-043)', () => {
  test('DOM-BEC-043 bitiş başlangıç + süre + bireysel ek süredir, teslim kapanışını aşmaz', () => {
    assert.equal(attemptEndsAt(startedAt, timing()), '2026-11-05T10:30:00.000Z')
    assert.equal(attemptEndsAt(startedAt, timing({ extraMinutes: 15 })), '2026-11-05T10:45:00.000Z')
    assert.equal(attemptEndsAt('2026-11-05T20:50:00.000Z', timing()), due)
    assert.equal(attemptEndsAt(startedAt, timing({ timeLimitMinutes: null })), due)
    assert.equal(
      attemptEndsAt(startedAt, timing({ timeLimitMinutes: null, deadline: deadline() })),
      null,
    )
    assert.equal(
      attemptEndsAt(startedAt, timing({ deadline: deadline() })),
      '2026-11-05T10:30:00.000Z',
    )
  })

  test('DOM-BEC-043 son saniyede cevap kaydedilir, bitiş anında ve sonrasında kaydedilmez', () => {
    const endsAt = '2026-11-05T10:30:00.000Z'
    const base = { attempt: attempt(), timing: timing(), items: all }
    const answers: Answers = { 'test-q-mc': { questionType: 'multiple_choice', optionId: 'b' } }
    const saved = planAnswerSave({ ...base, answers, now: plusMs(endsAt, -1) })
    assert.deepEqual(saved, answers)
    for (const now of [endsAt, plusMs(endsAt, 1)]) {
      assert.throws(
        () => planAnswerSave({ ...base, answers, now }),
        isDomainError('attempt_time_over'),
        now,
      )
    }
    assert.deepEqual(base.attempt.answers, {})
  })

  test('DOM-BEC-043 durum sunucu saatine göre: kalan süre, tam eşitlikte süre dolmuştur', () => {
    const endsAt = '2026-11-05T10:30:00.000Z'
    const running = attemptState(attempt(), timing(), plusMs(endsAt, -1000))
    assert.equal(running.status, 'in_progress')
    assert.equal(running.remainingMs, 1000)
    const atEnd = attemptState(attempt(), timing(), endsAt)
    assert.deepEqual(atEnd, {
      status: 'expired',
      endsAt,
      remainingMs: null,
      completedAt: endsAt,
      autoSubmitted: true,
    })
    const untimed = attemptState(
      attempt(),
      timing({ timeLimitMinutes: null, deadline: deadline() }),
      '2030-01-01T00:00:00.000Z',
    )
    assert.equal(untimed.status, 'in_progress')
    assert.equal(untimed.remainingMs, null)
    const submitted = attemptState(
      attempt({ submittedAt: '2026-11-05T10:10:00.000Z' }),
      timing(),
      '2026-11-05T11:00:00.000Z',
    )
    assert.equal(submitted.status, 'submitted')
    assert.equal(submitted.completedAt, '2026-11-05T10:10:00.000Z')
  })

  test('DOM-BEC-043 süre dolunca kaydedilmiş cevaplarla teslim edilir, geç gelen cevap alınmaz', () => {
    const saved: Answers = { 'test-q-mc': { questionType: 'multiple_choice', optionId: 'b' } }
    const result = planAttemptSubmit({
      attempt: attempt({ answers: saved }),
      timing: timing(),
      items: all,
      answers: { 'test-q-tf': { questionType: 'true_false', answer: 'true' } },
      now: '2026-11-05T13:00:00.000Z',
    })
    assert.deepEqual(result, {
      submittedAt: '2026-11-05T10:30:00.000Z',
      answers: saved,
      autoSubmitted: true,
    })
    assert.equal(scoreAttempt(all, result.answers).earned, 2)
  })

  test('DOM-BEC-043 süre içinde teslim cevapları birleştirir; ikinci teslim reddedilir', () => {
    const saved: Answers = { 'test-q-mc': { questionType: 'multiple_choice', optionId: 'a' } }
    const now = '2026-11-05T10:29:59.999Z'
    const result = planAttemptSubmit({
      attempt: attempt({ answers: saved }),
      timing: timing(),
      items: all,
      answers: { 'test-q-mc': { questionType: 'multiple_choice', optionId: 'b' } },
      now,
    })
    assert.equal(result.submittedAt, now)
    assert.equal(result.autoSubmitted, false)
    assert.deepEqual(result.answers, {
      'test-q-mc': { questionType: 'multiple_choice', optionId: 'b' },
    })
    assert.deepEqual(
      planAttemptSubmit({ attempt: attempt(), timing: timing(), items: all, now }).answers,
      {},
    )
    assert.throws(
      () =>
        planAttemptSubmit({
          attempt: attempt({ submittedAt: '2026-11-05T10:10:00.000Z' }),
          timing: timing(),
          items: all,
          now,
        }),
      isDomainError('attempt_already_submitted', 'conflict'),
    )
  })

  test('DOM-BEC-043 bireysel ek süre gerekçe ister', () => {
    assert.equal(
      extraTimeSchema.safeParse({ minutes: 20, reason: 'Okuma güçlüğü raporu' }).success,
      true,
    )
    assert.equal(extraTimeSchema.safeParse({ minutes: 20, reason: ' ' }).success, false)
    assert.equal(extraTimeSchema.safeParse({ minutes: 0, reason: 'Rapor' }).success, false)
    assert.equal(extraTimeSchema.safeParse({ minutes: 301, reason: 'Rapor' }).success, false)
  })
})

describe('geç teslim (DOM-BEC-044)', () => {
  test('DOM-BEC-044 son teslim Europe/Istanbul yerel saatiyle girilir, UTC saklanır', () => {
    assert.equal(istanbulLocalToUtc('2026-11-05T23:59'), due)
    assert.equal(istanbulLocalToUtc('2026-01-01T00:00'), '2025-12-31T21:00:00.000Z')
    // 2016 öncesi yaz saati: Istanbul o tarihte UTC+3 değil UTC+2'ydi (kış).
    assert.equal(istanbulLocalToUtc('2015-01-15T12:00'), '2015-01-15T10:00:00.000Z')
    assert.equal(istanbulLocalToUtc('2026-02-30T10:00'), null)
    assert.equal(istanbulLocalToUtc('2026-11-05 23:59'), null)
    assert.equal(istanbulLocalDueSchema.parse(' 2026-11-05T23:59 '), due)
    assert.equal(istanbulLocalDueSchema.safeParse('yarın').success, false)
  })

  test('DOM-BEC-044 tam son teslim anı zamanındadır, bir milisaniye sonrası geçtir', () => {
    const d = deadline({ dueAt: due, lateAcceptanceDays: 2 })
    assert.equal(isLate(plusMs(due, -1), d), false)
    assert.equal(isLate(due, d), false)
    assert.equal(isLate(plusMs(due, 1), d), true)
    assert.equal(isLate(new Date(plusMs(due, 1)), d), true)
    assert.equal(isLate('2030-01-01T00:00:00.000Z', deadline()), false)
  })

  test('DOM-BEC-044 geç kabul varsayılan kapalı; en fazla 7 gün, bitiş anı dahil açıktır', () => {
    assert.deepEqual(deadline({ dueAt: due }), { dueAt: due, lateAcceptanceDays: 0 })
    assert.equal(deadlineSchema.safeParse({ dueAt: due, lateAcceptanceDays: 8 }).success, false)
    assert.equal(deadlineSchema.safeParse({ dueAt: '2026-11-05T23:59' }).success, false)
    const closed = deadline({ dueAt: due })
    assert.equal(isClosed(closed, due), false)
    assert.equal(isClosed(closed, plusMs(due, 1)), true)
    const week = deadline({ dueAt: due, lateAcceptanceDays: 7 })
    const closesAt = '2026-11-12T20:59:00.000Z'
    assert.deepEqual(submissionWindow(week), { dueAt: due, closesAt })
    assert.equal(isClosed(week, closesAt), false)
    assert.equal(isClosed(week, plusMs(closesAt, 1)), true)
    assert.deepEqual(submissionWindow(deadline()), { dueAt: null, closesAt: null })
    assert.equal(isClosed(deadline(), '2099-01-01T00:00:00.000Z'), false)
  })

  test('DOM-BEC-044 geç kabul süresinde başlayan deneme geç işaretlenir', () => {
    const d = deadline({ dueAt: due, lateAcceptanceDays: 1 })
    const start = plusMs(due, 60_000)
    const plan = planAttemptStart({
      rules: practice,
      timing: timing({ deadline: d }),
      attempts: [],
      now: start,
    })
    assert.equal(plan.endsAt, plusMs(start, 30 * 60_000))
    assert.equal(isLate(plan.endsAt ?? '', d), true)
  })
})

describe('cevap ve geri bildirimin açılması (DOM-BEC-045)', () => {
  const week = deadline({ dueAt: due, lateAcceptanceDays: 1 })
  const closesAt = '2026-11-06T20:59:00.000Z'

  test('DOM-BEC-045 değerlendirmede anahtar geç kabul bitene kadar kapalıdır', () => {
    const base = { kind: 'evaluation' as const, deadline: week, attemptCompleted: true }
    assert.equal(answerKeyReleased({ ...base, now: plusMs(due, 1) }), false)
    assert.equal(answerKeyReleased({ ...base, now: closesAt }), false)
    assert.equal(answerKeyReleased({ ...base, now: plusMs(closesAt, 1) }), true)
    assert.equal(
      answerKeyReleased({ ...base, deadline: deadline(), now: '2099-01-01T00:00:00.000Z' }),
      false,
    )
  })

  test('DOM-BEC-045 alıştırmada anahtar deneme biter bitmez açılır', () => {
    const base = { kind: 'practice' as const, deadline: week, now: '2026-11-05T11:00:00.000Z' }
    assert.equal(answerKeyReleased({ ...base, attemptCompleted: false }), false)
    assert.equal(answerKeyReleased({ ...base, attemptCompleted: true }), true)
  })

  test('DOM-BEC-045 kursiyer tamamlanınca yalnız puanını, anahtar açılınca ayrıntıyı görür', () => {
    const t = timing({ deadline: week })
    const now = '2026-11-05T10:10:00.000Z'
    const running = attemptState(attempt(), t, now)
    const done = attemptState(attempt({ submittedAt: now }), t, now)
    assert.equal(
      learnerResultLevel({ kind: 'evaluation', deadline: week, attempt: running, now }),
      'none',
    )
    assert.equal(
      learnerResultLevel({ kind: 'evaluation', deadline: week, attempt: done, now }),
      'score',
    )
    assert.equal(
      learnerResultLevel({
        kind: 'evaluation',
        deadline: week,
        attempt: done,
        now: plusMs(closesAt, 1),
      }),
      'full',
    )
    assert.equal(
      learnerResultLevel({ kind: 'practice', deadline: week, attempt: done, now }),
      'full',
    )
    assert.equal(
      learnerResultLevel({ kind: 'practice', deadline: week, attempt: running, now }),
      'none',
    )
  })

  test('DOM-BEC-045 öğretmen geri bildirimi puanlama tamamlanınca açılır', () => {
    const gradedAt = '2026-11-07T09:00:00.000Z'
    assert.equal(teacherFeedbackReleased(null, gradedAt), false)
    assert.equal(teacherFeedbackReleased(gradedAt, plusMs(gradedAt, -1)), false)
    assert.equal(teacherFeedbackReleased(gradedAt, gradedAt), true)
  })
})
