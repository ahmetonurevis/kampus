import test from 'node:test'
import assert from 'node:assert/strict'
import { toAuditValue } from '../packages/school-core/src/lib/audit.ts'

test('Denetim değeri kaydın JSON kopyasıdır; kayıt sonradan değişse de değişmez', () => {
  const record = { id: 'r1', steps: [{ done: false }], note: undefined as string | undefined }
  const value = toAuditValue(record)
  record.steps[0]!.done = true
  assert.deepEqual(value, { id: 'r1', steps: [{ done: false }] })
  assert.equal(toAuditValue(undefined), null)
  assert.equal(toAuditValue(null), null)
  assert.equal(toAuditValue(3), 3)
})
