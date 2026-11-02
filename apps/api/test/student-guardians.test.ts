import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { studentGuardians } from '../src/db/schema/student-guardians.ts'
import { ensureMembershipLinks } from '../src/services/identity.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'

/**
 * Veli–öğrenci bağı uçları (IST-019; docs/domain/iletisim-ve-veli.md DOM-ILT-070…075). Kural core
 * `lib/guardianship.ts`'tedir; burada rol, kurum kapsamı, velinin daraltılmış görünümü, sürüm
 * kilidi, Idempotency-Key, denetim kaydı ve hata durumunda kaydın değişmemesi denetlenir.
 */

type Json = ReturnType<typeof JSON.parse>
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

describe('veli–öğrenci bağı uçları', () => {
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

  /**
   * Deniz (`s-1`) annesi Ayşe'nin hesabına (`mother`, üyelik bağlantısıyla velayetli bağ) bağlıdır;
   * Ece (`s-2`) bağsızdır. `p-1` ve `p-2` hesabı olmayan veli kayıtlarıdır. Kemal ve Leyla bağsız
   * veli hesaplarıdır.
   */
  async function tenant() {
    const institution = await createInstitution(app)
    await insertMissingRecords(
      db,
      institution.id,
      [
        ...[
          ['s-1', 'Deniz Yılmaz'],
          ['s-2', 'Ece Yılmaz'],
        ].map(([id, name]) => ({
          collection: 'students' as const,
          id: id!,
          data: { id, name, classId: '9-A', isActive: true },
        })),
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
    const users = {
      mother: await createMember(app, institution.id, 'veli', [{ kind: 'child', recordId: 's-1' }]),
      father: await createMember(app, institution.id, 'veli'),
      restricted: await createMember(app, institution.id, 'veli'),
      teacher: await createMember(app, institution.id, 'ogretmen'),
      student: await createMember(app, institution.id, 'ogrenci', [
        { kind: 'student', recordId: 's-1' },
      ]),
      frontDesk: await createMember(app, institution.id, 'onburo'),
    }
    const cookies = {
      admin: await signInAs(app, institution.admin),
      mother: await signInAs(app, users.mother),
      father: await signInAs(app, users.father),
      restricted: await signInAs(app, users.restricted),
      teacher: await signInAs(app, users.teacher),
      student: await signInAs(app, users.student),
      frontDesk: await signInAs(app, users.frontDesk),
    }
    return { institution, users, cookies }
  }
  type Tenant = Awaited<ReturnType<typeof tenant>>

  function call(
    method: Method,
    url: string,
    cookie?: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url: `/api/v1${url}`,
      headers: {
        origin: TEST_ORIGIN,
        ...(cookie ? { cookie } : {}),
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
  }
  const key = () => ({ 'idempotency-key': randomUUID() })
  const match = (value: number) => ({ 'if-match': `"${value}"` })
  async function ok(response: Awaited<ReturnType<typeof call>>, status = 200) {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function fails(response: Awaited<ReturnType<typeof call>>, status: number, code: string) {
    assert.equal(response.statusCode, status, response.body)
    assert.equal(response.json().code, code, response.body)
  }

  const list = (cookie: string, studentId = 's-1') =>
    call('GET', `/students/${studentId}/guardians`, cookie)
  const link = (
    cookie: string,
    body: unknown,
    studentId = 's-1',
    headers: Record<string, string> = key(),
  ) => call('POST', `/students/${studentId}/guardians`, cookie, body, headers)
  const patch = (cookie: string, linkId: string, body: unknown, version?: number) =>
    call(
      'PATCH',
      `/students/s-1/guardians/${linkId}`,
      cookie,
      body,
      version === undefined ? {} : match(version),
    )
  const unlink = (cookie: string, linkId: string, version?: number, studentId = 's-1') =>
    call(
      'DELETE',
      `/students/${studentId}/guardians/${linkId}`,
      cookie,
      undefined,
      version === undefined ? {} : match(version),
    )
  const rows = (institutionId: string) =>
    db
      .select()
      .from(studentGuardians)
      .where(eq(studentGuardians.institutionId, institutionId))
      .orderBy(studentGuardians.createdAt, studentGuardians.id)

  /** Annenin üyelik bağlantısıyla açılan velayetli bağı. */
  async function motherLink(t: Tenant) {
    const [own] = await ok(await list(t.cookies.admin))
    assert.equal(own.membershipId, t.users.mother.membershipId)
    return own as Json
  }

  test('401: oturumsuz istek her uçta reddedilir', async () => {
    const t = await tenant()
    const id = randomUUID()
    for (const response of [
      await call('GET', '/students/s-1/guardians'),
      await call('POST', '/students/s-1/guardians', undefined, {}, key()),
      await call('PATCH', `/students/s-1/guardians/${id}`, undefined, {}, match(1)),
      await call('DELETE', `/students/s-1/guardians/${id}`, undefined, undefined, match(1)),
    ])
      fails(response, 401, 'unauthenticated')
    assert.equal((await rows(t.institution.id)).length, 1)
  })

  test('DOM-ILT-071 403: öğretmen ve öğrenci okuyamaz; veli, öğretmen ve öğrenci bağ yazamaz', async () => {
    const t = await tenant()
    const own = await motherLink(t)
    for (const cookie of [t.cookies.teacher, t.cookies.student])
      fails(await list(cookie), 403, 'forbidden')
    for (const cookie of [t.cookies.mother, t.cookies.teacher, t.cookies.student]) {
      fails(
        await link(cookie, { parentId: 'p-1', relationship: 'father', custody: 'joint' }),
        403,
        'forbidden',
      )
      fails(await patch(cookie, own.id, { isPayer: true }, own.rowVersion), 403, 'forbidden')
      fails(await unlink(cookie, own.id, own.rowVersion), 403, 'forbidden')
    }
    const after = await rows(t.institution.id)
    assert.equal(after.length, 1)
    assert.equal(after[0]!.isPayer, false)
    assert.equal(after[0]!.archivedAt, null)
  })

  test('DOM-ILT-070 DOM-ILT-074 bağ kurma: 201, kalıcı, Location; denetimde yalnız alan adları; mükerrer anahtar aynı yanıt', async () => {
    const t = await tenant()
    const headers = key()
    const body = {
      membershipId: t.users.father.membershipId,
      relationship: 'father',
      custody: 'joint',
      isPayer: true,
    }
    const first = await link(t.cookies.frontDesk, body, 's-1', headers)
    const created = await ok(first, 201)
    assert.equal(first.headers.location, '/api/v1/students/s-1/guardians')
    assert.deepEqual(
      { ...created, id: undefined },
      {
        id: undefined,
        studentId: 's-1',
        parentId: null,
        membershipId: t.users.father.membershipId,
        relationship: 'father',
        custody: 'joint',
        contactRestricted: false,
        isPayer: true,
        canPickUp: false,
        createdAt: FIXED_NOW.toISOString(),
        updatedAt: FIXED_NOW.toISOString(),
        archivedAt: null,
        rowVersion: 1,
      },
    )
    const replay = await link(t.cookies.frontDesk, body, 's-1', headers)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.deepEqual(replay.json().data, created)
    assert.equal((await rows(t.institution.id)).length, 2)

    // Hesabı olmayan veli kaydı da bağlanır; yönetici ve ön büro bütün bağları görür.
    await ok(
      await link(t.cookies.admin, { parentId: 'p-2', relationship: 'other', custody: 'none' }),
      201,
    )
    const all = await ok(await list(t.cookies.frontDesk))
    assert.equal(all.length, 3)
    assert.ok(all.every((item: Json) => typeof item.contactRestricted === 'boolean'))

    const audits = await db
      .select({ action: auditLog.action, changes: auditLog.changes, entityId: auditLog.entityId })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, t.institution.id),
          eq(auditLog.entityType, 'student_guardian'),
        ),
      )
    assert.equal(audits.length, 2)
    assert.deepEqual(
      audits.find((item) => item.entityId === created.id),
      {
        action: 'guardian.link',
        entityId: created.id,
        changes: {
          fields: [
            'studentId',
            'parentId',
            'membershipId',
            'relationship',
            'custody',
            'contactRestricted',
            'isPayer',
            'canPickUp',
          ],
        },
      },
    )
    assert.equal(JSON.stringify(audits).includes('joint'), false)
  })

  test('400: geçersiz gövde, gövdedeki institutionId, eksik anahtar ve If-Match; kayıt değişmez', async () => {
    const t = await tenant()
    const own = await motherLink(t)
    const base = { parentId: 'p-1', relationship: 'father', custody: 'joint' }
    fails(
      await link(t.cookies.admin, { ...base, institutionId: 'baska-kurum' }),
      400,
      'validation_failed',
    )
    fails(await link(t.cookies.admin, { ...base, custody: 'kismen' }), 400, 'validation_failed')
    fails(
      await link(t.cookies.admin, { relationship: 'father', custody: 'joint' }),
      400,
      'validation_failed',
    )
    fails(await link(t.cookies.admin, base, 's-1', {}), 400, 'idempotency_key_required')
    fails(
      await link(t.cookies.admin, base, 's-1', { ...key(), ...match(1) }),
      400,
      'if_match_not_supported',
    )
    fails(await patch(t.cookies.admin, own.id, { isPayer: true }), 400, 'if_match_required')
    fails(await patch(t.cookies.admin, own.id, {}, own.rowVersion), 400, 'validation_failed')
    fails(
      await patch(t.cookies.admin, own.id, { parentId: 'p-1' }, own.rowVersion),
      400,
      'validation_failed',
    )
    fails(await unlink(t.cookies.admin, own.id), 400, 'if_match_required')
    const after = await rows(t.institution.id)
    assert.equal(after.length, 1)
    assert.equal(after[0]!.version, 1)
    assert.equal(after[0]!.isPayer, false)
  })

  test('DOM-ILT-074 DOM-ILT-075 kural reddi: ikinci ödeyici 409, kısıtlı ödeyici 422, velayetsiz ilk bağ 422, veli olmayan hesap 422, aynı veli 409', async () => {
    const t = await tenant()
    const own = await motherLink(t)
    await ok(await patch(t.cookies.admin, own.id, { isPayer: true }, own.rowVersion))
    fails(
      await link(t.cookies.admin, {
        parentId: 'p-1',
        relationship: 'father',
        custody: 'joint',
        isPayer: true,
      }),
      409,
      'guardian_payer_exists',
    )
    fails(
      await link(t.cookies.admin, {
        parentId: 'p-1',
        relationship: 'father',
        custody: 'none',
        contactRestricted: true,
        isPayer: true,
      }),
      422,
      'guardian_restricted_payer',
    )
    fails(
      await link(t.cookies.admin, {
        parentId: 'p-1',
        relationship: 'father',
        custody: 'full',
        contactRestricted: true,
      }),
      422,
      'guardian_restricted_custody',
    )
    fails(
      await link(t.cookies.admin, {
        parentId: 'p-1',
        relationship: 'legal_guardian',
        custody: 'none',
      }),
      422,
      'guardian_legal_custody',
    )
    fails(
      await link(
        t.cookies.admin,
        { parentId: 'p-1', relationship: 'father', custody: 'none' },
        's-2',
      ),
      422,
      'guardian_custody_required',
    )
    fails(
      await link(t.cookies.admin, {
        membershipId: t.users.teacher.membershipId,
        relationship: 'other',
        custody: 'full',
      }),
      422,
      'guardian_account_not_parent',
    )
    fails(
      await link(t.cookies.admin, {
        membershipId: t.users.mother.membershipId,
        relationship: 'mother',
        custody: 'full',
      }),
      409,
      'guardian_link_exists',
    )
    // Son velayetli bağın velayeti kaldırılamaz.
    fails(
      await patch(t.cookies.admin, own.id, { custody: 'none', isPayer: false }, own.rowVersion + 1),
      422,
      'guardian_custody_required',
    )
    const after = await rows(t.institution.id)
    assert.equal(after.length, 1)
    assert.equal(after[0]!.custody, 'full')
    assert.equal(after[0]!.isPayer, true)
  })

  test('404: olmayan öğrenci, veli kaydı, hesap ve bağ', async () => {
    const t = await tenant()
    const own = await motherLink(t)
    fails(await list(t.cookies.admin, 'yok'), 404, 'not_found')
    fails(
      await link(
        t.cookies.admin,
        { parentId: 'p-1', relationship: 'father', custody: 'full' },
        'yok',
      ),
      404,
      'not_found',
    )
    fails(
      await link(t.cookies.admin, { parentId: 'p-yok', relationship: 'father', custody: 'full' }),
      404,
      'not_found',
    )
    fails(
      await link(t.cookies.admin, {
        membershipId: 'uyelik-yok',
        relationship: 'father',
        custody: 'full',
      }),
      404,
      'not_found',
    )
    fails(await patch(t.cookies.admin, randomUUID(), { isPayer: true }, 1), 404, 'not_found')
    fails(await unlink(t.cookies.admin, own.id, own.rowVersion, 's-2'), 404, 'not_found')
    assert.equal((await rows(t.institution.id)).length, 1)
  })

  test('409: sürüm tutmazsa değiştirme ve kaldırma reddedilir, kayıt değişmez', async () => {
    const t = await tenant()
    const own = await motherLink(t)
    const changed = await ok(
      await patch(t.cookies.admin, own.id, { canPickUp: true, relationship: 'mother' }, 1),
    )
    assert.equal(changed.rowVersion, 2)
    assert.equal(changed.canPickUp, true)
    fails(await patch(t.cookies.admin, own.id, { isPayer: true }, 1), 409, 'version_conflict')
    fails(await unlink(t.cookies.admin, own.id, 1), 409, 'version_conflict')
    const [row] = await rows(t.institution.id)
    assert.equal(row!.version, 2)
    assert.equal(row!.isPayer, false)
    assert.equal(row!.archivedAt, null)
    const audits = await db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(
        and(eq(auditLog.institutionId, t.institution.id), eq(auditLog.action, 'guardian.update')),
      )
    assert.deepEqual(audits, [{ changes: { fields: ['relationship', 'canPickUp'] } }])
  })

  test('DOM-ILT-073 veli yalnız kendi bağını kısıt alanı olmadan görür; öteki veli ve kısıtlı veli sızmaz', async () => {
    const t = await tenant()
    const father = await ok(
      await link(t.cookies.admin, {
        membershipId: t.users.father.membershipId,
        relationship: 'father',
        custody: 'joint',
      }),
      201,
    )
    await ok(
      await link(t.cookies.admin, {
        membershipId: t.users.restricted.membershipId,
        relationship: 'other',
        custody: 'none',
        contactRestricted: true,
      }),
      201,
    )
    const response = await list(t.cookies.mother)
    const own = await ok(response)
    assert.equal(own.length, 1)
    assert.deepEqual(Object.keys(own[0]).sort(), [
      'canPickUp',
      'custody',
      'id',
      'isPayer',
      'membershipId',
      'parentId',
      'relationship',
      'studentId',
    ])
    assert.equal(own[0].membershipId, t.users.mother.membershipId)
    assert.equal(response.body.includes(father.id), false)
    assert.equal(response.body.includes(t.users.father.membershipId), false)
    assert.equal(response.body.includes(t.users.restricted.membershipId), false)
    assert.equal(response.body.includes('contactRestricted'), false)

    // İletişim kısıtlı veli öğrencinin verisini görmez; bağı olmayan veli öğrenciyi göremez.
    fails(await list(t.cookies.restricted), 404, 'not_found')
    fails(await list(t.cookies.father, 's-2'), 404, 'not_found')
    const staff = await ok(await list(t.cookies.admin))
    assert.equal(staff.length, 3)
  })

  test('DOM-ILT-075 kaldırma: son velayetli bağ başka bağ dururken kaldırılamaz; kaldırılan bağ listeden düşer', async () => {
    const t = await tenant()
    const own = await motherLink(t)
    const other = await ok(
      await link(t.cookies.admin, { parentId: 'p-1', relationship: 'father', custody: 'none' }),
      201,
    )
    fails(await unlink(t.cookies.admin, own.id, own.rowVersion), 422, 'guardian_custody_required')
    const removed = await ok(await unlink(t.cookies.frontDesk, other.id, other.rowVersion))
    assert.equal(removed.archivedAt, FIXED_NOW.toISOString())
    assert.equal(removed.rowVersion, 2)
    const left = await ok(await list(t.cookies.admin))
    assert.deepEqual(
      left.map((item: Json) => item.id),
      [own.id],
    )
    // Son bağ kaldırılabilir (DOM-ILT-075 bağı olmayan öğrenciyi kapsamaz).
    await ok(await unlink(t.cookies.admin, own.id, own.rowVersion))
    assert.deepEqual(await ok(await list(t.cookies.admin)), [])
    fails(await list(t.cookies.mother), 404, 'not_found')
    const audit = await db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(
        and(eq(auditLog.institutionId, t.institution.id), eq(auditLog.action, 'guardian.unlink')),
      )
    assert.equal(audit.length, 2)
    assert.deepEqual(audit[0]!.changes, { fields: ['archivedAt'] })
  })

  test('DOM-ILT-071 kaldırılan bağ hesap bağlantısı yeniden eklenince dirilmez; yeni öğrenciye bağ açılır', async () => {
    const t = await tenant()
    const own = await motherLink(t)
    await ok(await unlink(t.cookies.admin, own.id, own.rowVersion))
    await ensureMembershipLinks(db, t.institution.id, t.users.mother.membershipId, [
      { kind: 'child', recordId: 's-1' },
      { kind: 'child', recordId: 's-2' },
    ])
    const after = await rows(t.institution.id)
    const ofStudent = (studentId: string) => after.filter((row) => row.studentId === studentId)
    // Deniz'in tek bağı arşivli kalır; velayetli yeni bağ açılmaz.
    assert.equal(ofStudent('s-1').length, 1)
    assert.notEqual(ofStudent('s-1')[0]!.archivedAt, null)
    assert.deepEqual(await ok(await list(t.cookies.admin)), [])
    // Bağı hiç olmayan Ece'ye varsayılan velayetli bağ açılır; ikinci çağrı yinelemez.
    await ensureMembershipLinks(db, t.institution.id, t.users.mother.membershipId, [
      { kind: 'child', recordId: 's-2' },
    ])
    const ece = (await rows(t.institution.id)).filter((row) => row.studentId === 's-2')
    assert.equal(ece.length, 1)
    assert.equal(ece[0]!.custody, 'full')
    assert.equal(ece[0]!.archivedAt, null)
  })

  test('DOM-ILT-070 veli kaydı ile hesap aynı kişiye ait değilse 422 guardian_identity_mismatch; kayıt değişmez', async () => {
    const t = await tenant()
    // Ece'ye babanın kaydı (p-1) ve hesabı birlikte bağlanır: eşleme kurulur.
    await ok(
      await link(
        t.cookies.admin,
        {
          parentId: 'p-1',
          membershipId: t.users.father.membershipId,
          relationship: 'father',
          custody: 'full',
        },
        's-2',
      ),
      201,
    )
    const before = await rows(t.institution.id)
    // Kayıt p-1 başka hesapla, hesap başka kayıtla (p-2) Deniz'e bağlanamaz.
    fails(
      await link(t.cookies.admin, {
        parentId: 'p-1',
        membershipId: t.users.restricted.membershipId,
        relationship: 'father',
        custody: 'joint',
      }),
      422,
      'guardian_identity_mismatch',
    )
    fails(
      await link(t.cookies.admin, {
        parentId: 'p-2',
        membershipId: t.users.father.membershipId,
        relationship: 'father',
        custody: 'joint',
      }),
      422,
      'guardian_identity_mismatch',
    )
    assert.deepEqual(await rows(t.institution.id), before)
    // Aynı eşleme Deniz'e de bağlanır.
    await ok(
      await link(t.cookies.admin, {
        parentId: 'p-1',
        membershipId: t.users.father.membershipId,
        relationship: 'father',
        custody: 'joint',
      }),
      201,
    )
  })

  test('başka kurum: öğrenci ve bağ 404, B değişmez; listede B yok', async () => {
    const a = await tenant()
    const b = await tenant()
    const own = await motherLink(b)
    fails(await patch(a.cookies.admin, own.id, { isPayer: true }, own.rowVersion), 404, 'not_found')
    fails(await unlink(a.cookies.admin, own.id, own.rowVersion), 404, 'not_found')
    const listed = await ok(await list(a.cookies.admin))
    assert.equal(listed.length, 1)
    assert.notEqual(listed[0].id, own.id)
    // A'nın yöneticisi B'nin hesabını A'nın öğrencisine bağlayamaz.
    fails(
      await link(a.cookies.admin, {
        membershipId: b.users.father.membershipId,
        relationship: 'father',
        custody: 'joint',
      }),
      404,
      'not_found',
    )
    const [row] = await rows(b.institution.id)
    assert.equal(row!.version, 1)
    assert.equal(row!.isPayer, false)
    assert.equal(row!.archivedAt, null)
  })
})
