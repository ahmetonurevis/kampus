import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { memberships } from '../src/db/schema/auth.ts'
import {
  policyAcknowledgements,
  policyDocuments,
} from '../src/db/schema/finance-policy-acknowledgements.ts'
import { recordFileCheck } from '../src/services/files.ts'
import { ensureMember } from '../src/services/identity.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  createUser,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
  type InstitutionOverrides,
} from './support/app.ts'
import { multipart, PDF, tempStorage, uploadParts } from './support/files-sample.ts'

/**
 * Politika belgesi okundu onayı uçları (DOM-FIN-127; ON-190; K-436…K-438). Her test kendi kurumunu
 * kurar; kurum yöneticisi de personeldir (tüm personel ve idari kitlede sayılır). FIXED_NOW
 * 2026-10-06 (Europe/Istanbul günü de 2026-10-06).
 */

const FINANCE = '/api/v1/finance'
const DOCS = `${FINANCE}/policy-documents`
const ACKS = `${FINANCE}/policy-acknowledgements`
const STAFF = `${FINANCE}/policy-acknowledgement-staff`

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-127: politika onayı uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let store: Awaited<ReturnType<typeof tempStorage>>
  let tenantCount = 0
  let clientIp = '10.127.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    store = await tempStorage()
    app = await buildTestApp(db, { storage: store.storage, clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
    await store.remove()
  })

  function call(
    method: 'GET' | 'POST',
    url: string,
    cookie: string | null,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url,
      remoteAddress: clientIp,
      headers: {
        origin: TEST_ORIGIN,
        ...(cookie === null ? {} : { cookie }),
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
  }
  const get = (url: string, cookie: string | null) => call('GET', url, cookie)
  const post = (url: string, cookie: string | null, body: unknown, key = randomUUID()) =>
    call('POST', url, cookie, body, { 'idempotency-key': key })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.127.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  async function person(t: Tenant, role: Role, name: string) {
    const user = await createUser(app, { name })
    const membership = await ensureMember(app.auth, db, {
      institutionId: t.id,
      userId: user.id,
      role,
    })
    return membership.id
  }
  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))
  async function upload(t: Tenant, cookie: string, name = 'yonetmelik.pdf') {
    const body = multipart(uploadParts('document', PDF, name))
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      remoteAddress: clientIp,
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        'content-type': body.contentType,
        'idempotency-key': randomUUID(),
      },
      payload: body.payload,
    })
    assert.equal(response.statusCode, 201, response.body)
    const id: string = response.json().data.id
    await recordFileCheck(db, store.storage, {
      institutionId: t.id,
      fileId: id,
      outcome: 'ready',
      now: FIXED_NOW,
      log: app.log,
    })
    return id
  }
  async function publish(t: Tenant, extra: Json = {}) {
    return ok(
      await post(DOCS, t.admin, {
        title: 'Personel yönetmeliği',
        policyType: 'staff_regulation',
        audience: 'all_staff',
        publishedOn: '2026-09-01',
        fileId: await upload(t, t.admin),
        ...extra,
      }),
      201,
    )
  }
  const ack = (documentId: string, membershipId: string, extra: Json = {}) => ({
    policyDocumentId: documentId,
    membershipId,
    acknowledgedOn: '2026-09-15',
    channel: 'wet_signature',
    ...extra,
  })
  const list = async (url: string, cookie: string) => {
    const response = await get(url, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Json[]; meta: { total: number } }
  }
  const countAcks = async (institutionId: string) =>
    (
      await db
        .select()
        .from(policyAcknowledgements)
        .where(eq(policyAcknowledgements.institutionId, institutionId))
    ).length

  test('kimliksiz istek 401', async () => {
    assertError(await get(DOCS, null), 401)
    assertError(await get(STAFF, null), 401)
    assertError(await get(`${DOCS}/${randomUUID()}`, null), 401)
    assertError(await get(`${DOCS}/${randomUUID()}/staff`, null), 401)
    assertError(await post(DOCS, null, {}), 401)
    assertError(await post(ACKS, null, {}), 401)
  })

  test('DOM-FIN-127: öğretmen, veli 403; ön büro belge yayımlayamaz; modül kapalı 403 (K-437)', async () => {
    const t = await institution()
    for (const role of ['ogretmen', 'veli'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(DOCS, cookie), 403)
      assertError(await post(ACKS, cookie, {}), 403)
    }
    const desk = await member(t.id, 'onburo')
    assertError(await post(DOCS, desk, {}), 403)
    assert.equal((await list(DOCS, desk)).meta.total, 0)
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(DOCS, closed.admin), 403, 'module_disabled')
    assertError(await post(ACKS, closed.admin, {}), 403, 'module_disabled')
  })

  test('DOM-FIN-127: geçersiz gövde 400, Idempotency-Key zorunlu, kayıt yazılmaz', async () => {
    const t = await institution()
    assertError(await post(DOCS, t.admin, { title: 'x', policyType: 'nope' }), 400)
    const response = await call('POST', DOCS, t.admin, {
      title: 'Personel yönetmeliği',
      policyType: 'staff_regulation',
      audience: 'all_staff',
      publishedOn: '2026-09-01',
      fileId: randomUUID(),
    })
    assert.equal(response.statusCode, 400, response.body)
    assertError(
      await post(DOCS, t.admin, {
        title: 'Personel yönetmeliği',
        policyType: 'staff_regulation',
        audience: 'all_staff',
        publishedOn: '2026-10-07',
        fileId: await upload(t, t.admin),
      }),
      422,
      'policy_published_in_future',
    )
    const rows = await db
      .select()
      .from(policyDocuments)
      .where(eq(policyDocuments.institutionId, t.id))
    assert.equal(rows.length, 0)
  })

  test('DOM-FIN-127: belge yayımlanır, personel adına onay kaydı oranı ve eksik listesini günceller (K-437, K-438)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const desk = await person(t, 'onburo', 'Ön Büro Personeli')
    const parent = await person(t, 'veli', 'Ayşe Yılmaz')
    const doc = await publish(t)
    assert.equal(doc.version, 1)
    // Yönetici, öğretmen ve ön büro: 3 hedef.
    assert.equal(doc.targetCount, 3)
    assert.equal(doc.rate, 0)

    const scan = await upload(t, t.admin, 'imza.pdf')
    const created = ok(
      await post(ACKS, t.admin, ack(String(doc.id), selin, { scanFileId: scan })),
      201,
    )
    assert.equal(created.channel, 'wet_signature')
    assert.equal(created.scanFileId, scan)

    const listed = await list(DOCS, t.admin)
    assert.equal(listed.data[0]?.acknowledgedCount, 1)
    assert.equal(listed.data[0]?.rate, 33)

    const pending = await list(`${DOCS}/${String(doc.id)}/staff`, t.admin)
    assert.equal(pending.meta.total, 2)
    assert.ok(!pending.data.some((row) => row.membershipId === selin))
    const acked = await list(`${DOCS}/${String(doc.id)}/staff?status=acknowledged`, t.admin)
    assert.equal(acked.meta.total, 1)
    assert.equal((acked.data[0]?.acknowledgement as Json).channel, 'wet_signature')

    const staff = await list(`${STAFF}?missing=true`, t.admin)
    assert.equal(staff.meta.total, 2)
    assert.ok(staff.data.some((row) => row.membershipId === desk))
    assert.ok(!staff.data.some((row) => row.membershipId === selin))

    // Ön büro da personel adına kaydeder.
    const deskCookie = await member(t.id, 'onburo')
    ok(await post(ACKS, deskCookie, ack(String(doc.id), desk, { channel: 'email' })), 201)

    // Veli personel değildir; aynı sürüme ikinci onay 409.
    assertError(await post(ACKS, t.admin, ack(String(doc.id), parent)), 422, 'policy_not_staff')
    assertError(
      await post(ACKS, t.admin, ack(String(doc.id), selin)),
      409,
      'policy_already_acknowledged',
    )
    assert.equal(await countAcks(t.id), 2)

    const audit = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, t.id),
          eq(auditLog.action, 'finance.policy_acknowledgement.create'),
        ),
      )
    assert.equal(audit.length, 2)
  })

  test('DOM-FIN-127: onay günü, hedef kitle ve pasif personel kuralları (K-438)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const gone = await person(t, 'ogretmen', 'Ayrılan Öğretmen')
    await db
      .update(memberships)
      .set({ deactivatedAt: FIXED_NOW })
      .where(and(eq(memberships.institutionId, t.id), eq(memberships.id, gone)))
    const admin = await publish(t, { audience: 'administrative', title: 'İdari talimat' })
    assertError(
      await post(ACKS, t.admin, ack(String(admin.id), selin)),
      422,
      'policy_not_in_audience',
    )
    const doc = await publish(t, { audience: 'teachers', title: 'Öğretmen yönetmeliği' })
    assert.equal(doc.targetCount, 1)
    assertError(await post(ACKS, t.admin, ack(String(doc.id), gone)), 422, 'policy_staff_inactive')
    assertError(
      await post(ACKS, t.admin, ack(String(doc.id), selin, { acknowledgedOn: '2026-08-31' })),
      422,
      'policy_ack_before_publish',
    )
    assertError(
      await post(ACKS, t.admin, ack(String(doc.id), selin, { acknowledgedOn: '2026-10-07' })),
      422,
      'policy_ack_in_future',
    )
    assertError(
      await post(ACKS, t.admin, ack(String(doc.id), selin, { channel: 'self_service' })),
      400,
    )
    assertError(await post(ACKS, t.admin, ack(randomUUID(), selin)), 422, 'policy_not_found')
    assert.equal(await countAcks(t.id), 0)
  })

  test('DOM-FIN-127: yeni sürüm önceki sürümün onaylarını geçersiz kılar (K-436)', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const v1 = await publish(t, { audience: 'teachers' })
    ok(await post(ACKS, t.admin, ack(String(v1.id), selin)), 201)
    assert.equal((await list(`${STAFF}?missing=true`, t.admin)).meta.total, 0)

    const v2 = await publish(t, {
      audience: 'teachers',
      publishedOn: '2026-10-01',
      replacesDocumentId: v1.id,
    })
    assert.equal(v2.version, 2)
    assert.equal(v2.seriesId, v1.seriesId)
    assert.equal(v2.acknowledgedCount, 0)
    assert.equal(v2.rate, 0)
    const missing = await list(`${STAFF}?missing=true`, t.admin)
    assert.equal(missing.meta.total, 1)
    assert.equal((missing.data[0]?.missingDocuments as Json[])[0]?.id, v2.id)

    assertError(
      await post(ACKS, t.admin, ack(String(v1.id), selin, { acknowledgedOn: '2026-10-02' })),
      422,
      'policy_version_superseded',
    )
    assertError(
      await post(DOCS, t.admin, {
        title: 'Personel yönetmeliği',
        policyType: 'staff_regulation',
        audience: 'teachers',
        publishedOn: '2026-10-05',
        fileId: await upload(t, t.admin),
        replacesDocumentId: v1.id,
      }),
      422,
      'policy_previous_superseded',
    )
    const detail = ok(await get(`${DOCS}/${String(v2.id)}`, t.admin))
    assert.deepEqual(
      (detail.versions as Json[]).map((version) => [version.version, version.current]),
      [
        [2, true],
        [1, false],
      ],
    )
    assert.equal((await list(DOCS, t.admin)).meta.total, 1)
    assert.equal((await list(`${DOCS}?status=all`, t.admin)).meta.total, 2)
  })

  test('DOM-FIN-127: Idempotency-Key ile çift gönderim ikinci onay yazmaz', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const doc = await publish(t)
    const key = randomUUID()
    const first = await post(ACKS, t.admin, ack(String(doc.id), selin), key)
    assert.equal(first.statusCode, 201, first.body)
    const again = await post(ACKS, t.admin, ack(String(doc.id), selin), key)
    assert.equal(again.statusCode, 201, again.body)
    assert.equal(again.headers['idempotent-replayed'], 'true')
    assert.equal(await countAcks(t.id), 1)
  })

  test('DOM-FIN-127: onay satırı değişmez ve silinmez', async () => {
    const t = await institution()
    const selin = await person(t, 'ogretmen', 'Selin Kaya')
    const doc = await publish(t)
    ok(await post(ACKS, t.admin, ack(String(doc.id), selin)), 201)
    await assert.rejects(
      db.execute(sql`delete from policy_acknowledgements where institution_id = ${t.id}`),
    )
    assert.equal(await countAcks(t.id), 1)
  })

  test('DOM-FIN-127: başka kurumun belgesi ve personeli 404 ve B değişmez; listede yok; institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bDoc = await publish(b)
    const bUrl = `${DOCS}/${String(bDoc.id)}`
    const bStaff = await person(b, 'ogretmen', 'Selin Kaya')
    assertError(await get(bUrl, a.admin), 404)
    assertError(await get(`${bUrl}/staff`, a.admin), 404)
    assert.equal((await list(DOCS, a.admin)).meta.total, 0)
    assert.ok(!(await list(STAFF, a.admin)).data.some((row) => row.membershipId === bStaff))
    // Gövdedeki kurum kimliği okunmaz: şema fazladan alanı reddeder.
    assertError(
      await post(DOCS, a.admin, {
        title: 'Personel yönetmeliği',
        policyType: 'staff_regulation',
        audience: 'all_staff',
        publishedOn: '2026-09-01',
        fileId: await upload(a, a.admin),
        institutionId: b.id,
      }),
      400,
    )
    assertError(
      await post(ACKS, a.admin, { ...ack(String(bDoc.id), bStaff), institutionId: b.id }),
      400,
    )
    const aStaff = await person(a, 'ogretmen', 'Alfa Öğretmen')
    assertError(await post(ACKS, a.admin, ack(String(bDoc.id), aStaff)), 422, 'policy_not_found')
    const aDoc = await publish(a)
    assertError(
      await post(ACKS, a.admin, ack(String(aDoc.id), bStaff)),
      422,
      'policy_staff_not_found',
    )
    assert.equal(await countAcks(b.id), 0)
    const bRows = await db
      .select()
      .from(policyDocuments)
      .where(eq(policyDocuments.institutionId, b.id))
    assert.equal(bRows.length, 1)
    assert.equal(bRows[0]?.supersededAt, null)
  })
})
