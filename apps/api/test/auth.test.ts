import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { sessions } from '../src/db/schema/auth.ts'
import { deviceSummary } from '../src/lib/session-device.ts'
import { ensureMember } from '../src/services/identity.ts'
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

  test('IST-025: farklı IP’lerden 10 hatalı denemeden sonra hesap geçici kilitlenir, doğru parola da 429', async () => {
    const institution = await createInstitution(app)
    const teacher = await createMember(app, institution.id, 'ogretmen')
    const statuses: number[] = []
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await signIn(app, teacher.email, 'Yanlis-Parola-123!')
      statuses.push(response.statusCode)
      assert.equal(response.json().message, 'E-posta veya parola hatalı.')
    }
    assert.deepEqual(statuses, Array(10).fill(401))
    const locked = await signIn(app, ` ${teacher.email.toUpperCase()} `, teacher.password)
    assert.equal(locked.statusCode, 429)
    assert.equal(locked.cookies.length, 0)
    assert.ok(Number(locked.headers['retry-after']) > 0)
    assert.equal(locked.json().code, 'RATE_LIMITED')
    // Başka hesap etkilenmez.
    assert.equal(
      (await signIn(app, institution.admin.email, institution.admin.password)).statusCode,
      200,
    )
  })

  test('IST-025: kilit hesabın varlığını belli etmez; yanıt IP sınırıyla aynıdır', async () => {
    const institution = await createInstitution(app)
    const student = await createMember(app, institution.id, 'ogrenci')
    const unknown = 'kilit-yok-boyle-biri@kampus.example'
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await signIn(app, student.email, 'Yanlis-Parola-123!')
      await signIn(app, unknown, 'Yanlis-Parola-123!')
    }
    const existing = await signIn(app, student.email, 'Yanlis-Parola-123!')
    const missing = await signIn(app, unknown, 'Yanlis-Parola-123!')
    assert.equal(existing.statusCode, 429)
    assert.equal(missing.statusCode, 429)
    assert.equal(missing.body, existing.body)
    // Better Auth IP sınırıyla aynı gövde ve başlık adları.
    const ip = nextIp()
    let ipLimited
    for (let attempt = 0; attempt < 6; attempt += 1)
      ipLimited = await signIn(app, `ip-${attempt}@kampus.example`, 'Yanlis-Parola-123!', ip)
    assert.equal(ipLimited?.statusCode, 429)
    assert.equal(existing.body, ipLimited?.body)
    const headerNames = (response: typeof existing) =>
      Object.keys(response.headers)
        .filter((name) => !['date', 'x-request-id', 'content-length'].includes(name))
        .sort()
    assert.deepEqual(headerNames(existing), headerNames(ipLimited ?? existing))
    // Kilitli denemeler denetimde yeni başarısız giriş satırı açmaz (Better Auth'a ulaşmaz).
    const failures = await db.select().from(auditLog).where(eq(auditLog.actorUserId, student.id))
    assert.equal(failures.length, 10)
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

describe('parola değişimi ve oturum yönetimi (IST-003)', () => {
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

  const CHROME_MAC =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  const SAFARI_IPHONE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'

  async function signInWithAgent(
    user: { email: string; password: string },
    userAgent: string,
    ip = nextIp(),
  ): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in/email',
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        'user-agent': userAgent,
      },
      remoteAddress: ip,
      payload: { email: user.email, password: user.password },
    })
    assert.equal(response.statusCode, 200)
    return response.cookies.map((item) => `${item.name}=${item.value}`).join('; ')
  }

  function call(method: 'GET' | 'POST', path: string, cookie: string, payload?: object) {
    return app.inject({
      method,
      url: `/api/v1/auth${path}`,
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      },
      remoteAddress: nextIp(),
      ...(method === 'POST' ? { payload: payload ?? {} } : {}),
    })
  }

  async function sessionUser(cookie: string): Promise<string | null> {
    const response = await call('GET', '/get-session', cookie)
    const body: { user?: { id: string } } | null = response.json()
    return body?.user?.id ?? null
  }

  test('IST-003: parola değişiminde "diğer cihazlardan çık" diğer oturumları kapatır, bu oturum sürer', async () => {
    const institution = await createInstitution(app)
    const user = await createMember(app, institution.id, 'ogretmen')
    const here = await signInWithAgent(user, CHROME_MAC)
    const other = await signInWithAgent(user, SAFARI_IPHONE)

    const response = await call('POST', '/change-password', here, {
      currentPassword: user.password,
      newPassword: 'Yeni-Guclu-Parola-4417',
      revokeOtherSessions: true,
    })
    assert.equal(response.statusCode, 200)
    // Better Auth bu cihaza yeni oturum çerezi verir; eski ve diğer oturumlar silinir.
    const renewed = response.cookies.map((item) => `${item.name}=${item.value}`).join('; ')
    assert.ok(renewed.includes('kampus.session_token='), 'yeni oturum çerezi yok')
    assert.equal(await sessionUser(renewed), user.id)
    assert.equal(await sessionUser(other), null)
    assert.equal((await db.select().from(sessions).where(eq(sessions.userId, user.id))).length, 1)
    // Eski oturum da gerçekten iptal edilir (listede ayrı satır olarak kalmaz): Better Auth
    // hepsini siler ve bu cihaza yenisini açar; liste tek ve "bu cihaz" satırıdır.
    assert.equal(await sessionUser(here), null)
    const listed = await call('GET', '/list-sessions', renewed)
    assert.equal(listed.statusCode, 200)
    const rows: { current: boolean }[] = listed.json()
    assert.deepEqual(
      rows.map((row) => row.current),
      [true],
    )
  })

  test('IST-003: diğer cihazlardan çıkışta yenilenen oturum etkin kurumu korur', async () => {
    const a = await createInstitution(app)
    const b = await createInstitution(app)
    await ensureMember(app.auth, db, { institutionId: b.id, userId: a.admin.id, role: 'onburo' })
    const here = await signInWithAgent(a.admin, CHROME_MAC)
    const switched = await call('POST', '/organization/set-active', here, { organizationId: b.id })
    assert.equal(switched.statusCode, 200)
    const response = await call('POST', '/change-password', here, {
      currentPassword: a.admin.password,
      newPassword: 'Yeni-Guclu-Parola-6620',
      revokeOtherSessions: true,
    })
    assert.equal(response.statusCode, 200)
    const rows = await db.select().from(sessions).where(eq(sessions.userId, a.admin.id))
    assert.deepEqual(
      rows.map((row) => row.activeInstitutionId),
      [b.id],
    )
  })

  test('IST-003: seçenek verilmezse parola değişimi diğer oturumları açık bırakır', async () => {
    const institution = await createInstitution(app)
    const user = await createMember(app, institution.id, 'veli')
    const here = await signInWithAgent(user, CHROME_MAC)
    const other = await signInWithAgent(user, SAFARI_IPHONE)
    const response = await call('POST', '/change-password', here, {
      currentPassword: user.password,
      newPassword: 'Yeni-Guclu-Parola-9902',
    })
    assert.equal(response.statusCode, 200)
    assert.equal(await sessionUser(other), user.id)
  })

  test('IST-003: yanlış mevcut parola 400, parola ve oturumlar değişmez', async () => {
    const institution = await createInstitution(app)
    const user = await createMember(app, institution.id, 'ogrenci')
    const here = await signInWithAgent(user, CHROME_MAC)
    const other = await signInWithAgent(user, SAFARI_IPHONE)
    const response = await call('POST', '/change-password', here, {
      currentPassword: 'Yanlis-Mevcut-Parola-1',
      newPassword: 'Yeni-Guclu-Parola-3310',
      revokeOtherSessions: true,
    })
    assert.equal(response.statusCode, 400)
    assert.equal(response.json().message, 'Parola hatalı.')
    assert.equal(await sessionUser(other), user.id)
    assert.equal((await signIn(app, user.email, user.password)).statusCode, 200)
  })

  test('IST-003: oturum listesi IP ve ham kullanıcı ajanı yerine cihaz özeti döndürür', async () => {
    const institution = await createInstitution(app)
    const user = await createMember(app, institution.id, 'ogretmen')
    const ip = '203.0.113.45'
    const here = await signInWithAgent(user, CHROME_MAC, ip)
    await signInWithAgent(user, SAFARI_IPHONE)

    const response = await call('GET', '/list-sessions', here)
    assert.equal(response.statusCode, 200)
    const list: Record<string, unknown>[] = response.json()
    assert.equal(list.length, 2)
    for (const item of list)
      assert.deepEqual(Object.keys(item).sort(), [
        'createdAt',
        'current',
        'device',
        'expiresAt',
        'id',
        'updatedAt',
      ])
    assert.deepEqual(
      list.map((item) => [item.device, item.current]),
      [
        ['Chrome · macOS', true],
        ['Safari · iOS', false],
      ],
    )
    for (const raw of [ip, 'Mozilla', 'AppleWebKit', user.id])
      assert.equal(response.body.includes(raw), false, raw)
    // IST-025: oturum belirteci (çerezin özü) hiçbir satırda istemciye gitmez.
    const tokens = await db
      .select({ token: sessions.token })
      .from(sessions)
      .where(eq(sessions.userId, user.id))
    assert.equal(tokens.length, 2)
    for (const { token } of tokens) assert.equal(response.body.includes(token), false)
  })

  test('IST-003: tek oturum ve diğer bütün oturumlar sonlandırılır; başkasının oturumu etkilenmez', async () => {
    const institution = await createInstitution(app)
    const user = await createMember(app, institution.id, 'yonetici')
    const stranger = await createMember(app, institution.id, 'ogretmen')
    const here = await signInWithAgent(user, CHROME_MAC)
    const phone = await signInWithAgent(user, SAFARI_IPHONE)
    const tablet = await signInWithAgent(user, SAFARI_IPHONE)
    const strangerCookie = await signInWithAgent(stranger, CHROME_MAC)
    const [strangerSession] = await db
      .select({ id: sessions.id, token: sessions.token })
      .from(sessions)
      .where(eq(sessions.userId, stranger.id))
    assert.ok(strangerSession)

    const list: { id: string; current: boolean }[] = (
      await call('GET', '/list-sessions', here)
    ).json()
    const phoneId = list.find((item) => !item.current)?.id
    assert.ok(phoneId)
    const revoked = await call('POST', '/revoke-session', here, { sessionId: phoneId })
    assert.equal(revoked.statusCode, 200)
    const remaining = [await sessionUser(phone), await sessionUser(tablet)].filter(Boolean)
    assert.equal(remaining.length, 1)

    // IST-025: başkasının oturum kimliği ya da belirteci verilse de onun oturumu kapanmaz; yanıt
    // kendi oturumundaki gibidir (kimliğin varlığı belli olmaz).
    const foreign = await call('POST', '/revoke-session', here, { sessionId: strangerSession.id })
    assert.equal(foreign.statusCode, 200)
    assert.deepEqual(foreign.json(), revoked.json())
    const unknown = await call('POST', '/revoke-session', here, { sessionId: 'olmayan-oturum' })
    assert.deepEqual(unknown.json(), revoked.json())
    // Ham belirteç kabul edilmez: kimlik zorunlu, `token` yok sayılır.
    const rawToken = await call('POST', '/revoke-session', here, { token: strangerSession.token })
    assert.equal(rawToken.statusCode, 400)
    const both = await call('POST', '/revoke-session', here, {
      sessionId: 'olmayan-oturum',
      token: strangerSession.token,
    })
    assert.equal(both.statusCode, 200)
    assert.equal(await sessionUser(strangerCookie), stranger.id)

    const others = await call('POST', '/revoke-other-sessions', here)
    assert.equal(others.statusCode, 200)
    assert.equal(await sessionUser(phone), null)
    assert.equal(await sessionUser(tablet), null)
    assert.equal(await sessionUser(here), user.id)
  })

  test('IST-003, IST-025: oturum listesi ve kapatma taze oturum ister; oturumsuz istek 401', async () => {
    const institution = await createInstitution(app)
    const user = await createMember(app, institution.id, 'ogretmen')
    const cookie = await signInWithAgent(user, CHROME_MAC)
    const phone = await signInWithAgent(user, SAFARI_IPHONE)
    const phoneSession = (
      await db
        .select({ id: sessions.id, userAgent: sessions.userAgent })
        .from(sessions)
        .where(eq(sessions.userId, user.id))
    ).find((row) => row.userAgent === SAFARI_IPHONE)
    assert.ok(phoneSession)
    await db
      .update(sessions)
      .set({ createdAt: new Date(Date.now() - 20 * 60 * 1000) })
      .where(eq(sessions.userId, user.id))
    const stale = await call('GET', '/list-sessions', cookie)
    assert.equal(stale.statusCode, 403)
    assert.equal(stale.json().code, 'SESSION_NOT_FRESH')
    assert.equal(stale.json().message, 'Bu işlem için yeniden giriş yapın.')
    for (const [path, payload] of [
      ['/revoke-session', { sessionId: phoneSession.id }],
      ['/revoke-other-sessions', {}],
      ['/revoke-sessions', {}],
    ] as const) {
      const response = await call('POST', path, cookie, payload)
      assert.equal(response.statusCode, 403, path)
      assert.equal(response.json().code, 'SESSION_NOT_FRESH', path)
    }
    // Eski oturumla hiçbir oturum kapanmadı.
    assert.equal(await sessionUser(phone), user.id)
    assert.equal(await sessionUser(cookie), user.id)
    assert.equal((await call('GET', '/list-sessions', '')).statusCode, 401)
    assert.equal((await call('POST', '/revoke-other-sessions', '')).statusCode, 401)
    assert.equal(
      (await call('POST', '/revoke-session', '', { sessionId: phoneSession.id })).statusCode,
      401,
    )
  })

  test('IST-003: cihaz özeti kaba ve tanınmazsa boştur', () => {
    assert.equal(deviceSummary(CHROME_MAC), 'Chrome · macOS')
    assert.equal(deviceSummary(SAFARI_IPHONE), 'Safari · iOS')
    assert.equal(
      deviceSummary(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
      ),
      'Edge · Windows',
    )
    assert.equal(
      deviceSummary('Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0'),
      'Firefox · Linux',
    )
    assert.equal(deviceSummary('okhttp/4.12.0'), 'Kampüs uygulaması')
    assert.equal(deviceSummary('curl/8.0'), null)
    assert.equal(deviceSummary(null), null)
  })
})
