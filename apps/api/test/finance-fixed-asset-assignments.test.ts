import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { memberships } from '../src/db/schema/auth.ts'
import { fixedAssetAssignments } from '../src/db/schema/finance-fixed-asset-assignments.ts'
import { fixedAssets } from '../src/db/schema/finance-fixed-assets.ts'
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
 * Demirbaş zimmeti uçları (DOM-FIN-086; ON-236). Her test kendi kurumunu kurar; kurumda seed
 * kampüsleri vardır. Personel adlı kullanıcıyla açılır (Selin Kaya öğretmen, Merve Ak ön büro).
 * FIXED_NOW 2026-10-06.
 */

const SEED = createSeed(FIXED_NOW)
const CAMPUS = SEED.branches[0]?.id ?? ''
const CAMPUS_NAME = SEED.branches[0]?.name ?? ''
const FINANCE = '/api/v1/finance'
const ASSETS = `${FINANCE}/fixed-assets`
const ASSIGNMENTS = `${FINANCE}/fixed-asset-assignments`
const ASSIGNEES = `${FINANCE}/fixed-asset-assignees`
const LAPTOP = {
  name: 'Dizüstü bilgisayar',
  category: 'it',
  location: 'Öğretmenler odası',
  acquisitionValueCents: 3_500_000,
  acquisitionDate: '2026-09-01',
}
const ROOM = {
  assigneeType: 'location',
  campusId: CAMPUS,
  location: '2. kat fen laboratuvarı',
  assignedDate: '2026-09-05',
}

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-086: demirbaş zimmeti uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.86.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
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
    clientIp = `10.86.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(
      db,
      created.id,
      SEED.branches.map((data) => ({ collection: 'branches' as const, id: data.id, data })),
      FIXED_NOW,
    )
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  /** Adlı personel üyeliği (giriş yapmaz). */
  async function staff(t: Tenant, role: Role, name: string) {
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
  const createAsset = async (t: Tenant, body: Json = LAPTOP) =>
    ok(await call('POST', ASSETS, t.admin, body), 201)
  const assignUrl = (asset: Json) => `${ASSETS}/${String(asset.id)}/assignments`
  const assign = (cookie: string, asset: Json, body: Json, headers: Record<string, string> = {}) =>
    call('POST', assignUrl(asset), cookie, body, headers)
  const giveBack = (cookie: string, assignment: Json, body: Json) =>
    call(
      'POST',
      `${ASSIGNMENTS}/${String(assignment.id)}/return`,
      cookie,
      body,
      ifMatch(assignment.version),
    )
  const toStaff = (membershipId: string, assignedDate = '2026-09-10') => ({
    assigneeType: 'staff',
    membershipId,
    assignedDate,
  })
  const rowsOf = (institutionId: string) =>
    db
      .select()
      .from(fixedAssetAssignments)
      .where(eq(fixedAssetAssignments.institutionId, institutionId))
  const listOf = async (cookie: string, query = '') => {
    const response = await get(`${ASSIGNMENTS}${query}`, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Json[]; meta: { total: number } }
  }
  const assigneesOf = async (cookie: string, query = '') => {
    const response = await get(`${ASSIGNEES}${query}`, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Json[]; meta: { total: number } }
  }

  test('kimliksiz istek 401', async () => {
    const url = `${ASSIGNMENTS}/${randomUUID()}`
    assertError(await get(ASSIGNMENTS, null), 401)
    assertError(await get(ASSIGNEES, null), 401)
    assertError(await get(url, null), 401)
    assertError(await call('POST', `${ASSETS}/${randomUUID()}/assignments`, null, ROOM), 401)
    assertError(
      await call('POST', `${url}/return`, null, { returnDate: '2026-10-06' }, ifMatch(1)),
      401,
    )
  })

  test('DOM-FIN-086: ön büro, öğretmen, veli ve öğrenci 403; zimmet değişmez (K-189, K-214)', async () => {
    const t = await institution()
    const asset = await createAsset(t)
    const given = ok(await assign(t.admin, asset, ROOM), 201)
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(ASSIGNMENTS, cookie), 403)
      assertError(await get(ASSIGNEES, cookie), 403)
      assertError(await get(`${ASSIGNMENTS}/${String(given.id)}`, cookie), 403)
      assertError(await assign(cookie, asset, ROOM), 403)
      assertError(
        await giveBack(cookie, given, { returnDate: '2026-10-06', condition: 'intact' }),
        403,
      )
    }
    const rows = await rowsOf(t.id)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.returnedAt, null)
    assert.equal(rows[0]?.version, 1)
  })

  test('DOM-FIN-086: finance modülü kapalıyken zimmet uçları 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(ASSIGNMENTS, closed.admin), 403, 'module_disabled')
    assertError(await get(ASSIGNEES, closed.admin), 403, 'module_disabled')
    assertError(
      await call('POST', `${ASSETS}/${randomUUID()}/assignments`, closed.admin, ROOM),
      403,
      'module_disabled',
    )
    assert.equal((await rowsOf(closed.id)).length, 0)
  })

  test('DOM-FIN-086: personele zimmet kalıcıdır; demirbaş listesinde zimmetli görünür; denetimde yalnız alan adları (K-210)', async () => {
    const t = await institution()
    const selin = await staff(t, 'ogretmen', 'Selin Kaya')
    const asset = await createAsset(t)
    const response = await assign(t.admin, asset, { ...toStaff(selin), note: 'Şarj aletiyle' })
    const given = ok(response, 201)
    assert.equal(response.headers.location, `${ASSIGNMENTS}/${String(given.id)}`)
    assert.equal(given.assigneeType, 'staff')
    assert.equal(given.membershipId, selin)
    assert.equal(given.staffName, 'Selin Kaya')
    assert.equal(given.staffRole, 'ogretmen')
    assert.equal(given.staffActive, true)
    assert.equal(given.assetTagNumber, 'DB-2026-0001')
    assert.equal(given.location, null)
    assert.equal(given.note, 'Şarj aletiyle')
    assert.equal(given.returnDate, null)
    assert.equal(given.version, 1)
    assert.deepEqual(ok(await get(`${ASSIGNMENTS}/${String(given.id)}`, t.admin)), given)

    const [listed] = (await get(ASSETS, t.admin)).json().data as Json[]
    assert.deepEqual(listed?.assignment, {
      id: given.id,
      assigneeType: 'staff',
      membershipId: selin,
      staffName: 'Selin Kaya',
      staffActive: true,
      campusId: null,
      campusName: null,
      location: null,
      assignedDate: '2026-09-10',
    })
    const detail = ok(await get(`${ASSETS}/${String(asset.id)}`, t.admin))
    assert.equal((detail.assignment as Json).id, given.id)

    const [row] = await rowsOf(t.id)
    assert.equal(row?.assignedDate, '2026-09-10')
    assert.equal(row?.assignedAt.toISOString(), FIXED_NOW.toISOString())
    const audits = await db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'fixed_asset.assign')))
    assert.equal(audits.length, 1)
    assert.equal(JSON.stringify(audits).includes('Şarj'), false)
    assert.equal(JSON.stringify(audits).includes('Selin'), false)
  })

  test('DOM-FIN-086: konuma zimmet kampüs adıyla döner; olmayan kampüs 422 (K-210)', async () => {
    const t = await institution()
    const asset = await createAsset(t)
    assertError(
      await assign(t.admin, asset, { ...ROOM, campusId: 'yok-kampus' }),
      422,
      'fixed_asset_campus_not_found',
    )
    assert.equal((await rowsOf(t.id)).length, 0)
    const given = ok(await assign(t.admin, asset, ROOM), 201)
    assert.equal(given.assigneeType, 'location')
    assert.equal(given.membershipId, null)
    assert.equal(given.campusName, CAMPUS_NAME)
    assert.equal(given.location, ROOM.location)
    assert.equal(given.staffActive, null)
  })

  test('DOM-FIN-086: tek açık zimmet 409; yanlış personel 422; gövde hatası 400; kayıt değişmez (K-210, K-211)', async () => {
    const t = await institution()
    const selin = await staff(t, 'ogretmen', 'Selin Kaya')
    const student = await staff(t, 'ogrenci', 'Deniz Yılmaz')
    const parent = await staff(t, 'veli', 'Ayşe Yılmaz')
    const passive = await staff(t, 'onburo', 'Ayrılan Personel')
    await db
      .update(memberships)
      .set({ deactivatedAt: FIXED_NOW })
      .where(eq(memberships.id, passive))
    const asset = await createAsset(t)
    const cases: [Json, number, string?][] = [
      [toStaff(student), 422, 'fixed_asset_assignee_not_staff'],
      [toStaff(parent), 422, 'fixed_asset_assignee_not_staff'],
      [toStaff(passive), 422, 'fixed_asset_assignee_inactive'],
      [toStaff('olmayan-uyelik'), 422, 'fixed_asset_assignee_not_found'],
      [toStaff(selin, '2026-10-07'), 422, 'fixed_asset_date_in_future'],
      [toStaff(selin, '2026-08-31'), 422, 'fixed_asset_assignment_before_acquisition'],
      [{ ...toStaff(selin), location: 'Oda' }, 400],
      [{ ...ROOM, location: 'A' }, 400],
      [{ ...toStaff(selin), assigneeType: 'student' }, 400],
      [{ ...toStaff(selin), note: 'x'.repeat(501) }, 400],
    ]
    for (const [body, status, code] of cases)
      assertError(await assign(t.admin, asset, body), status, code)
    assert.equal((await rowsOf(t.id)).length, 0)
    assertError(await assign(t.admin, { id: randomUUID() }, ROOM), 404)

    ok(await assign(t.admin, asset, toStaff(selin)), 201)
    assertError(await assign(t.admin, asset, ROOM), 409, 'fixed_asset_already_assigned')
    assert.equal((await rowsOf(t.id)).length, 1)
  })

  test('DOM-FIN-086: iade gün, durum ve notla yazılır; geçmiş kalır; devir iadeden sonra (K-211, K-212)', async () => {
    const t = await institution()
    const selin = await staff(t, 'ogretmen', 'Selin Kaya')
    const merve = await staff(t, 'onburo', 'Merve Ak')
    const asset = await createAsset(t)
    const given = ok(await assign(t.admin, asset, toStaff(selin)), 201)

    assertError(
      await giveBack(t.admin, given, { returnDate: '2026-10-06', condition: 'damaged' }),
      400,
    )
    assertError(
      await giveBack(t.admin, given, { returnDate: '2026-10-07', condition: 'intact' }),
      422,
      'fixed_asset_date_in_future',
    )
    assertError(
      await giveBack(t.admin, given, { returnDate: '2026-09-09', condition: 'intact' }),
      422,
      'fixed_asset_return_before_assignment',
    )
    assertError(
      await call(
        'POST',
        `${ASSIGNMENTS}/${String(given.id)}/return`,
        t.admin,
        { returnDate: '2026-09-20', condition: 'intact' },
        ifMatch(9),
      ),
      409,
      'version_conflict',
    )
    const [unchanged] = await rowsOf(t.id)
    assert.equal(unchanged?.returnedAt, null)
    assert.equal(unchanged?.version, 1)

    const returned = ok(
      await giveBack(t.admin, given, {
        returnDate: '2026-09-20',
        condition: 'damaged',
        note: 'Klavyede eksik tuş',
      }),
    )
    assert.equal(returned.returnDate, '2026-09-20')
    assert.equal(returned.returnCondition, 'damaged')
    assert.equal(returned.returnNote, 'Klavyede eksik tuş')
    assert.equal(returned.returnedAt, FIXED_NOW.toISOString())
    assert.equal(returned.version, 2)
    assertError(
      await giveBack(t.admin, returned, { returnDate: '2026-09-21', condition: 'intact' }),
      422,
      'fixed_asset_assignment_returned',
    )
    // İade demirbaşın durumunu kendiliğinden değiştirmez (K-212).
    const [assetRow] = await db
      .select()
      .from(fixedAssets)
      .where(eq(fixedAssets.institutionId, t.id))
    assert.equal(assetRow?.status, 'in_use')
    assert.equal(ok(await get(`${ASSETS}/${String(asset.id)}`, t.admin)).assignment, null)

    assertError(
      await assign(t.admin, asset, toStaff(merve, '2026-09-19')),
      422,
      'fixed_asset_assignment_before_return',
    )
    const second = ok(await assign(t.admin, asset, toStaff(merve, '2026-09-20')), 201)
    const history = await listOf(t.admin, `?assetId=${String(asset.id)}`)
    assert.deepEqual(
      history.data.map((item) => item.id),
      [second.id, given.id],
    )
    assert.equal(history.meta.total, 2)
    const audits = await db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'fixed_asset.return')))
    assert.equal(audits.length, 1)
    assert.equal(JSON.stringify(audits).includes('Klavye'), false)
  })

  test('DOM-FIN-086: zimmetli demirbaş hurdaya ayrılmaz; hurda gün son iadeden önce olamaz; hurdaya zimmet verilmez (K-213)', async () => {
    const t = await institution()
    const asset = await createAsset(t)
    const given = ok(await assign(t.admin, asset, ROOM), 201)
    const scrap = (body: Json, version: unknown) =>
      call('POST', `${ASSETS}/${String(asset.id)}/scrap`, t.admin, body, ifMatch(version))
    assertError(
      await scrap({ reason: 'Ekran kırık', scrapDate: '2026-10-06' }, asset.version),
      422,
      'fixed_asset_assigned',
    )
    ok(await giveBack(t.admin, given, { returnDate: '2026-09-30', condition: 'intact' }))
    assertError(
      await scrap({ reason: 'Ekran kırık', scrapDate: '2026-09-29' }, asset.version),
      422,
      'fixed_asset_scrap_before_return',
    )
    const scrapped = ok(
      await scrap({ reason: 'Ekran kırık', scrapDate: '2026-09-30' }, asset.version),
    )
    assert.equal(scrapped.status, 'scrapped')
    assertError(await assign(t.admin, asset, ROOM), 422, 'fixed_asset_scrapped')
    assert.equal((await rowsOf(t.id)).length, 1)
  })

  test('DOM-FIN-086: liste personel, durum ve aramayla süzülür; sıra deterministik (K-214)', async () => {
    const t = await institution()
    const selin = await staff(t, 'ogretmen', 'Selin Kaya')
    const laptop = await createAsset(t)
    const board = await createAsset(t, { ...LAPTOP, name: 'Akıllı tahta', category: 'audiovisual' })
    const desk = await createAsset(t, { ...LAPTOP, name: 'Masa', category: 'furniture' })
    const a = ok(await assign(t.admin, laptop, toStaff(selin, '2026-09-10')), 201)
    const b = ok(await assign(t.admin, board, toStaff(selin, '2026-09-12')), 201)
    const c = ok(await assign(t.admin, desk, ROOM), 201)
    ok(await giveBack(t.admin, a, { returnDate: '2026-09-15', condition: 'intact' }))

    const mine = await listOf(t.admin, `?membershipId=${selin}`)
    assert.deepEqual(
      mine.data.map((item) => item.id),
      [b.id, a.id],
    )
    const open = await listOf(t.admin, `?membershipId=${selin}&state=open`)
    assert.deepEqual(
      open.data.map((item) => item.assetName),
      ['Akıllı tahta'],
    )
    assert.deepEqual(
      (await listOf(t.admin, '?state=returned')).data.map((item) => item.id),
      [a.id],
    )
    assert.deepEqual(
      (await listOf(t.admin, '?q=fen')).data.map((item) => item.id),
      [c.id],
    )
    assert.deepEqual(
      (await listOf(t.admin, '?q=selin')).data.map((item) => item.id),
      [b.id, a.id],
    )
    const all = await listOf(t.admin, '?pageSize=2')
    assert.equal(all.meta.total, 3)
    assert.deepEqual(
      all.data.map((item) => item.id),
      [b.id, c.id],
    )
    assertError(await get(`${ASSIGNMENTS}?state=lost`, t.admin), 400)
    assertError(await get(`${ASSIGNMENTS}?sort=name`, t.admin), 400)
  })

  test('DOM-FIN-086: personel listesi rol ve açık zimmet sayısıyla; ayrılan personelin zimmetleri süzülür (K-214)', async () => {
    const t = await institution()
    const selin = await staff(t, 'ogretmen', 'Selin Kaya')
    const ahmet = await staff(t, 'onburo', 'Ahmet Çınar')
    await staff(t, 'ogrenci', 'Deniz Yılmaz')
    await staff(t, 'veli', 'Ayşe Yılmaz')
    const laptop = await createAsset(t)
    const board = await createAsset(t, { ...LAPTOP, name: 'Akıllı tahta' })
    ok(await assign(t.admin, laptop, toStaff(selin)), 201)
    ok(await assign(t.admin, board, toStaff(ahmet)), 201)
    await db.update(memberships).set({ deactivatedAt: FIXED_NOW }).where(eq(memberships.id, ahmet))

    const everyone = await assigneesOf(t.admin)
    assert.deepEqual(
      everyone.data.map((item) => [item.name, item.role, item.active, item.openAssignmentCount]),
      [
        ['Ahmet Çınar', 'onburo', false, 1],
        ['Selin Kaya', 'ogretmen', true, 1],
        ['Test Yönetici', 'yonetici', true, 0],
      ],
    )
    const leaving = await assigneesOf(t.admin, '?status=passive&holding=true')
    assert.deepEqual(
      leaving.data.map((item) => item.membershipId),
      [ahmet],
    )
    assert.deepEqual(
      (await assigneesOf(t.admin, '?status=active&holding=true')).data.map((item) => item.name),
      ['Selin Kaya'],
    )
    assert.deepEqual(
      (await assigneesOf(t.admin, '?q=cinar')).data.map((item) => item.name),
      ['Ahmet Çınar'],
    )
    assertError(await get(`${ASSIGNEES}?holding=evet`, t.admin), 400)
    // Pasif personelin açık zimmeti listede pasif olarak görünür; yeni zimmet alamaz.
    const [held] = (await listOf(t.admin, `?membershipId=${ahmet}&state=open`)).data
    assert.equal(held?.staffActive, false)
  })

  test('DOM-FIN-086: başka kurumun demirbaşı ve zimmeti 404 ve B değişmez; listede yok; gövdedeki B üyeliği ve institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bStaff = await staff(b, 'ogretmen', 'Beta Öğretmen')
    const bAsset = await createAsset(b)
    const bAssignment = ok(await assign(b.admin, bAsset, toStaff(bStaff)), 201)
    const bUrl = `${ASSIGNMENTS}/${String(bAssignment.id)}`
    const aAsset = await createAsset(a)

    assertError(await assign(a.admin, bAsset, ROOM), 404)
    assertError(await get(bUrl, a.admin), 404)
    assertError(
      await call(
        'POST',
        `${bUrl}/return`,
        a.admin,
        { returnDate: '2026-10-06', condition: 'intact' },
        ifMatch(bAssignment.version),
      ),
      404,
    )
    assert.equal((await listOf(a.admin)).meta.total, 0)
    assert.equal((await listOf(a.admin, `?membershipId=${bStaff}`)).meta.total, 0)
    assert.equal(
      (await assigneesOf(a.admin)).data.some((item) => item.membershipId === bStaff),
      false,
    )
    assertError(
      await assign(a.admin, aAsset, toStaff(bStaff)),
      422,
      'fixed_asset_assignee_not_found',
    )
    assertError(await assign(a.admin, aAsset, { ...ROOM, institutionId: b.id }), 400)
    assert.equal((await rowsOf(a.id)).length, 0)
    const [bRow] = await rowsOf(b.id)
    assert.equal(bRow?.returnedAt, null)
    assert.equal(bRow?.version, 1)
  })

  test('DOM-FIN-086: Idempotency-Key ile yinelenen zimmet aynı yanıtı döner, tek satır yazılır', async () => {
    const t = await institution()
    const asset = await createAsset(t)
    const headers = { 'idempotency-key': randomUUID() }
    const first = await assign(t.admin, asset, ROOM, headers)
    const second = await assign(t.admin, asset, ROOM, headers)
    assert.equal(first.statusCode, 201)
    assert.equal(second.statusCode, 201)
    assert.equal(second.headers['idempotent-replayed'], 'true')
    assert.equal(second.json().data.id, first.json().data.id)
    assert.equal((await rowsOf(t.id)).length, 1)
  })
})
