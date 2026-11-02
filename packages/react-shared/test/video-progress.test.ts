import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'

import { runRequest } from '../src/api-result.ts'
import {
  createVideoProgressReporter,
  recordVideoProgressRequest,
  resumePosition,
  VIDEO_PROGRESS_INTERVAL_MS,
  VIDEO_PROGRESS_INVALIDATES,
  type VideoProgressSample,
} from '../src/video-progress.ts'

// IST-041, DOM-KYN-005: video izleme ilerlemesi istekleri, yazma sıklığı ve devam konumu.

function fakeClient() {
  const sent: { method: string; path: string; headers: Headers; body: unknown }[] = []
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
          data: { videoId: 'v1', progress: 25, positionSeconds: 30, durationSeconds: 120 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    },
  })
  return { client, sent }
}

const at = (positionSeconds: number, durationSeconds = 120): VideoProgressSample => ({
  positionSeconds,
  durationSeconds,
})

function reporter(options: { initialPositionSeconds?: number } = {}) {
  const sent: VideoProgressSample[] = []
  let clock = 0
  const instance = createVideoProgressReporter({
    send: (sample) => sent.push(sample),
    now: () => clock,
    ...options,
  })
  return {
    instance,
    sent,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

describe('video izleme ilerlemesi', () => {
  test('DOM-KYN-005: istek öğrencinin ilerlemesini gövdeyle yazar, Idempotency-Key ve If-Match taşımaz', async () => {
    const { client, sent } = fakeClient()
    const body = await runRequest(() =>
      recordVideoProgressRequest(client, {
        videoId: 'v1',
        positionSeconds: 30,
        durationSeconds: 120,
      }),
    )
    assert.equal(sent[0]?.method, 'POST')
    assert.equal(sent[0]?.path, '/api/v1/videos/v1/progress')
    assert.deepEqual(sent[0]?.body, { positionSeconds: 30, durationSeconds: 120 })
    assert.equal(sent[0]?.headers.get('if-match'), null)
    assert.equal(body.data.progress, 25)
  })

  test('yazma sonrası videoProgress okumaları tazelenir', () => {
    assert.deepEqual(VIDEO_PROGRESS_INVALIDATES, [['collections', 'videoProgress']])
  })

  test('DOM-KYN-005: oynatırken her konum olayında değil, aralık dolunca gönderilir', () => {
    const { instance, sent, advance } = reporter()
    instance.tick(at(1))
    for (let second = 2; second <= 15; second += 1) {
      advance(1000)
      instance.tick(at(second))
    }
    assert.equal(sent.length, 0)
    advance(1000)
    instance.tick(at(16))
    assert.deepEqual(sent, [at(16)])
    advance(VIDEO_PROGRESS_INTERVAL_MS - 1)
    instance.tick(at(31))
    assert.equal(sent.length, 1)
    advance(1)
    instance.tick(at(32))
    assert.deepEqual(sent.at(-1), at(32))
  })

  test('duraklatma, bitiş ve kapanışta hemen gönderilir; aynı konum yinelenmez', () => {
    const { instance, sent } = reporter()
    instance.tick(at(5))
    instance.flush()
    assert.deepEqual(sent, [at(5)])
    instance.flush()
    assert.equal(sent.length, 1)
    instance.flush(at(120))
    assert.deepEqual(sent.at(-1), at(120))
  })

  test('hiç oynatılmamış ya da geçersiz örnek gönderilmez', () => {
    const { instance, sent } = reporter()
    instance.flush()
    instance.tick(at(5, Number.NaN))
    instance.tick(at(5, 0))
    instance.tick(at(-1))
    instance.flush(at(Number.POSITIVE_INFINITY))
    assert.equal(sent.length, 0)
  })

  test('açılışta konumlandığı yer yeniden gönderilmez', () => {
    const { instance, sent } = reporter({ initialPositionSeconds: 42.4 })
    instance.tick(at(42.2))
    instance.flush()
    assert.equal(sent.length, 0)
    instance.tick(at(60))
    instance.flush()
    assert.equal(sent.length, 1)
  })

  test('DOM-KYN-005: devam konumu kayıtlı son konumdur; konum yoksa yüzdeden türetilir', () => {
    assert.equal(resumePosition({ progress: 40, positionSeconds: 48 }, 120), 48)
    assert.equal(resumePosition({ progress: 35 }, 100), 35)
    assert.equal(resumePosition({ progress: 0 }, 100), 0)
    assert.equal(resumePosition({ progress: 100 }, 100), 0)
  })

  test('bitişe çok yakın, konumsuz ya da süresiz oynatıcıda baştan başlanır', () => {
    assert.equal(resumePosition({ progress: 100, positionSeconds: 120 }, 120), 0)
    assert.equal(resumePosition({ progress: 100, positionSeconds: 118 }, 120), 0)
    assert.equal(resumePosition({ progress: 100, positionSeconds: 40 }, 120), 40)
    assert.equal(resumePosition({ progress: 10, positionSeconds: 0 }, 120), 0)
    assert.equal(resumePosition({ progress: 10, positionSeconds: 30 }, Number.NaN), 0)
    assert.equal(resumePosition({ progress: 10, positionSeconds: 30 }, 0), 0)
  })
})
