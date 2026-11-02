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
  activateCourseRequest,
  archiveCourseRequest,
  COURSE_CHANGED_MESSAGE,
  COURSE_INVALIDATES,
  COURSE_MESSAGES,
  courseErrorField,
  courseStale,
  createCourseRequest,
  fetchAllCourses,
  recordCourseEOzelRequest,
  updateCourseCommand,
  updateCourseRequest,
} from '../src/courses.ts'

// IST-076 (DOM-DIL-005…007): kur istekleri, If-Match / Idempotency-Key, hata metinleri ve alanları.

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
const failure = (status: number, code: string, issues?: unknown[]) =>
  json(status, { code, message: 'Sunucu mesajı.', requestId: 'r1', ...(issues ? { issues } : {}) })

const COURSE_ID = '00000000-0000-4000-8000-0000c0000001'
const course = (overrides: Record<string, unknown> = {}) => ({
  id: COURSE_ID,
  name: 'Genel İngilizce A1',
  language: 'en',
  level: 'A1',
  skillFocus: [],
  description: null,
  totalHours: 96,
  weeklyHours: 6,
  sessionMinutes: 45,
  durationWeeks: 16,
  maxLearners: 14,
  certified: true,
  nextCourseId: null,
  minLearners: 6,
  status: 'draft',
  rowVersion: 3,
  ...overrides,
})
const body = {
  name: 'Genel İngilizce A1',
  level: 'A1' as const,
  totalHours: 96,
  weeklyHours: 6,
  minLearners: 6,
  maxLearners: 14,
}

describe('kur istekleri', () => {
  test('oluşturma Idempotency-Key taşır, If-Match göndermez (DOM-DIL-005)', async () => {
    const { client, sent } = fakeClient(() => json(201, { data: course() }))
    await runRequest(() => createCourseRequest(client, body, commandHeaders('key-12345', 9)))
    assert.equal(sent[0]?.method, 'POST')
    assert.equal(sent[0]?.path, '/api/v1/courses')
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
    assert.equal(sent[0]?.headers.get('if-match'), null)
    assert.deepEqual(sent[0]?.body, body)
  })

  test('değiştirme, etkinleştirme, arşiv ve e-Özel kaydı sürümü If-Match ve anahtarla gönderir', async () => {
    const { client, sent } = fakeClient(() => json(200, { data: course() }))
    const headers = commandHeaders('key-12345', 3)
    const target = { courseId: COURSE_ID, version: 3 }
    await runRequest(() =>
      updateCourseRequest(client, { ...target, body: { maxLearners: 12 } }, headers),
    )
    await runRequest(() => activateCourseRequest(client, target, headers))
    await runRequest(() => archiveCourseRequest(client, target, headers))
    await runRequest(() =>
      recordCourseEOzelRequest(
        client,
        { ...target, body: { programCode: 'ING-A1', approval: 'approved' } },
        headers,
      ),
    )
    assert.deepEqual(
      sent.map((item) => `${item.method} ${item.path}`),
      [
        `PATCH /api/v1/courses/${COURSE_ID}`,
        `POST /api/v1/courses/${COURSE_ID}/activate`,
        `DELETE /api/v1/courses/${COURSE_ID}`,
        `POST /api/v1/courses/${COURSE_ID}/record-e-ozel`,
      ],
    )
    assert.ok(sent.every((item) => item.headers.get('if-match') === '"3"'))
    assert.ok(sent.every((item) => item.headers.get('idempotency-key') === 'key-12345'))
    assert.deepEqual(sent[1]?.body, {})
    assert.equal(sent[2]?.body, undefined)
  })

  test('sürümsüz yazma istek atmaz', async () => {
    const { client, sent } = fakeClient(() => json(200, { data: course() }))
    await assert.rejects(
      () =>
        runRequest(() =>
          activateCourseRequest(client, { courseId: COURSE_ID, version: 3 }, commandHeaders('k')),
        ),
      (error: unknown) => error instanceof ApiError && error.code === 'if_match_missing',
    )
    assert.equal(sent.length, 0)
  })

  test('bütün kurlar arşiv dahil iki süzgeçle sayfa sayfa okunur', async () => {
    const { client, sent } = fakeClient((item) => {
      const archived = item.search.get('status') === 'archived'
      const rows = archived ? [course({ id: 'a1', status: 'archived' })] : [course()]
      return json(200, { data: rows, meta: { page: 1, pageSize: 100, total: rows.length } })
    })
    const rows = await fetchAllCourses(client)
    assert.deepEqual(rows.map((row) => row.status).sort(), ['archived', 'draft'])
    assert.deepEqual(
      sent.map((item) => item.search.get('status')).sort(),
      ['archived', null].sort(),
    )
    assert.ok(sent.every((item) => item.search.get('pageSize') === '100'))
  })

  test('kur yazması grup listesini de tazeler', () => {
    assert.deepEqual(
      COURSE_INVALIDATES.map((key) => [...key]),
      [['courses'], ['language-groups']],
    )
  })
})

describe('kur hata metinleri ve alanları', () => {
  const cases: [string, number, string][] = [
    ['course_program_not_approved', 422, "e-Özel'de onaylanmadan"],
    ['course_has_open_groups', 422, 'kapanmamış grupları'],
    ['course_max_below_group_capacity', 422, 'kapasitesinin altına'],
    ['course_coordinator_required', 403, 'akademik koordinatörü'],
    ['version_conflict', 409, COURSE_CHANGED_MESSAGE],
  ]
  for (const [code, status, expected] of cases)
    test(`${code} Türkçe mesaja eşlenir (DOM-DIL-005, -006)`, () => {
      const feedback = commandFeedback(
        new ApiError({ status, code, message: 'technical' }),
        COURSE_MESSAGES,
      )
      assert.ok(feedback.message?.includes(expected), feedback.message ?? 'mesaj yok')
    })

  test('alan hataları alana, yetki ve kur kuralı toast olarak kalır', () => {
    const error = (status: number, code: string, path?: string[]) =>
      new ApiError({
        status,
        code,
        message: 'x',
        ...(path ? { issues: [{ path, code, message: 'x' }] } : {}),
      })
    assert.equal(courseErrorField(error(409, 'course_name_exists')), 'name')
    assert.equal(courseErrorField(error(422, 'course_max_below_group_capacity')), 'maxLearners')
    assert.equal(
      courseErrorField(error(422, 'course_session_mismatch', ['weeklyHours'])),
      'weeklyHours',
    )
    assert.equal(courseErrorField(error(422, 'course_next_level')), 'nextCourseId')
    assert.equal(courseErrorField(error(422, 'other_rule', ['description'])), 'description')
    assert.equal(courseErrorField(error(403, 'course_coordinator_required', ['level'])), undefined)
    assert.equal(courseErrorField(error(422, 'course_program_not_approved')), undefined)
    assert.equal(courseErrorField(error(422, 'course_has_open_groups')), undefined)
  })

  test('404 ve sürüm çakışması listeyi tazeler', () => {
    assert.equal(courseStale(new ApiError({ status: 404, code: 'not_found', message: 'x' })), true)
    assert.equal(
      courseStale(new ApiError({ status: 409, code: 'version_conflict', message: 'x' })),
      true,
    )
    assert.equal(
      courseStale(new ApiError({ status: 422, code: 'course_has_open_groups', message: 'x' })),
      false,
    )
  })
})

describe('kur komut akışı', () => {
  test('çift gönderim tek istek atar; 409 çakışmada tazeler ve Türkçe bildirir', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { client, sent } = fakeClient(() => failure(409, 'version_conflict'))
    let refreshed = 0
    const reported: string[] = []
    const session = createCommandSession()
    const steps = {
      execute: async (
        input: { courseId: string; version: number; body: { maxLearners: number } },
        headers: ReturnType<typeof commandHeaders>,
      ) => {
        await gate
        return runRequest(() => updateCourseCommand.request(client, input, headers))
      },
      version: updateCourseCommand.version,
      refresh: async () => void (refreshed += 1),
      refreshOn: updateCourseCommand.refreshOn,
      messages: updateCourseCommand.messages,
    }
    const input = { courseId: COURSE_ID, version: 3, body: { maxLearners: 12 } }
    const targets = { notifyError: (message: string) => void reported.push(message) }
    const first = runCommand(session, steps, input, targets)
    const second = await runCommand(session, steps, input, targets)
    release()
    assert.equal(second.status, 'busy')
    assert.equal((await first).status, 'failed')
    assert.equal(sent.length, 1)
    assert.equal(sent[0]?.headers.get('if-match'), '"3"')
    assert.ok(sent[0]?.headers.get('idempotency-key'))
    assert.ok(refreshed >= 1)
    assert.deepEqual(reported, [COURSE_CHANGED_MESSAGE])
  })
})
