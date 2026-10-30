import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient, unwrap, type KampusClientOptions } from '../src/client.ts'
import { ApiError } from '../src/errors.ts'

interface Call {
  url: string
  method: string
  headers: Headers
  credentials: string | undefined
}

/** İstekleri kaydeden ve sıradaki yanıtı (ya da hatayı) veren sahte `fetch`. */
function fakeFetch(respond: () => Response | Error) {
  const calls: Call[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init)
    calls.push({
      url: request.url,
      method: request.method,
      headers: request.headers,
      credentials: init?.credentials ?? request.credentials,
    })
    const result = respond()
    if (result instanceof Error) throw result
    return result
  }
  return { fetch, calls }
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function clientWith(respond: () => Response | Error, options: Partial<KampusClientOptions> = {}) {
  const { fetch, calls } = fakeFetch(respond)
  const client = createKampusClient({
    baseUrl: 'https://api.kampus.test',
    credentials: 'include',
    fetch,
    requestId: () => 'req-test',
    ...options,
  })
  return { client, calls }
}

const ME = {
  user: { id: 'u1', name: 'Selin Kaya', email: 'selin@example.test' },
  activeInstitution: null,
  activeMembership: null,
  memberships: [],
}

describe('createKampusClient', () => {
  test('başarılı yanıtta tipli veri döner ve istek doğru kurulur', async () => {
    const { client, calls } = clientWith(() => json(200, { data: ME }))

    const result = await client.GET('/api/v1/me')

    assert.deepEqual(unwrap(result)?.data, ME)
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.url, 'https://api.kampus.test/api/v1/me')
    assert.equal(calls[0]?.method, 'GET')
    assert.equal(calls[0]?.credentials, 'include')
  })

  test('hata zarfını ApiError olarak fırlatır (400 + issues)', async () => {
    const { client } = clientWith(() =>
      json(400, {
        code: 'validation_failed',
        message: 'Formda düzeltilmesi gereken alanlar var.',
        issues: [{ path: ['page'], code: 'too_small', message: 'En az 1 olmalı' }],
        requestId: 'srv-1',
      }),
    )

    await assert.rejects(client.GET('/api/v1/memberships'), (error) => {
      assert.ok(error instanceof ApiError)
      assert.equal(error.status, 400)
      assert.equal(error.code, 'validation_failed')
      assert.equal(error.message, 'Formda düzeltilmesi gereken alanlar var.')
      assert.equal(error.requestId, 'srv-1')
      assert.deepEqual(error.issues, [
        { path: ['page'], code: 'too_small', message: 'En az 1 olmalı' },
      ])
      return true
    })
  })

  test('401 ApiError oturumsuz olarak işaretlenir', async () => {
    const { client } = clientWith(() =>
      json(401, {
        code: 'unauthenticated',
        message: 'Oturum açmanız gerekiyor.',
        requestId: 'srv-2',
      }),
    )

    await assert.rejects(client.GET('/api/v1/me'), (error) => {
      assert.ok(error instanceof ApiError)
      assert.equal(error.status, 401)
      assert.equal(error.isUnauthenticated, true)
      assert.equal(error.isNetworkError, false)
      assert.deepEqual(error.issues, [])
      return true
    })
  })

  test('zarf olmayan yanıt (ağ geçidi HTML) genel hataya çevrilir; ayrıntı sızmaz', async () => {
    const { client } = clientWith(
      () =>
        new Response('<html>502 Bad Gateway nginx/1.25</html>', {
          status: 502,
          headers: { 'content-type': 'text/html', 'x-request-id': 'edge-9' },
        }),
    )

    await assert.rejects(client.GET('/api/v1/me'), (error) => {
      assert.ok(error instanceof ApiError)
      assert.equal(error.status, 502)
      assert.equal(error.code, 'unexpected_response')
      assert.doesNotMatch(error.message, /nginx|502|html/i)
      assert.equal(error.requestId, 'edge-9')
      return true
    })
  })

  test('ağ hatası network_error koduyla ApiError olur ve nedeni korur', async () => {
    const cause = new TypeError('fetch failed')
    const { client } = clientWith(() => cause)

    await assert.rejects(client.GET('/api/v1/me'), (error) => {
      assert.ok(error instanceof ApiError)
      assert.equal(error.status, 0)
      assert.equal(error.code, 'network_error')
      assert.equal(error.isNetworkError, true)
      assert.equal(error.cause, cause)
      return true
    })
  })

  test('iptal (AbortError) ağ hatasına çevrilmez', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError')
    const { client } = clientWith(() => abort)

    await assert.rejects(client.GET('/api/v1/me'), (error) => {
      assert.ok(!(error instanceof ApiError))
      assert.equal((error as Error).name, 'AbortError')
      return true
    })
  })

  test('CSRF için özel başlık eklemez; Origin ve Sec-Fetch-Site tarayıcıya bırakılır', async () => {
    const { client, calls } = clientWith(() =>
      json(200, { data: { status: 'ok', database: 'ok' } }),
    )

    await client.GET('/api/v1/health')

    const headers = calls[0]?.headers
    assert.ok(headers)
    assert.equal(headers.has('origin'), false)
    assert.equal(headers.has('sec-fetch-site'), false)
    assert.equal(headers.has('x-csrf-token'), false)
  })

  test('X-Request-Id, X-Client-Version ve getHeaders başlıkları her isteğe eklenir', async () => {
    const { client, calls } = clientWith(() => json(200, { data: ME }), {
      clientVersion: '1.4.0',
      credentials: 'omit',
      getHeaders: async () => ({ Cookie: 'kampus.session_token=abc' }),
    })

    await client.GET('/api/v1/me')

    const headers = calls[0]?.headers
    assert.equal(headers?.get('x-request-id'), 'req-test')
    assert.equal(headers?.get('x-client-version'), '1.4.0')
    assert.equal(headers?.get('cookie'), 'kampus.session_token=abc')
    assert.equal(calls[0]?.credentials, 'omit')
  })

  test('istek kimliği üretici boş dönerse başlık eklenmez', async () => {
    const { client, calls } = clientWith(() => json(200, { data: ME }), {
      requestId: () => undefined,
    })

    await client.GET('/api/v1/me')

    assert.equal(calls[0]?.headers.has('x-request-id'), false)
  })

  test('unwrap gövdesiz başarıda undefined döner', async () => {
    assert.equal(unwrap<undefined>({ data: undefined, response: new Response(null) }), undefined)
  })

  test('unwrap kalan error alanını ApiError olarak fırlatır', () => {
    assert.throws(
      () =>
        unwrap({
          error: { code: 'not_found', message: 'İstenen kayıt bulunamadı.', requestId: 'r' },
          response: new Response(null, { status: 404 }),
        }),
      (error) => error instanceof ApiError && error.code === 'not_found' && error.status === 404,
    )
  })
})
