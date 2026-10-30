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

  test('herkese açık kayıt kapalıdır', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-up/email',
      headers: { origin: 'http://localhost:5173' },
      payload: { name: 'Yabancı', email: 'yabanci@kampus.example', password: 'Uzun-Bir-Parola-99' },
    })
    assert.ok(response.statusCode >= 400 && response.statusCode < 500)
  })
})
