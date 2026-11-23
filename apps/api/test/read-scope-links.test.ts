import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { membershipLinks } from '../src/db/schema/membership-links.ts'
import type { MembershipLinkInput } from '../src/services/identity.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'
import { sampleRows, SEED } from './support/collections-sample.ts'

/**
 * Okuma kapsamı kaynakları: pasif öğrenci ve arşivlenmiş üyelik bağlantısı. Veli hesapları ucu ile
 * yazışma başlatma aynı kararı verir (DOM-ILT-010); arşivlenen bağlantı kapsam vermez.
 */

describe('okuma kapsamı: pasif öğrenci ve arşivli bağlantı', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  const s1 = SEED.students.find((item) => item.id === 's1')
  assert.ok(s1)

  async function institution(extra: { id: string; data: Record<string, unknown> }[] = []) {
    const created = await createInstitution(app)
    const rows = [
      ...sampleRows(),
      ...extra.map((item) => ({ collection: 'students' as const, ...item })),
    ]
    await insertMissingRecords(db, created.id, rows, FIXED_NOW)
    return created
  }
  async function member(institutionId: string, role: Role, links: MembershipLinkInput[] = []) {
    const user = await createMember(app, institutionId, role, links)
    return { ...user, cookie: await signInAs(app, user) }
  }
  const read = (cookie: string, url: string) =>
    app.inject({ method: 'GET', url, headers: { origin: TEST_ORIGIN, cookie } })
  const startWithParent = (cookie: string, studentId: string, parentUserId: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        'content-type': 'application/json',
        'idempotency-key': `test-links-${String(++serial).padStart(5, '0')}`,
      },
      payload: JSON.stringify({ studentId, audience: 'parent', parentUserId, text: 'Merhaba' }),
    })

  test('pasif öğrencide veli hesapları ve yazışma başlatma aynı kararı verir', async () => {
    const passive = {
      ...s1,
      id: 'test-s-pasif',
      name: 'Pasif Öğrenci',
      number: '9999',
      isActive: false,
    }
    const a = await institution([{ id: passive.id, data: passive }])
    const teacher = await member(a.id, 'ogretmen', [{ kind: 'teacher', recordId: 't2' }])
    const activeMother = await member(a.id, 'veli', [{ kind: 'child', recordId: 's1' }])
    const passiveMother = await member(a.id, 'veli', [{ kind: 'child', recordId: passive.id }])

    // Etkin öğrenci: ikisi de açık.
    const accounts = await read(teacher.cookie, '/api/v1/students/s1/parent-accounts')
    assert.equal(accounts.statusCode, 200, accounts.body)
    assert.equal((await startWithParent(teacher.cookie, 's1', activeMother.id)).statusCode, 201)

    // Pasif öğrenci: ilişki yok; iki uç da reddeder (hesap adları sızmaz).
    const denied = await read(teacher.cookie, `/api/v1/students/${passive.id}/parent-accounts`)
    assert.equal(denied.statusCode, 404, denied.body)
    assert.ok(!denied.body.includes(passiveMother.id))
    const start = await startWithParent(teacher.cookie, passive.id, passiveMother.id)
    assert.equal(start.statusCode, 403, start.body)
  })

  test('arşivlenen üyelik bağlantısı veli hesabı listesinde ve kapsamda yok sayılır', async () => {
    const a = await institution()
    const teacher = await member(a.id, 'ogretmen', [{ kind: 'teacher', recordId: 't2' }])
    const mother = await member(a.id, 'veli', [{ kind: 'child', recordId: 's1' }])
    const father = await member(a.id, 'veli', [{ kind: 'child', recordId: 's1' }])
    const accountIds = async () =>
      (await read(teacher.cookie, '/api/v1/students/s1/parent-accounts'))
        .json()
        .data.map((item: { userId: string }) => item.userId)
        .sort()
    assert.deepEqual(await accountIds(), [mother.id, father.id].sort())
    assert.equal((await read(mother.cookie, '/api/v1/collections/students/s1')).statusCode, 200)

    await db
      .update(membershipLinks)
      .set({ archivedAt: FIXED_NOW })
      .where(
        and(
          eq(membershipLinks.institutionId, a.id),
          eq(membershipLinks.membershipId, mother.membershipId),
        ),
      )

    // Liste yalnız etkin bağlantıyı gösterir; arşivlenen veli çocuğunun kaydını artık okuyamaz.
    assert.deepEqual(await accountIds(), [father.id])
    assert.equal((await read(mother.cookie, '/api/v1/collections/students/s1')).statusCode, 404)
    assert.equal((await read(father.cookie, '/api/v1/collections/students/s1')).statusCode, 200)
  })
})
