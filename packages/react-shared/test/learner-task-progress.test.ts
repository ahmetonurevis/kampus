import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { QueryClient } from '@tanstack/react-query'

import { createKampusClient } from '@kampus/api-client/client.ts'

import { invalidateInstitutionQueries } from '../src/commands.ts'
import { institutionKey } from '../src/query-keys.ts'
import {
  assignmentListTruncated,
  LEARNER_ASSIGNMENT_MAX_PAGES,
  nextAssignmentPage,
  learnerAttemptsQuery,
  learnerSubmissionsQuery,
} from '../src/use-learner-task-progress.ts'
import { rubricVersionRequest } from '../src/use-rubrics.ts'
import { TASK_ASSIGNMENTS_KEY } from '../src/use-task-assignments.ts'
import { TASK_ATTEMPT_INVALIDATES } from '../src/use-task-attempts.ts'
import { TASK_SUBMISSION_INVALIDATES } from '../src/use-task-submissions.ts'

// Kursiyerin görev listesi (IST-051): durum özeti atama listesindedir (satır başına istek yok),
// deneme ve teslim yazmalarından sonra tazelenir; rubrik sürümü kimlikle okunur (W22b).

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

describe('kursiyer görev listesi (IST-051)', () => {
  test('çalışma alanı sorgu gövdeleri deneme ve teslim listesiyle aynıdır (önbellek paylaşımı)', () => {
    assert.deepEqual(learnerAttemptsQuery('x'), { assignmentId: 'x', pageSize: 100 })
    assert.deepEqual(learnerSubmissionsQuery('x'), { assignmentId: 'x', pageSize: 100 })
  })

  test('deneme ve teslim yazmaları atama listesini (durum özeti) tazeler, başka kurumunkini tazelemez', async () => {
    const queryClient = new QueryClient()
    const list = institutionKey('inst-a', TASK_ASSIGNMENTS_KEY, 'learner-all')
    const other = institutionKey('inst-b', TASK_ASSIGNMENTS_KEY, 'learner-all')
    for (const invalidates of [TASK_ATTEMPT_INVALIDATES, TASK_SUBMISSION_INVALIDATES]) {
      for (const key of [list, other])
        await queryClient.fetchQuery({ queryKey: key, queryFn: () => 'x', staleTime: Infinity })
      await invalidateInstitutionQueries(queryClient, 'inst-a', invalidates)
      assert.equal(queryClient.getQueryState(list)?.isInvalidated, true)
      assert.equal(queryClient.getQueryState(other)?.isInvalidated, false)
      queryClient.clear()
    }
  })

  test('rubrik sürümü kimlikle tek istekle okunur (W22b)', async () => {
    const { client, urls } = fakeClient()
    await rubricVersionRequest(client, 'rv-1')
    assert.deepEqual(urls, ['GET /api/v1/rubric-versions/rv-1'])
  })
})

describe('kursiyer atama sayfalama (W22a)', () => {
  const page = (count: number, total: number) => ({
    data: Array.from({ length: count }, (_, i) => ({ id: `a-${i}` })) as never[],
    meta: { total },
  })

  test('IST-051 yüklenen kayıt toplama ulaşana kadar sıradaki sayfa istenir', () => {
    assert.equal(nextAssignmentPage([page(100, 230)]), 2)
    assert.equal(nextAssignmentPage([page(100, 230), page(100, 230)]), 3)
    assert.equal(nextAssignmentPage([page(100, 230), page(100, 230), page(30, 230)]), undefined)
    assert.equal(nextAssignmentPage([page(40, 40)]), undefined)
  })

  test('boş son sayfa ya da sayfa üst sınırı sonsuz istek atmaz', () => {
    assert.equal(nextAssignmentPage([page(100, 500), page(0, 500)]), undefined)
    const many = Array.from({ length: LEARNER_ASSIGNMENT_MAX_PAGES }, () => page(100, 5000))
    assert.equal(nextAssignmentPage(many), undefined)
    assert.equal(assignmentListTruncated(many), true)
  })

  test('tam yüklenen liste kesilmiş sayılmaz', () => {
    assert.equal(assignmentListTruncated(undefined), false)
    assert.equal(assignmentListTruncated([page(100, 230), page(100, 230), page(30, 230)]), false)
  })
})
