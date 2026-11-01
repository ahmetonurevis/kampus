import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { QueryClient } from '@tanstack/react-query'

import { createKampusClient } from '@kampus/api-client/client.ts'

import { invalidateInstitutionQueries } from '../src/commands.ts'
import {
  learnerAttemptsQuery,
  learnerProgressQueries,
  learnerSubmissionsQuery,
} from '../src/use-learner-task-progress.ts'
import { TASK_ATTEMPT_INVALIDATES } from '../src/use-task-attempts.ts'
import { TASK_SUBMISSION_INVALIDATES } from '../src/use-task-submissions.ts'

// Kursiyerin görev listesi ilerleme okuması (IST-051): atama başına bir sorgu, kurumlu anahtar,
// deneme ve teslim yazmalarından sonra tazelenir.

function fakeClient() {
  const urls: string[] = []
  const client = createKampusClient({
    baseUrl: 'https://api.kampus.test',
    credentials: 'include',
    requestId: () => undefined,
    fetch: async (input) => {
      const request = input instanceof Request ? input : new Request(input)
      const url = new URL(request.url)
      urls.push(`${request.method} ${url.pathname}${url.search}`)
      return new Response(
        JSON.stringify({ data: [], meta: { page: 1, pageSize: 100, total: 0 } }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      )
    },
  })
  return { client, urls }
}

const targets = [
  { id: 'a-1', scoringMode: 'auto' },
  { id: 'a-2', scoringMode: 'teacher' },
  { id: 'a-3', scoringMode: 'auto' },
] as const

describe('kursiyer görev ilerleme sorguları', () => {
  test('otomatik puanlı atama denemeleri, öğretmen puanlı atama teslimi okur; hepsi atama kimlikli ve tek sayfa', async () => {
    const { client, urls } = fakeClient()
    const queries = learnerProgressQueries(client, 'inst-a', targets)
    assert.deepEqual(
      queries.auto.map((item) => item.id),
      ['a-1', 'a-3'],
    )
    assert.deepEqual(
      queries.written.map((item) => item.id),
      ['a-2'],
    )
    const queryClient = new QueryClient()
    for (const query of [...queries.attemptQueries, ...queries.submissionQueries])
      await queryClient.fetchQuery({ queryKey: query.queryKey, queryFn: query.queryFn as never })
    assert.deepEqual(urls.sort(), [
      'GET /api/v1/task-attempts?assignmentId=a-1&pageSize=100',
      'GET /api/v1/task-attempts?assignmentId=a-3&pageSize=100',
      'GET /api/v1/task-submissions?assignmentId=a-2&pageSize=100',
    ])
  })

  test('etkin kurum yokken sorgu kapalıdır', () => {
    const { client } = fakeClient()
    const queries = learnerProgressQueries(client, null, targets)
    for (const query of [...queries.attemptQueries, ...queries.submissionQueries])
      assert.equal(query.enabled, false)
  })

  test('deneme ve teslim yazmaları satır sorgularını tazeler, başka kurumunkini tazelemez', async () => {
    const { client } = fakeClient()
    const queries = learnerProgressQueries(client, 'inst-a', targets)
    const queryClient = new QueryClient()
    const attempts = queries.attemptQueries[0]!.queryKey
    const submissions = queries.submissionQueries[0]!.queryKey
    const otherInstitution = learnerProgressQueries(client, 'inst-b', targets).attemptQueries[0]!
      .queryKey
    for (const key of [attempts, submissions, otherInstitution])
      await queryClient.fetchQuery({ queryKey: key, queryFn: () => 'x', staleTime: Infinity })
    await invalidateInstitutionQueries(queryClient, 'inst-a', TASK_ATTEMPT_INVALIDATES)
    assert.equal(queryClient.getQueryState(attempts)?.isInvalidated, true)
    assert.equal(queryClient.getQueryState(submissions)?.isInvalidated, false)
    assert.equal(queryClient.getQueryState(otherInstitution)?.isInvalidated, false)
    await invalidateInstitutionQueries(queryClient, 'inst-a', TASK_SUBMISSION_INVALIDATES)
    assert.equal(queryClient.getQueryState(submissions)?.isInvalidated, true)
  })

  test('sorgu gövdeleri ayrıntı ekranıyla aynıdır (önbellek paylaşımı)', () => {
    assert.deepEqual(learnerAttemptsQuery('x'), { assignmentId: 'x', pageSize: 100 })
    assert.deepEqual(learnerSubmissionsQuery('x'), { assignmentId: 'x', pageSize: 100 })
  })
})
