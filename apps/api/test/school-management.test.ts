import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { findRecord, insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import type { MembershipLinkInput } from '../src/services/identity.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'

/**
 * Kampüs, öğretmen ve sınıf kaydetme uçları (`POST`/`PATCH /branches`, `/teachers`, `/classes`).
 * Yetki core `authorize('branch.save' | 'teacher.save' | 'class.save')`: yalnız yönetici (yetki
 * matrisi "Kampüs, sınıf, kadro", DOM-YTK-001). Kontenjan, branş, derslik ve program çakışması
 * kuralları core `saveBranch`/`saveTeacher`/`saveClass`'tadır. Her test kendi kurumunu kurar.
 */

const SEED = createSeed(FIXED_NOW)
const CLASS_IDS = ['c1', 'c2']
const STUDENT_IDS = new Set(
  SEED.students.filter((item) => CLASS_IDS.includes(item.classId)).map((item) => item.id),
)
const SAMPLE: Partial<Record<CollectionName, readonly Record<string, unknown>[]>> = {
  subjects: SEED.subjects,
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => CLASS_IDS.includes(item.id)),
  students: SEED.students.filter((item) => STUDENT_IDS.has(item.id)),
  parents: SEED.parents.filter((item) => item.id === 'p1'),
  assignments: SEED.assignments.filter((item) => CLASS_IDS.includes(item.classId)),
  schedule: SEED.schedule.filter((item) => CLASS_IDS.includes(item.classId)),
  quizzes: SEED.quizzes.filter((item) => CLASS_IDS.includes(item.classId)),
  appointments: SEED.appointments,
  schoolEvents: SEED.schoolEvents,
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

/** c1 (7-A) ders → öğretmen. */
const C1_TEACHERS = Object.fromEntries(
  SEED.assignments.filter((a) => a.classId === 'c1').map((a) => [a.subjectId, a.teacherId]),
)
const BRANCH = { name: 'Test Kampüsü', address: 'Test Mahallesi No: 1 İstanbul' }
const TEACHER = {
  name: 'Test Öğretmeni',
  email: 'test-ogretmen@kampus.example',
  phone: '05559990010',
  subjectId: 'math',
  branchId: 'b1',
}
const CLASS = {
  grade: 7,
  section: 'd',
  branchId: 'b1',
  teacherId: 't1',
  capacity: 24,
  room: '401',
  subjectTeachers: C1_TEACHERS,
}
const PERSONAL: [Role, MembershipLinkInput[]][] = [
  ['onburo', []],
  ['ogretmen', [{ kind: 'teacher', recordId: 't1' }]],
  ['ogrenci', [{ kind: 'student', recordId: 's1' }]],
  ['veli', [{ kind: 'child', recordId: 's1' }]],
]

describe('kampüs, öğretmen ve sınıf kaydetme uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0
  const key = () => ({ 'idempotency-key': `test-save-${String(++serial).padStart(4, '0')}` })

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function institution() {
    const created = await createInstitution(app)
    await insertMissingRecords(db, created.id, rows(SAMPLE), FIXED_NOW)
    return { ...created, adminCookie: await signInAs(app, created.admin) }
  }

  async function member(institutionId: string, role: Role, links: MembershipLinkInput[]) {
    return signInAs(app, await createMember(app, institutionId, role, links))
  }

  function send(
    method: 'POST' | 'PATCH',
    url: string,
    cookie: string | null,
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url,
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        ...(cookie === null ? {} : { cookie }),
        ...headers,
      },
      payload: JSON.stringify(body),
    })
  }
  const create = (
    path: string,
    cookie: string | null,
    body: unknown,
    headers: Record<string, string> = key(),
  ) => send('POST', `/api/v1/${path}`, cookie, body, headers)
  const update = (
    path: string,
    cookie: string | null,
    body: unknown,
    version: number | null = 1,
    headers: Record<string, string> = {},
  ) =>
    send('PATCH', `/api/v1/${path}`, cookie, body, {
      ...(version === null ? {} : { 'if-match': `"${version}"` }),
      ...headers,
    })

  function assertError(response: Awaited<ReturnType<typeof send>>, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  /** Koleksiyonun bütün satırlarının kimlik → sürüm görüntüsü (değişmediğini doğrulamak için). */
  async function snapshot(institutionId: string, collections: CollectionName[]) {
    const stored = await loadRecords(db, institutionId, collections, { includeArchived: true })
    return stored.map((row) => `${row.collection}:${row.id}:${row.version}`).sort()
  }

  async function audits(institutionId: string, action: string) {
    return db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))
  }

  test('DOM-YTK-001: altı uç da oturumsuz 401, yönetici dışındaki roller 403; kayıt değişmez', async () => {
    const a = await institution()
    const tracked: CollectionName[] = ['branches', 'teachers', 'classes', 'assignments']
    const before = await snapshot(a.id, tracked)
    const calls = [
      (cookie: string | null) => create('branches', cookie, BRANCH),
      (cookie: string | null) => update('branches/b1', cookie, { address: 'Başka adres' }),
      (cookie: string | null) => create('teachers', cookie, TEACHER),
      (cookie: string | null) => update('teachers/t2', cookie, { phone: '05559990013' }),
      (cookie: string | null) => create('classes', cookie, CLASS),
      (cookie: string | null) => update('classes/c1', cookie, { room: '403' }),
    ]
    const members = await Promise.all(
      PERSONAL.map(async ([role, links]) => member(a.id, role, links)),
    )
    for (const call of calls) {
      assertError(await call(null), 401)
      for (const cookie of members) assertError(await call(cookie), 403, 'forbidden')
    }
    assert.deepEqual(await snapshot(a.id, tracked), before)
  })

  test('OpenAPI: düzenleme uçlarında If-Match zorunlu, oluşturmada yok', () => {
    const document = app.swagger() as {
      paths: Record<
        string,
        Record<string, { parameters?: { in: string; name: string; required?: boolean }[] }>
      >
    }
    for (const [path, param] of [
      ['branches', 'branchId'],
      ['teachers', 'teacherId'],
      ['classes', 'classId'],
    ] as const) {
      const header = (route: string, method: string) =>
        document.paths[route]?.[method]?.parameters?.find(
          (item) => item.in === 'header' && item.name === 'if-match',
        )
      assert.equal(header(`/api/v1/${path}/{${param}}`, 'patch')?.required, true, path)
      assert.equal(header(`/api/v1/${path}`, 'post'), undefined, path)
    }
  })

  describe('POST /branches', () => {
    test('DOM-YTK-001: yönetici kampüs oluşturur 201 + Location; gövdedeki institutionId etkisiz; denetimde yalnız alan adı', async () => {
      const a = await institution()
      const other = await institution()
      const response = await create('branches', a.adminCookie, {
        ...BRANCH,
        institutionId: other.id,
      })
      assert.equal(response.statusCode, 201, response.body)
      const data = response.json().data
      assert.equal(data.entity.collection, 'branches')
      assert.deepEqual(data.changes, { inserted: 1, updated: 0, archived: 0, restored: 0 })
      assert.equal(response.headers.location, `/api/v1/collections/branches/${data.entity.id}`)
      const stored = await findRecord(db, a.id, 'branches', data.entity.id)
      assert.equal(stored?.data.name, BRANCH.name)
      assert.equal(stored?.data.isActive, true)
      assert.equal(await findRecord(db, other.id, 'branches', data.entity.id), null)
      const [entry] = await audits(a.id, 'branches.create')
      assert.equal(entry?.entityType, 'branches')
      assert.equal(entry?.entityId, data.entity.id)
      assert.ok((entry?.changes as { fields: string[] }).fields.includes('address'))
      const text = JSON.stringify(entry?.changes)
      assert.ok(!text.includes('Test Mahallesi') && !text.includes(BRANCH.name), text)
      // Yeni kayıt okuma ucundan görünür (kalıcılık).
      const read = await app.inject({
        method: 'GET',
        url: response.headers.location as string,
        headers: { origin: TEST_ORIGIN, cookie: a.adminCookie },
      })
      assert.equal(read.statusCode, 200, read.body)
      assert.equal(read.json().data.record.name, BRANCH.name)
    })

    test('oturumsuz 401; ön büro, öğretmen, öğrenci ve veli 403; kayıt yazılmaz', async () => {
      const a = await institution()
      const before = await snapshot(a.id, ['branches'])
      assertError(await create('branches', null, BRANCH), 401)
      for (const [role, links] of PERSONAL)
        assertError(
          await create('branches', await member(a.id, role, links), BRANCH),
          403,
          'forbidden',
        )
      assert.deepEqual(await snapshot(a.id, ['branches']), before)
    })

    test('400 doğrulama, 409 aynı ad, If-Match 400; hiçbir kayıt ve denetim yazılmaz', async () => {
      const a = await institution()
      const before = await snapshot(a.id, ['branches'])
      for (const body of [
        { ...BRANCH, name: '' },
        { name: BRANCH.name },
        { ...BRANCH, address: 'x'.repeat(241) },
      ])
        assertError(await create('branches', a.adminCookie, body), 400, 'validation_failed')
      assertError(
        await create('branches', a.adminCookie, { ...BRANCH, name: 'kadıköy kampüsü' }),
        409,
        'branch_name_taken',
      )
      assertError(
        await create('branches', a.adminCookie, BRANCH, { ...key(), 'if-match': '"1"' }),
        400,
        'if_match_not_supported',
      )
      assert.deepEqual(await snapshot(a.id, ['branches']), before)
      assert.equal((await audits(a.id, 'branches.create')).length, 0)
    })

    test('Idempotency-Key: anahtarsız 400; aynı anahtar aynı yanıtı tekrarlar, farklı gövde 422; kayıt bir kez yazılır', async () => {
      const a = await institution()
      assertError(
        await create('branches', a.adminCookie, BRANCH, {}),
        400,
        'idempotency_key_required',
      )
      const headers = key()
      const first = await create('branches', a.adminCookie, BRANCH, headers)
      assert.equal(first.statusCode, 201, first.body)
      const replay = await create('branches', a.adminCookie, BRANCH, headers)
      assert.equal(replay.statusCode, 201, replay.body)
      assert.equal(replay.headers['idempotent-replayed'], 'true')
      assert.equal(replay.headers.location, first.headers.location)
      assert.deepEqual(replay.json(), first.json())
      assertError(
        await create('branches', a.adminCookie, { ...BRANCH, name: 'Başka Kampüs' }, headers),
        422,
        'idempotency_key_reused',
      )
      const named = (await loadRecords(db, a.id, ['branches'])).filter(
        (row) => row.data.name === BRANCH.name,
      )
      assert.equal(named.length, 1)
    })
  })

  describe('PATCH /branches/:branchId', () => {
    test('kısmi gövde birleşir; If-Match zorunlu (400), eski sürüm 409; başarıda sürüm artar', async () => {
      const a = await institution()
      assertError(
        await update('branches/b2', a.adminCookie, { address: 'Yeni adres' }, null),
        400,
        'if_match_required',
      )
      assertError(
        await update('branches/b2', a.adminCookie, { address: 'Yeni adres' }, 7),
        409,
        'version_conflict',
      )
      assert.equal((await findRecord(db, a.id, 'branches', 'b2'))?.version, 1)
      const ok = await update('branches/b2', a.adminCookie, { address: 'Yeni adres' })
      assert.equal(ok.statusCode, 200, ok.body)
      assert.deepEqual(ok.json().data.entity, { collection: 'branches', id: 'b2' })
      const stored = await findRecord(db, a.id, 'branches', 'b2')
      assert.equal(stored?.version, 2)
      assert.equal(stored?.data.address, 'Yeni adres')
      assert.equal(stored?.data.name, SEED.branches.find((b) => b.id === 'b2')?.name)
      const [entry] = await audits(a.id, 'branches.update')
      assert.deepEqual((entry?.changes as { fields: string[] }).fields, ['address'])
      // Aynı If-Match ile ikinci yazma eski sürümdür.
      assertError(
        await update('branches/b2', a.adminCookie, { address: 'Üçüncü adres' }),
        409,
        'version_conflict',
      )
    })

    test('olmayan kayıt 404; başka kurumun kampüsü 404 ve B değişmez; roller 403; 400 ve 409 kayıt değiştirmez', async () => {
      const a = await institution()
      const b = await institution()
      const created = await create('branches', b.adminCookie, BRANCH)
      const foreign: string = created.json().data.entity.id
      assertError(
        await update('branches/test-b-yok', a.adminCookie, { address: 'Başka adres' }),
        404,
        'not_found',
      )
      assertError(
        await update(`branches/${foreign}`, a.adminCookie, { address: 'Başka adres' }),
        404,
        'not_found',
      )
      assert.equal((await findRecord(db, b.id, 'branches', foreign))?.data.address, BRANCH.address)
      const before = await snapshot(a.id, ['branches'])
      assertError(await update('branches/b2', null, { address: 'Başka adres' }), 401)
      for (const [role, links] of PERSONAL)
        assertError(
          await update('branches/b2', await member(a.id, role, links), { address: 'Başka adres' }),
          403,
        )
      assertError(
        await update('branches/b2', a.adminCookie, { name: '' }),
        400,
        'validation_failed',
      )
      assertError(
        await update('branches/b2', a.adminCookie, { name: 'Kadıköy Kampüsü' }),
        409,
        'branch_name_taken',
      )
      assert.deepEqual(await snapshot(a.id, ['branches']), before)
    })
  })

  describe('POST /teachers ve PATCH /teachers/:teacherId', () => {
    test('öğretmen kaydı oluşturulur (hesap ayrı); e-posta tekil 409, pasif kampüs 422; kayıt değişmez', async () => {
      const a = await institution()
      const response = await create('teachers', a.adminCookie, TEACHER)
      assert.equal(response.statusCode, 201, response.body)
      const id: string = response.json().data.entity.id
      assert.equal(response.headers.location, `/api/v1/collections/teachers/${id}`)
      const stored = await findRecord(db, a.id, 'teachers', id)
      assert.equal(stored?.data.subject, 'Matematik')
      assert.equal(stored?.data.guidanceCounselor, false)
      const [entry] = await audits(a.id, 'teachers.create')
      const text = JSON.stringify(entry?.changes)
      assert.ok(!text.includes(TEACHER.email) && !text.includes(TEACHER.phone), text)
      const before = await snapshot(a.id, ['teachers'])
      assertError(
        await create('teachers', a.adminCookie, { ...TEACHER, phone: '05559990011' }),
        409,
        'teacher_email_taken',
      )
      assertError(
        await create('teachers', a.adminCookie, {
          ...TEACHER,
          email: 'baska@kampus.example',
          branchId: 'test-b-yok',
        }),
        422,
        'campus_required',
      )
      assertError(
        await create('teachers', a.adminCookie, { ...TEACHER, phone: '5551234' }),
        400,
        'validation_failed',
      )
      for (const [role, links] of PERSONAL)
        assertError(await create('teachers', await member(a.id, role, links), TEACHER), 403)
      assert.deepEqual(await snapshot(a.id, ['teachers']), before)
    })

    test('düzenleme kısmi; ders ataması olan öğretmenin branşı 422; rehberlik görevi gövdeden değişmez', async () => {
      const a = await institution()
      const before = await snapshot(a.id, ['teachers', 'assignments'])
      assertError(
        await update('teachers/t1', a.adminCookie, { subjectId: 'turkish' }),
        422,
        'teacher_has_assignments',
      )
      assert.deepEqual(await snapshot(a.id, ['teachers', 'assignments']), before)
      const ok = await update('teachers/t2', a.adminCookie, {
        phone: '05559990012',
        guidanceCounselor: true,
      })
      assert.equal(ok.statusCode, 200, ok.body)
      const stored = await findRecord(db, a.id, 'teachers', 't2')
      assert.equal(stored?.version, 2)
      assert.equal(stored?.data.phone, '05559990012')
      assert.equal(stored?.data.name, SEED.teachers.find((t) => t.id === 't2')?.name)
      assert.equal(stored?.data.guidanceCounselor, false)
    })

    test('DOM-YTK-027: zümre başkanı öğretmenin branşını yeni branşın dışına değiştirmek 422 ve kayıt değişmez; görev kaldırılınca başarılı; aynı branşta kaydetme serbest; başka kurum 404', async () => {
      const a = await institution()
      const created = await create('teachers', a.adminCookie, TEACHER)
      assert.equal(created.statusCode, 201, created.body)
      const teacherId = created.json().data.entity.id as string
      const account = await createMember(app, a.id, 'ogretmen', [
        { kind: 'teacher', recordId: teacherId },
      ])
      const duty = await create('coordinator-duties', a.adminCookie, {
        membershipId: account.membershipId,
        scopeId: 'math',
      })
      assert.equal(duty.statusCode, 201, duty.body)
      const dutyData = duty.json().data as { id: string; rowVersion: number }
      const before = await snapshot(a.id, ['teachers'])
      const rejected = await update(`teachers/${teacherId}`, a.adminCookie, {
        subjectId: 'turkish',
      })
      assertError(rejected, 422, 'coordinator_duty_outside_branch')
      assert.match(rejected.json().message, /Matematik koordinatör görevi yeni branşla uyuşmuyor/)
      assert.deepEqual(rejected.json().issues?.[0]?.path, ['subjectId'])
      assert.deepEqual(await snapshot(a.id, ['teachers']), before)
      assert.equal((await findRecord(db, a.id, 'teachers', teacherId))?.data.subjectId, 'math')
      // Aynı branşta başka alan değişimi serbest.
      assertError(
        await update(`teachers/${teacherId}`, a.adminCookie, { phone: '05559990020' }),
        200,
      )
      // Başka kurumun yöneticisi bu öğretmene ulaşamaz.
      const other = await institution()
      assertError(
        await update(`teachers/${teacherId}`, other.adminCookie, { subjectId: 'turkish' }),
        404,
      )
      // Görevi kaldır, sonra branş değişir.
      const removed = await app.inject({
        method: 'DELETE',
        url: `/api/v1/coordinator-duties/${dutyData.id}`,
        headers: {
          origin: TEST_ORIGIN,
          cookie: a.adminCookie,
          'if-match': `"${dutyData.rowVersion}"`,
        },
      })
      assert.equal(removed.statusCode, 200, removed.body)
      const ok = await update(`teachers/${teacherId}`, a.adminCookie, { subjectId: 'turkish' }, 2)
      assert.equal(ok.statusCode, 200, ok.body)
      assert.equal((await findRecord(db, a.id, 'teachers', teacherId))?.data.subjectId, 'turkish')
    })
  })

  describe('POST /classes ve PATCH /classes/:classId', () => {
    test('DOM-YTK-001: sınıf ders atamalarıyla tek işlemde açılır; eksik branş (422 issues yolu) öğretmeni 422 ve hiçbir kayıt yazılmaz', async () => {
      const a = await institution()
      const before = await snapshot(a.id, ['classes', 'assignments'])
      const wrongTeacher = await create('classes', a.adminCookie, {
        ...CLASS,
        subjectTeachers: { ...C1_TEACHERS, math: 't2' },
      })
      assertError(wrongTeacher, 422, 'subject_teacher_required')
      // DOM-YTK-001: core hata yolu alan düzeyinde `issues` olarak taşınır (400 ile aynı biçim).
      const wrongBody = wrongTeacher.json()
      assert.equal(wrongBody.issues.length, 1)
      assert.deepEqual(wrongBody.issues[0].path, ['subjectTeachers', 'math'])
      assert.equal(wrongBody.issues[0].code, 'subject_teacher_required')
      assert.equal(wrongBody.issues[0].message, wrongBody.message)
      assertError(
        await create('classes', a.adminCookie, { ...CLASS, capacity: 41 }),
        400,
        'validation_failed',
      )
      assertError(
        await create('classes', a.adminCookie, { ...CLASS, room: '101' }),
        409,
        'classroom_in_use',
      )
      for (const [role, links] of PERSONAL)
        assertError(await create('classes', await member(a.id, role, links), CLASS), 403)
      assert.deepEqual(await snapshot(a.id, ['classes', 'assignments']), before)
      const response = await create('classes', a.adminCookie, CLASS)
      assert.equal(response.statusCode, 201, response.body)
      const data = response.json().data
      assert.equal(data.entity.collection, 'classes')
      const subjects = Object.keys(C1_TEACHERS).length
      assert.deepEqual(data.changes, {
        inserted: 1 + subjects,
        updated: 0,
        archived: 0,
        restored: 0,
      })
      const stored = await findRecord(db, a.id, 'classes', data.entity.id)
      assert.equal(stored?.data.name, '7-D')
      const assignments = (await loadRecords(db, a.id, ['assignments'])).filter(
        (row) => row.data.classId === data.entity.id,
      )
      assert.equal(assignments.length, subjects)
    })

    test('kontenjan öğrenciden az 422; düzenleme ders atamalarının kimliğini korur; başka kurum 404', async () => {
      const a = await institution()
      const b = await institution()
      const tracked: CollectionName[] = ['classes', 'assignments', 'schedule', 'quizzes']
      const before = await snapshot(a.id, tracked)
      const lowCapacity = await update('classes/c1', a.adminCookie, { capacity: 1 })
      assertError(lowCapacity, 422, 'capacity_below_students')
      // Core bu kuralda yol vermez: gövde eskisi gibi, `issues` alanı yok.
      assert.equal('issues' in lowCapacity.json(), false)
      assertError(
        await update('classes/c1', a.adminCookie, { room: '102' }),
        409,
        'classroom_in_use',
      )
      assertError(
        await update('classes/c1', a.adminCookie, { capacity: 'çok' }),
        400,
        'validation_failed',
      )
      assert.deepEqual(await snapshot(a.id, tracked), before)
      // A'da açılan sınıf B'nin yöneticisine 404'tür; A'nın kaydı değişmez.
      const opened = await create('classes', a.adminCookie, CLASS)
      const own: string = opened.json().data.entity.id
      assertError(await update(`classes/${own}`, b.adminCookie, { room: '999' }), 404, 'not_found')
      assert.equal((await findRecord(db, a.id, 'classes', own))?.data.room, CLASS.room)
      const assignmentIds = (await loadRecords(db, a.id, ['assignments']))
        .filter((row) => row.data.classId === 'c1')
        .map((row) => row.id)
        .sort()
      const ok = await update('classes/c1', a.adminCookie, { room: '402', capacity: 26 })
      assert.equal(ok.statusCode, 200, ok.body)
      const stored = await findRecord(db, a.id, 'classes', 'c1')
      assert.equal(stored?.version, 2)
      assert.equal(stored?.data.room, '402')
      assert.equal(stored?.data.capacity, 26)
      assert.equal(stored?.data.name, '7-A')
      assert.deepEqual(
        (await loadRecords(db, a.id, ['assignments']))
          .filter((row) => row.data.classId === 'c1')
          .map((row) => row.id)
          .sort(),
        assignmentIds,
      )
      assert.equal(ok.json().data.changes.inserted, 0)
      assert.equal(ok.json().data.changes.archived, 0)
    })
  })
})
