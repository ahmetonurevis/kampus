import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, or } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { memberships, sessions, verifications } from '../src/db/schema/auth.ts'
import { createLogMailer, maskResetUrl, MemoryMailer, type Mailer } from '../src/services/mailer.ts'
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

  /** Bellek kutusundaki son iletinin belirteci (web bağlantısının adres parçasındaki `token`). */
  function tokenFor(email: string): string {
    const mail = mailer.lastTo(email)
    assert.ok(mail, 'ileti yok')
    const url = new URL(mail.url)
    assert.equal(url.search, '', 'belirteç sorguda olmamalı (sunucu loguna ve Referer’e girer)')
    const token = new URLSearchParams(url.hash.slice(1)).get('token')
    assert.ok(token)
    return token
  }

  /** Kullanıcının kendi işi (`actor`) ya da hakkında yazılan (`entity`) denetim satırları. */
  async function auditsOf(userId: string) {
    return db
      .select()
      .from(auditLog)
      .where(or(eq(auditLog.actorUserId, userId), eq(auditLog.entityId, userId)))
      .orderBy(auditLog.createdAt)
  }

  async function tokenRows(userId: string) {
    return db.select().from(verifications).where(eq(verifications.value, userId))
  }

  /** Soğuma penceresini geçmek için kullanıcının belirteçlerini geçmişe taşır. */
  async function ageTokens(userId: string, minutes: number) {
    for (const row of await tokenRows(userId))
      await db
        .update(verifications)
        .set({ createdAt: new Date(row.createdAt.getTime() - minutes * 60_000) })
        .where(eq(verifications.id, row.id))
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
    assert.match(mail.url, /^http:\/\/localhost:5174\/parola-sifirla#token=[\w-]+$/)
    const audits = await auditsOf(user.id)
    assert.deepEqual(
      audits.map((row) => [row.action, row.institutionId, row.changes]),
      [['auth.password_reset_requested', institution.id, null]],
    )
    // Talep oturumsuzdur: işi yapan kanıtlanmamıştır, kayıt hesap sahibine aktör olarak yazılmaz;
    // hedef varlık olarak görünür.
    assert.equal(audits[0]?.actorUserId, null)
    assert.deepEqual([audits[0]?.entityType, audits[0]?.entityId], ['user', user.id])
  })

  test('IST-003: bilinmeyen e-posta denetime aktörsüz, varlıksız ve e-postasız yazılır', async () => {
    const stranger = `bilinmeyen-${randomUUID().slice(0, 8)}@kampus.example`
    const response = await requestReset(app, stranger)
    assert.equal(response.statusCode, 200)
    const rows = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'auth.password_reset_requested'))
    const mine = rows.filter((row) => row.changes?.reason === 'unknown_user')
    assert.ok(mine.length > 0)
    const last = mine.at(-1)
    assert.equal(last?.actorUserId, null)
    assert.equal(last?.entityId, null)
    assert.equal(
      JSON.stringify(rows).includes(stranger),
      false,
      'ham e-posta denetim kaydına girmemeli',
    )
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

  test('IST-025: sıfırlamada e-posta ve kurum adı türevi de reddedilir (hesap belirteçten çözülür)', async () => {
    const institution = await createInstitution(app, { name: 'Zeytinlik Koleji' })
    const user = await createMember(app, institution.id, 'veli')
    await requestReset(app, user.email)
    const token = tokenFor(user.email)
    const local = user.email.split('@')[0] ?? ''
    for (const password of [`${local}-2026!`, 'Zeytinlik-Parola-77']) {
      const response = await resetPassword(token, password)
      assert.equal(response.statusCode, 400, password)
      assert.equal(response.json().code, 'PASSWORD_TOO_COMMON', password)
    }
    // Geçersiz belirteçte hesap çözülmez; Better Auth belirteci reddeder.
    const invalid = await resetPassword('gecersiz-belirtec', 'Zeytinlik-Parola-77')
    assert.equal(invalid.json().code, 'INVALID_TOKEN')
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

  test('IST-003: açık belirteç varken 5 dakika içinde yeni ileti ve belirteç satırı yazılmaz', async () => {
    const institution = await createInstitution(app)
    const user = await createMember(app, institution.id, 'veli')
    const before = mailer.outbox.length
    const first = await requestReset(app, user.email)
    // Farklı IP'lerden art arda istek: IP sınırı değil, hesap soğuması devrede.
    const repeats = [
      await requestReset(app, user.email.toUpperCase()),
      await requestReset(app, user.email),
    ]

    for (const response of repeats) {
      assert.equal(response.statusCode, 200)
      assert.equal(response.body, first.body)
    }
    assert.equal(mailer.outbox.length, before + 1)
    assert.equal((await tokenRows(user.id)).length, 1, 'doğrulama satırı birikmemeli')
    assert.deepEqual(
      (await auditsOf(user.id)).map((row) => row.changes?.reason ?? null),
      [null, 'cooldown', 'cooldown'],
    )

    // Pencere geçince yeni ileti gider.
    await ageTokens(user.id, 6)
    assert.equal((await requestReset(app, user.email)).statusCode, 200)
    assert.equal(mailer.outbox.length, before + 2)
    // Başka hesap bu soğumadan etkilenmez.
    const other = await createMember(app, institution.id, 'ogretmen')
    assert.equal((await requestReset(app, other.email)).statusCode, 200)
    assert.ok(mailer.lastTo(other.email))
  })

  test('IST-003: aynı hesaba saatte en çok 3 ileti; fazlası gönderilmez, satır yazılmaz', async () => {
    const institution = await createInstitution(app)
    const user = await createMember(app, institution.id, 'veli')
    const before = mailer.outbox.length
    const bodies: string[] = []
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await requestReset(app, user.email)
      assert.equal(response.statusCode, 200)
      bodies.push(response.body)
      await ageTokens(user.id, 6)
    }

    assert.equal(new Set(bodies).size, 1, 'yanıt hiç değişmemeli')
    assert.equal(mailer.outbox.length, before + 3)
    assert.equal((await tokenRows(user.id)).length, 3)
    assert.deepEqual(
      (await auditsOf(user.id)).map((row) => row.changes?.reason ?? null),
      [null, null, null, 'rate_limited', 'rate_limited'],
    )
  })

  test('IST-003: iki açık belirteçten biriyle sıfırlayınca diğeri geçersiz olur', async () => {
    const institution = await createInstitution(app)
    const user = await createMember(app, institution.id, 'veli')
    await requestReset(app, user.email)
    const tokenA = tokenFor(user.email)
    // Soğumayı atla: ikinci belirteç (saldırganın ya da eski e-postanın bağlantısı) açık kalır.
    await ageTokens(user.id, 6)
    await requestReset(app, user.email)
    const tokenB = tokenFor(user.email)
    assert.notEqual(tokenA, tokenB)
    assert.equal((await tokenRows(user.id)).length, 2)

    assert.equal((await resetPassword(tokenA)).statusCode, 200)
    assert.deepEqual(await tokenRows(user.id), [], 'bekleyen belirteç silinmeli')
    const second = await resetPassword(tokenB, 'Baska-Bir-Guclu-Parola-7742')
    assert.equal(second.statusCode, 400)
    // Parola A'nınki kalır.
    assert.equal((await signIn(app, user.email, NEW_PASSWORD, nextIp())).statusCode, 200)
  })

  test('IST-003: parola değişimi (change-password) bekleyen sıfırlama belirtecini geçersiz kılar', async () => {
    const institution = await createInstitution(app)
    const user = await createMember(app, institution.id, 'veli')
    await requestReset(app, user.email)
    const token = tokenFor(user.email)
    const cookie = await signInAs(app, user)
    const changed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: { origin: TEST_ORIGIN, 'content-type': 'application/json', cookie },
      remoteAddress: nextIp(),
      payload: { currentPassword: user.password, newPassword: NEW_PASSWORD },
    })
    assert.equal(changed.statusCode, 200)
    assert.deepEqual(await tokenRows(user.id), [])
    assert.equal((await resetPassword(token, 'Baska-Bir-Guclu-Parola-7742')).statusCode, 400)
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

  test('IST-003: ileti arka planda gider; yanıt göndericiyi beklemez, kapanışta tamamlanır', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const sent: string[] = []
    const slow: Mailer = {
      configured: true,
      async sendPasswordReset(mail) {
        await gate
        sent.push(mail.to)
      },
    }
    const backgroundApp = await buildTestApp(db, { mailer: slow, backgroundMail: true })
    const institution = await createInstitution(backgroundApp)
    const user = await createMember(backgroundApp, institution.id, 'veli')
    const response = await requestReset(backgroundApp, user.email)
    assert.equal(response.statusCode, 200)
    assert.deepEqual(sent, [], 'yanıt gönderici bitmeden dönmeli')
    release()
    await backgroundApp.close()
    assert.deepEqual(sent, [user.email])
  })

  for (const [name, overrides, remote, forwarded] of [
    ['vekilsiz', {}, '203.0.113.60', (attempt: number) => `198.51.100.${attempt}`],
    [
      'tek vekil arkasında',
      { TRUST_PROXY: '1' },
      '10.0.0.2',
      (attempt: number) => `198.51.100.${attempt}, 203.0.113.61`,
    ],
  ] as const) {
    test(`IST-003: ${name} sahte X-Forwarded-For sıfırlama hız sınırını aşamaz`, async () => {
      const proxied = await buildTestApp(db, { config: testConfig(overrides) })
      try {
        const statuses: number[] = []
        for (let attempt = 1; attempt <= 4; attempt += 1)
          statuses.push(
            (
              await proxied.inject({
                method: 'POST',
                url: '/api/v1/auth/request-password-reset',
                remoteAddress: remote,
                headers: {
                  origin: TEST_ORIGIN,
                  'content-type': 'application/json',
                  'x-forwarded-for': forwarded(attempt),
                },
                payload: { email: `kimse-${attempt}@kampus.example` },
              })
            ).statusCode,
          )
        assert.deepEqual(statuses, [200, 200, 200, 429])
        if (overrides.TRUST_PROXY) {
          // Vekilin gerçekten ayrı istemci olarak gördüğü başka adres bu sınırdan etkilenmez.
          const other = await proxied.inject({
            method: 'POST',
            url: '/api/v1/auth/request-password-reset',
            remoteAddress: remote,
            headers: {
              origin: TEST_ORIGIN,
              'content-type': 'application/json',
              'x-forwarded-for': '198.51.100.9, 203.0.113.62',
            },
            payload: { email: 'baska-kimse@kampus.example' },
          })
          assert.equal(other.statusCode, 200)
        }
      } finally {
        await proxied.close()
      }
    })
  }

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
      const token = new URLSearchParams(
        new URL(memory.lastTo(user.email)?.url ?? '').hash.slice(1),
      ).get('token')
      assert.ok(token)
      const testText = testLogs.join('')
      assert.ok(testText.includes('mail.password_reset'), 'test logunda gönderim kaydı yok')
      assert.ok(testText.includes('/parola-sifirla#token=[gizli]'))
      for (const secret of [token, user.email])
        assert.equal(testText.includes(secret), false, 'test logunda gizli değer')

      // Aynı hesap 5 dakikalık soğumada olurdu; üretim isteği başka hesaptan gelir.
      const prodUser = await createMember(testApp, institution.id, 'veli')
      const prodResponse = await prodApp.inject({
        method: 'POST',
        url: '/api/v1/auth/request-password-reset',
        headers: { origin: 'https://kampus.example', 'content-type': 'application/json' },
        remoteAddress: nextIp(),
        payload: { email: prodUser.email },
      })
      assert.equal(prodResponse.statusCode, 200)
      const prodText = prodLogs.join('')
      assert.ok(prodText.includes('mail_provider_not_configured'), 'üretimde uyarı yok')
      assert.equal(prodText.includes('parola-sifirla'), false)
      assert.equal(prodText.includes(prodUser.email), false)
      assert.ok(
        (await auditsOf(prodUser.id)).some(
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
    const url = 'http://localhost:5174/parola-sifirla#token=abc123'
    await mailerForDev.sendPasswordReset({
      to: 'kisi@kampus.example',
      url,
      institutionName: 'Akademi',
    })
    assert.equal(lines.length, 1)
    const text = JSON.stringify(lines)
    assert.ok(text.includes('#token=abc123'))
    assert.equal(text.includes('kisi@kampus.example'), false)
    assert.equal(maskResetUrl(url), 'http://localhost:5174/parola-sifirla#token=[gizli]')
  })
})
