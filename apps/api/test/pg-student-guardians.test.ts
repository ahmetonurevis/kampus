import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, isNull } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { studentGuardians } from '../src/db/schema/student-guardians.ts'
import { ensureMembershipLinks } from '../src/services/identity.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'
import { createPgDatabase, PG_SKIP } from './support/pg.ts'

type Json = ReturnType<typeof JSON.parse>

/**
 * Veli–öğrenci bağı gerçek PostgreSQL 16'da (IST-019; DOM-ILT-071, DOM-ILT-074, DOM-ILT-075).
 * PGlite tek bağlantılı olduğundan eşzamanlı yazma yalnız burada sınanır: bağ yazmaları kurum
 * kilidi altında sıraya girer, ikinci işlem birincinin sonucunu görür ve core kuralıyla reddedilir.
 */
describe('PostgreSQL 16: veli–öğrenci bağı eşzamanlılığı', { skip: PG_SKIP }, () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createPgDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  /** Deniz (`s-1`): annesinin hesabı velayetli (üyelik bağlantısı); `p-1`, `p-2` veli kayıtları. */
  async function tenant() {
    const institution = await createInstitution(app)
    await insertMissingRecords(
      db,
      institution.id,
      [
        {
          collection: 'students' as const,
          id: 's-1',
          data: { id: 's-1', name: 'Deniz Yılmaz', classId: '9-A', isActive: true },
        },
        ...[
          ['p-1', 'Kemal Yılmaz'],
          ['p-2', 'Leyla Ak'],
        ].map(([id, name]) => ({
          collection: 'parents' as const,
          id: id!,
          data: { id, name, children: [] },
        })),
      ],
      FIXED_NOW,
    )
    const mother = await createMember(app, institution.id, 'veli', [
      { kind: 'child', recordId: 's-1' },
    ])
    return { institution, mother, admin: await signInAs(app, institution.admin) }
  }

  function call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    cookie: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url: `/api/v1/students/s-1/guardians${url}`,
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
  }
  async function link(cookie: string, body: unknown) {
    const response = await call('POST', '', cookie, body, { 'idempotency-key': randomUUID() })
    assert.equal(response.statusCode, 201, response.body)
    return response.json().data as Json
  }
  async function motherLink(cookie: string, membershipId: string) {
    const response = await call('GET', '', cookie)
    assert.equal(response.statusCode, 200, response.body)
    const own = (response.json().data as Json[]).find((item) => item.membershipId === membershipId)
    assert.ok(own)
    return own as Json
  }
  const activeRows = (institutionId: string) =>
    db
      .select()
      .from(studentGuardians)
      .where(
        and(eq(studentGuardians.institutionId, institutionId), isNull(studentGuardians.archivedAt)),
      )

  test('DOM-ILT-075: iki velayetli bağın eşzamanlı kaldırılmasından biri 200, öteki 422; velayetli bağ kalır', async () => {
    const t = await tenant()
    const mother = await motherLink(t.admin, t.mother.membershipId)
    const father = await link(t.admin, {
      parentId: 'p-1',
      relationship: 'father',
      custody: 'joint',
    })
    await link(t.admin, { parentId: 'p-2', relationship: 'other', custody: 'none' })

    const results = await Promise.all(
      [mother, father].map((bond) =>
        call('DELETE', `/${bond.id}`, t.admin, undefined, { 'if-match': `"${bond.rowVersion}"` }),
      ),
    )
    assert.deepEqual(
      results.map((item) => item.statusCode).sort(),
      [200, 422],
      results.map((item) => item.body).join('\n'),
    )
    const refused = results.find((item) => item.statusCode === 422)
    assert.equal(refused?.json().code, 'guardian_custody_required')
    const left = await activeRows(t.institution.id)
    assert.equal(left.length, 2)
    assert.equal(left.filter((row) => row.custody !== 'none').length, 1)
  })

  test('DOM-ILT-074: iki bağa eşzamanlı ödeyici atamasından biri 200, öteki 409; tek ödeyici kalır', async () => {
    const t = await tenant()
    const mother = await motherLink(t.admin, t.mother.membershipId)
    const father = await link(t.admin, {
      parentId: 'p-1',
      relationship: 'father',
      custody: 'joint',
    })

    const results = await Promise.all(
      [mother, father].map((bond) =>
        call(
          'PATCH',
          `/${bond.id}`,
          t.admin,
          { isPayer: true },
          { 'if-match': `"${bond.rowVersion}"` },
        ),
      ),
    )
    assert.deepEqual(
      results.map((item) => item.statusCode).sort(),
      [200, 409],
      results.map((item) => item.body).join('\n'),
    )
    const refused = results.find((item) => item.statusCode === 409)
    assert.equal(refused?.json().code, 'guardian_payer_exists')
    const payers = (await activeRows(t.institution.id)).filter((row) => row.isPayer)
    assert.equal(payers.length, 1)
  })

  test('DOM-ILT-071: eşzamanlı kaldırma ve hesap bağlantısı yeniden eklemesi kaldırılan bağı diriltmez', async () => {
    const t = await tenant()
    const mother = await motherLink(t.admin, t.mother.membershipId)
    const [removed] = await Promise.all([
      call('DELETE', `/${mother.id}`, t.admin, undefined, {
        'if-match': `"${mother.rowVersion}"`,
      }),
      ensureMembershipLinks(db, t.institution.id, t.mother.membershipId, [
        { kind: 'child', recordId: 's-1' },
      ]),
    ])
    assert.equal(removed.statusCode, 200, removed.body)
    await ensureMembershipLinks(db, t.institution.id, t.mother.membershipId, [
      { kind: 'child', recordId: 's-1' },
    ])
    assert.deepEqual(await activeRows(t.institution.id), [])
  })
})
