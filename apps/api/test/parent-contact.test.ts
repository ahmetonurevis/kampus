import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { PARENT_CONTACT_REVEAL_LIMIT } from '../src/routes/parents.ts'
import type { MembershipLinkInput } from '../src/services/identity.ts'
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
 * Velinin iletişim bilgisi (DOM-YTK-055): öğretmene maskeli liste ve denetimli "Göster" ucu.
 * Örnek veri kesiti: 7-A (c1) ve 8-B (c12). Ahmet Yıldırım (t2) c1 Türkçe öğretmenidir, c12'ye
 * ders vermez; t18 c12'ye ders verir, c1'e vermez. Ayşe Yılmaz (p1) s1'in velisidir, p12 s12'nin.
 */

const SEED = createSeed(FIXED_NOW)
const CLASS_IDS = ['c1', 'c12']
const PHONE = '05321234512'
const EMAIL = 'ayse.yilmaz@gmail.com'
const students = SEED.students.filter((item) => CLASS_IDS.includes(item.classId))
const studentIds = new Set(students.map((item) => item.id))
const SAMPLE: Partial<Record<CollectionName, readonly Record<string, unknown>[]>> = {
  subjects: SEED.subjects,
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => CLASS_IDS.includes(item.id)),
  students,
  assignments: SEED.assignments.filter((item) => CLASS_IDS.includes(item.classId)),
  parents: SEED.parents
    .filter((item) => item.studentIds.some((id) => studentIds.has(id)))
    .map((item) =>
      item.id === 'p1'
        ? { ...item, phone: PHONE, email: EMAIL }
        : item.id === 'p12'
          ? { ...item, phone: '05559876543' }
          : item,
    ),
}

function rows(sample: Partial<Record<CollectionName, readonly Record<string, unknown>[]>>) {
  return Object.entries(sample).flatMap(([collection, items]) =>
    (items ?? []).map((data) => {
      const name = collection as CollectionName
      const id = recordKey(name, data)
      if (id === null) throw new Error(`anahtarsız örnek kayıt: ${collection}`)
      return { collection: name, id, data }
    }),
  )
}

describe('veli iletişimi (DOM-YTK-055)', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(db, created.id, rows(SAMPLE), FIXED_NOW)
    return { ...created, adminCookie: await signInAs(app, created.admin) }
  }
  async function member(institutionId: string, role: Role, links: MembershipLinkInput[] = []) {
    const user = await createMember(app, institutionId, role, links)
    return { ...user, cookie: await signInAs(app, user) }
  }
  const teacher = (institutionId: string, teacherId = 't2') =>
    member(institutionId, 'ogretmen', [{ kind: 'teacher', recordId: teacherId }])

  const reveal = (cookie: string | null, parentId: string, body: unknown) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/parents/${parentId}/reveal-contact`,
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        ...(cookie === null ? {} : { cookie }),
      },
      payload: JSON.stringify(body),
    })
  const read = (cookie: string, url: string) =>
    app.inject({ method: 'GET', url, headers: { origin: TEST_ORIGIN, cookie } })
  const reveals = (institutionId: string) =>
    db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, institutionId),
          eq(auditLog.action, 'parent_contact.reveal'),
        ),
      )

  function assertError(
    response: Awaited<ReturnType<typeof reveal>>,
    statusCode: number,
    code?: string,
  ) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
    assert.ok(!response.body.includes(PHONE) && !response.body.includes(EMAIL))
  }

  type ParentRow = { id: string; record: { phone?: string; email?: string; name: string } }
  const parentsOf = async (cookie: string, query = '') => {
    const response = await read(cookie, `/api/v1/collections/parents?pageSize=100${query}`)
    assert.equal(response.statusCode, 200, response.body)
    return response.json().data as ParentRow[]
  }

  test('DOM-YTK-055: ders veren öğretmen listede maskeli görür; maskeli alanla aranmaz', async () => {
    const a = await institution()
    const { cookie } = await teacher(a.id)
    const list = await parentsOf(cookie)
    const p1 = list.find((row) => row.id === 'p1')
    assert.equal(p1?.record.phone, '0532 *** ** 12')
    assert.equal(p1?.record.email, 'a***@gmail.com')
    // Ders vermediği sınıfın velisi listede yok.
    assert.equal(
      list.some((row) => row.id === 'p12'),
      false,
    )
    // Ham değerle ve maskeli parçayla arama veliyi bulmaz (maskelenen hane tahmin edilemez).
    assert.equal((await parentsOf(cookie, `&q=${PHONE}`)).length, 0)
    assert.equal((await parentsOf(cookie, '&q=gmail')).length, 0)
    assert.equal((await parentsOf(cookie, '&q=Ay%C5%9Fe')).length, 1)
    const item = await read(cookie, '/api/v1/collections/parents/p1')
    assert.equal(item.json().data.record.phone, '0532 *** ** 12')
  })

  test('DOM-YTK-055: yönetici ve ön büro tam değeri görür; öğrenci ve veli iletişim alanını görmez', async () => {
    const a = await institution()
    for (const cookie of [a.adminCookie, (await member(a.id, 'onburo')).cookie]) {
      const p1 = (await parentsOf(cookie)).find((row) => row.id === 'p1')
      assert.equal(p1?.record.phone, PHONE)
      assert.equal(p1?.record.email, EMAIL)
    }
    const studentCookie = (await member(a.id, 'ogrenci', [{ kind: 'student', recordId: 's1' }]))
      .cookie
    const parentCookie = (await member(a.id, 'veli', [{ kind: 'child', recordId: 's1' }])).cookie
    for (const cookie of [studentCookie, parentCookie]) {
      const list = await parentsOf(cookie)
      assert.deepEqual(
        list.map((row) => row.id),
        ['p1'],
      )
      assert.equal('phone' in (list[0]?.record ?? {}), false)
      assert.equal('email' in (list[0]?.record ?? {}), false)
      const item = await read(cookie, '/api/v1/collections/parents/p1')
      assert.ok(!item.body.includes(PHONE) && !item.body.includes(EMAIL))
    }
  })

  test('DOM-YTK-055: Göster tam değeri döndürür, önbelleğe alınmaz ve denetim kaydına değersiz yazılır', async () => {
    const a = await institution()
    const t = await teacher(a.id)
    const response = await reveal(t.cookie, 'p1', { studentId: 's1', field: 'phone' })
    assert.equal(response.statusCode, 200, response.body)
    assert.deepEqual(response.json().data, {
      parentId: 'p1',
      studentId: 's1',
      field: 'phone',
      value: PHONE,
    })
    assert.equal(response.headers['cache-control'], 'no-store')
    const email = await reveal(t.cookie, 'p1', { studentId: 's1', field: 'email' })
    assert.equal(email.json().data.value, EMAIL)

    const logged = await reveals(a.id)
    assert.equal(logged.length, 2)
    const phoneRow = logged.find((row) => row.changes?.fields?.[0] === 'phone')
    assert.ok(phoneRow)
    assert.equal(phoneRow.actorUserId, t.id)
    assert.equal(phoneRow.actorRole, 'ogretmen')
    assert.equal(phoneRow.entityType, 'parents')
    assert.equal(phoneRow.entityId, 'p1')
    assert.deepEqual(phoneRow.changes, { fields: ['phone'], studentId: 's1' })
    assert.equal(phoneRow.createdAt.toISOString(), FIXED_NOW.toISOString())
    assert.equal(phoneRow.reason, null)
    // Değer hiçbir sütuna yazılmaz.
    const stored = JSON.stringify(logged)
    assert.ok(!stored.includes(PHONE) && !stored.includes(EMAIL))
  })

  test('DOM-YTK-055: ders vermeyen öğretmen ve bağsız veli 404; kayıt yazılmaz', async () => {
    const a = await institution()
    const outside = await teacher(a.id, 't18')
    assertError(await reveal(outside.cookie, 'p1', { studentId: 's1', field: 'phone' }), 404)
    // Kendi öğrencisi (s12) ile başka öğrencinin velisi eşleşmez.
    assertError(await reveal(outside.cookie, 'p1', { studentId: 's12', field: 'phone' }), 404)
    const inside = await teacher(a.id)
    assertError(await reveal(inside.cookie, 'p12', { studentId: 's1', field: 'phone' }), 404)
    assertError(await reveal(inside.cookie, 'p-yok', { studentId: 's1', field: 'phone' }), 404)
    // t18 kendi öğrencisinin velisini açar.
    const own = await reveal(outside.cookie, 'p12', { studentId: 's12', field: 'phone' })
    assert.equal(own.statusCode, 200, own.body)
    assert.equal((await reveals(a.id)).length, 1)
  })

  test('DOM-YTK-055: öğretmen dışı roller 403, oturumsuz 401', async () => {
    const a = await institution()
    const body = { studentId: 's1', field: 'phone' }
    assertError(await reveal(null, 'p1', body), 401)
    assertError(await reveal(a.adminCookie, 'p1', body), 403, 'forbidden')
    assertError(await reveal((await member(a.id, 'onburo')).cookie, 'p1', body), 403, 'forbidden')
    const studentCookie = (await member(a.id, 'ogrenci', [{ kind: 'student', recordId: 's1' }]))
      .cookie
    assertError(await reveal(studentCookie, 'p1', body), 403, 'forbidden')
    const parentCookie = (await member(a.id, 'veli', [{ kind: 'child', recordId: 's1' }])).cookie
    assertError(await reveal(parentCookie, 'p1', body), 403, 'forbidden')
    assert.equal((await reveals(a.id)).length, 0)
  })

  test('DOM-YTK-055, DOM-YTK-011: başka kurumun velisi 404; gövdedeki kurum kimliği 400', async () => {
    const a = await institution()
    const b = await institution()
    await insertMissingRecords(
      db,
      b.id,
      rows({ parents: [{ id: 'p-b', name: 'B Velisi', studentIds: ['s1'], phone: PHONE }] }),
      FIXED_NOW,
    )
    const t = await teacher(a.id)
    assertError(await reveal(t.cookie, 'p-b', { studentId: 's1', field: 'phone' }), 404)
    assertError(
      await reveal(t.cookie, 'p1', { studentId: 's1', field: 'phone', institutionId: b.id }),
      400,
      'validation_failed',
    )
    assert.equal((await reveals(a.id)).length, 0)
    assert.equal((await reveals(b.id)).length, 0)
  })

  test('DOM-YTK-055: geçersiz alan 400, boş alan 422; kayıt yazılmaz', async () => {
    const a = await institution()
    const t = await teacher(a.id)
    assertError(
      await reveal(t.cookie, 'p1', { studentId: 's1', field: 'name' }),
      400,
      'validation_failed',
    )
    assertError(await reveal(t.cookie, 'p1', { field: 'phone' }), 400, 'validation_failed')
    const outside = await teacher(a.id, 't18')
    assertError(
      await reveal(outside.cookie, 'p12', { studentId: 's12', field: 'email' }),
      422,
      'parent_contact_missing',
    )
    assert.equal((await reveals(a.id)).length, 0)
  })

  test('DOM-YTK-040: iletişim modülü kapalıyken 403 module_disabled', async () => {
    const a = await institution({ enabledModules: { communication: false } })
    const t = await teacher(a.id)
    assertError(
      await reveal(t.cookie, 'p1', { studentId: 's1', field: 'phone' }),
      403,
      'module_disabled',
    )
    assert.equal((await reveals(a.id)).length, 0)
  })

  test(`DOM-YTK-055: dakikada ${String(PARENT_CONTACT_REVEAL_LIMIT)} açılıştan sonrası Türkçe 429`, async () => {
    const a = await institution()
    const t = await teacher(a.id)
    for (let i = 0; i < PARENT_CONTACT_REVEAL_LIMIT; i++) {
      const response = await reveal(t.cookie, 'p1', { studentId: 's1', field: 'phone' })
      assert.equal(response.statusCode, 200, response.body)
    }
    const limited = await reveal(t.cookie, 'p1', { studentId: 's1', field: 'phone' })
    assertError(limited, 429, 'rate_limited')
    assert.match(limited.json().message, /Çok fazla istek/)
    assert.ok(Number(limited.headers['retry-after']) > 0)
    assert.equal((await reveals(a.id)).length, PARENT_CONTACT_REVEAL_LIMIT)
    // Sınır kullanıcı başınadır: başka öğretmen etkilenmez.
    const other = await teacher(a.id)
    const response = await reveal(other.cookie, 'p1', { studentId: 's1', field: 'email' })
    assert.equal(response.statusCode, 200, response.body)
  })
})
