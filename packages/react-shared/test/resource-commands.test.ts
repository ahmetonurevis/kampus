import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'

import { runRequest } from '../src/api-result.ts'
import { commandHeaders, IF_MATCH_MISSING_CODE } from '../src/commands.ts'
import { openVersionRequest, updateDraftRequest } from '../src/use-resources.ts'

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
