import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'

import {
  collectionCountParams,
  collectionCountsKey,
  collectionItemKey,
  collectionKeyPrefix,
  collectionListParams,
  collectionQueryKey,
  CollectionTooLargeError,
  countOf,
  fetchAllCollectionPages,
  fetchCollectionCounts,
  fetchCollectionItem,
  fetchCollectionPage,
  isModuleDisabledError,
  sumOf,
} from '../src/collections.ts'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const item = (id: string, record: Record<string, unknown> = {}) => ({
  id,
  version: 1,
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
  archivedAt: null,
  record: { id, ...record },
})

/** İstekleri kaydeden ve sayfa numarasına göre yanıt veren sahte istemci. */
function pagedClient(total: number, perPage = total, available = total) {
  const urls: URL[] = []
  const client = createKampusClient({
    baseUrl: 'https://api.kampus.test',
    credentials: 'include',
    requestId: () => undefined,
    fetch: async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      urls.push(url)
      const page = Number(url.searchParams.get('page') ?? 1)
      const pageSize = Number(url.searchParams.get('pageSize') ?? 25)
      const start = (page - 1) * perPage
      const count = Math.max(0, Math.min(perPage, available - start))
      const data = Array.from({ length: count }, (_, index) => item(`r${start + index + 1}`))
      return json(200, { data, meta: { page, pageSize, total } })
    },
  })
  return { client, urls }
}

describe('collectionListParams', () => {
  test('kısa arama, boş filtre ve boş sıralama gönderilmez', () => {
    assert.deepEqual(
      collectionListParams({ page: 1, pageSize: 8, q: ' 7 ', sort: [], filters: { branchId: '' } }),
      { page: 1, pageSize: 8 },
    )
  })

  test('arama kırpılır, sıralama virgülle birleşir ve en çok üç alan alınır', () => {
    assert.deepEqual(
      collectionListParams({
        q: ' 7-A ',
        sort: ['-grade', 'name', 'id', 'createdAt'],
        archived: 'only',
      }),
      { q: '7-A', sort: '-grade,name,id', archived: 'only' },
    )
  })

  test('çoklu filtre dizi, tekli filtre metin olur; sayfa boyutu 1–100 aralığına çekilir', () => {
    assert.deepEqual(
      collectionListParams({
        pageSize: 500,
        filters: { classId: ['c1', 'c2'], branchId: ['b1'], subjectId: 'math' },
      }),
      { pageSize: 100, classId: ['c1', 'c2'], branchId: 'b1', subjectId: 'math' },
    )
    assert.equal(collectionListParams({ pageSize: 0 }).pageSize, 1)
  })
})

describe('sorgu anahtarları', () => {
  test('aynı anlamdaki sorgular aynı anahtarı üretir', () => {
    assert.deepEqual(
      collectionQueryKey('classes', { q: '7', filters: { grade: '7', branchId: 'b1' } }),
      collectionQueryKey('classes', { filters: { branchId: 'b1', grade: '7' } }),
    )
  })

  test('farklı sayfa ve koleksiyon farklı anahtar üretir; önek ortaktır', () => {
    const first = collectionQueryKey('classes', { page: 1 })
    assert.notDeepEqual(first, collectionQueryKey('classes', { page: 2 }))
    assert.notDeepEqual(first, collectionQueryKey('teachers', { page: 1 }))
    assert.deepEqual(first.slice(0, 2), collectionKeyPrefix('classes'))
    assert.deepEqual(collectionItemKey('classes', 'c1').slice(0, 2), collectionKeyPrefix('classes'))
  })
})

describe('bağlı ad sıralaması', () => {
  test('studentName sıralaması sorguya yazılır', () => {
    assert.deepEqual(collectionListParams({ sort: ['-studentName', 'id'] }), {
      sort: '-studentName,id',
    })
  })
})

describe('fetchCollectionPage ve fetchCollectionItem', () => {
  test('sayfa satırlarını ve toplamı döndürür; parametreler sorguya yazılır', async () => {
    const { client, urls } = pagedClient(3)
    const page = await fetchCollectionPage(client, 'classes', {
      page: 1,
      pageSize: 8,
      q: 'Ka',
      sort: ['name'],
      filters: { branchId: ['b1', 'b2'] },
    })
    assert.equal(page.total, 3)
    assert.deepEqual(
      page.rows.map((row) => row.id),
      ['r1', 'r2', 'r3'],
    )
    const url = urls[0]!
    assert.equal(url.pathname, '/api/v1/collections/classes')
    assert.equal(url.searchParams.get('q'), 'Ka')
    assert.equal(url.searchParams.get('sort'), 'name')
    assert.deepEqual(url.searchParams.getAll('branchId'), ['b1', 'b2'])
  })

  test('tek kaydı döndürür; hata ApiError olarak fırlar', async () => {
    let status = 200
    const client = createKampusClient({
      baseUrl: 'https://api.kampus.test',
      credentials: 'include',
      requestId: () => undefined,
      fetch: async () =>
        status === 200
          ? json(200, { data: item('c1', { name: '7-A' }) })
          : json(status, { code: 'module_disabled', message: 'Modül kapalı.' }),
    })
    const row = await fetchCollectionItem<{ name: string }>(client, 'classes', 'c1')
    assert.equal(row.record.name, '7-A')

    status = 403
    await assert.rejects(
      () => fetchCollectionItem(client, 'classes', 'c1'),
      (error) => error instanceof ApiError && isModuleDisabledError(error),
    )
  })
})

describe('toplu sayım', () => {
  test('parametreler liste süzgeçleriyle aynı biçimde kurulur; kısa arama gönderilmez', () => {
    assert.deepEqual(
      collectionCountParams({
        groupBy: 'status',
        sum: 'amount',
        q: 'Deniz',
        filters: { studentId: ['s1', 's2'], classId: '' },
      }),
      { groupBy: 'status', sum: 'amount', q: 'Deniz', studentId: ['s1', 's2'] },
    )
    assert.deepEqual(collectionCountParams({ groupBy: 'isActive', q: 'D' }), {
      groupBy: 'isActive',
    })
  })

  test('tarih aralığı, aylık gruplama ve doluluk süzgeçleri parametre ve anahtara girer', () => {
    const query = {
      groupBy: 'paidAt:month',
      sum: 'amount',
      filters: { dateField: 'paidAt', dateFrom: '2026-05-01', dateTo: '2026-10-30' },
    } as const
    assert.deepEqual(collectionCountParams(query), {
      groupBy: 'paidAt:month',
      sum: 'amount',
      dateField: 'paidAt',
      dateFrom: '2026-05-01',
      dateTo: '2026-10-30',
    })
    // Aralık değişince anahtar da değişir: önbellek eski aralığı yeni sorguya vermez.
    const shifted = collectionCountsKey('invoices', {
      ...query,
      filters: { ...query.filters, dateTo: '2026-10-31' },
    })
    assert.notDeepEqual(collectionCountsKey('invoices', query), shifted)

    assert.deepEqual(
      collectionListParams({
        filters: { cancelled: 'false', graded: 'true', dateFrom: '2026-10-30' },
      }),
      { cancelled: 'false', graded: 'true', dateFrom: '2026-10-30' },
    )
    assert.notDeepEqual(
      collectionQueryKey('schedule', { filters: { cancelled: 'true' } }),
      collectionQueryKey('schedule', { filters: { cancelled: 'false' } }),
    )
  })

  test('sayım anahtarı liste önekinin altındadır ve süzgeç sırasından bağımsızdır', () => {
    const left = collectionCountsKey('invoices', {
      groupBy: 'status',
      filters: { studentId: 's1', classId: 'c1' },
    })
    const right = collectionCountsKey('invoices', {
      groupBy: 'status',
      filters: { classId: 'c1', studentId: 's1' },
    })
    assert.deepEqual(left, right)
    assert.deepEqual(left.slice(0, 2), collectionKeyPrefix('invoices'))
  })

  test('gruplar, toplam ve tutar toplamı döner; sum yoksa alan yoktur', async () => {
    const urls: URL[] = []
    const client = createKampusClient({
      baseUrl: 'https://api.kampus.test',
      credentials: 'include',
      requestId: () => undefined,
      fetch: async (input) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        urls.push(url)
        const withSum = url.searchParams.has('sum')
        return json(200, {
          data: [
            { value: 'Gecikmiş', count: 2, ...(withSum ? { sum: 4900000 } : {}) },
            { value: 'Ödendi', count: 3, ...(withSum ? { sum: 7350000 } : {}) },
          ],
          meta: { total: 5, ...(withSum ? { sum: 12250000 } : {}) },
        })
      },
    })
    const counts = await fetchCollectionCounts(client, 'invoices', {
      groupBy: 'status',
      sum: 'amount',
      q: 'Deniz',
    })
    assert.equal(urls[0]!.pathname, '/api/v1/collections/invoices/counts')
    assert.equal(urls[0]!.searchParams.get('groupBy'), 'status')
    assert.equal(urls[0]!.searchParams.get('sum'), 'amount')
    assert.equal(counts.total, 5)
    assert.equal(counts.sum, 12250000)
    assert.deepEqual(counts.groups[0], { value: 'Gecikmiş', count: 2, sum: 4900000 })

    const plain = await fetchCollectionCounts(client, 'invoices', { groupBy: 'status' })
    assert.equal('sum' in plain, false)
  })
})

describe('countOf ve sumOf', () => {
  const counts = {
    groups: [
      { value: 'Gecikmiş', count: 2, sum: 500 },
      { value: true, count: 4 },
      { value: null, count: 1 },
    ],
    total: 7,
  }

  test('grup değerini metin olarak karşılaştırır', () => {
    assert.equal(countOf(counts, 'Gecikmiş'), 2)
    assert.equal(sumOf(counts, 'Gecikmiş'), 500)
    assert.equal(countOf(counts, true), 4)
    assert.equal(sumOf(counts, true), 0)
  })

  test('olmayan grup, null grubu ve veri yokken 0 döner', () => {
    assert.equal(countOf(counts, 'Ödendi'), 0)
    assert.equal(countOf(counts, 'null'), 0)
    assert.equal(countOf(undefined, 'Ödendi'), 0)
    assert.equal(sumOf(undefined, 'Ödendi'), 0)
  })
})

describe('fetchAllCollectionPages', () => {
  test('toplam dolana kadar 100’lük sayfaları sırayla çeker', async () => {
    const { client, urls } = pagedClient(230, 100)
    const rows = await fetchAllCollectionPages(client, 'students', { sort: ['name'] })
    assert.equal(rows.length, 230)
    assert.deepEqual(
      urls.map((url) => [url.searchParams.get('page'), url.searchParams.get('pageSize')]),
      [
        ['1', '100'],
        ['2', '100'],
        ['3', '100'],
      ],
    )
    assert.ok(urls.every((url) => url.searchParams.get('sort') === 'name'))
  })

  test('boş sayfa gelirse durur (okuma sırasında silinen kayıt)', async () => {
    // Toplam 150 bildirilir ama kayıtların bir kısmı ikinci sayfa okunurken silinmiştir.
    const { client, urls } = pagedClient(150, 100, 100)
    const rows = await fetchAllCollectionPages(client, 'students', {})
    assert.equal(rows.length, 100)
    assert.equal(urls.length, 2)

    const shrinking = pagedClient(0)
    assert.deepEqual(await fetchAllCollectionPages(shrinking.client, 'students', {}), [])
    assert.equal(shrinking.urls.length, 1)
  })

  test('sayfa sınırı aşılırsa Türkçe hatayla durur', async () => {
    const { client } = pagedClient(1000, 100)
    await assert.rejects(
      () => fetchAllCollectionPages(client, 'grades', {}, undefined, 2),
      (error) =>
        error instanceof CollectionTooLargeError && error.message.includes('tamamı indirilemedi'),
    )
  })
})

describe('isModuleDisabledError', () => {
  test('yalnız 403 module_disabled ApiError için doğrudur', () => {
    assert.equal(
      isModuleDisabledError(new ApiError({ status: 403, code: 'module_disabled', message: 'x' })),
      true,
    )
    assert.equal(
      isModuleDisabledError(new ApiError({ status: 403, code: 'forbidden', message: 'x' })),
      false,
    )
    assert.equal(isModuleDisabledError({ status: 403, code: 'module_disabled' }), false)
  })
})
