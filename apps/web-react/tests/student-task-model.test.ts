import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { attemptStatusBadge } from '../src/pages/tasks/student-task-model.ts'

// Deneme çözme ve sonuç modeli testleri react-shared'e taşındı
// (`packages/react-shared/test/attempt-model.test.ts`); burada yalnız webe özgü rozet kalır.

describe('personel deneme görünümü (OG-983; DOM-BEC-042)', () => {
  test('DOM-BEC-042: deneme durumu süren, geç, süre dolunca ve teslim olarak gösterilir', () => {
    const base = { status: 'submitted', late: false, autoSubmitted: false } as const
    assert.equal(attemptStatusBadge({ ...base, status: 'in_progress' }).label, 'Sürüyor')
    assert.equal(attemptStatusBadge(base).label, 'Teslim edildi')
    assert.equal(attemptStatusBadge({ ...base, late: true }).label, 'Geç teslim')
    assert.equal(
      attemptStatusBadge({ ...base, status: 'expired', autoSubmitted: true }).label,
      'Süre dolunca teslim',
    )
  })
})
