import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { insertMissingRecords, loadRecords } from '../src/db/records.ts'
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
 * Etkinlik değişikliği izni düşürür, iptal velilere bildirilir (OG-254; docs/domain/iletisim-ve-veli.md
 * DOM-ILT-032, DOM-ILT-037). Her test kendi kurumunu kurar: 7-A (c1) ve 5-A (c2). Deniz (s1) ve
 * Nehir (s25) 7-A'da, Ece (s2) 5-A'dadır; anne Deniz ile Ece'nin, baba yalnız Deniz'in velisidir.
 * Selin Kaya (t1) iki sınıfın rehber öğretmeni, Ahmet Yıldırım (t2) 7-A'ya girer ama rehber değildir,
 * Emre Demir (t5) bu sınıflara girmez. FIXED_NOW 2026-10-06T09:00Z (salı).
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

const EVENT = {
  topic: 'event',
  title: 'Müze gezisi',
  description: 'Cuma günü İstanbul Arkeoloji Müzesi gezisi.',
  deadline: '2026-10-09',
  classIds: ['c1'],
  eventDate: '2026-10-16',
  eventTime: '09:30',
  location: 'Arkeoloji Müzesi',
  transport: 'Okul servisi',
  fee: 25000,
}
const APPROVE = { studentId: 's1', decision: 'approved' }
const REJECT = { studentId: 's1', decision: 'rejected' }
const RECONSENT = 'permission_form_reconsent'
const CANCELLED = 'permission_form_cancelled'

type Json = ReturnType<typeof JSON.parse>

describe('etkinlik değişikliği ve iptal (DOM-ILT-032)', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0
  const key = () => ({
    'idempotency-key': `test-event-change-${String(++serial).padStart(5, '0')}`,
  })

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
  const teacher = async (institutionId: string, teacherId: string) =>
    (await member(institutionId, 'ogretmen', [{ kind: 'teacher', recordId: teacherId }])).cookie
  const mother = (institutionId: string) =>
    member(institutionId, 'veli', [
      { kind: 'child', recordId: 's1' },
      { kind: 'child', recordId: 's2' },
    ])
  const father = (institutionId: string) =>
    member(institutionId, 'veli', [{ kind: 'child', recordId: 's1' }])
  const neighbour = (institutionId: string) =>
    member(institutionId, 'veli', [{ kind: 'child', recordId: 's25' }])

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
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(cookie === null ? {} : { cookie }),
        ...headers,
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    })
  }
  const read = (cookie: string, url: string) =>
    app.inject({ method: 'GET', url, headers: { origin: TEST_ORIGIN, cookie } })
  const ifMatch = (version: number): Record<string, string> => ({
    'if-match': `"${String(version)}"`,
  })
  const create = (cookie: string, body: unknown = EVENT) =>
    send('POST', '/api/v1/permission-forms', cookie, body, key())
  const patch = (cookie: string, id: string, body: unknown, version: number) =>
    send('PATCH', `/api/v1/permission-forms/${id}`, cookie, body, ifMatch(version))
  const cancel = (cookie: string | null, id: string, headers: Record<string, string>) =>
    send('POST', `/api/v1/permission-forms/${id}/cancel`, cookie, undefined, headers)
  const decide = (cookie: string, id: string, body: unknown) =>
    send('POST', `/api/v1/permission-forms/${id}/decisions`, cookie, body, key())

  async function opened(cookie: string, body: unknown = EVENT): Promise<Json> {
    const response = await create(cookie, body)
    assert.equal(response.statusCode, 201, response.body)
    return response.json().data
  }
  async function detail(cookie: string, id: string): Promise<Json> {
    const response = await read(cookie, `/api/v1/permission-forms/${id}`)
    assert.equal(response.statusCode, 200, response.body)
    return response.json().data
  }
  async function approved(cookie: string, id: string, body: unknown = APPROVE) {
    const response = await decide(cookie, id, body)
    assert.equal(response.statusCode, 201, response.body)
  }
  const studentOf = (form: Json, studentId: string): Json => {
    const found = (form.students as Json[]).find((item) => item.studentId === studentId)
    assert.ok(found, `${studentId} formda yok`)
    return found
  }
  async function change(cookie: string, id: string, body: unknown): Promise<Json> {
    const current = await detail(cookie, id)
    const response = await patch(cookie, id, body, current.version as number)
    assert.equal(response.statusCode, 200, response.body)
    return response.json().data
  }

  type Response = Awaited<ReturnType<typeof read>>
  function assertError(response: Response, statusCode: number, code?: string) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }
  const notices = async (institutionId: string, kind: string) =>
    (await loadRecords(db, institutionId, ['notifications']))
      .map((row) => row.data)
      .filter((n) => n.kind === kind)
  const recipients = async (institutionId: string, kind: string) =>
    (await notices(institutionId, kind)).map((n) => [n.audience, n.studentId] as const).sort()
  /** Bildirim merkezinden görünen belirli türdeki bildirimler: tür ve öğrenci. */
  async function seen(cookie: string, kind: string) {
    const response = await read(cookie, '/api/v1/notifications')
    assert.equal(response.statusCode, 200, response.body)
    return (response.json().data as Json[])
      .filter((n) => n.kind === kind)
      .map((n) => [n.kind, n.studentId])
  }
  /** Form, karar ve bildirim satırları (sürüm ve arşiv dahil): başarısız istek bunu değiştirmez. */
  const snapshot = async (institutionId: string) =>
    (
      await loadRecords(
        db,
        institutionId,
        ['permissionForms', 'permissionDecisions', 'notifications'],
        { includeArchived: true },
      )
    )
      .map((row) => [row.collection, row.id, row.version, row.archivedAt, row.data])
      .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
  async function unchanged(institutionId: string, action: () => Promise<void>) {
    const before = await snapshot(institutionId)
    await action()
    assert.deepEqual(await snapshot(institutionId), before)
  }
  async function setBond(
    institution: { adminCookie: string },
    membershipId: string,
    body: Record<string, unknown>,
  ) {
    const bonds = await read(institution.adminCookie, '/api/v1/students/s1/guardians')
    assert.equal(bonds.statusCode, 200, bonds.body)
    const own = (bonds.json().data as Json[]).find((bond) => bond.membershipId === membershipId)
    assert.ok(own)
    const changed = await send(
      'PATCH',
      `/api/v1/students/s1/guardians/${own.id as string}`,
      institution.adminCookie,
      body,
      ifMatch(own.rowVersion as number),
    )
    assert.equal(changed.statusCode, 200, changed.body)
  }

  // --- Ayrıntı ---------------------------------------------------------------------------------

  test('DOM-ILT-032: form etkinlik ayrıntısıyla açılır ve her okuyana döner; ayrıntısız form null taşır', async () => {
    const a = await institution()
    const t1 = await teacher(a.id, 't1')
    const form = await opened(t1)
    assert.deepEqual(
      [form.eventDate, form.eventTime, form.location, form.transport, form.fee],
      ['2026-10-16', '09:30', 'Arkeoloji Müzesi', 'Okul servisi', 25000],
    )
    assert.equal(form.detailsRevision, 0)
    assert.equal(form.cancelledAt, null)
    const parent = (await mother(a.id)).cookie
    const seenByParent = await detail(parent, form.id)
    assert.equal(seenByParent.location, 'Arkeoloji Müzesi')
    assert.equal(seenByParent.fee, 25000)
    const plain = await opened(t1, { ...EVENT, topic: 'trip', eventDate: undefined })
    assert.equal(plain.eventDate, null)
  })

  test('DOM-ILT-032: geçmiş etkinlik günü, geçersiz saat ve eksi ücret 4xx; kayıt değişmez', async () => {
    const a = await institution()
    const t1 = await teacher(a.id, 't1')
    const form = await opened(t1)
    await unchanged(a.id, async () => {
      assertError(
        await create(t1, { ...EVENT, eventDate: '2026-10-05' }),
        422,
        'permission_form_event_in_past',
      )
      assertError(await create(t1, { ...EVENT, eventTime: '25:61' }), 400)
      assertError(await create(t1, { ...EVENT, fee: -5 }), 400)
      assertError(
        await patch(t1, form.id, { eventDate: '2026-10-05' }, 1),
        422,
        'permission_form_event_in_past',
      )
      assertError(await patch(t1, form.id, { fee: 12.5 }, 1), 400)
    })
  })

  // --- Düşme -----------------------------------------------------------------------------------

  test('DOM-ILT-032: ayrıntı değişince onay ve ret düşer, satırlar kalır, yalnız kararı olan öğrencinin velisine bildirim gider', async () => {
    const a = await institution()
    const t1 = await teacher(a.id, 't1')
    const anne = await mother(a.id)
    const baba = await father(a.id)
    const komsu = await neighbour(a.id)
    const form = await opened(t1)
    await approved(anne.cookie, form.id)
    await approved(baba.cookie, form.id, REJECT)
    assert.equal(studentOf(await detail(a.adminCookie, form.id), 's1').status, 'rejected')

    const updated = await change(t1, form.id, { eventTime: '11:00' })
    assert.equal(updated.eventTime, '11:00')
    assert.equal(updated.detailsRevision, 1)

    const after = await detail(a.adminCookie, form.id)
    const s1 = studentOf(after, 's1')
    assert.equal(s1.status, 'pending')
    assert.deepEqual(after.counts, {
      pending: C1_STUDENTS.length,
      approved: 0,
      rejected: 0,
      total: C1_STUDENTS.length,
    })
    // Geçmiş korunur: iki karar satırı yerinde, düştü olarak işaretli.
    assert.deepEqual((s1.decisions as Json[]).map((d) => [d.decision, d.current]).sort(), [
      ['approved', false],
      ['rejected', false],
    ])
    assert.equal((await loadRecords(db, a.id, ['permissionDecisions'])).length, 2)
    // Yalnız Deniz'in velilerine (s1) bildirim; kararı olmayan öğrencilere ve komşuya yok.
    assert.deepEqual(await recipients(a.id, RECONSENT), [['parent', 's1']])
    assert.deepEqual(await seen(anne.cookie, RECONSENT), [[RECONSENT, 's1']])
    assert.deepEqual(await seen(baba.cookie, RECONSENT), [[RECONSENT, 's1']])
    assert.deepEqual(await seen(komsu.cookie, RECONSENT), [])
    // Veli kendi düşmüş kararını görür ve yeniden karar verir: yeni sürümde yeni satır.
    const own = studentOf(await detail(anne.cookie, form.id), 's1')
    assert.equal(own.status, 'pending')
    assert.deepEqual(
      (own.decisions as Json[]).map((d) => d.current),
      [false],
    )
    await approved(anne.cookie, form.id)
    assert.equal(studentOf(await detail(a.adminCookie, form.id), 's1').status, 'approved')
    assert.equal((await loadRecords(db, a.id, ['permissionDecisions'])).length, 3)
  })

  test('DOM-ILT-032: gün, saat, yer, ulaşım ve ücretin her biri izni düşürür', async () => {
    const a = await institution()
    const t1 = await teacher(a.id, 't1')
    const anne = await mother(a.id)
    const form = await opened(t1)
    const patches: Record<string, unknown>[] = [
      { eventDate: '2026-10-20' },
      { eventTime: '10:15' },
      { location: 'Resim Müzesi' },
      { transport: 'Veliler getirir' },
      { fee: 0 },
    ]
    let revision = 0
    for (const body of patches) {
      await approved(anne.cookie, form.id)
      const updated = await change(t1, form.id, body)
      revision += 1
      assert.equal(updated.detailsRevision, revision, JSON.stringify(body))
      assert.equal(studentOf(await detail(a.adminCookie, form.id), 's1').status, 'pending')
    }
    assert.equal((await notices(a.id, RECONSENT)).length, patches.length)
  })

  test('DOM-ILT-032: başlık, açıklama, son gün düzeltmesi ve aynı değerin yeniden yazılması izni düşürmez', async () => {
    const a = await institution()
    const t1 = await teacher(a.id, 't1')
    const anne = await mother(a.id)
    const form = await opened(t1)
    await approved(anne.cookie, form.id)
    const updated = await change(t1, form.id, {
      title: 'Arkeoloji gezisi',
      description: 'Güncel açıklama.',
      deadline: '2026-10-10',
    })
    assert.equal(updated.detailsRevision, 0)
    const same = await change(t1, form.id, {
      eventDate: '2026-10-16',
      eventTime: '09:30',
      location: 'Arkeoloji Müzesi',
      transport: 'Okul servisi',
      fee: 25000,
    })
    assert.equal(same.detailsRevision, 0)
    assert.equal(studentOf(await detail(a.adminCookie, form.id), 's1').status, 'approved')
    assert.deepEqual(await notices(a.id, RECONSENT), [])
  })

  test('DOM-ILT-032: mükerrer güncelleme ikinci bildirim yazmaz; ret de yeniden istenir', async () => {
    const a = await institution()
    const t1 = await teacher(a.id, 't1')
    const anne = await mother(a.id)
    const form = await opened(t1)
    await approved(anne.cookie, form.id, REJECT)
    await change(t1, form.id, { location: 'Resim Müzesi' })
    await change(t1, form.id, { location: 'Resim Müzesi' })
    assert.deepEqual(await recipients(a.id, RECONSENT), [['parent', 's1']])
  })

  test('DOM-ILT-032, DOM-ILT-037: velayeti kalkan velinin kararı düşse de yeniden izin istenmez', async () => {
    const a = await institution()
    const t1 = await teacher(a.id, 't1')
    const anne = await mother(a.id)
    await father(a.id) // öğrencinin velayetli kalan ikinci velisi: son velayet kaldırılamaz
    const form = await opened(t1)
    await approved(anne.cookie, form.id)
    await setBond(a, anne.membershipId, { custody: 'none' })
    assert.equal(studentOf(await detail(a.adminCookie, form.id), 's1').status, 'pending')
    await change(t1, form.id, { fee: 10000 })
    assert.deepEqual(await notices(a.id, RECONSENT), [])
  })

  test('DOM-ILT-032, DOM-ILT-037: yetişkin kursiyerin izni düşünce bildirim kendisine gider, veliye gitmez', async () => {
    const a = await institution({ type: 'language_school' })
    await db.insert(studentIdentities).values({
      institutionId: a.id,
      studentId: 's1',
      academicYear: 2026,
      identityKind: 'foreign',
      identityNumber: 'YK-0001',
      birthDate: '2000-05-01',
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })
    const self = await member(a.id, 'ogrenci', [{ kind: 'student', recordId: 's1' }])
    const form = await opened(a.adminCookie, { ...EVENT, classIds: [], studentIds: ['s1'] })
    await approved(self.cookie, form.id)
    await change(a.adminCookie, form.id, { eventDate: '2026-10-21' })
    assert.deepEqual(await recipients(a.id, RECONSENT), [['student', 's1']])
  })

  test('DOM-ILT-032: kapalı form düzenlenemez, geçersiz değişiklik hiçbir kaydı ve bildirimi değiştirmez', async () => {
    const a = await institution()
    const t1 = await teacher(a.id, 't1')
    const anne = await mother(a.id)
    const form = await opened(t1)
    await approved(anne.cookie, form.id)
    await unchanged(a.id, async () => {
      assertError(
        await patch(t1, form.id, { eventDate: '2026-10-01', fee: 1 }, 1),
        422,
        'permission_form_event_in_past',
      )
      assertError(await patch(t1, form.id, { fee: 1 }, 9), 409, 'version_conflict')
      assertError(await patch(t1, 'pf-yok', { fee: 1 }, 1), 404)
      assertError(
        await patch(await teacher(a.id, 't2'), form.id, { fee: 1 }, 1),
        403,
        'permission_form_not_owner',
      )
      assertError(await patch(await teacher(a.id, 't5'), form.id, { fee: 1 }, 1), 404)
      assertError(await patch(anne.cookie, form.id, { fee: 1 }, 1), 403)
      assertError(
        await send(
          'PATCH',
          `/api/v1/permission-forms/${form.id as string}`,
          null,
          { fee: 1 },
          ifMatch(1),
        ),
        401,
      )
    })
    const closed = await send(
      'POST',
      `/api/v1/permission-forms/${form.id as string}/close`,
      t1,
      undefined,
      ifMatch(1),
    )
    assert.equal(closed.statusCode, 200, closed.body)
    await unchanged(a.id, async () => {
      assertError(await patch(t1, form.id, { fee: 1 }, 2), 422, 'permission_form_closed')
    })
  })

  // --- İptal -----------------------------------------------------------------------------------

  test('DOM-ILT-032: iptal formu kapatır; izin vermiş ve bekleyen velilere bildirim gider, reddedene gitmez', async () => {
    const a = await institution()
    const t1 = await teacher(a.id, 't1')
    const anne = await mother(a.id)
    const baba = await father(a.id)
    const komsu = await neighbour(a.id)
    const form = await opened(t1, { ...EVENT, studentIds: ['s2'] })
    await approved(anne.cookie, form.id) // s1: anne onayladı
    await approved(anne.cookie, form.id, { studentId: 's2', decision: 'rejected' }) // s2 reddedildi

    const response = await cancel(t1, form.id, ifMatch(1))
    assert.equal(response.statusCode, 200, response.body)
    const cancelled = response.json().data as Json
    assert.equal(cancelled.status, 'closed')
    assert.equal(cancelled.acceptingDecisions, false)
    assert.equal(cancelled.cancelledAt, FIXED_NOW.toISOString())
    assert.equal(cancelled.closedAt, FIXED_NOW.toISOString())

    // Hedef: c1'in 10 öğrencisi ve Ece (s2). Reddeden Ece hariç herkese (onaylı ve bekleyen).
    const expected = C1_STUDENTS.map((id) => ['parent', id] as const).sort()
    assert.deepEqual(await recipients(a.id, CANCELLED), expected)
    // Yalnız ilgili veliler: anne Deniz'i görür (Ece'ye gitmez), baba Deniz'i, komşu yalnız Nehir'i.
    assert.deepEqual(await seen(anne.cookie, CANCELLED), [[CANCELLED, 's1']])
    assert.deepEqual(await seen(baba.cookie, CANCELLED), [[CANCELLED, 's1']])
    assert.deepEqual(await seen(komsu.cookie, CANCELLED), [[CANCELLED, 's25']])
    // Kararlar silinmez.
    assert.equal((await loadRecords(db, a.id, ['permissionDecisions'])).length, 2)
    assert.equal(studentOf(await detail(a.adminCookie, form.id), 's1').status, 'approved')
  })

  test('DOM-ILT-032: iptal edilmiş form yeniden iptal edilmez, karar alınmaz ve ikinci iptal bildirim yazmaz', async () => {
    const a = await institution()
    const t1 = await teacher(a.id, 't1')
    const anne = await mother(a.id)
    const form = await opened(t1)
    const first = await cancel(a.adminCookie, form.id, ifMatch(1))
    assert.equal(first.statusCode, 200, first.body)
    const version = first.json().data.version as number
    const count = (await notices(a.id, CANCELLED)).length
    await unchanged(a.id, async () => {
      assertError(await cancel(t1, form.id, ifMatch(version)), 409, 'permission_form_cancelled')
      assertError(await decide(anne.cookie, form.id, APPROVE), 422, 'permission_form_closed')
    })
    assert.equal((await notices(a.id, CANCELLED)).length, count)
  })

  test('DOM-ILT-032: kapatılmış form iptal edilir, kapanış zamanı korunur', async () => {
    const a = await institution()
    const t1 = await teacher(a.id, 't1')
    const form = await opened(t1)
    const closed = await send(
      'POST',
      `/api/v1/permission-forms/${form.id as string}/close`,
      t1,
      undefined,
      ifMatch(1),
    )
    assert.equal(closed.statusCode, 200, closed.body)
    const response = await cancel(t1, form.id, ifMatch(2))
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.json().data.closedAt, closed.json().data.closedAt)
    assert.ok(response.json().data.cancelledAt)
  })

  test('DOM-ILT-032: iptal 401, 403, 404, 400 ve 409; başka kurumun formu 404 ve hiçbir kayıt değişmez', async () => {
    const a = await institution()
    const b = await institution()
    const t1 = await teacher(a.id, 't1')
    const form = await opened(t1)
    const foreign = await opened(await teacher(b.id, 't1'))
    const anne = await mother(a.id)
    const student = (await member(a.id, 'ogrenci', [{ kind: 'student', recordId: 's1' }])).cookie
    const frontDesk = (await member(a.id, 'onburo')).cookie
    await unchanged(a.id, async () => {
      await unchanged(b.id, async () => {
        assertError(await cancel(null, form.id, ifMatch(1)), 401)
        for (const cookie of [anne.cookie, student, frontDesk])
          assertError(await cancel(cookie, form.id, ifMatch(1)), 403)
        assertError(
          await cancel(await teacher(a.id, 't2'), form.id, ifMatch(1)),
          403,
          'permission_form_not_owner',
        )
        assertError(await cancel(await teacher(a.id, 't5'), form.id, ifMatch(1)), 404)
        assertError(await cancel(t1, 'pf-yok', ifMatch(1)), 404)
        // Başka kurumun formu: kurum oturumdan gelir, yok sayılır.
        assertError(await cancel(a.adminCookie, foreign.id, ifMatch(1)), 404)
        assertError(await cancel(t1, form.id, {}), 400, 'if_match_required')
        assertError(await cancel(t1, form.id, ifMatch(9)), 409, 'version_conflict')
      })
    })
    assert.deepEqual(await notices(b.id, CANCELLED), [])
  })

  test('DOM-YTK-040: communication modülü kapalıyken iptal 403 module_disabled', async () => {
    const a = await institution({ enabledModules: { communication: false } })
    const t1 = await teacher(a.id, 't1')
    await unchanged(a.id, async () => {
      assertError(await cancel(t1, 'pf-yok', ifMatch(1)), 403, 'module_disabled')
    })
  })
})
