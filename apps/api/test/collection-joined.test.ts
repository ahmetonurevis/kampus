import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import type { CollectionName } from '../src/db/collections.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { records } from '../src/db/schema/records.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
} from './support/app.ts'
import { SAMPLE, sampleRows, SEED } from './support/collections-sample.ts'

/**
 * Liste ve tek kayıt yanıtındaki bağlı adlar (`joined`: studentName, className, branchName).
 * Bağlı kayıt aktörün kapsamından ve ayıklanmış kimlikten çözülür; kapsam dışı, arşivlenmiş ve
 * başka kurumun kaydının adı sızmaz.
 */

const student = (id: string) => SEED.students.find((item) => item.id === id) ?? assert.fail(id)
const className = (id: string) => SEED.classes.find((item) => item.id === id)?.name
const branchName = (id: string) => SEED.branches.find((item) => item.id === id)?.name

interface Item {
  id: string
  record: Record<string, unknown>
  joined?: { studentName?: string; className?: string; branchName?: string }
}

/** `t1` Kadıköy kampüsündeki sınıflarında ders verir; b2 kampüsündeki sınıf kapsamda ama kampüsü değil. */
const EXTRA = [
  ...SEED.branches.slice(0, 2).map((data) => ({ collection: 'branches' as const, data })),
  {
    collection: 'classes' as const,
    data: {
      id: 'test-c-b2',
      name: 'Test-B2',
      grade: 7,
      section: 'B',
      level: '7. Sınıf',
      branchId: 'b2',
      teacherId: 'test-t-b2',
      capacity: 20,
    },
  },
  {
    collection: 'assignments' as const,
    data: { id: 'test-a-b2', classId: 'test-c-b2', teacherId: 't1', subjectId: 'math' },
  },
  // `t1`in c1 sınıfındaki yoklama satırı, kapsamda olmayan öğrenciye (s11) ait.
  {
    collection: 'attendance' as const,
    data: {
      id: 'test-att-foreign',
      studentId: 's11',
      classId: 'c1',
      date: '2026-10-05T09:00:00.000Z',
      status: 'present',
    },
  },
  // Sınıfı kayıtta olmayan kayıt: sınıf adı öğrencinin güncel sınıfından çözülür.
  {
    collection: 'grades' as const,
    data: {
      id: 'test-g-noclass',
      studentId: 's11',
      subjectId: 'math',
      score: 70,
      date: '2026-10-05T09:00:00.000Z',
    },
  },
].map((item) => ({ ...item, id: String(item.data.id) }))

describe('liste yanıtında bağlı adlar: studentName, className, branchName', () => {
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

  async function institution(
    extra: readonly {
      collection: CollectionName
      id: string
      data: Record<string, unknown>
    }[] = EXTRA,
  ) {
    const created = await createInstitution(app)
    await insertMissingRecords(db, created.id, [...sampleRows(), ...extra], FIXED_NOW)
    return { ...created, adminCookie: await signInAs(app, created.admin) }
  }

  async function member(
    institutionId: string,
    role: Role,
    links: Parameters<typeof createMember>[3] = [],
  ) {
    return signInAs(app, await createMember(app, institutionId, role, links))
  }

  const get = (url: string, cookie: string) =>
    app.inject({ method: 'GET', url, headers: { cookie } })

  async function list(cookie: string, collection: string, query = ''): Promise<Item[]> {
    const response = await get(`/api/v1/collections/${collection}?pageSize=100&${query}`, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json().data
  }

  const byId = (items: readonly Item[], id: string) =>
    items.find((item) => item.id === id) ?? assert.fail(`kayıt yok: ${id}`)

  test('yönetici: taksit ve notta öğrenci ile sınıf adı, sınıfta kampüs adı', async () => {
    const { adminCookie } = await institution()
    const invoices = await list(adminCookie, 'invoices')
    assert.ok(invoices.length > 0)
    for (const item of invoices) {
      const studentId = String(item.record.studentId)
      assert.equal(item.joined?.studentName, student(studentId).name, item.id)
      // Sınıf kaydı yalnız örnek kesitteki sınıflarda var (c1-c3); öbürlerinde ad yoktur.
      const classId = student(studentId).classId
      assert.equal(
        item.joined?.className,
        ['c1', 'c2', 'c3'].includes(classId) ? className(classId) : undefined,
        item.id,
      )
      assert.equal('branchName' in (item.joined ?? {}), false)
    }
    const classes = await list(adminCookie, 'classes')
    for (const item of classes) {
      const branchId = String(item.record.branchId)
      assert.equal(item.joined?.branchName, branchName(branchId), item.id)
    }
    // Kayıtta sınıf yoksa öğrencinin güncel sınıfı; sınıf kaydı yoksa ad da yoktur.
    const grade = byId(await list(adminCookie, 'grades'), 'test-g-noclass')
    assert.equal(grade.joined?.studentName, student('s11').name)
    assert.equal(grade.joined?.className, undefined)
  })

  test('tek kayıt yanıtı da bağlı adı taşır; bağlı alanı olmayan koleksiyonda joined yoktur', async () => {
    const { adminCookie } = await institution()
    const [first] = await list(adminCookie, 'invoices')
    assert.ok(first)
    const single = await get(`/api/v1/collections/invoices/${first.id}`, adminCookie)
    assert.equal(single.statusCode, 200, single.body)
    assert.deepEqual(single.json().data.joined, first.joined)
    for (const item of await list(adminCookie, 'subjects')) assert.equal('joined' in item, false)
  })

  test('SQL sayfası ve bellek yolu aynı bağlı adları verir', async () => {
    const { adminCookie } = await institution()
    for (const collection of ['invoices', 'grades', 'classes', 'attendance']) {
      const plain = await list(adminCookie, collection)
      const sorted = await list(adminCookie, collection, 'sort=id')
      assert.equal(plain.length, sorted.length, collection)
      for (const item of plain)
        assert.deepEqual(byId(sorted, item.id).joined, item.joined, `${collection} ${item.id}`)
    }
  })

  test('DOM-YTK-022: öğretmen kapsam dışı kampüsün ve öğrencinin adını görmez', async () => {
    const { id } = await institution()
    const teacher = await member(id, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }])
    const classes = await list(teacher, 'classes')
    // Kendi kampüsündeki sınıfın kampüs adı gelir; b2 kampüsünü okuyamaz.
    assert.equal(byId(classes, 'c1').joined?.branchName, branchName('b1'))
    const other = byId(classes, 'test-c-b2')
    assert.deepEqual(other.joined, {})
    // Öğretmen satırı sınıfından görür; kapsamında olmayan öğrencinin adı ve sınıfı gelmez.
    const attendance = await list(teacher, 'attendance')
    assert.equal(byId(attendance, 'test-att-foreign').joined?.studentName, undefined)
    assert.equal(byId(attendance, 'test-att-foreign').joined?.className, className('c1'))
    const own = attendance.find((item) => item.record.studentId === 's1')
    assert.equal(own?.joined?.studentName, student('s1').name)
    for (const item of attendance) {
      const studentName = item.joined?.studentName
      if (studentName !== undefined)
        assert.notEqual(studentName, student('s11').name, `${item.id} kapsam dışı ad`)
    }
  })

  test('DOM-YTK-025/024: veli ve öğrenci yalnız kendi kayıtlarının adlarını görür', async () => {
    const { id } = await institution()
    const parent = await member(id, 'veli', [{ kind: 'child', recordId: 's2' }])
    const own = await list(parent, 'invoices')
    assert.ok(own.length > 0)
    for (const item of own) {
      assert.equal(item.record.studentId, 's2')
      assert.deepEqual(item.joined, { studentName: student('s2').name, className: className('c2') })
    }
    const pupil = await member(id, 'ogrenci', [{ kind: 'student', recordId: 's1' }])
    for (const item of await list(pupil, 'grades')) {
      assert.deepEqual(item.joined, { studentName: student('s1').name, className: className('c1') })
    }
    // Veli sınıf listesinde yalnız çocuğunun sınıfını, kampüs adıyla birlikte görür.
    const classes = await list(parent, 'classes')
    assert.deepEqual(
      classes.map((item) => item.id),
      ['c2'],
    )
    assert.equal(classes[0]?.joined?.branchName, branchName(String(classes[0]?.record.branchId)))
  })

  test('DOM-YTK-011: arşivlenmiş ve başka kurumun bağlı kaydı ad vermez', async () => {
    const { id, adminCookie } = await institution()
    // Başka kurumda aynı kimlikli öğrenci başka adla bulunur; ad karışmamalı.
    const other = await createInstitution(app)
    await insertMissingRecords(
      db,
      other.id,
      [
        {
          collection: 'students',
          id: 's1',
          data: { ...student('s1'), name: 'Başka Kurum Öğrencisi' },
        },
      ],
      FIXED_NOW,
    )
    const before = await list(adminCookie, 'invoices', 'studentId=s1')
    assert.ok(before.length > 0)
    for (const item of before) assert.equal(item.joined?.studentName, student('s1').name)
    await db
      .update(records)
      .set({ archivedAt: FIXED_NOW })
      .where(
        and(
          eq(records.institutionId, id),
          eq(records.collection, 'students'),
          eq(records.id, 's1'),
        ),
      )
    for (const item of await list(adminCookie, 'invoices', 'studentId=s1')) {
      assert.equal(item.joined?.studentName, undefined, item.id)
      assert.equal(item.joined?.className, undefined, item.id)
    }
    // Başka kurumun yöneticisi bu kurumun taksitini ve adını görmez.
    const foreign = await signInAs(app, other.admin)
    assert.deepEqual(await list(foreign, 'invoices'), [])
  })

  test('oturumsuz 401', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/collections/invoices' })
    assert.equal(response.statusCode, 401)
  })

  test('SAMPLE kesiti bağlı ad testinin varsayımını karşılar', () => {
    // Ayrı öğrenci/sınıf kimlikleri: s1 c1'de, s2 c2'de, s11 örnek sınıfların dışında.
    assert.equal(student('s1').classId, 'c1')
    assert.equal(student('s2').classId, 'c2')
    assert.ok(!['c1', 'c2', 'c3'].includes(student('s11').classId))
    assert.ok((SAMPLE.classes ?? []).some((item) => item.id === 'c1'))
  })
})
