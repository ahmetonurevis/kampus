import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { memberships } from '../src/db/schema/auth.ts'
import { staffPersonnelFiles } from '../src/db/schema/finance-personnel-files.ts'
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

/**
 * Personel özlük kartı uçları (DOM-FIN-140; ON-172; K-475…K-477). Her test kendi kurumunu kurar.
 * FIXED_NOW 2026-10-06.
 */

const FINANCE = '/api/v1/finance'
const FILES = `${FINANCE}/personnel-files`
const TCKN = '10000000146'
const IBAN = 'TR330006100519786457841326'
const IBAN_2 = 'TR320010009999901234567890'
const LONG_AGO = new Date('2014-05-01T09:00:00.000Z')

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

const fullCard = (membershipId: string): Json => ({
  membershipId,
  identity: { nationalId: TCKN, birthDate: '1990-05-12' },
  contact: {
    address: 'Moda Caddesi No 12 Kadıköy İstanbul',
    phone: '0532 123 45 67',
    email: 'kisisel@example.com',
  },
  education: [
    {
      level: 'bachelor',
      school: 'Boğaziçi Üniversitesi',
      department: 'Matematik',
      graduationYear: 2012,
    },
  ],
  bank: { iban: IBAN, accountHolder: 'Selin Kaya' },
  emergencyContacts: [{ name: 'Ahmet Kaya', relation: 'Eşi', phone: '05329876543' }],
})

describe('DOM-FIN-140: personel özlük kartı uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.172.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(
    method: 'GET' | 'POST' | 'PATCH',
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
  const key = () => ({ 'idempotency-key': randomUUID() })
  const ifMatch = (version: unknown) => ({ 'if-match': `"${String(version)}"` })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.172.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  /** Adlı üyelik (giriş yapmaz). */
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

  const openCard = (cookie: string, body: Json, headers: Record<string, string> = key()) =>
    call('POST', FILES, cookie, body, headers)
  const patchCard = (cookie: string, membershipId: string, body: unknown, version: unknown) =>
    call('PATCH', `${FILES}/${membershipId}`, cookie, body, ifMatch(version))
  const rowsOf = async (institutionId: string) =>
    db
      .select()
      .from(staffPersonnelFiles)
      .where(eq(staffPersonnelFiles.institutionId, institutionId))
      .orderBy(staffPersonnelFiles.membershipId)
  const auditOf = async (institutionId: string, action: string) =>
    db
      .select({
        changes: auditLog.changes,
        entityId: auditLog.entityId,
        actorRole: auditLog.actorRole,
      })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))

  test('DOM-FIN-140: oturumsuz 401, öğretmen ve veli 403, modül kapalı 403', async () => {
    const t = await institution()
    const staff = await person(t, 'ogretmen', 'Selin Kaya')
    assertError(await get(FILES, null), 401)
    assertError(await openCard('', fullCard(staff)), 401)
    for (const role of ['ogretmen', 'veli'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(FILES, cookie), 403)
      assertError(await get(`${FILES}/${staff}`, cookie), 403)
      assertError(await openCard(cookie, fullCard(staff)), 403)
    }
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(FILES, closed.admin), 403, 'module_disabled')
    assertError(await get(`${FILES}/m-1`, closed.admin), 403, 'module_disabled')
    assertError(await openCard(closed.admin, fullCard('m-1')), 403, 'module_disabled')
    assert.equal((await rowsOf(t.id)).length, 0)
  })

  test('DOM-FIN-140 K-476: kart açılır; T.C. kimlik no ve IBAN şifreli, yanıtta maskeli; denetimde değer yok', async () => {
    const t = await institution()
    const staff = await person(t, 'ogretmen', 'Selin Kaya')
    const headers = key()
    const response = await openCard(t.admin, fullCard(staff), headers)
    const card = ok(response, 201)
    assert.equal(response.headers.location, `${FILES}/${staff}`)
    assert.equal(card.name, 'Selin Kaya')
    assert.equal(card.version, 1)
    assert.deepEqual(card.identity, { nationalIdMasked: '*******0146', birthDate: '1990-05-12' })
    assert.deepEqual(card.bank, {
      ibanMasked: `TR${'*'.repeat(20)}1326`,
      accountHolder: 'Selin Kaya',
    })
    assert.equal((card.contact as Json).phone, '05321234567')
    assert.deepEqual(card.certificates, { count: 0, expiredCount: 0, latestDate: null })
    assert.equal(card.canRevealNationalId, true)
    assert.deepEqual(card.access, {
      identity: 'write',
      contact: 'write',
      education: 'write',
      bank: 'write',
      emergencyContacts: 'write',
    })
    assert.ok(!response.body.includes(TCKN) && !response.body.includes(IBAN))

    const [row] = await rowsOf(t.id)
    assert.ok(row)
    assert.equal(row.nationalIdKeyVersion, 1)
    assert.ok(row.nationalIdCiphertext !== null && !row.nationalIdCiphertext.includes(TCKN))
    assert.ok(row.ibanCiphertext !== null && !row.ibanCiphertext.includes(IBAN))
    assert.ok(!JSON.stringify(row).includes(TCKN) && !JSON.stringify(row).includes(IBAN))

    const [audit] = await auditOf(t.id, 'finance.personnel_file.create')
    assert.deepEqual(audit?.changes, {
      fields: ['identity', 'contact', 'education', 'bank', 'emergencyContacts'],
    })
    assert.ok(!JSON.stringify(audit).includes(TCKN))

    // Aynı anahtar ikinci kart açmaz; yeni anahtar 409.
    const replay = await openCard(t.admin, fullCard(staff), headers)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assertError(await openCard(t.admin, fullCard(staff)), 409, 'personnel_file_exists')
    assertError(await openCard(t.admin, fullCard(staff), {}), 400, 'idempotency_key_required')
    assert.equal((await rowsOf(t.id)).length, 1)

    const detail = ok(await get(`${FILES}/${staff}`, t.admin))
    assert.deepEqual(detail, card)
  })

  test('DOM-FIN-140: doğrulama 400 ve kural 422 kaydı değiştirmez', async () => {
    const t = await institution()
    const staff = await person(t, 'ogretmen', 'Selin Kaya')
    const parent = await person(t, 'veli', 'Ayşe Yılmaz')
    const left = await person(t, 'onburo', 'Ayrılan Personel')
    await db
      .update(memberships)
      .set({ deactivatedAt: LONG_AGO })
      .where(and(eq(memberships.institutionId, t.id), eq(memberships.id, left)))

    assertError(await openCard(t.admin, { membershipId: staff }), 400)
    assertError(
      await openCard(t.admin, { membershipId: staff, identity: { nationalId: '12345678901' } }),
      400,
    )
    assertError(
      await openCard(t.admin, {
        membershipId: staff,
        bank: { iban: 'TR330006100519786457841327', accountHolder: 'Selin Kaya' },
      }),
      400,
    )
    assertError(await openCard(t.admin, { ...fullCard(staff), institutionId: 'x' }), 400)
    assertError(await openCard(t.admin, fullCard(parent)), 422, 'personnel_file_not_staff')
    assertError(await openCard(t.admin, fullCard(left)), 422, 'personnel_file_staff_inactive')
    assertError(await openCard(t.admin, fullCard('yok')), 422, 'personnel_file_staff_not_found')
    assertError(
      await openCard(t.admin, { membershipId: staff, identity: { birthDate: '2015-01-01' } }),
      422,
      'personnel_file_birth_date_invalid',
    )
    assertError(
      await openCard(t.admin, { membershipId: staff, bank: { iban: IBAN } }),
      422,
      'personnel_file_bank_incomplete',
    )
    assert.equal((await rowsOf(t.id)).length, 0)
    assertError(await get(`${FILES}/${staff}`, t.admin), 404)
    assertError(await get(`${FILES}/${parent}`, t.admin), 404)
  })

  test('DOM-FIN-140 K-475: ön büro yalnız acil durum kişilerini okur, yazamaz ve tam kimliği açamaz', async () => {
    const t = await institution()
    const staff = await person(t, 'ogretmen', 'Selin Kaya')
    const other = await person(t, 'ogretmen', 'Zeynep Ak')
    const card = ok(await openCard(t.admin, fullCard(staff)), 201)
    const desk = await member(t.id, 'onburo')

    const response = await get(`${FILES}/${staff}`, desk)
    const view = ok(response)
    assert.deepEqual(
      Object.keys(view).sort(),
      [
        'access',
        'active',
        'canRevealNationalId',
        'emergencyContacts',
        'membershipId',
        'name',
        'role',
        'updatedAt',
        'version',
      ].sort(),
    )
    assert.deepEqual(view.access, { emergencyContacts: 'read' })
    assert.equal(view.canRevealNationalId, false)
    for (const hidden of ['nationalIdMasked', 'ibanMasked', 'Moda Caddesi', 'Boğaziçi', 'kisisel@'])
      assert.ok(!response.body.includes(hidden), hidden)

    const list = (await get(`${FILES}?q=Selin`, desk)).json() as { data: Json[] }
    assert.deepEqual(
      list.data.map((row) => row.filledGroups),
      [['emergencyContacts']],
    )
    const managerList = (await get(FILES, t.admin)).json() as { data: Json[]; meta: Json }
    assert.equal(managerList.meta.total, 4, 'yönetici, ön büro, iki öğretmen')
    assert.deepEqual(managerList.data.find((row) => row.membershipId === staff)?.filledGroups, [
      'identity',
      'contact',
      'education',
      'bank',
      'emergencyContacts',
    ])
    const without = (await get(`${FILES}?file=without`, t.admin)).json() as { data: Json[] }
    assert.ok(without.data.some((row) => row.membershipId === other))
    assert.ok(!without.data.some((row) => row.membershipId === staff))

    const before = await rowsOf(t.id)
    assertError(await patchCard(desk, staff, { emergencyContacts: [] }, card.version), 403)
    assertError(await openCard(desk, { membershipId: other, emergencyContacts: [] }), 403)
    assertError(await get(`${FILES}/${staff}/national-id`, desk), 403)
    assert.deepEqual(await rowsOf(t.id), before)
    assert.equal((await auditOf(t.id, 'finance.personnel_file.national_id_read')).length, 0)
  })

  test('DOM-FIN-140 K-476: tam T.C. kimlik no yalnız yöneticiye döner ve okuması denetime yazılır', async () => {
    const t = await institution()
    const staff = await person(t, 'ogretmen', 'Selin Kaya')
    ok(await openCard(t.admin, fullCard(staff)), 201)
    assert.deepEqual(ok(await get(`${FILES}/${staff}/national-id`, t.admin)), { nationalId: TCKN })
    const audits = await auditOf(t.id, 'finance.personnel_file.national_id_read')
    assert.equal(audits.length, 1)
    assert.equal(audits[0]?.entityId, staff)
    assert.deepEqual(audits[0]?.changes, { fields: ['identity.nationalId'] })
    assert.ok(!JSON.stringify(audits).includes(TCKN))
    assertError(await get(`${FILES}/yok/national-id`, t.admin), 404)
  })

  test('DOM-FIN-140: düzeltme kısmi, If-Match ister, değişen alanları denetler; sertifika özeti', async () => {
    const t = await institution()
    const staff = await person(t, 'ogretmen', 'Selin Kaya')
    const card = ok(await openCard(t.admin, fullCard(staff)), 201)

    assertError(
      await call('PATCH', `${FILES}/${staff}`, t.admin, { contact: { email: null } }),
      400,
      'if_match_required',
    )
    assertError(await patchCard(t.admin, staff, { contact: { email: null } }, 9), 409)
    assertError(
      await patchCard(t.admin, staff, { identity: { nationalId: TCKN } }, card.version),
      422,
      'personnel_file_unchanged',
    )
    assertError(await patchCard(t.admin, staff, { bank: { iban: 'TR11' } }, card.version), 400)

    const updated = ok(
      await patchCard(
        t.admin,
        staff,
        { identity: { birthDate: '1991-01-01' }, bank: { iban: IBAN_2 }, emergencyContacts: [] },
        card.version,
      ),
    )
    assert.equal(updated.version, 2)
    assert.deepEqual(updated.identity, { nationalIdMasked: '*******0146', birthDate: '1991-01-01' })
    assert.deepEqual(updated.bank, {
      ibanMasked: `TR${'*'.repeat(20)}7890`,
      accountHolder: 'Selin Kaya',
    })
    assert.deepEqual(updated.emergencyContacts, [])
    const [audit] = await auditOf(t.id, 'finance.personnel_file.update')
    assert.deepEqual(audit?.changes, {
      fields: ['identity.birthDate', 'bank.iban', 'emergencyContacts'],
    })

    const cleared = ok(await patchCard(t.admin, staff, { bank: null }, 2))
    assert.deepEqual(cleared.bank, { ibanMasked: null, accountHolder: null })
    const [row] = await rowsOf(t.id)
    assert.equal(row?.ibanCiphertext, null)
    assert.equal(row?.ibanKeyVersion, null)

    // Sertifika özeti özlük belgelerinden (DOM-FIN-113).
    for (const documentDate of ['2024-03-01', '2025-06-15'])
      ok(
        await call('POST', `${FINANCE}/staff-documents`, t.admin, {
          membershipId: staff,
          documentType: 'certificate',
          documentDate,
          ...(documentDate === '2024-03-01' ? { validUntil: '2025-03-01' } : {}),
        }),
        201,
      )
    const withCertificates = ok(await get(`${FILES}/${staff}`, t.admin))
    assert.deepEqual(withCertificates.certificates, {
      count: 2,
      expiredCount: 1,
      latestDate: '2025-06-15',
    })
  })

  test('DOM-FIN-140 K-477: özlük imhası kartı fiziksel siler', async () => {
    const t = await institution()
    const staff = await person(t, 'ogretmen', 'Selin Kaya')
    ok(await openCard(t.admin, fullCard(staff)), 201)
    await db
      .update(memberships)
      .set({ deactivatedAt: LONG_AGO })
      .where(and(eq(memberships.institutionId, t.id), eq(memberships.id, staff)))
    const destruction = ok(
      await call(
        'POST',
        `${FINANCE}/staff-data-destructions`,
        t.admin,
        { membershipId: staff, category: 'personnel_file' },
        key(),
      ),
      201,
    )
    assert.equal(destruction.recordCount, 1)
    assert.equal((await rowsOf(t.id)).length, 0)
    assertError(await get(`${FILES}/${staff}`, t.admin), 404)
  })

  test('DOM-FIN-140: başka kurumun personeli ve kartı 404 ve B değişmez; listede yok; gövdedeki institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bStaff = await person(b, 'ogretmen', 'Beta Öğretmen')
    const bCard = ok(await openCard(b.admin, fullCard(bStaff)), 201)
    const bBefore = await rowsOf(b.id)

    assertError(await get(`${FILES}/${bStaff}`, a.admin), 404)
    assertError(await get(`${FILES}/${bStaff}/national-id`, a.admin), 404)
    assertError(await patchCard(a.admin, bStaff, { emergencyContacts: [] }, bCard.version), 404)
    const listA = (await get(FILES, a.admin)).json() as { data: Json[] }
    assert.equal(
      listA.data.some((row) => row.membershipId === bStaff),
      false,
    )
    assertError(await openCard(a.admin, fullCard(bStaff)), 422, 'personnel_file_staff_not_found')
    assertError(await openCard(a.admin, { ...fullCard(bStaff), institutionId: b.id }), 400)
    assert.deepEqual(await rowsOf(b.id), bBefore)
    assert.equal((await rowsOf(a.id)).length, 0)
    assert.equal((await auditOf(a.id, 'finance.personnel_file.national_id_read')).length, 0)
  })
})
