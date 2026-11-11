import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError, isApiError } from '@kampus/api-client/errors.ts'

import { runRequest } from '../src/api-result.ts'
import {
  commandFeedback,
  commandHeaders,
  createCommandSession,
  runCommand,
} from '../src/commands.ts'
import {
  consentListKey,
  consentsPrefix,
  consentStatusKey,
  consentTextKey,
  consentTextListKey,
} from '../src/query-keys.ts'
import {
  CONSENT_MESSAGES,
  CONSENT_PAGE_SIZE,
  consentErrorMessage,
  consentStatusRequest,
  consentTextListRequest,
  consentTextQueries,
  consentTextRequest,
  giveConsentRequest,
  isConsentInlineError,
  listConsentsRequest,
  withdrawConsentRequest,
} from '../src/use-consents.ts'

interface Sent {
  method: string
  url: URL
  headers: Headers
  body: unknown
}

type Reply = { status: number; body: unknown }

/** Gerçek istemci + sahte fetch: giden istek kaydedilir, yanıtlar sırayla verilir (sonuncusu tekrarlanır). */
function fakeClient(replies: readonly Reply[] = [{ status: 200, body: { data: [] } }]) {
  const sent: Sent[] = []
  const client = createKampusClient({
    baseUrl: 'https://api.kampus.test',
    credentials: 'include',
    requestId: () => undefined,
    fetch: async (input) => {
      const request = input instanceof Request ? input : new Request(input)
      const text = await request.text()
      sent.push({
        method: request.method,
        url: new URL(request.url),
        headers: request.headers,
        body: text ? JSON.parse(text) : undefined,
      })
      const reply = replies[Math.min(sent.length - 1, replies.length - 1)]!
      return new Response(JSON.stringify(reply.body), {
        status: reply.status,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  return { client, sent }
}

const TEXT_ID = '8f0c7f2e-5b4f-4f64-9d63-0d1b3b9a5a11'
const CONSENT_ID = '2a6b3f1c-1d0e-4f5a-8b7c-9e8d7c6b5a40'

describe('açık rıza kancaları', () => {
  test('IST-017: güncel metin amaca göre, liste ve sonuç öğrenciyle istenir; liste tek sayfada ve geçmiş dahil', async () => {
    const { client, sent } = fakeClient()
    await runRequest(() => consentTextRequest(client, 'photo_video_sharing'))
    await runRequest(() => listConsentsRequest(client, { studentId: 's1' }))
    await runRequest(() => listConsentsRequest(client, { status: 'open' }))
    await runRequest(() => consentStatusRequest(client, { studentId: 's1' }))
    await runRequest(() => consentStatusRequest(client, {}))
    assert.deepEqual(
      sent.map((item) => [item.method, item.url.pathname, item.url.search]),
      [
        ['GET', '/api/v1/consent-texts/photo_video_sharing', ''],
        [
          'GET',
          '/api/v1/consents',
          `?page=1&pageSize=${CONSENT_PAGE_SIZE}&status=all&studentId=s1`,
        ],
        ['GET', '/api/v1/consents', `?page=1&pageSize=${CONSENT_PAGE_SIZE}&status=open`],
        ['GET', '/api/v1/consents/status', '?studentId=s1'],
        ['GET', '/api/v1/consents/status', ''],
      ],
    )
  })

  test('DOM-YTK-058: yayımlı metinler tek istekle (`GET /consent-texts`, süzgeçsiz) istenir; amaç başına istek yok', async () => {
    const { client, sent } = fakeClient()
    await runRequest(() => consentTextListRequest(client))
    assert.deepEqual(
      sent.map((item) => [item.method, item.url.pathname, item.url.search]),
      [['GET', '/api/v1/consent-texts', '']],
    )
    assert.deepEqual(consentTextListKey(), ['consents', 'texts'])
    // Rıza verilince `['consents']` önekiyle liste de tazelenir.
    assert.deepEqual(consentTextListKey().slice(0, 1), consentsPrefix())
  })

  test('DOM-YTK-058: liste amaç başına durumlara açılır; yayımlanmamış amaç hata nesnesiyle "metin yok", ek istek yok', () => {
    const item = (purpose: string, version: number) => ({
      text: { id: `text-${purpose}`, purpose, version },
      minimumVersion: 1,
    })
    const refetch = async () => undefined
    const loaded = {
      data: { data: [item('photo_video_sharing', 2), item('speaking_recording', 1)] },
      error: null,
      isError: false,
      isPending: false,
      refetch,
    } as unknown as Parameters<typeof consentTextQueries>[1]
    const [sharing, print, speaking] = consentTextQueries(
      ['photo_video_sharing', 'photo_video_print', 'speaking_recording'],
      loaded,
    )
    assert.equal(sharing?.data?.data.text.id, 'text-photo_video_sharing')
    assert.equal(sharing?.isError, false)
    assert.equal(sharing?.error, null)
    assert.equal(speaking?.data?.data.text.version, 1)
    assert.equal(print?.data, undefined)
    assert.equal(print?.isError, true)
    assert.ok(isApiError(print?.error))
    assert.equal(print?.error.code, 'consent_text_not_found')
    assert.equal(print?.error.status, 404)
    assert.equal(print?.error.message, CONSENT_MESSAGES.consent_text_not_found)
    assert.equal(print?.refetch, refetch)

    // Boş liste: her amaç "metin yok".
    const empty = consentTextQueries(['photo_video_sharing'], {
      ...loaded,
      data: { data: [] },
    } as unknown as Parameters<typeof consentTextQueries>[1])
    assert.equal(empty[0]?.error?.code, 'consent_text_not_found')

    // Yükleniyor: ne veri ne hata; bekleyen sorgu gibi.
    const pending = consentTextQueries(['photo_video_sharing'], {
      data: undefined,
      error: null,
      isError: false,
      isPending: true,
      refetch,
    })
    assert.equal(pending[0]?.isPending, true)
    assert.equal(pending[0]?.isError, false)
    assert.equal(pending[0]?.error, null)

    // Liste okunamadı: amaç "metin yok" değil, aynı okuma hatasını taşır.
    const failure = new ApiError({ status: 500, code: 'internal_error', message: 'Hata' })
    const failed = consentTextQueries(['photo_video_sharing', 'photo_video_print'], {
      data: undefined,
      error: failure,
      isError: true,
      isPending: false,
      refetch,
    })
    assert.deepEqual(
      failed.map((query) => [query.error?.code, query.isError]),
      [
        ['internal_error', true],
        ['internal_error', true],
      ],
    )
  })

  test('DOM-YTK-058: rıza gövdesi amaç, metin, kanal ve öğrenciyi taşır; karar varsayılan "granted", kurum kimliği yok', async () => {
    const { client, sent } = fakeClient([{ status: 201, body: { data: {} } }])
    await runRequest(() =>
      giveConsentRequest(
        client,
        { purpose: 'photo_video_sharing', studentId: 's1', textId: TEXT_ID },
        commandHeaders('key-12345'),
      ),
    )
    await runRequest(() =>
      giveConsentRequest(
        client,
        { purpose: 'promotional_messages', textId: TEXT_ID, channel: 'mobile' },
        commandHeaders('key-67890'),
      ),
    )
    assert.deepEqual(sent[0]?.body, {
      purpose: 'photo_video_sharing',
      textId: TEXT_ID,
      decision: 'granted',
      channel: 'web',
      studentId: 's1',
    })
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
    assert.equal(sent[0]?.headers.get('if-match'), null)
    // Hesap amacında `studentId` hiç gönderilmez (sunucu 400 verirdi).
    assert.deepEqual(sent[1]?.body, {
      purpose: 'promotional_messages',
      textId: TEXT_ID,
      decision: 'granted',
      channel: 'mobile',
    })
  })

  test('DOM-YTK-062: itiraz aynı uçtan "objected" kararıyla gönderilir', async () => {
    const { client, sent } = fakeClient([{ status: 201, body: { data: {} } }])
    await runRequest(() =>
      giveConsentRequest(
        client,
        { purpose: 'photo_video_print', studentId: 's1', textId: TEXT_ID, decision: 'objected' },
        commandHeaders('key-12345'),
      ),
    )
    assert.equal((sent[0]?.body as { decision: string }).decision, 'objected')
  })

  test('DOM-YTK-059: geri çekme kayıt yoluyla boş gövde ve istek anahtarıyla gider', async () => {
    const { client, sent } = fakeClient([{ status: 200, body: { data: {} } }])
    await runRequest(() => withdrawConsentRequest(client, CONSENT_ID, commandHeaders('key-12345')))
    assert.equal(sent[0]?.method, 'POST')
    assert.equal(sent[0]?.url.pathname, `/api/v1/consents/${CONSENT_ID}/withdraw`)
    assert.deepEqual(sent[0]?.body, {})
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
    assert.equal(sent[0]?.headers.get('if-match'), null)
  })

  test('IST-017: belirsiz hatadan sonra yeniden gönderim aynı Idempotency-Key ile gider; yeni karar yeni anahtar alır', async () => {
    const { client, sent } = fakeClient([
      { status: 503, body: { error: { code: 'unavailable', message: 'Geçici hata.' } } },
      { status: 201, body: { data: {} } },
    ])
    const session = createCommandSession()
    const steps = {
      execute: (
        input: { purpose: 'speaking_recording'; studentId: string; textId: string },
        h: ReturnType<typeof commandHeaders>,
      ) => runRequest(() => giveConsentRequest(client, input, h)),
      refresh: async () => {},
    }
    const input = { purpose: 'speaking_recording' as const, studentId: 's1', textId: TEXT_ID }
    const first = await runCommand(session, steps, input)
    assert.equal(first.status, 'failed')
    const second = await runCommand(session, steps, input)
    assert.equal(second.status, 'success')
    assert.equal(sent[0]?.headers.get('idempotency-key'), sent[1]?.headers.get('idempotency-key'))
    // Başarıdan sonraki yeni kullanıcı eylemi yeni anahtardır.
    await runCommand(session, steps, input)
    assert.notEqual(
      sent[1]?.headers.get('idempotency-key'),
      sent[2]?.headers.get('idempotency-key'),
    )
  })

  test('IST-017: hata kodları Türkçe kullanıcı iletisine eşlenir', () => {
    for (const code of [
      'consent_text_outdated',
      'consent_adult_self',
      'consent_exists',
      'consent_required',
    ] as const) {
      const error = new ApiError({ status: 409, code, message: 'sunucu iletisi' })
      assert.equal(consentErrorMessage(error), CONSENT_MESSAGES[code])
      assert.equal(commandFeedback(error, CONSENT_MESSAGES).message, CONSENT_MESSAGES[code])
    }
    assert.match(CONSENT_MESSAGES.consent_text_outdated, /güncellendi/)
    assert.match(CONSENT_MESSAGES.consent_adult_self, /18 yaşını/)
    // Tabloda olmayan kodda sunucunun Türkçe iletisi korunur.
    assert.equal(
      consentErrorMessage(new ApiError({ status: 403, code: 'x', message: 'Yetkiniz yok.' })),
      'Yetkiniz yok.',
    )
  })

  test('IST-017: 409 çakışma sorguları tazeler; güncel olmayan metin ve mükerrer rıza formda anlatılır', () => {
    const outdated = new ApiError({ status: 409, code: 'consent_text_outdated', message: 'x' })
    assert.equal(commandFeedback(outdated, CONSENT_MESSAGES).refresh, true)
    assert.equal(isConsentInlineError(outdated), true)
    assert.equal(
      isConsentInlineError(new ApiError({ status: 409, code: 'consent_exists', message: 'x' })),
      true,
    )
    assert.equal(
      isConsentInlineError(new ApiError({ status: 403, code: 'consent_adult_self', message: 'x' })),
      false,
    )
  })

  test('sorgu anahtarları tek önek altındadır; geçersiz kılma metin, liste ve sonucu birlikte kapsar', () => {
    const prefix = consentsPrefix()
    for (const key of [
      consentTextKey('photo_video_sharing'),
      consentListKey({ studentId: 's1', status: 'all' }),
      consentStatusKey({ studentId: 's1' }),
    ])
      assert.deepEqual(key.slice(0, prefix.length), prefix)
    assert.notDeepEqual(
      consentListKey({ studentId: 's1', status: 'all' }),
      consentListKey({ studentId: 's2', status: 'all' }),
    )
    assert.notDeepEqual(
      consentListKey({ status: 'all' }),
      consentListKey({ studentId: 's1', status: 'all' }),
    )
  })
})
