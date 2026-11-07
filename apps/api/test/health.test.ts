import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { buildTestApp, createTestDatabase } from './support/app.ts'

describe('GET /api/v1/health', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  test('kimliksiz çağrıda sunucu ve veritabanı durumunu döndürür', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' })
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json(), { data: { status: 'ok', database: 'ok' } })
    assert.equal(response.headers['cache-control'], 'no-store')
    assert.match(String(response.headers['x-request-id']), /^[0-9a-f-]{36}$/)
  })

  test('UUID biçimindeki istemci istek kimliğini korur', async () => {
    const requestId = '7f3a2c10-0000-4000-8000-000000000001'
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { 'x-request-id': requestId },
    })
    assert.equal(response.headers['x-request-id'], requestId)
  })

  test('bilinmeyen yol hata zarfıyla 404 döner', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/olmayan-kaynak' })
    assert.equal(response.statusCode, 404)
    const body = response.json()
    assert.equal(body.code, 'not_found')
    assert.equal(body.message, 'İstenen kayıt bulunamadı.')
    assert.equal(body.requestId, response.headers['x-request-id'])
  })

  test('veritabanı yanıt vermezse 503 unavailable döner', async () => {
    const broken = await createTestDatabase()
    const brokenApp = await buildTestApp(broken.db)
    await broken.close()
    try {
      const response = await brokenApp.inject({ method: 'GET', url: '/api/v1/health' })
      assert.equal(response.statusCode, 503)
      assert.equal(response.json().code, 'unavailable')
    } finally {
      await brokenApp.close()
    }
  })
})
