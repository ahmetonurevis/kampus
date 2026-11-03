import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'

import { fetchFileUrl } from '../src/files.ts'
import {
  allowanceOf,
  LISTENING_FAILED_MESSAGE,
  LISTENING_LINK_MARGIN_MS,
  LISTENING_MESSAGES,
  linkUsable,
  listeningAllowance,
  listeningCounterText,
  listeningErrorCode,
  listeningErrorMessage,
  numberWithSuffix,
} from '../src/listening.ts'

// Dinleme etkinliği (OG-052; IST-045, DOM-BEC-005): bağlantı isteği öğrencinin süren denemesinde
// `attemptId` taşır, hak deneme × kayıt başına sayılır; kalan hak, sayaç metni, bağlantının
// yeniden kullanılması ve hata metinleri.

function fakeClient(reply: (url: URL) => Response) {
  const urls: URL[] = []
  const client = createKampusClient({
    baseUrl: 'https://api.kampus.test',
    credentials: 'include',
    requestId: () => undefined,
    fetch: async (input) => {
      const request = input instanceof Request ? input : new Request(input)
      const url = new URL(request.url)
      urls.push(url)
      return reply(url)
    },
  })
  return { client, urls }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const grant = {
  attemptId: '00000000-0000-4000-8000-000000000001',
  limit: 2,
  used: 1,
  remaining: 1,
  counted: true,
}

describe('dinleme kaydı bağlantısı (IST-045)', () => {
  test('DOM-BEC-005: süren denemede bağlantı attemptId ile istenir, sayım yanıtta döner', async () => {
    const { client, urls } = fakeClient(() =>
      json(200, {
        data: { url: 'https://cdn.test/a', expiresAt: '2026-11-03T10:05:00Z', listening: grant },
      }),
    )
    const link = await fetchFileUrl(client, 'file-1', { attemptId: grant.attemptId })
    assert.equal(urls[0]?.pathname, '/api/v1/files/file-1/url')
    assert.equal(urls[0]?.searchParams.get('attemptId'), grant.attemptId)
    assert.deepEqual(link.listening, grant)
    assert.deepEqual(allowanceOf(grant), { limit: 2, used: 1, remaining: 1 })
  })

  test('DOM-BEC-005: sonuç ekranında ve personelde attemptId gönderilmez', async () => {
    const { client, urls } = fakeClient(() =>
      json(200, {
        data: { url: 'https://cdn.test/a', expiresAt: '2026-11-03T10:05:00Z', listening: null },
      }),
    )
    await fetchFileUrl(client, 'file-1')
    await fetchFileUrl(client, 'file-1', { attemptId: undefined })
    assert.equal(urls.length, 2)
    for (const url of urls) assert.equal(url.searchParams.has('attemptId'), false)
  })

  test('DOM-BEC-005: hak bitince 422 listening_plays_exhausted Türkçe metne çevrilir', async () => {
    const { client } = fakeClient(() =>
      json(422, {
        code: 'listening_plays_exhausted',
        message: 'Sunucu metni',
        requestId: 'r1',
      }),
    )
    await assert.rejects(
      () => fetchFileUrl(client, 'file-1', { attemptId: grant.attemptId }),
      (error: unknown) => {
        assert.equal(listeningErrorCode(error), 'listening_plays_exhausted')
        assert.equal(listeningErrorMessage(error), 'Bu kaydın dinleme hakkı doldu.')
        return true
      },
    )
  })
})

describe('dinleme hata metinleri', () => {
  const error = (status: number, code: string) =>
    new ApiError({ status, code, message: 'Teknik ayrıntı' })

  test('IST-045: bilinen kodlar Türkçe, teknik ayrıntısız', () => {
    for (const [code, message] of Object.entries(LISTENING_MESSAGES)) {
      assert.equal(listeningErrorMessage(error(422, code)), message)
      assert.doesNotMatch(message, /listening_|attempt|Teknik/)
    }
    assert.match(
      listeningErrorMessage(error(422, 'listening_attempt_required')),
      /yalnız denemenin içinde/,
    )
    assert.match(listeningErrorMessage(error(422, 'listening_attempt_closed')), /sona erdi/)
    assert.match(listeningErrorMessage(error(422, 'listening_attempt_mismatch')), /bu göreve ait/)
  })

  test('IST-045: bilinmeyen kod ve ağ hatası genel metindir', () => {
    assert.equal(listeningErrorCode(error(500, 'internal')), null)
    assert.equal(listeningErrorMessage(error(500, 'internal')), LISTENING_FAILED_MESSAGE)
    assert.equal(listeningErrorMessage(new TypeError('fetch failed')), LISTENING_FAILED_MESSAGE)
    // Nesne prototipindeki adlar kod sayılmaz.
    assert.equal(listeningErrorCode(error(422, 'toString')), null)
  })
})

describe('kalan dinleme hakkı (DOM-BEC-005)', () => {
  const listening = {
    limit: 2,
    media: [{ fileId: 'file-1', used: 1, remaining: 1 }],
  }

  test('DOM-BEC-005: kaydın sayımı deneme ayrıntısından okunur; dinlenmemiş kayıtta hak tamdır', () => {
    assert.deepEqual(listeningAllowance(listening, 'file-1'), { limit: 2, used: 1, remaining: 1 })
    assert.deepEqual(listeningAllowance(listening, 'file-2'), { limit: 2, used: 0, remaining: 2 })
  })

  test('DOM-BEC-005: sınırsız hakta sayaç yoktur', () => {
    assert.equal(listeningAllowance(null, 'file-1'), null)
  })

  test('DOM-BEC-005: sayaç metni kalan hakkı Türkçe ekle yazar', () => {
    assert.equal(
      listeningCounterText({ limit: 2, used: 1, remaining: 1 }),
      "2 dinleme hakkından 1'i kaldı.",
    )
    assert.equal(
      listeningCounterText({ limit: 2, used: 0, remaining: 2 }),
      '2 dinleme hakkınız var.',
    )
    assert.equal(
      listeningCounterText({ limit: 1, used: 0, remaining: 1 }),
      '1 dinleme hakkınız var.',
    )
    assert.equal(
      listeningCounterText({ limit: 1, used: 1, remaining: 0 }),
      'Dinleme hakkınız doldu.',
    )
    assert.equal(
      listeningCounterText({ limit: 3, used: 1, remaining: 2 }),
      "3 dinleme hakkından 2'si kaldı.",
    )
  })

  test('sayı ekleri ünlü uyumuna uyar', () => {
    const cases: [number, string][] = [
      [0, "0'ı"],
      [1, "1'i"],
      [2, "2'si"],
      [3, "3'ü"],
      [4, "4'ü"],
      [5, "5'i"],
      [6, "6'sı"],
      [7, "7'si"],
      [8, "8'i"],
      [9, "9'u"],
      [10, "10'u"],
      [20, "20'si"],
      [30, "30'u"],
      [40, "40'ı"],
      [50, "50'si"],
      [60, "60'ı"],
      [70, "70'i"],
      [80, "80'i"],
      [90, "90'ı"],
      [100, "100'ü"],
      [1000, "1000'i"],
      [1100, "1100'ü"],
      [21, "21'i"],
    ]
    for (const [value, text] of cases) assert.equal(numberWithSuffix(value), text)
  })
})

describe('dinleme bağlantısının yeniden kullanılması', () => {
  const now = Date.parse('2026-11-03T10:00:00Z')

  test('DOM-BEC-005: geçerli bağlantı yeniden kullanılır, yeni istek atılmaz', () => {
    assert.equal(linkUsable({ expiresAt: '2026-11-03T10:05:00Z' }, now), true)
  })

  test('DOM-BEC-005: süresi dolan ya da dolmak üzere olan bağlantı yeniden istenir', () => {
    assert.equal(linkUsable(null, now), false)
    assert.equal(linkUsable({ expiresAt: '2026-11-03T09:59:00Z' }, now), false)
    const edge = new Date(now + LISTENING_LINK_MARGIN_MS).toISOString()
    assert.equal(linkUsable({ expiresAt: edge }, now), false)
    const after = new Date(now + LISTENING_LINK_MARGIN_MS + 1).toISOString()
    assert.equal(linkUsable({ expiresAt: after }, now), true)
    assert.equal(linkUsable({ expiresAt: 'geçersiz' }, now), false)
  })
})
