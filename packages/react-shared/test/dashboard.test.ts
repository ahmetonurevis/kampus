import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { QueryClient, QueryObserver } from '@tanstack/react-query'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'

import {
  dashboardKey,
  dashboardOfRole,
  dashboardQueryOptions,
  fetchDashboard,
  type Dashboard,
} from '../src/dashboard.ts'
import { institutionKey } from '../src/query-keys.ts'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const teacher = {
  role: 'ogretmen',
  today: '2026-10-06',
  students: { active: 12 },
  classes: { active: 3 },
  academic: null,
  learning: null,
} satisfies Dashboard

/** İstekleri kaydeden sahte istemci; yanıtı verilen işlev üretir. */
function fakeClient(respond: (url: URL) => Response) {
  const urls: URL[] = []
  const client = createKampusClient({
    baseUrl: 'https://api.kampus.test',
    credentials: 'include',
    requestId: () => undefined,
    fetch: async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      urls.push(url)
      return respond(url)
    },
  })
  return { client, urls }
}

describe('dashboardKey', () => {
  test('etkin kurum, rol ve seçili çocuk anahtardadır; boş çocuk null', () => {
    assert.deepEqual(
      dashboardKey('inst-a', 'veli', { studentId: 's2' }),
      institutionKey('inst-a', 'dashboard', 'veli', { studentId: 's2' }),
    )
    assert.deepEqual(dashboardKey('inst-a', 'yonetici'), dashboardKey('inst-a', 'yonetici', {}))
    assert.deepEqual(
      dashboardKey('inst-a', 'veli', { studentId: '' }),
      dashboardKey('inst-a', 'veli'),
    )
    assert.notDeepEqual(dashboardKey('inst-a', 'veli'), dashboardKey('inst-b', 'veli'))
    assert.notDeepEqual(dashboardKey('inst-a', 'ogrenci'), dashboardKey('inst-a', 'veli'))
  })
})

describe('fetchDashboard', () => {
  test('tek GET /api/v1/dashboard; studentId yalnız verilirse gider', async () => {
    const { client, urls } = fakeClient(() => json(200, { data: teacher }))
    assert.deepEqual(await fetchDashboard(client), teacher)
    await fetchDashboard(client, { studentId: 's2' })
    assert.equal(urls.length, 2)
    assert.equal(urls[0]?.pathname, '/api/v1/dashboard')
    assert.equal(urls[0]?.search, '')
    assert.equal(urls[1]?.searchParams.get('studentId'), 's2')
  })

  test('hata zarfı ApiError olur', async () => {
    const { client } = fakeClient(() =>
      json(404, { code: 'not_found', message: 'Kayıt bulunamadı.', requestId: 'r1' }),
    )
    await assert.rejects(fetchDashboard(client, { studentId: 's11' }), (error: unknown) => {
      assert.ok(error instanceof ApiError)
      assert.equal(error.status, 404)
      assert.equal(error.code, 'not_found')
      return true
    })
  })
})

describe('dashboardOfRole', () => {
  test('ekranın rolüyle eşleşmeyen özet null', () => {
    assert.equal(dashboardOfRole(teacher, 'ogretmen'), teacher)
    assert.equal(dashboardOfRole(teacher, 'yonetici'), null)
  })
})

describe('useDashboard sorgu seçenekleri', () => {
  test('her açılışta tazelenir; kurum bilinmeden veya enabled false iken istek atılmaz', () => {
    const { client } = fakeClient(() => json(200, { data: teacher }))
    const options = dashboardQueryOptions(client, 'inst-a', 'ogretmen')
    assert.equal(options.staleTime, 0)
    assert.equal(options.enabled, true)
    assert.deepEqual(options.queryKey, dashboardKey('inst-a', 'ogretmen'))
    assert.equal(dashboardQueryOptions(client, null, 'ogretmen').enabled, false)
    assert.equal(dashboardQueryOptions(client, 'inst-a', 'veli', {}, false).enabled, false)
  })

  test('gözlemci tek istek atar, veriyi role göre daraltır; yeniden bağlanınca tazeler', async () => {
    const { client, urls } = fakeClient(() => json(200, { data: teacher }))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const observe = async (role: 'ogretmen' | 'yonetici') => {
      const observer = new QueryObserver(queryClient, dashboardQueryOptions(client, 'inst-a', role))
      const result = await new Promise<ReturnType<typeof observer.getCurrentResult>>((resolve) => {
        const unsubscribe = observer.subscribe((value) => {
          if (value.status !== 'pending' && !value.isFetching) {
            unsubscribe()
            resolve(value)
          }
        })
      })
      return result
    }

    const first = await observe('ogretmen')
    assert.deepEqual(first.data, teacher)
    assert.equal(urls.length, 1)
    // `staleTime: 0`: aynı anahtarla yeniden gözlenince (sayfa yeniden açıldı) istek tekrarlanır.
    await observe('ogretmen')
    assert.equal(urls.length, 2)
    // Başka rolün anahtarı ayrıdır; dönen özet o rolün değilse veri `null`.
    const other = await observe('yonetici')
    assert.equal(other.data, null)
    queryClient.clear()
  })
})
