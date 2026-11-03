import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { QueryClient } from '@tanstack/react-query'

import { runRequest } from '../src/api-result.ts'
import {
  commandHeaders,
  IF_MATCH_MISSING_CODE,
  invalidateInstitutionQueries,
} from '../src/commands.ts'
import { institutionKey } from '../src/query-keys.ts'
import {
  copyResourceRequest,
  openVersionRequest,
  REMOVE_RESOURCE_INVALIDATES,
  RESOURCES_KEY,
  removeResourceRequest,
  reportVersionRequest,
  shareResourceRequest,
  updateDraftRequest,
} from '../src/use-resources.ts'

function fakeClient() {
  const sent: Request[] = []
  const client = createKampusClient({
    baseUrl: 'https://api.kampus.test',
    credentials: 'include',
    requestId: () => undefined,
    fetch: async (input) => {
      sent.push(input instanceof Request ? input : new Request(input))
      return new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  return { client, sent }
}

const input = { resourceId: 'r1', versionId: 'v1', version: 2, patch: { title: 'Yeni başlık' } }

describe('içerik taslağı düzenleme', () => {
  test('DOM-KYN-030: okunan sürüm yoksa istek atılmaz', async () => {
    const { client, sent } = fakeClient()
    await assert.rejects(
      runRequest(() => updateDraftRequest(client, input, commandHeaders('key-12345'))),
      (error: unknown) =>
        error instanceof Error && 'code' in error && error.code === IF_MATCH_MISSING_CODE,
    )
    assert.equal(sent.length, 0)
  })

  test('DOM-KYN-030: sürüm varsa If-Match başlığı gider', async () => {
    const { client, sent } = fakeClient()
    await runRequest(() => updateDraftRequest(client, input, commandHeaders('key-12345', 2)))
    assert.equal(sent.length, 1)
    assert.equal(sent[0]?.method, 'PATCH')
    assert.equal(sent[0]?.headers.get('if-match'), '"2"')
  })
})

describe('yeni sürüm gövdesi (DOM-KYN-006, 032)', () => {
  test('DOM-KYN-006: liste verilmezse gövde boştur, temel sürümün dosyaları taşınır', async () => {
    const { client, sent } = fakeClient()
    await runRequest(() => openVersionRequest(client, { resourceId: 'r1' }, commandHeaders('k-1')))
    assert.equal(sent[0]?.method, 'POST')
    assert.deepEqual(await sent[0]?.json(), {})
  })

  test('DOM-KYN-006: verilen dosya listesi sırasıyla gider', async () => {
    const { client, sent } = fakeClient()
    await runRequest(() =>
      openVersionRequest(
        client,
        { resourceId: 'r1', fileIds: ['f2', 'f1'] },
        commandHeaders('k-2'),
      ),
    )
    assert.deepEqual(await sent[0]?.json(), { fileIds: ['f2', 'f1'] })
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'k-2')
  })
})

describe('kaynak düzeyindeki komutlar (OG-217)', () => {
  test('DOM-KYN-040: paylaşım hedefleri gövdede, kaynak sürümü If-Match başlığında gider', async () => {
    const { client, sent } = fakeClient()
    await runRequest(() =>
      shareResourceRequest(
        client,
        { resourceId: 'r1', version: 3, targets: { scope: 'classes', classIds: ['c1'] } },
        commandHeaders('k-3', 3),
      ),
    )
    assert.equal(sent[0]?.method, 'POST')
    assert.match(sent[0]?.url ?? '', /\/api\/v1\/resources\/r1\/share$/)
    assert.equal(sent[0]?.headers.get('if-match'), '"3"')
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'k-3')
    assert.deepEqual(await sent[0]?.json(), { scope: 'classes', classIds: ['c1'] })
  })

  test('DOM-KYN-050: kopya gövdesi boştur ve If-Match göndermez', async () => {
    const { client, sent } = fakeClient()
    await runRequest(() =>
      copyResourceRequest(client, { resourceId: 'r1' }, commandHeaders('k-4', 2)),
    )
    assert.match(sent[0]?.url ?? '', /\/api\/v1\/resources\/r1\/copy$/)
    assert.equal(sent[0]?.headers.get('if-match'), null)
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'k-4')
    assert.deepEqual(await sent[0]?.json(), {})
  })

  test('DOM-KYN-051: kaldırma gerekçeyi gövdede taşır', async () => {
    const { client, sent } = fakeClient()
    await runRequest(() =>
      removeResourceRequest(
        client,
        { resourceId: 'r1', version: 5, reason: 'Telif ihlali doğrulandı.' },
        commandHeaders('k-5', 5),
      ),
    )
    assert.match(sent[0]?.url ?? '', /\/api\/v1\/resources\/r1\/remove$/)
    assert.equal(sent[0]?.headers.get('if-match'), '"5"')
    assert.deepEqual(await sent[0]?.json(), { reason: 'Telif ihlali doğrulandı.' })
  })

  test('DOM-KYN-025: telif bildirimi sürüm yoluna gider; sürüm bilinmiyorsa If-Match yok', async () => {
    const { client, sent } = fakeClient()
    await runRequest(() =>
      reportVersionRequest(
        client,
        { resourceId: 'r1', versionId: 'v1', reason: 'Yayınevi sayfası izinsiz.' },
        commandHeaders('k-6'),
      ),
    )
    assert.match(sent[0]?.url ?? '', /\/api\/v1\/resources\/r1\/versions\/v1\/report$/)
    assert.equal(sent[0]?.headers.get('if-match'), null)
    assert.deepEqual(await sent[0]?.json(), { reason: 'Yayınevi sayfası izinsiz.' })
  })
})

describe('içerik kaldırma önbelleği', () => {
  test('DOM-KYN-051: kaldırma içerik, quiz/alıştırma ve görev sorgularını tazeler; başka kurumunkini tazelemez', async () => {
    const queryClient = new QueryClient()
    const keys = [
      institutionKey('inst-a', RESOURCES_KEY, 'detail', 'quiz-1'),
      institutionKey('inst-a', 'task-assignments', 'detail', 'a-1'),
      institutionKey('inst-a', 'task-attempts', 'list', { assignmentId: 'a-1' }),
      institutionKey('inst-a', 'task-submissions', 'list', { assignmentId: 'a-1' }),
    ]
    const other = institutionKey('inst-b', 'task-assignments', 'detail', 'a-1')
    for (const key of [...keys, other])
      await queryClient.fetchQuery({ queryKey: key, queryFn: () => 'x', staleTime: Infinity })
    await invalidateInstitutionQueries(queryClient, 'inst-a', REMOVE_RESOURCE_INVALIDATES)
    for (const key of keys) assert.equal(queryClient.getQueryState(key)?.isInvalidated, true)
    assert.equal(queryClient.getQueryState(other)?.isInvalidated, false)
  })
})
