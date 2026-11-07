import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { ApiError } from '@kampus/api-client/errors.ts'

import {
  cacheActionFor,
  clearInstitutionCache,
  clearSessionData,
  createKampusQueryClient,
  DEFAULT_STALE_TIME_MS,
  shouldRetry,
} from '../src/query-client.ts'
import { institutionKey, ME_QUERY_KEY } from '../src/query-keys.ts'

function apiError(status: number, code = 'x'): ApiError {
  return new ApiError({ status, code, message: 'm' })
}

describe('shouldRetry', () => {
  test('401 ve diğer 4xx yeniden denenmez', () => {
    for (const status of [400, 401, 403, 404, 409, 422, 429]) {
      assert.equal(shouldRetry(0, apiError(status)), false, `status ${status}`)
    }
  })

  test('ağ hatası ve 5xx en fazla iki kez denenir', () => {
    for (const error of [apiError(0, 'network_error'), apiError(500), apiError(503)]) {
      assert.equal(shouldRetry(0, error), true)
      assert.equal(shouldRetry(1, error), true)
      assert.equal(shouldRetry(2, error), false)
    }
  })

  test('ApiError olmayan hata (programlama hatası) denenmez', () => {
    assert.equal(shouldRetry(0, new TypeError('x')), false)
  })
})

describe('createKampusQueryClient', () => {
  test('varsayılanlar: taze süre, retry ilkesi, mutasyonda yeniden deneme yok', () => {
    const defaults = createKampusQueryClient().getDefaultOptions()

    assert.equal(defaults.queries?.staleTime, DEFAULT_STALE_TIME_MS)
    assert.equal(defaults.queries?.retry, shouldRetry)
    assert.equal(defaults.mutations?.retry, false)
  })

  test('staleTimeMs ile değiştirilebilir', () => {
    assert.equal(
      createKampusQueryClient({ staleTimeMs: 5 }).getDefaultOptions().queries?.staleTime,
      5,
    )
  })

  test('401 alan sorgu onUnauthenticated çağırır, tek istek atar (yeniden deneme yok)', async () => {
    let unauthenticated = 0
    let calls = 0
    const queryClient = createKampusQueryClient({
      onUnauthenticated: () => {
        unauthenticated += 1
      },
    })

    await assert.rejects(
      queryClient.fetchQuery({
        queryKey: ME_QUERY_KEY,
        retry: shouldRetry,
        queryFn: () => {
          calls += 1
          return Promise.reject(apiError(401, 'unauthenticated'))
        },
      }),
    )

    assert.equal(calls, 1)
    assert.equal(unauthenticated, 1)
  })

  test('403 onUnauthenticated çağırmaz', async () => {
    let unauthenticated = 0
    const queryClient = createKampusQueryClient({
      onUnauthenticated: () => {
        unauthenticated += 1
      },
    })

    await assert.rejects(
      queryClient.fetchQuery({
        queryKey: institutionKey('a', 'x'),
        queryFn: () => Promise.reject(apiError(403, 'forbidden')),
      }),
    )

    assert.equal(unauthenticated, 0)
  })
})

describe('clearInstitutionCache', () => {
  test('kuruma bağlı sorguları siler, oturum sorgusunu korur', async () => {
    const queryClient = createKampusQueryClient()
    queryClient.setQueryData(ME_QUERY_KEY, { data: 'me' })
    queryClient.setQueryData(institutionKey('a', 'goals'), ['g1'])
    queryClient.setQueryData(institutionKey('b', 'goals'), ['g2'])

    await clearInstitutionCache(queryClient)

    assert.deepEqual(queryClient.getQueryData(ME_QUERY_KEY), { data: 'me' })
    assert.equal(queryClient.getQueryData(institutionKey('a', 'goals')), undefined)
    assert.equal(queryClient.getQueryData(institutionKey('b', 'goals')), undefined)
  })
})

describe('cacheActionFor', () => {
  const inA = { authenticated: true, userId: 'u1', institutionId: 'a' }
  const idle = { authenticated: false, userId: null, institutionId: null }

  test('oturum kapanınca her şey silinir', () => {
    assert.equal(cacheActionFor(inA, idle), 'clear-all')
  })

  test('arada unauthenticated görülmeden kullanıcı A→B olursa her şey silinir', () => {
    // Aynı kurum, authenticated true→true: yalnız kullanıcı kimliği değişir.
    assert.equal(cacheActionFor(inA, { ...inA, userId: 'u2' }), 'clear-all')
    assert.equal(cacheActionFor(inA, { ...inA, userId: 'u2', institutionId: 'b' }), 'clear-all')
  })

  test('aynı kullanıcıda yenilemede önbellek korunur', () => {
    assert.equal(cacheActionFor(inA, { ...inA }), 'none')
  })

  test('kurum değişince kuruma bağlı sorgular silinir', () => {
    assert.equal(cacheActionFor(inA, { ...inA, institutionId: 'b' }), 'clear-institution')
  })

  test('üyelik kalkıp etkin kurum kaybolursa kuruma bağlı sorgular silinir', () => {
    assert.equal(cacheActionFor(inA, { ...inA, institutionId: null }), 'clear-institution')
  })

  test('ilk girişte, ilk kurum atanırken ve boştayken dokunulmaz', () => {
    assert.equal(cacheActionFor(idle, inA), 'none')
    assert.equal(cacheActionFor({ ...inA, institutionId: null }, inA), 'none')
    assert.equal(cacheActionFor(idle, idle), 'none')
  })
})

describe('clearSessionData', () => {
  test('kuruma bağlı veriyi siler, oturum sorgusunu (/me) korur', async () => {
    const queryClient = createKampusQueryClient()
    queryClient.setQueryData(ME_QUERY_KEY, { user: { id: 'u1' } })
    queryClient.setQueryData(institutionKey('a', 'classes'), ['A sınıfı'])
    queryClient.setQueryData(institutionKey('a', 'grades'), ['A notu'])
    await clearSessionData(queryClient)
    assert.equal(queryClient.getQueryData(institutionKey('a', 'classes')), undefined)
    assert.equal(queryClient.getQueryData(institutionKey('a', 'grades')), undefined)
    assert.deepEqual(queryClient.getQueryData(ME_QUERY_KEY), { user: { id: 'u1' } })
  })
})
