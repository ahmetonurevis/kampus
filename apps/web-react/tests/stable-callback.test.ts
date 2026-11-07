import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createLatestCaller } from '../src/hooks/use-stable-callback.ts'

test('DOM-BEC-043 süre dolum yenilemesi: sabit işlev her zaman en güncel yenilemeyi çağırır', () => {
  const calls: string[] = []
  const box = createLatestCaller(() => calls.push('eski'))
  const stable = box.call
  box.update(() => calls.push('yeni'))
  stable()
  assert.deepEqual(calls, ['yeni'])
  assert.equal(box.call, stable)
})
