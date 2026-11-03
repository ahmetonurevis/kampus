import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, isNull } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import { SESSION_FRESH_AGE_SECONDS } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  institutions,
  invitations,
  memberships,
  sessions,
  users,
  verifications,
} from '../src/db/schema/auth.ts'
import { membershipLinks } from '../src/db/schema/membership-links.ts'
import { AppError } from '../src/errors.ts'
import type { ServiceContext } from '../src/plugins/authenticate.ts'
import { MemoryMailer } from '../src/services/mailer.ts'
import { changeStaffRole, setStaffActive } from '../src/services/staff-accounts.ts'
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
  type TestUser,
} from './support/app.ts'

/**
 * Personel daveti, rol değiştirme ve pasifleştirme (IST-007, DOM-YTK-070). Yalnız yönetici, taze
 * oturum; yazma, Better Auth satırları ve denetim kaydı tek transaction'da.
 */
describe('personel hesapları (DOM-YTK-070)', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let staleApp: App
  const mailer = new MemoryMailer()

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { mailer })
    // Aynı veritabanında saati oturumdan 16 dakika ileri olan uygulama: oturum taze değildir.
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

  function post(
    url: string,
    options: { cookie?: string; payload?: object; key?: string | null; target?: App } = {},
  ) {
    const key = options.key === undefined ? randomUUID() : options.key
    return (options.target ?? app).inject({
      method: 'POST',
      url,
      headers: {
        origin: TEST_ORIGIN,
        ...(options.cookie ? { cookie: options.cookie } : {}),
        ...(options.payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...(key === null ? {} : { 'idempotency-key': key }),
      },
      ...(options.payload === undefined ? {} : { payload: options.payload }),
    })
  }

  const invite = (cookie: string | undefined, payload: object, key?: string | null) =>
    post('/api/v1/institution-members/invitations', {
      ...(cookie ? { cookie } : {}),
      payload,
      ...(key === undefined ? {} : { key }),
    })

  async function kurum(): Promise<{ institution: TestInstitution; cookie: string }> {
    const institution = await createInstitution(app)
    await insertMissingRecords(
      db,
      institution.id,
      [
        { collection: 'teachers', id: 't-a', data: { id: 't-a', name: 'Selin Kaya' } },
        { collection: 'teachers', id: 't-b', data: { id: 't-b', name: 'Mert Ak' } },
      ],
      FIXED_NOW,
    )
    return { institution, cookie: await signInAs(app, institution.admin) }
  }

  const email = () => `personel-${randomUUID().slice(0, 8)}@kampus.example`

  async function audits(institutionId: string, action: string) {
    return db
      .select({ entityId: auditLog.entityId, changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))
  }

  async function membershipOf(institutionId: string, address: string) {
    const [row] = await db
      .select({ id: memberships.id, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.institutionId, institutionId), eq(users.email, address)))
    return row ?? null
  }

  function tokenFor(address: string): string {
    const mail = mailer.lastTo(address)
    assert.ok(mail, 'ileti yok')
    const token = new URL(mail.url).hash.replace('#token=', '')
    return decodeURIComponent(token)
  }

  describe('POST /institution-members/invitations', () => {
    test('DOM-YTK-070: oturumsuz 401, yönetici dışı 403, eski oturum 403 reauthentication_required', async () => {
      const { institution } = await kurum()
      const body = { email: email(), name: 'Ali Veli', role: 'onburo' }
      assert.equal((await invite(undefined, body)).statusCode, 401)

      const teacher = await createMember(app, institution.id, 'ogretmen')
      const denied = await invite(await signInAs(app, teacher), body)
      assert.equal(denied.statusCode, 403)
      assert.equal(denied.json().code, 'forbidden')

      const stale = await post('/api/v1/institution-members/invitations', {
        cookie: await signInAs(app, institution.admin),
        payload: body,
        target: staleApp,
      })
      assert.equal(stale.statusCode, 403)
      assert.equal(stale.json().code, 'reauthentication_required')
      assert.equal(await membershipOf(institution.id, body.email), null)
    })

    test('DOM-YTK-070: anahtarsız 400, geçersiz gövde 400 ve hiçbir kayıt açılmaz', async () => {
      const { institution, cookie } = await kurum()
      const address = email()
      const missingKey = await invite(cookie, { email: address, name: 'Ali', role: 'onburo' }, null)
      assert.equal(missingKey.statusCode, 400)
      assert.equal(missingKey.json().code, 'idempotency_key_required')

      for (const payload of [
        { email: address, name: 'Ali', role: 'onburo', teacherId: 't-a' },
        { email: address, name: 'Ali', role: 'veli' },
        { email: 'gecersiz', name: 'Ali', role: 'onburo' },
        { email: address, name: 'Ali', role: 'onburo', institutionId: 'x' },
      ]) {
        const response = await invite(cookie, payload)
        assert.equal(response.statusCode, 400, response.body)
      }
      assert.equal(await membershipOf(institution.id, address), null)
      const [user] = await db.select().from(users).where(eq(users.email, address))
      assert.equal(user, undefined)
      assert.equal((await audits(institution.id, 'staff.invite')).length, 0)
    })

    test('DOM-YTK-070: davet hesap, üyelik, öğretmen bağlantısı ve bekleyen daveti açar; bağlantı gider', async () => {
      const { institution, cookie } = await kurum()
      const address = email()
      const key = randomUUID()
      const response = await invite(
        cookie,
        { email: address.toUpperCase(), name: 'Selin Kaya', role: 'ogretmen', teacherId: 't-a' },
        key,
      )
      assert.equal(response.statusCode, 201, response.body)
      assert.equal(response.headers.location, '/api/v1/institution-members/invitations')
      const data = response.json().data
      assert.equal(data.email, address)
      assert.equal(data.name, 'Selin Kaya')
      assert.equal(data.role, 'ogretmen')
      assert.equal(data.status, 'pending')

      const member = await membershipOf(institution.id, address)
      assert.ok(member)
      assert.equal(member.role, 'ogretmen')
      assert.equal('membershipId' in data, false, 'üyelik kimliği yanıtta yok')
      const [stored] = await db
        .select({ membershipId: invitations.membershipId, name: invitations.name })
        .from(invitations)
        .where(eq(invitations.id, data.id))
      assert.deepEqual(stored, { membershipId: member.id, name: 'Selin Kaya' })
      const links = await db
        .select({ kind: membershipLinks.kind, recordId: membershipLinks.recordId })
        .from(membershipLinks)
        .where(eq(membershipLinks.membershipId, member.id))
      assert.deepEqual(links, [{ kind: 'teacher', recordId: 't-a' }])
      const audit = await audits(institution.id, 'staff.invite')
      assert.equal(audit.length, 1)
      assert.deepEqual(audit[0]?.changes, { fields: ['email', 'name', 'role', 'teacherId'] })
      assert.ok(!JSON.stringify(audit).includes(address), 'denetimde e-posta yok')
      assert.ok(mailer.lastTo(address), 'parola belirleme bağlantısı gitti')

      const list = await app.inject({
        method: 'GET',
        url: '/api/v1/institution-members/invitations',
        headers: { origin: TEST_ORIGIN, cookie },
      })
      assert.equal(list.statusCode, 200)
      assert.deepEqual(
        list.json().data.map((row: { id: string }) => row.id),
        [data.id],
      )

      // Aynı anahtar ilk yanıtı tekrarlar; ikinci hesap ya da ileti yok.
      const sent = mailer.outbox.length
      const replay = await invite(
        cookie,
        { email: address.toUpperCase(), name: 'Selin Kaya', role: 'ogretmen', teacherId: 't-a' },
        key,
      )
      assert.equal(replay.statusCode, 201)
      assert.equal(replay.headers['idempotent-replayed'], 'true')
      assert.equal(replay.json().data.id, data.id)
      assert.equal(mailer.outbox.length, sent)

      // Yeni anahtarla aynı e-posta: kurumda kayıtlı.
      const again = await invite(cookie, { email: address, name: 'Selin', role: 'onburo' })
      assert.equal(again.statusCode, 409)
      assert.equal(again.json().code, 'member_exists')
      // Aynı öğretmen kaydı başka hesaba bağlanamaz; olmayan kayıt 404.
      const linked = await invite(cookie, {
        email: email(),
        name: 'Başka',
        role: 'ogretmen',
        teacherId: 't-a',
      })
      assert.equal(linked.statusCode, 409)
      assert.equal(linked.json().code, 'teacher_already_linked')
      const missing = await invite(cookie, {
        email: email(),
        name: 'Başka',
        role: 'ogretmen',
        teacherId: 't-yok',
      })
      assert.equal(missing.statusCode, 404)
      assert.equal((await audits(institution.id, 'staff.invite')).length, 1)
    })

    test('DOM-YTK-070: başka kurumun öğretmen kaydı 404', async () => {
      const { cookie } = await kurum()
      const other = await createInstitution(app)
      await insertMissingRecords(
        db,
        other.id,
        [{ collection: 'teachers', id: 't-baska', data: { id: 't-baska', name: 'Öteki' } }],
        FIXED_NOW,
      )
      const response = await invite(cookie, {
        email: email(),
        name: 'Öteki',
        role: 'ogretmen',
        teacherId: 't-baska',
      })
      assert.equal(response.statusCode, 404)
    })

    test('DOM-YTK-070: davet edilen parolasını belirler, ilk girişte davet kabul edilir', async () => {
      const { institution, cookie } = await kurum()
      const address = email()
      const created = await invite(cookie, { email: address, name: 'Yeni Kişi', role: 'onburo' })
      assert.equal(created.statusCode, 201)
      // Parola yokken giriş yapılamaz.
      assert.notEqual((await signIn(app, address, 'Yeni-Personel-Parolasi-7')).statusCode, 200)

      const reset = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset-password',
        headers: { origin: TEST_ORIGIN, 'content-type': 'application/json' },
        remoteAddress: nextIp(),
        payload: { token: tokenFor(address), newPassword: 'Yeni-Personel-Parolasi-7' },
      })
      assert.equal(reset.statusCode, 200, reset.body)
      const login = await signIn(app, address, 'Yeni-Personel-Parolasi-7')
      assert.equal(login.statusCode, 200)
      const [row] = await db
        .select({ status: invitations.status })
        .from(invitations)
        .where(eq(invitations.id, created.json().data.id))
      assert.equal(row?.status, 'accepted')
      const cancel = await post(
        `/api/v1/institution-members/invitations/${created.json().data.id}/cancel`,
        { cookie },
      )
      assert.equal(cancel.statusCode, 409)
      assert.equal(cancel.json().code, 'invitation_not_pending')
      assert.ok(await membershipOf(institution.id, address))
    })

    test('DOM-YTK-070: bekleyen davetler yalnız yöneticiye; başka kurumun daveti listede yok', async () => {
      const { institution, cookie } = await kurum()
      const other = await kurum()
      const own = await invite(cookie, { email: email(), name: 'Kendi', role: 'onburo' })
      const foreign = await invite(other.cookie, { email: email(), name: 'Öteki', role: 'onburo' })
      assert.equal(own.statusCode, 201)
      assert.equal(foreign.statusCode, 201)
      const list = (target: string | undefined, url = '/api/v1/institution-members/invitations') =>
        app.inject({
          method: 'GET',
          url,
          headers: { origin: TEST_ORIGIN, ...(target ? { cookie: target } : {}) },
        })
      assert.equal((await list(undefined)).statusCode, 401)
      const teacher = await createMember(app, institution.id, 'ogretmen')
      assert.equal((await list(await signInAs(app, teacher))).statusCode, 403)
      const response = await list(cookie)
      assert.equal(response.statusCode, 200)
      assert.deepEqual(
        response.json().data.map((row: { id: string }) => row.id),
        [own.json().data.id],
      )
      assert.equal(response.json().meta.total, 1)
      const injected = await list(
        cookie,
        `/api/v1/institution-members/invitations?institutionId=${other.institution.id}`,
      )
      assert.equal(injected.statusCode, 400)
    })

    test('DOM-YTK-070: başka kurumda hesabı olan e-postaya davet üyelik açmaz, ileti göndermez, yanıt yeni hesaptakiyle aynıdır (karar 73)', async () => {
      const { institution, cookie } = await kurum()
      const other = await createInstitution(app)
      const existing = await createMember(app, other.id, 'ogretmen')
      const [account] = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, existing.id))
      const realName = account?.name ?? ''
      assert.notEqual(realName, '')
      const sentBefore = mailer.outbox.length

      const fresh = await invite(cookie, { email: email(), name: 'Yeni Kişi', role: 'onburo' })
      const response = await invite(cookie, {
        email: existing.email,
        name: 'Farklı Ad',
        role: 'ogretmen',
        teacherId: 't-a',
      })
      // Aynı durum kodu, aynı anahtarlar; ad yöneticinin girdiği, gerçek ad hiçbir alanda yok.
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
      assert.equal(data.email, existing.email)
      assert.ok(!response.body.includes(realName), 'gerçek ad yanıtta yok')
      assert.ok(!response.body.includes(other.id), 'başka kurum yanıtta yok')

      // Üyelik ve öğretmen bağlantısı açılmaz; hesap ve adı değişmez.
      assert.equal(await membershipOf(institution.id, existing.email), null)
      const [user] = await db.select().from(users).where(eq(users.email, existing.email))
      assert.equal(user?.id, existing.id)
      assert.equal(user?.name, realName)
      const links = await db
        .select()
        .from(membershipLinks)
        .where(
          and(
            eq(membershipLinks.institutionId, institution.id),
            eq(membershipLinks.recordId, 't-a'),
          ),
        )
      assert.equal(links.length, 0)
      const [stored] = await db
        .select({ membershipId: invitations.membershipId, name: invitations.name })
        .from(invitations)
        .where(eq(invitations.id, data.id))
      assert.deepEqual(stored, { membershipId: null, name: 'Farklı Ad' })

      // Parola sıfırlama iletisi ve belirteci yok; yalnız yeni hesaba bağlantı gitti.
      assert.equal(mailer.lastTo(existing.email), undefined)
      assert.equal(mailer.outbox.length, sentBefore + 1)
      const tokens = await db
        .select()
        .from(verifications)
        .where(eq(verifications.value, existing.id))
      assert.equal(tokens.length, 0)

      // Denetim alanları iki davette aynı.
      const audit = await audits(institution.id, 'staff.invite')
      assert.deepEqual(
        audit.map((row) => JSON.stringify(row.changes)).sort(),
        [{ fields: ['email', 'name', 'role'] }, { fields: ['email', 'name', 'role', 'teacherId'] }]
          .map((changes) => JSON.stringify(changes))
          .sort(),
      )

      // Bekleyen davetler listesi girilen adı gösterir.
      const list = await app.inject({
        method: 'GET',
        url: '/api/v1/institution-members/invitations',
        headers: { origin: TEST_ORIGIN, cookie },
      })
      const listed = list.json().data.find((row: { id: string }) => row.id === data.id)
      assert.equal(listed?.name, 'Farklı Ad')
      assert.ok(!list.body.includes(realName))

      // Mevcut hesabın girişi daveti kabul etmez ve üyelik açmaz.
      const login = await signIn(app, existing.email, existing.password)
      assert.equal(login.statusCode, 200)
      const [after] = await db
        .select({ status: invitations.status })
        .from(invitations)
        .where(eq(invitations.id, data.id))
      assert.equal(after?.status, 'pending')
      assert.equal(await membershipOf(institution.id, existing.email), null)

      // İptal yalnız daveti kapatır: hesaba ve başka kurumdaki üyeliğe dokunulmaz.
      const cancel = await post(`/api/v1/institution-members/invitations/${data.id}/cancel`, {
        cookie,
      })
      assert.equal(cancel.statusCode, 200, cancel.body)
      assert.equal(cancel.json().data.status, 'canceled')
      assert.equal(cancel.json().data.name, 'Farklı Ad')
      assert.ok(await membershipOf(other.id, existing.email))
      assert.equal(
        (await db.select().from(users).where(eq(users.id, existing.id))).length,
        1,
        'hesap silinmedi',
      )
      assert.deepEqual(
        (await audits(institution.id, 'staff.invitation_cancel')).map((row) => row.changes),
        [{ fields: ['status'] }],
      )
    })
  })

  describe('POST /institution-members/invitations/:invitationId/cancel', () => {
    test('DOM-YTK-070: başka kurumun davetini iptal edemez; iptal üyeliği ve parolasız hesabı siler; ikinci iptal 409', async () => {
      const { institution, cookie } = await kurum()
      const address = email()
      const created = await invite(cookie, {
        email: address,
        name: 'İptal',
        role: 'ogretmen',
        teacherId: 't-b',
      })
      const id: string = created.json().data.id
      const url = `/api/v1/institution-members/invitations/${id}/cancel`

      const teacher = await createMember(app, institution.id, 'ogretmen')
      assert.equal((await post(url, { cookie: await signInAs(app, teacher) })).statusCode, 403)
      assert.equal((await post(url)).statusCode, 401)
      const stale = await post(url, { cookie, target: staleApp })
      assert.equal(stale.json().code, 'reauthentication_required')

      const other = await kurum()
      assert.equal((await post(url, { cookie: other.cookie })).statusCode, 404)
      assert.ok(await membershipOf(institution.id, address), 'başka kurumun iptali yazmadı')

      const response = await post(url, { cookie })
      assert.equal(response.statusCode, 200, response.body)
      assert.equal(response.json().data.status, 'canceled')
      assert.equal(await membershipOf(institution.id, address), null)
      const [user] = await db.select().from(users).where(eq(users.email, address))
      assert.equal(user, undefined)
      assert.deepEqual(
        (await audits(institution.id, 'staff.invitation_cancel')).map((row) => row.changes),
        [{ fields: ['status', 'membership', 'user'] }],
      )
      const twice = await post(url, { cookie })
      assert.equal(twice.statusCode, 409)
      assert.equal(twice.json().code, 'invitation_not_pending')
      // Öğretmen kaydı yeniden bağlanabilir.
      const relink = await invite(cookie, {
        email: email(),
        name: 'Yeni',
        role: 'ogretmen',
        teacherId: 't-b',
      })
      assert.equal(relink.statusCode, 201)
    })
  })

  describe('POST /institution-members/:membershipId/role', () => {
    test('DOM-YTK-070: 401, 403, başka kurum 404, 400 ve kayıt değişmez', async () => {
      const { institution, cookie } = await kurum()
      const teacher = await createMember(app, institution.id, 'ogretmen')
      const url = `/api/v1/institution-members/${teacher.membershipId}/role`
      assert.equal((await post(url, { payload: { role: 'onburo' } })).statusCode, 401)
      const denied = await post(url, {
        cookie: await signInAs(app, teacher),
        payload: { role: 'onburo' },
      })
      assert.equal(denied.statusCode, 403)
      const stale = await post(url, { cookie, payload: { role: 'onburo' }, target: staleApp })
      assert.equal(stale.json().code, 'reauthentication_required')
      const other = await kurum()
      assert.equal(
        (await post(url, { cookie: other.cookie, payload: { role: 'onburo' } })).statusCode,
        404,
      )
      for (const payload of [{ role: 'veli' }, { role: 'onburo', extra: true }, {}]) {
        assert.equal((await post(url, { cookie, payload })).statusCode, 400)
      }
      const [row] = await db
        .select({ role: memberships.role })
        .from(memberships)
        .where(eq(memberships.id, teacher.membershipId))
      assert.equal(row?.role, 'ogretmen')
      assert.equal((await audits(institution.id, 'staff.role_change')).length, 0)
    })

    test('DOM-YTK-070: rol değişir, kalıcıdır; aynı rol yazmaz', async () => {
      const { institution, cookie } = await kurum()
      const teacher = await createMember(app, institution.id, 'ogretmen')
      const url = `/api/v1/institution-members/${teacher.membershipId}/role`
      const response = await post(url, { cookie, payload: { role: 'onburo' } })
      assert.equal(response.statusCode, 200, response.body)
      assert.equal(response.json().data.role, 'onburo')
      assert.equal(response.json().data.id, teacher.membershipId)
      const [row] = await db
        .select({ role: memberships.role })
        .from(memberships)
        .where(eq(memberships.id, teacher.membershipId))
      assert.equal(row?.role, 'onburo')
      const same = await post(url, { cookie, payload: { role: 'onburo' } })
      assert.equal(same.statusCode, 200)
      const audit = await audits(institution.id, 'staff.role_change')
      assert.deepEqual(audit, [{ entityId: teacher.membershipId, changes: { fields: ['role'] } }])
    })

    test('DOM-YTK-070: kendi rolü, son yönetici ve öğrenci 422', async () => {
      const { institution, cookie } = await kurum()
      const self = await post(`/api/v1/institution-members/${institution.adminMembershipId}/role`, {
        cookie,
        payload: { role: 'ogretmen' },
      })
      assert.equal(self.statusCode, 422)
      assert.equal(self.json().code, 'self_role_change')

      const student = await createMember(app, institution.id, 'ogrenci')
      const notStaff = await post(`/api/v1/institution-members/${student.membershipId}/role`, {
        cookie,
        payload: { role: 'onburo' },
      })
      assert.equal(notStaff.statusCode, 422)
      assert.equal(notStaff.json().code, 'member_not_staff')

      // İkinci yönetici etkinken ilk yönetici düşürülebilir; sonra kalan tek yönetici korunur.
      const second = await createMember(app, institution.id, 'yonetici')
      const secondCookie = await signInAs(app, second)
      const demote = await post(
        `/api/v1/institution-members/${institution.adminMembershipId}/role`,
        {
          cookie: secondCookie,
          payload: { role: 'ogretmen' },
        },
      )
      assert.equal(demote.statusCode, 200, demote.body)
      const third = await createMember(app, institution.id, 'yonetici')
      const deactivate = await post(
        `/api/v1/institution-members/${third.membershipId}/deactivate`,
        {
          cookie: secondCookie,
        },
      )
      assert.equal(deactivate.statusCode, 200, deactivate.body)
      // Pasif yönetici sayılmaz: `second` son etkin yönetici. Kendi rolü zaten reddedilir; başka
      // yönetici yokken kural `last_admin` olarak çekirdek testinde sınanır.
      const last = await post(`/api/v1/institution-members/${third.membershipId}/role`, {
        cookie: secondCookie,
        payload: { role: 'onburo' },
      })
      assert.equal(last.statusCode, 422)
      assert.equal(last.json().code, 'member_deactivated')
    })
  })

  describe('POST /institution-members/:membershipId/deactivate ve /reactivate', () => {
    test('DOM-YTK-070: 401, 403, başka kurum 404, kendi hesabı ve son yönetici 422', async () => {
      const { institution, cookie } = await kurum()
      const teacher = await createMember(app, institution.id, 'ogretmen')
      const url = `/api/v1/institution-members/${teacher.membershipId}/deactivate`
      assert.equal((await post(url)).statusCode, 401)
      assert.equal((await post(url, { cookie: await signInAs(app, teacher) })).statusCode, 403)
      assert.equal(
        (await post(url, { cookie, target: staleApp })).json().code,
        'reauthentication_required',
      )
      const other = await kurum()
      assert.equal((await post(url, { cookie: other.cookie })).statusCode, 404)
      const [row] = await db
        .select({ deactivatedAt: memberships.deactivatedAt })
        .from(memberships)
        .where(eq(memberships.id, teacher.membershipId))
      assert.equal(row?.deactivatedAt, null)

      const self = await post(
        `/api/v1/institution-members/${institution.adminMembershipId}/deactivate`,
        { cookie },
      )
      assert.equal(self.statusCode, 422)
      assert.equal(self.json().code, 'self_deactivate')

      // Başka yönetici son etkin yöneticiyi pasifleştiremez.
      const second = await createMember(app, institution.id, 'yonetici')
      const secondCookie = await signInAs(app, second)
      const first = await post(
        `/api/v1/institution-members/${institution.adminMembershipId}/deactivate`,
        { cookie: secondCookie },
      )
      assert.equal(first.statusCode, 200, first.body)
      const last = await post(`/api/v1/institution-members/${second.membershipId}/deactivate`, {
        cookie: secondCookie,
      })
      assert.equal(last.json().code, 'self_deactivate')
      const roleOfLast = await post(`/api/v1/institution-members/${second.membershipId}/role`, {
        cookie: secondCookie,
        payload: { role: 'onburo' },
      })
      assert.equal(roleOfLast.json().code, 'self_role_change')
    })

    test('DOM-YTK-070: pasifleştirme oturumları kapatır, girişi kurumsuz bırakır; geri alma başka kurumda 404, kendi kurumunda açar', async () => {
      const { institution, cookie } = await kurum()
      const teacher = await createMember(app, institution.id, 'ogretmen', [
        { kind: 'teacher', recordId: 't-a' },
      ])
      const teacherCookie = await signInAs(app, teacher)
      const me = () =>
        app.inject({
          method: 'GET',
          url: '/api/v1/institution-members',
          headers: { origin: TEST_ORIGIN, cookie: teacherCookie },
        })
      assert.equal((await me()).statusCode, 403)

      const url = `/api/v1/institution-members/${teacher.membershipId}/deactivate`
      const response = await post(url, { cookie })
      assert.equal(response.statusCode, 200, response.body)
      assert.equal(response.json().data.status, 'passive')
      assert.equal(response.json().data.deactivatedAt, FIXED_NOW.toISOString())
      assert.equal((await me()).statusCode, 401, 'eski oturum kapandı')
      const left = await db.select().from(sessions).where(eq(sessions.userId, teacher.id))
      assert.equal(left.length, 0)

      // Yeniden giriş kurumsuz oturum açar: `/me` etkin kurumsuz ve üyeliksiz, kurum uçları 403.
      const again = await signInAs(app, teacher)
      const blocked = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: { origin: TEST_ORIGIN, cookie: again },
      })
      assert.equal(blocked.statusCode, 200, blocked.body)
      assert.equal(blocked.json().data.activeInstitution, null)
      assert.equal(blocked.json().data.activeMembership, null)
      assert.deepEqual(blocked.json().data.memberships, [])

      // Better Auth kurum uçları pasif üyeliği üyelik yokmuş gibi reddeder.
      const auth = (method: 'GET' | 'POST', path: string, payload?: object) =>
        app.inject({
          method,
          url: `/api/v1/auth${path}`,
          headers: { origin: TEST_ORIGIN, cookie: again },
          ...(payload === undefined ? {} : { payload }),
        })
      const switched = await auth('POST', '/organization/set-active', {
        organizationId: institution.id,
      })
      assert.equal(switched.statusCode, 403, switched.body)
      assert.equal(switched.json().message, 'Bu kurumda üyeliğiniz bulunmuyor.')
      const [{ slug } = { slug: '' }] = await db
        .select({ slug: institutions.slug })
        .from(institutions)
        .where(eq(institutions.id, institution.id))
      const bySlug = await auth('POST', '/organization/set-active', { organizationSlug: slug })
      assert.equal(bySlug.statusCode, 403, bySlug.body)
      const [unchanged] = await db
        .select({ active: sessions.activeInstitutionId })
        .from(sessions)
        .where(eq(sessions.userId, teacher.id))
      assert.equal(unchanged?.active, null)
      // Pasifleştirmeden önce açılmış (etkin kurumu bu kurum olan) oturumu taklit et.
      await db
        .update(sessions)
        .set({ activeInstitutionId: institution.id })
        .where(eq(sessions.userId, teacher.id))
      const member = await auth('GET', '/organization/get-active-member')
      assert.equal(member.statusCode, 403, member.body)
      assert.equal(member.json().message, 'Bu kurumda üyeliğiniz bulunmuyor.')
      await db
        .update(sessions)
        .set({ activeInstitutionId: null })
        .where(eq(sessions.userId, teacher.id))
      const lessons = await app.inject({
        method: 'GET',
        url: '/api/v1/institution-members/invitations',
        headers: { origin: TEST_ORIGIN, cookie: again },
      })
      assert.equal(lessons.statusCode, 403)
      assert.equal(lessons.json().code, 'no_active_institution')

      const twice = await post(url, { cookie })
      assert.equal(twice.statusCode, 200)
      assert.equal((await audits(institution.id, 'staff.deactivate')).length, 1)
      assert.deepEqual((await audits(institution.id, 'staff.deactivate'))[0]?.changes, {
        fields: ['deactivatedAt', 'sessions'],
      })

      const passiveList = await app.inject({
        method: 'GET',
        url: '/api/v1/institution-members?status=passive',
        headers: { origin: TEST_ORIGIN, cookie },
      })
      assert.deepEqual(
        passiveList.json().data.map((row: { id: string }) => row.id),
        [teacher.membershipId],
      )

      const reactivateUrl = `/api/v1/institution-members/${teacher.membershipId}/reactivate`
      const other = await kurum()
      assert.equal((await post(reactivateUrl, { cookie: other.cookie })).statusCode, 404)
      assert.equal((await audits(institution.id, 'staff.reactivate')).length, 0)
      const reactivate = await post(reactivateUrl, { cookie })
      assert.equal(reactivate.statusCode, 200, reactivate.body)
      assert.equal(reactivate.json().data.status, 'active')
      assert.equal(reactivate.json().data.deactivatedAt, null)
      const back = await signInAs(app, teacher)
      const allowed = await app.inject({
        method: 'GET',
        url: '/api/v1/institution-members',
        headers: { origin: TEST_ORIGIN, cookie: back },
      })
      assert.equal(allowed.statusCode, 403)
      assert.equal(allowed.json().code, 'forbidden', 'üyelik geri geldi; rol yine öğretmen')
      assert.equal((await audits(institution.id, 'staff.reactivate')).length, 1)
    })

    /** Rota denetimini (`requireRole`) geçmiş yöneticinin servis bağlamı: yarışta kilit öncesi an. */
    function adminContext(
      institutionId: string,
      member: Pick<TestUser, 'id'> & { membershipId: string },
    ): ServiceContext {
      return {
        db,
        institutionId,
        actor: { userId: member.id, role: 'yonetici', membershipId: member.membershipId },
        now: FIXED_NOW,
        log: app.log,
      }
    }

    function outcome(result: PromiseSettledResult<{ statusCode: number }>): string {
      if (result.status === 'fulfilled') return String(result.value.statusCode)
      const reason: unknown = result.reason
      return reason instanceof AppError ? `${reason.statusCode}:${reason.code}` : 'unexpected'
    }

    test('DOM-YTK-070: iki yönetici aynı anda birbirini pasifleştirir ya da düşürür: biri 422 last_admin', async () => {
      for (const kind of ['deactivate', 'role', 'mixed'] as const) {
        const { institution } = await kurum()
        const first = { id: institution.admin.id, membershipId: institution.adminMembershipId }
        const second = await createMember(app, institution.id, 'yonetici')
        const demote = (actor: typeof first, target: string) =>
          changeStaffRole(
            adminContext(institution.id, actor),
            app.auth,
            target,
            { role: 'ogretmen' },
            null,
          )
        const deactivate = (actor: typeof first, target: string) =>
          setStaffActive(adminContext(institution.id, actor), app.auth, target, false, null)
        const results = await Promise.allSettled([
          kind === 'role'
            ? demote(first, second.membershipId)
            : deactivate(first, second.membershipId),
          kind === 'deactivate'
            ? deactivate(second, first.membershipId)
            : demote(second, first.membershipId),
        ])
        const codes = results.map(outcome).sort()
        assert.deepEqual(codes, ['200', '422:last_admin'], kind)
        const admins = await db
          .select({ id: memberships.id })
          .from(memberships)
          .where(
            and(
              eq(memberships.institutionId, institution.id),
              eq(memberships.role, 'yonetici'),
              isNull(memberships.deactivatedAt),
            ),
          )
        assert.equal(admins.length, 1, `${kind}: bir etkin yönetici kalır`)
      }
    })

    test('DOM-YTK-070: kilit altında yetkisini yitirmiş yönetici yazamaz; kendini geri alamaz', async () => {
      const { institution, cookie } = await kurum()
      const second = await createMember(app, institution.id, 'yonetici')
      const teacher = await createMember(app, institution.id, 'ogretmen')
      const secondContext = adminContext(institution.id, second)
      // `second` istek denetimini geçti, kilidi beklerken pasifleştirildi.
      const deactivated = await post(
        `/api/v1/institution-members/${second.membershipId}/deactivate`,
        { cookie },
      )
      assert.equal(deactivated.statusCode, 200, deactivated.body)
      await assert.rejects(
        setStaffActive(secondContext, app.auth, second.membershipId, true, null),
        (error: unknown) => error instanceof AppError && error.code === 'self_reactivate',
      )
      await assert.rejects(
        setStaffActive(secondContext, app.auth, teacher.membershipId, false, null),
        (error: unknown) => error instanceof AppError && error.statusCode === 403,
      )
      await assert.rejects(
        changeStaffRole(secondContext, app.auth, teacher.membershipId, { role: 'onburo' }, null),
        (error: unknown) => error instanceof AppError && error.statusCode === 403,
      )
      const [row] = await db
        .select({ deactivatedAt: memberships.deactivatedAt })
        .from(memberships)
        .where(eq(memberships.id, second.membershipId))
      assert.notEqual(row?.deactivatedAt, null, 'kendini geri alamadı')
      const [teacherRow] = await db
        .select({ role: memberships.role, deactivatedAt: memberships.deactivatedAt })
        .from(memberships)
        .where(eq(memberships.id, teacher.membershipId))
      assert.deepEqual(teacherRow, { role: 'ogretmen', deactivatedAt: null })
      assert.equal((await audits(institution.id, 'staff.reactivate')).length, 0)

      // HTTP: kendi hesabını geri alma 422 `self_reactivate` (etkin yönetici için de).
      const self = await post(
        `/api/v1/institution-members/${institution.adminMembershipId}/reactivate`,
        { cookie },
      )
      assert.equal(self.statusCode, 422)
      assert.equal(self.json().code, 'self_reactivate')
    })
  })
})
