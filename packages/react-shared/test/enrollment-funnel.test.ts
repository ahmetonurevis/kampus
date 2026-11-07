import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'

import { enrollmentFunnelKey, enrollmentFunnelRequest } from '../src/enrollment-funnel.ts'

// ON-052: kayıt hunisi okuması; boş aralık ucu sorguya girmez.
test('ON-052: huni isteği yalnız dolu aralık uçlarını gönderir; anahtar aralığı içerir', async () => {
  const urls: URL[] = []
  const client = createKampusClient({
    baseUrl: 'http://localhost',
    credentials: 'include',
    requestId: () => undefined,
    fetch: async (input: string | Request | URL) => {
      urls.push(new URL((input as Request).url))
      return Response.json({ data: {} })
    },
  })
  await enrollmentFunnelRequest(client, {})
  await enrollmentFunnelRequest(client, { dateFrom: '2026-09-01', dateTo: '2026-09-30' })
  assert.ok(urls[0]?.pathname.endsWith('/api/v1/prospects/funnel'))
  assert.equal(urls[0]?.search, '')
  assert.equal(urls[1]?.searchParams.get('dateFrom'), '2026-09-01')
  assert.equal(urls[1]?.searchParams.get('dateTo'), '2026-09-30')
  assert.deepEqual(enrollmentFunnelKey({ dateFrom: '2026-09-01' }), [
    'prospects',
    'funnel',
    '2026-09-01',
    '',
  ])
})
