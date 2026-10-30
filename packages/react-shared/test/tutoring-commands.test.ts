import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { ApiError } from '@kampus/api-client/errors.ts'
import { createKampusClient } from '@kampus/api-client/client.ts'

import { runRequest } from '../src/api-result.ts'
import { commandFeedback, commandHeaders } from '../src/commands.ts'
import {
  TUTORING_MESSAGES,
  TUTORING_PLAN_STALE_CODE,
  cancelTutorSessionRequest,
  createTutorSessionsRequest,
  recordTutorAttendanceRequest,
} from '../src/use-tutoring-commands.ts'

interface Sent {
  method: string
  path: string
  headers: Headers
  body: unknown
}

/** Gerçek istemci + sahte fetch: giden istek kaydedilir, yanıt sabittir. */
function fakeClient() {
  const sent: Sent[] = []
  const client = createKampusClient({
    baseUrl: 'https://api.kampus.test',
    credentials: 'include',
    requestId: () => undefined,
    fetch: async (input) => {
      const request = input instanceof Request ? input : new Request(input)
      const text = await request.text()
      sent.push({
        method: request.method,
        path: new URL(request.url).pathname,
        headers: request.headers,
        body: text ? JSON.parse(text) : undefined,
      })
      return new Response(
        JSON.stringify({
          data: {
            entity: { collection: 'tutorSessions', id: 'tutor-1' },
            changes: { inserted: 1, updated: 0, archived: 0, restored: 0 },
            records: [],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    },
  })
  return { client, sent }
}

const plan = {
  examId: 'exam-7-1',
  threshold: 70,
  fromDate: '2026-11-02',
  toDate: '2026-11-09',
  duration: 30,
  maxGroupSize: 6,
  branchId: '',
  subjectId: '',
  expectedPlan: '{"sessions":[]}',
} as const

describe('etüt komutları', () => {
  test('plan onayı önizlenen planı gönderir; If-Match gitmez', async () => {
    const { client, sent } = fakeClient()
    await runRequest(() => createTutorSessionsRequest(client, plan, commandHeaders('key-12345', 3)))
    assert.equal(sent[0]?.method, 'POST')
    assert.equal(sent[0]?.path, '/api/v1/tutor-sessions')
    assert.deepEqual(sent[0]?.body, plan)
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
    assert.equal(sent[0]?.headers.get('if-match'), null)
  })

  test('iptal gerekçeyi etüt yoluna gönderir; sürüm If-Match olur', async () => {
    const { client, sent } = fakeClient()
    await runRequest(() =>
      cancelTutorSessionRequest(
        client,
        { sessionId: 'tutor-1', reason: 'Öğretmen izinli', version: 2 },
        commandHeaders('key-12345', 2),
      ),
    )
    assert.equal(sent[0]?.path, '/api/v1/tutor-sessions/tutor-1/cancel')
    assert.deepEqual(sent[0]?.body, { reason: 'Öğretmen izinli' })
    assert.equal(sent[0]?.headers.get('if-match'), '"2"')
  })

  test('yoklama işaretleri etüt yoluna gider', async () => {
    const { client, sent } = fakeClient()
    await runRequest(() =>
      recordTutorAttendanceRequest(
        client,
        { sessionId: 'tutor-1', marks: { s1: 'Geldi', s2: 'İzinli' } },
        commandHeaders('key-12345'),
      ),
    )
    assert.equal(sent[0]?.path, '/api/v1/tutor-sessions/tutor-1/attendance')
    assert.deepEqual(sent[0]?.body, { marks: { s1: 'Geldi', s2: 'İzinli' } })
    assert.equal(sent[0]?.headers.get('if-match'), null)
  })

  test('eskimiş plan Türkçe mesaja eşlenir ve tazelemeyi tetikler', () => {
    const stale = commandFeedback(
      new ApiError({ status: 409, code: TUTORING_PLAN_STALE_CODE, message: 'x' }),
      TUTORING_MESSAGES,
    )
    assert.match(stale.message ?? '', /Etüt planı değişmiş/)
    assert.equal(stale.refresh, true)

    const conflict = commandFeedback(
      new ApiError({ status: 409, code: 'version_conflict', message: 'x' }),
      TUTORING_MESSAGES,
    )
    assert.match(conflict.message ?? '', /Etüt kaydı değişti/)
    assert.equal(conflict.refresh, true)
  })

  test('iş kuralı hatasında sunucunun Türkçe mesajı korunur', () => {
    const feedback = commandFeedback(
      new ApiError({
        status: 422,
        code: 'tutoring_completed',
        message: 'Tamamlanmış etüt iptal edilemez.',
      }),
      TUTORING_MESSAGES,
    )
    assert.equal(feedback.message, 'Tamamlanmış etüt iptal edilemez.')
    assert.equal(feedback.refresh, false)
  })
})
