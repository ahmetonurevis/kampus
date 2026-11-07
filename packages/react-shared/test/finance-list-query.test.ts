import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

import { QueryClient, QueryObserver, type QueryObserverResult } from '@tanstack/react-query'

import { createKampusClient } from '@kampus/api-client/client.ts'

import { financeListQueryOptions } from '../src/use-finance-list-query.ts'
import { renewalListQuery } from '../src/use-finance-renewals.ts'

// ON-319 (IST-100): sayfalı kayıt ve finans listeleri sayfa değişince önceki sayfayı tutar; liste
// "yükleniyor"a düşmez. Seçenek kaynağı olan çağrılar (`keepPreviousPage: false`) yer tutucu almaz.

const INSTITUTION_ID = '00000000-0000-4000-8000-0000a0319001'

/** Sayfa başına bekleyen yanıt; istek ve test yanıtı hangi sırayla gelirse gelsin buluşur. */
function deferredClient() {
  const slots = new Map<number, { response: Promise<Response>; resolve: (r: Response) => void }>()
  const slot = (page: number) => {
    let entry = slots.get(page)
    if (!entry) {
      let resolve: (response: Response) => void = () => undefined
      const response = new Promise<Response>((done) => (resolve = done))
      entry = { response, resolve }
      slots.set(page, entry)
    }
    return entry
  }
  const paths: string[] = []
  const client = createKampusClient({
    baseUrl: 'https://api.kampus.test',
    credentials: 'include',
    requestId: () => undefined,
    fetch: (input) => {
      const request = input instanceof Request ? input : new Request(input)
      const url = new URL(request.url)
      paths.push(`${url.pathname}?${url.searchParams.toString()}`)
      return slot(Number(url.searchParams.get('page'))).response
    },
  })
  /** Sayfanın yanıtını verir; istek henüz atılmadıysa atıldığında bu yanıtı alır. */
  function answer(page: number) {
    slot(page).resolve(
      Response.json({
        success: true,
        data: [{ id: `renewal-${String(page)}` }],
        meta: { page, pageSize: 1, total: 2 },
      }),
    )
  }
  return { client, answer, paths }
}

/** Gözlemcinin sonucu koşulu sağlayana kadar bekler. */
function waitFor<TResult extends QueryObserverResult<unknown, unknown>>(
  observer: {
    getCurrentResult: () => TResult
    subscribe: (listener: (result: TResult) => void) => () => void
  },
  done: (result: TResult) => boolean,
): Promise<TResult> {
  const current = observer.getCurrentResult()
  if (done(current)) return Promise.resolve(current)
  return new Promise((resolve) => {
    const stop = observer.subscribe((result) => {
      if (!done(result)) return
      stop()
      resolve(result)
    })
  })
}

const queryClients: QueryClient[] = []
afterEach(() => {
  for (const queryClient of queryClients.splice(0)) queryClient.clear()
})

function setup(keepPreviousPage?: boolean) {
  const { client, answer, paths } = deferredClient()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClients.push(queryClient)
  const options = (page: number) =>
    financeListQueryOptions(
      client,
      INSTITUTION_ID,
      renewalListQuery({ page, pageSize: 1 }),
      keepPreviousPage === undefined ? {} : { keepPreviousPage },
    )
  const observer = new QueryObserver(queryClient, options(1))
  const unsubscribe = observer.subscribe(() => undefined)
  const goTo = (page: number) => observer.setOptions(options(page))
  return { observer, answer, paths, goTo, unsubscribe }
}

test('ON-319 IST-100: yenileme listesi sayfa değişince yeni yanıta kadar önceki sayfayı gösterir', async () => {
  const { observer, answer, paths, goTo, unsubscribe } = setup()
  answer(1)
  const first = await waitFor(observer, (result) => result.isSuccess)
  assert.deepEqual(first.data?.data, [{ id: 'renewal-1' }])

  goTo(2)
  const waiting = observer.getCurrentResult()
  assert.equal(waiting.isPlaceholderData, true)
  assert.equal(waiting.isPending, false, 'liste "yükleniyor"a düşmez')
  assert.equal(waiting.isFetching, true, 'ekran eski satırları soluk gösterir')
  assert.deepEqual(waiting.data?.data, [{ id: 'renewal-1' }])

  answer(2)
  const second = await waitFor(observer, (result) => !result.isPlaceholderData)
  assert.deepEqual(second.data?.data, [{ id: 'renewal-2' }])
  assert.deepEqual(paths, [
    '/api/v1/finance/renewals?page=1&pageSize=1',
    '/api/v1/finance/renewals?page=2&pageSize=1',
  ])
  unsubscribe()
})

test('ON-319: keepPreviousPage false olan çağrı anahtar değişince önceki yanıtı yer tutucu yapmaz', async () => {
  const { observer, answer, goTo, unsubscribe } = setup(false)
  answer(1)
  await waitFor(observer, (result) => result.isSuccess)

  goTo(2)
  const waiting = observer.getCurrentResult()
  assert.equal(waiting.isPlaceholderData, false)
  assert.equal(waiting.isPending, true)
  assert.equal(waiting.data, undefined)

  answer(2)
  const second = await waitFor(observer, (result) => result.isSuccess)
  assert.deepEqual(second.data?.data, [{ id: 'renewal-2' }])
  unsubscribe()
})

test('ON-319: etkin kurum yokken liste sorgusu kapalıdır, anahtar kurumla başlar', () => {
  const { client } = deferredClient()
  const closed = financeListQueryOptions(client, null, renewalListQuery({ page: 1, pageSize: 20 }))
  assert.equal(closed.enabled, false)
  const open = financeListQueryOptions(
    client,
    INSTITUTION_ID,
    renewalListQuery({ page: 1, pageSize: 20 }),
    { enabled: false },
  )
  assert.equal(open.enabled, false)
  assert.deepEqual(open.queryKey, [
    'inst',
    INSTITUTION_ID,
    'renewals',
    'list',
    { page: 1, pageSize: 20 },
  ])
  assert.equal('placeholderData' in open, true)
})
