import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { TaskAssignmentLearner } from '@kampus/react-shared/use-task-assignments.ts'
import type { TaskAttempt } from '@kampus/react-shared/use-task-attempts.ts'
import type { TaskSubmission } from '@kampus/react-shared/use-task-submissions.ts'
import {
  acceptedText,
  answeredCount,
  autoProgress,
  blockedByMessage,
  describeKey,
  describeResponse,
  formatRemaining,
  FAILED,
  INSTRUCTIONS_FALLBACK,
  isAnswered,
  newerRowVersion,
  writingInitialBody,
  writingInstructions,
  releasedScore,
  resubmissionPending,
  splitGapStem,
  studentTaskRow,
  writingProgress,
  type AttemptQuestion,
} from '../src/pages/tasks/student-task-model.ts'

const NOW = new Date('2026-10-15T09:00:00.000Z')
const FUTURE = '2026-10-20T20:59:00.000Z'
const PAST = '2026-10-10T20:59:00.000Z'

const auto = (overrides: Partial<TaskAssignmentLearner> = {}): TaskAssignmentLearner => ({
  view: 'learner',
  id: 'as-1',
  resourceId: 'r-1',
  resourceVersionId: 'rv-1',
  title: 'Okuma quizi',
  contentType: 'quiz',
  scoringMode: 'auto',
  kind: 'evaluation',
  attempts: { kind: 'evaluation', maxAttempts: 2, countPolicy: 'first' },
  deadline: { dueAt: FUTURE, lateAcceptanceDays: 0 },
  timeLimitMinutes: null,
  listeningPlays: null,
  showTranscript: false,
  submission: null,
  createdAt: '2026-10-01T09:00:00.000Z',
  learnerIds: ['s-1'],
  ...overrides,
})

const writing = (overrides: Partial<TaskAssignmentLearner> = {}) =>
  auto({
    contentType: 'homework_template',
    scoringMode: 'teacher',
    attempts: { kind: 'evaluation', maxAttempts: 1, countPolicy: 'first' },
    submission: { submissionKind: 'text', maxVersions: 3, minWords: 50, maxWords: 150 },
    ...overrides,
  })

const attempt = (overrides: Partial<TaskAttempt> = {}): TaskAttempt => ({
  id: 'at-1',
  assignmentId: 'as-1',
  learnerId: 's-1',
  attemptNumber: 1,
  status: 'submitted',
  startedAt: '2026-10-14T09:00:00.000Z',
  endsAt: null,
  remainingMs: null,
  completedAt: '2026-10-14T09:10:00.000Z',
  autoSubmitted: false,
  late: false,
  counted: true,
  answers: {},
  result: { earned: 3, possible: 4, percent: 75, items: null, answerKey: null },
  rowVersion: 3,
  ...overrides,
})

const submission = (overrides: Partial<TaskSubmission> = {}): TaskSubmission => ({
  id: 'sub-1',
  assignmentId: 'as-1',
  learnerId: 's-1',
  status: 'submitted',
  versionCount: 1,
  latestVersion: {
    id: 'v-1',
    number: 1,
    submittedAt: '2026-10-14T09:00:00.000Z',
    late: false,
    wordCount: { count: 80, status: 'ok', warning: null },
    score: null,
  },
  resubmission: null,
  rowVersion: null,
  ...overrides,
})

describe('öğrenci quiz durumu (DOM-BEC-042, 044)', () => {
  test('DOM-BEC-042: hiç deneme yokken başlatılabilir; hak 0 / 2 görünür', () => {
    const progress = autoProgress(auto(), [], NOW)
    assert.equal(progress.status, 'Başlanmadı')
    assert.equal(progress.rights, '0 / 2 deneme')
    assert.equal(progress.canAct, true)
    assert.equal(progress.score, '—')
  })

  test('DOM-BEC-042: süren deneme "Sürüyor" ve devam edilebilir, puan gösterilmez', () => {
    const progress = autoProgress(auto(), [attempt({ status: 'in_progress', result: null })], NOW)
    assert.equal(progress.status, 'Sürüyor')
    assert.equal(progress.canAct, true)
    assert.equal(progress.score, '—')
  })

  test('DOM-BEC-042: tamamlanan denemenin kendi puanı görünür; hak dolunca neden gösterilir', () => {
    const progress = autoProgress(
      auto({ attempts: { kind: 'evaluation', maxAttempts: 1, countPolicy: 'first' } }),
      [attempt()],
      NOW,
    )
    assert.equal(progress.status, 'Tamamlandı')
    assert.equal(progress.score, '75 / 100')
    assert.equal(progress.canAct, false)
    assert.equal(progress.blockedReason, 'Deneme hakkınız doldu.')
  })

  test('DOM-BEC-042: alıştırma sınırsızdır ve her zaman yeniden denenebilir', () => {
    const progress = autoProgress(
      auto({ kind: 'practice', attempts: { kind: 'practice' } }),
      [attempt({ counted: false }), attempt({ id: 'at-2', attemptNumber: 2, counted: false })],
      NOW,
    )
    assert.equal(progress.rights, 'Sınırsız')
    assert.equal(progress.canAct, true)
  })

  test('DOM-BEC-044: teslim kapanınca başlatılamaz; hiç denenmemişse "Teslim edilmedi"', () => {
    const closed = auto({ deadline: { dueAt: PAST, lateAcceptanceDays: 0 } })
    const progress = autoProgress(closed, [], NOW)
    assert.equal(progress.status, 'Teslim edilmedi')
    assert.equal(progress.canAct, false)
    assert.match(progress.blockedReason ?? '', /Teslim süresi doldu/)
  })

  test('DOM-BEC-044: geç kabul süresindeki deneme açıktır; geç tamamlanan denemeye işaret konur', () => {
    const open = auto({ deadline: { dueAt: PAST, lateAcceptanceDays: 7 } })
    assert.equal(autoProgress(open, [], NOW).canAct, true)
    assert.equal(autoProgress(open, [attempt({ late: true })], NOW).status, 'Geç tamamlandı')
  })

  test('DOM-BEC-044: süren deneme teslim kapanmış olsa da sürdürülür (sunucu bitişi belirler)', () => {
    const closed = auto({ deadline: { dueAt: PAST, lateAcceptanceDays: 0 } })
    const progress = autoProgress(closed, [attempt({ status: 'in_progress', result: null })], NOW)
    assert.equal(progress.canAct, true)
  })
})

describe('öğrenci yazma görevi durumu (DOM-BEC-040, 044, 045)', () => {
  test('DOM-BEC-044: teslim yokken pencere açıksa "Bekliyor", kapandıysa "Teslim edilmedi"', () => {
    assert.equal(writingProgress(writing(), null, NOW).status, 'Bekliyor')
    assert.equal(writingProgress(writing(), null, NOW).canAct, true)
    const closed = writingProgress(
      writing({ deadline: { dueAt: PAST, lateAcceptanceDays: 0 } }),
      null,
      NOW,
    )
    assert.equal(closed.status, 'Teslim edilmedi')
    assert.equal(closed.canAct, false)
  })

  test('DOM-BEC-045: puan açılmadıysa durumda ve puan sütununda hiçbir ipucu yoktur', () => {
    const progress = writingProgress(writing(), submission(), NOW)
    assert.equal(progress.status, 'Teslim edildi')
    assert.equal(progress.score, '—')
    assert.doesNotMatch(
      `${progress.status} ${progress.rights} ${progress.blockedReason ?? ''}`,
      /puan|değerlendir/i,
    )
  })

  test('DOM-BEC-045: açılmış ve kesinleşmiş puan yüzde olarak gösterilir; kesinleşmemiş puan gösterilmez', () => {
    const score = {
      settled: true,
      rubricVersionId: 'rb-1',
      total: 8,
      max: 10,
      percent: 80,
      scoredAt: '2026-10-15T08:00:00.000Z',
    }
    const released = submission({
      latestVersion: { ...submission().latestVersion!, score },
    })
    assert.equal(releasedScore(released), 80)
    assert.equal(writingProgress(writing(), released, NOW).score, '80 / 100')
    const unsettled = submission({
      latestVersion: { ...submission().latestVersion!, score: { ...score, settled: false } },
    })
    assert.equal(releasedScore(unsettled), null)
  })

  test('DOM-BEC-040: yeniden teslim istendiyse durum bunu söyler ve yeni sürüm gönderilebilir', () => {
    const asked = submission({ resubmission: { versionNumber: 1, dueAt: FUTURE } })
    assert.equal(resubmissionPending(asked), true)
    assert.equal(writingProgress(writing(), asked, NOW).status, 'Yeniden teslim istendi')
    const answered = submission({
      versionCount: 2,
      latestVersion: { ...submission().latestVersion!, number: 2 },
      resubmission: { versionNumber: 1, dueAt: FUTURE },
    })
    assert.equal(resubmissionPending(answered), false)
  })

  test('DOM-BEC-040: sürüm hakkı ve geç teslim işareti listelenir', () => {
    const late = submission({ status: 'late', versionCount: 2 })
    const progress = writingProgress(writing(), late, NOW)
    assert.equal(progress.status, 'Geç teslim edildi')
    assert.equal(progress.rights, '2 / 3 sürüm')
  })

  test('DOM-BEC-045: allowance engelleri puanlamadan bağımsız anlatılır; locked puandan söz etmez', () => {
    const detail = (blockedBy: 'limit' | 'graded' | 'locked') =>
      writingProgress(
        writing(),
        {
          ...submission(),
          allowance: {
            limit: 3,
            used: 3,
            remaining: 0,
            resubmissionOpen: false,
            canSubmit: false,
            blockedBy,
          },
        },
        NOW,
      )
    assert.equal(detail('limit').canAct, false)
    assert.equal(detail('limit').blockedReason, blockedByMessage('limit'))
    assert.equal(detail('graded').blockedReason, blockedByMessage('graded'))
    assert.equal(detail('locked').blockedReason, blockedByMessage('locked'))
    assert.doesNotMatch(blockedByMessage('locked'), /puan|değerlendir|not/i)
    assert.doesNotMatch(blockedByMessage('limit'), /puan|değerlendir/i)
  })

  test('IST-051: allowance varken düğme kararı sunucunundur', () => {
    const progress = writingProgress(
      writing(),
      {
        ...submission(),
        allowance: {
          limit: 3,
          used: 1,
          remaining: 2,
          resubmissionOpen: false,
          canSubmit: true,
          blockedBy: null,
        },
      },
      NOW,
    )
    assert.equal(progress.canAct, true)
    assert.equal(progress.blockedReason, null)
  })
})

test('IST-051: satır, ilerleme okunmadıysa beklemede işaretlenir', () => {
  const row = studentTaskRow(auto(), null)
  assert.equal(row.pending, true)
  assert.equal(row.type, 'Quiz')
  assert.equal(row.kind, 'Değerlendirme')
  const loaded = studentTaskRow(auto(), autoProgress(auto(), [], NOW))
  assert.equal(loaded.pending, false)
  assert.equal(loaded.status, 'Başlanmadı')
})

const question = (body: AttemptQuestion['question']): AttemptQuestion => ({
  questionVersionId: 'q-1',
  points: 1,
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
  test('IST-051 satır okuması başarısızsa yalnız o satır Okunamadı olur, diğerleri etkilenmez', () => {
    const failed = studentTaskRow(auto(), null, true)
    assert.equal(failed.status, FAILED.status)
    assert.equal(failed.tone, 'red')
    assert.equal(studentTaskRow(auto(), null).status, 'Yükleniyor')
    const ok = studentTaskRow(auto(), autoProgress(auto(), [], NOW), false)
    assert.equal(ok.status, 'Başlanmadı')
  })

  test('DOM-BEC-043 cevap kaydı sürümü geri alınmaz, yalnız ilerler', () => {
    assert.equal(newerRowVersion(5, 4), 5)
    assert.equal(newerRowVersion(5, 6), 6)
    assert.equal(newerRowVersion(5, 5), 5)
  })

  test('DOM-BEC-040 editör, son sürümden eski taslağı değil gönderilen metni açar', () => {
    const detail = { versions: [{ body: 'gönderilen', submittedAt: '2026-10-15T09:00:10.000Z' }] }
    const oldDraft = { body: 'eksik taslak', savedAt: '2026-10-15T09:00:00.000Z' }
    const newDraft = { body: 'yeni taslak', savedAt: '2026-10-15T09:05:00.000Z' }
    assert.equal(writingInitialBody(oldDraft, detail, true), 'gönderilen')
    assert.equal(writingInitialBody(oldDraft, detail, false), '')
    assert.equal(writingInitialBody(newDraft, detail, true), 'yeni taslak')
    assert.equal(writingInitialBody(newDraft, { versions: [] }, false), 'yeni taslak')
    assert.equal(writingInitialBody(null, detail, true), 'gönderilen')
    assert.equal(writingInitialBody(null, null, false), '')
  })

  test('DOM-KYN-024 yönerge yalnız sabitlenen sürümle okunabilir; aksi hâlde boş (yedek metin gösterilir)', () => {
    const resource = (id: string, instructions: unknown = 'Write 100 words.') => ({
      view: 'learner',
      version: { id, content: { type: 'homework_template', instructions } },
    })
    const assignment = { resourceVersionId: 'rv-1' }
    assert.equal(writingInstructions(resource('rv-1'), assignment), 'Write 100 words.')
    assert.equal(writingInstructions(resource('rv-2'), assignment), null)
    assert.equal(writingInstructions(resource('rv-1', 5), assignment), null)
    assert.equal(writingInstructions({ view: 'staff' }, assignment), null)
    assert.equal(writingInstructions(undefined, assignment), null)
    assert.match(INSTRUCTIONS_FALLBACK, /öğretmeninizden/)
  })
})
