import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import { ROLES, type Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { membershipLinks } from '../src/db/schema/membership-links.ts'
import { foldSearch } from '../src/services/institution-members.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  createUser,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
  type TestInstitution,
} from './support/app.ts'

interface MemberRow {
  id: string
  userId: string
  name: string
  email: string
  role: Role
  status: 'active' | 'passive'
  links: { kind: string; name: string | null }[]
  createdAt: string
}
interface MemberList {
  data: MemberRow[]
  meta: { page: number; pageSize: number; total: number }
}

/** Ayarlar → Kullanıcı & Yetkiler (DOM-YTK-020): yalnız yönetici okur, yalnız kendi kurumu. */
describe('GET /api/v1/institution-members (DOM-YTK-020)', () => {
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

  const get = (url: string, cookie?: string) =>
    app.inject({
      method: 'GET',
      url,
      headers: { origin: TEST_ORIGIN, ...(cookie ? { cookie } : {}) },
    })

  async function kurum(): Promise<{
    institution: TestInstitution
    cookie: string
    byRole: Record<string, { userId: string; membershipId: string; email: string }>
  }> {
    const institution = await createInstitution(app)
    await insertMissingRecords(
      db,
      institution.id,
      [
        {
          collection: 'teachers',
          id: 't-a',
          data: { id: 't-a', name: 'Selin Kaya', isActive: true },
        },
        {
          collection: 'students',
          id: 's-a',
          data: { id: 's-a', name: 'Deniz Yılmaz', isActive: true },
        },
        {
          collection: 'students',
          id: 's-b',
          data: { id: 's-b', name: 'Ece Yılmaz', isActive: true },
        },
        {
          collection: 'students',
          id: 's-pasif',
          data: { id: 's-pasif', name: 'Pasif Öğrenci', isActive: false },
        },
      ],
      FIXED_NOW,
    )
    const teacher = await createMember(app, institution.id, 'ogretmen', [
      { kind: 'teacher', recordId: 't-a' },
    ])
    const student = await createMember(app, institution.id, 'ogrenci', [
      { kind: 'student', recordId: 's-a' },
    ])
    const parent = await createMember(app, institution.id, 'veli', [
      { kind: 'child', recordId: 's-a' },
      { kind: 'child', recordId: 's-b' },
    ])
    const passive = await createMember(app, institution.id, 'ogrenci', [
      { kind: 'student', recordId: 's-pasif' },
    ])
    const front = await createMember(app, institution.id, 'onburo')
    return {
      institution,
      cookie: await signInAs(app, institution.admin),
      byRole: {
        yonetici: {
          userId: institution.admin.id,
          membershipId: institution.adminMembershipId,
          email: institution.admin.email,
        },
        ogretmen: { userId: teacher.id, membershipId: teacher.membershipId, email: teacher.email },
        ogrenci: { userId: student.id, membershipId: student.membershipId, email: student.email },
        veli: { userId: parent.id, membershipId: parent.membershipId, email: parent.email },
        pasif: { userId: passive.id, membershipId: passive.membershipId, email: passive.email },
        onburo: { userId: front.id, membershipId: front.membershipId, email: front.email },
      },
    }
  }

  test('kimliksiz istek 401', async () => {
    const response = await get('/api/v1/institution-members')
    assert.equal(response.statusCode, 401)
  })

  test('yönetici dışındaki roller 403 alır ve yanıtta e-posta/üye verisi yoktur', async () => {
    const { institution, byRole } = await kurum()
    for (const role of ROLES.filter((item) => item !== 'yonetici')) {
      const user = await createMember(app, institution.id, role)
      const response = await get('/api/v1/institution-members', await signInAs(app, user))
      assert.equal(response.statusCode, 403, role)
      assert.ok(!response.body.includes(byRole.ogretmen?.email ?? 'yok'), role)
      assert.ok(!response.body.includes('"data"'), role)
    }
  })

  test('yönetici kurumun üyelerini ad, rol, durum, bağlı kişi ve e-postayla görür', async () => {
    const { cookie, byRole } = await kurum()
    const response = await get('/api/v1/institution-members?pageSize=100', cookie)
    assert.equal(response.statusCode, 200, response.body)
    const body = response.json<MemberList>()
    assert.equal(body.meta.total, 6)
    const parent = body.data.find((row) => row.userId === byRole.veli?.userId)
    assert.ok(parent)
    assert.equal(parent.role, 'veli')
    assert.equal(parent.email, byRole.veli?.email)
    assert.equal(parent.status, 'active')
    assert.deepEqual(
      parent.links.map((link) => `${link.kind}:${link.name}`),
      ['child:Deniz Yılmaz', 'child:Ece Yılmaz'],
    )
    const teacher = body.data.find((row) => row.userId === byRole.ogretmen?.userId)
    assert.deepEqual(teacher?.links, [{ kind: 'teacher', name: 'Selin Kaya' }])
    assert.match(parent.createdAt, /^\d{4}-\d{2}-\d{2}T.*Z$/)
  })

  test('yanıtta telefon, parola, oturum ve IP alanı bulunmaz; yalnız şemadaki anahtarlar döner', async () => {
    const { cookie } = await kurum()
    const response = await get('/api/v1/institution-members', cookie)
    const body = response.json<MemberList>()
    for (const row of body.data)
      assert.deepEqual(Object.keys(row).sort(), [
        'createdAt',
        'email',
        'id',
        'links',
        'name',
        'role',
        'status',
        'userId',
      ])
    for (const forbidden of ['phone', 'password', 'token', 'session', 'ipAddress', 'userAgent'])
      assert.ok(!response.body.toLowerCase().includes(forbidden), forbidden)
  })

  test('başka kurumun üyeleri listede yok; sorgudaki kurum kimliği 400 ve etkisizdir', async () => {
    const a = await kurum()
    const b = await kurum()
    const response = await get('/api/v1/institution-members?pageSize=100', a.cookie)
    const ids = response.json<MemberList>().data.map((row) => row.userId)
    for (const member of Object.values(b.byRole)) assert.ok(!ids.includes(member.userId))
    assert.equal(ids.length, 6)
    const spoofed = await get(
      `/api/v1/institution-members?institutionId=${b.institution.id}`,
      a.cookie,
    )
    assert.equal(spoofed.statusCode, 400)
    assert.ok(!spoofed.body.includes(b.byRole.ogretmen?.email ?? 'yok'))
  })

  test('rol süzgeci yalnız o rolü döndürür', async () => {
    const { cookie } = await kurum()
    const response = await get('/api/v1/institution-members?role=ogrenci', cookie)
    const body = response.json<MemberList>()
    assert.equal(body.meta.total, 2)
    assert.ok(body.data.every((row) => row.role === 'ogrenci'))
    assert.equal((await get('/api/v1/institution-members?role=hacker', cookie)).statusCode, 400)
  })

  test('durum süzgeci: bağlı kişisi pasif olan üyelik pasiftir, bağlantısız yönetici etkindir', async () => {
    const { cookie, byRole } = await kurum()
    const passive = (
      await get('/api/v1/institution-members?status=passive', cookie)
    ).json<MemberList>()
    assert.deepEqual(
      passive.data.map((row) => row.userId),
      [byRole.pasif?.userId],
    )
    assert.equal(passive.data[0]?.status, 'passive')
    const active = (
      await get('/api/v1/institution-members?status=active', cookie)
    ).json<MemberList>()
    assert.equal(active.meta.total, 5)
    assert.ok(active.data.every((row) => row.status === 'active'))
    assert.ok(active.data.some((row) => row.role === 'yonetici'))
  })

  test('arşivlenmiş bağlantı durumu etkilemez; tüm çocukları pasif velinin üyeliği pasiftir', async () => {
    const { institution, cookie } = await kurum()
    const parent = await createMember(app, institution.id, 'veli', [
      { kind: 'child', recordId: 's-pasif' },
    ])
    const loneAdmin = await createMember(app, institution.id, 'ogrenci', [
      { kind: 'student', recordId: 's-pasif' },
    ])
    await db
      .update(membershipLinks)
      .set({ archivedAt: FIXED_NOW })
      .where(eq(membershipLinks.membershipId, loneAdmin.membershipId))
    const passive = (
      await get('/api/v1/institution-members?status=passive&pageSize=100', cookie)
    ).json<MemberList>()
    const ids = passive.data.map((row) => row.userId)
    assert.ok(ids.includes(parent.id))
    // Bağlantısı arşivlenen üyelik "bağlantısız" sayılır: etkin.
    assert.ok(!ids.includes(loneAdmin.id))
  })

  test('arama ad ve e-postada, Türkçe harf ve büyük/küçük harf duyarsız çalışır', async () => {
    const { institution, cookie } = await kurum()
    const user = await createUser(app, {
      name: 'İsmail Çağlar Öztürk',
      email: 'ismail.ozturk@kampus.example',
    })
    const { ensureMember } = await import('../src/services/identity.ts')
    await ensureMember(app.auth, db, {
      institutionId: institution.id,
      userId: user.id,
      role: 'ogretmen',
    })
    for (const q of ['ismail', 'İSMAİL', 'caglar', 'ÖZTÜRK', 'ozturk@kampus'])
      assert.deepEqual(
        (await get(`/api/v1/institution-members?q=${encodeURIComponent(q)}`, cookie))
          .json<MemberList>()
          .data.map((row) => row.userId),
        [user.id],
        q,
      )
    const none = await get('/api/v1/institution-members?q=bulunmayan', cookie)
    assert.equal(none.json<MemberList>().meta.total, 0)
    // Joker karakterler düz metindir; her kaydı eşleştirmez.
    const wildcard = await get('/api/v1/institution-members?q=%25%25', cookie)
    assert.equal(wildcard.json<MemberList>().meta.total, 0)
  })

  test('q en fazla 100 karakter ve en az 2 karakterdir', async () => {
    const { cookie } = await kurum()
    assert.equal(
      (await get(`/api/v1/institution-members?q=${'a'.repeat(101)}`, cookie)).statusCode,
      400,
    )
    assert.equal(
      (await get(`/api/v1/institution-members?q=${'a'.repeat(100)}`, cookie)).statusCode,
      200,
    )
    assert.equal((await get('/api/v1/institution-members?q=a', cookie)).statusCode, 400)
  })

  test('sayfalama toplamı korur, sınır dışı pageSize 400, sıralama kararlıdır', async () => {
    const { cookie } = await kurum()
    const first = (await get('/api/v1/institution-members?pageSize=4', cookie)).json<MemberList>()
    const second = (
      await get('/api/v1/institution-members?pageSize=4&page=2', cookie)
    ).json<MemberList>()
    assert.equal(first.meta.total, 6)
    assert.equal(first.data.length, 4)
    assert.equal(second.data.length, 2)
    const ids = [...first.data, ...second.data].map((row) => row.id)
    assert.equal(new Set(ids).size, 6)
    const names = [...first.data, ...second.data].map((row) => foldSearch(row.name))
    assert.deepEqual(names, [...names].sort())
    const desc = (
      await get('/api/v1/institution-members?sort=-name&pageSize=100', cookie)
    ).json<MemberList>()
    // Aynı adlı üyeliklerde sıra kimliğe göre sabit kalır; ad sırası tersine döner.
    const descNames = desc.data.map((row) => foldSearch(row.name))
    assert.deepEqual(descNames, [...descNames].sort().reverse())
    assert.deepEqual(desc.data.map((row) => row.id).sort(), [...ids].sort())
    for (const bad of ['pageSize=101', 'pageSize=0', 'page=0', 'sort=email', 'bilinmeyen=1'])
      assert.equal((await get(`/api/v1/institution-members?${bad}`, cookie)).statusCode, 400, bad)
    const beyond = await get('/api/v1/institution-members?page=9', cookie)
    assert.deepEqual(beyond.json<MemberList>().data, [])
  })

  test('okuma denetim kaydı üretmez', async () => {
    const { institution, cookie } = await kurum()
    const count = async () =>
      (await db.select().from(auditLog).where(eq(auditLog.institutionId, institution.id))).length
    const before = await count()
    await get('/api/v1/institution-members', cookie)
    await get('/api/v1/institution-members?role=veli', cookie)
    assert.equal(await count(), before)
  })
})
