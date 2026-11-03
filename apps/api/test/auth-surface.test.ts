import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import type { App } from '../src/app.ts'
import { AUTH_BASE_PATH, OPEN_AUTH_PATHS } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'

type Method = 'GET' | 'POST'

interface RegisteredEndpoint {
  path: string
  methods: Method[]
}

/** Better Auth'un uç kaydı (`auth.api`): HTTP yolu olan her uç ve yöntemleri. */
function registeredEndpoints(app: App): RegisteredEndpoint[] {
  const endpoints: RegisteredEndpoint[] = []
  for (const endpoint of Object.values(app.auth.api)) {
    const path: unknown = Reflect.get(endpoint, 'path')
    const options: unknown = Reflect.get(endpoint, 'options')
    // Yolu olmayan uçlar (ör. `setPassword`, `addMember`) yalnız sunucudan çağrılır.
    if (typeof path !== 'string' || typeof options !== 'object' || options === null) continue
    const method: unknown = Reflect.get(options, 'method')
    const methods = (Array.isArray(method) ? method : [method]).filter(
      (item): item is Method => item === 'GET' || item === 'POST',
    )
    endpoints.push({ path, methods: methods.length > 0 ? methods : ['GET', 'POST'] })
  }
  return endpoints
}

describe('Better Auth uç yüzeyi', () => {
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

  function call(method: Method, url: string, cookie?: string) {
    return app.inject({
      method,
      url,
      headers: {
        origin: TEST_ORIGIN,
        ...(cookie ? { cookie } : {}),
        ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      },
      ...(method === 'POST' ? { payload: {} } : {}),
    })
  }

  test('izin listesindeki her yol Better Auth kaydında bulunur', () => {
    const registered = new Set(registeredEndpoints(app).map((endpoint) => endpoint.path))
    for (const path of OPEN_AUTH_PATHS) assert.ok(registered.has(path), `kayıtlı değil: ${path}`)
  })

  test('izin listesinde olmayan her kayıtlı uç oturumlu yönetici için de 404 döner', async () => {
    const institution = await createInstitution(app)
    const cookie = await signInAs(app, institution.admin)
    const closed = registeredEndpoints(app).filter(
      (endpoint) => !OPEN_AUTH_PATHS.has(endpoint.path),
    )
    assert.ok(closed.length > 20, 'kapalı uç listesi beklenenden kısa')

    for (const endpoint of closed) {
      const url = `${AUTH_BASE_PATH}${endpoint.path.replaceAll(/:[A-Za-z]+/g, 'test-param')}`
      for (const method of endpoint.methods) {
        const response = await call(method, url, cookie)
        assert.equal(response.statusCode, 404, `${method} ${endpoint.path}`)
        assert.equal(response.json().code, 'not_found', `${method} ${endpoint.path}`)
        assert.equal(response.headers['set-cookie'], undefined, `${method} ${endpoint.path}`)
      }
    }
  })

  test('yol varyantları izin listesini aşamaz', async () => {
    const institution = await createInstitution(app)
    const cookie = await signInAs(app, institution.admin)
    for (const url of [
      `${AUTH_BASE_PATH}/sign-in/../organization/list-members`,
      `${AUTH_BASE_PATH}/organization%2Flist-members`,
      `${AUTH_BASE_PATH}/organization/list-members/`,
      `${AUTH_BASE_PATH}//organization/list-members`,
      `${AUTH_BASE_PATH}/Organization/List-Members`,
    ]) {
      const response = await call('GET', url, cookie)
      assert.equal(response.statusCode, 404, url)
    }
  })

  test('Expo yetkilendirme vekili dış adrese yönlendirmez', async () => {
    const response = await call(
      'GET',
      `${AUTH_BASE_PATH}/expo-authorization-proxy?authorizationURL=${encodeURIComponent('https://kotu.example/giris')}`,
    )
    assert.equal(response.statusCode, 404)
    assert.equal(response.headers.location, undefined)
  })

  test('öğrenci ve veli üye listesini, tam kurumu ve başkasının rolünü göremez', async () => {
    const institution = await createInstitution(app)
    const student = await createMember(app, institution.id, 'ogrenci')
    const parent = await createMember(app, institution.id, 'veli')
    const query = `organizationId=${institution.id}`

    for (const member of [student, parent]) {
      const cookie = await signInAs(app, member)
      for (const url of [
        `${AUTH_BASE_PATH}/organization/list-members?${query}`,
        `${AUTH_BASE_PATH}/organization/get-full-organization?${query}`,
        `${AUTH_BASE_PATH}/organization/get-active-member-role?userId=${institution.admin.id}`,
      ]) {
        const response = await call('GET', url, cookie)
        assert.equal(response.statusCode, 404, url)
        assert.equal(JSON.stringify(response.json()).includes(institution.admin.id), false, url)
      }
    }
  })

  test('açık uçlar çalışmaya devam eder', async () => {
    const institution = await createInstitution(app)
    const student = await createMember(app, institution.id, 'ogrenci')
    const cookie = await signInAs(app, student)

    const session = await call('GET', `${AUTH_BASE_PATH}/get-session`, cookie)
    assert.equal(session.statusCode, 200)
    assert.equal(session.json().user.id, student.id)
    const list = await call('GET', `${AUTH_BASE_PATH}/organization/list`, cookie)
    assert.equal(list.statusCode, 200)
    assert.deepEqual(
      list.json().map((item: { id: string }) => item.id),
      [institution.id],
    )
    const member = await call('GET', `${AUTH_BASE_PATH}/organization/get-active-member`, cookie)
    assert.equal(member.statusCode, 200)
    assert.equal(member.json().userId, student.id)
  })

  test('IST-025: oturum listesi ve kapatma uçları açık; yalnız kendi oturumları, belirteç dönmez', async () => {
    const institution = await createInstitution(app)
    const student = await createMember(app, institution.id, 'ogrenci')
    const here = await signInAs(app, student)
    const other = await signInAs(app, student)
    const stranger = await signInAs(app, institution.admin)
    const post = (path: string, cookie: string, payload: object) =>
      app.inject({
        method: 'POST',
        url: `${AUTH_BASE_PATH}${path}`,
        headers: { origin: TEST_ORIGIN, cookie, 'content-type': 'application/json' },
        payload,
      })

    const listed = await call('GET', `${AUTH_BASE_PATH}/list-sessions`, here)
    assert.equal(listed.statusCode, 200)
    const rows: { id: string; current: boolean }[] = listed.json()
    assert.equal(rows.length, 2)
    assert.equal(listed.body.includes('token'), false)
    for (const cookie of [here, other, stranger]) {
      const token = /kampus\.session_token=([^.;]+)/.exec(cookie)?.[1]
      assert.ok(token)
      assert.equal(listed.body.includes(token), false)
    }
    const adminRows: { id: string }[] = (
      await call('GET', `${AUTH_BASE_PATH}/list-sessions`, stranger)
    ).json()
    assert.equal(
      adminRows.some((row) => rows.some((own) => own.id === row.id)),
      false,
    )

    // Başkasının oturum kimliği kapatılamaz; kendi öteki oturumu kapanır.
    const [adminSession] = adminRows
    assert.ok(adminSession)
    assert.equal(
      (await post('/revoke-session', here, { sessionId: adminSession.id })).statusCode,
      200,
    )
    assert.equal(
      (await call('GET', `${AUTH_BASE_PATH}/get-session`, stranger)).json()?.user?.id,
      institution.admin.id,
    )
    const otherId = rows.find((row) => !row.current)?.id
    assert.ok(otherId)
    assert.equal((await post('/revoke-session', here, { sessionId: otherId })).statusCode, 200)
    assert.equal((await call('GET', `${AUTH_BASE_PATH}/get-session`, other)).json(), null)

    assert.equal((await post('/revoke-other-sessions', here, {})).statusCode, 200)
    assert.equal(
      (await call('GET', `${AUTH_BASE_PATH}/get-session`, here)).json()?.user?.id,
      student.id,
    )
  })
})
