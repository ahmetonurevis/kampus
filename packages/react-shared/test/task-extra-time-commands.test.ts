import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { QueryClient } from '@tanstack/react-query'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'

import { runRequest } from '../src/api-result.ts'
import {
  commandFeedback,
  commandHeaders,
  IF_MATCH_MISSING_CODE,
  invalidateInstitutionQueries,
} from '../src/commands.ts'
import { institutionKey } from '../src/query-keys.ts'
import {
  changeTaskExtraTimeRequest,
  extraTimeAvailability,
  extraTimeMinutesLabel,
  extraTimeReasonLabel,
  grantTaskExtraTimeRequest,
  learnerExtraTimeName,
  learnersWithoutExtraTime,
  listTaskExtraTimesRequest,
  removeTaskExtraTimeRequest,
  TASK_EXTRA_TIME_INVALIDATES,
  TASK_EXTRA_TIME_MESSAGES,
  taskExtraTimesKey,
  type TaskExtraTimeLearner,
} from '../src/task-extra-times.ts'
import { TASK_ATTEMPTS_KEY } from '../src/use-task-attempts.ts'
import { TASK_ASSIGNMENTS_KEY } from '../src/use-task-assignments.ts'

// Bireysel ek süre (DOM-BEC-043, OG-248): istek başlıkları, Türkçe hata metinleri, görünürlük.

interface Sent {
  method: string
  path: string
  headers: Headers
  body: unknown
}

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
      return new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  return { client, sent }
}

const A = 'a-1'
const L = 'l-1'
const base = '/api/v1/task-assignments/a-1/extra-times'

describe('bireysel ek süre isteği (DOM-BEC-043)', () => {
  test('DOM-BEC-043: liste okunur, verme Idempotency-Key taşır ama If-Match taşımaz', async () => {
    const { client, sent } = fakeClient()
    await runRequest(() => listTaskExtraTimesRequest(client, A))
    await runRequest(() =>
      grantTaskExtraTimeRequest(
        client,
        { assignmentId: A, body: { learnerId: L, minutes: 15, reason: 'accommodation' } },
        commandHeaders('key-1', undefined),
      ),
    )
    assert.equal(sent[0]?.method, 'GET')
    assert.equal(sent[0]?.path, base)
    assert.equal(sent[1]?.method, 'POST')
    assert.equal(sent[1]?.path, base)
    assert.equal(sent[1]?.headers.get('idempotency-key'), 'key-1')
    assert.equal(sent[1]?.headers.get('if-match'), null)
    assert.deepEqual(sent[1]?.body, { learnerId: L, minutes: 15, reason: 'accommodation' })
  })

  test('DOM-BEC-043: değiştirme ve kaldırma okunan sürümü If-Match olarak gönderir', async () => {
    const { client, sent } = fakeClient()
    await runRequest(() =>
      changeTaskExtraTimeRequest(
        client,
        {
          assignmentId: A,
          learnerId: L,
          version: 3,
          body: { minutes: 20, reason: 'technical_issue' },
        },
        commandHeaders('key-2', 3),
      ),
    )
    await runRequest(() =>
      removeTaskExtraTimeRequest(
        client,
        { assignmentId: A, learnerId: L, version: 4 },
        commandHeaders('key-3', 4),
      ),
    )
    assert.equal(sent[0]?.method, 'PATCH')
    assert.equal(sent[0]?.path, `${base}/${L}`)
    assert.equal(sent[0]?.headers.get('if-match'), '"3"')
    assert.deepEqual(sent[0]?.body, { minutes: 20, reason: 'technical_issue' })
    assert.equal(sent[1]?.method, 'DELETE')
    assert.equal(sent[1]?.path, `${base}/${L}`)
    assert.equal(sent[1]?.headers.get('if-match'), '"4"')
    assert.equal(sent[1]?.body, undefined)
  })

  test('DOM-BEC-043: okunan sürüm yoksa değiştirme ve kaldırma istek atmaz', () => {
    const { client, sent } = fakeClient()
    const missing = (error: unknown) =>
      error instanceof ApiError && error.code === IF_MATCH_MISSING_CODE
    assert.throws(
      () =>
        changeTaskExtraTimeRequest(
          client,
          { assignmentId: A, learnerId: L, version: 1, body: { minutes: 5, reason: 'other' } },
          commandHeaders('key-4', undefined),
        ),
      missing,
    )
    assert.throws(
      () =>
        removeTaskExtraTimeRequest(
          client,
          { assignmentId: A, learnerId: L, version: 1 },
          commandHeaders('key-5', undefined),
        ),
      missing,
    )
    assert.equal(sent.length, 0)
  })
})

describe('bireysel ek süre metinleri ve tazeleme (DOM-BEC-043)', () => {
  test('DOM-BEC-043: kural hataları Türkçe sözlükten, bilinmeyen kod sunucudan gelir', () => {
    const cases = [
      ['version_conflict', 'değişti'],
      ['extra_time_exists', 'değiştirmeyi kullanın'],
      ['extra_time_untimed', 'süreli görevde'],
      ['extra_time_too_long', 'aşamaz'],
      ['extra_time_below_elapsed', 'daha uzun'],
      ['submission_closed', 'kapandığı'],
      ['forbidden', 'yetkiniz'],
      ['not_found', 'bulunamadı'],
    ] as const
    for (const [code, expected] of cases) {
      const feedback = commandFeedback(
        new ApiError({ status: 422, code, message: 'technical' }),
        TASK_EXTRA_TIME_MESSAGES,
      )
      assert.ok(feedback.message?.includes(expected), code)
    }
    const unknown = commandFeedback(
      new ApiError({ status: 422, code: 'other_rule', message: 'Sunucu mesajı.' }),
      TASK_EXTRA_TIME_MESSAGES,
    )
    assert.equal(unknown.message, 'Sunucu mesajı.')
  })

  test('DOM-BEC-043: başarı atama ve deneme sorgularını geçersiz kılar, anahtar atamaya bağlıdır', async () => {
    assert.deepEqual(
      TASK_EXTRA_TIME_INVALIDATES.map((prefix) => prefix[0]),
      [TASK_ASSIGNMENTS_KEY, TASK_ATTEMPTS_KEY],
    )
    assert.deepEqual(taskExtraTimesKey(A), [TASK_ASSIGNMENTS_KEY, 'extra-times', A])
    const queryClient = new QueryClient()
    const key = institutionKey('u-1', ...taskExtraTimesKey(A))
    queryClient.setQueryData(key, { data: {} })
    await invalidateInstitutionQueries(queryClient, 'u-1', TASK_EXTRA_TIME_INVALIDATES)
    assert.equal(queryClient.getQueryState(key)?.isInvalidated, true)
  })
})

describe('bireysel ek süre bölümü kararı (DOM-BEC-043)', () => {
  const open = { dueAt: '2026-11-20T18:00:00.000Z', lateAcceptanceDays: 2 }
  test('DOM-BEC-043: süresiz görevde bölüm kapalıdır', () => {
    assert.equal(
      extraTimeAvailability({ timeLimitMinutes: null, deadline: open }, '2026-11-10T09:00:00.000Z'),
      'untimed',
    )
  })

  test('DOM-BEC-044: süreli görevde geç kabul bitene kadar açık, sonra kapalıdır', () => {
    const task = { timeLimitMinutes: 30, deadline: open }
    assert.equal(extraTimeAvailability(task, '2026-11-21T09:00:00.000Z'), 'open')
    assert.equal(extraTimeAvailability(task, '2026-11-22T18:00:00.000Z'), 'open')
    assert.equal(extraTimeAvailability(task, '2026-11-22T18:00:01.000Z'), 'closed')
    assert.equal(
      extraTimeAvailability(
        { timeLimitMinutes: 30, deadline: { dueAt: null, lateAcceptanceDays: 0 } },
        '2030-01-01T00:00:00.000Z',
      ),
      'open',
    )
  })

  test('DOM-BEC-043: etiketler ve kursiyer ayrımı', () => {
    assert.equal(extraTimeReasonLabel('accommodation'), 'Bireysel uyarlama')
    assert.equal(extraTimeReasonLabel('technical_issue'), 'Teknik sorun')
    assert.equal(extraTimeReasonLabel(null), 'Kaldırıldı')
    assert.equal(extraTimeMinutesLabel(15), '15 dk')
    const learner = (id: string, minutes: number | null): TaskExtraTimeLearner => ({
      learnerId: id,
      learnerName: id === 'l-3' ? null : `Öğrenci ${id}`,
      current:
        minutes === null
          ? null
          : {
              minutes,
              reason: 'other',
              grantedAt: '2026-11-03T08:00:00.000Z',
              grantedByUserId: 'u-1',
            },
      version: minutes === null ? 0 : 1,
      history: [],
    })
    const list = { learners: [learner('l-1', 10), learner('l-2', null), learner('l-3', null)] }
    assert.deepEqual(
      learnersWithoutExtraTime(list).map((item) => item.learnerId),
      ['l-2', 'l-3'],
    )
    assert.equal(learnerExtraTimeName(list.learners[2]!), 'Kursiyer')
    assert.equal(learnerExtraTimeName(list.learners[0]!), 'Öğrenci l-1')
  })
})
