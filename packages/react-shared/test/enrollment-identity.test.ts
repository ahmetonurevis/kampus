import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'

import {
  STUDENT_IDENTITY_QUERY_POLICY,
  studentIdentityKey,
  studentIdentityRequest,
} from '../src/enrollment-identity.ts'

// ON-063: kimlik özeti okuması (her okuma denetim satırı; DOM-YTK-052).
test('ON-063: kimlik özeti öğrencinin kimlik ucuna GET ile gider', async () => {
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
  await studentIdentityRequest(client, 's 1')
  assert.equal(calls[0]?.method, 'GET')
  assert.ok(new URL(calls[0]!.url).pathname.endsWith('/api/v1/students/s%201/identity'))
  assert.deepEqual(studentIdentityKey('s-1'), ['student-identity', 's-1'])
})

test('ON-063: okuma önbellekte tutulmaz, odak ve yeniden bağlanma yeni denetim satırı açmaz', () => {
  assert.deepEqual(STUDENT_IDENTITY_QUERY_POLICY, {
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
})
