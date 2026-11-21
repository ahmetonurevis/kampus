import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  autoProgress,
  blockedByMessage,
  FAILED,
  isLearnerAssignment,
  LAPSED_REASON,
  releasedScore,
  resubmissionPending,
  studentTaskRow,
  summaryProgress,
  writingBrief,
  writingInitialBody,
  writingProgress,
} from '../src/student-task-model.ts'
import type { LearnerTaskProgress } from '../src/use-learner-task-progress.ts'
import type {
  TaskAssignmentLearner,
  TaskAssignmentLearnerDetail,
} from '../src/use-task-assignments.ts'
import type { TaskAttempt } from '../src/use-task-attempts.ts'
import type { TaskSubmission } from '../src/use-task-submissions.ts'

// Web `apps/web-react/tests/student-task-model.test.ts`'ten taşındı (IST-124): liste satırı,
// yazma ve quiz görevi durumu, yönerge ve taslak açılışı web ile mobilde ortaktır.
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
  hasListening: false,
  showTranscript: false,
  submission: null,
  createdAt: '2026-10-01T09:00:00.000Z',
  learnerIds: ['s-1'],
  progress: [],
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
  learnerName: null,
  attemptNumber: 1,
  status: 'submitted',
  startedAt: '2026-10-14T09:00:00.000Z',
  endsAt: null,
  remainingMs: null,
  extraMinutes: 0,
  completedAt: '2026-10-14T09:10:00.000Z',
  autoSubmitted: false,
  late: false,
  counted: true,
  answers: {},
  result: { earned: 3, possible: 4, percent: 75, items: null, subskills: null, answerKey: null },
  feedback: null,
  contentRemoved: false,
  rowVersion: 3,
  ...overrides,
})

const submission = (overrides: Partial<TaskSubmission> = {}): TaskSubmission => ({
  id: 'sub-1',
  assignmentId: 'as-1',
  learnerId: 's-1',
  learnerName: null,
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

const entry = (overrides: Partial<LearnerTaskProgress> = {}): LearnerTaskProgress => ({
  learnerId: 's-1',
  status: 'pending',
  resubmissionRequested: false,
  attemptId: null,
  submissionId: null,
  lastActivityAt: null,
  used: 0,
  limit: 2,
  remaining: 2,
  canAct: true,
  actionableUntil: null,
  blockedBy: null,
  score: null,
  ...overrides,
})

const detail = (
  overrides: Partial<TaskAssignmentLearnerDetail> = {},
): TaskAssignmentLearnerDetail => ({
  ...writing(),
  content: null,
  contentUnavailable: 'unavailable',
  ...overrides,
})

describe('IST-051 liste satırı kursiyer özetinden (DOM-BEC-045)', () => {
  test('IST-051, DOM-BEC-043: süren denemenin bitişi geçince birincil işlem kalkar, neden "süre doldu"', () => {
    const endsAt = '2026-10-15T09:10:00.000Z'
    const assignment = auto({
      progress: [
        entry({
          status: 'in_progress',
          used: 1,
          canAct: false,
          blockedBy: 'in_progress',
          actionableUntil: endsAt,
        }),
      ],
    })
    const before = summaryProgress(assignment, new Date('2026-10-15T09:09:59.000Z'))
    assert.deepEqual([before?.canAct, before?.blockedReason], [true, null])
    const after = summaryProgress(assignment, new Date('2026-10-15T09:10:01.000Z'))
    assert.deepEqual([after?.status, after?.canAct], ['Sürüyor', false])
    assert.equal(after?.blockedReason, LAPSED_REASON)
  })

  test('IST-051, DOM-BEC-040: yeniden teslim süresi geçince "Yeni sürüm yaz" birincil kalmaz', () => {
    const dueAt = '2026-10-16T20:59:00.000Z'
    const assignment = writing({
      progress: [
        entry({
          status: 'submitted',
          used: 1,
          resubmissionRequested: true,
          actionableUntil: dueAt,
        }),
      ],
    })
    const open = summaryProgress(assignment, NOW)
    assert.deepEqual([open?.status, open?.canAct], ['Yeniden teslim istendi', true])
    const lapsed = summaryProgress(assignment, new Date('2026-10-16T21:00:00.000Z'))
    assert.deepEqual([lapsed?.canAct, lapsed?.blockedReason], [false, LAPSED_REASON])
  })

  test('otomatik puanlı: durum, hak ve yalnız açılmış puan', () => {
    const start = summaryProgress(auto({ progress: [entry()] }), NOW)
    assert.deepEqual(
      [start?.status, start?.rights, start?.score, start?.canAct],
      ['Başlanmadı', '0 / 2 deneme', '—', true],
    )
    const running = summaryProgress(
      auto({
        progress: [
          entry({ status: 'in_progress', used: 1, canAct: false, blockedBy: 'in_progress' }),
        ],
      }),
      NOW,
    )
    // Süren deneme sürdürülebilir: engel metni yok, işlem açık.
    assert.equal(running?.status, 'Sürüyor')
    assert.equal(running?.canAct, true)
    assert.equal(running?.blockedReason, null)
    const done = summaryProgress(
      auto({
        progress: [
          entry({
            status: 'late',
            used: 2,
            remaining: 0,
            canAct: false,
            blockedBy: 'limit',
            score: { earned: 3, possible: 4, percent: 75 },
          }),
        ],
      }),
      NOW,
    )
    assert.equal(done?.status, 'Geç tamamlandı')
    assert.equal(done?.score, '75 / 100')
    assert.equal(done?.blockedReason, 'Deneme hakkınız doldu.')
    const unlimited = summaryProgress(
      auto({ kind: 'practice', progress: [entry({ limit: null, remaining: null })] }),
      NOW,
    )
    assert.equal(unlimited?.rights, 'Sınırsız')
  })

  test('öğretmen puanlı: sürüm hakkı, yeniden teslim ve engel nedenleri', () => {
    const waiting = summaryProgress(writing({ progress: [entry({ limit: 3, remaining: 3 })] }), NOW)
    assert.deepEqual([waiting?.status, waiting?.rights], ['Bekliyor', '0 / 3 sürüm'])
    const asked = summaryProgress(
      writing({
        progress: [entry({ status: 'submitted', used: 1, limit: 3, resubmissionRequested: true })],
      }),
      NOW,
    )
    assert.equal(asked?.status, 'Yeniden teslim istendi')
    const graded = summaryProgress(
      writing({
        progress: [
          entry({
            status: 'submitted',
            used: 1,
            limit: 3,
            canAct: false,
            blockedBy: 'graded',
            score: { earned: 8, possible: 10, percent: 80 },
          }),
        ],
      }),
      NOW,
    )
    assert.equal(graded?.status, 'Teslim edildi')
    assert.equal(graded?.score, '80 / 100')
    assert.equal(graded?.blockedReason, blockedByMessage('graded'))
    const expired = summaryProgress(
      writing({ progress: [entry({ canAct: false, blockedBy: 'license_expired' })] }),
      NOW,
    )
    assert.match(expired?.blockedReason ?? '', /lisans/)
  })

  test('açılmamış puan hiçbir alana sızmaz: score null iken yalnız —', () => {
    const progress = summaryProgress(
      writing({ progress: [entry({ status: 'submitted', used: 1, score: null })] }),
      NOW,
    )
    assert.equal(progress?.score, '—')
    assert.doesNotMatch(JSON.stringify(progress), /puanlan|değerlendiril|ikinci|itiraz/i)
  })

  test('DOM-BEC-044 ekran açıkken süresi dolan başlanmamış görev Teslim edilmedi olur', () => {
    const progress = summaryProgress(
      auto({ deadline: { dueAt: PAST, lateAcceptanceDays: 0 }, progress: [entry()] }),
      NOW,
    )
    assert.equal(progress?.status, 'Teslim edilmedi')
    assert.equal(progress?.canAct, false)
    assert.match(progress?.blockedReason ?? '', /süresi doldu/)
  })

  test('veli: özet çocuk kimliğiyle seçilir', () => {
    const assignment = auto({
      learnerIds: ['c-1', 'c-2'],
      progress: [
        entry({ learnerId: 'c-1' }),
        entry({ learnerId: 'c-2', status: 'submitted', used: 1 }),
      ],
    })
    assert.equal(summaryProgress(assignment, NOW, 'c-2')?.status, 'Tamamlandı')
    assert.equal(summaryProgress(assignment, NOW, 'c-3'), null)
  })
})

describe('OG-985 içerik kapısı engeli (DOM-KYN-025, DOM-KYN-021)', () => {
  const closed = entry({ canAct: false, blockedBy: 'content_unavailable' })

  test('DOM-KYN-025: özet content_unavailable ise listede ve panelde birincil işlem yok, sakin not var', () => {
    for (const assignment of [auto({ progress: [closed] }), writing({ progress: [closed] })]) {
      const progress = summaryProgress(assignment, NOW)
      assert.equal(progress?.canAct, false)
      assert.equal(progress?.blockedReason, 'Bu içerik şu an kullanıma kapalı.')
    }
    // Kaldırılmış içerikte süren deneme de sürdürülemez: "Denemeye devam et" önerilmez.
    const running = summaryProgress(
      auto({ progress: [entry({ ...closed, status: 'in_progress' })] }),
      NOW,
    )
    assert.equal(running?.canAct, false)
  })

  test('DOM-KYN-025: çalışma alanı da yeni deneme ve teslim önermez; yerel nedenin yerine geçer', () => {
    const quiz = autoProgress(auto({ progress: [closed] }), [], NOW)
    assert.deepEqual(
      [quiz.canAct, quiz.blockedReason],
      [false, 'Bu içerik şu an kullanıma kapalı.'],
    )
    const lapsed = autoProgress(
      auto({ deadline: { dueAt: PAST, lateAcceptanceDays: 0 }, progress: [closed] }),
      [],
      NOW,
    )
    assert.equal(lapsed.blockedReason, 'Bu içerik şu an kullanıma kapalı.')
    const draft = writingProgress(writing({ progress: [closed] }), null, NOW)
    assert.deepEqual(
      [draft.canAct, draft.blockedReason],
      [false, 'Bu içerik şu an kullanıma kapalı.'],
    )
    const allowed = writingProgress(
      writing({ progress: [closed] }),
      {
        ...submission(),
        allowance: { canSubmit: true, blockedBy: null, limit: 3, remaining: 2 },
      } as never,
      NOW,
    )
    assert.equal(allowed.canAct, false)
  })

  test('DOM-KYN-025, DOM-KYN-051: kaldırılmış içerikte süren deneme de sürdürülmez (çözme ekranı açılmaz); askıdaki süren deneme sürer (Sabah kararı 47)', () => {
    const ongoing = [attempt({ status: 'in_progress', completedAt: null, result: null })]
    const removed = autoProgress(auto({ progress: [closed] }), ongoing, NOW)
    assert.deepEqual(
      [removed.status, removed.canAct, removed.blockedReason],
      ['Sürüyor', false, 'Bu içerik şu an kullanıma kapalı.'],
    )
    // Askıda + süren deneme: özet `in_progress` der, deneme sürer.
    const reported = entry({ status: 'in_progress', canAct: false, blockedBy: 'in_progress' })
    const kept = autoProgress(auto({ progress: [reported] }), ongoing, NOW)
    assert.deepEqual([kept.canAct, kept.blockedReason], [true, null])
  })

  test('DOM-KYN-021: lisans engeli çalışma alanında yalnız başka neden yokken gösterilir', () => {
    const expired = entry({ canAct: false, blockedBy: 'license_expired' })
    const open = autoProgress(auto({ progress: [expired] }), [], NOW)
    assert.equal(open.canAct, false)
    assert.match(open.blockedReason ?? '', /lisans/)
    const late = autoProgress(
      auto({ deadline: { dueAt: PAST, lateAcceptanceDays: 0 }, progress: [expired] }),
      [],
      NOW,
    )
    assert.equal(late.blockedReason, 'Teslim süresi doldu; yeni deneme başlatılamaz.')
    // Özet engel söylemiyorsa yerel karar değişmez.
    assert.equal(autoProgress(auto({ progress: [entry()] }), [], NOW).canAct, true)
  })
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

test('IST-051: satır türü ve amacı atamadan, durumu özetten gelir', () => {
  const row = studentTaskRow(auto(), autoProgress(auto(), [], NOW))
  assert.equal(row.type, 'Quiz')
  assert.equal(row.kind, 'Değerlendirme')
  assert.equal(row.status, 'Başlanmadı')
})

describe('W22a inceleme düzeltmeleri', () => {
  test('IST-051 özeti olmayan satır yalnız kendisi Okunamadı olur, diğerleri etkilenmez', () => {
    const failed = studentTaskRow(auto(), summaryProgress(auto(), NOW))
    assert.equal(failed.status, FAILED.status)
    assert.equal(failed.tone, 'red')
    const ok = studentTaskRow(auto(), summaryProgress(auto({ progress: [entry()] }), NOW))
    assert.equal(ok.status, 'Başlanmadı')
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

  test('DOM-KYN-024 yönerge ve kaynak gösterimi atama ayrıntısındaki sabitlenen sürümden gelir', () => {
    const attributions = [{ work: 'The Lake', author: 'A. Writer', source: 'Penguin', year: 2001 }]
    const brief = writingBrief(
      detail({
        content: {
          versionId: 'rv-1',
          title: 'Opinion essay',
          body: {
            type: 'homework_template',
            instructions: 'Write 100 words.',
            submissionKinds: [],
          },
          attributions,
          licenseKind: 'licensed_publication',
        },
      }),
    )
    assert.equal(brief.instructions, 'Write 100 words.')
    assert.deepEqual(brief.attributions, attributions)
    assert.equal(brief.notice, null)
    const empty = writingBrief(
      detail({
        content: {
          versionId: 'rv-1',
          title: 'Opinion essay',
          body: { type: 'homework_template', instructions: '  ', submissionKinds: ['text'] },
          attributions: [],
          licenseKind: 'institution_original',
        },
      }),
    )
    assert.equal(empty.instructions, null)
    assert.match(empty.notice ?? '', /yönerge eklenmemiş/)
  })

  test('DOM-KYN-021 lisansı dolmuş ya da kaldırılmış içerikte yönerge yerine neden gösterilir', () => {
    const expired = writingBrief(detail({ content: null, contentUnavailable: 'license_expired' }))
    assert.equal(expired.instructions, null)
    assert.deepEqual(expired.attributions, [])
    assert.match(expired.notice ?? '', /lisans/)
    const gone = writingBrief(detail({ content: null, contentUnavailable: 'unavailable' }))
    assert.match(gone.notice ?? '', /öğretmeninizden/)
  })

  test('IST-051 kursiyer görünümü hem liste satırını hem ayrıntıyı tanır', () => {
    assert.equal(isLearnerAssignment(auto()), true)
    assert.equal(isLearnerAssignment(detail()), true)
    assert.equal(isLearnerAssignment({ view: 'staff' }), false)
  })
})
