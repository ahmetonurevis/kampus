import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'

import { runRequest } from '../src/api-result.ts'
import {
  commandFeedback,
  commandHeaders,
  createCommandSession,
  routeCommandErrors,
  runCommand,
} from '../src/commands.ts'
import {
  cancelLessonRequest,
  createLessonCommand,
  createLessonRequest,
  fetchAllLessons,
  isLessonConflict,
  LESSON_CHANGED_MESSAGE,
  LESSON_INVALIDATES,
  LESSON_MESSAGES,
  lessonErrorField,
  lessonListKey,
  lessonListParams,
  lessonStale,
  substituteLessonRequest,
  updateLessonCommand,
  updateLessonRequest,
} from '../src/lessons.ts'

// IST-094 (DOM-YTK-068, DOM-YTK-069): ders istekleri, If-Match / Idempotency-Key, süzgeçler,
// hata metinleri ve alanları.

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
const failure = (status: number, code: string, message = 'Sunucu mesajı.') =>
  json(status, { code, message, requestId: 'r1' })

const LESSON_ID = 'lesson-test-1'
const lesson = (overrides: Record<string, unknown> = {}) => ({
  id: LESSON_ID,
  version: 4,
  classId: 'c1',
  subjectId: 'math',
  title: 'Matematik',
  teacherId: 't1',
  originalTeacherId: null,
  date: '2026-12-01T06:00:00.000Z',
  duration: 40,
  room: '101',
  status: 'planned',
  cancelledAt: null,
  updatedAt: '2026-11-01T06:00:00.000Z',
  ...overrides,
})
const body = {
  classId: 'c1',
  teacherId: 't1',
  subjectId: 'math',
  date: '2026-12-01T06:00:00.000Z',
  duration: 40,
  room: '101',
}
const error = (status: number, code: string, path?: string[]) =>
  new ApiError({
    status,
    code,
    message: 'Sunucu mesajı.',
    ...(path ? { issues: [{ path, code, message: 'x' }] } : {}),
  })

describe('ders istekleri (IST-094)', () => {
  test('planlama Idempotency-Key taşır, If-Match göndermez (DOM-YTK-069)', async () => {
    const { client, sent } = fakeClient(() => json(201, { data: lesson() }))
    await runRequest(() => createLessonRequest(client, body, commandHeaders('key-12345', 9)))
    assert.equal(sent[0]?.method, 'POST')
    assert.equal(sent[0]?.path, '/api/v1/lessons')
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
    assert.equal(sent[0]?.headers.get('if-match'), null)
    assert.deepEqual(sent[0]?.body, body)
  })

  test('düzenleme, yedek ve iptal sürümü If-Match ve anahtarla gönderir (DOM-YTK-069)', async () => {
    const { client, sent } = fakeClient(() => json(200, { data: lesson() }))
    const headers = commandHeaders('key-12345', 4)
    const target = { lessonId: LESSON_ID, version: 4 }
    await runRequest(() =>
      updateLessonRequest(client, { ...target, body: { room: '102' } }, headers),
    )
    await runRequest(() =>
      substituteLessonRequest(
        client,
        { ...target, body: { teacherId: 't2', reason: 'Rapor' } },
        headers,
      ),
    )
    await runRequest(() =>
      cancelLessonRequest(client, { ...target, body: { reason: 'Gezi' } }, headers),
    )
    assert.deepEqual(
      sent.map((item) => `${item.method} ${item.path}`),
      [
        `PATCH /api/v1/lessons/${LESSON_ID}`,
        `POST /api/v1/lessons/${LESSON_ID}/substitute`,
        `POST /api/v1/lessons/${LESSON_ID}/cancel`,
      ],
    )
    assert.ok(sent.every((item) => item.headers.get('if-match') === '"4"'))
    assert.ok(sent.every((item) => item.headers.get('idempotency-key') === 'key-12345'))
    assert.deepEqual(sent[2]?.body, { reason: 'Gezi' })
  })

  test('sürümsüz yazma istek atmaz', async () => {
    const { client, sent } = fakeClient(() => json(200, { data: lesson() }))
    await assert.rejects(
      () =>
        runRequest(() =>
          cancelLessonRequest(
            client,
            { lessonId: LESSON_ID, version: 4, body: { reason: 'x' } },
            commandHeaders('k'),
          ),
        ),
      (caught: unknown) => caught instanceof ApiError && caught.code === 'if_match_missing',
    )
    assert.equal(sent.length, 0)
  })

  test('boş süzgeç gönderilmez; iptal varsayılanı gönderilmez, iptalleri göster `all` gider', () => {
    assert.deepEqual(
      lessonListParams({ classId: '', teacherId: 't1', room: '  ', cancelled: 'false' }),
      { teacherId: 't1' },
    )
    assert.deepEqual(
      lessonListParams({
        dateFrom: '2026-12-01',
        dateTo: '2026-12-07',
        room: ' 101 ',
        cancelled: 'all',
      }),
      { dateFrom: '2026-12-01', dateTo: '2026-12-07', room: '101', cancelled: 'all' },
    )
    // Aynı süzgeç farklı sırayla verilse de aynı önbellek anahtarıdır.
    assert.deepEqual(
      lessonListKey({ teacherId: 't1', classId: 'c1' }),
      lessonListKey({ classId: 'c1', teacherId: 't1' }),
    )
  })

  test('aralıktaki bütün dersler sayfa sayfa ve süzgeçle okunur', async () => {
    const { client, sent } = fakeClient((item) => {
      const page = Number(item.search.get('page'))
      const rows =
        page === 1
          ? Array.from({ length: 100 }, (_, i) => lesson({ id: `l${i}` }))
          : [lesson({ id: 'son' })]
      return json(200, { data: rows, meta: { page, pageSize: 100, total: 101 } })
    })
    const rows = await fetchAllLessons(client, {
      dateFrom: '2026-12-01',
      dateTo: '2026-12-07',
      cancelled: 'all',
    })
    assert.equal(rows.length, 101)
    assert.equal(sent.length, 2)
    assert.ok(sent.every((item) => item.search.get('cancelled') === 'all'))
    assert.ok(sent.every((item) => item.search.get('dateFrom') === '2026-12-01'))
  })

  test('ders yazması genel program koleksiyonunu da tazeler', () => {
    assert.deepEqual(
      LESSON_INVALIDATES.map((key) => [...key]),
      [['lessons'], ['collections', 'schedule']],
    )
  })
})

describe('ders hata metinleri ve alanları (DOM-YTK-069)', () => {
  const cases: [string, number, string][] = [
    ['lesson_in_past', 422, 'geçmiş'],
    ['lesson_attendance_taken', 422, 'yoklaması alınmış'],
    ['lesson_has_substitution', 422, 'yedek atama işlemini'],
    ['teacher_unchanged', 422, 'Farklı bir öğretmen'],
    ['lesson_already_cancelled', 409, 'zaten iptal'],
    ['version_conflict', 409, LESSON_CHANGED_MESSAGE],
  ]
  for (const [code, status, expected] of cases)
    test(`${code} Türkçe mesaja eşlenir`, () => {
      const feedback = commandFeedback(error(status, code), LESSON_MESSAGES)
      assert.ok(feedback.message?.includes(expected), feedback.message ?? 'mesaj yok')
    })

  test('çakışmada sunucunun mesajı korunur (çakışan kaydı o söyler)', () => {
    for (const code of [
      'teacher_lesson_conflict',
      'class_lesson_conflict',
      'room_conflict',
      'teacher_appointment_conflict',
      'teacher_event_conflict',
      'tutor_schedule_conflict',
    ]) {
      const message = 'Öğretmenin 10:00 saatinde Matematik etüdü var.'
      const feedback = commandFeedback(
        new ApiError({ status: 409, code, message }),
        LESSON_MESSAGES,
      )
      assert.equal(feedback.message, message)
      assert.equal(isLessonConflict(new ApiError({ status: 409, code, message })), true)
    }
    assert.equal(isLessonConflict(error(409, 'version_conflict')), false)
  })

  test('çakışma ve kural hataları formdaki alana bağlanır', () => {
    assert.equal(lessonErrorField(error(409, 'teacher_lesson_conflict'), 'lesson'), 'teacherId')
    assert.equal(lessonErrorField(error(409, 'class_lesson_conflict'), 'lesson'), 'date')
    assert.equal(lessonErrorField(error(409, 'room_conflict'), 'lesson'), 'room')
    assert.equal(lessonErrorField(error(409, 'tutor_schedule_conflict'), 'lesson'), 'date')
    assert.equal(lessonErrorField(error(422, 'lesson_in_past'), 'lesson'), 'date')
    assert.equal(lessonErrorField(error(422, 'lesson_has_substitution'), 'lesson'), 'teacherId')
    assert.equal(
      lessonErrorField(error(400, 'validation_failed', ['duration']), 'lesson'),
      'duration',
    )
    // Yedek formunda öğretmen meşgulse öğretmen alanı; derslik alanı o formda yoktur (toast).
    assert.equal(lessonErrorField(error(409, 'teacher_event_conflict'), 'substitute'), 'teacherId')
    assert.equal(lessonErrorField(error(422, 'teacher_unchanged'), 'substitute'), 'teacherId')
    assert.equal(lessonErrorField(error(409, 'room_conflict'), 'substitute'), undefined)
    assert.equal(lessonErrorField(error(400, 'validation_failed', ['reason']), 'cancel'), 'reason')
    assert.equal(lessonErrorField(error(422, 'lesson_attendance_taken'), 'cancel'), undefined)
    assert.equal(lessonErrorField(error(403, 'forbidden', ['teacherId']), 'lesson'), undefined)
    assert.equal(lessonErrorField(error(404, 'not_found'), 'lesson'), undefined)
  })

  test('404, sürüm çakışması, zaten iptal ve iptal edilmiş ders programı tazeler', () => {
    assert.equal(lessonStale(error(404, 'not_found')), true)
    assert.equal(lessonStale(error(409, 'version_conflict')), true)
    assert.equal(lessonStale(error(409, 'lesson_already_cancelled')), true)
    assert.equal(lessonStale(error(422, 'lesson_cancelled')), true)
    assert.equal(lessonStale(error(409, 'room_conflict')), false)
    assert.equal(lessonStale(error(422, 'lesson_in_past')), false)
  })
})

describe('ders komut akışı', () => {
  test('çift gönderim tek istek atar; sürüm çakışmasında tazeler ve Türkçe bildirir', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { client, sent } = fakeClient(() => failure(409, 'version_conflict'))
    let refreshed = 0
    const reported: string[] = []
    const session = createCommandSession()
    const steps = {
      execute: async (
        input: { lessonId: string; version: number; body: { room: string } },
        headers: ReturnType<typeof commandHeaders>,
      ) => {
        await gate
        return runRequest(() => updateLessonCommand.request(client, input, headers))
      },
      version: updateLessonCommand.version,
      refresh: async () => void (refreshed += 1),
      refreshOn: updateLessonCommand.refreshOn,
      messages: updateLessonCommand.messages,
    }
    const input = { lessonId: LESSON_ID, version: 4, body: { room: '102' } }
    const targets = { notifyError: (message: string) => void reported.push(message) }
    const first = runCommand(session, steps, input, targets)
    const second = await runCommand(session, steps, input, targets)
    release()
    assert.equal(second.status, 'busy')
    assert.equal((await first).status, 'failed')
    assert.equal(sent.length, 1)
    assert.equal(sent[0]?.headers.get('if-match'), '"4"')
    assert.ok(sent[0]?.headers.get('idempotency-key'))
    assert.ok(refreshed >= 1)
    assert.deepEqual(reported, [LESSON_CHANGED_MESSAGE])
  })

  test('derslik çakışması toast yerine alanda, sunucu mesajıyla görünür', async () => {
    const message = 'Derslik bu saatte başka bir sınıf tarafından kullanılıyor.'
    const { client } = fakeClient(() => failure(409, 'room_conflict', message))
    const fields: [string, string][] = []
    const toasts: string[] = []
    const outcome = await runCommand(
      createCommandSession(),
      {
        execute: (input: typeof body, headers) =>
          runRequest(() => createLessonCommand.request(client, input, headers)),
        refresh: async () => undefined,
        messages: createLessonCommand.messages,
      },
      body,
      routeCommandErrors(
        {
          setError: (name, value) => void fields.push([name, value.message]),
          notifyError: (text) => void toasts.push(text),
        },
        { fieldFor: (caught) => lessonErrorField(caught, 'lesson') },
      ),
    )
    assert.equal(outcome.status, 'failed')
    assert.deepEqual(fields, [['room', message]])
    assert.deepEqual(toasts, [])
  })
})
