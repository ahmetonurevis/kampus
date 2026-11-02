import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'

import { runRequest } from '../src/api-result.ts'
import {
  commandFeedback,
  commandHeaders,
  createCommandSession,
  IF_MATCH_MISSING_CODE,
  runCommand,
} from '../src/commands.ts'
import { ApiError } from '@kampus/api-client/errors.ts'
import {
  ATTENDANCE_CHANGED_MESSAGE,
  ATTENDANCE_CORRECTION_CHANGED_MESSAGE,
  ATTENDANCE_CORRECTION_MESSAGES,
  correctAttendanceRequest,
  ATTENDANCE_MESSAGES,
  GRADE_CHANGED_MESSAGE,
  GRADE_MESSAGES,
  GRADE_NOT_FOUND_MESSAGE,
  recordAttendanceRequest,
  recordGradeRequest,
  updateGradeRequest,
} from '../src/use-academic-commands.ts'

interface Sent {
  method: string
  path: string
  headers: Headers
  body: unknown
}

/** Gerçek istemci + sahte fetch: giden istek kaydedilir, yanıt sabittir. */
function fakeClient(reply: () => Response) {
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
      return reply()
    },
  })
  return { client, sent }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
const result = (collection: string, id: string) => ({
  data: {
    entity: { collection, id },
    changes: { inserted: 0, updated: 1, archived: 0, restored: 0 },
    records: [{ collection, id, version: 5, change: 'update' }],
  },
})
const failure = (status: number, code: string, message = 'Sunucu mesajı.') =>
  json(status, { code, message, requestId: 'r1' })

describe('yoklama komutu', () => {
  const input = {
    classId: 'c-1',
    date: '2026-10-30',
    marks: { s1: 'present', s2: 'late' },
  } as const

  test('sınıf yoluna tarih ve işaretleri gönderir; If-Match sınıf sürümüdür', async () => {
    const { client, sent } = fakeClient(() => json(200, result('classes', 'c-1')))
    await runRequest(() =>
      recordAttendanceRequest(
        client,
        { ...input, classVersion: 4 },
        commandHeaders('key-12345', 4),
      ),
    )
    assert.equal(sent[0]?.method, 'POST')
    assert.equal(sent[0]?.path, '/api/v1/classes/c-1/attendance')
    assert.deepEqual(sent[0]?.body, { date: '2026-10-30', marks: { s1: 'present', s2: 'late' } })
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
    assert.equal(sent[0]?.headers.get('if-match'), '"4"')
  })

  test('gerekçe yalnız doluysa gövdeye girer (yönetici düzeltmesi)', async () => {
    const { client, sent } = fakeClient(() => json(200, result('classes', 'c-1')))
    const headers = commandHeaders('key-12345')
    await runRequest(() => recordAttendanceRequest(client, { ...input, reason: '' }, headers))
    await runRequest(() =>
      recordAttendanceRequest(client, { ...input, reason: 'Yanlış işaret' }, headers),
    )
    assert.equal('reason' in (sent[0]?.body as object), false)
    assert.equal((sent[1]?.body as { reason: string }).reason, 'Yanlış işaret')
  })

  test('çift gönderim tek istek atar (kilit)', async () => {
    const { client, sent } = fakeClient(() => json(200, result('classes', 'c-1')))
    const session = createCommandSession()
    const steps = {
      execute: (variables: typeof input, headers: ReturnType<typeof commandHeaders>) =>
        runRequest(() => recordAttendanceRequest(client, variables, headers)),
      refresh: async () => {},
      messages: ATTENDANCE_MESSAGES,
    }
    const [first, second] = await Promise.all([
      runCommand(session, steps, input),
      runCommand(session, steps, input),
    ])
    assert.equal(first.status, 'success')
    assert.equal(second.status, 'busy')
    assert.equal(sent.length, 1)
  })

  test('hata kodları Türkçe mesaja eşlenir; sürüm çakışması tazelemeyi tetikler', () => {
    const conflict = commandFeedback(
      new ApiError({ status: 409, code: 'version_conflict', message: 'x' }),
      ATTENDANCE_MESSAGES,
    )
    assert.equal(conflict.message, ATTENDANCE_CHANGED_MESSAGE)
    assert.equal(conflict.refresh, true)

    const reason = commandFeedback(
      new ApiError({ status: 422, code: 'correction_reason_required', message: 'x' }),
      ATTENDANCE_MESSAGES,
    )
    assert.match(reason.message ?? '', /gerekçe/)
    assert.equal(reason.refresh, false)

    for (const code of Object.keys(ATTENDANCE_MESSAGES))
      assert.ok(ATTENDANCE_MESSAGES[code as keyof typeof ATTENDANCE_MESSAGES].length > 10, code)
  })

  test('422 iş kuralı mesajı bildirim yokken root.server alanına yazılır', async () => {
    const { client } = fakeClient(() =>
      json(422, {
        code: 'correction_reason_required',
        message: 'Gerekçe yazın.',
        issues: [{ path: ['reason'], code: 'custom', message: 'Gerekçe yazın.' }],
        requestId: 'r1',
      }),
    )
    const fields: Record<string, string> = {}
    const outcome = await runCommand(
      createCommandSession(),
      {
        execute: (variables: typeof input, headers) =>
          runRequest(() => recordAttendanceRequest(client, variables, headers)),
        refresh: async () => {},
        messages: ATTENDANCE_MESSAGES,
      },
      input,
      { setError: (name, error) => (fields[name] = error.message) },
    )
    assert.equal(outcome.status, 'failed')
    assert.deepEqual(fields, { 'root.server': ATTENDANCE_MESSAGES.correction_reason_required })
  })
})

describe('yoklama düzeltmesi (yönetici, DOM-AKD-035)', () => {
  const input = {
    classId: 'c-1',
    date: '2026-10-20',
    marks: { s1: 'absent', s2: 'present' },
    reason: 'Veli rapor getirdi',
    classVersion: 7,
  } as const

  test('DOM-AKD-035 gerekçe gövdede, If-Match sınıfın okunan sürümüyle gider', async () => {
    const { client, sent } = fakeClient(() => json(200, result('classes', 'c-1')))
    await runRequest(() => correctAttendanceRequest(client, input, commandHeaders('key-12345', 7)))
    assert.equal(sent[0]?.method, 'POST')
    assert.equal(sent[0]?.path, '/api/v1/classes/c-1/attendance')
    assert.deepEqual(sent[0]?.body, {
      date: '2026-10-20',
      marks: { s1: 'absent', s2: 'present' },
      reason: 'Veli rapor getirdi',
    })
    assert.equal(sent[0]?.headers.get('if-match'), '"7"')
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
  })

  test('okunan sürüm yoksa istek atılmaz', async () => {
    const { client, sent } = fakeClient(() => json(200, result('classes', 'c-1')))
    await assert.rejects(
      runRequest(() => correctAttendanceRequest(client, input, commandHeaders('key-12345'))),
      (error: unknown) => error instanceof ApiError && error.code === IF_MATCH_MISSING_CODE,
    )
    assert.equal(sent.length, 0)
  })

  test('409 sürüm çakışması düzeltme mesajını gösterir ve sorguları tazeler', async () => {
    const { client } = fakeClient(() => failure(409, 'version_conflict'))
    const toasts: string[] = []
    let refreshed = 0
    const outcome = await runCommand(
      createCommandSession(),
      {
        execute: (variables: typeof input, headers) =>
          runRequest(() => correctAttendanceRequest(client, variables, headers)),
        version: (variables) => variables.classVersion,
        refresh: async () => {
          refreshed += 1
        },
        messages: ATTENDANCE_CORRECTION_MESSAGES,
      },
      input,
      { notifyError: (message) => toasts.push(message) },
    )
    assert.equal(outcome.status, 'failed')
    assert.deepEqual(toasts, [ATTENDANCE_CORRECTION_CHANGED_MESSAGE])
    assert.equal(refreshed, 1)
    assert.match(ATTENDANCE_CORRECTION_CHANGED_MESSAGE, /başkası tarafından değişti/)
  })

  test('düzeltme mesajları yoklama mesajlarını korur; yalnız çakışma metni farklıdır', () => {
    assert.equal(
      ATTENDANCE_CORRECTION_MESSAGES.correction_reason_required,
      ATTENDANCE_MESSAGES.correction_reason_required,
    )
    assert.equal(
      ATTENDANCE_CORRECTION_MESSAGES.attendance_future_date,
      ATTENDANCE_MESSAGES.attendance_future_date,
    )
    assert.notEqual(ATTENDANCE_CORRECTION_MESSAGES.version_conflict, ATTENDANCE_CHANGED_MESSAGE)
  })
})

describe('not komutları', () => {
  const grade = {
    studentId: 's1',
    subjectId: 'math',
    term: 1,
    assessmentType: 'sinav',
    date: '2026-10-30',
    score: 80,
    topic: '',
  } as const

  test('not girişi Idempotency-Key ile gider, If-Match göndermez', async () => {
    const { client, sent } = fakeClient(() => json(201, result('grades', 'g1')))
    await runRequest(() => recordGradeRequest(client, grade, commandHeaders('key-12345', 9)))
    assert.equal(sent[0]?.method, 'POST')
    assert.equal(sent[0]?.path, '/api/v1/grades')
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
    assert.equal(sent[0]?.headers.get('if-match'), null)
    assert.deepEqual(sent[0]?.body, grade)
  })

  test('düzeltme PATCH ile puan ve gerekçeyi, If-Match ile okunan sürümü gönderir', async () => {
    const { client, sent } = fakeClient(() => json(200, result('grades', 'g1')))
    await runRequest(() =>
      updateGradeRequest(
        client,
        { gradeId: 'g1', score: 90, reason: 'Yanlış girildi', gradeVersion: 3 },
        commandHeaders('key-12345', 3),
      ),
    )
    assert.equal(sent[0]?.method, 'PATCH')
    assert.equal(sent[0]?.path, '/api/v1/grades/g1')
    assert.deepEqual(sent[0]?.body, { score: 90, reason: 'Yanlış girildi' })
    assert.equal(sent[0]?.headers.get('if-match'), '"3"')
  })

  test('409 sürüm çakışması "kayıt değişti" der ve tazeler; 404 "bulunamadı" der', async () => {
    const conflict = fakeClient(() => failure(409, 'version_conflict'))
    let refreshed = 0
    const outcome = await runCommand(
      createCommandSession(),
      {
        execute: (
          variables: { gradeId: string; score: number; reason: string; gradeVersion: number },
          headers,
        ) => runRequest(() => updateGradeRequest(conflict.client, variables, headers)),
        version: (variables) => variables.gradeVersion,
        refresh: async () => {
          refreshed += 1
        },
        messages: GRADE_MESSAGES,
      },
      { gradeId: 'g1', score: 90, reason: 'Düzeltme', gradeVersion: 1 },
      { notifyError: () => {} },
    )
    assert.equal(outcome.status, 'failed')
    assert.equal(refreshed, 1)
    assert.match(GRADE_CHANGED_MESSAGE, /Kayıt değişti/)
    const messages: string[] = []
    const missing = fakeClient(() => failure(404, 'not_found', 'Kayıt bulunamadı.'))
    await runCommand(
      createCommandSession(),
      {
        execute: (
          variables: { gradeId: string; score: number; reason: string; gradeVersion: number },
          headers,
        ) => runRequest(() => updateGradeRequest(missing.client, variables, headers)),
        refresh: async () => {},
        messages: GRADE_MESSAGES,
      },
      { gradeId: 'g2', score: 90, reason: 'Düzeltme', gradeVersion: 1 },
      { notifyError: (message) => messages.push(message) },
    )
    assert.deepEqual(messages, [GRADE_NOT_FOUND_MESSAGE])
  })

  test('her not hata kodunun Türkçe metni vardır', () => {
    for (const [code, message] of Object.entries(GRADE_MESSAGES))
      assert.ok(message.length > 10, code)
  })
})
