import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createAuthClient } from 'better-auth/client'

import { AUTH_BASE_PATH, kampusAuthClientOptions } from '../src/auth.ts'

interface Call {
  url: string
  method: string
  body: unknown
}

function authClientWith(baseUrl = 'https://api.kampus.test') {
  const calls: Call[] = []
  const client = createAuthClient({
    ...kampusAuthClientOptions(baseUrl),
    fetchOptions: {
      customFetchImpl: async (input, init) => {
        const request = new Request(input, init)
        const text = await request.text()
        calls.push({
          url: request.url,
          method: request.method,
          body: text ? (JSON.parse(text) as unknown) : null,
        })
        return new Response(JSON.stringify({ status: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    },
  })
  return { client, calls }
}

describe('Better Auth istemci bağlamı', () => {
  test('basePath API ile aynıdır', () => {
    assert.equal(AUTH_BASE_PATH, '/api/v1/auth')
    assert.equal(kampusAuthClientOptions('https://x.test').basePath, '/api/v1/auth')
  })

  test('giriş /api/v1/auth/sign-in/email adresine gider', async () => {
    const { client, calls } = authClientWith()

    await client.signIn.email({ email: 'selin@example.test', password: 'gizli-parola-123' })

    assert.equal(calls[0]?.url, 'https://api.kampus.test/api/v1/auth/sign-in/email')
    assert.equal(calls[0]?.method, 'POST')
  })

  test('organization eklentisi kurum değişimini /organization/set-active ile yapar', async () => {
    const { client, calls } = authClientWith()

    await client.organization.setActive({ organizationId: 'inst-1' })

    assert.equal(calls[0]?.url, 'https://api.kampus.test/api/v1/auth/organization/set-active')
    assert.deepEqual(calls[0]?.body, { organizationId: 'inst-1' })
  })

  test('oturum sorgusu /get-session adresine gider', async () => {
    const { client, calls } = authClientWith()

    await client.getSession()

    assert.equal(calls[0]?.url, 'https://api.kampus.test/api/v1/auth/get-session')
    assert.equal(calls[0]?.method, 'GET')
  })
})
