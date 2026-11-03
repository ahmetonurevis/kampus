import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, asc, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import { SESSION_FRESH_AGE_SECONDS } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { invitations, memberships, users, verifications } from '../src/db/schema/auth.ts'
import { membershipLinks } from '../src/db/schema/membership-links.ts'
import { studentGuardians } from '../src/db/schema/student-guardians.ts'
import { MemoryMailer } from '../src/services/mailer.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  nextIp,
  signIn,
  signInAs,
  TEST_ORIGIN,
  type TestInstitution,
} from './support/app.ts'

/**
 * Veli hesabı daveti (DOM-YTK-071; personel daveti DOM-YTK-070). Yönetici ve ön büro, taze oturum;
 * kullanıcı, `veli` üyeliği, çocuk bağlantıları, velayet bağlarının hesabı ve denetim kaydı tek
 * transaction'da. Başka kurumda hesaplı e-postada yanıt yeni hesaptakiyle aynıdır (karar 73).
 */
describe('veli hesabı daveti (DOM-YTK-071)', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let staleApp: App
  const mailer = new MemoryMailer()
  const ENDPOINT = '/api/v1/institution-members/guardian-invitations'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { mailer })
    staleApp = await buildTestApp(db, {
      mailer,
      clock: () => new Date(Date.now() + (SESSION_FRESH_AGE_SECONDS + 60) * 1000),
    })
  })
  after(async () => {
    await staleApp.close()
    await app.close()
    await close()
  })

  async function invite(
    cookie: string | undefined,
    payload: object,
    options: { key?: string | null; target?: App } = {},
  ) {
    const key = options.key === undefined ? randomUUID() : options.key
    const target = options.target ?? app
    const response = await target.inject({
      method: 'POST',
      url: ENDPOINT,
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...(key === null ? {} : { 'idempotency-key': key }),
      },
      payload,
    })
    // Parola bağlantıları yanıttan sonra arka planda gider; ileti denetiminden önce beklenir.
    await target.staffLinks.inline.idle()
    return response
  }

  /**
   * Deniz (`s-1`) ve Ece (`s-2`) kardeştir; Ayşe'nin veli kaydı (`p-ayse`) ikisine hesapsız,
   * velayetli bağlıdır. Mert (`s-3`) başka ailedendir; Kemal'in kaydı (`p-kemal`) Mert'e bağlıdır.
   */
  async function kurum(): Promise<{ institution: TestInstitution; cookie: string }> {
    const institution = await createInstitution(app)
    await insertMissingRecords(
      db,
      institution.id,
      [
        ...[
          ['s-1', 'Deniz Yılmaz'],
          ['s-2', 'Ece Yılmaz'],
          ['s-3', 'Mert Ak'],
        ].map(([id, name]) => ({
          collection: 'students' as const,
          id: id!,
          data: { id, name, classId: '9-A', isActive: true },
        })),
        ...[
          ['p-ayse', 'Ayşe Yılmaz'],
          ['p-kemal', 'Kemal Ak'],
        ].map(([id, name]) => ({
          collection: 'parents' as const,
          id: id!,
          data: { id, name, children: [] },
        })),
      ],
      FIXED_NOW,
    )
    const bond = (studentId: string, parentId: string) => ({
      institutionId: institution.id,
      id: randomUUID(),
      studentId,
      parentId,
      relationship: 'mother' as const,
      custody: 'full' as const,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })
    await db
      .insert(studentGuardians)
      .values([bond('s-1', 'p-ayse'), bond('s-2', 'p-ayse'), bond('s-3', 'p-kemal')])
    return { institution, cookie: await signInAs(app, institution.admin) }
  }

  const email = () => `veli-${randomUUID().slice(0, 8)}@kampus.example`
  const body = (patch: object = {}) => ({
    email: email(),
    name: 'Ayşe Yılmaz',
    studentIds: ['s-1', 's-2'],
    parentId: 'p-ayse',
    ...patch,
  })

  async function audits(institutionId: string) {
    return db
      .select({ entityId: auditLog.entityId, changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, 'guardian.invite')))
  }

  async function membershipOf(institutionId: string, address: string) {
    const [row] = await db
      .select({ id: memberships.id, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.institutionId, institutionId), eq(users.email, address)))
    return row ?? null
  }

  async function bonds(institutionId: string) {
    return db
      .select({
        studentId: studentGuardians.studentId,
        parentId: studentGuardians.parentId,
        membershipId: studentGuardians.membershipId,
        version: studentGuardians.version,
      })
      .from(studentGuardians)
      .where(eq(studentGuardians.institutionId, institutionId))
      .orderBy(asc(studentGuardians.studentId))
  }

  async function childLinks(membershipId: string) {
    const rows = await db
      .select({ kind: membershipLinks.kind, recordId: membershipLinks.recordId })
      .from(membershipLinks)
      .where(eq(membershipLinks.membershipId, membershipId))
    return rows.sort((a, b) => a.recordId.localeCompare(b.recordId))
  }

  /** Kurumun yazma izi: üyelik, davet, bağ ve denetim sayıları (kayıt değişmedi denetimi). */
  async function snapshot(institutionId: string) {
    const count = async (rows: Promise<unknown[]>) => (await rows).length
    return {
      memberships: await count(
        db.select().from(memberships).where(eq(memberships.institutionId, institutionId)),
      ),
      invitations: await count(
        db.select().from(invitations).where(eq(invitations.institutionId, institutionId)),
      ),
      links: await count(
        db.select().from(membershipLinks).where(eq(membershipLinks.institutionId, institutionId)),
      ),
      bonds: await bonds(institutionId),
      audits: (await audits(institutionId)).length,
    }
  }

  async function firstLogin(address: string, password: string) {
    const mail = mailer.lastTo(address)
    assert.ok(mail, 'parola belirleme iletisi yok')
    const token = decodeURIComponent(new URL(mail.url).hash.replace('#token=', ''))
    const reset = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      headers: { origin: TEST_ORIGIN, 'content-type': 'application/json' },
      remoteAddress: nextIp(),
      payload: { token, newPassword: password },
    })
    assert.equal(reset.statusCode, 200, reset.body)
    return signInAs(app, { email: address, password })
  }

  const read = (cookie: string, url: string) =>
    app.inject({ method: 'GET', url, headers: { origin: TEST_ORIGIN, cookie } })

  test('DOM-YTK-071: oturumsuz 401; öğretmen, veli ve öğrenci 403; eski oturum 403 reauthentication_required', async () => {
    const { institution } = await kurum()
    const before = await snapshot(institution.id)
    const payload = body()
    assert.equal((await invite(undefined, payload)).statusCode, 401)
    for (const role of ['ogretmen', 'veli', 'ogrenci'] as const) {
      const member = await createMember(app, institution.id, role)
      const denied = await invite(await signInAs(app, member), payload)
      assert.equal(denied.statusCode, 403, role)
      assert.equal(denied.json().code, 'forbidden')
    }
    const stale = await invite(await signInAs(app, institution.admin), payload, {
      target: staleApp,
    })
    assert.equal(stale.statusCode, 403)
    assert.equal(stale.json().code, 'reauthentication_required')
    assert.equal(await membershipOf(institution.id, payload.email), null)
    const after = await snapshot(institution.id)
    // Rol testi için açılan üyelikler dışında hiçbir şey yazılmadı.
    assert.deepEqual({ ...after, memberships: before.memberships }, before)
  })

  test('DOM-YTK-071: anahtarsız 400, geçersiz gövde 400 ve hiçbir kayıt değişmez', async () => {
    const { institution, cookie } = await kurum()
    const before = await snapshot(institution.id)
    const missingKey = await invite(cookie, body(), { key: null })
    assert.equal(missingKey.statusCode, 400)
    assert.equal(missingKey.json().code, 'idempotency_key_required')
    for (const payload of [
      body({ studentIds: [] }),
      body({ studentIds: ['s-1', 's-1'] }),
      body({ studentIds: Array.from({ length: 11 }, (_, i) => `s-${i}`) }),
      body({ email: 'gecersiz' }),
      body({ name: 'A' }),
      body({ role: 'veli' }),
      body({ institutionId: institution.id }),
    ]) {
      const response = await invite(cookie, payload)
      assert.equal(response.statusCode, 400, response.body)
      assert.equal(response.json().code, 'validation_failed')
    }
    assert.deepEqual(await snapshot(institution.id), before)
  })

  test('DOM-YTK-071: davet hesap, veli üyeliği, çocuk bağlantıları ve velayet bağlarını tek işlemde açar; ön büro da davet eder', async () => {
    const { institution, cookie } = await kurum()
    const payload = body({ email: email().toUpperCase() })
    const address = payload.email.toLowerCase()
    const key = randomUUID()
    const response = await invite(cookie, payload, { key })
    assert.equal(response.statusCode, 201, response.body)
    assert.equal(response.headers.location, ENDPOINT)
    const data = response.json().data
    assert.deepEqual(Object.keys(data).sort(), [
      'createdAt',
      'email',
      'expiresAt',
      'id',
      'name',
      'parentId',
      'role',
      'status',
      'studentIds',
    ])
    assert.equal(data.email, address)
    assert.equal(data.role, 'veli')
    assert.equal(data.status, 'pending')
    assert.deepEqual(data.studentIds, ['s-1', 's-2'])
    assert.equal(data.parentId, 'p-ayse')

    const member = await membershipOf(institution.id, address)
    assert.ok(member)
    assert.equal(member.role, 'veli')
    assert.deepEqual(await childLinks(member.id), [
      { kind: 'child', recordId: 's-1' },
      { kind: 'child', recordId: 's-2' },
    ])
    assert.deepEqual(await bonds(institution.id), [
      { studentId: 's-1', parentId: 'p-ayse', membershipId: member.id, version: 2 },
      { studentId: 's-2', parentId: 'p-ayse', membershipId: member.id, version: 2 },
      { studentId: 's-3', parentId: 'p-kemal', membershipId: null, version: 1 },
    ])
    const [stored] = await db
      .select({
        membershipId: invitations.membershipId,
        studentIds: invitations.studentIds,
        parentId: invitations.parentId,
      })
      .from(invitations)
      .where(eq(invitations.id, data.id))
    assert.deepEqual(stored, {
      membershipId: member.id,
      studentIds: ['s-1', 's-2'],
      parentId: 'p-ayse',
    })
    const audit = await audits(institution.id)
    assert.equal(audit.length, 1)
    assert.deepEqual(audit[0]?.changes, {
      fields: ['email', 'name', 'role', 'studentIds', 'parentId'],
    })
    assert.ok(!JSON.stringify(audit).includes(address), 'denetimde e-posta yok')
    assert.ok(mailer.lastTo(address), 'parola belirleme bağlantısı gitti')
    // Personel davet listesi veli davetini göstermez.
    const staff = await read(cookie, '/api/v1/institution-members/invitations')
    assert.equal(staff.json().meta.total, 0)

    // Aynı anahtar ilk yanıtı tekrarlar; ikinci hesap ya da ileti yok.
    const sent = mailer.outbox.length
    const replay = await invite(cookie, payload, { key })
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal(replay.json().data.id, data.id)
    assert.equal(mailer.outbox.length, sent)
    assert.equal((await audits(institution.id)).length, 1)

    // Ön büro da davet eder; veli kaydı verilmeyen davet bağ yazmaz.
    const frontDesk = await createMember(app, institution.id, 'onburo')
    const plain = await invite(
      await signInAs(app, frontDesk),
      body({ studentIds: ['s-3'], parentId: undefined }),
    )
    assert.equal(plain.statusCode, 201, plain.body)
    assert.equal(plain.json().data.parentId, null)
    assert.equal((await bonds(institution.id))[2]?.membershipId, null)
  })

  test('DOM-YTK-071: davet edilen veli ilk girişten sonra yalnız kendi çocuklarını okur; veli kaydı verilmeyen hesap kapsam almaz', async () => {
    const { cookie } = await kurum()
    const withRecord = body({ studentIds: ['s-1'] })
    assert.equal((await invite(cookie, withRecord)).statusCode, 201)
    const parent = await firstLogin(withRecord.email, 'Ayse-Veli-Parolasi-7')
    const [row] = await db
      .select({ status: invitations.status })
      .from(invitations)
      .where(eq(invitations.email, withRecord.email))
    assert.equal(row?.status, 'accepted')
    const own = await read(parent, '/api/v1/collections/students/s-1')
    assert.equal(own.statusCode, 200, own.body)
    assert.equal(own.json().data.record.name, 'Deniz Yılmaz')
    for (const id of ['s-2', 's-3'])
      assert.equal((await read(parent, `/api/v1/collections/students/${id}`)).statusCode, 404, id)
    const guardians = await read(parent, '/api/v1/students/s-1/guardians')
    assert.equal(guardians.statusCode, 200)
    assert.equal(guardians.json().data.length, 1)

    // Veli kaydı verilmeden açılan hesap: çocuk bağlantısı velayet bağı olmadan kapsam vermez.
    const bare = body({ studentIds: ['s-3'], parentId: undefined })
    assert.equal((await invite(cookie, bare)).statusCode, 201)
    const unbound = await firstLogin(bare.email, 'Kemal-Veli-Parolasi-7')
    assert.equal((await read(unbound, '/api/v1/collections/students/s-3')).statusCode, 404)
  })

  test('DOM-YTK-071: başka kurumun öğrencisi ya da veli kaydı 404 ve hiçbir kurum değişmez', async () => {
    const { institution, cookie } = await kurum()
    const other = await kurum()
    await insertMissingRecords(
      db,
      other.institution.id,
      [
        { collection: 'students', id: 's-b', data: { id: 's-b', name: 'Öteki', classId: '9-A' } },
        { collection: 'parents', id: 'p-b', data: { id: 'p-b', name: 'Öteki Veli', children: [] } },
      ],
      FIXED_NOW,
    )
    const before = await snapshot(institution.id)
    const otherBefore = await snapshot(other.institution.id)
    for (const payload of [
      body({ studentIds: ['s-1', 's-b'], parentId: undefined }),
      body({ studentIds: ['s-yok'] }),
      body({ parentId: 'p-b' }),
      body({ parentId: 'p-yok' }),
    ]) {
      const response = await invite(cookie, payload)
      assert.equal(response.statusCode, 404, response.body)
      assert.equal(response.json().code, 'not_found')
    }
    assert.deepEqual(await snapshot(institution.id), before)
    assert.deepEqual(await snapshot(other.institution.id), otherBefore)
  })

  test('DOM-YTK-071: kurumda kayıtlı e-posta member_exists, bekleyen davet invitation_exists (409); kayıt değişmez', async () => {
    const { institution, cookie } = await kurum()
    const existing = await createMember(app, institution.id, 'veli')
    const before = await snapshot(institution.id)
    const member = await invite(cookie, body({ email: existing.email }))
    assert.equal(member.statusCode, 409)
    assert.equal(member.json().code, 'member_exists')
    assert.deepEqual(await snapshot(institution.id), before)

    const first = body({ studentIds: ['s-3'], parentId: undefined })
    assert.equal((await invite(cookie, first)).statusCode, 201)
    // Yeni hesabın üyeliği davette açılır: aynı e-posta artık kurumda kayıtlıdır.
    const again = await invite(cookie, { ...first, studentIds: ['s-1'] })
    assert.equal(again.statusCode, 409)
    assert.equal(again.json().code, 'member_exists')
    const other = await createInstitution(app)
    const elsewhere = await createMember(app, other.id, 'ogretmen')
    assert.equal(
      (await invite(cookie, body({ email: elsewhere.email, parentId: undefined }))).statusCode,
      201,
    )
    const repeat = await invite(cookie, body({ email: elsewhere.email, parentId: undefined }))
    assert.equal(repeat.statusCode, 409)
    assert.equal(repeat.json().code, 'invitation_exists')
  })

  test('DOM-YTK-071: veli kaydı öğrencinin velisi değilse 422 guardian_record_not_linked, başka hesapla eşlenmişse 422 guardian_identity_mismatch, bağlıysa 409 guardian_link_exists', async () => {
    const { institution, cookie } = await kurum()
    const before = await snapshot(institution.id)
    const notLinked = await invite(cookie, body({ studentIds: ['s-1', 's-3'] }))
    assert.equal(notLinked.statusCode, 422, notLinked.body)
    assert.equal(notLinked.json().code, 'guardian_record_not_linked')
    assert.deepEqual(await snapshot(institution.id), before)

    // Ayşe'nin kaydı Deniz'de mevcut bir veli hesabına bağlıdır (bağ ucuyla kurulmuş eşleme);
    // Ece'yi aynı kayıtla yeni hesaba bağlamak eşleşmez, Deniz'in bağı zaten hesaplıdır.
    const account = await createMember(app, institution.id, 'veli')
    await db
      .update(studentGuardians)
      .set({ membershipId: account.membershipId })
      .where(
        and(
          eq(studentGuardians.institutionId, institution.id),
          eq(studentGuardians.studentId, 's-1'),
        ),
      )
    const middle = await snapshot(institution.id)
    const mismatch = await invite(cookie, body({ studentIds: ['s-2'] }))
    assert.equal(mismatch.statusCode, 422, mismatch.body)
    assert.equal(mismatch.json().code, 'guardian_identity_mismatch')
    const linked = await invite(cookie, body({ studentIds: ['s-1'] }))
    assert.equal(linked.statusCode, 409, linked.body)
    assert.equal(linked.json().code, 'guardian_link_exists')
    assert.deepEqual(await snapshot(institution.id), middle)
  })

  test('DOM-YTK-071: başka kurumda hesabı olan e-postada yanıt aynıdır; üyelik, bağlantı ve bağ yazılmaz, ileti gitmez (karar 73)', async () => {
    const { institution, cookie } = await kurum()
    const other = await createInstitution(app)
    const existing = await createMember(app, other.id, 'veli')
    const [account] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, existing.id))
    const realName = account?.name ?? ''
    assert.notEqual(realName, '')
    const sentBefore = mailer.outbox.length

    const fresh = await invite(cookie, body({ studentIds: ['s-3'], parentId: 'p-kemal' }))
    const response = await invite(cookie, body({ email: existing.email, name: 'Farklı Ad' }))
    assert.equal(response.statusCode, 201, response.body)
    assert.equal(response.statusCode, fresh.statusCode)
    assert.equal(response.headers.location, fresh.headers.location)
    assert.deepEqual(Object.keys(response.json()).sort(), Object.keys(fresh.json()).sort())
    assert.deepEqual(
      Object.keys(response.json().data).sort(),
      Object.keys(fresh.json().data).sort(),
    )
    const data = response.json().data
    assert.equal(data.name, 'Farklı Ad')
    assert.equal(data.status, 'pending')
    assert.deepEqual(data.studentIds, ['s-1', 's-2'])
    assert.equal(data.parentId, 'p-ayse')
    assert.ok(!response.body.includes(realName), 'gerçek ad yanıtta yok')
    assert.ok(!response.body.includes(other.id), 'başka kurum yanıtta yok')
    // Denetim alanları da aynıdır.
    const audit = await audits(institution.id)
    assert.deepEqual(audit[0]?.changes, audit[1]?.changes)

    // Üyelik, çocuk bağlantısı ve velayet bağı yazılmaz; seçimler davette saklanır.
    assert.equal(await membershipOf(institution.id, existing.email), null)
    const ayse = (await bonds(institution.id)).filter((row) => row.parentId === 'p-ayse')
    assert.ok(ayse.every((row) => row.membershipId === null && row.version === 1))
    const [stored] = await db
      .select({
        membershipId: invitations.membershipId,
        studentIds: invitations.studentIds,
        parentId: invitations.parentId,
      })
      .from(invitations)
      .where(eq(invitations.id, data.id))
    assert.deepEqual(stored, { membershipId: null, studentIds: ['s-1', 's-2'], parentId: 'p-ayse' })
    // Bekleyen davetin tuttuğu veli kaydı başka davete bağlanamaz (yeni hesapla aynı kod).
    const held = await invite(cookie, body({ studentIds: ['s-1'] }))
    assert.equal(held.statusCode, 409, held.body)
    assert.equal(held.json().code, 'guardian_link_exists')

    // Yalnız yeni hesaba bağlantı gitti; mevcut hesaba ileti ve belirteç yok.
    assert.equal(mailer.lastTo(existing.email), undefined)
    assert.equal(mailer.outbox.length, sentBefore + 1)
    const tokens = await db.select().from(verifications).where(eq(verifications.value, existing.id))
    assert.equal(tokens.length, 0)
    // Personel iptal ucu veli davetini bulmaz (velayet bağı silinmesin).
    const cancel = await app.inject({
      method: 'POST',
      url: `/api/v1/institution-members/invitations/${fresh.json().data.id}/cancel`,
      headers: { origin: TEST_ORIGIN, cookie },
    })
    assert.equal(cancel.statusCode, 404)
  })

  test('DOM-YTK-071: ilk girişten önce parola yok; davet edilen hesap parola belirlemeden giriş yapamaz', async () => {
    const { cookie } = await kurum()
    const payload = body({ studentIds: ['s-1'] })
    assert.equal((await invite(cookie, payload)).statusCode, 201)
    assert.notEqual((await signIn(app, payload.email, 'Ayse-Veli-Parolasi-7')).statusCode, 200)
  })
})
