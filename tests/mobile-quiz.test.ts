import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError } from '../packages/api-client/src/errors.ts'
import type { KampusClient } from '../packages/api-client/src/client.ts'
import { runRequest } from '../packages/react-shared/src/api-result.ts'
import { createCommandSession, runCommand } from '../packages/react-shared/src/commands.ts'
import {
  submitQuizBody,
  submitQuizCommand,
  type QuizAttempt,
  type QuizListItem,
  type QuizQuestion,
} from '../packages/react-shared/src/quizzes.ts'
import {
  applyQuizStart,
  canSolve,
  confirmSubmitText,
  INITIAL_SOLVE,
  isSolveLocked,
  isTimeOver,
  needsLeaveConfirm,
  nextRetryWait,
  QUIZ_CLOSED_BADGE,
  queryErrorView,
  quizAction,
  quizBadgeTone,
  quizEmptyText,
  quizGroup,
  quizGroupCounts,
  questionNavLabel,
  quizRow,
  RESEND_HINT,
  RETRY_NOTICE,
  solveEndText,
  solveEntry,
  solveEntryFromStart,
  solveReducer,
  startDescription,
  submitButtonText,
  visibleQuizRows,
  type SolveAction,
  type SolveState,
} from '../apps/mobile/src/api/student-quiz.ts'

const STUDENT = 'ogr-1'

const attempt = (overrides: Partial<QuizAttempt> = {}): QuizAttempt => ({
  id: 'a1',
  quizId: 'q1',
  studentId: STUDENT,
  status: 'in_progress',
  startedAt: '2026-11-03T09:00:00.000Z',
  expiresAt: '2026-11-03T09:30:00.000Z',
  submittedAt: null,
  result: null,
  ...overrides,
})

const quiz = (overrides: Partial<QuizListItem> = {}): QuizListItem => ({
  id: 'q1',
  version: 1,
  classId: 'sinif-1',
  subjectId: 'ders-1',
  subject: 'Matematik',
  teacherId: 'ogt-1',
  title: 'Üslü sayılar',
  duration: 30,
  dueDate: '2026-11-10T20:59:00.000Z',
  questionIds: ['s1', 's2'],
  questionCount: 2,
  status: 'open',
  createdAt: null,
  updatedAt: '2026-11-01T09:00:00.000Z',
  statistics: null,
  attempts: [],
  ...overrides,
})

const apiError = (status: number, code: string, message = 'Sunucu mesajı') =>
  new ApiError({ status, code, message })
const networkError = () => apiError(0, 'network_error')

const run = (actions: SolveAction[], from: SolveState = INITIAL_SOLVE) =>
  actions.reduce(solveReducer, from)
const pick = (questionId: string, position: number): SolveAction => ({
  type: 'select',
  questionId,
  position,
  optionCount: 4,
})
const answered = run([pick('s1', 1), pick('s2', 3)])

describe('IST-124 mobil quiz listesi (DOM-AKD-077, DOM-AKD-078)', () => {
  test('IST-124 ayrım: açık, tamamlanmış ve süresi geçmiş sunucu durumundan gelir', () => {
    assert.equal(quizGroup(quiz(), undefined), 'open')
    assert.equal(quizGroup(quiz({ status: 'closed' }), undefined), 'expired')
    assert.equal(quizGroup(quiz(), attempt()), 'open')
    // Süren deneme quiz son tarihi geçse de açıktır: süre denemenin kendisindedir.
    assert.equal(quizGroup(quiz({ status: 'closed' }), attempt()), 'open')
    assert.equal(quizGroup(quiz(), attempt({ status: 'completed' })), 'completed')
    assert.equal(quizGroup(quiz(), attempt({ status: 'expired' })), 'expired')
  })

  test('IST-124 satır: rozet, puan sunucu sonucundan, başlatma ve devam kararı', () => {
    const fresh = quizRow(quiz(), STUDENT)
    assert.equal(fresh.badge, 'Henüz çözülmedi')
    assert.equal(fresh.startable, true)
    assert.equal(fresh.resumable, false)
    assert.equal(fresh.score, null)
    assert.equal(fresh.subtitle, 'Matematik · 2 soru · 30 dk')

    const running = quizRow(quiz({ attempts: [attempt()] }), STUDENT)
    assert.equal(running.badge, 'Devam ediyor')
    assert.equal(running.resumable, true)
    assert.equal(running.startable, false)

    const done = quizRow(
      quiz({
        attempts: [
          attempt({
            status: 'completed',
            result: { score: 50, correctCount: 1, total: 2 },
          }),
        ],
      }),
      STUDENT,
    )
    assert.equal(done.badge, 'Çözüldü')
    assert.equal(done.score, '%50')
    assert.equal(done.group, 'completed')

    const expiredAttempt = quizRow(quiz({ attempts: [attempt({ status: 'expired' })] }), STUDENT)
    assert.equal(expiredAttempt.badge, 'Süresi doldu')

    const closed = quizRow(quiz({ status: 'closed' }), STUDENT)
    assert.equal(closed.badge, QUIZ_CLOSED_BADGE)
    assert.equal(closed.startable, false)
    assert.equal(closed.group, 'expired')
  })

  test('IST-124 başka öğrencinin denemesi satırı etkilemez; son tarihsiz quiz süresiz açık', () => {
    const row = quizRow(
      quiz({ dueDate: null, attempts: [attempt({ studentId: 'ogr-2', status: 'completed' })] }),
      STUDENT,
    )
    assert.equal(row.phase, 'none')
    assert.equal(row.due, 'Süresiz açık')
    assert.match(quizRow(quiz(), STUDENT).due, /^Son tarih: /)
  })

  test('IST-124 son tarih Europe/Istanbul saatiyle yazılır', () => {
    // 20:59 UTC, İstanbul'da gece 23:59.
    assert.match(quizRow(quiz({ dueDate: '2026-11-10T20:59:00.000Z' }), STUDENT).due, /23:59/)
  })

  test('IST-124 süzgeç ve arama; bilinmeyen süzgeç tümünü gösterir; sayılar ayrımdan', () => {
    const rows = [
      quizRow(quiz({ id: 'a', title: 'Üslü sayılar' }), STUDENT),
      quizRow(
        quiz({
          id: 'b',
          title: 'Fiil çekimi',
          subject: 'İngilizce',
          attempts: [attempt({ quizId: 'b', status: 'completed' })],
        }),
        STUDENT,
      ),
      quizRow(quiz({ id: 'c', title: 'Eski quiz', status: 'closed' }), STUDENT),
    ]
    assert.deepEqual(
      visibleQuizRows(rows, 'open', '').map((row) => row.id),
      ['a'],
    )
    assert.deepEqual(
      visibleQuizRows(rows, 'completed', '').map((row) => row.id),
      ['b'],
    )
    assert.deepEqual(
      visibleQuizRows(rows, 'expired', '').map((row) => row.id),
      ['c'],
    )
    assert.equal(visibleQuizRows(rows, '', '').length, 3)
    assert.equal(visibleQuizRows(rows, 'bilinmeyen', '').length, 3)
    // Türkçe büyük/küçük harf duyarsız: "İNGİLİZCE" ders adını bulur.
    assert.deepEqual(
      visibleQuizRows(rows, '', 'İNGİLİZCE').map((row) => row.id),
      ['b'],
    )
    assert.deepEqual(quizGroupCounts(rows), { open: 1, completed: 1, expired: 1 })
  })

  test('IST-124 boş liste metni süzgece göre', () => {
    assert.equal(quizEmptyText('').title, 'Henüz quiz yok')
    assert.equal(quizEmptyText('completed').title, 'Tamamlanan quiz yok')
    assert.equal(quizEmptyText('open').title, 'Açık quiz yok')
    assert.equal(quizEmptyText('expired').title, 'Süresi geçen quiz yok')
  })

  test('IST-124 ayrıntı eylemi: başlat, devam et, kapalı, bekleyen', () => {
    assert.equal(quizAction(quiz(), undefined), 'start')
    assert.equal(quizAction(quiz({ status: 'closed' }), undefined), 'closed')
    assert.equal(quizAction(quiz(), attempt()), 'resume')
    assert.equal(quizAction(quiz(), attempt({ status: 'completed' })), 'pending')
    assert.equal(quizAction(quiz(), attempt({ status: 'expired' })), 'pending')
  })

  test('IST-124 çözme yalnız süren denemede ve sorular açıkken açılır', () => {
    const questions = [{ id: 's1' }]
    assert.equal(canSolve(attempt(), questions), true)
    assert.equal(canSolve(attempt(), null), false)
    assert.equal(canSolve(attempt(), []), false)
    assert.equal(canSolve(attempt({ status: 'completed' }), questions), false)
    assert.equal(canSolve(undefined, questions), false)
  })

  test('IST-124 başlatma açıklaması soru sayısını ve süreyi söyler', () => {
    const text = startDescription({ questionCount: 12, duration: 40 })
    assert.match(text, /12 soru, 40 dakika/)
    assert.match(text, /bir kez/)
  })
})

describe('IST-124 mobil quiz çözme durum makinesi (DOM-AKD-077)', () => {
  test('IST-124 seçim yalnız geçerli şıkta ve yalnız cevaplanırken işler', () => {
    assert.deepEqual(answered.answers, { s1: 1, s2: 3 })
    assert.equal(run([pick('s1', 7)]).answers.s1, undefined)
    assert.equal(run([pick('s1', -1)]).answers.s1, undefined)
    assert.equal(run([pick('s1', 1.5)]).answers.s1, undefined)
    // Aynı soruda şık değişir.
    assert.equal(run([pick('s1', 1), pick('s1', 2)]).answers.s1, 2)
    // Onay penceresi açıkken seçim değişmez.
    const confirming = run([pick('s1', 0), { type: 'press', timeOver: false }])
    assert.equal(confirming.phase, 'confirming')
    assert.equal(solveReducer(confirming, pick('s1', 3)).answers.s1, 0)
  })

  test('IST-124 soru gezinmesi sınırlar içinde kalır', () => {
    const at = (index: number) => solveReducer(INITIAL_SOLVE, { type: 'goto', index, total: 3 })
    assert.equal(at(2).index, 2)
    assert.equal(at(9).index, 2)
    assert.equal(at(-4).index, 0)
    assert.equal(at(1.9).index, 1)
    assert.equal(solveReducer(INITIAL_SOLVE, { type: 'goto', index: 0, total: 0 }).index, 0)
    // Gönderim sürerken gezinme değişmez.
    const sending = run([pick('s1', 0), { type: 'press', timeOver: false }, { type: 'confirm' }])
    assert.equal(solveReducer(sending, { type: 'goto', index: 1, total: 3 }).index, 0)
  })

  test('IST-124 gönderim önce onay sorar; vazgeçince cevaplar kalır', () => {
    const confirming = solveReducer(answered, { type: 'press', timeOver: false })
    assert.equal(confirming.phase, 'confirming')
    const back = solveReducer(confirming, { type: 'cancel' })
    assert.equal(back.phase, 'answering')
    assert.deepEqual(back.answers, answered.answers)
    assert.equal(solveReducer(confirming, { type: 'confirm' }).phase, 'sending')
    // Onaysız `confirm` göndermez.
    assert.equal(solveReducer(answered, { type: 'confirm' }).phase, 'answering')
  })

  test('IST-124 çift dokunma ikinci gönderim yaratmaz', () => {
    const sending = run([{ type: 'press', timeOver: false }, { type: 'confirm' }], answered)
    assert.equal(sending.phase, 'sending')
    for (const action of [
      { type: 'press', timeOver: false },
      { type: 'press', timeOver: true },
      { type: 'confirm' },
      { type: 'timeout' },
      { type: 'wake' },
    ] as const)
      assert.equal(solveReducer(sending, action), sending, action.type)
    assert.equal(isSolveLocked(sending), true)
  })

  test('IST-124 başarı: gönderildi; bir daha sonuç işlenmez', () => {
    const sending = run([{ type: 'press', timeOver: false }, { type: 'confirm' }], answered)
    const done = solveReducer(sending, { type: 'sent' })
    assert.equal(done.phase, 'submitted')
    assert.equal(solveEndText('submitted', false), 'Cevapların gönderildi.')
    assert.equal(solveReducer(done, { type: 'sent' }), done)
    assert.equal(solveReducer(done, pick('s1', 0)), done)
    assert.equal(solveReducer(done, { type: 'timeout' }), done)
  })

  test('IST-124 süre dolunca cevaplar kendiliğinden gider ve metin bunu söyler', () => {
    const sending = solveReducer(answered, { type: 'timeout' })
    assert.equal(sending.phase, 'sending')
    assert.equal(sending.auto, true)
    assert.equal(solveEndText('submitted', true), 'Süre doldu; cevapların gönderildi.')
    // Onay ya da çıkış penceresi açıkken de süre dolunca gönderilir.
    const confirming = solveReducer(answered, { type: 'press', timeOver: false })
    assert.equal(solveReducer(confirming, { type: 'timeout' }).phase, 'sending')
    const leaving = solveReducer(answered, { type: 'leave' })
    assert.equal(leaving.phase, 'leaving')
    assert.equal(solveReducer(leaving, { type: 'timeout' }).phase, 'sending')
    // Süre bitmişken düğme onaysız gönderir.
    assert.equal(solveReducer(answered, { type: 'press', timeOver: true }).phase, 'sending')
  })

  test('IST-124 ağ hatası: cevaplar kaybolmaz, yeniden gönderme sunulur', () => {
    const sending = solveReducer(answered, { type: 'timeout' })
    const failed = solveReducer(sending, {
      type: 'failed',
      error: networkError(),
      timeOver: false,
      waitMs: null,
    })
    assert.equal(failed.phase, 'answering')
    assert.deepEqual(failed.answers, answered.answers)
    assert.equal(failed.retryable, true)
    assert.ok(failed.error)
    assert.equal(submitButtonText(failed, false), 'Yeniden gönder')
    // Yeniden gönderim onay sormaz ve aynı cevaplarla gider.
    const again = solveReducer(failed, { type: 'press', timeOver: false })
    assert.equal(again.phase, 'sending')
    assert.deepEqual(again.answers, answered.answers)
  })

  test('IST-124 5xx ve 429 de kesin olmayan hatadır', () => {
    for (const status of [500, 503, 429]) {
      const sending = solveReducer(answered, { type: 'timeout' })
      const failed = solveReducer(sending, {
        type: 'failed',
        error: apiError(status, status === 429 ? 'rate_limited' : 'internal_error'),
        timeOver: false,
        waitMs: null,
      })
      assert.equal(failed.retryable, true, String(status))
      assert.deepEqual(failed.answers, answered.answers)
    }
  })

  test('IST-124 süre bitmişken ağ hatasında ağ payı içinde bekleyip yeniden dener', () => {
    const sending = solveReducer(answered, { type: 'timeout' })
    const waiting = solveReducer(sending, {
      type: 'failed',
      error: networkError(),
      timeOver: true,
      waitMs: 2_000,
    })
    assert.equal(waiting.phase, 'waiting')
    assert.equal(waiting.error, RETRY_NOTICE)
    assert.equal(isSolveLocked(waiting), true)
    assert.equal(solveReducer(waiting, { type: 'press', timeOver: true }), waiting)
    const woke = solveReducer(waiting, { type: 'wake' })
    assert.equal(woke.phase, 'sending')
    assert.equal(woke.auto, true)
    // Pay bitince bekleme yok: cevaplar ekranda, "Yeniden gönder" ipucuyla.
    const spent = solveReducer(solveReducer(answered, { type: 'timeout' }), {
      type: 'failed',
      error: networkError(),
      timeOver: true,
      waitMs: null,
    })
    assert.equal(spent.phase, 'answering')
    assert.ok(spent.error?.endsWith(RESEND_HINT))
    assert.deepEqual(spent.answers, answered.answers)
  })

  test('IST-124 kesin hatalar yeniden denenmez; mesaj Türkçe ve cevaplar kalır', () => {
    const sending = solveReducer(answered, { type: 'timeout' })
    const invalid = solveReducer(sending, {
      type: 'failed',
      error: apiError(422, 'quiz_answer_invalid'),
      timeOver: false,
      waitMs: null,
    })
    assert.equal(invalid.phase, 'answering')
    assert.equal(invalid.retryable, false)
    assert.match(invalid.error ?? '', /Cevaplar bu quizin sorularıyla uyuşmuyor/)
    assert.deepEqual(invalid.answers, answered.answers)
    assert.equal(submitButtonText(invalid, false), 'Cevapları gönder')
    // Bilinmeyen kodda sunucunun mesajı görünür.
    const other = solveReducer(sending, {
      type: 'failed',
      error: apiError(403, 'forbidden', 'Yetkin yok.'),
      timeOver: false,
      waitMs: null,
    })
    assert.equal(other.error, 'Yetkin yok.')
  })

  test('IST-124 süre doldu ve zaten gönderildi bitiş durumlarıdır', () => {
    const sending = solveReducer(answered, { type: 'timeout' })
    const expired = solveReducer(sending, {
      type: 'failed',
      error: apiError(422, 'quiz_time_expired'),
      timeOver: true,
      waitMs: 2_000,
    })
    assert.equal(expired.phase, 'expired')
    assert.match(solveEndText('expired', false) ?? '', /süresi doldu/)
    const already = solveReducer(sending, {
      type: 'failed',
      error: apiError(409, 'quiz_already_submitted'),
      timeOver: false,
      waitMs: null,
    })
    assert.equal(already.phase, 'already')
    assert.match(already.error ?? '', /zaten gönderildi/)
    // Bitiş durumunda cevaplar kilitli; sonuç görünümüne geçilir.
    assert.equal(isSolveLocked(expired), true)
    assert.equal(isSolveLocked(already), true)
  })

  test('IST-124 gönderim dışında gelen sonuç yok sayılır', () => {
    assert.equal(solveReducer(answered, { type: 'sent' }), answered)
    assert.equal(
      solveReducer(answered, {
        type: 'failed',
        error: networkError(),
        timeOver: false,
        waitMs: null,
      }),
      answered,
    )
  })

  test('IST-124 yeni seçim hata ve yeniden gönderme işaretini temizler', () => {
    const sending = solveReducer(answered, { type: 'timeout' })
    const failed = solveReducer(sending, {
      type: 'failed',
      error: networkError(),
      timeOver: false,
      waitMs: null,
    })
    const changed = solveReducer(failed, pick('s1', 0))
    assert.equal(changed.error, null)
    assert.equal(changed.retryable, false)
    assert.equal(changed.answers.s1, 0)
  })

  test('IST-124 çıkış: cevap varken onay sorulur, yokken sorulmaz', () => {
    assert.equal(needsLeaveConfirm(INITIAL_SOLVE), false)
    assert.equal(solveReducer(INITIAL_SOLVE, { type: 'leave' }), INITIAL_SOLVE)
    assert.equal(needsLeaveConfirm(answered), true)
    const leaving = solveReducer(answered, { type: 'leave' })
    assert.equal(leaving.phase, 'leaving')
    assert.equal(solveReducer(leaving, { type: 'cancel' }).phase, 'answering')
    // Gönderilmiş denemeden çıkarken onay gerekmez.
    const done = run(
      [{ type: 'press', timeOver: false }, { type: 'confirm' }, { type: 'sent' }],
      answered,
    )
    assert.equal(needsLeaveConfirm(done), false)
  })
})

describe('IST-124 mobil quiz süre ve metinler', () => {
  const expiresAt = '2026-11-03T09:30:00.000Z'
  const at = (iso: string) => Date.parse(iso)

  test('IST-124 süre sunucu saatiyle işler: cihaz saati ileri olsa da', () => {
    const now = at('2026-11-03T09:29:00.000Z')
    assert.equal(isTimeOver({ expiresAt }, now, 0), false)
    // Cihaz saati 2 dk ileri; sunucu farkı -2 dk ile düzeltir.
    assert.equal(isTimeOver({ expiresAt }, now + 120_000, -120_000), false)
    assert.equal(isTimeOver({ expiresAt }, at('2026-11-03T09:30:00.000Z'), 0), true)
    // Süresiz deneme hiç bitmez.
    assert.equal(isTimeOver({ expiresAt: null }, at('2030-01-01T00:00:00.000Z'), 0), false)
  })

  test('IST-124 yeniden deneme beklemesi ağ payı bitince kalkar', () => {
    const over = at('2026-11-03T09:30:05.000Z')
    assert.equal(nextRetryWait(0, { expiresAt }, over, 0), 2_000)
    assert.equal(nextRetryWait(1, { expiresAt }, over, 0), 5_000)
    // Pay (60 sn) bitmeye 3 sn kala 5 sn beklenmez.
    assert.equal(nextRetryWait(1, { expiresAt }, at('2026-11-03T09:30:57.000Z'), 0), null)
    // Deneme hakkı bitti.
    assert.equal(nextRetryWait(3, { expiresAt }, over, 0), null)
    assert.equal(nextRetryWait(0, { expiresAt: null }, over, 0), 2_000)
  })

  test('IST-124 onay metni boş soruları uyarır; soru gezinme etiketi durumu söyler', () => {
    assert.match(confirmSubmitText(10, 10), /10 sorudan 10 tanesini/)
    assert.doesNotMatch(confirmSubmitText(10, 10), /yanlış sayılır/)
    assert.match(confirmSubmitText(10, 7), /Boş bıraktığın sorular yanlış sayılır/)
    assert.match(confirmSubmitText(10, 7), /değiştirilemez/)
    assert.equal(questionNavLabel(0, true), 'Soru 1, cevaplandı')
    assert.equal(questionNavLabel(4, false), 'Soru 5, boş')
  })

  test('IST-124 düğme yazısı durumdan gelir', () => {
    assert.equal(submitButtonText(INITIAL_SOLVE, false), 'Cevapları gönder')
    assert.equal(submitButtonText(INITIAL_SOLVE, true), 'Yeniden gönder')
    const sending = solveReducer(answered, { type: 'timeout' })
    assert.equal(submitButtonText(sending, false), 'Gönderiliyor…')
  })
})

const QUESTIONS: QuizQuestion[] = [
  { id: 's1', text: 'Soru 1', options: ['a', 'b', 'c', 'd'], topic: 'Üslü' },
  { id: 's2', text: 'Soru 2', options: ['a', 'b', 'c', 'd'], topic: 'Üslü' },
] as unknown as QuizQuestion[]

/** Gönderim ucunu taklit eder: aynı anahtar ilk sonucu tekrarlar; yanıt kaybı sunucuya ulaşır. */
function fakeSubmitServer(script: Array<'ok' | 'lost' | ApiError>) {
  const seen = new Map<string, { score: number }>()
  const keys: string[] = []
  let processed = 0
  const client = {
    POST: async (_path: string, options: { params: { header: { 'idempotency-key': string } } }) => {
      const key = options.params.header['idempotency-key']
      keys.push(key)
      const step = script.shift() ?? 'ok'
      if (step instanceof ApiError) throw step
      let result = seen.get(key)
      if (!result) {
        processed += 1
        result = { score: 50 }
        seen.set(key, result)
      }
      if (step === 'lost') throw networkError()
      return { data: { data: result }, response: new Response(null, { status: 200 }) }
    },
  } as unknown as KampusClient
  return {
    keys,
    processed: () => processed,
    send: (session: ReturnType<typeof createCommandSession>, answers: Record<string, number>) => {
      const variables = { quizId: 'q1', body: submitQuizBody(['s1', 's2'], answers) }
      return runCommand(
        session,
        {
          execute: (input, headers) =>
            runRequest(() => submitQuizCommand.request(client, input, headers)),
          refresh: async () => {},
        },
        variables,
      )
    },
  }
}

describe('IST-124 mobil quiz gönderim komutu (Idempotency-Key)', () => {
  test('IST-124 ağ/5xx hatasından sonra yeniden gönderim aynı anahtarı taşır', async () => {
    const server = fakeSubmitServer([networkError(), apiError(503, 'unavailable'), 'ok'])
    const session = createCommandSession()
    assert.equal((await server.send(session, { s1: 1, s2: 3 })).status, 'failed')
    assert.equal((await server.send(session, { s1: 1, s2: 3 })).status, 'failed')
    assert.equal((await server.send(session, { s1: 1, s2: 3 })).status, 'success')
    assert.equal(new Set(server.keys).size, 1)
  })

  test('IST-124 429 istek işlenmediği için yeni anahtar kullanılır; gövde değişince de', async () => {
    const server = fakeSubmitServer([apiError(429, 'rate_limited'), 'ok', 'ok'])
    const session = createCommandSession()
    await server.send(session, { s1: 1 })
    await server.send(session, { s1: 1 })
    assert.notEqual(server.keys[0], server.keys[1])
    // Başarıdan sonraki yeni eylem de yeni anahtardır.
    await server.send(session, { s1: 1 })
    assert.notEqual(server.keys[1], server.keys[2])
  })

  test('IST-124 ilk istek sunucuya ulaşıp yanıtı kaybolursa yeniden gönderim aynı sonucu alar', async () => {
    const server = fakeSubmitServer(['lost', 'ok'])
    const session = createCommandSession()
    const first = await server.send(session, { s1: 1, s2: 3 })
    assert.equal(first.status, 'failed')
    const second = await server.send(session, { s1: 1, s2: 3 })
    assert.equal(second.status, 'success')
    assert.deepEqual(second.status === 'success' ? second.data : null, { data: { score: 50 } })
    // Sunucu iki kez işlemedi: tek kayıt, tek anahtar.
    assert.equal(server.processed(), 1)
    assert.equal(server.keys[0], server.keys[1])
  })

  test('IST-124 çift dokunma tek istek atar', async () => {
    const server = fakeSubmitServer(['ok'])
    const session = createCommandSession()
    const [a, b] = await Promise.all([
      server.send(session, { s1: 1 }),
      server.send(session, { s1: 1 }),
    ])
    assert.deepEqual([a.status, b.status].sort(), ['busy', 'success'])
    assert.equal(server.keys.length, 1)
  })
})

describe('IST-124 mobil quiz açılış kararı ve önbellek', () => {
  const expiresAt = '2026-11-03T09:30:00.000Z'
  const at = (iso: string) => Date.parse(iso)

  test('IST-124 açılışta süre dolmuşsa çözme açılmaz, kendiliğinden gönderim olmaz', () => {
    const running = attempt({ expiresAt })
    // Ağ payı (60 sn) bitmemiş: sunucu hâlâ kabul edebilir ama ekran açılmaz.
    const over = solveEntry(running, QUESTIONS, at('2026-11-03T09:30:20.000Z'), 0)
    assert.equal(over.kind, 'expired')
    // Süre dolmadan açılırsa çözülür; sayaç sürerken dolarsa durum makinesi gönderir.
    const open = solveEntry(running, QUESTIONS, at('2026-11-03T09:10:00.000Z'), 0)
    assert.equal(open.kind, 'solve')
    // Cihaz saati ileriyse sunucu farkı hesaba katılır.
    assert.equal(
      solveEntry(running, QUESTIONS, at('2026-11-03T09:31:00.000Z'), -120_000).kind,
      'solve',
    )
    assert.equal(solveEntry(attempt({ status: 'completed' }), QUESTIONS, 0, 0).kind, 'unavailable')
    assert.equal(solveEntry(running, null, 0, 0).kind, 'unavailable')
    assert.equal(solveEntry(undefined, QUESTIONS, 0, 0).kind, 'unavailable')
  })

  test('IST-124 başlatma yanıtından çözme girdisi sunucu saatine göre kurulur', () => {
    const start = {
      attempt: attempt({ expiresAt }),
      questions: QUESTIONS,
      serverNow: '2026-11-03T09:00:00.000Z',
    }
    const received = at('2026-11-03T09:40:00.000Z') // cihaz saati sunucudan 40 dk ileri
    const entry = solveEntryFromStart(start, received)
    assert.equal(entry.kind, 'solve')
    if (entry.kind === 'solve') assert.equal(entry.input.clockOffsetMs, -40 * 60_000)
  })

  test('IST-124 çözmeden ayrılınca durum sıfırlanır', () => {
    const typed = run([pick('s1', 1), { type: 'leave' }])
    assert.equal(solveReducer(typed, { type: 'reset' }), INITIAL_SOLVE)
  })

  test('IST-124 başlatma yanıtı önbellekteki ayrıntıya işlenir', () => {
    const cached: {
      data: { id: string; attempts: QuizAttempt[]; questions: null; serverNow: string }
    } = {
      data: { id: 'q1', attempts: [], questions: null, serverNow: 'eski' },
    }
    const start = {
      attempt: attempt(),
      questions: QUESTIONS,
      serverNow: '2026-11-03T09:00:00.000Z',
    }
    const next = applyQuizStart(cached, start)
    assert.equal(next?.data.attempts?.length, 1)
    assert.equal(next?.data.attempts?.[0]?.status, 'in_progress')
    assert.equal(next?.data.questions, QUESTIONS)
    assert.equal(next?.data.serverNow, start.serverNow)
    // Aynı öğrencinin eski denemesi çoğalmaz; önbellek yoksa yazılacak bir şey yok.
    assert.equal(applyQuizStart(next, start)?.data.attempts?.length, 1)
    assert.equal(applyQuizStart(undefined, start), undefined)
    // Başlatılmış quiz yeniden "başlat" olarak görünmez.
    assert.equal(quizAction(quiz(), applyQuizStart(cached, start)?.data.attempts?.[0]), 'resume')
  })
})

describe('IST-124 mobil quiz liste hatası ve rozet', () => {
  test('IST-124 yenileme hatası veri varken satır içi kalır, tam ekran yalnız veri yokken', () => {
    const error = apiError(0, 'network_error')
    assert.equal(queryErrorView(undefined, true), 'none')
    assert.equal(queryErrorView(undefined, false), 'none')
    assert.equal(queryErrorView(error, true), 'inline')
    assert.equal(queryErrorView(error, false), 'full')
  })

  test('IST-124 rozet rengi quizde belirlenir (ortak rozet metin tahminine bırakılmaz)', () => {
    assert.equal(quizBadgeTone('Çözüldü'), 'green')
    assert.equal(quizBadgeTone('Süresi doldu'), 'red')
    assert.equal(quizBadgeTone(QUIZ_CLOSED_BADGE), 'red')
    assert.equal(quizBadgeTone('Henüz çözülmedi'), 'amber')
    assert.equal(quizBadgeTone('Devam ediyor'), 'primary')
  })
})
