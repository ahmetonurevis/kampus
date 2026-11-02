import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { memberships, sessions, verifications } from '../src/db/schema/auth.ts'
import { createLogMailer, maskResetUrl, MemoryMailer } from '../src/services/mailer.ts'
import { createResetLimiter } from '../src/services/password-reset.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  createUser,
  nextIp,
  signIn,
  signInAs,
  TEST_ORIGIN,
  testConfig,
} from './support/app.ts'

const NEW_PASSWORD = 'Yepyeni-Guclu-Parola-5821'

describe('parola sıfırlama (IST-003)', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  const mailer = new MemoryMailer()

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { mailer })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function requestReset(target: App, email: string, ip = nextIp()) {
    return target.inject({
      method: 'POST',
      url: '/api/v1/auth/request-password-reset',
      headers: { origin: TEST_ORIGIN, 'content-type': 'application/json' },
      remoteAddress: ip,
      payload: { email },
    })
  }

  function resetPassword(token: string, newPassword = NEW_PASSWORD) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      headers: { origin: TEST_ORIGIN, 'content-type': 'application/json' },
      remoteAddress: nextIp(),
      payload: { token, newPassword },
    })
  }

  function getSession(cookie: string) {
    return app.inject({
      method: 'GET',
      url: '/api/v1/auth/get-session',
      headers: { origin: TEST_ORIGIN, cookie },
    })
  }

  /** Bellek kutusundaki son iletinin belirteci (web bağlantısının `token` parametresi). */
  function tokenFor(email: string): string {
    const mail = mailer.lastTo(email)
    assert.ok(mail, 'ileti yok')
    const url = new URL(mail.url)
    const token = url.searchParams.get('token')
    assert.ok(token)
    return token
  }

  async function auditsOf(userId: string) {
    return db.select().from(auditLog).where(eq(auditLog.actorUserId, userId))
  }

  test('IST-003: hesap var ve yok aynı durum ve gövdeyi döndürür; ileti yalnız hesaba gider', async () => {
    const institution = await createInstitution(app, { name: 'Sıfırlama Koleji' })
    const user = await createMember(app, institution.id, 'ogretmen')
    const before = mailer.outbox.length

    const known = await requestReset(app, user.email)
    const unknown = await requestReset(app, 'boyle-biri-yok@kampus.example')

    assert.equal(known.statusCode, 200)
    assert.equal(unknown.statusCode, known.statusCode)
    assert.deepEqual(unknown.json(), known.json())
    assert.equal(known.headers['set-cookie'], undefined)
    assert.equal(mailer.outbox.length, before + 1)
    const mail = mailer.lastTo(user.email)
    assert.ok(mail)
    assert.equal(mail.institutionName, 'Sıfırlama Koleji')
    // Bağlantı API'ye değil web sayfasına gider.
    assert.match(mail.url, /^http:\/\/localhost:5174\/parola-sifirla\?token=[\w-]+$/)
    const audits = await auditsOf(user.id)
    assert.deepEqual(
      audits.map((row) => [row.action, row.institutionId, row.changes]),
      [['auth.password_reset_requested', institution.id, null]],
    )
    const anonymous = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'auth.password_reset_requested'))
    assert.ok(anonymous.some((row) => row.changes?.reason === 'unknown_user' && !row.actorUserId))
  })

  test('IST-003: belirteçle parola değişir, eski parola geçmez, bütün oturumlar kapanır', async () => {
    const institution = await createInstitution(app)
    const user = await createMember(app, institution.id, 'veli')
    const cookieA = await signInAs(app, user)
    const cookieB = await signInAs(app, user)
    assert.equal((await getSession(cookieA)).json()?.user.id, user.id)

    await requestReset(app, user.email)
    const token = tokenFor(user.email)
    // Veritabanında belirtecin kendisi tutulmaz (özet).
    const stored = await db.select().from(verifications).where(eq(verifications.value, user.id))
    assert.equal(stored.length, 1)
    assert.equal(stored[0]?.identifier.includes(token), false)

    const reset = await resetPassword(token)
    assert.equal(reset.statusCode, 200)

    for (const cookie of [cookieA, cookieB]) assert.equal((await getSession(cookie)).json(), null)
    assert.equal((await db.select().from(sessions).where(eq(sessions.userId, user.id))).length, 0)
    assert.equal((await signIn(app, user.email, user.password)).statusCode, 401)
    assert.equal((await signIn(app, user.email, NEW_PASSWORD)).statusCode, 200)
    assert.ok(
      (await auditsOf(user.id)).some(
        (row) =>
          row.action === 'auth.password_reset_completed' && row.institutionId === institution.id,
      ),
    )
  })

  test('IST-003: belirteç tek kullanımlıktır', async () => {
    const institution = await createInstitution(app)
    const user = await createMember(app, institution.id, 'ogrenci')
    await requestReset(app, user.email)
    const token = tokenFor(user.email)

    assert.equal((await resetPassword(token)).statusCode, 200)
    const again = await resetPassword(token, 'Baska-Bir-Guclu-Parola-77')
    assert.equal(again.statusCode, 400)
    assert.equal(again.json().code, 'INVALID_TOKEN')
    assert.equal(again.json().message, 'Bağlantının süresi dolmuş veya geçersiz.')
    assert.equal((await signIn(app, user.email, NEW_PASSWORD)).statusCode, 200)
  })

  test('IST-003: süresi geçmiş ve uydurma belirteç reddedilir, parola değişmez', async () => {
    const institution = await createInstitution(app)
    const user = await createMember(app, institution.id, 'ogretmen')
    await requestReset(app, user.email)
    const token = tokenFor(user.email)
    const [row] = await db.select().from(verifications).where(eq(verifications.value, user.id))
    assert.ok(row)
    // Belirteç 30 dk geçerlidir.
    const lifetime = row.expiresAt.getTime() - row.createdAt.getTime()
    assert.ok(Math.abs(lifetime - 30 * 60 * 1000) < 5000, `süre ${lifetime} ms`)
    await db
      .update(verifications)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(verifications.id, row.id))

    for (const candidate of [token, 'uydurma-belirtec-123456']) {
      const response = await resetPassword(candidate)
      assert.equal(response.statusCode, 400, candidate)
      assert.equal(response.json().code, 'INVALID_TOKEN')
    }
    assert.equal((await signIn(app, user.email, user.password)).statusCode, 200)
    assert.equal(
      (await auditsOf(user.id)).some((item) => item.action === 'auth.password_reset_completed'),
      false,
    )
  })

  test('IST-003: sıfırlamada da yaygın ve kısa parola reddedilir', async () => {
    const institution = await createInstitution(app)
    const user = await createMember(app, institution.id, 'ogretmen')
    await requestReset(app, user.email)
    const token = tokenFor(user.email)
    const common = await resetPassword(token, 'password12345')
    assert.equal(common.statusCode, 400)
    assert.equal(common.json().code, 'PASSWORD_TOO_COMMON')
    const short = await resetPassword(token, 'Kisa-1')
    assert.equal(short.statusCode, 400)
    assert.equal(short.json().code, 'PASSWORD_TOO_SHORT')
    // Reddedilen denemeler belirteci tüketmez.
    assert.equal((await resetPassword(token)).statusCode, 200)
  })

  test('IST-003: kurumda üyeliği kalmamış hesaba ileti gitmez, yanıt yine aynıdır', async () => {
    const institution = await createInstitution(app)
    const member = await createMember(app, institution.id, 'ogrenci')
    await db
      .delete(memberships)
      .where(and(eq(memberships.userId, member.id), eq(memberships.institutionId, institution.id)))
    const outsider = await createUser(app)
    const before = mailer.outbox.length

    const responses = [
      await requestReset(app, member.email),
      await requestReset(app, outsider.email),
      await requestReset(app, 'kimse-yok@kampus.example'),
    ]
    for (const response of responses) {
      assert.equal(response.statusCode, 200)
      assert.deepEqual(response.json(), responses[0]?.json())
    }
    assert.equal(mailer.outbox.length, before)
    for (const user of [member, outsider])
      assert.deepEqual(
        (await auditsOf(user.id)).map((row) => [row.action, row.institutionId, row.changes]),
        [['auth.password_reset_requested', null, { reason: 'no_membership' }]],
      )
  })

  test('IST-003: aynı IP’den saatte en çok 3 sıfırlama isteği; 4. istek 429', async () => {
    const institution = await createInstitution(app)
    const user = await createMember(app, institution.id, 'veli')
    const ip = nextIp()
    const statuses: number[] = []
    let last
    for (let attempt = 0; attempt < 4; attempt += 1) {
      last = await requestReset(app, user.email, ip)
      statuses.push(last.statusCode)
    }
    assert.deepEqual(statuses, [200, 200, 200, 429])
    assert.ok(Number(last?.headers['retry-after']) > 0)
  })

  test('IST-003: aynı hesaba farklı IP’lerden saatte en çok 3 ileti; yanıt değişmez', async () => {
    const institution = await createInstitution(app)
    const user = await createMember(app, institution.id, 'veli')
    const before = mailer.outbox.length
    const responses: Awaited<ReturnType<typeof requestReset>>[] = []
    for (let attempt = 0; attempt < 5; attempt += 1)
      responses.push(await requestReset(app, user.email.toUpperCase()))

    assert.deepEqual(
      responses.map((response) => response.statusCode),
      [200, 200, 200, 200, 200],
    )
    assert.ok(responses.every((response) => response.body === responses[0]?.body))
    assert.equal(mailer.outbox.length, before + 3)
    const audits = await auditsOf(user.id)
    assert.deepEqual(
      audits.map((row) => row.changes?.reason ?? null),
      [null, null, null, 'rate_limited', 'rate_limited'],
    )
    // Başka hesap bu sınırdan etkilenmez.
    const other = await createMember(app, institution.id, 'ogretmen')
    assert.equal((await requestReset(app, other.email)).statusCode, 200)
    assert.ok(mailer.lastTo(other.email))
  })

  test('IST-003: e-posta sınırı kayan penceredir ve hesaplar birbirinden bağımsızdır', () => {
    const limiter = createResetLimiter(2, 1000)
    assert.equal(limiter.take('a@x.example', 0), true)
    assert.equal(limiter.take('A@x.example ', 10), true)
    assert.equal(limiter.take('a@x.example', 20), false)
    assert.equal(limiter.take('b@x.example', 20), true)
    // İlk iki istek pencereden düşünce yeniden izin verilir.
    assert.equal(limiter.take('a@x.example', 1011), true)
    assert.equal(limiter.take('a@x.example', 1012), true)
    assert.equal(limiter.take('a@x.example', 1013), false)
  })

  test('IST-003: testte ve üretimde belirteç loga yazılmaz; üretimde sağlayıcı yoksa gönderilmez', async () => {
    const testLogs: string[] = []
    const memory = new MemoryMailer()
    const testApp = await buildTestApp(db, { logs: testLogs, mailer: memory })
    const prodLogs: string[] = []
    const prodApp = await buildTestApp(db, {
      logs: prodLogs,
      config: testConfig({
        LOG_LEVEL: 'debug',
        NODE_ENV: 'production',
        BETTER_AUTH_URL: 'https://api.kampus.example',
        BETTER_AUTH_SECRET: 'b4Jx9-uretim-icin-uretilmis-rastgele-deger-Qm2',
        WEB_URL: 'https://kampus.example',
        CORS_ORIGINS: 'https://kampus.example',
      }),
    })
    try {
      const institution = await createInstitution(testApp)
      const user = institution.admin
      assert.equal((await requestReset(testApp, user.email)).statusCode, 200)
      const token = new URL(memory.lastTo(user.email)?.url ?? '').searchParams.get('token')
      assert.ok(token)
      const testText = testLogs.join('')
      assert.ok(testText.includes('mail.password_reset'), 'test logunda gönderim kaydı yok')
      assert.ok(testText.includes('/parola-sifirla?token=[gizli]'))
      for (const secret of [token, user.email])
        assert.equal(testText.includes(secret), false, 'test logunda gizli değer')

      const prodResponse = await prodApp.inject({
        method: 'POST',
        url: '/api/v1/auth/request-password-reset',
        headers: { origin: 'https://kampus.example', 'content-type': 'application/json' },
        remoteAddress: nextIp(),
        payload: { email: user.email },
      })
      assert.equal(prodResponse.statusCode, 200)
      const prodText = prodLogs.join('')
      assert.ok(prodText.includes('mail_provider_not_configured'), 'üretimde uyarı yok')
      assert.equal(prodText.includes('parola-sifirla'), false)
      assert.equal(prodText.includes(user.email), false)
      assert.ok(
        (await auditsOf(user.id)).some(
          (row) =>
            row.action === 'auth.password_reset_requested' &&
            row.changes?.reason === 'mail_not_configured',
        ),
      )
    } finally {
      await testApp.close()
      await prodApp.close()
    }
  })

  test('IST-003: geliştirme göndericisi bağlantıyı belirteciyle loga yazar, adresi yazmaz', async () => {
    const lines: { object: object; message: string }[] = []
    const record = (object: object, message: string) => lines.push({ object, message })
    const mailerForDev = createLogMailer({ info: record, warn: record, error: record })
    const url = 'http://localhost:5174/parola-sifirla?token=abc123'
    await mailerForDev.sendPasswordReset({
      to: 'kisi@kampus.example',
      url,
      institutionName: 'Akademi',
    })
    assert.equal(lines.length, 1)
    const text = JSON.stringify(lines)
    assert.ok(text.includes('token=abc123'))
    assert.equal(text.includes('kisi@kampus.example'), false)
    assert.equal(maskResetUrl(url), 'http://localhost:5174/parola-sifirla?token=[gizli]')
  })
})
