import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'

import {
  ACADEMIC_YEAR_CHANGED_MESSAGE,
  ACADEMIC_YEAR_MESSAGES,
  ACADEMIC_YEARS_KEY,
  activateAcademicYearRequest,
  addAcademicTermRequest,
  closeAcademicYearRequest,
  createAcademicYearRequest,
  removeAcademicTermRequest,
  updateAcademicTermRequest,
  updateAcademicYearRequest,
  yearVersion,
} from '../src/academic-years.ts'
import { runRequest } from '../src/api-result.ts'
import {
  commandFeedback,
  commandHeaders,
  createCommandSession,
  runCommand,
} from '../src/commands.ts'

// IST-011 (DOM-YTK-063…066): eğitim yılı istekleri, If-Match / Idempotency-Key ve Türkçe hata metinleri.

interface Sent {
  method: string
  path: string
  headers: Headers
  body: unknown
}

function fakeClient(reply: () => Response) {
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
      return reply()
    },
  })
  return { client, sent }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
const year = {
  data: {
    startYear: 2027,
    name: '2027–2028',
    startDate: '2027-09-01',
    endDate: '2028-08-31',
    isActive: false,
    status: 'planned',
    activatedAt: null,
    closedAt: null,
    rowVersion: 3,
    updatedAt: '2026-11-02T08:00:00.000Z',
    terms: [],
  },
}
const failure = (status: number, code: string, message = 'Sunucu mesajı.') =>
  json(status, { code, message, requestId: 'r1' })
const TERM = '0f0e1d2c-3b4a-4c5d-8e6f-7a8b9c0d1e2f'

describe('eğitim yılı istekleri', () => {
  test('oluşturma Idempotency-Key taşır, If-Match göndermez (DOM-YTK-063)', async () => {
    const { client, sent } = fakeClient(() => json(201, year))
    await runRequest(() =>
      createAcademicYearRequest(
        client,
        {
          startYear: 2027,
          terms: [{ name: '1. Dönem', startDate: '2027-09-13', endDate: '2028-01-21' }],
        },
        commandHeaders('key-12345', 9),
      ),
    )
    assert.equal(sent[0]?.method, 'POST')
    assert.equal(sent[0]?.path, '/api/v1/academic-years')
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
    assert.equal(sent[0]?.headers.get('if-match'), null)
    assert.deepEqual(sent[0]?.body, {
      startYear: 2027,
      terms: [{ name: '1. Dönem', startDate: '2027-09-13', endDate: '2028-01-21' }],
    })
  })

  test('yıl güncelleme başlangıç yılını yola, tarihleri gövdeye, sürümü If-Match a koyar', async () => {
    const { client, sent } = fakeClient(() => json(200, year))
    await runRequest(() =>
      updateAcademicYearRequest(
        client,
        { startYear: 2027, version: 3, body: { endDate: '2028-08-30' } },
        commandHeaders('key-12345', 3),
      ),
    )
    assert.equal(sent[0]?.method, 'PATCH')
    assert.equal(sent[0]?.path, '/api/v1/academic-years/2027')
    assert.equal(sent[0]?.headers.get('if-match'), '"3"')
    assert.deepEqual(sent[0]?.body, { endDate: '2028-08-30' })
  })

  test('dönem ekle, değiştir ve kaldır doğru yol ve yöntemle gider (DOM-YTK-064)', async () => {
    const { client, sent } = fakeClient(() => json(200, year))
    const headers = commandHeaders('key-12345', 3)
    const target = { startYear: 2027, version: 3 }
    await runRequest(() =>
      addAcademicTermRequest(
        client,
        { ...target, body: { name: '2. Dönem', startDate: '2028-02-05', endDate: '2028-06-20' } },
        headers,
      ),
    )
    await runRequest(() =>
      updateAcademicTermRequest(
        client,
        { ...target, termId: TERM, body: { name: 'Güz' } },
        headers,
      ),
    )
    await runRequest(() => removeAcademicTermRequest(client, { ...target, termId: TERM }, headers))
    assert.deepEqual(
      sent.map((item) => `${item.method} ${item.path}`),
      [
        'POST /api/v1/academic-years/2027/terms',
        `PATCH /api/v1/academic-years/2027/terms/${TERM}`,
        `DELETE /api/v1/academic-years/2027/terms/${TERM}`,
      ],
    )
    assert.ok(sent.every((item) => item.headers.get('if-match') === '"3"'))
    assert.equal(sent[2]?.body, undefined)
  })

  test('etkinleştirme ve kapatma boş nesneyle gider (DOM-YTK-065, -066)', async () => {
    const { client, sent } = fakeClient(() => json(200, year))
    const headers = commandHeaders('key-12345', 3)
    await runRequest(() =>
      activateAcademicYearRequest(client, { startYear: 2027, version: 3 }, headers),
    )
    await runRequest(() =>
      closeAcademicYearRequest(client, { startYear: 2026, version: 4 }, headers),
    )
    assert.deepEqual(
      sent.map((item) => `${item.method} ${item.path}`),
      ['POST /api/v1/academic-years/2027/activate', 'POST /api/v1/academic-years/2026/close'],
    )
    assert.deepEqual(sent[0]?.body, {})
    assert.deepEqual(sent[1]?.body, {})
  })

  test('sürümsüz sürümlü istek atılmaz', async () => {
    const { client, sent } = fakeClient(() => json(200, year))
    await assert.rejects(
      () =>
        runRequest(() =>
          activateAcademicYearRequest(
            client,
            { startYear: 2027, version: 3 },
            commandHeaders('key-12345'),
          ),
        ),
      (error: unknown) => error instanceof ApiError && error.code === 'if_match_missing',
    )
    assert.equal(sent.length, 0)
  })

  test('yearVersion personel sürümünü verir, öğrenci yanıtında null', () => {
    assert.equal(yearVersion({ rowVersion: 4 }), 4)
    assert.equal(yearVersion({}), null)
  })

  test('sorgu anahtarı kökü sabittir', () => {
    assert.deepEqual([...ACADEMIC_YEARS_KEY], ['academic-years'])
  })
})

describe('eğitim yılı hata metinleri', () => {
  const cases: [string, number, string][] = [
    ['version_conflict', 409, ACADEMIC_YEAR_CHANGED_MESSAGE],
    ['academic_year_activation_too_early', 422, 'en çok 60 gün önce'],
    ['academic_term_overlap', 422, 'başka bir dönemiyle çakışıyor'],
    ['academic_term_name_exists', 409, 'aynı adlı bir dönem'],
    ['academic_year_closed', 409, 'Kapanmış eğitim yılı'],
    ['academic_terms_required', 422, 'en az bir dönemi'],
  ]
  for (const [code, status, expected] of cases)
    test(`${code} Türkçe mesaja eşlenir`, () => {
      const feedback = commandFeedback(
        new ApiError({ status, code, message: 'İngilizce ya da teknik' }),
        ACADEMIC_YEAR_MESSAGES,
      )
      assert.ok(feedback.message?.includes(expected), feedback.message ?? 'mesaj yok')
    })

  test('409 version_conflict listeyi tazeler; 422 tazelemez', () => {
    const conflict = commandFeedback(
      new ApiError({ status: 409, code: 'version_conflict', message: 'x' }),
      ACADEMIC_YEAR_MESSAGES,
    )
    const rule = commandFeedback(
      new ApiError({ status: 422, code: 'academic_year_activation_too_early', message: 'x' }),
      ACADEMIC_YEAR_MESSAGES,
    )
    assert.equal(conflict.refresh, true)
    assert.equal(rule.refresh, false)
  })

  test('tanınmayan kodda sunucunun mesajı kalır (örtüşen yılın adı)', () => {
    const feedback = commandFeedback(
      new ApiError({
        status: 422,
        code: 'academic_year_overlap',
        message: 'Tarihler 2026–2027 eğitim yılıyla çakışıyor.',
      }),
      ACADEMIC_YEAR_MESSAGES,
    )
    assert.equal(feedback.message, 'Tarihler 2026–2027 eğitim yılıyla çakışıyor.')
  })
})

describe('eğitim yılı komut akışı', () => {
  test('etkinleştirme 422 hatasında Türkçe mesaj verir ve aynı oturumda yeniden denenebilir', async () => {
    let calls = 0
    const { client, sent } = fakeClient(() => {
      calls += 1
      return calls === 1 ? failure(422, 'academic_year_activation_too_early') : json(200, year)
    })
    const session = createCommandSession()
    const steps = {
      execute: (
        input: { startYear: number; version: number },
        headers: ReturnType<typeof commandHeaders>,
      ) => runRequest(() => activateAcademicYearRequest(client, input, headers)),
      version: (input: { version: number }) => input.version,
      refresh: async () => undefined,
      messages: ACADEMIC_YEAR_MESSAGES,
    }
    const reported: string[] = []
    const targets = { notifyError: (message: string) => void reported.push(message) }
    const input = { startYear: 2027, version: 3 }

    const first = await runCommand(session, steps, input, targets)
    assert.equal(first.status, 'failed')
    assert.match(reported[0] ?? '', /en çok 60 gün önce/)

    const second = await runCommand(session, steps, input, targets)
    assert.equal(second.status, 'success')
    // Kesin hatadan sonra yeni kullanıcı eylemi yeni Idempotency-Key alır.
    assert.notEqual(
      sent[0]?.headers.get('idempotency-key'),
      sent[1]?.headers.get('idempotency-key'),
    )
    assert.equal(sent[1]?.headers.get('if-match'), '"3"')
  })

  test('409 çakışmada sorgu tazelenir ve Türkçe mesaj bildirilir', async () => {
    const { client } = fakeClient(() => failure(409, 'version_conflict'))
    let refreshed = 0
    const reported: string[] = []
    const outcome = await runCommand(
      createCommandSession(),
      {
        execute: (input: { startYear: number; version: number }, headers) =>
          runRequest(() => closeAcademicYearRequest(client, input, headers)),
        version: (input) => input.version,
        refresh: async () => void (refreshed += 1),
        messages: ACADEMIC_YEAR_MESSAGES,
      },
      { startYear: 2026, version: 1 },
      { notifyError: (message) => void reported.push(message) },
    )
    assert.equal(outcome.status, 'failed')
    assert.equal(refreshed, 1)
    assert.deepEqual(reported, [ACADEMIC_YEAR_CHANGED_MESSAGE])
  })
})
