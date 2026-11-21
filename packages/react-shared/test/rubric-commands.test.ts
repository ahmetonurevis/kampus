import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { QueryClient } from '@tanstack/react-query'

import { createKampusClient } from '@kampus/api-client/client.ts'

import { runRequest } from '../src/api-result.ts'
import {
  commandHeaders,
  IF_MATCH_MISSING_CODE,
  invalidateInstitutionQueries,
} from '../src/commands.ts'
import { institutionKey } from '../src/query-keys.ts'
import {
  archiveRubricCommand,
  archiveRubricRequest,
  createRubricRequest,
  createRubricVersionRequest,
  publishRubricCommand,
  publishRubricRequest,
  RUBRIC_CHANGED_MESSAGE,
  RUBRIC_INVALIDATES,
  RUBRIC_MESSAGES,
  RUBRICS_KEY,
  updateRubricDraftRequest,
  type RubricBody,
} from '../src/use-rubrics.ts'

// Rubrik kütüphanesi komutları (DOM-BEC-020, DOM-BEC-022, IST-048): başlıklar ve geçersiz kılma.

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
      return new Response(JSON.stringify({ data: {} }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  return { client, sent }
}

const rubric: RubricBody = {
  title: 'Yazma rubriği',
  kind: 'holistic',
  skill: 'writing',
  criteria: [
    {
      id: 'overall',
      aspect: 'overall',
      weight: 1,
      bands: [
        {
          band: 1,
          description: 'Metin görevi karşılamıyor.',
          alignment: { kind: 'cefr', scale: 'overall_written_production', level: 'A2', index: 0 },
        },
      ],
    },
  ],
}

const isMissing = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === IF_MATCH_MISSING_CODE

describe('rubrik komutları', () => {
  test('DOM-BEC-020: oluşturma ve yeni sürüm anahtar taşır, If-Match taşımaz', async () => {
    const { client, sent } = fakeClient()
    const headers = commandHeaders('key-12345', 7)
    await runRequest(() => createRubricRequest(client, rubric, headers))
    await runRequest(() =>
      createRubricVersionRequest(client, { rubricId: 'r 1', body: rubric }, headers),
    )
    assert.deepEqual(
      sent.map(({ method, path }) => `${method} ${path}`),
      ['POST /api/v1/rubrics', 'POST /api/v1/rubrics/r%201/versions'],
    )
    for (const request of sent) {
      assert.equal(request.headers.get('idempotency-key'), 'key-12345')
      assert.equal(request.headers.get('if-match'), null)
      assert.deepEqual(request.body, rubric)
    }
  })

  test('DOM-BEC-020: taslak düzenleme PATCH ile okunan sürümü If-Match olarak taşır', async () => {
    const { client, sent } = fakeClient()
    const patch = { title: 'Yeni başlık' }
    await runRequest(() =>
      updateRubricDraftRequest(
        client,
        { rubricId: 'r1', versionId: 'v1', version: 3, patch },
        commandHeaders('key-12345', 3),
      ),
    )
    assert.equal(`${sent[0]?.method} ${sent[0]?.path}`, 'PATCH /api/v1/rubrics/r1/versions/v1')
    assert.equal(sent[0]?.headers.get('if-match'), '"3"')
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
    assert.deepEqual(sent[0]?.body, patch)
  })

  test('DOM-BEC-022: yayım ve arşiv ilgili sürüme POST eder ve If-Match taşır', async () => {
    const { client, sent } = fakeClient()
    const target = { rubricId: 'r1', versionId: 'v2', version: 5 }
    await runRequest(() => publishRubricRequest(client, target, commandHeaders('key-12345', 5)))
    await runRequest(() => archiveRubricRequest(client, target, commandHeaders('key-67890', 5)))
    assert.deepEqual(
      sent.map(({ method, path }) => `${method} ${path}`),
      [
        'POST /api/v1/rubrics/r1/versions/v2/publish',
        'POST /api/v1/rubrics/r1/versions/v2/archive',
      ],
    )
    assert.deepEqual(
      sent.map((request) => request.headers.get('if-match')),
      ['"5"', '"5"'],
    )
    assert.deepEqual(
      sent.map((request) => request.headers.get('idempotency-key')),
      ['key-12345', 'key-67890'],
    )
  })

  test('DOM-BEC-022: yayım ve arşiv komutları öbür rubrik komutları gibi exclusive çalışır', () => {
    assert.equal(publishRubricCommand.exclusive, true)
    assert.equal(archiveRubricCommand.exclusive, true)
    assert.equal(publishRubricCommand.version({ rubricId: 'r', versionId: 'v', version: 3 }), 3)
    assert.equal(archiveRubricCommand.messages, RUBRIC_MESSAGES)
  })

  test('DOM-BEC-022: okunan sürüm yoksa düzenleme, yayım ve arşiv isteği atılmaz', async () => {
    const { client, sent } = fakeClient()
    const headers = commandHeaders('key-12345')
    const target = { rubricId: 'r1', versionId: 'v1', version: 1 }
    await assert.rejects(
      runRequest(() =>
        updateRubricDraftRequest(client, { ...target, patch: { title: 'x' } }, headers),
      ),
      isMissing,
    )
    await assert.rejects(
      runRequest(() => publishRubricRequest(client, target, headers)),
      isMissing,
    )
    await assert.rejects(
      runRequest(() => archiveRubricRequest(client, target, headers)),
      isMissing,
    )
    assert.equal(sent.length, 0)
  })

  test('DOM-BEC-022: yazma sonrası etkin kurumun rubrik sorguları geçersiz kılınır', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const list = institutionKey('inst-a', RUBRICS_KEY, 'list', { page: 1 })
    const detail = institutionKey('inst-a', RUBRICS_KEY, 'detail', 'r1')
    const otherInstitution = institutionKey('inst-b', RUBRICS_KEY, 'list', { page: 1 })
    const unrelated = institutionKey('inst-a', 'students', 'list')
    for (const key of [list, detail, otherInstitution, unrelated])
      await queryClient.fetchQuery({ queryKey: key, queryFn: () => 'x', staleTime: Infinity })
    const invalidated = () =>
      [list, detail, otherInstitution, unrelated].map(
        (key) => queryClient.getQueryState(key)?.isInvalidated,
      )
    assert.deepEqual(invalidated(), [false, false, false, false])
    await invalidateInstitutionQueries(queryClient, 'inst-a', RUBRIC_INVALIDATES)
    assert.deepEqual(invalidated(), [true, true, false, false])
    queryClient.clear()
  })

  test('sürüm çakışması ve eşzamanlı yayım kullanıcıya güncel hâli yükleme mesajı verir', () => {
    assert.equal(RUBRIC_MESSAGES.version_conflict, RUBRIC_CHANGED_MESSAGE)
    assert.equal(RUBRIC_MESSAGES.published_rubric_version_exists, RUBRIC_CHANGED_MESSAGE)
  })
})
