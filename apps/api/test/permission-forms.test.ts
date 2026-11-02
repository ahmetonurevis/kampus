import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { findRecord, insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { studentIdentities } from '../src/db/schema/student-identities.ts'
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
 * İzin formu ve dijital veli onayı uçları (OG-055; IST-067, docs/domain/iletisim-ve-veli.md
 * DOM-ILT-030, -031, -036…039). Her test kendi kurumunu örnek veri kesitiyle kurar: 7-A (c1) ve
 * 5-A (c2), her biri 10 öğrenci. Deniz (s1) ve Nehir (s25) 7-A'da, Ece (s2) 5-A'dadır. Selin Kaya
 * (t1) iki sınıfın rehber öğretmenidir; Ahmet Yıldırım (t2) 7-A'ya Türkçe dersine girer, rehberi
 * değildir; Emre Demir (t5) bu sınıflara girmez. Anne Ayşe Deniz ile Ece'nin, baba yalnız
 * Deniz'in velayetli velisidir. FIXED_NOW 2026-10-06T09:00Z (salı).
 */

const SEED = createSeed(FIXED_NOW)
const CLASS_IDS = ['c1', 'c2']
const STUDENT_IDS = new Set(
  SEED.students.filter((item) => CLASS_IDS.includes(item.classId)).map((item) => item.id),
)
const C1_STUDENTS = SEED.students.filter((item) => item.classId === 'c1').map((item) => item.id)
type Sample = Partial<Record<CollectionName, readonly Record<string, unknown>[]>>
const SAMPLE: Sample = {
  subjects: SEED.subjects,
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => CLASS_IDS.includes(item.id)),
  students: SEED.students.filter((item) => STUDENT_IDS.has(item.id)),
  assignments: SEED.assignments.filter((item) => CLASS_IDS.includes(item.classId)),
}

/** Yalnız B kurumunda bulunan form ve kararı (çapraz kurum). */
const ONLY_B: Sample = {
  permissionForms: [
    {
      id: 'pf-only-b',
      topic: 'trip',
      title: 'B kurumunun gezisi',
      description: 'Yalnız B kurumunda bulunan form.',
      deadline: '2026-10-20',
      classIds: ['c1'],
      targetStudentIds: [],
      studentIds: C1_STUDENTS,
      teacherId: 't1',
      status: 'open',
      closedAt: null,
      createdBy: { role: 'ogretmen', userId: 'u-b' },
      createdAt: '2026-10-01T09:00:00.000Z',
      updatedAt: '2026-10-01T09:00:00.000Z',
    },
  ],
}

function rows(sample: Sample) {
  return Object.entries(sample).flatMap(([collection, items]) =>
    (items ?? []).map((data) => {
      const name = collection as CollectionName
      const id = recordKey(name, data)
      if (id === null) throw new Error(`anahtarsız örnek kayıt: ${collection}`)
      return { collection: name, id, data }
    }),
  )
}

const FORM = {
  topic: 'trip',
  title: 'Müze gezisi',
  description: 'Cuma günü İstanbul Arkeoloji Müzesi gezisi.',
  deadline: '2026-10-09',
  classIds: ['c1'],
}
const APPROVE = { studentId: 's1', decision: 'approved' }
const REJECT = { studentId: 's1', decision: 'rejected', note: 'Sağlık kontrolü var.' }

type Json = ReturnType<typeof JSON.parse>

describe('izin formu uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let now = FIXED_NOW
  let serial = 0
  const key = () => ({ 'idempotency-key': `test-permission-${String(++serial).padStart(5, '0')}` })

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => now })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function institution(overrides: Partial<InstitutionOverrides> = {}, extra: Sample = {}) {
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(db, created.id, rows(SAMPLE), FIXED_NOW)
    await insertMissingRecords(db, created.id, rows(extra), FIXED_NOW)
    return { ...created, adminCookie: await signInAs(app, created.admin) }
  }
  async function member(institutionId: string, role: Role, links: MembershipLinkInput[] = []) {
    const user = await createMember(app, institutionId, role, links)
    return { ...user, cookie: await signInAs(app, user) }
  }
  const student = async (institutionId: string, studentId = 's1') =>
    (await member(institutionId, 'ogrenci', [{ kind: 'student', recordId: studentId }])).cookie
  const teacher = async (institutionId: string, teacherId: string) =>
    (await member(institutionId, 'ogretmen', [{ kind: 'teacher', recordId: teacherId }])).cookie
  const mother = (institutionId: string) =>
    member(institutionId, 'veli', [
      { kind: 'child', recordId: 's1' },
      { kind: 'child', recordId: 's2' },
    ])
  const father = (institutionId: string) =>
    member(institutionId, 'veli', [{ kind: 'child', recordId: 's1' }])

  function send(
    method: 'POST' | 'PATCH' | 'DELETE',
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
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(cookie === null ? {} : { cookie }),
        ...headers,
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    })
  }
  const read = (cookie: string | null, url: string) =>
    app.inject({
      method: 'GET',
      url,
      headers: { origin: TEST_ORIGIN, ...(cookie === null ? {} : { cookie }) },
    })
  const ifMatch = (version: number): Record<string, string> => ({
    'if-match': `"${String(version)}"`,
  })
  const create = (
    cookie: string | null,
    body: unknown = FORM,
    headers: Record<string, string> = key(),
  ) => send('POST', '/api/v1/permission-forms', cookie, body, headers)
  const patch = (cookie: string, id: string, body: unknown, headers: Record<string, string>) =>
    send('PATCH', `/api/v1/permission-forms/${id}`, cookie, body, headers)
  const closeForm = (cookie: string, id: string, headers: Record<string, string>) =>
    send('POST', `/api/v1/permission-forms/${id}/close`, cookie, undefined, headers)
  const archive = (cookie: string, id: string, headers: Record<string, string>) =>
    send('DELETE', `/api/v1/permission-forms/${id}`, cookie, undefined, headers)
  const decide = (
    cookie: string,
    id: string,
    body: unknown,
    headers: Record<string, string> = key(),
  ) => send('POST', `/api/v1/permission-forms/${id}/decisions`, cookie, body, headers)

  type Response = Awaited<ReturnType<typeof read>>
  function assertError(response: Response, statusCode: number, code?: string) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }
  const outcome = (response: Response) => {
    const body = response.json() as { code?: string; message?: string }
    return [response.statusCode, body.code, body.message]
  }
  const snapshot = async (institutionId: string) =>
    (
      await loadRecords(db, institutionId, ['permissionForms', 'permissionDecisions'], {
        includeArchived: true,
      })
    )
      .map((row) => [row.collection, row.id, row.version, row.archivedAt, row.data])
      .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
  /** Başarısız isteklerden sonra form ve kararlar (veri, sürüm, arşiv) aynı kalır. */
  async function unchanged(institutionId: string, action: () => Promise<void>) {
    const before = await snapshot(institutionId)
    await action()
    assert.deepEqual(await snapshot(institutionId), before)
  }
  const versionOf = async (institutionId: string, id: string) => {
    const row = await findRecord(db, institutionId, 'permissionForms', id)
    assert.ok(row, `permissionForms/${id} yok`)
    return row.version
  }
  const ids = (response: Response) =>
    (response.json().data as { id: string }[]).map((item) => item.id)
  async function opened(cookie: string, body: unknown = FORM): Promise<Json> {
    const response = await create(cookie, body)
    assert.equal(response.statusCode, 201, response.body)
    return response.json().data
  }
  const notices = async (institutionId: string, kind = 'permission_form_opened') =>
    (await loadRecords(db, institutionId, ['notifications']))
      .map((row) => row.data)
      .filter((n) => n.kind === kind)
  /** Velinin öğrenci bağını yönetici olarak değiştirir (velayet, iletişim kısıtı). */
  async function setBond(
    institution: { adminCookie: string },
    membershipId: string,
    body: Record<string, unknown>,
    studentId = 's1',
  ) {
    const bonds = await read(institution.adminCookie, `/api/v1/students/${studentId}/guardians`)
    assert.equal(bonds.statusCode, 200, bonds.body)
    const own = (bonds.json().data as Json[]).find((bond) => bond.membershipId === membershipId)
    assert.ok(own)
    const changed = await send(
      'PATCH',
      `/api/v1/students/${studentId}/guardians/${own.id as string}`,
      institution.adminCookie,
      body,
      ifMatch(own.rowVersion as number),
    )
    assert.equal(changed.statusCode, 200, changed.body)
  }
  const identity = (institutionId: string, studentId: string, birthDate: string) =>
    db.insert(studentIdentities).values({
      institutionId,
      studentId,
      academicYear: 2026,
      identityKind: 'foreign',
      identityNumber: `YK-${studentId}`,
      birthDate,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })
  const studentOf = (form: Json, studentId: string): Json => {
    const found = (form.students as Json[]).find((item) => item.studentId === studentId)
    assert.ok(found, `${studentId} formda yok`)
    return found
  }
  async function detail(cookie: string, id: string): Promise<Json> {
    const response = await read(cookie, `/api/v1/permission-forms/${id}`)
    assert.equal(response.statusCode, 200, response.body)
    return response.json().data
  }

  // --- Kimlik, rol, modül ----------------------------------------------------------------------

  test('oturumsuz istek 401', async () => {
    assertError(await read(null, '/api/v1/permission-forms'), 401)
    assertError(await create(null), 401)
  })

  test('DOM-YTK-040: communication modülü kapalıyken bütün izin formu uçları 403 module_disabled', async () => {
    const a = await institution({ enabledModules: { communication: false } }, ONLY_B)
    const t1 = await teacher(a.id, 't1')
    const parent = (await mother(a.id)).cookie
    await unchanged(a.id, async () => {
      assertError(await read(a.adminCookie, '/api/v1/permission-forms'), 403, 'module_disabled')
      assertError(
        await read(a.adminCookie, '/api/v1/permission-forms/pf-only-b'),
        403,
        'module_disabled',
      )
      assertError(await create(t1), 403, 'module_disabled')
      assertError(
        await patch(t1, 'pf-only-b', { title: 'Yeni' }, ifMatch(1)),
        403,
        'module_disabled',
      )
      assertError(await closeForm(t1, 'pf-only-b', ifMatch(1)), 403, 'module_disabled')
      assertError(await archive(t1, 'pf-only-b', ifMatch(1)), 403, 'module_disabled')
      assertError(await decide(parent, 'pf-only-b', APPROVE), 403, 'module_disabled')
    })
  })

  test('DOM-ILT-036: ön büro okuyamaz, veli ve öğrenci form açamaz, öğretmen karar veremez (403)', async () => {
    const a = await institution()
    const form = await opened(await teacher(a.id, 't1'))
    const frontDesk = (await member(a.id, 'onburo')).cookie
    await unchanged(a.id, async () => {
      assertError(await read(frontDesk, '/api/v1/permission-forms'), 403, 'forbidden')
      assertError(await create(frontDesk), 403, 'forbidden')
      assertError(await create((await mother(a.id)).cookie), 403, 'forbidden')
      assertError(await create(await student(a.id)), 403, 'forbidden')
      assertError(await decide(await teacher(a.id, 't1'), form.id, APPROVE), 403, 'forbidden')
    })
  })

  // --- CRUD ve sayılar -------------------------------------------------------------------------

  test('DOM-ILT-036, DOM-ILT-038: rehber öğretmen form açar, okur, düzenler, kapatır; kararsız form arşivlenir', async () => {
    const a = await institution()
    const t1 = await teacher(a.id, 't1')
    const created = await create(t1)
    assert.equal(created.statusCode, 201, created.body)
    const form = created.json().data as Json
    assert.equal(created.headers.location, `/api/v1/permission-forms/${form.id as string}`)
    assert.equal(form.version, 1)
    assert.equal(form.topic, 'trip')
    assert.equal(form.teacherId, 't1')
    assert.equal(form.status, 'open')
    assert.equal(form.acceptingDecisions, true)
    assert.equal(form.deadlineEndsAt, '2026-10-09T21:00:00.000Z')
    assert.deepEqual([...form.studentIds].sort(), [...C1_STUDENTS].sort())

    const list = await read(t1, '/api/v1/permission-forms')
    assert.equal(list.statusCode, 200, list.body)
    assert.equal(list.json().meta.total, 1)
    assert.deepEqual(list.json().data[0].counts, {
      pending: C1_STUDENTS.length,
      approved: 0,
      rejected: 0,
      total: C1_STUDENTS.length,
    })

    const edited = await patch(t1, form.id, { title: 'Arkeoloji Müzesi gezisi' }, ifMatch(1))
    assert.equal(edited.statusCode, 200, edited.body)
    assert.equal(edited.json().data.title, 'Arkeoloji Müzesi gezisi')
    assert.equal(edited.json().data.version, 2)
    // Konu değişmez: gövdede 400.
    assertError(await patch(t1, form.id, { topic: 'club' }, ifMatch(2)), 400, 'validation_failed')

    const closed = await closeForm(t1, form.id, ifMatch(2))
    assert.equal(closed.statusCode, 200, closed.body)
    assert.equal(closed.json().data.status, 'closed')
    assert.equal(closed.json().data.acceptingDecisions, false)
    assert.equal(closed.json().data.closedAt, FIXED_NOW.toISOString())
    assertError(await closeForm(t1, form.id, ifMatch(3)), 409, 'permission_form_closed')
    assertError(
      await patch(t1, form.id, { title: 'Yeniden' }, ifMatch(3)),
      422,
      'permission_form_closed',
    )
    const openList = await read(t1, '/api/v1/permission-forms?status=open')
    assert.equal(openList.json().meta.total, 0)
    const closedList = await read(t1, '/api/v1/permission-forms?status=closed&topic=trip')
    assert.deepEqual(ids(closedList), [form.id])

    // Kararsız form arşivlenir; listede ve tekil okumada yoktur.
    const other = await opened(t1, { ...FORM, topic: 'photo', title: 'Okul fotoğrafı' })
    const archived = await archive(t1, other.id, ifMatch(1))
    assert.equal(archived.statusCode, 200, archived.body)
    assertError(await read(t1, `/api/v1/permission-forms/${other.id as string}`), 404, 'not_found')
    assert.deepEqual(ids(await read(t1, '/api/v1/permission-forms')), [form.id])
  })

  test('DOM-ILT-036: geçmiş son gün 422, rehberi olmadığı sınıfa öğretmen 403, olmayan sınıf 404', async () => {
    const a = await institution()
    const t1 = await teacher(a.id, 't1')
    const t2 = await teacher(a.id, 't2')
    await unchanged(a.id, async () => {
      assertError(
        await create(t1, { ...FORM, deadline: '2026-10-05' }),
        422,
        'permission_form_deadline_in_past',
      )
      assertError(await create(t2), 403, 'permission_form_scope_denied')
      assertError(await create(a.adminCookie, { ...FORM, classIds: ['c-yok'] }), 404, 'not_found')
      assertError(await create(t1, { ...FORM, classIds: [] }), 400, 'validation_failed')
    })
  })

  test('DOM-ILT-038: formu gören başka öğretmen 403 permission_form_not_owner, görmeyen 404', async () => {
    const a = await institution()
    const form = await opened(await teacher(a.id, 't1'))
    const t2 = await teacher(a.id, 't2')
    const t5 = await teacher(a.id, 't5')
    await unchanged(a.id, async () => {
      assertError(
        await patch(t2, form.id, { title: 'Yeni başlık' }, ifMatch(1)),
        403,
        'permission_form_not_owner',
      )
      assertError(await closeForm(t2, form.id, ifMatch(1)), 403, 'permission_form_not_owner')
      assertError(await patch(t5, form.id, { title: 'Yeni başlık' }, ifMatch(1)), 404)
      assertError(await read(t5, `/api/v1/permission-forms/${form.id as string}`), 404)
    })
    // Sınıfa giren öğretmen formu ve sınıfındaki öğrencilerin durumunu okur.
    const seen = await detail(t2, form.id)
    assert.equal(seen.students.length, C1_STUDENTS.length)
  })

  // --- Karar -----------------------------------------------------------------------------------

  test('DOM-ILT-031, DOM-ILT-037: iki veliden biri reddederse durum ret; veli yalnız kendi kararını görür', async () => {
    const a = await institution()
    const t1 = await teacher(a.id, 't1')
    const form = await opened(t1)
    const anne = await mother(a.id)
    const baba = await father(a.id)

    const approved = await decide(anne.cookie, form.id, APPROVE)
    assert.equal(approved.statusCode, 201, approved.body)
    assert.equal(approved.headers.location, `/api/v1/permission-forms/${form.id as string}`)
    assert.equal(approved.json().data.decision, 'approved')
    assert.equal(approved.json().data.relation, 'guardian')
    assert.equal(approved.json().data.studentStatus, 'approved')

    // Aynı karar ve not yeni satır açmaz (200).
    const again = await decide(anne.cookie, form.id, APPROVE)
    assert.equal(again.statusCode, 200, again.body)
    assert.equal(again.json().data.id, approved.json().data.id)

    const rejected = await decide(baba.cookie, form.id, REJECT)
    assert.equal(rejected.statusCode, 201, rejected.body)
    assert.equal(rejected.json().data.studentStatus, 'rejected')
    const stored = await loadRecords(db, a.id, ['permissionDecisions'])
    assert.equal(stored.length, 2)

    // Yönetici: bütün öğrenciler, iki karar ve karar verenler.
    const admin = await detail(a.adminCookie, form.id)
    assert.deepEqual(admin.counts, {
      pending: C1_STUDENTS.length - 1,
      approved: 0,
      rejected: 1,
      total: C1_STUDENTS.length,
    })
    const deniz = (admin.students as Json[]).find((item) => item.studentId === 's1')
    assert.equal(deniz.status, 'rejected')
    assert.deepEqual(
      // Aynı anda verilen kararlar kimliğe göre sıralanır; karşılaştırma karara göre.
      (deniz.decisions as Json[]).map((d) => [d.decision, d.decidedByUserId, d.mine]).sort(),
      [
        ['approved', anne.id, false],
        ['rejected', baba.id, false],
      ],
    )

    // Anne: yalnız Deniz (Ece formda yok), yalnız kendi kararı; babanın reddi durumda görünür.
    const own = await detail(anne.cookie, form.id)
    assert.deepEqual(own.studentIds, ['s1'])
    assert.deepEqual(own.counts, { pending: 0, approved: 0, rejected: 1, total: 1 })
    assert.equal(own.students.length, 1)
    assert.equal(own.students[0].status, 'rejected')
    assert.deepEqual(
      (own.students[0].decisions as Json[]).map((d) => [
        d.decision,
        d.note,
        d.mine,
        d.decidedByUserId,
      ]),
      [['approved', '', true, null]],
    )
    const list = await read(anne.cookie, '/api/v1/permission-forms')
    assert.deepEqual(list.json().data[0].counts, { pending: 0, approved: 0, rejected: 1, total: 1 })

    // Anne kararını değiştirir: yeni satır; durum yine ret (babanınki geçerli).
    const changed = await decide(anne.cookie, form.id, { ...APPROVE, decision: 'rejected' })
    assert.equal(changed.statusCode, 201, changed.body)
    assert.equal((await loadRecords(db, a.id, ['permissionDecisions'])).length, 3)

    // Kararı olan form arşivlenmez (409), kapatılır.
    await unchanged(a.id, async () => {
      assertError(await archive(t1, form.id, ifMatch(1)), 409, 'permission_form_has_decisions')
    })
  })

  test('DOM-ILT-037: veli başka çocuk ve formun hedefinde olmayan çocuk için karar veremez (404)', async () => {
    const a = await institution()
    const form = await opened(await teacher(a.id, 't1'))
    const anne = await mother(a.id)
    const baba = await father(a.id)
    await unchanged(a.id, async () => {
      const foreignChild = await decide(anne.cookie, form.id, { ...APPROVE, studentId: 's25' })
      assertError(foreignChild, 404, 'not_found')
      assert.deepEqual(
        outcome(foreignChild),
        outcome(await decide(anne.cookie, form.id, { ...APPROVE, studentId: 's-yok' })),
      )
      // Ece (s2) annenin çocuğu ama 7-A formunun hedefinde değil.
      assertError(await decide(anne.cookie, form.id, { ...APPROVE, studentId: 's2' }), 404)
      // Ece babanın çocuğu değil.
      assertError(await decide(baba.cookie, form.id, { ...APPROVE, studentId: 's2' }), 404)
    })
  })

  test('DOM-ILT-070, DOM-ILT-037: velayeti kalkan veli karar veremez ve formu göremez (404)', async () => {
    const a = await institution()
    const form = await opened(await teacher(a.id, 't1'))
    const anne = await mother(a.id)
    // Öğrencide velayetli bir veli kalmalı (DOM-ILT-075): baba velayetli kalır.
    await father(a.id)
    await setBond(a, anne.membershipId, { custody: 'none' })
    await unchanged(a.id, async () => {
      assertError(await decide(anne.cookie, form.id, APPROVE), 404, 'not_found')
      assertError(await read(anne.cookie, `/api/v1/permission-forms/${form.id as string}`), 404)
    })
    assert.equal((await read(anne.cookie, '/api/v1/permission-forms')).json().meta.total, 0)
  })

  test('DOM-ILT-030: 18 yaşını doldurmuş öğrenci kendisi karar verir, velisi 403; 18 altı öğrenci 403', async () => {
    const a = await institution()
    // Doğum tarihi kimlik satırındadır (ADR 0006 karar 9); öğrenci kaydında yoktur.
    await db.insert(studentIdentities).values({
      institutionId: a.id,
      studentId: 's1',
      academicYear: 2026,
      identityKind: 'foreign',
      identityNumber: 'YK-0001',
      birthDate: '2008-01-15',
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })
    const form = await opened(await teacher(a.id, 't1'))
    const anne = await mother(a.id)
    await unchanged(a.id, async () => {
      assertError(await decide(anne.cookie, form.id, APPROVE), 403, 'permission_adult_self')
      assertError(
        await decide(await student(a.id, 's25'), form.id, { ...APPROVE, studentId: 's25' }),
        403,
        'permission_guardian_required',
      )
    })
    const self = await decide(await student(a.id, 's1'), form.id, APPROVE)
    assert.equal(self.statusCode, 201, self.body)
    assert.equal(self.json().data.relation, 'self')
    assert.equal(self.json().data.studentStatus, 'approved')
    const admin = await detail(a.adminCookie, form.id)
    assert.equal(admin.counts.approved, 1)
  })

  test('DOM-ILT-030, DOM-ILT-038: son gün sonrası karar 422, form kapalı listelenir; kapalı formda 422', async () => {
    const a = await institution()
    const t1 = await teacher(a.id, 't1')
    const form = await opened(t1)
    const closedForm = await opened(t1, { ...FORM, title: 'Kapanacak form' })
    assert.equal((await closeForm(t1, closedForm.id, ifMatch(1))).statusCode, 200)
    const anne = await mother(a.id)
    // Son gün (9 Ekim) Europe/Istanbul gün sonuna kadar karar alınır.
    now = new Date('2026-10-09T20:59:59.000Z')
    try {
      assert.equal((await decide(anne.cookie, form.id, APPROVE)).statusCode, 201)
      now = new Date('2026-10-09T21:00:00.000Z')
      await unchanged(a.id, async () => {
        assertError(
          await decide(anne.cookie, form.id, REJECT),
          422,
          'permission_form_deadline_passed',
        )
        assertError(
          await decide(anne.cookie, closedForm.id, APPROVE),
          422,
          'permission_form_closed',
        )
      })
      const list = await read(anne.cookie, '/api/v1/permission-forms?status=closed')
      assert.equal(list.json().meta.total, 2)
      assert.equal(list.json().data[0].acceptingDecisions, false)
    } finally {
      now = FIXED_NOW
    }
  })

  test('DOM-ILT-071: kararın ardından velayeti kaldırılan velinin kararı sayılmaz, durum yeniden bekliyor', async () => {
    const a = await institution()
    const form = await opened(await teacher(a.id, 't1'))
    const anne = await mother(a.id)
    const baba = await father(a.id)
    const approved = await decide(anne.cookie, form.id, APPROVE)
    assert.equal(approved.json().data.studentStatus, 'approved')
    assert.equal(studentOf(await detail(a.adminCookie, form.id), 's1').status, 'approved')

    await setBond(a, anne.membershipId, { custody: 'none' })
    // Annenin kararı geçmiş olarak kalır, durumu etkilemez; baba karar vermedi.
    const after = await detail(a.adminCookie, form.id)
    const deniz = studentOf(after, 's1')
    assert.equal(deniz.status, 'pending')
    assert.equal(after.counts.approved, 0)
    assert.deepEqual(
      (deniz.decisions as Json[]).map((d) => [d.decision, d.decidedByUserId]),
      [['approved', anne.id]],
    )
    // Velayetli babanın kararı sayılır.
    const rejected = await decide(baba.cookie, form.id, REJECT)
    assert.equal(rejected.json().data.studentStatus, 'rejected')
    const fixed = await decide(baba.cookie, form.id, APPROVE)
    assert.equal(fixed.json().data.studentStatus, 'approved')
    assert.equal(studentOf(await detail(a.adminCookie, form.id), 's1').status, 'approved')
  })

  test('DOM-ILT-074, DOM-ILT-037: iletişimi kısıtlanan veli formu okuyamaz, karar veremez (404); eski kararı sayılmaz', async () => {
    const a = await institution()
    const form = await opened(await teacher(a.id, 't1'))
    const anne = await mother(a.id)
    await father(a.id)
    assert.equal((await decide(anne.cookie, form.id, REJECT)).statusCode, 201)
    assert.equal(studentOf(await detail(a.adminCookie, form.id), 's1').status, 'rejected')

    await setBond(a, anne.membershipId, { custody: 'none', contactRestricted: true })
    await unchanged(a.id, async () => {
      assertError(await decide(anne.cookie, form.id, APPROVE), 404, 'not_found')
      assertError(await read(anne.cookie, `/api/v1/permission-forms/${form.id as string}`), 404)
    })
    assert.equal((await read(anne.cookie, '/api/v1/permission-forms')).json().meta.total, 0)
    // Kısıtlı velinin reddi durumu belirlemez.
    assert.equal(studentOf(await detail(a.adminCookie, form.id), 's1').status, 'pending')
  })

  test('DOM-ILT-036, DOM-ILT-037: okulda 18 yaşını doldurmuş öğrencinin bildirimi kendisine gider, form veliye görünmez', async () => {
    const a = await institution()
    await identity(a.id, 's1', '2008-01-15')
    const form = await opened(await teacher(a.id, 't1'))
    const sent = await notices(a.id)
    assert.deepEqual(
      sent
        .filter((n) => n.studentId === 's1')
        .map((n) => n.audience)
        .sort(),
      ['student'],
    )
    assert.ok(sent.filter((n) => n.studentId !== 's1').every((n) => n.audience === 'parent'))
    // Annenin formdaki tek çocuğu Deniz yetişkin: form ona görünmez, karar 404 değil 403'tür.
    const anne = await mother(a.id)
    assert.equal((await read(anne.cookie, '/api/v1/permission-forms')).json().meta.total, 0)
    assertError(await read(anne.cookie, `/api/v1/permission-forms/${form.id as string}`), 404)
    // Deniz kendi kararını verir ve formu görür.
    const deniz = await student(a.id, 's1')
    const own = await decide(deniz, form.id, APPROVE)
    assert.equal(own.statusCode, 201, own.body)
    assert.equal(own.json().data.relation, 'self')
    assert.equal(studentOf(await detail(deniz, form.id), 's1').status, 'approved')
  })

  test('DOM-ILT-030: dil okulunda adayı minor:false olan, kimlik satırı bulunmayan kursiyer kendi kararını verir', async () => {
    const a = await institution(
      { type: 'language_school' },
      {
        prospects: [
          {
            id: 'pr-s2',
            studentId: 's2',
            minor: false,
            stage: 'Kayıt oldu',
            createdAt: '2026-09-01T09:00:00.000Z',
          },
        ],
      },
    )
    const form = await opened(a.adminCookie, { ...FORM, classIds: [], studentIds: ['s1', 's2'] })
    assert.deepEqual((await notices(a.id)).map((n) => [n.audience, n.studentId]).sort(), [
      ['parent', 's1'],
      ['student', 's2'],
    ])
    const anne = await mother(a.id)
    await unchanged(a.id, async () => {
      assertError(
        await decide(anne.cookie, form.id, { ...APPROVE, studentId: 's2' }),
        403,
        'permission_adult_self',
      )
    })
    const own = await decide(await student(a.id, 's2'), form.id, { ...APPROVE, studentId: 's2' })
    assert.equal(own.statusCode, 201, own.body)
    assert.equal(own.json().data.relation, 'self')
    assert.equal(own.json().data.studentStatus, 'approved')
    // Anne yalnız Deniz'i görür.
    assert.deepEqual((await detail(anne.cookie, form.id)).studentIds, ['s1'])
  })

  test('DOM-ILT-037: öğrenci ve veli yalnız kendisini/çocuğunu görür; hedef sınıf ve öğretmen dönmez', async () => {
    const a = await institution()
    const form = await opened(await teacher(a.id, 't1'))
    for (const cookie of [await student(a.id, 's1'), (await mother(a.id)).cookie]) {
      const seen = await detail(cookie, form.id)
      assert.deepEqual(seen.studentIds, ['s1'])
      assert.deepEqual(
        (seen.students as Json[]).map((item) => item.studentId),
        ['s1'],
      )
      assert.deepEqual(seen.counts, { pending: 1, approved: 0, rejected: 0, total: 1 })
      assert.equal('classIds' in seen, false)
      assert.equal('teacherId' in seen, false)
      const listed = (await read(cookie, '/api/v1/permission-forms')).json().data[0] as Json
      assert.equal('classIds' in listed, false)
      assert.equal('teacherId' in listed, false)
    }
    const admin = await detail(a.adminCookie, form.id)
    assert.deepEqual(admin.classIds, ['c1'])
    assert.equal(admin.teacherId, 't1')
  })

  test('DOM-ILT-037: derse giren öğretmen velinin notunu ve karar satırını görmez, rehber ve yönetici görür', async () => {
    const a = await institution()
    const form = await opened(await teacher(a.id, 't1'))
    const baba = await father(a.id)
    assert.equal((await decide(baba.cookie, form.id, REJECT)).statusCode, 201)
    const notes = (seen: Json) =>
      (studentOf(seen, 's1').decisions as Json[]).map((d) => [d.decision, d.note])
    const lesson = await detail(await teacher(a.id, 't2'), form.id)
    assert.equal(studentOf(lesson, 's1').status, 'rejected')
    assert.deepEqual(notes(lesson), [])
    assert.equal(JSON.stringify(lesson).includes(REJECT.note), false)
    const expected = [['rejected', REJECT.note]]
    assert.deepEqual(notes(await detail(await teacher(a.id, 't1'), form.id)), expected)
    assert.deepEqual(notes(await detail(a.adminCookie, form.id)), expected)
    assert.deepEqual(notes(await detail(baba.cookie, form.id)), expected)
    assert.deepEqual(notes(await detail(await student(a.id, 's1'), form.id)), expected)
  })

  test('DOM-ILT-031, DOM-ILT-034: eşzamanlı kararlar sırayla yazılır; aynı kişinin aynı kararı tek satır', async () => {
    const a = await institution()
    const form = await opened(await teacher(a.id, 't1'))
    const anne = await mother(a.id)
    const baba = await father(a.id)
    const [first, second, third] = await Promise.all([
      decide(anne.cookie, form.id, APPROVE),
      decide(baba.cookie, form.id, REJECT),
      decide(anne.cookie, form.id, APPROVE),
    ])
    assert.equal(second?.statusCode, 201, second?.body)
    assert.deepEqual([first?.statusCode, third?.statusCode].sort(), [200, 201])
    assert.equal(first?.json().data.id, third?.json().data.id)
    assert.equal((await loadRecords(db, a.id, ['permissionDecisions'])).length, 2)
    assert.equal(studentOf(await detail(a.adminCookie, form.id), 's1').status, 'rejected')
  })

  // --- Bildirim --------------------------------------------------------------------------------

  test('IST-067, DOM-ILT-039: form açılınca ve hedefe yeni giren öğrenciye permission_form_opened yazılır', async () => {
    const a = await institution()
    const t1 = await teacher(a.id, 't1')
    const form = await opened(t1)
    const sent = await notices(a.id)
    assert.deepEqual(
      sent.map((n) => [n.audience, n.studentId, (n.subject as Json).id]).sort(),
      C1_STUDENTS.map((id) => ['parent', id, form.id]).sort(),
    )
    // Ece hedefe girer: yalnız ona yeni bildirim.
    const edited = await patch(t1, form.id, { classIds: ['c1'], studentIds: ['s2'] }, ifMatch(1))
    assert.equal(edited.statusCode, 200, edited.body)
    const after = await notices(a.id)
    assert.equal(after.length, sent.length + 1)
    assert.ok(after.some((n) => n.studentId === 's2' && n.audience === 'parent'))
  })

  test('IST-067, DOM-YTK-030: dil okulunda yetişkin kursiyere bildirim kendisine gider, veliye gitmez', async () => {
    const a = await institution({ type: 'language_school' })
    await db.insert(studentIdentities).values({
      institutionId: a.id,
      studentId: 's2',
      academicYear: 2026,
      identityKind: 'foreign',
      identityNumber: 'YK-0002',
      birthDate: '2000-05-01',
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })
    await opened(a.adminCookie, { ...FORM, classIds: [], studentIds: ['s1', 's2'] })
    const sent = (await notices(a.id)).map((n) => [n.audience, n.studentId]).sort()
    assert.deepEqual(sent, [
      ['parent', 's1'],
      ['student', 's2'],
    ])
  })

  // --- Sürüm ve idempotency --------------------------------------------------------------------

  test('Idempotency-Key: açma ve kararda zorunlu, aynı anahtar ilk yanıtı tekrarlar; If-Match 400', async () => {
    const a = await institution()
    const t1 = await teacher(a.id, 't1')
    const anne = await mother(a.id)
    await unchanged(a.id, async () => {
      assertError(await create(t1, FORM, {}), 400, 'idempotency_key_required')
      assertError(
        await create(t1, FORM, { ...key(), ...ifMatch(1) }),
        400,
        'if_match_not_supported',
      )
    })
    const headers = key()
    const first = await create(t1, FORM, headers)
    const second = await create(t1, FORM, headers)
    assert.equal(first.statusCode, 201, first.body)
    assert.equal(second.statusCode, 201, second.body)
    assert.equal(second.headers['idempotent-replayed'], 'true')
    assert.deepEqual(second.json(), first.json())
    assert.equal((await loadRecords(db, a.id, ['permissionForms'])).length, 1)

    const formId = first.json().data.id as string
    await unchanged(a.id, async () => {
      assertError(await decide(anne.cookie, formId, APPROVE, {}), 400, 'idempotency_key_required')
    })
    const decisionKey = key()
    const decided = await decide(anne.cookie, formId, APPROVE, decisionKey)
    const replayed = await decide(anne.cookie, formId, APPROVE, decisionKey)
    assert.equal(decided.statusCode, 201, decided.body)
    assert.equal(replayed.headers['idempotent-replayed'], 'true')
    assert.deepEqual(replayed.json(), decided.json())
    assert.equal((await loadRecords(db, a.id, ['permissionDecisions'])).length, 1)
  })

  test('If-Match: düzenleme, kapatma ve arşivde zorunlu (400); bayat sürüm 409, kayıt değişmez', async () => {
    const a = await institution()
    const t1 = await teacher(a.id, 't1')
    const form = await opened(t1)
    assert.equal(await versionOf(a.id, form.id), 1)
    await unchanged(a.id, async () => {
      assertError(await patch(t1, form.id, { title: 'Yeni başlık' }, {}), 400, 'if_match_required')
      assertError(await closeForm(t1, form.id, {}), 400, 'if_match_required')
      assertError(await archive(t1, form.id, {}), 400, 'if_match_required')
      assertError(
        await patch(t1, form.id, { title: 'Yeni başlık' }, ifMatch(7)),
        409,
        'version_conflict',
      )
      assertError(await closeForm(t1, form.id, ifMatch(7)), 409, 'version_conflict')
      assertError(await archive(t1, form.id, ifMatch(7)), 409, 'version_conflict')
    })
  })

  // --- Çapraz kurum ----------------------------------------------------------------------------

  test('IST-002, DOM-ILT-037: başka kurumun formu olmayan kimlikle aynı 404, B değişmez', async () => {
    const a = await institution()
    const b = await institution({}, ONLY_B)
    const t1 = await teacher(a.id, 't1')
    const anne = (await mother(a.id)).cookie
    const calls = [
      (id: string) => read(a.adminCookie, `/api/v1/permission-forms/${id}`),
      (id: string) => patch(t1, id, { title: 'Yeni başlık' }, ifMatch(1)),
      (id: string) => closeForm(t1, id, ifMatch(1)),
      (id: string) => archive(t1, id, ifMatch(1)),
      (id: string) => decide(anne, id, APPROVE),
    ]
    await unchanged(a.id, () =>
      unchanged(b.id, async () => {
        for (const call of calls) {
          const foreign = await call('pf-only-b')
          assertError(foreign, 404, 'not_found')
          assert.deepEqual(outcome(foreign), outcome(await call('pf-yok')))
        }
        const list = await read(a.adminCookie, '/api/v1/permission-forms?pageSize=100')
        assert.equal(list.statusCode, 200, list.body)
        assert.ok(!ids(list).includes('pf-only-b'))
      }),
    )
    // Aynı istek B'nin kendi oturumunda çalışır: 404 rol ya da gövdeden gelmiyor.
    assert.equal((await read(b.adminCookie, '/api/v1/permission-forms/pf-only-b')).statusCode, 200)
  })

  test('IST-002: gövdedeki institutionId 400, kayıt yazılmaz', async () => {
    const a = await institution()
    const b = await institution()
    const t1 = await teacher(a.id, 't1')
    await unchanged(a.id, () =>
      unchanged(b.id, async () => {
        assertError(await create(t1, { ...FORM, institutionId: b.id }), 400, 'validation_failed')
      }),
    )
  })
})
