import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError } from '../packages/api-client/src/errors.ts'
import { createCommandSession, runCommand } from '../packages/react-shared/src/commands.ts'
import { TASK_ATTEMPT_MESSAGES } from '../packages/react-shared/src/use-task-attempts.ts'
import type { TaskAssignmentLearner } from '../packages/react-shared/src/use-task-assignments.ts'
import type {
  TaskAttemptAnswers,
  TaskAttemptDetail,
} from '../packages/react-shared/src/use-task-attempts.ts'
import {
  ALREADY_SUBMITTED_TEXT,
  INITIAL_SOLVE,
  LISTENING_ATTEMPT_TEXT,
  NOT_SAVED_TEXT,
  TIME_OVER_ENDED_TEXT,
  WEB_ONLY_LISTENING_TEXT,
  WEB_ONLY_TEXT,
  WEB_ONLY_UNKNOWN_TEXT,
  attemptResultView,
  chooseMatch,
  confirmSubmitText,
  deadlineAt,
  isQuizTask,
  isSolveLocked,
  isTimeOver,
  listeningEvidence,
  moveOrderItem,
  needsLeaveConfirm,
  quizTaskAccess,
  quizTaskState,
  remainingFrom,
  resultAction,
  setGapValue,
  shouldRefreshExpired,
  attemptEnded,
  clockSpokenLabel,
  shownOrder,
  solveGate,
  solveReducer,
  startDescription,
  studentTaskRow,
  submitAttempt,
  submitButtonText,
  withAnswer,
  type SolveAction,
  type SolveState,
} from '../apps/mobile/src/api/student-quiz-task.ts'

// Mobil öğrenci quiz görevi (OG-061; IST-051, IST-124; DOM-BEC-005, 042, 043, 044, 045): açılabilirlik
// (Sabah kararı 92), başlatma onayı, çözme durum makinesi, süre, teslim akışı ve sonuç görünürlüğü.
// Cevaplar yalnız bellekte durur; süre sunucu saatindedir.

const apiError = (status: number, code: string, message = 'Sunucu mesajı') =>
  new ApiError({ status, code, message })
const networkError = () => apiError(0, 'network_error')

type Progress = TaskAssignmentLearner['progress'][number]
const progress = (extra: Partial<Progress> = {}): Progress => ({
  learnerId: 's1',
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
  ...extra,
})

const task = (extra: Partial<TaskAssignmentLearner> = {}): TaskAssignmentLearner => ({
  view: 'learner',
  id: 'a1',
  resourceId: 'r1',
  resourceVersionId: 'rv1',
  title: 'Unit 3 quiz',
  contentType: 'quiz',
  scoringMode: 'auto',
  kind: 'evaluation',
  attempts: { kind: 'evaluation', maxAttempts: 2, countPolicy: 'first' },
  deadline: { dueAt: '2026-11-20T20:59:00.000Z', lateAcceptanceDays: 0 },
  timeLimitMinutes: 20,
  listeningPlays: null,
  hasListening: false,
  showTranscript: false,
  submission: null,
  createdAt: '2026-11-01T09:00:00.000Z',
  learnerIds: ['s1'],
  progress: [progress()],
  ...extra,
})

/** Alanı taşımayan eski yanıt (API `hasListening`'i eklemeden önce). */
const legacy = (extra: Partial<TaskAssignmentLearner> = {}) => {
  const full: Partial<TaskAssignmentLearner> = task(extra)
  delete full.hasListening
  return full as Omit<TaskAssignmentLearner, 'hasListening'>
}

describe('OG-061: quiz görevi açılabilirliği (Sabah kararı 92; DOM-BEC-005)', () => {
  test('yalnız otomatik puanlı soru, quiz ve alıştırma seti deneme görevidir', () => {
    for (const contentType of ['question', 'quiz', 'exercise_set'] as const)
      assert.equal(isQuizTask(task({ contentType })), true, contentType)
    assert.equal(isQuizTask(task({ contentType: 'homework_template' })), false)
    assert.equal(isQuizTask(task({ scoringMode: 'teacher' })), false)
    assert.equal(isQuizTask(task({ contentType: 'audio' })), false)
    const access = quizTaskAccess(task({ scoringMode: 'teacher' }))
    assert.equal(access.open, false)
    assert.equal(access.open === false && access.reason, 'unsupported')
  })

  test('dinleme hakkı sabitlenmiş görev (listeningPlays dolu) açılmaz', () => {
    for (const plays of [1, 2] as const) {
      const access = quizTaskAccess(task({ listeningPlays: plays }))
      assert.deepEqual(access, { open: false, reason: 'listening', text: WEB_ONLY_LISTENING_TEXT })
    }
    // Tek soru da olsa dinleme becerisi görevinde açılmaz.
    assert.equal(quizTaskAccess(task({ contentType: 'question', listeningPlays: 1 })).open, false)
  })

  test('hasListening true (sunucu hesabı): quiz ve alıştırma seti listeningPlays boş olsa da açılmaz', () => {
    for (const contentType of ['quiz', 'exercise_set'] as const) {
      const access = quizTaskAccess(task({ contentType, hasListening: true }))
      assert.deepEqual(access, { open: false, reason: 'listening', text: WEB_ONLY_LISTENING_TEXT })
    }
    const state = quizTaskState(task({ hasListening: true }))
    assert.equal(state.open, null)
    assert.match(state.note ?? '', /web'den çözülür/)
    // Önceki denemeden kanıt ya da süren deneme sunucunun kararını değiştirmez.
    const running = task({ hasListening: true, progress: [progress({ status: 'in_progress' })] })
    assert.equal(quizTaskAccess(running, { noListeningRecording: true }).open, false)
  })

  test('hasListening false (sunucu hesabı): ilk denemesi olmayan quiz ve alıştırma seti açılır', () => {
    for (const contentType of ['quiz', 'exercise_set'] as const) {
      const first = task({ contentType, hasListening: false, progress: [progress({ used: 0 })] })
      assert.deepEqual(quizTaskAccess(first), { open: true, via: 'server' })
    }
    const state = quizTaskState(task({ hasListening: false }))
    assert.equal(state.open, 'quiz')
    assert.equal(state.note, null)
    // Dolu hak ile çelişen alan güvenli tarafta kalır: açılmaz.
    assert.equal(quizTaskAccess(task({ hasListening: false, listeningPlays: 2 })).open, false)
  })

  test('alan yoksa (eski yanıt) listeningPlays boş quiz belirsizdir: sınırsız hakla dinleme kaydı olabilir, açılmaz', () => {
    const access = quizTaskAccess(legacy())
    assert.deepEqual(access, { open: false, reason: 'unknown', text: WEB_ONLY_UNKNOWN_TEXT })
    assert.equal(quizTaskAccess(legacy({ contentType: 'exercise_set' })).open, false)
    const state = quizTaskState(legacy())
    assert.equal(state.open, null)
    assert.match(state.note ?? '', /web'den çözülür/)
  })

  test('tek soru görevinde dinleme kaydı bağlanamaz: açılır', () => {
    assert.deepEqual(quizTaskAccess(task({ contentType: 'question' })), {
      open: true,
      via: 'question',
    })
    const state = quizTaskState(task({ contentType: 'question' }))
    assert.equal(state.open, 'quiz')
    assert.equal(state.note, null)
  })

  test('önceki denemede dinleme kaydı yoksa quiz açılır; içerik kaldırıldıysa ya da kapalıysa kanıt sayılmaz', () => {
    const base = { listeningRecording: null, contentRemoved: false, contentUnavailable: null }
    const evidence = listeningEvidence(base)
    assert.equal(evidence.noListeningRecording, true)
    assert.deepEqual(quizTaskAccess(legacy(), evidence), { open: true, via: 'evidence' })
    assert.equal(listeningEvidence({ ...base, contentRemoved: true }).noListeningRecording, false)
    assert.equal(
      listeningEvidence({ ...base, contentUnavailable: 'unavailable' }).noListeningRecording,
      false,
    )
    assert.equal(
      listeningEvidence({
        ...base,
        listeningRecording: { versionId: 'v' } as never,
      }).noListeningRecording,
      false,
    )
    // Kanıt dinleme hakkı sabitlenmiş görevi açmaz.
    assert.equal(quizTaskAccess(legacy({ listeningPlays: 2 }), evidence).open, false)
  })

  test('süren deneme açılır (hak zaten işlemiş); dinleme kaydı çıkarsa çözme kapısı kapatır', () => {
    const running = legacy({ progress: [progress({ status: 'in_progress', canAct: true })] })
    assert.deepEqual(quizTaskAccess(running), { open: true, via: 'running' })
    // Süren denemede de hak sabitlenmiş dinleme görevi açılmaz.
    assert.equal(quizTaskAccess({ ...running, listeningPlays: 1 }).open, false)
  })
})

describe('OG-061: görev satırı hangi pencereyi açar (IST-124; Sabah kararı 92)', () => {
  const now = new Date('2026-11-05T09:00:00.000Z')
  const teacher = (extra: Partial<TaskAssignmentLearner> = {}) =>
    task({
      scoringMode: 'teacher',
      contentType: 'homework_template',
      submission: {
        submissionKind: 'text',
        minWords: null,
        maxWords: null,
      } as TaskAssignmentLearner['submission'],
      ...extra,
    })

  test('yazma görevi yazma penceresini, dinlemesiz quiz quiz penceresini açar', () => {
    const writing = studentTaskRow(teacher(), now)
    assert.equal(writing.open, 'writing')
    assert.equal(writing.note, null)
    assert.match(writing.label, /Görevi aç$/)
    const quiz = studentTaskRow(task(), now)
    assert.equal(quiz.open, 'quiz')
    assert.equal(quiz.note, null)
    assert.match(quiz.label, /Unit 3 quiz, .*\. Görevi aç$/)
  })

  test('dinlemeli quiz açılmaz; neden satırda ve erişilebilir adda görünür', () => {
    for (const extra of [{ hasListening: true }, { listeningPlays: 2 }] as const) {
      const row = studentTaskRow(task(extra), now)
      assert.equal(row.open, null)
      assert.equal(row.note, WEB_ONLY_LISTENING_TEXT)
      assert.ok(row.label.endsWith(WEB_ONLY_LISTENING_TEXT))
    }
  })

  test('konuşma ve el yazısı görevi web notuyla listelenir, açılmaz', () => {
    const row = studentTaskRow(
      teacher({ submission: { submissionKind: 'audio' } as TaskAssignmentLearner['submission'] }),
      now,
    )
    assert.equal(row.open, null)
    assert.equal(row.note, WEB_ONLY_TEXT)
  })

  test('konuşma görevi kayıt alabilen cihazda konuşma penceresini açar', () => {
    const audio = teacher({
      submission: { submissionKind: 'audio' } as TaskAssignmentLearner['submission'],
    })
    const row = studentTaskRow(audio, now, { canRecord: true })
    assert.equal(row.open, 'speaking')
    assert.equal(row.note, null)
    assert.match(row.label, /Görevi aç$/)
    assert.equal(studentTaskRow(audio, now, { canRecord: false }).open, null)
  })

  test('durum ve puan atama özetinden gelir; satır başına istek yoktur', () => {
    const row = studentTaskRow(
      task({ progress: [progress({ status: 'in_progress', canAct: true })] }),
      now,
    )
    assert.equal(row.status, 'Sürüyor')
  })
})

describe('OG-061: başlatma onayı (DOM-BEC-042, 043)', () => {
  test('değerlendirmede süre ve kalan hak söylenir', () => {
    const text = startDescription(task())
    assert.match(text, /20 dakikan var/)
    assert.match(text, /2 deneme hakkından biri kullanılır/)
    assert.match(text, /puanlanır/)
  })

  test('süresiz alıştırmada süre yok, hak sınırsız; kalan hak bilinmiyorsa genel cümle', () => {
    const practice = startDescription(
      task({ kind: 'practice', attempts: { kind: 'practice' }, timeLimitMinutes: null }),
    )
    assert.doesNotMatch(practice, /dakika/)
    assert.match(practice, /sınırsız/)
    const unknown = startDescription(task({ progress: [progress({ remaining: null })] }))
    assert.match(unknown, /bir deneme hakkın kullanılır/)
  })
})

const attempt = (extra: Partial<TaskAttemptDetail> = {}): TaskAttemptDetail =>
  ({
    id: 'at1',
    assignmentId: 'a1',
    learnerId: 's1',
    learnerName: null,
    attemptNumber: 1,
    status: 'in_progress',
    startedAt: '2026-11-03T09:00:00.000Z',
    endsAt: '2026-11-03T09:20:00.000Z',
    remainingMs: 600_000,
    completedAt: null,
    autoSubmitted: false,
    late: false,
    counted: false,
    answers: {},
    result: null,
    feedback: null,
    contentRemoved: false,
    rowVersion: 3,
    questions: [
      {
        questionVersionId: 'q1',
        points: 1,
        subskill: null,
        question: {
          questionType: 'multiple_choice',
          stem: 'Pick',
          options: [
            { id: 'o1', text: 'one' },
            { id: 'o2', text: 'two' },
          ],
          imageFileId: null,
        },
      },
    ],
    passage: null,
    listeningRecording: null,
    contentUnavailable: null,
    ...extra,
  }) as unknown as TaskAttemptDetail

describe('OG-061: çözme kapısı (DOM-BEC-005, DOM-KYN-025, 051)', () => {
  test('süren, dinleme kaydı olmayan ve sorulu deneme çözülür', () => {
    assert.deepEqual(solveGate(attempt()), { kind: 'solve' })
  })

  test('teslim edilmiş ya da süresi dolmuş deneme sonuç görünümüne gider', () => {
    assert.deepEqual(solveGate(attempt({ status: 'submitted' })), { kind: 'result' })
    assert.deepEqual(solveGate(attempt({ status: 'expired' })), { kind: 'result' })
  })

  test('dinleme kaydı gelen süren deneme telefonda çözülmez', () => {
    const gate = solveGate(attempt({ listeningRecording: { versionId: 'v' } as never }))
    assert.deepEqual(gate, { kind: 'blocked', reason: 'listening', text: LISTENING_ATTEMPT_TEXT })
  })

  test('kaldırılmış ve kapalı içerik ile soru gelmeyen deneme çözülmez', () => {
    const removed = solveGate(attempt({ contentRemoved: true, questions: [] }))
    assert.equal(removed.kind, 'blocked')
    assert.equal(removed.kind === 'blocked' && removed.text, 'Bu içerik kaldırıldı.')
    assert.equal(
      solveGate(attempt({ contentUnavailable: 'unavailable', questions: [] })).kind,
      'blocked',
    )
    assert.equal(solveGate(attempt({ questions: [] })).kind, 'blocked')
  })
})

describe('OG-061: süre sunucu saatindedir (DOM-BEC-043)', () => {
  test('kalan süre okunduğu anki saate eklenir; cihaz saati kayması etkisizdir', () => {
    const fetchedAt = 1_000_000
    const deadline = deadlineAt(fetchedAt, 600_000)
    assert.equal(deadline, 1_600_000)
    assert.equal(remainingFrom(deadline, fetchedAt + 100_000), 500_000)
    assert.equal(isTimeOver(remainingFrom(deadline, 1_599_999)), false)
    assert.equal(isTimeOver(remainingFrom(deadline, 1_600_000)), true)
    assert.equal(isTimeOver(remainingFrom(deadline, 2_000_000)), true)
  })

  test('sayaç etiketi dakikada bir değişir, son dakikada saniye saniye okunur', () => {
    assert.equal(clockSpokenLabel(600_000, 'x'), 'Kalan süre 10 dakika')
    assert.equal(clockSpokenLabel(599_001, 'x'), 'Kalan süre 10 dakika')
    assert.equal(clockSpokenLabel(540_000, 'x'), 'Kalan süre 9 dakika')
    assert.equal(clockSpokenLabel(60_001, 'x'), 'Kalan süre 2 dakika')
    assert.equal(clockSpokenLabel(60_000, 'x'), 'Kalan süre 60 saniye')
    assert.equal(clockSpokenLabel(1_500, 'x'), 'Kalan süre 2 saniye')
    assert.equal(clockSpokenLabel(0, 'Süre doldu'), 'Süre doldu')
    assert.equal(clockSpokenLabel(null, 'Süre doldu'), 'Süre doldu')
  })

  test('süre sınırı ve teslim penceresi yoksa sayaç yoktur, süre dolmaz', () => {
    assert.equal(deadlineAt(1_000_000, null), null)
    assert.equal(remainingFrom(null, 5), null)
    assert.equal(isTimeOver(null), false)
  })

  test('süre dolunca sunucunun teslim ettiği denemeyi görmek için yenilenir; gönderim sürerken değil', () => {
    assert.equal(shouldRefreshExpired(INITIAL_SOLVE, true), true)
    assert.equal(shouldRefreshExpired(INITIAL_SOLVE, false), false)
    assert.equal(shouldRefreshExpired({ ...INITIAL_SOLVE, phase: 'sending' }, true), false)
    assert.equal(shouldRefreshExpired({ ...INITIAL_SOLVE, phase: 'ended' }, true), true)
  })
})

const run = (state: SolveState, ...actions: SolveAction[]) =>
  actions.reduce((current, action) => solveReducer(current, action), state)

describe('OG-061: çözme durum makinesi (DOM-BEC-043)', () => {
  test('gönder onay ister; onayla gönderime geçer; başarıda teslim edildi olur', () => {
    const confirming = run(INITIAL_SOLVE, { type: 'press', timeOver: false })
    assert.equal(confirming.phase, 'confirming')
    const sending = run(confirming, { type: 'confirm' })
    assert.equal(sending.phase, 'sending')
    assert.equal(isSolveLocked(sending), true)
    assert.equal(run(sending, { type: 'sent' }).phase, 'submitted')
  })

  test('onaydan vazgeçilirse cevaplanmaya dönülür ve istek gitmez', () => {
    const state = run(INITIAL_SOLVE, { type: 'press', timeOver: false }, { type: 'cancel' })
    assert.equal(state.phase, 'answering')
    assert.equal(solveReducer(state, { type: 'confirm' }).phase, 'answering')
  })

  test('çift dokunma tek gönderim yaratır: sending iken press, confirm ve timeout değiştirmez', () => {
    const sending = run(INITIAL_SOLVE, { type: 'press', timeOver: false }, { type: 'confirm' })
    for (const action of [
      { type: 'press', timeOver: false },
      { type: 'press', timeOver: true },
      { type: 'confirm' },
      { type: 'timeout' },
      { type: 'leave' },
      { type: 'edit' },
    ] as const)
      assert.equal(solveReducer(sending, action), sending, action.type)
  })

  test('süre dolunca onaysız ve kendiliğinden bir kez gönderilir', () => {
    const auto = run(INITIAL_SOLVE, { type: 'timeout' })
    assert.equal(auto.phase, 'sending')
    assert.equal(auto.autoSent, true)
    // Onay penceresi ya da çıkış onayı açıkken de gider.
    assert.equal(
      run(INITIAL_SOLVE, { type: 'press', timeOver: false }, { type: 'timeout' }).phase,
      'sending',
    )
    assert.equal(run(INITIAL_SOLVE, { type: 'leave' }, { type: 'timeout' }).phase, 'sending')
    // Hata sonrası sayaç her tıkta tetiklese de ikinci otomatik gönderim yok.
    const failed = run(auto, {
      type: 'failed',
      failure: { kind: 'request', error: networkError() },
    })
    assert.equal(failed.phase, 'answering')
    assert.equal(solveReducer(failed, { type: 'timeout' }), failed)
    // Elle "Yeniden gönder" süre dolmuşken onaysız gider.
    assert.equal(solveReducer(failed, { type: 'press', timeOver: true }).phase, 'sending')
  })

  test('ağ hatasında cevaplar kalır, yeniden gönder onaysızdır ve aynı anahtar korunur', () => {
    const failed = run(
      INITIAL_SOLVE,
      { type: 'press', timeOver: false },
      { type: 'confirm' },
      { type: 'failed', failure: { kind: 'request', error: networkError() } },
    )
    assert.equal(failed.phase, 'answering')
    assert.equal(failed.resend, true)
    assert.equal(failed.keepsKey, true)
    assert.match(failed.error ?? '', /Yeniden gönder/)
    assert.equal(solveReducer(failed, { type: 'press', timeOver: false }).phase, 'sending')
    assert.equal(submitButtonText(failed, false), 'Yeniden gönder')
  })

  test('5xx ve idempotency_in_progress aynı anahtarı korur; 429 yeni anahtar kullanır', () => {
    const fail = (error: ApiError) =>
      run(
        INITIAL_SOLVE,
        { type: 'press', timeOver: false },
        { type: 'confirm' },
        { type: 'failed', failure: { kind: 'request', error } },
      )
    assert.equal(fail(apiError(503, 'unavailable')).keepsKey, true)
    assert.equal(fail(apiError(409, 'idempotency_in_progress')).keepsKey, true)
    const limited = fail(apiError(429, 'rate_limited'))
    assert.equal(limited.keepsKey, false)
    assert.equal(limited.resend, true)
    assert.equal(limited.phase, 'answering')
  })

  test('cevap değişince hata eskir ve yeniden gönderim yeniden onay ister', () => {
    const failed = run(
      INITIAL_SOLVE,
      { type: 'press', timeOver: false },
      { type: 'confirm' },
      { type: 'failed', failure: { kind: 'request', error: networkError() } },
    )
    const edited = solveReducer(failed, { type: 'edit' })
    assert.equal(edited.error, null)
    assert.equal(edited.resend, false)
    assert.equal(solveReducer(edited, { type: 'press', timeOver: false }).phase, 'confirming')
    // Hatasız durumda cevap değişimi durumu değiştirmez (gereksiz çizim yok).
    assert.equal(solveReducer(INITIAL_SOLVE, { type: 'edit' }), INITIAL_SOLVE)
  })

  test('cevaplar kaydedilemediyse teslim gitmez; ekran cevaplanmaya döner', () => {
    const state = run(
      INITIAL_SOLVE,
      { type: 'press', timeOver: false },
      { type: 'confirm' },
      { type: 'failed', failure: { kind: 'not-saved', error: null } },
    )
    assert.equal(state.phase, 'answering')
    assert.equal(state.error, NOT_SAVED_TEXT)
    assert.equal(state.resend, true)
    assert.equal(state.keepsKey, false)
  })

  test('422 attempt_time_over ve 409 zaten teslim: deneme bitti sayılır, sonuç yenilenir', () => {
    const sending = run(INITIAL_SOLVE, { type: 'timeout' })
    const over = solveReducer(sending, {
      type: 'failed',
      failure: { kind: 'request', error: apiError(422, 'attempt_time_over') },
    })
    assert.equal(over.phase, 'ended')
    assert.equal(over.error, TIME_OVER_ENDED_TEXT)
    assert.equal(isSolveLocked(over), true)
    const already = solveReducer(sending, {
      type: 'failed',
      failure: { kind: 'request', error: apiError(409, 'attempt_already_submitted') },
    })
    assert.equal(already.phase, 'ended')
    assert.equal(already.error, ALREADY_SUBMITTED_TEXT)
  })

  test('422 content_unavailable denemeyi bitirmez: kendi mesajıyla hata, yenileme döngüsü yok (DOM-KYN-021)', () => {
    const sending = run(INITIAL_SOLVE, { type: 'timeout' })
    for (const code of ['content_unavailable', 'answer_invalid', 'submission_closed']) {
      assert.equal(attemptEnded(apiError(422, code)), false, code)
    }
    const state = solveReducer(sending, {
      type: 'failed',
      failure: { kind: 'request', error: apiError(422, 'content_unavailable') },
    })
    assert.equal(state.phase, 'answering')
    assert.equal(state.error, TASK_ATTEMPT_MESSAGES.content_unavailable)
    assert.equal(state.resend, true)
    assert.equal(state.rejected, true)
    assert.equal(isSolveLocked(state), false)
    // Süre dolmuş olsa da kesin reddedilen gönderimde sonuç yenileme döngüsü başlamaz.
    assert.equal(shouldRefreshExpired(state, true), false)
    // Ağ hatasında ise sunucu kendiliğinden teslim etmiş olabilir: yenilenir.
    const network = solveReducer(sending, {
      type: 'failed',
      failure: { kind: 'request', error: networkError() },
    })
    assert.equal(network.rejected, false)
    assert.equal(shouldRefreshExpired(network, true), true)
    // Cevap değişince kesin red eskir.
    assert.equal(solveReducer(state, { type: 'edit' }).rejected, false)
  })

  test('çıkış: cevaplı denemede onay sorulur, cevapsızda sorulmaz; gönderim sonrası onay yok', () => {
    assert.equal(needsLeaveConfirm(INITIAL_SOLVE, 2), true)
    assert.equal(needsLeaveConfirm(INITIAL_SOLVE, 0), false)
    assert.equal(needsLeaveConfirm({ ...INITIAL_SOLVE, phase: 'submitted' }, 2), false)
    assert.equal(run(INITIAL_SOLVE, { type: 'leave' }).phase, 'leaving')
    assert.equal(run(INITIAL_SOLVE, { type: 'leave' }, { type: 'cancel' }).phase, 'answering')
  })

  test('yanlış fazdaki eylemler yok sayılır', () => {
    const sent = run(INITIAL_SOLVE, { type: 'timeout' }, { type: 'sent' })
    for (const action of [
      { type: 'sent' },
      { type: 'press', timeOver: false },
      { type: 'failed', failure: { kind: 'request', error: networkError() } },
    ] as const)
      assert.equal(solveReducer(sent, action), sent, action.type)
    assert.equal(solveReducer(INITIAL_SOLVE, { type: 'sent' }), INITIAL_SOLVE)
  })

  test('teslim onayı boş bırakılan soruların yanlış sayılacağını söyler', () => {
    assert.match(confirmSubmitText(5, 3), /5 sorudan 3 tanesini/)
    assert.match(confirmSubmitText(5, 3), /yanlış sayılır/)
    assert.doesNotMatch(confirmSubmitText(5, 5), /yanlış sayılır/)
    assert.equal(submitButtonText(INITIAL_SOLVE, true), 'Yeniden gönder')
    assert.equal(submitButtonText(INITIAL_SOLVE, false), 'Teslim et')
    assert.equal(submitButtonText({ ...INITIAL_SOLVE, phase: 'sending' }, false), 'Gönderiliyor…')
  })
})

describe('OG-061: teslim akışı ve komut kilidi (DOM-BEC-043)', () => {
  type Vars = { attemptId: string; version: number; answers: TaskAttemptAnswers }
  const vars: Vars = {
    attemptId: 'at1',
    version: 3,
    answers: { q1: { questionType: 'multiple_choice', optionId: 'o1' } },
  }

  /** Komut oturumu üzerinden sahte teslim: anahtarlar ve istek sayısı kaydedilir. */
  function fakeSubmit(outcomes: (ApiError | 'ok')[]) {
    const session = createCommandSession()
    const keys: string[] = []
    const send = () =>
      runCommand(
        session,
        {
          execute: async (_input: Vars, headers) => {
            keys.push(headers['idempotency-key'])
            const next = outcomes.shift()
            // Yanıt bir sonraki mikro görevde döner: eşzamanlı ikinci çağrı kilidi görür.
            await Promise.resolve()
            if (next instanceof ApiError) throw next
            return {}
          },
          version: (input) => input.version,
          refresh: async () => {},
        },
        vars,
      )
    return { send, keys }
  }

  test('cevaplar kaydedilir, sonra teslim gider; başarıda done', async () => {
    const calls: string[] = []
    const { send } = fakeSubmit(['ok'])
    const result = await submitAttempt({
      timeOver: false,
      flush: async () => (calls.push('flush'), true),
      send: async () => (calls.push('send'), send()),
    })
    assert.deepEqual(calls, ['flush', 'send'])
    assert.deepEqual(result, { kind: 'done' })
    assert.deepEqual(resultAction(result), { type: 'sent' })
  })

  test('cevaplar kaydedilemediyse teslim isteği atılmaz', async () => {
    let sent = 0
    const result = await submitAttempt({
      timeOver: false,
      flush: async () => false,
      send: async () => {
        sent += 1
        return { status: 'busy' }
      },
    })
    assert.deepEqual(result, { kind: 'not-saved' })
    assert.equal(sent, 0)
    assert.deepEqual(resultAction(result), {
      type: 'failed',
      failure: { kind: 'not-saved', error: null },
    })
  })

  test('süre dolmuşken kayıt başarısız olsa da teslim denenir (sunucu kayıtlı cevaplarla teslim eder)', async () => {
    let sent = 0
    const result = await submitAttempt({
      timeOver: true,
      flush: async () => false,
      send: async () => {
        sent += 1
        return { status: 'failed', error: apiError(422, 'attempt_time_over') }
      },
    })
    assert.equal(sent, 1)
    assert.equal(result.kind, 'failed')
    const action = resultAction(result)
    assert.equal(
      solveReducer(run(INITIAL_SOLVE, { type: 'timeout' }), action as SolveAction).phase,
      'ended',
    )
  })

  test('çift dokunma tek istek atar: ikinci gönderim busy döner ve eylem üretmez', async () => {
    const { send, keys } = fakeSubmit(['ok'])
    const flush = async () => true
    const [first, second] = await Promise.all([
      submitAttempt({ timeOver: false, flush, send }),
      submitAttempt({ timeOver: false, flush, send }),
    ])
    assert.equal(keys.length, 1)
    assert.deepEqual(first, { kind: 'done' })
    assert.deepEqual(second, { kind: 'busy' })
    assert.equal(resultAction(second), null)
  })

  test('ağ hatasından sonra aynı gövde aynı Idempotency-Key ile gider; başarıdan sonra yeni eylem yeni anahtar alır', async () => {
    const { send, keys } = fakeSubmit([networkError(), 'ok', 'ok'])
    const flush = async () => true
    const failed = await submitAttempt({ timeOver: false, flush, send })
    assert.equal(failed.kind, 'failed')
    const retry = await submitAttempt({ timeOver: false, flush, send })
    assert.deepEqual(retry, { kind: 'done' })
    assert.equal(keys[0], keys[1], 'belirsiz hatada aynı anahtar')
    await submitAttempt({ timeOver: false, flush, send })
    assert.notEqual(keys[2], keys[1], 'başarıdan sonra yeni anahtar')
  })

  test('429 işlenmediği için yeniden gönderim yeni anahtar kullanır', async () => {
    const { send, keys } = fakeSubmit([apiError(429, 'rate_limited'), 'ok'])
    const flush = async () => true
    await submitAttempt({ timeOver: false, flush, send })
    await submitAttempt({ timeOver: false, flush, send })
    assert.equal(keys.length, 2)
    assert.notEqual(keys[0], keys[1])
  })

  test('ağ hatası cevapları silmez: cevap haritası aynı kalır ve yeniden gönderim aynı gövdedir', async () => {
    const answers = withAnswer({}, 'q1', { questionType: 'multiple_choice', optionId: 'o1' })
    const before = structuredClone(answers)
    const result = await submitAttempt({
      timeOver: false,
      flush: async () => true,
      send: async () => ({ status: 'failed', error: networkError() }),
    })
    const state = solveReducer(
      run(INITIAL_SOLVE, { type: 'press', timeOver: false }, { type: 'confirm' }),
      resultAction(result) as SolveAction,
    )
    assert.equal(state.phase, 'answering')
    assert.equal(state.resend, true)
    assert.deepEqual(answers, before)
  })
})

describe('OG-061: cevap girdisi (6 soru türü; DOM-BEC-042)', () => {
  test('eşleştirme: soru başına tek seçim, değişince eskisi yerine geçer, boş seçim kaldırır', () => {
    const one = chooseMatch(undefined, 'p1', 'c1')
    assert.deepEqual(one, { questionType: 'matching', pairs: [{ promptId: 'p1', choiceId: 'c1' }] })
    const two = chooseMatch(one, 'p2', 'c2')
    const changed = chooseMatch(two, 'p1', 'c3')
    assert.equal(changed.questionType === 'matching' && changed.pairs.length, 2)
    assert.deepEqual(
      changed.questionType === 'matching' && changed.pairs.find((pair) => pair.promptId === 'p1'),
      { promptId: 'p1', choiceId: 'c3' },
    )
    const removed = chooseMatch(changed, 'p1', '')
    assert.deepEqual(removed, {
      questionType: 'matching',
      pairs: [{ promptId: 'p2', choiceId: 'c2' }],
    })
  })

  test('boşluk doldurma: yalnız o boşluk değişir, diğerleri kalır', () => {
    const one = setGapValue(undefined, 'g1', 'went')
    const both = setGapValue(one, 'g2', 'to')
    const changed = setGapValue(both, 'g1', 'goes')
    assert.deepEqual(changed, {
      questionType: 'gap_fill',
      gaps: [
        { gapId: 'g2', value: 'to' },
        { gapId: 'g1', value: 'goes' },
      ],
    })
  })

  test('sıralama: cevap yokken öğelerin kendi sırası, taşıma bir adım, sınır dışı taşıma yok', () => {
    const items = [{ id: 'i1' }, { id: 'i2' }, { id: 'i3' }]
    const shown = shownOrder(items, undefined)
    assert.deepEqual(shown, ['i1', 'i2', 'i3'])
    assert.deepEqual(moveOrderItem(shown, 0, 1), {
      questionType: 'ordering',
      order: ['i2', 'i1', 'i3'],
    })
    assert.deepEqual(moveOrderItem(shown, 2, -1), {
      questionType: 'ordering',
      order: ['i1', 'i3', 'i2'],
    })
    assert.equal(moveOrderItem(shown, 0, -1), null)
    assert.equal(moveOrderItem(shown, 2, 1), null)
    assert.equal(moveOrderItem(shown, 5, 1), null)
    // Eksik cevap tam sayılmaz; kayıtlı tam sıra gösterilir.
    assert.deepEqual(shownOrder(items, { questionType: 'ordering', order: ['i1'] }), shown)
    assert.deepEqual(shownOrder(items, { questionType: 'ordering', order: ['i3', 'i1', 'i2'] }), [
      'i3',
      'i1',
      'i2',
    ])
  })

  test('withAnswer yalnız o sorunun cevabını değiştirir, girdiyi değiştirmez', () => {
    const answers: TaskAttemptAnswers = { q1: { questionType: 'short_answer', value: 'a' } }
    const next = withAnswer(answers, 'q2', { questionType: 'true_false', answer: 'true' })
    assert.deepEqual(Object.keys(next), ['q1', 'q2'])
    assert.deepEqual(Object.keys(answers), ['q1'])
  })
})

describe('OG-061: sonuç görünürlüğü yalnız sunucu açınca (DOM-BEC-045)', () => {
  const submitted = (result: TaskAttemptDetail['result']) =>
    attempt({
      status: 'submitted',
      answers: { q1: { questionType: 'multiple_choice', optionId: 'o1' } },
      result,
    })

  test('sonuç yoksa puana dair hiçbir şey üretilmez', () => {
    const view = attemptResultView(submitted(null))
    assert.equal(view.score, null)
    assert.equal(view.items, null)
    assert.equal(view.heading, '1. deneme sonucu')
  })

  test('süren denemede sunucu sonuç göndermiş olsa bile sonuç çizilmez; başlık "sürüyor" der', () => {
    const view = attemptResultView(
      attempt({
        result: {
          earned: 1,
          possible: 1,
          percent: 100,
          items: null,
          subskills: null,
          answerKey: null,
        },
      }),
    )
    assert.equal(view.score, null)
    assert.equal(view.heading, '1. deneme (sürüyor)')
  })

  test('yalnız toplam puan açıldıysa madde sonucu ve anahtar hiç çizilmez', () => {
    const view = attemptResultView(
      submitted({
        earned: 0.5,
        possible: 1,
        percent: 50,
        items: null,
        subskills: null,
        answerKey: null,
      }),
    )
    assert.deepEqual(view.score, { percent: '50 / 100', points: '0,5 / 1 puan' })
    assert.equal(view.items, null)
  })

  test('madde sonucu açıldı ama anahtar açılmadı: doğru cevap ve açıklama yok', () => {
    const view = attemptResultView(
      submitted({
        earned: 0,
        possible: 1,
        percent: 0,
        items: [
          {
            questionVersionId: 'q1',
            parts: 1,
            correctParts: 0,
            answered: true,
            points: 1,
            earned: 0,
          },
        ],
        subskills: null,
        answerKey: null,
      } as never),
    )
    assert.equal(view.items?.length, 1)
    assert.equal(view.items?.[0]?.outcome, 'Yanlış')
    assert.equal(view.items?.[0]?.answer, 'one')
    assert.equal(view.items?.[0]?.key, null)
    assert.equal(view.items?.[0]?.explanation, null)
  })

  test('anahtar açıldıysa doğru cevap ve açıklama gelir', () => {
    const view = attemptResultView(
      submitted({
        earned: 0,
        possible: 1,
        percent: 0,
        items: [
          {
            questionVersionId: 'q1',
            parts: 1,
            correctParts: 0,
            answered: true,
            points: 1,
            earned: 0,
          },
        ],
        subskills: null,
        answerKey: [
          {
            questionVersionId: 'q1',
            answerKey: {
              questionType: 'multiple_choice',
              correctOptionId: 'o2',
              explanation: 'Because.',
            },
          },
        ],
      } as never),
    )
    assert.equal(view.items?.[0]?.key, 'two')
    assert.equal(view.items?.[0]?.explanation, 'Because.')
  })

  test('cevapsız soru "Cevapsız" görünür; kaldırılmış içerikte not çizilir ve puan hesaplanmaz', () => {
    const view = attemptResultView(
      attempt({ status: 'submitted', contentRemoved: true, questions: [], result: null }),
    )
    assert.equal(view.note, 'Bu içerik kaldırıldı.')
    assert.equal(view.score, null)
    assert.equal(view.items, null)
    const unanswered = attemptResultView(
      submitted({
        earned: 0,
        possible: 1,
        percent: 0,
        items: [
          {
            questionVersionId: 'q1',
            parts: 1,
            correctParts: 0,
            answered: false,
            points: 1,
            earned: 0,
          },
        ],
        subskills: null,
        answerKey: null,
      } as never),
    )
    assert.equal(unanswered.items?.[0]?.outcome, 'Cevapsız')
  })
})
