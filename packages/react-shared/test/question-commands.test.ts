import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'

import { runRequest } from '../src/api-result.ts'
import { commandHeaders, IF_MATCH_MISSING_CODE } from '../src/commands.ts'
import {
  answerQuestionRequest,
  askQuestionRequest,
  QUESTION_CHANGED_MESSAGE,
  QUESTION_MESSAGES,
  withdrawQuestionRequest,
} from '../src/use-question-commands.ts'

interface Sent {
  method: string
  path: string
  headers: Headers
  body: unknown
}

/** Gerçek istemci + sahte fetch: giden istek kaydedilir, yanıt sabittir. */
function fakeClient() {
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
        path: new URL(request.url).pathname,
        headers: request.headers,
        body: text ? JSON.parse(text) : undefined,
      })
      return new Response(
        JSON.stringify({
          data: {
            entity: { collection: 'questions', id: 'ask-1' },
            changes: { inserted: 1, updated: 0, archived: 0, restored: 0 },
            records: [],
          },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      )
    },
  })
  return { client, sent }
}

const question = {
  subjectId: 'math',
  title: 'Denklem çözümü',
  text: '2x + 6 = 18 denkleminde neden önce 6 çıkarıyoruz?',
}

describe('Öğretmenime Sor komutları', () => {
  test('DOM-ILT-090: soru gönderme POST ile anahtar taşır, If-Match taşımaz', async () => {
    const { client, sent } = fakeClient()
    await runRequest(() => askQuestionRequest(client, question, commandHeaders('key-12345', 3)))
    assert.equal(sent.length, 1)
    assert.equal(`${sent[0]?.method} ${sent[0]?.path}`, 'POST /api/v1/questions')
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
    assert.equal(sent[0]?.headers.get('if-match'), null)
    assert.deepEqual(sent[0]?.body, question)
  })

  test('DOM-ILT-092: yanıt POST /answers ile okunan sürümü If-Match olarak taşır', async () => {
    const { client, sent } = fakeClient()
    const body = { text: 'İki taraftan aynı sayıyı çıkarınca denge bozulmaz.' }
    await runRequest(() =>
      answerQuestionRequest(
        client,
        { questionId: 'ask 1', version: 4, body },
        commandHeaders('key-12345', 4),
      ),
    )
    assert.equal(sent[0]?.method, 'POST')
    assert.equal(sent[0]?.path, '/api/v1/questions/ask%201/answers')
    assert.equal(sent[0]?.headers.get('if-match'), '"4"')
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
    assert.deepEqual(sent[0]?.body, body)
  })

  test('DOM-ILT-091: geri çekme PATCH ile yalnız { withdrawn: true } ve If-Match gönderir', async () => {
    const { client, sent } = fakeClient()
    await runRequest(() =>
      withdrawQuestionRequest(
        client,
        { questionId: 'ask1', version: 2 },
        commandHeaders('key-12345', 2),
      ),
    )
    assert.equal(`${sent[0]?.method} ${sent[0]?.path}`, 'PATCH /api/v1/questions/ask1')
    assert.equal(sent[0]?.headers.get('if-match'), '"2"')
    assert.deepEqual(sent[0]?.body, { withdrawn: true })
  })

  test('DOM-ILT-091, DOM-ILT-092: okunan sürüm yoksa yanıt ve geri çekme isteği atılmaz', async () => {
    const { client, sent } = fakeClient()
    const missing = (error: unknown) =>
      error instanceof Error && 'code' in error && error.code === IF_MATCH_MISSING_CODE
    const headers = commandHeaders('key-12345')
    await assert.rejects(
      runRequest(() =>
        answerQuestionRequest(
          client,
          { questionId: 'ask1', version: 1, body: { text: 'Yanıt metni.' } },
          headers,
        ),
      ),
      missing,
    )
    await assert.rejects(
      runRequest(() =>
        withdrawQuestionRequest(client, { questionId: 'ask1', version: 1 }, headers),
      ),
      missing,
    )
    assert.equal(sent.length, 0)
  })

  test('sürüm çakışması kullanıcıya güncel soruyu yükleme mesajı verir', () => {
    assert.equal(QUESTION_MESSAGES.version_conflict, QUESTION_CHANGED_MESSAGE)
  })

  test('DOM-ILT-094: taranan ve reddedilen fotoğraf Türkçe iletiyle döner (IST-027)', () => {
    assert.match(QUESTION_MESSAGES.file_not_ready, /güvenlik taramasında/)
    assert.match(QUESTION_MESSAGES.file_rejected, /Başka bir dosya yükleyin/)
  })
})
