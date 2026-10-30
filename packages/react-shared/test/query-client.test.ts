import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { ApiError } from '@kampus/api-client/errors.ts'

import {
  cacheActionFor,
  clearInstitutionCache,
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
  const inA = { authenticated: true, institutionId: 'a' }

  test('oturum kapanınca her şey silinir', () => {
    assert.equal(cacheActionFor(inA, { authenticated: false, institutionId: null }), 'clear-all')
  })

  test('kurum değişince kuruma bağlı sorgular silinir', () => {
    assert.equal(
      cacheActionFor(inA, { authenticated: true, institutionId: 'b' }),
      'clear-institution',
    )
  })

  test('üyelik kalkıp etkin kurum kaybolursa kuruma bağlı sorgular silinir', () => {
    assert.equal(
      cacheActionFor(inA, { authenticated: true, institutionId: null }),
      'clear-institution',
    )
  })

  test('değişiklik yoksa ve ilk kurum atanırken dokunulmaz', () => {
    assert.equal(cacheActionFor(inA, inA), 'none')
    assert.equal(
      cacheActionFor(
        { authenticated: true, institutionId: null },
        { authenticated: true, institutionId: 'a' },
      ),
      'none',
    )
    assert.equal(
      cacheActionFor(
        { authenticated: false, institutionId: null },
        { authenticated: false, institutionId: null },
      ),
      'none',
    )
  })
})
