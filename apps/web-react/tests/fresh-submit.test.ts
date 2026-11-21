import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ApiError } from '@kampus/api-client/errors.ts'
import { submitWithFreshRecord } from '../src/pages/language/fresh-submit.ts'

// IST-076, IST-077: sürümlü yazmalar gönderimde taze kayıtla yapılır; 409 form içinde bildirilir.

type Sent = { version: number }
const versionConflict = new ApiError({
  status: 409,
  code: 'version_conflict',
  message: 'Kayıt değişti',
  issues: [],
})

test('sürüm ekrandaki bayat kopyadan değil gönderimde okunan kayıttan gider (e-Özel, iptal, arşiv)', async () => {
  const stale = { id: 'k1', rowVersion: 3 }
  const fresh = { id: 'k1', rowVersion: 5 }
  const sent: Sent[] = []
  const result = await submitWithFreshRecord(
    async () => fresh,
    async (record) => {
      sent.push({ version: record.rowVersion })
      return { status: 'success' as const, data: null }
    },
  )
  assert.notEqual(stale.rowVersion, fresh.rowVersion)
  assert.deepEqual(sent, [{ version: 5 }])
  assert.equal(result.status, 'sent')
  assert.equal(result.status === 'sent' && result.conflicted, false)
})

test('kayıt okunamazsa ya da uygun değilse istek atılmaz', async () => {
  let calls = 0
  const result = await submitWithFreshRecord(
    async () => undefined,
    async () => {
      calls += 1
      return { status: 'success' as const, data: null }
    },
  )
  assert.deepEqual(result, { status: 'missing' })
  assert.equal(calls, 0)
})

test('409 sürüm çakışması conflicted olarak bildirilir; diğer hatalar bildirilmez', async () => {
  const conflicted = await submitWithFreshRecord(
    async () => 1,
    async () => ({ status: 'failed' as const, error: versionConflict }),
  )
  assert.equal(conflicted.status === 'sent' && conflicted.conflicted, true)

  const other = await submitWithFreshRecord(
    async () => 1,
    async () => ({
      status: 'failed' as const,
      error: new ApiError({
        status: 422,
        code: 'course_has_open_groups',
        message: 'x',
        issues: [],
      }),
    }),
  )
  assert.equal(other.status === 'sent' && other.conflicted, false)

  const busy = await submitWithFreshRecord(
    async () => 1,
    async () => ({ status: 'busy' as const }),
  )
  assert.equal(busy.status === 'sent' && busy.conflicted, false)
})

test('birleştirme: hedef ve kaynak sürümü birlikte taze okunur, kaynak düşmüşse istek atılmaz (DOM-DIL-042)', async () => {
  const send = async (loaded: { target: number; source: number }) => {
    sent.push(loaded)
    return { status: 'success' as const, data: null }
  }
  const sent: { target: number; source: number }[] = []
  await submitWithFreshRecord(async () => ({ target: 7, source: 9 }), send)
  assert.deepEqual(sent, [{ target: 7, source: 9 }])
  const missing = await submitWithFreshRecord(async () => undefined, send)
  assert.equal(missing.status, 'missing')
  assert.equal(sent.length, 1)
})
