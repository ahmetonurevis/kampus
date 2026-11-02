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
import { files } from '../src/db/schema/files.ts'
import { recordFileCheck } from '../src/services/files.ts'
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
import { multipart, PDF, tempStorage, uploadParts } from './support/files-sample.ts'

/**
 * Ödev uçları (IST-095; docs/domain/akademik-olcme.md DOM-AKD-070…074). Her test kendi kurumunu
 * örnek veri kesitiyle kurar: 7-A (c1) ve 5-A (c2). Deniz (s1) ve Nehir (s25) 7-A'da, Ece (s2)
 * 5-A'dadır. Selin Kaya (t1) iki sınıfın matematiğine, Ahmet Yıldırım (t2) Türkçesine girer;
 * Emre Demir (t5) bu sınıflara girmez. FIXED_NOW 2026-10-06T09:00Z: hw1 (c1 matematik, t1) ve
 * hw11 (c2 matematik, t1) geçmiş, hw2 (c1 Türkçe, t2) açık. Örnek teslimler: sub-s1-hw2
 * (puansız), sub-s1-hw3 (puanlı), sub-s2-hw11 (puansız).
 */

const SEED = createSeed(FIXED_NOW)
const CLASS_IDS = ['c1', 'c2']
const STUDENT_IDS = new Set(
  SEED.students.filter((item) => CLASS_IDS.includes(item.classId)).map((item) => item.id),
)
const HOMEWORK_IDS = new Set(
  SEED.homework.filter((item) => CLASS_IDS.includes(item.classId)).map((item) => item.id),
)
type Sample = Partial<Record<CollectionName, readonly Record<string, unknown>[]>>
const SAMPLE: Sample = {
  subjects: SEED.subjects,
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => CLASS_IDS.includes(item.id)),
  students: SEED.students.filter((item) => STUDENT_IDS.has(item.id)),
  assignments: SEED.assignments.filter((item) => CLASS_IDS.includes(item.classId)),
  homework: [
    ...SEED.homework.filter((item) => HOMEWORK_IDS.has(item.id)),
    // Geç teslime kapalı, süresi dolmuş ödev (DOM-AKD-072).
    {
      id: 'hw-closed',
      classId: 'c1',
      subjectId: 'math',
      teacherId: 't1',
      subject: 'Matematik',
      title: 'Kapalı ödev',
      description: 'Süresi dolmuş ve geç teslime kapalı ödev.',
      dueDate: '2026-10-01T09:00:00.000Z',
      allowLate: false,
      createdAt: '2026-09-25T09:00:00.000Z',
    },
  ],
  submissions: SEED.submissions.filter(
    (item) => STUDENT_IDS.has(item.studentId) && HOMEWORK_IDS.has(item.homeworkId),
  ),
}

/** Yalnız B kurumunda bulunan ödev ve teslim (çapraz kurum). */
const ONLY_B: Sample = {
  homework: [
    {
      id: 'hw-only-b',
      classId: 'c1',
      subjectId: 'math',
      teacherId: 't1',
      subject: 'Matematik',
      title: 'B kurumunun ödevi',
      description: 'Yalnız B kurumunda bulunan ödev.',
      dueDate: '2026-10-20T09:00:00.000Z',
      createdAt: '2026-10-01T09:00:00.000Z',
    },
  ],
  submissions: [
    {
      id: 'sub-only-b',
      homeworkId: 'hw-only-b',
      studentId: 's1',
      note: 'B kurumunun teslimi',
      fileName: '',
      submittedAt: '2026-10-02T09:00:00.000Z',
      score: null,
      feedback: '',
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

const FUTURE_DUE = '2026-10-20T23:59:00+03:00'
const HOMEWORK = {
  classId: 'c1',
  title: 'Kesirler çalışma kâğıdı',
  description: 'Kesirlerle toplama ve çıkarma sorularını çözün.',
  dueDate: FIXED_NOW.toISOString(),
}
const NEW_HOMEWORK = { ...HOMEWORK, dueDate: FUTURE_DUE }
const GRADE = { score: 85, feedback: 'Çözüm adımların açık, tebrikler.' }

type Json = ReturnType<typeof JSON.parse>

describe('ödev uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let store: Awaited<ReturnType<typeof tempStorage>>
  let serial = 0
  const key = () => ({ 'idempotency-key': `test-homework-${String(++serial).padStart(5, '0')}` })

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

  async function institution(overrides: Partial<InstitutionOverrides> = {}, extra: Sample = {}) {
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(db, created.id, rows({ ...SAMPLE }), FIXED_NOW)
    await insertMissingRecords(db, created.id, rows(extra), FIXED_NOW)
    return { ...created, adminCookie: await signInAs(app, created.admin) }
  }
  async function member(institutionId: string, role: Role, links: MembershipLinkInput[] = []) {
    const user = await createMember(app, institutionId, role, links)
    return { ...user, cookie: await signInAs(app, user) }
  }
  const student = async (institutionId: string, studentId = 's1') =>
    (await member(institutionId, 'ogrenci', [{ kind: 'student', recordId: studentId }])).cookie
  const parent = async (institutionId: string, studentId = 's1') =>
    (await member(institutionId, 'veli', [{ kind: 'child', recordId: studentId }])).cookie
  const teacher = async (institutionId: string, teacherId: string) =>
    (await member(institutionId, 'ogretmen', [{ kind: 'teacher', recordId: teacherId }])).cookie

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
    body: unknown = NEW_HOMEWORK,
    headers: Record<string, string> = key(),
  ) => send('POST', '/api/v1/homework', cookie, body, headers)
  const patch = (cookie: string, id: string, body: unknown, headers: Record<string, string>) =>
    send('PATCH', `/api/v1/homework/${id}`, cookie, body, headers)
  const archive = (cookie: string, id: string, headers: Record<string, string>) =>
    send('DELETE', `/api/v1/homework/${id}`, cookie, undefined, headers)
  const submit = (
    cookie: string,
    id: string,
    body: unknown,
    headers: Record<string, string> = key(),
  ) => send('POST', `/api/v1/homework/${id}/submissions`, cookie, body, headers)
  const grade = (
    cookie: string,
    homeworkId: string,
    submissionId: string,
    body: unknown,
    headers: Record<string, string>,
  ) =>
    send(
      'POST',
      `/api/v1/homework/${homeworkId}/submissions/${submissionId}/grade`,
      cookie,
      body,
      headers,
    )

  function assertError(
    response: Awaited<ReturnType<typeof read>>,
    statusCode: number,
    code?: string,
  ) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }
  const outcome = (response: Awaited<ReturnType<typeof read>>) => {
    const body = response.json() as { code?: string; message?: string }
    return [response.statusCode, body.code, body.message]
  }
  const snapshot = async (institutionId: string) =>
    (await loadRecords(db, institutionId, ['homework', 'submissions'], { includeArchived: true }))
      .map((row) => [row.collection, row.id, row.version, row.archivedAt, row.data])
      .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
  /** Başarısız isteklerden sonra ödev ve teslimler (veri, sürüm, arşiv) aynı kalır. */
  async function unchanged(institutionId: string, action: () => Promise<void>) {
    const before = await snapshot(institutionId)
    await action()
    assert.deepEqual(await snapshot(institutionId), before)
  }
  const versionOf = async (institutionId: string, collection: CollectionName, id: string) => {
    const row = await findRecord(db, institutionId, collection, id)
    assert.ok(row, `${collection}/${id} yok`)
    return row.version
  }
  const ids = (response: Awaited<ReturnType<typeof read>>) =>
    (response.json().data as { id: string }[]).map((item) => item.id)

  async function uploadSubmissionFile(institutionId: string, cookie: string, name = 'odev.pdf') {
    const body = multipart(uploadParts('submission', PDF, name))
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        'content-type': body.contentType,
        'idempotency-key': key()['idempotency-key'],
      },
      payload: body.payload,
    })
    assert.equal(response.statusCode, 201, response.body)
    const id: string = response.json().data.id
    await recordFileCheck(db, store.storage, {
      institutionId,
      fileId: id,
      outcome: 'ready',
      now: FIXED_NOW,
      log: app.log,
    })
    return id
  }

  // --- Kimlik, rol, modül ----------------------------------------------------------------------

  test('oturumsuz istek 401', async () => {
    assertError(await read(null, '/api/v1/homework'), 401)
    assertError(await create(null), 401)
  })

  test('DOM-YTK-040: learning modülü kapalıyken bütün ödev uçları 403 module_disabled', async () => {
    const a = await institution({ enabledModules: { learning: false } })
    const t1 = await teacher(a.id, 't1')
    const s1 = await student(a.id)
    await unchanged(a.id, async () => {
      assertError(await read(a.adminCookie, '/api/v1/homework'), 403, 'module_disabled')
      assertError(await read(a.adminCookie, '/api/v1/homework/hw2'), 403, 'module_disabled')
      assertError(await create(t1), 403, 'module_disabled')
      assertError(await patch(t1, 'hw1', { title: 'Yeni' }, ifMatch(1)), 403, 'module_disabled')
      assertError(await archive(t1, 'hw1', ifMatch(1)), 403, 'module_disabled')
      assertError(await submit(s1, 'hw2', { note: 'Teslim' }), 403, 'module_disabled')
      assertError(await grade(t1, 'hw11', 'sub-s2-hw11', GRADE, ifMatch(1)), 403, 'module_disabled')
    })
  })

  test('DOM-AKD-070: ön büro okuyamaz, öğrenci ve veli ödev veremez, öğretmen teslim edemez (403)', async () => {
    const a = await institution()
    const frontDesk = (await member(a.id, 'onburo')).cookie
    assertError(await read(frontDesk, '/api/v1/homework'), 403, 'forbidden')
    assertError(await create(await student(a.id)), 403, 'forbidden')
    assertError(await create(await parent(a.id)), 403, 'forbidden')
    assertError(
      await submit(await teacher(a.id, 't2'), 'hw2', { note: 'Teslim' }),
      403,
      'forbidden',
    )
  })

  // --- CRUD ------------------------------------------------------------------------------------

  test('DOM-AKD-070, DOM-AKD-071: öğretmen ödev verir, okur, düzenler ve teslimsiz ödevi arşivler', async () => {
    const a = await institution()
    const t1 = await teacher(a.id, 't1')
    const created = await create(t1)
    assert.equal(created.statusCode, 201, created.body)
    const homework = created.json().data as Json
    assert.equal(created.headers.location, `/api/v1/homework/${homework.id as string}`)
    assert.equal(homework.version, 1)
    assert.equal(homework.classId, 'c1')
    assert.equal(homework.subjectId, 'math')
    assert.equal(homework.teacherId, 't1')
    assert.equal(homework.dueDate, '2026-10-20T20:59:00.000Z')
    assert.equal(homework.allowLate, true)
    assert.equal(homework.status, 'open')

    const detail = await read(t1, `/api/v1/homework/${homework.id as string}`)
    assert.equal(detail.statusCode, 200, detail.body)
    assert.deepEqual(detail.json().data.submissions, [])
    assert.deepEqual(detail.json().data.submissionCounts, { submitted: 0, graded: 0, late: 0 })

    const list = await read(t1, '/api/v1/homework?classId=c1&status=open')
    assert.equal(list.statusCode, 200, list.body)
    assert.ok(ids(list).includes(homework.id as string))
    assert.ok(!ids(list).includes('hw1'), 'süresi geçmiş ödev open süzgecinde yok')

    const edited = await patch(
      t1,
      homework.id as string,
      { title: 'Kesirler tekrar', allowLate: false },
      ifMatch(1),
    )
    assert.equal(edited.statusCode, 200, edited.body)
    assert.equal(edited.json().data.version, 2)
    assert.equal(edited.json().data.title, 'Kesirler tekrar')
    assert.equal(edited.json().data.allowLate, false)

    const archived = await archive(t1, homework.id as string, ifMatch(2))
    assert.equal(archived.statusCode, 200, archived.body)
    assertError(await read(t1, `/api/v1/homework/${homework.id as string}`), 404, 'not_found')
    const audits = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.entityId, homework.id as string)))
    assert.deepEqual(audits.map((row) => row.action).sort(), [
      'homework.archive',
      'homework.assign',
      'homework.update',
    ])
  })

  test('DOM-AKD-070: geçmiş son tarih 422, yönetici dersi seçmezse 422, sınıf ve ders düzenlenmez (400)', async () => {
    const a = await institution()
    const t1 = await teacher(a.id, 't1')
    await unchanged(a.id, async () => {
      assertError(await create(t1, HOMEWORK), 422, 'homework_due_in_past')
      assertError(await create(a.adminCookie, NEW_HOMEWORK), 422, 'homework_subject_required')
      assertError(await patch(t1, 'hw1', { classId: 'c2' }, ifMatch(1)), 400, 'validation_failed')
      assertError(await patch(t1, 'hw1', {}, ifMatch(1)), 400, 'validation_failed')
    })
    const byAdmin = await create(a.adminCookie, { ...NEW_HOMEWORK, subjectId: 'turkish' })
    assert.equal(byAdmin.statusCode, 201, byAdmin.body)
    assert.equal(byAdmin.json().data.teacherId, 't2')
  })

  test('Idempotency-Key: oluşturma ve teslimde zorunlu, aynı anahtar ilk yanıtı tekrarlar; If-Match 400', async () => {
    const a = await institution()
    const t1 = await teacher(a.id, 't1')
    await unchanged(a.id, async () => {
      assertError(await create(t1, NEW_HOMEWORK, {}), 400, 'idempotency_key_required')
      assertError(
        await create(t1, NEW_HOMEWORK, { ...key(), ...ifMatch(1) }),
        400,
        'if_match_not_supported',
      )
      assertError(
        await submit(await student(a.id), 'hw2', { note: 'Teslim' }, {}),
        400,
        'idempotency_key_required',
      )
    })
    const headers = key()
    const first = await create(t1, NEW_HOMEWORK, headers)
    const second = await create(t1, NEW_HOMEWORK, headers)
    assert.equal(first.statusCode, 201, first.body)
    assert.equal(second.statusCode, 201, second.body)
    assert.equal(second.headers['idempotent-replayed'], 'true')
    assert.deepEqual(second.json(), first.json())
    const created = (await loadRecords(db, a.id, ['homework'])).filter(
      (row) => row.data.title === NEW_HOMEWORK.title,
    )
    assert.equal(created.length, 1)
  })

  test('If-Match: düzenleme, arşiv ve puanlamada zorunlu (400); bayat sürüm 409, kayıt değişmez', async () => {
    const a = await institution()
    const t1 = await teacher(a.id, 't1')
    await unchanged(a.id, async () => {
      assertError(await patch(t1, 'hw1', { title: 'Yeni başlık' }, {}), 400, 'if_match_required')
      assertError(await archive(t1, 'hw1', {}), 400, 'if_match_required')
      assertError(await grade(t1, 'hw11', 'sub-s2-hw11', GRADE, {}), 400, 'if_match_required')
      assertError(
        await patch(t1, 'hw1', { title: 'Yeni başlık' }, ifMatch(7)),
        409,
        'version_conflict',
      )
      assertError(await archive(t1, 'hw1', ifMatch(7)), 409, 'version_conflict')
      assertError(
        await grade(t1, 'hw11', 'sub-s2-hw11', GRADE, ifMatch(7)),
        409,
        'version_conflict',
      )
    })
  })

  // --- Kapsam ----------------------------------------------------------------------------------

  test('DOM-AKD-070, DOM-AKD-071: öğretmen başka sınıfa ödev veremez, başkasının ödevini düzenleyemez', async () => {
    const a = await institution()
    const t1 = await teacher(a.id, 't1')
    const t5 = await teacher(a.id, 't5')
    await unchanged(a.id, async () => {
      // Derse girmediği sınıf.
      assertError(
        await create(t5, { ...NEW_HOMEWORK, subjectId: 'math' }),
        403,
        'homework_scope_denied',
      )
      // Girdiği sınıfın başka branşı.
      assertError(
        await create(t1, { ...NEW_HOMEWORK, subjectId: 'turkish' }),
        403,
        'homework_scope_denied',
      )
      // Aynı sınıfa giren başka öğretmenin ödevi 403; göremediği ödev 404.
      assertError(
        await patch(t1, 'hw2', { title: 'Yeni başlık' }, ifMatch(1)),
        403,
        'homework_not_owner',
      )
      assertError(await patch(t5, 'hw2', { title: 'Yeni başlık' }, ifMatch(1)), 404, 'not_found')
      assertError(await archive(t5, 'hw2', ifMatch(1)), 404, 'not_found')
    })
  })

  test('DOM-AKD-074: öğrenci yalnız kendi teslimini, veli yalnız çocuğunu, öğretmen sınıflarını görür', async () => {
    const a = await institution()
    const s1 = await student(a.id, 's1')
    const s25 = await student(a.id, 's25')
    const p1 = await parent(a.id, 's1')
    const t2 = await teacher(a.id, 't2')

    const own = await read(s1, '/api/v1/homework/hw2')
    assert.equal(own.statusCode, 200, own.body)
    const ownSubs = own.json().data.submissions as Json[]
    assert.deepEqual(
      ownSubs.map((sub) => sub.id),
      ['sub-s1-hw2'],
    )
    const other = await read(s25, '/api/v1/homework/hw2')
    assert.equal(other.statusCode, 200, other.body)
    assert.ok(
      (other.json().data.submissions as Json[]).every((sub) => sub.studentId === 's25'),
      'öğrenci başkasının teslimini görmez',
    )
    // Başka sınıfın ödevi olmayan ödevle aynı 404.
    assert.deepEqual(
      outcome(await read(s1, '/api/v1/homework/hw11')),
      outcome(await read(s1, '/api/v1/homework/hw-yok')),
    )
    assertError(await read(s1, '/api/v1/homework/hw11'), 404, 'not_found')

    const parentList = await read(p1, '/api/v1/homework?pageSize=100')
    assert.equal(parentList.statusCode, 200, parentList.body)
    const parentItems = parentList.json().data as Json[]
    assert.ok(parentItems.length > 0)
    assert.ok(
      parentItems.every((item) => item.classId === 'c1'),
      'veli yalnız çocuğunun sınıfı',
    )
    assertError(await read(p1, '/api/v1/homework/hw11'), 404, 'not_found')
    const parentDetail = await read(p1, '/api/v1/homework/hw2')
    assert.ok(
      (parentDetail.json().data.submissions as Json[]).every((sub) => sub.studentId === 's1'),
    )

    const teacherDetail = await read(t2, '/api/v1/homework/hw2')
    const c1Students = new Set(SEED.students.filter((s) => s.classId === 'c1').map((s) => s.id))
    const teacherSubs = teacherDetail.json().data.submissions as Json[]
    assert.ok(teacherSubs.some((sub) => sub.id === 'sub-s1-hw2'))
    assert.ok(teacherSubs.every((sub) => c1Students.has(sub.studentId as string)))
    assert.equal(teacherDetail.json().data.submissionCounts.submitted, teacherSubs.length)
  })

  // --- Çapraz kurum ----------------------------------------------------------------------------

  test('IST-002, DOM-AKD-074: başka kurumun ödevi ve teslimi olmayan kimlikle aynı 404, B değişmez', async () => {
    const a = await institution()
    const b = await institution({}, ONLY_B)
    const t1 = await teacher(a.id, 't1')
    const s1 = await student(a.id, 's1')
    const calls = [
      (id: string) => read(a.adminCookie, `/api/v1/homework/${id}`),
      (id: string) => patch(t1, id, { title: 'Yeni başlık' }, ifMatch(1)),
      (id: string) => archive(t1, id, ifMatch(1)),
      (id: string) => submit(s1, id, { note: 'Teslim' }),
      (id: string) =>
        grade(t1, id, id === 'hw-only-b' ? 'sub-only-b' : 'sub-yok', GRADE, ifMatch(1)),
    ]
    await unchanged(a.id, () =>
      unchanged(b.id, async () => {
        for (const call of calls) {
          const foreign = await call('hw-only-b')
          assertError(foreign, 404, 'not_found')
          assert.deepEqual(outcome(foreign), outcome(await call('hw-yok')))
        }
        const list = await read(a.adminCookie, '/api/v1/homework?pageSize=100')
        assert.equal(list.statusCode, 200, list.body)
        assert.ok(!ids(list).includes('hw-only-b'))
      }),
    )
    // Aynı istek A'nın kendi kaydında çalışır: 404 rol ya da gövdeden gelmiyor.
    assert.equal((await read(a.adminCookie, '/api/v1/homework/hw2')).statusCode, 200)
  })

  test('IST-002: gövdedeki institutionId 400, kayıt yazılmaz', async () => {
    const a = await institution()
    const b = await institution()
    const t1 = await teacher(a.id, 't1')
    await unchanged(a.id, () =>
      unchanged(b.id, async () => {
        assertError(
          await create(t1, { ...NEW_HOMEWORK, institutionId: b.id }),
          400,
          'validation_failed',
        )
      }),
    )
  })

  // --- Teslim ----------------------------------------------------------------------------------

  test('DOM-AKD-072: geç teslim işaretlenir, kapalı ödev 422, puanlanmamış teslim yenilenir, puanlı 409', async () => {
    const a = await institution()
    const s1 = await student(a.id, 's1')
    const late = await submit(s1, 'hw1', { note: 'Geç kaldım ama tamamladım.' })
    assert.equal(late.statusCode, 201, late.body)
    assert.equal(late.json().data.late, true)
    assert.equal(late.json().data.studentId, 's1')
    assert.equal(late.headers.location, '/api/v1/homework/hw1')

    await unchanged(a.id, async () => {
      assertError(await submit(s1, 'hw-closed', { note: 'Teslim' }), 422, 'homework_closed')
      assertError(await submit(s1, 'hw3', { note: 'Yeniden' }), 409, 'submission_graded')
      assertError(await submit(s1, 'hw2', {}), 400, 'validation_failed')
      assertError(await submit(s1, 'hw11', { note: 'Başka sınıf' }), 404, 'not_found')
    })

    const again = await submit(s1, 'hw2', { note: 'Güncellenmiş teslim.' })
    assert.equal(again.statusCode, 200, again.body)
    assert.equal(again.json().data.id, 'sub-s1-hw2')
    assert.equal(again.json().data.late, false)
    assert.equal(again.json().data.note, 'Güncellenmiş teslim.')
    assert.equal(again.json().data.version, 2)

    const counts = await read(s1, '/api/v1/homework/hw1')
    assert.deepEqual(counts.json().data.submissionCounts, { submitted: 1, graded: 0, late: 1 })
  })

  test('ADR 0003, DOM-AKD-072: teslime kendi dosyası bağlanır; başkasının ve başka kurumun dosyası 422, kayıt değişmez', async () => {
    const a = await institution()
    const b = await institution()
    const s1 = await student(a.id, 's1')
    const s25 = await student(a.id, 's25')
    const foreignStudent = await student(b.id, 's1')
    const own = await uploadSubmissionFile(a.id, s1, 'deniz-odev.pdf')
    const others = await uploadSubmissionFile(a.id, s25)
    const foreign = await uploadSubmissionFile(b.id, foreignStudent)

    for (const fileId of [others, foreign])
      await unchanged(a.id, async () => {
        assertError(await submit(s1, 'hw2', { fileIds: [fileId] }), 422, 'file_unavailable')
        // Bir dosya reddedilirse geçerli dosya da bağlanmaz.
        assertError(await submit(s1, 'hw2', { fileIds: [own, fileId] }), 422, 'file_unavailable')
      })
    const unattached = await db.select().from(files).where(eq(files.id, own))
    assert.equal(unattached[0]?.attachedId, null)

    const submitted = await submit(s1, 'hw2', { note: 'Dosyam ekte.', fileIds: [own] })
    assert.equal(submitted.statusCode, 200, submitted.body)
    assert.deepEqual(submitted.json().data.fileIds, [own])
    assert.equal(submitted.json().data.fileName, 'deniz-odev.pdf')
    const [row] = await db.select().from(files).where(eq(files.id, own))
    assert.equal(row?.attachedType, 'homework_submission')
    assert.equal(row?.attachedId, 'sub-s1-hw2')

    // Bağlı dosya teslimi okuyabilene açılır: ödevin öğretmeni okur, başka öğrenci 404.
    const t2 = await teacher(a.id, 't2')
    assert.equal((await read(t2, `/api/v1/files/${own}`)).statusCode, 200)
    assertError(await read(s25, `/api/v1/files/${own}`), 404, 'not_found')
  })

  // --- Puanlama --------------------------------------------------------------------------------

  test('DOM-AKD-073: ödevin öğretmeni puanlar; öğrenci ve 18 yaş altı veli homework_graded bildirimi alır', async () => {
    const a = await institution()
    const t1 = await teacher(a.id, 't1')
    const t2 = await teacher(a.id, 't2')
    const version = await versionOf(a.id, 'submissions', 'sub-s2-hw11')
    await unchanged(a.id, async () => {
      assertError(
        await grade(t2, 'hw11', 'sub-s2-hw11', GRADE, ifMatch(version)),
        403,
        'homework_not_owner',
      )
      assertError(
        await grade(t1, 'hw11', 'sub-s2-hw11', { ...GRADE, score: 101 }, ifMatch(version)),
        400,
        'validation_failed',
      )
      // Başka ödevin teslimi.
      assertError(await grade(t1, 'hw1', 'sub-s2-hw11', GRADE, ifMatch(version)), 404, 'not_found')
    })

    const graded = await grade(t1, 'hw11', 'sub-s2-hw11', GRADE, ifMatch(version))
    assert.equal(graded.statusCode, 200, graded.body)
    assert.equal(graded.json().data.score, 85)
    assert.equal(graded.json().data.feedback, GRADE.feedback)
    assert.equal(graded.json().data.version, version + 1)
    assert.ok(graded.json().data.gradedAt)

    const notifications = (await loadRecords(db, a.id, ['notifications'])).map((row) => row.data)
    const sent = notifications.filter((n) => n.kind === 'homework_graded')
    assert.deepEqual(sent.map((n) => [n.audience, n.studentId, (n.subject as Json).id]).sort(), [
      ['parent', 's2', 'hw11'],
      ['student', 's2', 'hw11'],
    ])

    // Öğrenci puanını görür; puanlanan teslim yeniden teslim edilemez.
    const s2 = await student(a.id, 's2')
    const detail = await read(s2, '/api/v1/homework/hw11')
    assert.equal(detail.json().data.submissions[0].score, 85)
    assertError(await submit(s2, 'hw11', { note: 'Yeniden' }), 409, 'submission_graded')
  })

  test('DOM-AKD-071: teslim alınmış ödev arşivlenmez (409), teslim korunur', async () => {
    const a = await institution()
    const t2 = await teacher(a.id, 't2')
    const version = await versionOf(a.id, 'homework', 'hw2')
    await unchanged(a.id, async () => {
      assertError(await archive(t2, 'hw2', ifMatch(version)), 409, 'homework_has_submissions')
      assertError(
        await archive(a.adminCookie, 'hw2', ifMatch(version)),
        409,
        'homework_has_submissions',
      )
    })
  })
})
