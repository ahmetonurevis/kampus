import test from 'node:test'
import assert from 'node:assert/strict'
import { logs, recordError, MAX_LOG_ENTRIES } from '../apps/mobile/src/lib/error-log.ts'

test.beforeEach(() => {
  logs.length = 0
})

test('hata yapılandırılmış kayıt olarak yazılır, error düzeyi kritiktir', () => {
  recordError(new Error('ECONNRESET db'), 'storage-write')
  assert.equal(logs.length, 1)
  const [entry] = logs
  assert.equal(entry?.context, 'storage-write')
  assert.equal(entry?.level, 'error')
  assert.equal(entry?.critical, true)
  assert.match(entry?.message ?? '', /ECONNRESET db/)
  assert.ok(!Number.isNaN(Date.parse(entry?.date ?? '')))
})

test('warn düzeyi kritik değildir', () => {
  recordError('x', 'file-pick', 'warn')
  assert.equal(logs[0]?.level, 'warn')
  assert.equal(logs[0]?.critical, false)
})

test('günlük sınırı aşılınca en eski kayıt atılır', () => {
  for (let i = 0; i < MAX_LOG_ENTRIES + 5; i++) recordError(`e${i}`, `c${i}`)
  assert.equal(logs.length, MAX_LOG_ENTRIES)
  assert.equal(logs[0]?.context, 'c5')
})
