import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'
import { courseNameKey } from '@kampus/school-core/lib/courses.ts'
import { groupNameKey } from '@kampus/school-core/lib/language-groups.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { courses } from '../src/db/schema/courses.ts'
import { stockMovements } from '../src/db/schema/finance-inventory.ts'
import {
  materialDeliveries,
  materialDeliveryItems,
  materialSetItems,
  materialSets,
} from '../src/db/schema/finance-material-sets.ts'
import { invoices } from '../src/db/schema/invoices.ts'
import { languageGroupMembers, languageGroups } from '../src/db/schema/language-groups.ts'
import { studentGuardians } from '../src/db/schema/student-guardians.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
  type InstitutionOverrides,
} from './support/app.ts'

/**
 * Materyal seti uçları (DOM-FIN-080; ON-232). Her test kendi kurumunu kurar: seed kampüsü b1,
 * sınıflar c1 (7-A) ve c2 (5-A), öğrenciler s1 Deniz Yılmaz (7-A, kitap ücret kalemi var), s2 Ece
 * Yılmaz (5-A) ve s25 (7-A); s1'in velisi Ayşe Yılmaz (p1) ve iletişim kısıtlı bir veli (p25). Ana
 * depoya kitap (5 adet) ve defter (30 adet) girilir; 7. sınıf seti 1 kitap ve 3 defterdir. FIXED_NOW
 * 2026-10-06.
 */

const SEED = createSeed(FIXED_NOW)
const FINANCE = '/api/v1/finance'
const SETS = `${FINANCE}/material-sets`
const DELIVERIES = `${FINANCE}/material-deliveries`
const RECIPIENTS = `${FINANCE}/material-recipients`
const ITEMS = `${FINANCE}/stock-items`
const MOVEMENTS = `${FINANCE}/stock-movements`

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

const pick = <T extends { id: string }>(rows: readonly T[], ids: readonly string[]) =>
  rows.filter((row) => ids.includes(row.id))

describe('DOM-FIN-080: materyal seti uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.80.0.1'

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
  const ifMatch = (version: unknown) => ({ 'if-match': `"${String(version)}"` })
  const key = () => ({ 'idempotency-key': randomUUID() })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.80.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    const admin = await signInAs(app, created.admin)
    if (overrides.enabledModules?.finance === false) return { id: created.id, admin } as Tenant
    await insertMissingRecords(
      db,
      created.id,
      [
        ...pick(SEED.branches, ['b1']).map((data) => ({
          collection: 'branches' as const,
          id: data.id,
          data,
        })),
        ...pick(SEED.classes, ['c1', 'c2']).map((data) => ({
          collection: 'classes' as const,
          id: data.id,
          data,
        })),
        ...pick(SEED.parents, ['p1', 'p25']).map((data) => ({
          collection: 'parents' as const,
          id: data.id,
          data,
        })),
        ...pick(SEED.students, ['s1', 's2', 's25']).map((data) => ({
          collection: 'students' as const,
          id: data.id,
          data,
        })),
      ],
      FIXED_NOW,
    )
    const guardian = randomUUID()
    const restricted = randomUUID()
    await db.insert(studentGuardians).values([
      {
        institutionId: created.id,
        id: guardian,
        studentId: 's1',
        parentId: 'p1',
        relationship: 'mother',
        custody: 'full',
        isPayer: true,
      },
      {
        institutionId: created.id,
        id: restricted,
        studentId: 's1',
        parentId: 'p25',
        relationship: 'father',
        custody: 'none',
        isContactRestricted: true,
      },
    ])
    await db.insert(invoices).values({
      institutionId: created.id,
      id: `inv-book-${created.id}`,
      studentId: 's1',
      academicYear: 2026,
      installment: 1,
      feeKind: 'stationery',
      amountCents: 150_000,
      dueDate: '2026-10-10',
      position: 1,
    })
    const warehouse = ok(
      await call('POST', `${FINANCE}/stock-warehouses`, admin, {
        name: 'Ana depo',
        campusId: 'b1',
      }),
      201,
    )
    const card = async (code: string, name: string, quantity: number) => {
      const item = ok(
        await call('POST', ITEMS, admin, { code, name, category: 'educational', unit: 'piece' }),
        201,
      )
      ok(
        await call(
          'POST',
          `${FINANCE}/stock-entries`,
          admin,
          {
            itemId: item.id,
            warehouseId: warehouse.id,
            quantity,
            movementDate: '2026-10-01',
            reason: 'opening',
          },
          key(),
        ),
        201,
      )
      return item
    }
    const book = await card('KIT-7', '7. sınıf kitabı', 5)
    const notebook = await card('DFT', 'Defter', 30)
    const set = ok(
      await call('POST', SETS, admin, {
        name: '7. Sınıf Seti',
        academicYear: 2026,
        gradeLevel: overrides.type === 'language_school' ? null : 7,
        items: [
          { stockItemId: book.id, quantity: 1 },
          { stockItemId: notebook.id, quantity: 3 },
        ],
      }),
      201,
    )
    return { id: created.id, admin, warehouse, book, notebook, set, guardian, restricted }
  }
  type Tenant = {
    id: string
    admin: string
    warehouse: Json
    book: Json
    notebook: Json
    set: Json
    guardian: string
    restricted: string
  }

  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))
  const deliver = (
    cookie: string,
    t: Tenant,
    extra: Json = {},
    headers: Record<string, string> = key(),
    setId: unknown = t.set.id,
  ) =>
    call(
      'POST',
      `${SETS}/${String(setId)}/deliveries`,
      cookie,
      {
        studentId: 's1',
        warehouseId: t.warehouse.id,
        deliveryDate: '2026-10-06',
        recipientKind: 'student',
        signatureReceived: true,
        ...extra,
      },
      headers,
    )
  const cancel = (cookie: string, delivery: Json, reason = 'Yanlış öğrenciye yazıldı') =>
    call(
      'POST',
      `${DELIVERIES}/${String(delivery.id)}/cancel`,
      cookie,
      { reason },
      ifMatch(delivery.version),
    )
  const sign = (cookie: string, delivery: Json) =>
    call(
      'POST',
      `${DELIVERIES}/${String(delivery.id)}/signature`,
      cookie,
      undefined,
      ifMatch(delivery.version),
    )
  const students = async (t: Tenant, query = '', cookie = t.admin) => {
    const response = await get(`${SETS}/${String(t.set.id)}/students${query}`, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Json[]; meta: { total: number } }
  }
  const quantityOf = async (t: Tenant, item: Json) =>
    ok(await get(`${ITEMS}/${String(item.id)}`, t.admin)).quantity
  const rows = (institutionId: string) =>
    Promise.all([
      db.select().from(materialSets).where(eq(materialSets.institutionId, institutionId)),
      db.select().from(materialSetItems).where(eq(materialSetItems.institutionId, institutionId)),
      db
        .select()
        .from(materialDeliveries)
        .where(eq(materialDeliveries.institutionId, institutionId)),
      db
        .select()
        .from(materialDeliveryItems)
        .where(eq(materialDeliveryItems.institutionId, institutionId)),
      db.select().from(stockMovements).where(eq(stockMovements.institutionId, institutionId)),
    ])

  test('DOM-FIN-080: set tanımlanır, listede öğrenci ve teslim sayısıyla görünür; ad yıl içinde tekildir', async () => {
    const t = await institution()
    assert.equal(t.set.gradeLevel, 7)
    assert.equal(t.set.studentCount, 2)
    assert.equal(t.set.deliveredCount, 0)
    assert.deepEqual(
      (t.set.items as Json[]).map((item) => [item.code, item.quantity, item.unit]),
      [
        ['KIT-7', 1, 'piece'],
        ['DFT', 3, 'piece'],
      ],
    )
    const list = await get(`${SETS}?academicYear=2026`, t.admin)
    assert.equal(list.json().meta.total, 1)
    assert.equal(list.json().data[0].itemCount, 2)
    assertError(
      await call('POST', SETS, t.admin, {
        name: '7. sinif seti',
        academicYear: 2026,
        items: [{ stockItemId: t.book.id, quantity: 1 }],
      }),
      409,
      'material_set_name_exists',
    )
    // Okulda kur hedefi seçilmez; olmayan kart reddedilir.
    assertError(
      await call('POST', SETS, t.admin, {
        name: 'Kur seti',
        academicYear: 2026,
        courseId: randomUUID(),
        items: [{ stockItemId: t.book.id, quantity: 1 }],
      }),
      422,
      'material_set_target_unavailable',
    )
    assertError(
      await call('POST', SETS, t.admin, {
        name: 'Boş kart',
        academicYear: 2026,
        items: [{ stockItemId: randomUUID(), quantity: 1 }],
      }),
      422,
      'stock_item_not_found',
    )
    assertError(
      await call('POST', SETS, t.admin, { name: 'Kalemsiz', academicYear: 2026, items: [] }),
      400,
      'validation_failed',
    )
    const renamed = ok(
      await call(
        'PATCH',
        `${SETS}/${String(t.set.id)}`,
        t.admin,
        { name: '7. Sınıf Kitap Seti' },
        ifMatch(t.set.version),
      ),
    )
    assert.equal(renamed.name, '7. Sınıf Kitap Seti')
    assertError(
      await call(
        'PATCH',
        `${SETS}/${String(t.set.id)}`,
        t.admin,
        { name: 'Eski sürüm' },
        ifMatch(t.set.version),
      ),
      409,
      'version_conflict',
    )
    const audit = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.entityId, String(t.set.id))))
    assert.deepEqual(audit.map((row) => row.action).sort(), [
      'material_set.create',
      'material_set.update',
    ])
  })

  test('DOM-FIN-080, K-207: öğrenci listesi hedefteki etkin öğrencileri ücret kalemi işaretiyle verir', async () => {
    const t = await institution()
    const all = await students(t)
    assert.equal(all.meta.total, 2)
    assert.deepEqual(
      all.data.map((row) => [row.studentId, row.className, row.hasMaterialFee, row.delivery]),
      [
        ['s1', '7-A', true, null],
        ['s25', '7-A', false, null],
      ],
    )
    assert.deepEqual(Object.keys(all.data[0] ?? {}).sort(), [
      'actions',
      'className',
      'delivery',
      'hasMaterialFee',
      'studentId',
      'studentName',
      'studentNumber',
    ])
    assert.deepEqual(
      (await students(t, '?fee=charged')).data.map((row) => row.studentId),
      ['s1'],
    )
    assert.deepEqual(
      (await students(t, '?fee=none')).data.map((row) => row.studentId),
      ['s25'],
    )
    assert.deepEqual(
      (await students(t, '?q=deniz')).data.map((row) => row.studentId),
      ['s1'],
    )
    assert.deepEqual(
      (await students(t, '?page=2&pageSize=1')).data.map((row) => row.studentId),
      ['s25'],
    )
    assertError(await get(`${SETS}/${String(t.set.id)}/students?sort=name`, t.admin), 400)
  })

  test('DOM-FIN-080: teslim kalemler kadar stok çıkışı yazar; çıkış hareket listesinden iptal edilmez', async () => {
    const t = await institution()
    const delivery = ok(await deliver(t.admin, t), 201)
    assert.equal(delivery.studentName, 'Deniz Yılmaz')
    assert.equal(delivery.recipientKind, 'student')
    assert.equal(delivery.recipientName, null)
    assert.equal(delivery.signatureReceived, true)
    assert.deepEqual(
      (delivery.items as Json[]).map((item) => [item.code, item.quantity]),
      [
        ['KIT-7', 1],
        ['DFT', 3],
      ],
    )
    assert.equal(await quantityOf(t, t.book), 4)
    assert.equal(await quantityOf(t, t.notebook), 27)
    const movements = (await get(`${MOVEMENTS}?type=delivery`, t.admin)).json().data as Json[]
    assert.equal(movements.length, 2)
    assert.ok(movements.every((row) => (row.actions as Json).cancel === false))
    const movement = movements[0] ?? {}
    assertError(
      await call(
        'POST',
        `${MOVEMENTS}/${String(movement.id)}/cancel`,
        t.admin,
        { reason: 'Hatalı kayıt' },
        ifMatch(movement.version),
      ),
      422,
      'stock_movement_from_delivery',
    )
    const listed = await students(t, '?status=delivered')
    assert.deepEqual(
      listed.data.map((row) => [row.studentId, (row.delivery as Json).warehouseName]),
      [['s1', 'Ana depo']],
    )
    assert.deepEqual(
      (await students(t, '?status=pending')).data.map((row) => row.studentId),
      ['s25'],
    )
    const set = ok(await get(`${SETS}/${String(t.set.id)}`, t.admin))
    assert.equal(set.deliveredCount, 1)
    assert.equal(set.hasDeliveries, true)
  })

  test('DOM-FIN-080: aynı öğrenciye ikinci teslim 409; aynı Idempotency-Key ilk yanıtı tekrarlar', async () => {
    const t = await institution()
    const headers = key()
    const first = ok(await deliver(t.admin, t, {}, headers), 201)
    const replay = await deliver(t.admin, t, {}, headers)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal(replay.json().data.id, first.id)
    const before = await rows(t.id)
    assertError(await deliver(t.admin, t), 409, 'material_delivery_exists')
    assert.deepEqual(await rows(t.id), before)
  })

  test('DOM-FIN-080, K-181: stok yetmezse teslim 422 ve hiçbir kayıt yazılmaz', async () => {
    const t = await institution()
    ok(
      await call(
        'PATCH',
        `${SETS}/${String(t.set.id)}`,
        t.admin,
        { items: [{ stockItemId: t.book.id, quantity: 6 }] },
        ifMatch(t.set.version),
      ),
    )
    const before = await rows(t.id)
    const response = await deliver(t.admin, t)
    assertError(response, 422, 'stock_insufficient')
    assert.match(response.json().message, /en çok 5 adet/)
    assertError(
      await deliver(t.admin, t, { deliveryDate: '2026-10-07' }),
      422,
      'material_delivery_date_future',
    )
    assertError(
      await deliver(t.admin, t, { warehouseId: randomUUID() }),
      422,
      'stock_warehouse_not_found',
    )
    assertError(await deliver(t.admin, t, { recipientKind: 'other' }), 400, 'validation_failed')
    assert.deepEqual(await rows(t.id), before)
  })

  test('DOM-FIN-080, K-206: kayıtlı veli ya da adı yazılan kişi teslim alır; kısıtlı veli ve hedef dışı öğrenci reddedilir', async () => {
    const t = await institution()
    const recipients = ok(await get(`${RECIPIENTS}?studentId=s1`, t.admin)) as unknown as Json[]
    assert.deepEqual(recipients, [{ id: t.guardian, name: 'Ayşe Yılmaz', relationship: 'mother' }])
    assertError(
      await deliver(t.admin, t, { recipientKind: 'guardian', guardianId: t.restricted }),
      422,
      'material_delivery_guardian_restricted',
    )
    assertError(
      await deliver(t.admin, t, { recipientKind: 'guardian', guardianId: randomUUID() }),
      422,
      'material_delivery_guardian_not_found',
    )
    assertError(
      await deliver(t.admin, t, { studentId: 's2' }),
      422,
      'material_delivery_student_not_eligible',
    )
    assertError(
      await deliver(t.admin, t, { studentId: 's999' }),
      422,
      'material_delivery_student_not_found',
    )
    const byGuardian = ok(
      await deliver(t.admin, t, {
        recipientKind: 'guardian',
        guardianId: t.guardian,
        signatureReceived: false,
      }),
      201,
    )
    assert.equal(byGuardian.recipientName, 'Ayşe Yılmaz')
    assert.equal(byGuardian.signatureReceived, false)
    const other = ok(
      await deliver(t.admin, t, {
        studentId: 's25',
        recipientKind: 'other',
        recipientName: 'Mehmet Akın',
        guardianId: t.guardian,
      }),
      201,
    )
    assert.equal(other.recipientName, 'Mehmet Akın')
    const [stored] = await db
      .select({ guardianId: materialDeliveries.guardianId })
      .from(materialDeliveries)
      .where(eq(materialDeliveries.id, String(other.id)))
    assert.equal(stored?.guardianId, null)
    assert.deepEqual(
      (await students(t, '?signature=missing')).data.map((row) => row.studentId),
      ['s1'],
    )
  })

  test('DOM-FIN-080, K-206: imza sonradan işlenir; ikinci kez ve iptal edilmiş teslime işlenmez', async () => {
    const t = await institution()
    const delivery = ok(await deliver(t.admin, t, { signatureReceived: false }), 201)
    assert.equal((delivery.actions as Json).sign, true)
    const signed = ok(await sign(t.admin, delivery))
    assert.equal(signed.signatureReceived, true)
    assert.ok(typeof signed.signatureRecordedAt === 'string')
    assertError(await sign(t.admin, signed), 422, 'material_delivery_signature_exists')
    assertError(await sign(t.admin, delivery), 409, 'version_conflict')
  })

  test('DOM-FIN-080, K-209: iptal teslimi ve stok çıkışlarını geri alır; set yeniden teslim edilir', async () => {
    const t = await institution()
    const delivery = ok(await deliver(t.admin, t), 201)
    assertError(await cancel(t.admin, delivery, 'kısa'), 400, 'validation_failed')
    const cancelled = ok(await cancel(t.admin, delivery))
    assert.ok(typeof cancelled.cancelledAt === 'string')
    assert.equal(cancelled.cancelReason, 'Yanlış öğrenciye yazıldı')
    assert.deepEqual(cancelled.actions, { cancel: false, sign: false })
    assert.equal(await quantityOf(t, t.book), 5)
    assert.equal(await quantityOf(t, t.notebook), 30)
    const movements = await db
      .select({ cancelReason: stockMovements.cancelReason })
      .from(stockMovements)
      .where(and(eq(stockMovements.institutionId, t.id), eq(stockMovements.type, 'delivery')))
    assert.deepEqual(
      movements.map((row) => row.cancelReason),
      ['Yanlış öğrenciye yazıldı', 'Yanlış öğrenciye yazıldı'],
    )
    assertError(await cancel(t.admin, cancelled), 422, 'material_delivery_already_cancelled')
    assertError(await sign(t.admin, cancelled), 422, 'material_delivery_cancelled')
    assert.equal((await students(t)).data[0]?.delivery, null)
    ok(await deliver(t.admin, t), 201)
    assert.equal(await quantityOf(t, t.book), 4)
  })

  test('DOM-FIN-080, K-208: teslimi başlamış setin hedefi değişmez; kalem değişikliği önceki teslimi bozmaz', async () => {
    const t = await institution()
    const delivery = ok(await deliver(t.admin, t), 201)
    const url = `${SETS}/${String(t.set.id)}`
    assertError(
      await call('PATCH', url, t.admin, { gradeLevel: 8 }, ifMatch(t.set.version)),
      422,
      'material_set_has_deliveries',
    )
    const changed = ok(
      await call(
        'PATCH',
        url,
        t.admin,
        { items: [{ stockItemId: t.notebook.id, quantity: 2 }] },
        ifMatch(t.set.version),
      ),
    )
    assert.deepEqual(
      (changed.items as Json[]).map((item) => [item.code, item.quantity]),
      [['DFT', 2]],
    )
    const items = await db
      .select({ quantity: materialDeliveryItems.quantity })
      .from(materialDeliveryItems)
      .where(eq(materialDeliveryItems.deliveryId, String(delivery.id)))
    assert.equal(items.length, 2)
    const paused = ok(
      await call('PATCH', url, t.admin, { isActive: false }, ifMatch(changed.version)),
    )
    assert.equal(paused.isActive, false)
    assertError(await deliver(t.admin, t, { studentId: 's25' }), 422, 'material_set_inactive')
  })

  test('DOM-FIN-080, K-209: CSV süzgeçle eşleşen bütün satırları verir ve denetime düşer', async () => {
    const t = await institution()
    ok(await deliver(t.admin, t, { recipientKind: 'guardian', guardianId: t.guardian }), 201)
    const response = await app.inject({
      method: 'GET',
      url: `${SETS}/${String(t.set.id)}/students?pageSize=1`,
      remoteAddress: clientIp,
      headers: { origin: TEST_ORIGIN, cookie: t.admin, accept: 'text/csv' },
    })
    assert.equal(response.statusCode, 200, response.body)
    assert.match(String(response.headers['content-type']), /text\/csv/)
    assert.match(
      String(response.headers['content-disposition']),
      /materyal-seti-2026-2026-10-06\.csv/,
    )
    const lines = response.body.replace('\uFEFF', '').split('\r\n')
    assert.equal(lines.length, 3)
    assert.match(
      lines[1] ?? '',
      /"Deniz Yılmaz";"7-A";"Ücretli";"Teslim edildi";"06\.10\.2026";"Ayşe Yılmaz \(Kayıtlı veli\)";"Alındı";"Ana depo"/,
    )
    assert.match(lines[2] ?? '', /"Ücret kalemi yok";"Teslim edilmedi"/)
    const audit = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(
        and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'finance.material_set_export')),
      )
    assert.equal(audit.length, 1)
  })

  test('K-205: oturumsuz 401; öğretmen, veli ve öğrenci 403; ön büro okur, teslim ve imza yazar, set ve iptal 403', async () => {
    const t = await institution()
    const setUrl = `${SETS}/${String(t.set.id)}`
    assertError(await get(SETS, null), 401)
    assertError(await deliver('', t), 401)
    for (const role of ['ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(SETS, cookie), 403, 'forbidden')
      assertError(await get(`${setUrl}/students`, cookie), 403, 'forbidden')
      assertError(await get(`${RECIPIENTS}?studentId=s1`, cookie), 403, 'forbidden')
      assertError(await deliver(cookie, t), 403, 'forbidden')
    }
    const desk = await member(t.id, 'onburo')
    assert.equal((await get(SETS, desk)).statusCode, 200)
    assert.equal((await students(t, '', desk)).data.length, 2)
    assertError(
      await call('POST', SETS, desk, {
        name: 'Ön büro seti',
        academicYear: 2026,
        items: [{ stockItemId: t.book.id, quantity: 1 }],
      }),
      403,
      'forbidden',
    )
    assertError(
      await call('PATCH', setUrl, desk, { name: 'Değişti' }, ifMatch(t.set.version)),
      403,
      'forbidden',
    )
    const delivery = ok(await deliver(desk, t, { signatureReceived: false }), 201)
    assertError(await cancel(desk, delivery), 403, 'forbidden')
    assert.equal(ok(await sign(desk, delivery)).signatureReceived, true)
    const row = (await students(t, '?status=delivered', desk)).data[0]
    assert.deepEqual(row?.actions, { deliver: false, sign: false, cancel: false })
  })

  test('DOM-FIN-080: finance modülü kapalıyken materyal seti uçları 403 module_disabled', async () => {
    const t = await institution({ enabledModules: { finance: false } })
    assertError(await get(SETS, t.admin), 403, 'module_disabled')
    assertError(await get(`${RECIPIENTS}?studentId=s1`, t.admin), 403, 'module_disabled')
  })

  test('DOM-FIN-080: dil okulunda set kura bağlanır; hedef kurun etkin kursiyerleridir', async () => {
    const t = await institution({ type: 'language_school' })
    const courseId = randomUUID()
    await db.insert(courses).values({
      institutionId: t.id,
      id: courseId,
      name: 'Genel İngilizce B1',
      nameKey: courseNameKey('Genel İngilizce B1'),
      language: 'en',
      level: 'B1',
      totalHours: 120,
      weeklyHours: 6,
      sessionMinutes: 45,
      minLearners: 4,
      maxLearners: 12,
      certified: false,
      status: 'draft',
      eOzelApproval: 'not_submitted',
    })
    const groupId = randomUUID()
    await db.insert(languageGroups).values({
      institutionId: t.id,
      id: groupId,
      courseId,
      name: 'B1 Akşam',
      nameKey: groupNameKey('B1 Akşam'),
      ageBand: 'adult',
      delivery: 'online',
      schedule: [{ weekday: 1, startTime: '18:00' }],
      startDate: '2026-09-01',
      endDate: '2026-12-31',
      capacity: 10,
      state: 'planned',
    })
    await db.insert(languageGroupMembers).values({
      institutionId: t.id,
      id: randomUUID(),
      groupId,
      studentId: 's2',
      status: 'active',
      joinedAt: FIXED_NOW,
    })
    const body = {
      name: 'B1 kitap seti',
      academicYear: 2026,
      courseId,
      items: [{ stockItemId: t.book.id, quantity: 1 }],
    }
    assertError(
      await call('POST', SETS, t.admin, { ...body, courseId: null, gradeLevel: 7 }),
      422,
      'material_set_target_unavailable',
    )
    const set = ok(await call('POST', SETS, t.admin, body), 201)
    assert.equal(set.courseName, 'Genel İngilizce B1')
    assert.equal(set.studentCount, 1)
    const own = { ...t, set }
    assert.deepEqual(
      (await students(own)).data.map((row) => row.studentId),
      ['s2'],
    )
    assertError(await deliver(t.admin, own), 422, 'material_delivery_student_not_eligible')
    ok(await deliver(t.admin, own, { studentId: 's2' }), 201)
  })

  test('DOM-FIN-080: başka kurumun seti ve teslimi 404 ve B değişmez; listede B yok; gövdedeki institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bDelivery = ok(await deliver(b.admin, b, { signatureReceived: false }), 201)
    const bSetUrl = `${SETS}/${String(b.set.id)}`
    const before = await rows(b.id)

    assertError(await get(bSetUrl, a.admin), 404, 'not_found')
    assertError(
      await call('PATCH', bSetUrl, a.admin, { name: 'Ele geçirildi' }, ifMatch(b.set.version)),
      404,
      'not_found',
    )
    assertError(await get(`${bSetUrl}/students`, a.admin), 404, 'not_found')
    assertError(await deliver(a.admin, a, {}, key(), b.set.id), 404, 'not_found')
    assertError(await cancel(a.admin, bDelivery), 404, 'not_found')
    assertError(await sign(a.admin, bDelivery), 404, 'not_found')
    // B'nin deposu ve kartları A'nın teslim ve setinde etkisizdir.
    assertError(
      await deliver(a.admin, a, { warehouseId: b.warehouse.id }),
      422,
      'stock_warehouse_not_found',
    )
    assertError(
      await call('POST', SETS, a.admin, {
        name: 'Sızma seti',
        academicYear: 2026,
        items: [{ stockItemId: b.book.id, quantity: 1 }],
      }),
      422,
      'stock_item_not_found',
    )
    assertError(
      await call('POST', SETS, a.admin, {
        name: 'Sızma seti',
        academicYear: 2026,
        items: [{ stockItemId: a.book.id, quantity: 1 }],
        institutionId: b.id,
      }),
      400,
      'validation_failed',
    )
    assertError(
      await deliver(a.admin, a, { studentId: 's25', institutionId: b.id }),
      400,
      'validation_failed',
    )
    assert.deepEqual(await rows(b.id), before)

    // Öğrenci kimliği kurum kapsamlıdır: B'nin öğrencisi A'da yok sayılır.
    const outsider = `b-only-${b.id}`
    await insertMissingRecords(
      db,
      b.id,
      [{ collection: 'students', id: outsider, data: { ...SEED.students[0], id: outsider } }],
      FIXED_NOW,
    )
    assertError(await get(`${RECIPIENTS}?studentId=${outsider}`, a.admin), 404, 'not_found')
    assertError(
      await deliver(a.admin, a, { studentId: outsider }),
      422,
      'material_delivery_student_not_found',
    )
    const listOf = async () =>
      (await get(SETS, a.admin)).json().data.map((row: Json) => row.id) as string[]
    assert.equal((await listOf()).includes(String(b.set.id)), false)
    assert.equal(
      (await students(a)).data.some((row) => (row.delivery as Json | null)?.id === bDelivery.id),
      false,
    )
  })
})
