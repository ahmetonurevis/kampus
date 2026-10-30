import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'

import { CollectionTooLargeError } from '../src/collections.ts'
import {
  auditListKey,
  auditListParams,
  fetchAllPages,
  fetchAuditPage,
  fetchMemberPage,
  memberListKey,
  memberListParams,
} from '../src/institution-lists.ts'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

/** İstekleri kaydeden, sayfa numarasına göre yanıt veren sahte istemci. */
function pagedClient(total: number, perPage = total) {
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
      const count = Math.max(0, Math.min(perPage, total - start))
      const data = Array.from({ length: count }, (_, index) => ({
        id: `r${start + index + 1}`,
        userId: `u${start + index + 1}`,
        name: 'Ad',
        email: 'ad@kampus.example',
        role: 'ogretmen',
        status: 'active',
        links: [],
        createdAt: '2026-10-01T09:00:00.000Z',
      }))
      return json(200, { data, meta: { page, pageSize, total } })
    },
  })
  return { client, urls }
}

describe('memberListParams', () => {
  test('kısa arama ve boş alanlar gönderilmez, arama kırpılır', () => {
    assert.deepEqual(memberListParams({ page: 1, pageSize: 25, q: ' a ' }), {
      page: 1,
      pageSize: 25,
    })
    assert.deepEqual(
      memberListParams({ page: 2, pageSize: 500, q: '  Selin ', role: 'ogretmen', sort: '-name' }),
      { page: 2, pageSize: 100, q: 'Selin', role: 'ogretmen', sort: '-name' },
    )
  })

  test('arama 100 karakterle sınırlanır (sunucu sınırı)', () => {
    const params = memberListParams({ q: 'a'.repeat(150) })
    assert.equal(params.q?.length, 100)
  })
})

describe('auditListParams', () => {
  test('yalnız dolu süzgeçler gider', () => {
    assert.deepEqual(auditListParams({ page: 1, pageSize: 25, dateFrom: '', entityType: '' }), {
      page: 1,
      pageSize: 25,
    })
    assert.deepEqual(
      auditListParams({
        dateFrom: '2026-10-01',
        dateTo: '2026-10-02',
        actorUserId: 'u1',
        entityType: 'module',
      }),
      { dateFrom: '2026-10-01', dateTo: '2026-10-02', actorUserId: 'u1', entityType: 'module' },
    )
  })
})

describe('sorgu anahtarları', () => {
  test('kullanıcıya bağlıdır; aynı anlamdaki sorgular aynı anahtarı üretir', () => {
    const left = memberListKey('u1', { q: 'selin', page: 1 })
    const right = memberListKey('u1', { page: 1, q: 'selin', status: undefined })
    assert.deepEqual(left, right)
    assert.notDeepEqual(left, memberListKey('u2', { q: 'selin', page: 1 }))
    assert.notDeepEqual(auditListKey('u1', {}), auditListKey('u2', {}))
    assert.deepEqual(memberListKey('u1', { q: 'x' }), memberListKey('u1', {}))
  })

  test('anahtar kökleri ayrıdır', () => {
    assert.equal(memberListKey('u1', {})[0], 'institution-members')
    assert.equal(auditListKey('u1', {})[0], 'audit-events')
  })
})

describe('fetchMemberPage ve fetchAuditPage', () => {
  test('liste ve meta döner, sorgu parametreleri uca gider', async () => {
    const { client, urls } = pagedClient(3)
    const page = await fetchMemberPage(client, { page: 1, pageSize: 25, role: 'ogretmen' })
    assert.equal(page.rows.length, 3)
    assert.equal(page.total, 3)
    assert.equal(urls[0]?.pathname, '/api/v1/institution-members')
    assert.equal(urls[0]?.searchParams.get('role'), 'ogretmen')
  })

  test('denetim ucu doğru yola gider', async () => {
    const urls: string[] = []
    const client = createKampusClient({
      baseUrl: 'https://api.kampus.test',
      credentials: 'include',
      requestId: () => undefined,
      fetch: async (input) => {
        urls.push(input instanceof Request ? input.url : String(input))
        return json(200, { data: [], meta: { page: 1, pageSize: 25, total: 0 } })
      },
    })
    const page = await fetchAuditPage(client, { dateFrom: '2026-10-01' })
    assert.deepEqual(page.rows, [])
    assert.match(urls[0] ?? '', /\/api\/v1\/audit-events\?dateFrom=2026-10-01$/)
  })

  test('sunucu hatası ApiError olarak fırlar', async () => {
    const client = createKampusClient({
      baseUrl: 'https://api.kampus.test',
      credentials: 'include',
      requestId: () => undefined,
      fetch: async () =>
        json(403, { code: 'forbidden', message: 'Bu işlem için yetkiniz yok.', requestId: 'r1' }),
    })
    await assert.rejects(
      () => fetchMemberPage(client, {}),
      (error) => error instanceof ApiError && error.status === 403,
    )
  })
})

describe('fetchAllPages', () => {
  test('toplam dolana kadar 100’lük sayfaları aynı süzgeçle çeker', async () => {
    const { client, urls } = pagedClient(230, 100)
    const rows = await fetchAllPages((query, signal) => fetchMemberPage(client, query, signal), {
      role: 'veli' as const,
    })
    assert.equal(rows.length, 230)
    assert.deepEqual(
      urls.map((url) => [url.searchParams.get('page'), url.searchParams.get('pageSize')]),
      [
        ['1', '100'],
        ['2', '100'],
        ['3', '100'],
      ],
    )
    assert.ok(urls.every((url) => url.searchParams.get('role') === 'veli'))
  })

  test('boş sayfa gelirse durur', async () => {
    const { client, urls } = pagedClient(0)
    assert.deepEqual(
      await fetchAllPages((query, signal) => fetchMemberPage(client, query, signal), {}),
      [],
    )
    assert.equal(urls.length, 1)
  })

  test('sayfa sınırı aşılırsa Türkçe hatayla durur', async () => {
    const { client } = pagedClient(1000, 100)
    await assert.rejects(
      () =>
        fetchAllPages((query, signal) => fetchMemberPage(client, query, signal), {}, undefined, 2),
      (error) =>
        error instanceof CollectionTooLargeError && error.message.includes('tamamı indirilemedi'),
    )
  })
})
