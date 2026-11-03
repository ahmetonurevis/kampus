import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'

import { runRequest } from '../src/api-result.ts'
import { commandFeedback, commandHeaders } from '../src/commands.ts'
import {
  contentResultsKey,
  createTaskAssignmentBatchCommand,
  createTaskAssignmentBatchRequest,
  fetchContentAssignmentResults,
  TASK_ASSIGNMENT_BATCH_MESSAGES,
  type TaskAssignmentBatchBody,
} from '../src/use-content-assignments.ts'
import { TASK_ASSIGNMENT_INVALIDATES, TASK_ASSIGNMENTS_KEY } from '../src/use-task-assignments.ts'

// OG-089 (IST-034; DOM-BEC-049, DOM-BEC-036): toplu atama isteği ve içeriğe bağlı sonuç özeti.

interface Sent {
  method: string
  path: string
  headers: Headers
  body: unknown
}

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
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const RESOURCE_ID = '00000000-0000-4000-8000-0000c0000001'

const body: TaskAssignmentBatchBody = {
  items: [
    {
      resourceVersionId: 'rv-1',
      settings: { deadline: { dueAt: '2026-10-20T20:59:00.000Z' } },
      targets: [{ kind: 'class', id: '9-A' }],
    },
    {
      resourceVersionId: 'rv-1',
      settings: { deadline: { dueAt: '2026-10-27T20:59:00.000Z' } },
      targets: [{ kind: 'class', id: '9-B' }],
    },
  ],
}

describe('içerikten toplu atama kancaları', () => {
  test('DOM-BEC-049: toplu atama tek POST, Idempotency-Key taşır, If-Match taşımaz', async () => {
    const { client, sent } = fakeClient(() => json(201, { data: [] }))
    await runRequest(() =>
      createTaskAssignmentBatchRequest(client, body, commandHeaders('key-12345', 3)),
    )
    assert.equal(sent.length, 1)
    assert.equal(`${sent[0]?.method} ${sent[0]?.path}`, 'POST /api/v1/task-assignments/batches')
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
    assert.equal(sent[0]?.headers.get('if-match'), null)
    assert.deepEqual(sent[0]?.body, body)
  })

  test('DOM-BEC-049: atamalar ve rubrikler tazelenir; çakışma metni Türkçe, öğe yolu alana gider', () => {
    assert.equal(createTaskAssignmentBatchCommand.invalidates, TASK_ASSIGNMENT_INVALIDATES)
    assert.equal(createTaskAssignmentBatchCommand.exclusive, true)
    const overlap = new ApiError({
      status: 409,
      code: 'assignment_overlap',
      message: 'server',
      requestId: 'r',
      issues: [{ path: ['items', '1', 'targets'], code: 'assignment_overlap', message: 'x' }],
    })
    const feedback = commandFeedback(overlap, TASK_ASSIGNMENT_BATCH_MESSAGES)
    assert.match(JSON.stringify(feedback), /açık bir atamada/)
  })

  test('DOM-BEC-036: özet anahtarı atamalar anahtarının altındadır; istek içeriğin yolundadır', async () => {
    assert.deepEqual(contentResultsKey(RESOURCE_ID).slice(0, 1), [TASK_ASSIGNMENTS_KEY])
    const results = {
      resourceId: RESOURCE_ID,
      computedAt: '2026-10-06T09:00:00.000Z',
      assignments: [],
      totals: { learners: 0, completed: 0, scored: 0, averagePercent: null },
      truncated: false,
    }
    const { client, sent } = fakeClient(() => json(200, { data: results }))
    const response = await runRequest(() => fetchContentAssignmentResults(client, RESOURCE_ID))
    assert.equal(
      `${sent[0]?.method} ${sent[0]?.path}`,
      `GET /api/v1/resources/${RESOURCE_ID}/assignment-results`,
    )
    assert.deepEqual(response.data, results)
  })

  test('DOM-BEC-036: öğrenci 403 hatası ApiError olarak döner', async () => {
    const { client } = fakeClient(() =>
      json(403, { code: 'forbidden', message: 'Bu işlem için yetkiniz yok.', requestId: 'r' }),
    )
    await assert.rejects(
      () => runRequest(() => fetchContentAssignmentResults(client, RESOURCE_ID)),
      (error: unknown) => error instanceof ApiError && error.status === 403,
    )
  })
})
