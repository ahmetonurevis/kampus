import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import type { Session } from '../packages/school-core/src/lib/domain.ts'
import { runWorkflow } from '../packages/school-core/src/lib/school-workflows.ts'
import type { Role } from '../packages/school-core/src/modules/navigation.ts'

// Denetim girdisinin kişisi (IST-014): oturum `userId` taşıyorsa her rol kendi kimliğini yazar;
// taşımıyorsa (çevrimdışı demo) bugünkü demo değerleri korunur.
const now = '2026-10-06T10:00:00.000Z'
let sequence = 0
const id = (prefix: string) => `${prefix}-au-test-${++sequence}`
const routeInput = {
  title: 'Denetim hattı',
  branchId: 'b1',
  plate: '34 TEST 01',
  driver: 'Veli Kara',
  phone: '05551234567',
  capacity: 12,
  stops: 'Kozyatağı, Göztepe, Kampüs',
}

// Her rolün çalıştırabildiği bir komut: idari roller güzergâh, öğrenci ve veli kulüp kaydı.
function act(state: State, session: Session) {
  if (session.role === 'ogrenci' || session.role === 'veli')
    return runWorkflow(state, session, 'club-enroll', { studentId: 's1' }, id, 'club-art', now)
  if (session.role === 'ogretmen')
    return runWorkflow(
      state,
      session,
      'club',
      {
        title: 'Münazara',
        branchId: 'b1',
        teacherId: 't1',
        capacity: 10,
        description: 'Haftalık münazara çalışması.',
        meeting: 'Cuma 16:00 · Kütüphane',
      },
      id,
      undefined,
      now,
    )
  return runWorkflow(state, session, 'route', routeInput, id, undefined, now)
}
const session = (role: Role, userId?: string): Session => ({
  role,
  childId: 's1',
  ...(userId === undefined ? {} : { userId }),
})
const roles: Role[] = ['yonetici', 'onburo', 'ogretmen', 'ogrenci', 'veli']

for (const role of roles)
  test(`IST-014: kimlikli oturumda ${role} denetim girdisine kendi kullanıcı kimliğini yazar`, () => {
    const state = createSeed(new Date(now))
    act(state, session(role, `user-${role}-42`))
    assert.equal(state.audit[0]?.actor, role)
    assert.equal(state.audit[0]?.user_id, `user-${role}-42`)
  })

test('IST-014: kimliksiz oturumda demo denetim kişileri değişmeden korunur', () => {
  const written: Record<string, string | undefined> = {}
  for (const role of roles) {
    const state = createSeed(new Date(now))
    act(state, session(role))
    written[role] = state.audit[0]?.user_id
  }
  assert.equal(written.yonetici, 'demo-yonetici')
  assert.equal(written.onburo, 'demo-onburo')
  assert.equal(written.veli, 'p1')
  assert.ok(written.ogretmen)
  assert.ok(written.ogrenci)
})
