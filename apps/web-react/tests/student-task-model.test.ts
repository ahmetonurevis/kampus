import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { TASK_CONTENT_UNAVAILABLE_MESSAGE } from '@kampus/react-shared/use-task-assignments.ts'
import {
  acceptedText,
  answeredCount,
  attemptClock,
  attemptContentNote,
  attemptResultHeading,
  attemptStatusBadge,
  describeKey,
  describeResponse,
  formatPoints,
  formatRemaining,
  isAnswered,
  itemOutcome,
  newerRowVersion,
  splitGapStem,
  TASK_CONTENT_REMOVED_MESSAGE,
  type AttemptQuestion,
} from '../src/pages/tasks/student-task-model.ts'

// Liste satırı, yazma/quiz görevi durumu ve yönerge testleri react-shared'e taşındı
// (`packages/react-shared/test/student-task-model.test.ts`); burada deneme çözme ve sonuç kalır.

const FUTURE = '2026-10-20T20:59:00.000Z'
const PAST = '2026-10-10T20:59:00.000Z'

describe('OG-986 deneme saati (DOM-BEC-043)', () => {
  test('DOM-BEC-043: süre sınırı olmayan denemede geri sayım yok; son teslim Europe/Istanbul tarihiyle', () => {
    // 119 saatlik pencere geri sayım olarak gösterilmez.
    const untimed = attemptClock({
      timeLimitMinutes: null,
      dueAt: FUTURE,
      remainingMs: 431_998_000,
    })
    assert.deepEqual(untimed, { text: 'Son teslim: 20 Eki 2026 23:59', tone: 'gray' })
    assert.equal(attemptClock({ timeLimitMinutes: null, dueAt: null, remainingMs: null }), null)
    // Pencere kapandıysa sunucu teslim eder; ekran bunu söyler.
    assert.deepEqual(attemptClock({ timeLimitMinutes: null, dueAt: PAST, remainingMs: 0 }), {
      text: 'Teslim süresi doldu',
      tone: 'red',
    })
  })

  test('DOM-BEC-043: süreli denemede kalan süre geri sayılır; son dakika kırmızı', () => {
    assert.deepEqual(attemptClock({ timeLimitMinutes: 20, dueAt: FUTURE, remainingMs: 600_000 }), {
      text: 'Kalan süre 10:00',
      tone: 'gray',
    })
    assert.deepEqual(attemptClock({ timeLimitMinutes: 20, dueAt: null, remainingMs: 59_000 }), {
      text: 'Kalan süre 00:59',
      tone: 'red',
    })
    assert.deepEqual(attemptClock({ timeLimitMinutes: 20, dueAt: null, remainingMs: -5 }), {
      text: 'Süre doldu',
      tone: 'red',
    })
  })
})

const question = (body: AttemptQuestion['question']): AttemptQuestion => ({
  questionVersionId: 'q-1',
  points: 1,
  subskill: null,
  question: body,
})

describe('cevap yardımcıları', () => {
  test('isAnswered: her soru türünde tam cevabı ayırt eder', () => {
    const mc = question({
      questionType: 'multiple_choice',
      stem: 'S',
      options: [{ id: 'a', text: 'A' }],
      imageFileId: null,
    })
    assert.equal(isAnswered(mc, undefined), false)
    assert.equal(isAnswered(mc, { questionType: 'multiple_choice', optionId: null }), false)
    assert.equal(isAnswered(mc, { questionType: 'multiple_choice', optionId: 'a' }), true)

    const matching = question({
      questionType: 'matching',
      stem: 'S',
      prompts: [
        { id: 'p1', text: 'one' },
        { id: 'p2', text: 'two' },
      ],
      choices: [
        { id: 'c1', text: 'bir' },
        { id: 'c2', text: 'iki' },
      ],
    })
    assert.equal(
      isAnswered(matching, {
        questionType: 'matching',
        pairs: [{ promptId: 'p1', choiceId: 'c1' }],
      }),
      false,
    )
    assert.equal(
      isAnswered(matching, {
        questionType: 'matching',
        pairs: [
          { promptId: 'p1', choiceId: 'c1' },
          { promptId: 'p2', choiceId: 'c2' },
        ],
      }),
      true,
    )

    const gap = question({
      questionType: 'gap_fill',
      stem: 'A {{g1}} B {{g2}}',
      gaps: [
        { id: 'g1', options: [] },
        { id: 'g2', options: [] },
      ],
    })
    assert.equal(
      isAnswered(gap, { questionType: 'gap_fill', gaps: [{ gapId: 'g1', value: 'x' }] }),
      false,
    )
    assert.equal(
      isAnswered(gap, {
        questionType: 'gap_fill',
        gaps: [
          { gapId: 'g1', value: 'x' },
          { gapId: 'g2', value: ' y ' },
        ],
      }),
      true,
    )
    const short = question({
      questionType: 'short_answer',
      stem: 'S',
      maxLength: 100,
      imageFileId: null,
    })
    assert.equal(isAnswered(short, { questionType: 'short_answer', value: '  ' }), false)
    assert.equal(
      answeredCount([mc, short], {
        q1: { questionType: 'short_answer', value: 'x' },
      }),
      0,
    )
  })

  test('formatRemaining: dakika:saniye ve saat biçimi, negatif sıfıra iner', () => {
    assert.equal(formatRemaining(65_000), '01:05')
    assert.equal(formatRemaining(3_725_000), '1:02:05')
    assert.equal(formatRemaining(-5), '00:00')
    assert.equal(formatRemaining(1), '00:01')
  })

  test('splitGapStem: {{kimlik}} işaretlerini boşluk parçası yapar', () => {
    assert.deepEqual(
      splitGapStem('He {{g1}} to {{g2}}.').map((part) =>
        part.kind === 'text' ? part.text : `[${part.id}]`,
      ),
      ['He ', '[g1]', ' to ', '[g2]', '.'],
    )
    assert.equal(splitGapStem('düz').length, 1)
  })

  test('describeResponse ve describeKey: seçenek metnini, eşleştirmeyi ve sırayı okunur yazar', () => {
    const mc: AttemptQuestion['question'] = {
      questionType: 'multiple_choice',
      stem: 'S',
      options: [
        { id: 'a', text: 'He swims.' },
        { id: 'b', text: 'He reads.' },
      ],
      imageFileId: null,
    } as const
    assert.equal(
      describeResponse(mc, { questionType: 'multiple_choice', optionId: 'b' }),
      'He reads.',
    )
    assert.equal(describeResponse(mc, undefined), 'Cevapsız')
    assert.equal(
      describeKey(mc, { questionType: 'multiple_choice', correctOptionId: 'a', explanation: '' }),
      'He swims.',
    )
    const ordering: AttemptQuestion['question'] = {
      questionType: 'ordering',
      stem: 'S',
      items: [
        { id: 'i1', text: 'first' },
        { id: 'i2', text: 'second' },
      ],
    }
    assert.equal(
      describeResponse(ordering, { questionType: 'ordering', order: ['i2', 'i1'] }),
      'second → first',
    )
    assert.equal(
      describeKey(ordering, { questionType: 'ordering', order: ['i1', 'i2'], explanation: '' }),
      'first → second',
    )
    assert.equal(acceptedText(['go', 'goes']), 'go / goes')
    assert.equal(acceptedText(undefined), '')
  })
})

describe('W22a inceleme düzeltmeleri', () => {
  test('DOM-BEC-043 cevap kaydı sürümü geri alınmaz, yalnız ilerler', () => {
    assert.equal(newerRowVersion(5, 4), 5)
    assert.equal(newerRowVersion(5, 6), 6)
    assert.equal(newerRowVersion(5, 5), 5)
  })
})

describe('personel deneme görünümü (OG-983; DOM-BEC-042, DOM-BEC-045)', () => {
  const item = (overrides: Partial<Parameters<typeof itemOutcome>[0]> = {}) => ({
    questionVersionId: 'qv-1',
    parts: 1,
    correctParts: 1,
    answered: true,
    points: 1,
    earned: 1,
    ...overrides,
  })

  test('DOM-BEC-045: madde sonucu doğru, kısmen doğru, yanlış ve cevapsız ayrılır', () => {
    assert.deepEqual(itemOutcome(item()), { label: 'Doğru', tone: 'green' })
    assert.equal(itemOutcome(item({ parts: 3, correctParts: 2 })).label, 'Kısmen doğru')
    assert.equal(itemOutcome(item({ correctParts: 0, earned: 0 })).label, 'Yanlış')
    // Cevapsız madde yanlış sayılır ama ayrı yazılır; parça sayısı sıfır olsa da doğru değildir.
    assert.equal(itemOutcome(item({ answered: false, correctParts: 0 })).label, 'Cevapsız')
    assert.equal(itemOutcome(item({ parts: 0, correctParts: 0 })).label, 'Yanlış')
  })

  test('DOM-BEC-042: deneme durumu süren, geç, süre dolunca ve teslim olarak gösterilir', () => {
    const base = { status: 'submitted', late: false, autoSubmitted: false } as const
    assert.equal(attemptStatusBadge({ ...base, status: 'in_progress' }).label, 'Sürüyor')
    assert.equal(attemptStatusBadge(base).label, 'Teslim edildi')
    assert.equal(attemptStatusBadge({ ...base, late: true }).label, 'Geç teslim')
    assert.equal(
      attemptStatusBadge({ ...base, status: 'expired', autoSubmitted: true }).label,
      'Süre dolunca teslim',
    )
  })

  test('puan tamsayıda ondalıksız, kesirde en çok iki ondalık', () => {
    assert.equal(formatPoints(2), '2')
    assert.equal(formatPoints(1.5), '1,5')
    assert.equal(formatPoints(0.333), '0,33')
  })

  test('DOM-KYN-051, OG-997: kaldırılmış içerikte sonuç notu "Bu içerik kaldırıldı."; başka kapanışta genel not; açıkken not yok', () => {
    assert.equal(
      attemptContentNote({ contentRemoved: true, contentUnavailable: 'unavailable' }),
      TASK_CONTENT_REMOVED_MESSAGE,
    )
    assert.equal(TASK_CONTENT_REMOVED_MESSAGE, 'Bu içerik kaldırıldı.')
    assert.equal(
      attemptContentNote({ contentRemoved: false, contentUnavailable: 'unavailable' }),
      TASK_CONTENT_UNAVAILABLE_MESSAGE,
    )
    assert.equal(
      attemptContentNote({ contentRemoved: false, contentUnavailable: 'license_expired' }),
      TASK_CONTENT_UNAVAILABLE_MESSAGE,
    )
    assert.equal(attemptContentNote({ contentRemoved: false, contentUnavailable: null }), null)
  })

  test('DOM-KYN-051, DOM-BEC-045, OG-997: süren denemenin başlığı "sonuç" demez; teslim edilmiş ve süre dolmuş deneme "sonucu" der', () => {
    assert.equal(
      attemptResultHeading({ attemptNumber: 2, status: 'in_progress' }),
      '2. deneme (sürüyor)',
    )
    for (const status of ['submitted', 'expired'] as const)
      assert.equal(attemptResultHeading({ attemptNumber: 1, status }), '1. deneme sonucu')
  })
})
