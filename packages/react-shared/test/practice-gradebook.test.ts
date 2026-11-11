import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'

import {
  fetchPracticeGradebook,
  PRACTICE_GRADEBOOK_KEY,
  type PracticeGradebook,
} from '../src/practice-gradebook.ts'
import { institutionKey } from '../src/query-keys.ts'

// OG-085 (IST-056; DOM-BEC-048, DOM-BEC-041): alıştırma not defteri isteği, anahtarı ve veli reddi.

function fakeClient(reply: () => Response) {
  const sent: { method: string; path: string; search: string }[] = []
  const client = createKampusClient({
    baseUrl: 'https://api.kampus.test',
    credentials: 'include',
    requestId: () => undefined,
    fetch: async (input) => {
      const request = input instanceof Request ? input : new Request(input)
      const url = new URL(request.url)
      sent.push({ method: request.method, path: url.pathname, search: url.search })
      return reply()
    },
  })
  return { client, sent }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const tally = { items: 2, earned: 1, possible: 4, percent: 25 }
const breakdown = {
  sets: 1,
  overall: tally,
  units: [{ number: 3, title: 'Daily routines', sets: 1, ...tally }],
  skills: [{ skill: 'reading' as const, ...tally }],
  outcomes: [{ outcomeSource: 'platform' as const, outcomeId: 'ENG.9.3', ...tally }],
}
const book: PracticeGradebook = {
  assignments: [
    {
      id: '00000000-0000-4000-8000-0000a0000001',
      title: 'Ünite 3 alıştırması',
      unit: { number: 3, title: 'Daily routines' },
      learners: 1,
    },
  ],
  learners: [{ learnerId: 's1', learnerName: 'Deniz Yılmaz', ...breakdown }],
  totals: breakdown,
  truncated: false,
}

describe('alıştırma not defteri istemcisi', () => {
  test('DOM-BEC-048: not defteri hedef süzgeciyle okunur; ünite kırılımı döner', async () => {
    const { client, sent } = fakeClient(() => json(200, { data: book }))
    const body = await fetchPracticeGradebook(client, { targetId: '9-A' })
    assert.deepEqual(sent, [
      { method: 'GET', path: '/api/v1/practice-gradebook', search: '?targetId=9-A' },
    ])
    assert.deepEqual(body.data.totals.units[0], {
      number: 3,
      title: 'Daily routines',
      sets: 1,
      ...tally,
    })
    await fetchPracticeGradebook(client)
    assert.equal(sent[1]?.search, '')
  })

  test('DOM-BEC-041: veli 403 ApiError olarak döner', async () => {
    const { client } = fakeClient(() =>
      json(403, { code: 'forbidden', message: 'Bu işlem için yetkiniz yok.', requestId: 'r-1' }),
    )
    await assert.rejects(fetchPracticeGradebook(client), (error: unknown) => {
      assert.ok(error instanceof ApiError)
      assert.equal(error.status, 403)
      return true
    })
  })

  test('DOM-BEC-048: sorgu anahtarı kurumu ve süzgeci içerir', () => {
    assert.deepEqual(institutionKey('inst-a', ...PRACTICE_GRADEBOOK_KEY, { targetId: '9-A' }), [
      'inst',
      'inst-a',
      'practice-gradebook',
      { targetId: '9-A' },
    ])
  })
})
