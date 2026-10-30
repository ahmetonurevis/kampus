import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'

import { runRequest } from '../src/api-result.ts'
import { commandHeaders, IF_MATCH_MISSING_CODE } from '../src/commands.ts'
import { updateDraftRequest } from '../src/use-resources.ts'

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
