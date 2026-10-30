import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createAuthClient } from 'better-auth/react'

import { kampusAuthClientOptions } from '@kampus/api-client/auth.ts'
import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'

import { runRequest } from '../src/api-result.ts'
import type { AuthClientLike } from '../src/kampus-context.ts'
import { sessionStatus } from '../src/session-status.ts'

function clientReplying(response: () => Response | Error) {
  return createKampusClient({
    baseUrl: 'https://api.kampus.test',
    credentials: 'include',
    requestId: () => undefined,
    fetch: async () => {
      const result = response()
      if (result instanceof Error) throw result
      return result
    },
  })
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

describe('runRequest', () => {
  test('başarıda tipli gövdeyi döndürür', async () => {
    const client = clientReplying(() => json(200, { data: { status: 'ok', database: 'ok' } }))

    const body = await runRequest(() => client.GET('/api/v1/health'))

    // Tip denetimi: `body.data.status` şemadaki sabit değerdir.
    assert.equal(body.data.status, 'ok')
  })

  test('sunucu hatasını ApiError olarak fırlatır', async () => {
    const client = clientReplying(() =>
      json(403, { code: 'forbidden', message: 'Bu işlem için yetkiniz yok.', requestId: 'r1' }),
    )

    await assert.rejects(
      runRequest(() => client.GET('/api/v1/me')),
      (error) => error instanceof ApiError && error.status === 403 && error.requestId === 'r1',
    )
  })

  test('ApiError dışındaki hata unexpected_error olur', async () => {
    await assert.rejects(
      runRequest(() => Promise.reject(new RangeError('x'))),
      (error) => error instanceof ApiError && error.code === 'unexpected_error',
    )
  })
})

describe('sessionStatus', () => {
  test('bekleyen, açık ve kapalı oturumu ayırır', () => {
    assert.equal(sessionStatus({ data: null, isPending: true }), 'loading')
    assert.equal(sessionStatus({ data: { user: { id: 'u' } }, isPending: false }), 'authenticated')
    assert.equal(sessionStatus({ data: null, isPending: false }), 'unauthenticated')
  })
})

describe('AuthClientLike uyumu', () => {
  test('better-auth/react istemcisi AuthClientLike arayüzünü karşılar (tip denetimi)', () => {
    const authClient = createAuthClient(kampusAuthClientOptions('https://api.kampus.test'))

    const like: AuthClientLike = authClient

    assert.equal(typeof like.useSession, 'function')
    assert.equal(typeof like.organization.setActive, 'function')
  })
})
