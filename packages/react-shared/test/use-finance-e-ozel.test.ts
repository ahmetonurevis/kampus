import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'

import { eOzelIdentityKey, eOzelIdentityRequest } from '../src/use-finance-e-ozel.ts'

test('DOM-YTK-052: tam kimlik okuması kursiyerin ucuna GET ile gider', async () => {
  const calls: Request[] = []
  const client = createKampusClient({
    baseUrl: 'http://localhost',
    credentials: 'include',
    requestId: () => undefined,
    fetch: async (input: string | Request | URL) => {
      calls.push(input as Request)
      return Response.json({ data: {} })
    },
  })
  await eOzelIdentityRequest(client, 's 1')
  assert.equal(calls[0]?.method, 'GET')
  assert.ok(
    new URL(calls[0]!.url).pathname.endsWith('/api/v1/finance/e-ozel/learners/s%201/identity'),
  )
})

test('DOM-YTK-052: tam kimlik anahtarı tahsilat tazelemesine bağlı değildir, yeni denetim satırı açılmaz', () => {
  const [root] = eOzelIdentityKey('s-1')
  assert.notEqual(root, 'payments')
  assert.deepEqual(eOzelIdentityKey('s-1'), ['e-ozel-identity', 's-1'])
})
