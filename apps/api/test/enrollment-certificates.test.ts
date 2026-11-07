import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import { ROLES } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import type { RecordData } from '../src/db/collections.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { languageGroupMembers } from '../src/db/schema/language-groups.ts'
import { records } from '../src/db/schema/records.ts'
import { studentIdentities } from '../src/db/schema/student-identities.ts'
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

// Öğrenci belgesi verisi (`GET /students/:id/enrollment-certificate`; DOM-KAY-027, ON-049): yalnız
// yönetici ve ön büro, modül `crm`, her düzenleme denetim kaydında, içerik izin listesi.

const url = (studentId: string) => `/api/v1/students/${studentId}/enrollment-certificate`
const STUDENT = 'cert-s1'
const student = (overrides: RecordData = {}): RecordData => ({
  id: STUDENT,
  name: 'Deniz Yılmaz',
  classId: 'cert-c1',
  parentId: 'cert-p1',
  number: '2026001',
  nationalId: '10000000146',
  birthDate: '2012-03-04',
  phone: '05550000000',
  email: 'deniz@ogrenci.example',
  isActive: true,
  ...overrides,
})
const ALLOWED_KEYS = [
  'academicYear',
  'className',
  'courseNames',
  'documentId',
  'institutionName',
  'institutionType',
  'issuedAt',
  'learnerName',
  'schoolNumber',
]

describe('öğrenci belgesi (DOM-KAY-027)', () => {
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

  async function institution(
    overrides: Partial<InstitutionOverrides> = {},
    data: RecordData = student(),
    extra: { collection: 'renewals' | 'invoices'; id: string; data: RecordData }[] = [],
  ) {
    const created = await createInstitution(app, { name: 'Akademi Özel Okulları', ...overrides })
    await insertMissingRecords(
      db,
      created.id,
      [
        { collection: 'classes', id: 'cert-c1', data: { id: 'cert-c1', name: '6-A' } },
        { collection: 'students', id: String(data.id), data },
        ...extra,
      ],
      FIXED_NOW,
    )
    return { ...created, cookie: await signInAs(app, created.admin) }
  }

  const get = (target: string, cookie?: string) =>
    app.inject({
      method: 'GET',
      url: target,
      headers: { origin: TEST_ORIGIN, ...(cookie ? { cookie } : {}) },
    })
  const audits = (institutionId: string) =>
    db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, institutionId),
          eq(auditLog.action, 'enrollment_certificate.issue'),
        ),
      )

  test('DOM-KAY-027: oturumsuz 401; yönetici ve ön büro dışındaki roller 403, denetim yazılmaz', async () => {
    assert.equal((await get(url(STUDENT))).statusCode, 401)
    const a = await institution()
    for (const role of ROLES.filter((value) => value !== 'yonetici' && value !== 'onburo')) {
      const cookie = await signInAs(app, await createMember(app, a.id, role))
      const response = await get(url(STUDENT), cookie)
      assert.equal(response.statusCode, 403, `${role}: ${response.body}`)
      assert.equal(response.json().code, 'forbidden', role)
    }
    assert.equal((await audits(a.id)).length, 0)
  })

  test('DOM-KAY-027: crm modülü kapalıyken 403 module_disabled', async () => {
    const a = await institution({ enabledModules: { crm: false } })
    const response = await get(url(STUDENT), a.cookie)
    assert.equal(response.statusCode, 403, response.body)
    assert.equal(response.json().code, 'module_disabled')
    assert.equal((await audits(a.id)).length, 0)
  })

  test('DOM-KAY-027: başka kurumun öğrencisi 404, denetim yazılmaz; olmayan öğrenci 404', async () => {
    const a = await institution()
    const b = await institution({}, student({ id: 'cert-other' }))
    const crossing = await get(url('cert-other'), a.cookie)
    assert.equal(crossing.statusCode, 404, crossing.body)
    assert.equal(crossing.json().code, 'not_found')
    assert.equal((await audits(a.id)).length, 0)
    assert.equal((await audits(b.id)).length, 0)
    assert.equal((await get(url('yok'), a.cookie)).statusCode, 404)
    // Sorgudaki kurum kimliği okunmaz: kurum yalnız oturumdan gelir.
    const smuggled = await get(`${url('cert-other')}?institutionId=${b.id}`, a.cookie)
    assert.equal(smuggled.statusCode, 404, smuggled.body)
    assert.equal((await audits(b.id)).length, 0)
  })

  test('DOM-KAY-027: geçersiz öğrenci kimliği 400, denetim yazılmaz', async () => {
    const a = await institution()
    const response = await get(url('x'.repeat(201)), a.cookie)
    assert.equal(response.statusCode, 400, response.body)
    assert.equal(response.json().code, 'validation_failed')
    assert.equal((await audits(a.id)).length, 0)
  })

  test('DOM-KAY-027: arşivlenmiş öğrenci 404', async () => {
    const a = await institution()
    await db
      .update(records)
      .set({ archivedAt: FIXED_NOW })
      .where(and(eq(records.institutionId, a.id), eq(records.id, STUDENT)))
    assert.equal((await get(url(STUDENT), a.cookie)).statusCode, 404)
    assert.equal((await audits(a.id)).length, 0)
  })

  test('DOM-KAY-027: ön büro belgeyi alır; yanıt izin listesindeki alanları taşır, kimlik ve iletişim yok', async () => {
    const a = await institution()
    await db.insert(studentIdentities).values({
      institutionId: a.id,
      studentId: STUDENT,
      identityKind: 'tc',
      identityNumber: '10000000146',
      birthDate: '2012-03-04',
      academicYear: 2026,
    })
    const front = await createMember(app, a.id, 'onburo')
    const response = await get(url(STUDENT), await signInAs(app, front))
    assert.equal(response.statusCode, 200, response.body)
    const { data } = response.json()
    assert.deepEqual(Object.keys(data).sort(), ALLOWED_KEYS)
    assert.equal(data.institutionName, 'Akademi Özel Okulları')
    assert.equal(data.institutionType, 'school')
    assert.equal(data.learnerName, 'Deniz Yılmaz')
    assert.equal(data.schoolNumber, '2026001')
    assert.equal(data.className, '6-A')
    assert.deepEqual(data.courseNames, [])
    assert.equal(data.academicYear, FIXED_NOW.getUTCFullYear())
    assert.equal(data.issuedAt, FIXED_NOW.toISOString())
    for (const secret of ['10000000146', '2012-03-04', '05550000000', 'deniz@ogrenci.example'])
      assert.ok(!response.body.includes(secret), secret)
  })

  test('DOM-YTK-052, DOM-KAY-027: her düzenleme denetime yazılır; belge kimliği denetim satırıdır, değer yazılmaz', async () => {
    const a = await institution()
    const first = (await get(url(STUDENT), a.cookie)).json().data
    const second = (await get(url(STUDENT), a.cookie)).json().data
    assert.notEqual(first.documentId, second.documentId)
    const rows = await audits(a.id)
    assert.deepEqual(rows.map((row) => row.id).sort(), [first.documentId, second.documentId].sort())
    for (const row of rows) {
      assert.equal(row.entityType, 'students')
      assert.equal(row.entityId, STUDENT)
      assert.equal(row.actorRole, 'yonetici')
      assert.ok(row.changes?.fields?.includes('learnerName'))
      assert.ok(!JSON.stringify(row.changes).includes('Deniz'))
      assert.ok(!JSON.stringify(row.changes).includes('2026001'))
    }
  })

  test('DOM-KAY-024, DOM-KAY-026, DOM-KAY-027: ayrılan öğrenci 422, denetim yazılmaz', async () => {
    const a = await institution({}, student({ isActive: false }))
    const response = await get(url(STUDENT), a.cookie)
    assert.equal(response.statusCode, 422, response.body)
    assert.equal(response.json().code, 'enrollment_certificate_inactive')
    assert.match(response.json().message, /kayıt durumu: Ayrıldı/)
    assert.equal((await audits(a.id)).length, 0)
  })

  test('DOM-KAY-022, DOM-KAY-027: mezun öğrenci 422 ve durumu Mezun yazar', async () => {
    const a = await institution({}, student({ isActive: false }), [
      {
        collection: 'renewals',
        id: 'cert-r1',
        data: {
          id: 'cert-r1',
          studentId: STUDENT,
          mode: 'graduate',
          status: 'Mezun',
          year: 2026,
          fromClassId: 'cert-c1',
          targetClassId: 'cert-c1',
          createdAt: FIXED_NOW.toISOString(),
        },
      },
    ])
    const response = await get(url(STUDENT), a.cookie)
    assert.equal(response.statusCode, 422, response.body)
    assert.match(response.json().message, /kayıt durumu: Mezun/)
  })

  test('DOM-KAY-025, DOM-KAY-027: ödenmemiş borç belgeyi engellemez, ücret yanıtta yok', async () => {
    const a = await institution({}, student(), [
      {
        collection: 'invoices',
        id: 'cert-i1',
        data: {
          id: 'cert-i1',
          studentId: STUDENT,
          installment: 1,
          amount: 123_456,
          dueDate: '2025-01-15T09:00:00.000Z',
          paidAt: null,
          method: null,
          reminderAt: null,
        },
      },
    ])
    const response = await get(url(STUDENT), a.cookie)
    assert.equal(response.statusCode, 200, response.body)
    assert.ok(!response.body.includes('123456'))
  })

  test('DOM-KAY-027: numarası olmayan öğrenci ve kurum ayarı olmayan kurum boş alanla düzenlenir', async () => {
    const a = await institution(
      { academicYear: null },
      student({ number: undefined, classId: 'yok' }),
    )
    const response = await get(url(STUDENT), a.cookie)
    assert.equal(response.statusCode, 200, response.body)
    const { data } = response.json()
    assert.equal(data.schoolNumber, null)
    assert.equal(data.className, null)
    assert.equal(data.academicYear, null)
  })

  test('DOM-KAY-027, DOM-DIL-045: dil okulunda yalnız etkin üyeliğin kuru yazılır; dondurulan yazılmaz', async () => {
    const a = await institution({ type: 'language_school', name: 'Kampüs Dil Akademisi' })
    const admin = a.cookie
    const send = async (target: string, payload: unknown, headers: Record<string, string> = {}) => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1${target}`,
        headers: {
          origin: TEST_ORIGIN,
          cookie: admin,
          'content-type': 'application/json',
          ...headers,
        },
        payload: JSON.stringify(payload),
      })
      assert.ok(response.statusCode < 300, response.body)
      return response.json().data as { id: string }
    }
    const teacher = await createMember(app, a.id, 'ogretmen')
    const addGroup = async (name: string, level: string, weekday: number) => {
      const course = await send(
        '/courses',
        { name, level, totalHours: 12, weeklyHours: 2, minLearners: 2, maxLearners: 12 },
        { 'idempotency-key': randomUUID() },
      )
      await send(`/courses/${course.id}/activate`, {}, { 'if-match': '"1"' })
      const group = await send(
        '/groups',
        {
          courseId: course.id,
          name: `${name} grup`,
          ageBand: 'adult',
          teacherMembershipId: teacher.membershipId,
          delivery: 'in_person',
          room: `Derslik ${String(weekday)}`,
          schedule: [
            { weekday, startTime: '18:00' },
            { weekday, startTime: '18:45' },
          ],
          startDate: '2026-10-12',
          capacity: 10,
        },
        { 'idempotency-key': randomUUID() },
      )
      return group.id
    }
    const member = (groupId: string, status: 'active' | 'frozen') =>
      db.insert(languageGroupMembers).values({
        institutionId: a.id,
        id: randomUUID(),
        groupId,
        studentId: STUDENT,
        status,
        joinedAt: FIXED_NOW,
      })
    await member(await addGroup('Genel İngilizce B1.1', 'B1', 1), 'active')
    await member(await addGroup('IELTS Hazırlık', 'B2', 2), 'frozen')
    const response = await get(url(STUDENT), admin)
    assert.equal(response.statusCode, 200, response.body)
    const { data } = response.json()
    assert.equal(data.institutionType, 'language_school')
    assert.deepEqual(data.courseNames, ['Genel İngilizce B1.1'])
  })
})
