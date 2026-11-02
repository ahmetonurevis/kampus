import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'

import { runRequest } from '../src/api-result.ts'
import {
  commandFeedback,
  commandHeaders,
  createCommandSession,
  runCommand,
} from '../src/commands.ts'
import {
  archiveQuizRequest,
  attemptOf,
  createQuizRequest,
  fetchAllQuizzes,
  getQuizRequest,
  isQuizVersionConflict,
  isStaffQuizDetail,
  QUIZ_CHANGED_MESSAGE,
  QUIZ_INVALIDATES,
  QUIZ_MESSAGES,
  QUIZ_TIME_EXPIRED_MESSAGE,
  quizClockLabel,
  quizClockOffset,
  quizErrorField,
  quizErrorMessage,
  quizGraceLeftMs,
  quizListKey,
  quizListParams,
  quizSecondsLeft,
  quizSubmitRetryDelay,
  isQuizSubmitRetryable,
  QUIZ_SUBMIT_RETRY_DELAYS_MS,
  quizStale,
  startQuizRequest,
  submitQuizBody,
  submitQuizCommand,
  submitQuizRequest,
  updateQuizRequest,
  type QuizDetail,
} from '../src/quizzes.ts'

// IST-095 (DOM-AKD-075…079): quiz istekleri, If-Match / Idempotency-Key, süzgeçler, gönderim
// gövdesi (puan yok), süre gösterimi, hata metinleri ve alanları.

interface Sent {
  method: string
  path: string
  search: URLSearchParams
  headers: Headers
  body: unknown
}

function fakeClient(reply: (sent: Sent) => Response) {
  const sent: Sent[] = []
  const client = createKampusClient({
    baseUrl: 'https://api.kampus.test',
    credentials: 'include',
    requestId: () => undefined,
    fetch: async (input) => {
      const request = input instanceof Request ? input : new Request(input)
      const text = await request.text()
      const url = new URL(request.url)
      const item = {
        method: request.method,
        path: url.pathname,
        search: url.searchParams,
        headers: request.headers,
        body: text ? JSON.parse(text) : undefined,
      }
      sent.push(item)
      return reply(item)
    },
  })
  return { client, sent }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const QZ = 'quiz-test-1'
const quiz = (overrides: Record<string, unknown> = {}) => ({
  id: QZ,
  version: 4,
  classId: 'c1',
  subjectId: 'math',
  subject: 'Matematik',
  teacherId: 't1',
  title: 'Kesirler quizi',
  duration: 20,
  dueDate: '2026-12-01T20:59:00.000Z',
  questionIds: ['q1', 'q2', 'q3'],
  questionCount: 3,
  status: 'open',
  createdAt: '2026-11-01T06:00:00.000Z',
  updatedAt: '2026-11-01T06:00:00.000Z',
  ...overrides,
})
const attempt = (overrides: Record<string, unknown> = {}) => ({
  id: 'attempt-test-1',
  quizId: QZ,
  studentId: 's1',
  status: 'completed',
  startedAt: '2026-11-02T06:00:00.000Z',
  expiresAt: '2026-11-02T06:20:00.000Z',
  submittedAt: '2026-11-02T06:10:00.000Z',
  result: { score: 67, correctCount: 2, total: 3 },
  ...overrides,
})
const error = (status: number, code: string, path?: (string | number)[]) =>
  new ApiError({
    status,
    code,
    message: 'Sunucu mesajı.',
    ...(path ? { issues: [{ path: path.map(String), code, message: 'x' }] } : {}),
  })

describe('quiz istekleri (IST-095)', () => {
  test('quiz hazırlama Idempotency-Key taşır, If-Match göndermez (DOM-AKD-075)', async () => {
    const { client, sent } = fakeClient(() => json(201, { data: quiz() }))
    const body = {
      classId: 'c1',
      subjectId: 'math',
      title: 'Kesirler quizi',
      duration: 20,
      dueDate: '2026-12-01T23:59:00+03:00',
      questionIds: ['q1', 'q2'],
    }
    await runRequest(() => createQuizRequest(client, body, commandHeaders('key-12345', 9)))
    assert.equal(sent[0]?.method, 'POST')
    assert.equal(sent[0]?.path, '/api/v1/quizzes')
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
    assert.equal(sent[0]?.headers.get('if-match'), null)
    assert.deepEqual(sent[0]?.body, body)
  })

  test('düzenleme ve arşiv quizin sürümünü If-Match ile gönderir (DOM-AKD-076)', async () => {
    const { client, sent } = fakeClient(() => json(200, { data: quiz() }))
    const headers = commandHeaders('key-12345', 4)
    await runRequest(() =>
      updateQuizRequest(client, { quizId: QZ, version: 4, body: { dueDate: null } }, headers),
    )
    await runRequest(() => archiveQuizRequest(client, { quizId: QZ, version: 4 }, headers))
    assert.deepEqual(
      sent.map((item) => `${item.method} ${item.path}`),
      [`PATCH /api/v1/quizzes/${QZ}`, `DELETE /api/v1/quizzes/${QZ}`],
    )
    assert.ok(sent.every((item) => item.headers.get('if-match') === '"4"'))
    assert.deepEqual(sent[0]?.body, { dueDate: null })
    assert.equal(sent[1]?.body, undefined)
  })

  test('sürümsüz düzenleme ve arşiv istek atmaz', async () => {
    const { client, sent } = fakeClient(() => json(200, { data: quiz() }))
    const missing = (caught: unknown) =>
      caught instanceof ApiError && caught.code === 'if_match_missing'
    await assert.rejects(
      () =>
        runRequest(() =>
          updateQuizRequest(
            client,
            { quizId: QZ, version: 4, body: { title: 'Yeni' } },
            commandHeaders('k'),
          ),
        ),
      missing,
    )
    await assert.rejects(
      () =>
        runRequest(() =>
          archiveQuizRequest(client, { quizId: QZ, version: 4 }, commandHeaders('k')),
        ),
      missing,
    )
    assert.equal(sent.length, 0)
  })

  test('başlatma gövdesizdir, gönderim yalnız cevapları taşır; ikisi If-Match göndermez (DOM-AKD-077)', async () => {
    const { client, sent } = fakeClient((item) =>
      item.path.endsWith('/submit')
        ? json(200, { data: attempt() })
        : json(201, {
            data: { attempt: attempt({ status: 'in_progress', result: null }), questions: [] },
          }),
    )
    await runRequest(() => startQuizRequest(client, { quizId: QZ }, commandHeaders('key-1')))
    await runRequest(() =>
      submitQuizRequest(
        client,
        { quizId: QZ, body: { answers: { q1: 0, q3: 2 } } },
        commandHeaders('key-2'),
      ),
    )
    assert.equal(sent[0]?.path, `/api/v1/quizzes/${QZ}/attempt`)
    assert.equal(sent[0]?.body, undefined)
    assert.equal(sent[1]?.path, `/api/v1/quizzes/${QZ}/attempt/submit`)
    assert.deepEqual(sent[1]?.body, { answers: { q1: 0, q3: 2 } })
    assert.ok(sent.every((item) => item.headers.get('if-match') === null))
    assert.deepEqual(
      sent.map((item) => item.headers.get('idempotency-key')),
      ['key-1', 'key-2'],
    )
  })

  test('ağ hatasından sonra aynı cevaplar aynı anahtarla gider; çift gönderim tek istektir (DOM-AKD-077)', async () => {
    let calls = 0
    const keys: string[] = []
    const session = createCommandSession()
    const steps = {
      execute: async (_variables: unknown, headers: { 'idempotency-key': string }) => {
        calls += 1
        keys.push(headers['idempotency-key'])
        if (calls === 1) throw error(0, 'network_error')
        return attempt()
      },
      refresh: async () => undefined,
      refreshOn: submitQuizCommand.refreshOn,
      messages: submitQuizCommand.messages,
    }
    const variables = { quizId: QZ, body: submitQuizBody(['q1', 'q2'], { q1: 1 }) }
    const first = await runCommand(session, steps, variables)
    assert.equal(first.status, 'failed')
    const [again, twice] = await Promise.all([
      runCommand(session, steps, variables),
      runCommand(session, steps, variables),
    ])
    assert.equal(again.status, 'success')
    assert.equal(twice.status, 'busy')
    assert.equal(calls, 2)
    assert.equal(keys[0], keys[1])
  })

  test('gönderim gövdesinde puan yok; boş ve quizde olmayan soru gönderilmez (DOM-AKD-078)', () => {
    const body = submitQuizBody(['q1', 'q2', 'q3'], { q1: 2, q2: undefined, q9: 1, q3: 0 })
    assert.deepEqual(body, { answers: { q1: 2, q3: 0 } })
    assert.equal('score' in body, false)
    assert.deepEqual(submitQuizBody(['q1'], {}), { answers: {} })
  })

  test('tek quiz okunur; personel ayrıntısı cevap anahtarından tanınır', async () => {
    const { client, sent } = fakeClient(() => json(200, { data: quiz() }))
    await runRequest(() => getQuizRequest(client, QZ))
    assert.equal(sent[0]?.path, `/api/v1/quizzes/${QZ}`)
    const personal = {
      ...quiz(),
      statistics: null,
      questions: null,
      attempts: [],
      serverNow: '2026-11-02T06:00:00.000Z',
    }
    const staff = {
      ...quiz(),
      statistics: { started: 0, scored: 0, inProgress: 0, average: null },
      questions: [],
      answerKey: [],
      attempts: [],
    }
    assert.equal(isStaffQuizDetail(personal as QuizDetail), false)
    assert.equal(isStaffQuizDetail(staff as QuizDetail), true)
  })

  test('boş süzgeç ve `all` durumu gönderilmez; anahtar süzgeç sırasından bağımsızdır', () => {
    assert.deepEqual(quizListParams({ classId: '', subjectId: 'math', status: 'all' }), {
      subjectId: 'math',
    })
    assert.deepEqual(quizListParams({ status: 'closed', page: 2, pageSize: 25 }), {
      status: 'closed',
      page: 2,
      pageSize: 25,
    })
    // Başlık araması kırpılır; boş ya da tek karakter sunucuda 400 olacağı için gönderilmez (IST-095).
    assert.deepEqual(quizListParams({ q: '  Türkçe ' }), { q: 'Türkçe' })
    assert.deepEqual(quizListParams({ q: ' ' }), {})
    assert.deepEqual(quizListParams({ q: 'a' }), {})
    assert.notDeepEqual(quizListKey({ q: 'fen' }), quizListKey({}))
    assert.deepEqual(
      quizListKey({ subjectId: 'math', classId: 'c1' }),
      quizListKey({ classId: 'c1', subjectId: 'math' }),
    )
  })

  test('sınıfın bütün quizleri sayfa sayfa ve süzgeçle okunur', async () => {
    const { client, sent } = fakeClient((item) => {
      const page = Number(item.search.get('page'))
      const row = (id: string) => ({ ...quiz({ id }), statistics: null, attempts: [] })
      const rows = page === 1 ? Array.from({ length: 100 }, (_, i) => row(`qz${i}`)) : [row(QZ)]
      return json(200, { data: rows, meta: { page, pageSize: 100, total: 101 } })
    })
    const rows = await fetchAllQuizzes(client, { classId: 'c1' })
    assert.equal(rows.length, 101)
    assert.equal(sent.length, 2)
    assert.ok(sent.every((item) => item.search.get('classId') === 'c1'))
  })

  test('velinin iki çocuğu aynı sınıftaysa deneme seçili çocuğunkidir (DOM-AKD-079)', () => {
    const item = {
      attempts: [
        attempt(),
        attempt({ id: 'a2', studentId: 's2', result: { score: 100, correctCount: 3, total: 3 } }),
      ],
    } as Parameters<typeof attemptOf>[0]
    assert.equal(attemptOf(item, 's2')?.result?.score, 100)
    assert.equal(attemptOf(item, 's1')?.result?.score, 67)
    assert.equal(attemptOf(item, 's9'), undefined)
  })

  test('quiz yazması genel quiz ve deneme koleksiyonlarını da tazeler', () => {
    assert.deepEqual(
      QUIZ_INVALIDATES.map((key) => [...key]),
      [['quizzes'], ['collections', 'quizzes'], ['collections', 'quizAttempts']],
    )
  })
})

describe('quiz süresi gösterimi (DOM-AKD-077)', () => {
  const end = '2026-11-02T06:20:00.000Z'
  test('kalan süre saniye olarak yukarı yuvarlanır, sıfırın altına inmez', () => {
    assert.equal(quizSecondsLeft(end, Date.parse('2026-11-02T06:19:59.500Z')), 1)
    assert.equal(quizSecondsLeft(end, Date.parse('2026-11-02T06:00:00.000Z')), 1200)
    assert.equal(quizSecondsLeft(end, Date.parse('2026-11-02T06:25:00.000Z')), 0)
    assert.equal(quizSecondsLeft(null, 0), null)
    assert.equal(quizSecondsLeft('geçersiz', 0), null)
  })

  test('DOM-AKD-077: sayaç sunucu saatiyle işler; cihaz saati ileri ya da geri olsa da kalan süre aynı', () => {
    const server = Date.parse('2026-11-02T06:10:00.000Z')
    // Cihaz 5 dk geri: fark +5 dk; cihaz 7 dk ileri: fark -7 dk.
    for (const skew of [-300_000, 0, 420_000]) {
      const device = server + skew
      const offset = quizClockOffset('2026-11-02T06:10:00.000Z', device)
      assert.equal(offset + 0, 0 - skew)
      assert.equal(quizSecondsLeft(end, device, offset), 600)
      assert.equal(quizSecondsLeft(end, device + 600_000, offset), 0)
    }
    assert.equal(quizClockOffset(undefined, 1000), 0)
    assert.equal(quizClockOffset(null, 1000), 0)
    assert.equal(quizClockOffset('geçersiz', 1000), 0)
  })

  test('DOM-AKD-077: ağ payı bitimine kalan süre sunucu saatiyle ve süresizde sonsuz', () => {
    const at = Date.parse(end)
    assert.equal(quizGraceLeftMs(end, at), 60_000)
    assert.equal(quizGraceLeftMs(end, at + 45_000), 15_000)
    assert.equal(quizGraceLeftMs(end, at - 100_000, 100_000), 60_000)
    assert.equal(quizGraceLeftMs(end, at + 90_000), -30_000)
    assert.equal(quizGraceLeftMs(null, 0), Number.POSITIVE_INFINITY)
  })

  test('DOM-AKD-077: kesin olmayan hata (ağ, 5xx, 429) yeniden denenir; kesin hata denenmez', () => {
    const err = (status: number, code: string) => new ApiError({ status, code, message: 'x' })
    assert.equal(isQuizSubmitRetryable(err(0, 'network_error')), true)
    assert.equal(isQuizSubmitRetryable(err(503, 'unavailable')), true)
    assert.equal(isQuizSubmitRetryable(err(500, 'internal_error')), true)
    assert.equal(isQuizSubmitRetryable(err(429, 'rate_limited')), true)
    assert.equal(isQuizSubmitRetryable(err(409, 'idempotency_in_progress')), true)
    assert.equal(isQuizSubmitRetryable(err(422, 'quiz_time_expired')), false)
    assert.equal(isQuizSubmitRetryable(err(409, 'quiz_already_submitted')), false)
    assert.equal(isQuizSubmitRetryable(err(403, 'forbidden')), false)
  })

  test('DOM-AKD-077: yeniden deneme geri çekilmeli, üç hakla ve ağ payı içinde', () => {
    assert.deepEqual([...QUIZ_SUBMIT_RETRY_DELAYS_MS], [2000, 5000, 10000])
    assert.equal(quizSubmitRetryDelay(0, 60_000), 2000)
    assert.equal(quizSubmitRetryDelay(1, 60_000), 5000)
    assert.equal(quizSubmitRetryDelay(2, 60_000), 10_000)
    assert.equal(quizSubmitRetryDelay(3, 60_000), null)
    // Bekleme ağ payını aşacaksa hiç denenmez.
    assert.equal(quizSubmitRetryDelay(2, 10_000), null)
    assert.equal(quizSubmitRetryDelay(0, 1500), null)
    assert.equal(quizSubmitRetryDelay(0, Number.POSITIVE_INFINITY), 2000)
  })

  test('hata metni koda özgü Türkçe mesajdır, yoksa sunucunun mesajı', () => {
    assert.equal(
      quizErrorMessage(new ApiError({ status: 422, code: 'quiz_time_expired', message: 'x' })),
      QUIZ_TIME_EXPIRED_MESSAGE,
    )
    assert.equal(
      quizErrorMessage(
        new ApiError({ status: 503, code: 'unavailable', message: 'Sunucu meşgul.' }),
      ),
      'Sunucu meşgul.',
    )
  })

  test('sayaç dakika:saniye, bir saatten uzunsa saat de gösterir', () => {
    assert.equal(quizClockLabel(1200), '20:00')
    assert.equal(quizClockLabel(65), '01:05')
    assert.equal(quizClockLabel(0), '00:00')
    assert.equal(quizClockLabel(-5), '00:00')
    assert.equal(quizClockLabel(3725), '1:02:05')
  })
})

describe('quiz hata metinleri ve alanları (DOM-AKD-075…078)', () => {
  const cases: [string, number, string][] = [
    ['quiz_due_in_past', 422, 'geçmişte olamaz'],
    ['quiz_has_attempts', 409, 'arşivlenemez'],
    ['quiz_question_mismatch', 422, 'düzeyine uygun'],
    ['quiz_closed', 422, 'son tarihi geçti'],
    ['quiz_already_attempted', 409, 'zaten çözdün'],
    ['quiz_already_submitted', 409, 'zaten gönderildi'],
    ['quiz_time_expired', 422, QUIZ_TIME_EXPIRED_MESSAGE],
    ['quiz_not_owner', 403, 'öğretmeni değilsiniz'],
    ['version_conflict', 409, QUIZ_CHANGED_MESSAGE],
  ]
  for (const [code, status, expected] of cases)
    test(`${code} Türkçe mesaja eşlenir`, () => {
      const feedback = commandFeedback(error(status, code), QUIZ_MESSAGES)
      assert.ok(feedback.message?.includes(expected), feedback.message ?? 'mesaj yok')
    })

  test('kural hataları formdaki alana bağlanır', () => {
    assert.equal(quizErrorField(error(422, 'quiz_due_in_past'), 'quiz'), 'dueDate')
    assert.equal(quizErrorField(error(422, 'quiz_subject_required'), 'quiz'), 'subjectId')
    assert.equal(quizErrorField(error(422, 'quiz_teacher_unavailable'), 'quiz'), 'subjectId')
    assert.equal(quizErrorField(error(422, 'record_inactive'), 'quiz'), 'classId')
    assert.equal(quizErrorField(error(422, 'quiz_question_mismatch'), 'quiz'), 'questionIds')
    assert.equal(quizErrorField(error(422, 'quiz_question_unavailable'), 'quiz'), 'questionIds')
    assert.equal(
      quizErrorField(error(400, 'validation_failed', ['questionIds', 2]), 'quiz'),
      'questionIds',
    )
    assert.equal(quizErrorField(error(400, 'validation_failed', ['duration']), 'quiz'), 'duration')
    // Alan o formda yoksa toast; yetki ve bulunamadı hataları alana bağlanmaz.
    assert.equal(quizErrorField(error(422, 'quiz_due_in_past'), 'solve'), undefined)
    assert.equal(quizErrorField(error(403, 'quiz_not_owner', ['title']), 'quiz'), undefined)
    assert.equal(quizErrorField(error(404, 'not_found'), 'solve'), undefined)
  })

  test('deneme ya da quiz artık işleme kapalıysa hata formun içine yazılır', () => {
    assert.equal(quizErrorField(error(409, 'quiz_has_attempts'), 'quiz'), 'root.server')
    assert.equal(quizErrorField(error(422, 'quiz_time_expired'), 'solve'), 'root.server')
    assert.equal(quizErrorField(error(409, 'quiz_already_submitted'), 'solve'), 'root.server')
    assert.equal(quizErrorField(error(422, 'quiz_answer_invalid'), 'solve'), 'root.server')
  })

  test('404, sürüm çakışması, başlamış deneme ve dolmuş süre ekranı tazeler', () => {
    assert.equal(quizStale(error(404, 'not_found')), true)
    assert.equal(quizStale(error(409, 'version_conflict')), true)
    assert.equal(quizStale(error(409, 'quiz_has_attempts')), true)
    assert.equal(quizStale(error(409, 'quiz_already_submitted')), true)
    assert.equal(quizStale(error(422, 'quiz_time_expired')), true)
    assert.equal(quizStale(error(422, 'quiz_closed')), true)
    assert.equal(quizStale(error(422, 'quiz_due_in_past')), false)
    assert.equal(quizStale(error(422, 'quiz_question_mismatch')), false)
    assert.equal(isQuizVersionConflict(error(409, 'version_conflict')), true)
    assert.equal(isQuizVersionConflict(error(409, 'quiz_has_attempts')), false)
  })
})
