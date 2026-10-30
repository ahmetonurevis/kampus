import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { sessions } from '../src/db/schema/auth.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  nextIp,
  signIn,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'

describe('Better Auth e-posta/parola girişi', () => {
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

  test('doğru parolayla oturum çerezi verir ve etkin kurumu ayarlar', async () => {
    const institution = await createInstitution(app)
    const teacher = await createMember(app, institution.id, 'ogretmen')

    const response = await signIn(app, teacher.email, teacher.password)

    assert.equal(response.statusCode, 200)
    const cookie = response.cookies.find((item) => item.name === 'kampus.session_token')
    assert.ok(cookie, 'oturum çerezi yok')
    assert.equal(cookie.httpOnly, true)
    assert.equal(cookie.sameSite, 'Lax')
    const [session] = await db.select().from(sessions).where(eq(sessions.userId, teacher.id))
    assert.equal(session?.activeInstitutionId, institution.id)
    const audits = await db.select().from(auditLog).where(eq(auditLog.actorUserId, teacher.id))
    assert.deepEqual(
      audits.map((row) => [row.action, row.institutionId]),
      [['auth.login_succeeded', institution.id]],
    )
    assert.equal(audits[0]?.ipHash?.length, 64)
  })

  test('yanlış parola ve bilinmeyen e-posta aynı durum ve gövdeyi döndürür', async () => {
    const institution = await createInstitution(app)
    const student = await createMember(app, institution.id, 'ogrenci')

    const wrongPassword = await signIn(app, student.email, 'Yanlis-Parola-123!')
    const unknownEmail = await signIn(app, 'yok-boyle-biri@kampus.example', 'Yanlis-Parola-123!')

    assert.equal(wrongPassword.statusCode, 401)
    assert.equal(unknownEmail.statusCode, wrongPassword.statusCode)
    assert.deepEqual(unknownEmail.json(), wrongPassword.json())
    assert.equal(wrongPassword.json().message, 'E-posta veya parola hatalı.')
    assert.equal(wrongPassword.cookies.length, 0)
    const failures = await db.select().from(auditLog).where(eq(auditLog.actorUserId, student.id))
    assert.deepEqual(
      failures.map((row) => [row.action, row.changes]),
      [['auth.login_failed', { reason: 'invalid_password' }]],
    )
  })

  test('aynı IP’den 6. giriş denemesi 429 ve Retry-After alır', async () => {
    const ip = nextIp()
    const statuses: number[] = []
    let last
    for (let attempt = 0; attempt < 6; attempt += 1) {
      last = await signIn(app, 'deneme@kampus.example', 'Yanlis-Parola-123!', ip)
      statuses.push(last.statusCode)
    }
    assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429])
    assert.ok(Number(last?.headers['retry-after']) > 0)
    assert.equal(
      last?.json().message,
      'Çok fazla istek gönderildi. Lütfen biraz sonra yeniden deneyin.',
    )
  })

  test('loglar parola, e-posta, çerez ve tam IP içermez', async () => {
    const logs: string[] = []
    const logged = await buildTestApp(db, { logs })
    try {
      const institution = await createInstitution(logged)
      const ip = '203.0.113.77'
      const response = await signIn(logged, institution.admin.email, institution.admin.password, ip)
      const token = response.cookies.find((item) => item.name === 'kampus.session_token')?.value
      assert.ok(token)
      await logged.inject({
        method: 'GET',
        url: '/api/v1/memberships?pageSize=500',
        headers: { cookie: `kampus.session_token=${token}` },
        remoteAddress: ip,
      })
      const text = logs.join('')
      assert.ok(text.includes('"reqId"'), 'istek logu yok')
      assert.ok(text.includes('203.0.113.0'), 'maskeli IP yok')
      for (const secret of [institution.admin.password, institution.admin.email, token, ip])
        assert.equal(text.includes(secret), false, `logda gizli değer: ${secret.slice(0, 4)}…`)
    } finally {
      await logged.close()
    }
  })

  test('parola değişiminde yaygın parola ve kurum adı türevi reddedilir', async () => {
    const institution = await createInstitution(app, { name: 'Deneme Koleji' })
    const user = institution.admin
    const cookie = await signInAs(app, user)
    const ip = nextIp()
    const change = (newPassword: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/change-password',
        headers: { cookie, origin: TEST_ORIGIN, 'content-type': 'application/json' },
        remoteAddress: ip,
        payload: { currentPassword: user.password, newPassword },
      })

    for (const weak of ['password12345', 'Koleji-Deneme-2026']) {
      const response = await change(weak)
      assert.equal(response.statusCode, 400, weak)
      assert.equal(response.json().code, 'PASSWORD_TOO_COMMON')
      assert.match(response.json().message, /yaygın/)
    }
    const accepted = await change('Yeni-Guclu-Parola-7381')
    assert.equal(accepted.statusCode, 200)
    const actions = (await db.select().from(auditLog).where(eq(auditLog.actorUserId, user.id))).map(
      (row) => row.action,
    )
    assert.ok(actions.includes('auth.password_changed'))
  })

  test('herkese açık kayıt kapalıdır', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-up/email',
      headers: { origin: TEST_ORIGIN },
      payload: { name: 'Yabancı', email: 'yabanci@kampus.example', password: 'Uzun-Bir-Parola-99' },
    })
    assert.ok(response.statusCode >= 400 && response.statusCode < 500)
  })
})
