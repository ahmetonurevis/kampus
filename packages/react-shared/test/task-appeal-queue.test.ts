import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { QueryClient } from '@tanstack/react-query'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'

import { runRequest } from '../src/api-result.ts'
import { invalidateInstitutionQueries } from '../src/commands.ts'
import { institutionKey } from '../src/query-keys.ts'
import {
  decideTaskAppealCommand,
  fileTaskAppealCommand,
  taskAppealsRequest,
  type TaskAppealQuery,
  TASK_GRADING_INVALIDATES,
} from '../src/use-task-grading.ts'
import { TASK_SUBMISSIONS_KEY } from '../src/use-task-submissions.ts'

// Açık itiraz kuyruğu kancasının isteği ve tazelenmesi (DOM-BEC-025, OG-1010).

const item = {
  id: 'ap-1',
  submissionId: 'ts-1',
  assignmentId: 'as-1',
  versionId: 'v-1',
  versionNumber: 1,
  assignmentTitle: 'Essay',
  learnerId: 'st-1',
  learnerName: 'Deniz Yılmaz',
  filedAt: '2026-11-01T09:00:00.000Z',
  scoredByViewer: false,
}

function fakeClient(status = 200, body: unknown = { data: [item], meta: { total: 1 } }) {
  const urls: string[] = []
  const client = createKampusClient({
    baseUrl: 'https://api.kampus.test',
    credentials: 'include',
    requestId: () => undefined,
    fetch: async (input) => {
      urls.push(input instanceof Request ? input.url : String(input))
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  return { client, urls }
}

describe('açık itiraz kuyruğu kancası', () => {
  test('DOM-BEC-025: kuyruk /task-appeals adresini sayfa ve durum süzgeciyle okur, satırı döndürür', async () => {
    const { client, urls } = fakeClient()
    const query: TaskAppealQuery = { status: 'open', page: 2, pageSize: 25 }
    const result = await runRequest(() =>
      taskAppealsRequest(client, query, new AbortController().signal),
    )
    const url = new URL(urls[0] ?? '')
    assert.equal(url.pathname, '/api/v1/task-appeals')
    assert.equal(url.searchParams.get('status'), 'open')
    assert.equal(url.searchParams.get('page'), '2')
    assert.equal(url.searchParams.get('pageSize'), '25')
    assert.equal(result.data[0]?.scoredByViewer, false)
  })

  test('DOM-BEC-025: sunucu hatası ApiError olarak yükselir', async () => {
    const { client } = fakeClient(403, {
      code: 'forbidden',
      message: 'Bu işlem için yetkiniz yok.',
    })
    await assert.rejects(
      runRequest(() => taskAppealsRequest(client, {}, new AbortController().signal)),
      (error) => error instanceof ApiError && error.status === 403,
    )
  })

  test('DOM-BEC-025: itiraz açma ve karar kuyruğu kurum anahtarıyla tazeler, başka kurumu değil', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const keys = {
      appeals: institutionKey('inst-a', TASK_SUBMISSIONS_KEY, 'appeals', { page: 1 }),
      otherInstitution: institutionKey('inst-b', TASK_SUBMISSIONS_KEY, 'appeals', { page: 1 }),
    }
    for (const invalidates of [
      TASK_GRADING_INVALIDATES,
      decideTaskAppealCommand.invalidates,
      fileTaskAppealCommand.invalidates,
    ]) {
      queryClient.clear()
      for (const key of Object.values(keys))
        await queryClient.fetchQuery({ queryKey: key, queryFn: () => 'x', staleTime: Infinity })
      await invalidateInstitutionQueries(queryClient, 'inst-a', invalidates)
      assert.equal(queryClient.getQueryState(keys.appeals)?.isInvalidated, true)
      assert.equal(queryClient.getQueryState(keys.otherInstitution)?.isInvalidated, false)
    }
  })
})
