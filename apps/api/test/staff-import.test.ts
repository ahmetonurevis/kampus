import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, count, eq, inArray } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import { SESSION_FRESH_AGE_SECONDS } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { invitations, memberships, users } from '../src/db/schema/auth.ts'
import { membershipLinks } from '../src/db/schema/membership-links.ts'
import { MemoryMailer } from '../src/services/mailer.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
  type TestInstitution,
} from './support/app.ts'

/**
 * Toplu personel aktarımı (IST-007, DOM-YTK-070): `POST /institution-members/imports`. Yalnız
 * yönetici, taze oturum, `Idempotency-Key` zorunlu; bütün satırlar doğrulanmadan hiçbir kayıt
 * yazılmaz.
 */
describe('toplu personel aktarımı (IST-007, DOM-YTK-070)', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let staleApp: App
  const mailer = new MemoryMailer()

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

  function upload(
    cookie: string | undefined,
    payload: object,
    options: { key?: string | null; target?: App } = {},
  ) {
    const key = options.key === undefined ? randomUUID() : options.key
    return (options.target ?? app).inject({
      method: 'POST',
      url: '/api/v1/institution-members/imports',
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...(key === null ? {} : { 'idempotency-key': key }),
      },
      payload,
    })
  }

  async function kurum(): Promise<{ institution: TestInstitution; cookie: string }> {
    const institution = await createInstitution(app)
    await insertMissingRecords(
      db,
      institution.id,
      [
        {
          collection: 'branches',
          id: 'b-1',
          data: { id: 'b-1', name: 'Kadıköy Kampüsü', isActive: true },
        },
        {
          collection: 'teachers',
          id: 't-a',
          data: {
            id: 't-a',
            name: 'Selin Kaya',
            email: 'selin.kaya@kampus.example',
            subjectId: 'math',
            branchId: 'b-1',
            isActive: true,
          },
        },
      ],
      FIXED_NOW,
    )
    return { institution, cookie: await signInAs(app, institution.admin) }
  }

  const tag = () => randomUUID().slice(0, 8)
  const csv = (...lines: string[]) => ['ad;e-posta;rol;branş;kampüs', ...lines].join('\n')

  async function memberCount(institutionId: string) {
    const [row] = await db
      .select({ total: count() })
      .from(memberships)
      .where(eq(memberships.institutionId, institutionId))
    return row?.total ?? 0
  }

  async function invitationCount(institutionId: string) {
    const [row] = await db
      .select({ total: count() })
      .from(invitations)
      .where(eq(invitations.institutionId, institutionId))
    return row?.total ?? 0
  }

  async function userCount(emails: string[]) {
    const [row] = await db
      .select({ total: count() })
      .from(users)
      .where(inArray(users.email, emails))
    return row?.total ?? 0
  }

  async function importAudits(institutionId: string) {
    return db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, 'staff.import')))
  }

  test('IST-007: oturumsuz 401, yönetici dışı 403, eski oturum 403, anahtarsız ve geçersiz gövde 400', async () => {
    const { institution, cookie } = await kurum()
    const address = `p-${tag()}@kampus.example`
    const body = { csv: csv(`Ali Can;${address};onburo;;`) }
    assert.equal((await upload(undefined, body)).statusCode, 401)
    for (const role of ['ogretmen', 'onburo'] as const) {
      const member = await createMember(app, institution.id, role)
      const denied = await upload(await signInAs(app, member), body)
      assert.equal(denied.statusCode, 403)
      assert.equal(denied.json().code, 'forbidden')
    }
    const stale = await upload(await signInAs(app, institution.admin), body, { target: staleApp })
    assert.equal(stale.statusCode, 403)
    assert.equal(stale.json().code, 'reauthentication_required')
    const keyless = await upload(cookie, body, { key: null })
    assert.equal(keyless.statusCode, 400)
    assert.equal(keyless.json().code, 'idempotency_key_required')
    for (const payload of [
      {},
      { csv: '' },
      { ...body, institutionId: 'x' },
      { ...body, dryRun: 1 },
    ])
      assert.equal((await upload(cookie, payload)).statusCode, 400)
    assert.equal(await userCount([address]), 0)
    assert.equal(await invitationCount(institution.id), 0)
  })

  test('IST-007: hatalı tek satırda hiçbir kayıt yazılmaz; hatalar satır numarası ve Türkçe iletiyle döner', async () => {
    const { institution, cookie } = await kurum()
    const good = [`a-${tag()}@kampus.example`, `b-${tag()}@kampus.example`]
    const membersBefore = await memberCount(institution.id)
    const response = await upload(cookie, {
      csv: csv(`Ali Can;${good[0]};onburo;;`, `Bora Er;${good[1]};Yönetici;;`, `C;bozuk;veli;;`),
    })
    assert.equal(response.statusCode, 422, response.body)
    const body = response.json()
    assert.equal(body.code, 'staff_import_invalid')
    assert.equal(
      body.message,
      'Dosyada düzeltilmesi gereken satırlar var. Hiçbir personel aktarılmadı.',
    )
    assert.deepEqual(
      body.issues.map((issue: { path: unknown[]; code: string }) => [issue.path, issue.code]),
      [
        [['rows', 4, 'name'], 'name_invalid'],
        [['rows', 4, 'email'], 'email_invalid'],
        [['rows', 4, 'role'], 'role_invalid'],
      ],
    )
    assert.equal(body.issues[1].message, '4. satır: Geçerli bir e-posta adresi girin.')
    assert.equal(await userCount(good), 0)
    assert.equal(await memberCount(institution.id), membersBefore)
    assert.equal(await invitationCount(institution.id), 0)
    assert.equal((await importAudits(institution.id)).length, 0)
    assert.equal(mailer.lastTo(good[0] ?? ''), undefined)
  })

  test('IST-007: dosyada yinelenen e-posta ve kurumda kayıtlı üye ayrı hata verir', async () => {
    const { institution, cookie } = await kurum()
    const teacher = await createMember(app, institution.id, 'ogretmen')
    const repeated = `r-${tag()}@kampus.example`
    const response = await upload(cookie, {
      csv: csv(
        `Rana Er;${repeated};onburo;;`,
        `Rana İkinci;${repeated.toUpperCase()};onburo;;`,
        `Var Olan;${teacher.email};ogretmen;;`,
      ),
    })
    assert.equal(response.statusCode, 422)
    assert.deepEqual(
      response.json().issues.map((issue: { path: unknown[]; code: string }) => issue.code),
      ['duplicate_email', 'member_exists'],
    )
    assert.equal(
      response.json().issues[0].message,
      '3. satır: Bu e-posta dosyanın 2. satırında da var.',
    )
    assert.equal(await userCount([repeated]), 0)
  })

  test('IST-007: 1.001 satır reddedilir, hiçbir kayıt açılmaz', async () => {
    const { institution, cookie } = await kurum()
    const prefix = tag()
    const lines = Array.from(
      { length: 1001 },
      (_, i) => `Kişi ${i};k${i}-${prefix}@kampus.example;onburo;;`,
    )
    for (const dryRun of [true, false]) {
      const response = await upload(cookie, { csv: csv(...lines), dryRun })
      assert.equal(response.statusCode, 422, response.body)
      assert.equal(response.json().code, 'csv_too_many_rows')
      assert.match(response.json().message, /en çok 1\.000/)
    }
    assert.equal(await invitationCount(institution.id), 0)
    assert.equal(await userCount([`k0-${prefix}@kampus.example`]), 0)
  })

  test('IST-007: önizleme (dryRun) doğrular, yazmaz; geçerli dosyada davet sayısını verir', async () => {
    const { institution, cookie } = await kurum()
    const address = `o-${tag()}@kampus.example`
    const valid = await upload(cookie, { csv: csv(`Ali Can;${address};onburo;;`), dryRun: true })
    assert.equal(valid.statusCode, 200, valid.body)
    assert.deepEqual(valid.json().data, { dryRun: true, rowCount: 1, invitedCount: 1, issues: [] })
    const invalid = await upload(cookie, {
      csv: csv(`Ali Can;${address};onburo;Matematik;`),
      dryRun: true,
    })
    assert.equal(invalid.statusCode, 200)
    assert.deepEqual(invalid.json().data.issues, [
      {
        line: 2,
        field: 'subject',
        code: 'teacher_only',
        message: 'Branş ve kampüs yalnız öğretmen satırında girilir.',
      },
    ])
    assert.equal(invalid.json().data.invitedCount, 0)
    assert.equal(await userCount([address]), 0)
    assert.equal(await invitationCount(institution.id), 0)
  })

  test('IST-007: başarılı aktarım bütün davetleri tek işlemde açar, öğretmeni bağlar, bağlantıları gönderir; anahtar tekrarı tek yazım', async () => {
    const { institution, cookie } = await kurum()
    const other = await createInstitution(app)
    const elsewhere = await createMember(app, other.id, 'ogretmen')
    const emails = [
      'selin.kaya@kampus.example',
      `m-${tag()}@kampus.example`,
      `n-${tag()}@kampus.example`,
    ]
    const key = randomUUID()
    const body = {
      csv: csv(
        `Selin Kaya;${emails[0]};Öğretmen;Matematik;Kadıköy Kampüsü`,
        `Mert Ak;${emails[1]};Ön büro;;`,
        `Nil Su;${emails[2]};yonetici;;`,
        `Başka Kurumda;${elsewhere.email};onburo;;`,
      ),
    }
    const sentBefore = mailer.outbox.length
    const response = await upload(cookie, body, { key })
    assert.equal(response.statusCode, 201, response.body)
    assert.deepEqual(response.json().data, {
      dryRun: false,
      rowCount: 4,
      invitedCount: 4,
      issues: [],
    })

    const pending = await db
      .select({ email: invitations.email, role: invitations.role, status: invitations.status })
      .from(invitations)
      .where(eq(invitations.institutionId, institution.id))
    assert.deepEqual(
      pending.map((row) => `${row.email}:${row.role}:${row.status}`).sort(),
      [
        `${emails[0]}:ogretmen:pending`,
        `${emails[1]}:onburo:pending`,
        `${emails[2]}:yonetici:pending`,
        `${elsewhere.email}:onburo:pending`,
      ].sort(),
    )
    const joined = await db
      .select({ email: users.email, membershipId: memberships.id })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.institutionId, institution.id), inArray(users.email, emails)))
    assert.equal(joined.length, 3)
    // Başka kurumdaki hesap bu kuruma bağlanmaz (karar 73).
    assert.equal(
      (
        await db
          .select({ id: memberships.id })
          .from(memberships)
          .where(
            and(
              eq(memberships.institutionId, institution.id),
              eq(memberships.userId, elsewhere.id),
            ),
          )
      ).length,
      0,
    )
    const selin = joined.find((row) => row.email === emails[0])
    const links = await db
      .select({ recordId: membershipLinks.recordId })
      .from(membershipLinks)
      .where(eq(membershipLinks.membershipId, selin?.membershipId ?? ''))
    assert.deepEqual(links, [{ recordId: 't-a' }])

    const audits = await importAudits(institution.id)
    assert.equal(audits.length, 4)
    assert.ok(!JSON.stringify(audits).includes('@'), 'denetimde e-posta yok')
    for (const address of emails) assert.ok(mailer.lastTo(address), `${address} bağlantı almadı`)
    assert.equal(mailer.lastTo(elsewhere.email), undefined)
    assert.equal(mailer.outbox.length, sentBefore + 3)

    const replay = await upload(cookie, body, { key })
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.deepEqual(replay.json(), response.json())
    assert.equal(await invitationCount(institution.id), 4)
    assert.equal((await importAudits(institution.id)).length, 4)
    assert.equal(mailer.outbox.length, sentBefore + 3)

    // Yeni anahtarla aynı dosya: hepsi artık kurumda ya da bekleyen davette; öğretmen kaydı bağlı.
    const again = await upload(cookie, body)
    assert.equal(again.statusCode, 422)
    assert.deepEqual(
      again.json().issues.map((issue: { code: string }) => issue.code),
      [
        'member_exists',
        'teacher_already_linked',
        'member_exists',
        'member_exists',
        'invitation_exists',
      ],
    )
    assert.equal(await invitationCount(institution.id), 4)
  })

  test('DOM-YTK-070: başka kurumdaki hesabın öğretmen satırı kaydı davette tutar; tutulan kayıt ikinci kez bağlanamaz (karar 73)', async () => {
    const { institution, cookie } = await kurum()
    const other = await createInstitution(app)
    const elsewhere = await createMember(app, other.id, 'ogretmen')
    await insertMissingRecords(
      db,
      institution.id,
      [
        {
          collection: 'teachers',
          id: 't-z',
          data: {
            id: 't-z',
            name: 'Zeki Ok',
            email: elsewhere.email,
            subjectId: 'math',
            branchId: 'b-1',
            isActive: true,
          },
        },
      ],
      FIXED_NOW,
    )
    const fresh = await upload(cookie, {
      csv: csv(`Selin Kaya;selin.kaya@kampus.example;ogretmen;;`),
    })
    const response = await upload(cookie, { csv: csv(`Zeki Ok;${elsewhere.email};ogretmen;;`) })
    // Yanıt yeni hesaptakiyle aynı biçimde; üyelik ve bağlantı açılmaz, kayıt davette durur.
    assert.equal(response.statusCode, 201, response.body)
    assert.equal(response.statusCode, fresh.statusCode)
    assert.deepEqual(response.json(), fresh.json())
    const [stored] = await db
      .select({ membershipId: invitations.membershipId, teacherId: invitations.teacherId })
      .from(invitations)
      .where(
        and(eq(invitations.institutionId, institution.id), eq(invitations.email, elsewhere.email)),
      )
    assert.deepEqual(stored, { membershipId: null, teacherId: 't-z' })
    const links = await db
      .select()
      .from(membershipLinks)
      .where(
        and(eq(membershipLinks.institutionId, institution.id), eq(membershipLinks.recordId, 't-z')),
      )
    assert.equal(links.length, 0)

    // Bekleyen davetin tuttuğu kayıt tek davetle de bağlanamaz.
    const invite = (payload: object) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/institution-members/invitations',
        headers: {
          origin: TEST_ORIGIN,
          'content-type': 'application/json',
          cookie,
          'idempotency-key': randomUUID(),
        },
        payload,
      })
    const single = await invite({
      email: `z-${tag()}@kampus.example`,
      name: 'Zeki Ok',
      role: 'ogretmen',
      teacherId: 't-z',
    })
    assert.equal(single.statusCode, 409, single.body)
    assert.equal(single.json().code, 'teacher_invitation_pending')

    // Tek davetin (başka kurumdaki hesaba) tuttuğu e-postasız kayıt aktarımda satır hatasıdır.
    await insertMissingRecords(
      db,
      institution.id,
      [
        {
          collection: 'teachers',
          id: 't-y',
          data: { id: 't-y', name: 'Yeliz Ün', subjectId: 'math', branchId: 'b-1', isActive: true },
        },
      ],
      FIXED_NOW,
    )
    const elsewhereTwo = await createMember(app, other.id, 'onburo')
    const held = await invite({
      email: elsewhereTwo.email,
      name: 'Yeliz Ün',
      role: 'ogretmen',
      teacherId: 't-y',
    })
    assert.equal(held.statusCode, 201, held.body)
    const preview = await upload(cookie, {
      csv: csv(`Yeliz Ün;yeliz-${tag()}@kampus.example;ogretmen;Matematik;Kadıköy Kampüsü`),
      dryRun: true,
    })
    assert.equal(preview.statusCode, 200, preview.body)
    assert.deepEqual(preview.json().data.issues, [
      {
        line: 2,
        field: null,
        code: 'teacher_invitation_pending',
        message: 'Bu öğretmen kaydı bekleyen bir davete bağlı. Önce o daveti iptal edin.',
      },
    ])
  })

  test('IST-007: kurum kapsamı sunucuda; başka kurumun üyesi ve öğretmen kaydı bu kurumu etkilemez', async () => {
    const { institution, cookie } = await kurum()
    const other = await kurum()
    const otherMember = await createMember(app, other.institution.id, 'onburo')
    const response = await upload(cookie, {
      csv: csv(`Öteki Üye;${otherMember.email};onburo;;`),
      dryRun: true,
      institutionId: other.institution.id,
    })
    assert.equal(response.statusCode, 400)
    // Başka kurumun üyesi bu kurumda "kayıtlı" sayılmaz; aktarım yalnız bu kuruma yazar.
    const created = await upload(cookie, { csv: csv(`Öteki Üye;${otherMember.email};onburo;;`) })
    assert.equal(created.statusCode, 201, created.body)
    assert.equal(await invitationCount(institution.id), 1)
    assert.equal(await invitationCount(other.institution.id), 0)
    // Diğer kurumun öğretmen kaydı (aynı kimlik t-a) bağlanmış değildir: kendi kaydı hâlâ boşta.
    const otherTeacher = await upload(other.cookie, {
      csv: csv(`Selin Kaya;selin.kaya@kampus.example;ogretmen;;`),
      dryRun: true,
    })
    assert.deepEqual(otherTeacher.json().data.issues, [])
  })
})
