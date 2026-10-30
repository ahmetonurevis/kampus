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
  type InstitutionOverrides,
} from './support/app.ts'

/**
 * Resmî not uçları (`POST /grades`, `PATCH /grades/:gradeId`; DOM-AKD-004, DOM-AKD-051,
 * DOM-AKD-054). Yetki core `authorize('grade.record' | 'grade.update')`'tadır; her test kendi
 * kurumunu örnek veri kesitiyle kurar.
 */

const DAY = '2026-10-06'
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

/** s1 (c1, 7. sınıf) matematik: dersin öğretmeni t1, Türkçe öğretmeni t2. */
const MATH_TEACHER = SEED.assignments.find((a) => a.classId === 'c1' && a.subjectId === 'math')
const TURKISH_TEACHER = SEED.assignments.find(
  (a) => a.classId === 'c1' && a.subjectId === 'turkish',
)
if (!MATH_TEACHER || !TURKISH_TEACHER) throw new Error('örnek veride c1 ders atamaları eksik')

const GRADE = {
  studentId: 's1',
  subjectId: 'math',
  term: 1,
  assessmentType: 'sinav',
  date: DAY,
  score: 85,
  topic: 'Rasyonel sayılar',
}
const REASON = 'Okuma hatası düzeltildi'
/** Doğrudan eklenen not (öğretmen t1, 7-A matematik). */
const BASE_GRADE = {
  studentId: 's1',
  subjectId: 'math',
  subject: 'Matematik',
  title: 'Matematik · 1. dönem 1. sınav',
  topic: '',
  score: 70,
  date: '2026-10-01T09:00:00.000Z',
  assessmentType: 'sinav',
  term: 1,
  sequence: 1,
  teacherId: 't1',
}

describe('resmî not uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0
  const key = () => ({ 'idempotency-key': `test-grade-${String(++serial).padStart(4, '0')}` })

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db)
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
    return signInAs(app, await createMember(app, institutionId, role, links))
  }

  const teacher = (institutionId: string, teacherId = MATH_TEACHER?.teacherId ?? '') =>
    member(institutionId, 'ogretmen', [{ kind: 'teacher', recordId: teacherId }])

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

  const record = (cookie: string | null, body: unknown, headers: Record<string, string> = key()) =>
    send('POST', '/api/v1/grades', cookie, body, headers)
  const correct = (
    cookie: string | null,
    gradeId: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) => send('PATCH', `/api/v1/grades/${gradeId}`, cookie, body, headers)

  const read = (cookie: string, url: string) =>
    app.inject({ method: 'GET', url, headers: { origin: TEST_ORIGIN, cookie } })

  function assertError(
    response: Awaited<ReturnType<typeof send>>,
    statusCode: number,
    code?: string,
  ) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function grades(institutionId: string) {
    return loadRecords(db, institutionId, ['grades'])
  }

  /** Öğretmenin girdiği notun kimliği. */
  async function created(cookie: string) {
    const response = await record(cookie, GRADE)
    assert.equal(response.statusCode, 201, response.body)
    const id: string = response.json().data.entity.id
    return id
  }

  async function audits(institutionId: string, action: string) {
    return db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))
  }

  describe('POST /grades', () => {
    test('DOM-AKD-054: atandığı sınıf ve dersin öğretmeni not girer 201 + Location; gövdedeki institutionId etkisiz', async () => {
      const a = await institution()
      const other = await institution()
      const cookie = await teacher(a.id)
      const response = await record(cookie, { ...GRADE, institutionId: other.id })
      assert.equal(response.statusCode, 201, response.body)
      const data = response.json().data
      assert.equal(data.entity.collection, 'grades')
      assert.deepEqual(data.changes, { inserted: 1, updated: 0, archived: 0, restored: 0 })
      assert.equal(response.headers.location, `/api/v1/collections/grades/${data.entity.id}`)
      const stored = await findRecord(db, a.id, 'grades', data.entity.id)
      assert.equal(stored?.data.score, 85)
      assert.equal(stored?.data.assessmentType, 'sinav')
      assert.equal(stored?.data.term, 1)
      assert.equal(stored?.data.sequence, 1)
      assert.equal(stored?.data.teacherId, MATH_TEACHER?.teacherId)
      // Notun verildiği sınıf saklanır; düzeltme yetkisi ona bağlıdır.
      assert.equal(stored?.data.classId, 'c1')
      assert.equal((await grades(other.id)).length, 0)
    })

    test('denetim kaydına not değeri değil alan adı yazılır', async () => {
      const a = await institution()
      const id = await created(await teacher(a.id))
      const [entry] = await audits(a.id, 'grade.record')
      assert.equal(entry?.entityType, 'grades')
      assert.equal(entry?.entityId, id)
      const changes = entry?.changes as { fields: string[] }
      assert.ok(changes.fields.includes('score'))
      const text = JSON.stringify(entry?.changes)
      assert.ok(!text.includes('85') && !text.includes('Rasyonel'), text)
    })

    test('Idempotency-Key: anahtarsız 400; aynı anahtarla tekrar aynı yanıt, farklı gövde 422; not bir kez yazılır', async () => {
      const a = await institution()
      const cookie = await teacher(a.id)
      assertError(await record(cookie, GRADE, {}), 400, 'idempotency_key_required')
      const headers = key()
      const first = await record(cookie, GRADE, headers)
      assert.equal(first.statusCode, 201, first.body)
      const replay = await record(cookie, GRADE, headers)
      assert.equal(replay.statusCode, 201, replay.body)
      assert.equal(replay.headers['idempotent-replayed'], 'true')
      assert.equal(replay.headers.location, first.headers.location)
      assert.deepEqual(replay.json(), first.json())
      assertError(
        await record(cookie, { ...GRADE, score: 90 }, headers),
        422,
        'idempotency_key_reused',
      )
      assert.equal((await grades(a.id)).length, 1)
      // Başka anahtarla aynı gün aynı türde ikinci not iş kuralıyla reddedilir.
      assertError(await record(cookie, GRADE), 409, 'grade_duplicate')
      assert.equal((await grades(a.id)).length, 1)
    })

    test('doğrulama hatasında 400, kural reddinde 422; hiçbir kayıt ve denetim yazılmaz', async () => {
      const a = await institution()
      const cookie = await teacher(a.id)
      for (const body of [
        { ...GRADE, score: 101 },
        { ...GRADE, score: undefined },
        { ...GRADE, assessmentType: 'yazili' },
        { ...GRADE, date: '2026-02-30' },
      ])
        assertError(await record(cookie, body), 400, 'validation_failed')
      // Saat uygulamanındır (FIXED_NOW): ertesi gün gelecektir.
      assertError(await record(cookie, { ...GRADE, date: '2026-10-07' }), 422, 'grade_future_date')
      assert.equal((await grades(a.id)).length, 0)
      assert.equal((await audits(a.id, 'grade.record')).length, 0)
    })

    test('DOM-AKD-054: başka dersin veya sınıfın öğretmeni 403 grade_assignment_forbidden', async () => {
      const a = await institution()
      const math = await teacher(a.id)
      const turkish = await teacher(a.id, TURKISH_TEACHER?.teacherId)
      assertError(
        await record(math, { ...GRADE, subjectId: 'turkish' }),
        403,
        'grade_assignment_forbidden',
      )
      assertError(await record(turkish, GRADE), 403, 'grade_assignment_forbidden')
      assert.equal((await grades(a.id)).length, 0)
    })

    test('yönetici yeni not giremez; ön büro, veli ve öğrenci 403; oturumsuz 401', async () => {
      const a = await institution()
      assertError(await record(a.adminCookie, GRADE), 403)
      for (const [role, links] of [
        ['onburo', []],
        ['veli', [{ kind: 'child', recordId: 's1' }]],
        ['ogrenci', [{ kind: 'student', recordId: 's1' }]],
      ] as const)
        assertError(await record(await member(a.id, role, [...links]), GRADE), 403)
      assertError(await record(null, GRADE), 401)
      assert.equal((await grades(a.id)).length, 0)
    })

    test('DOM-YTK-040: akademik modül kapalıyken 403 module_disabled', async () => {
      const a = await institution({ enabledModules: { ...SEED.modules, academic: false } })
      assertError(await record(await teacher(a.id), GRADE), 403, 'module_disabled')
      assert.equal((await grades(a.id)).length, 0)
    })

    test('DOM-AKD-004: dil okulunda resmî not yoktur 422 official_grades_school_only', async () => {
      const a = await institution({ type: 'language_school' })
      assertError(await record(await teacher(a.id), GRADE), 422, 'official_grades_school_only')
      assert.equal((await grades(a.id)).length, 0)
    })
  })

  describe('PATCH /grades/:gradeId', () => {
    test('DOM-AKD-051: öğretmen gerekçeyle düzeltir; eski puan geçmişte, denetimde değer ve gerekçe yok', async () => {
      const a = await institution()
      const cookie = await teacher(a.id)
      const id = await created(cookie)
      const response = await correct(cookie, id, { score: 92, reason: REASON })
      assert.equal(response.statusCode, 200, response.body)
      assert.deepEqual(response.json().data.entity, { collection: 'grades', id })
      const stored = await findRecord(db, a.id, 'grades', id)
      assert.equal(stored?.version, 2)
      assert.equal(stored?.data.score, 92)
      const [correction] = stored?.data.corrections as { previousScore: number; reason: string }[]
      assert.equal(correction?.previousScore, 85)
      assert.equal(correction?.reason, REASON)
      const [entry] = await audits(a.id, 'grade.update')
      assert.equal(entry?.entityId, id)
      // `updatedAt` aynı saatte (FIXED_NOW) değişmez; değişen alanlar adıyla yazılır.
      assert.deepEqual((entry?.changes as { fields: string[] }).fields, ['corrections', 'score'])
      const text = JSON.stringify(entry?.changes)
      assert.ok(!text.includes('92') && !text.includes(REASON), text)
    })

    test('yönetici gerekçeli düzeltme 200, gerekçesiz 400; eski sürüm 409; aynı puan 409', async () => {
      const a = await institution()
      const id = await created(await teacher(a.id))
      assertError(await correct(a.adminCookie, id, { score: 70 }), 400, 'validation_failed')
      assertError(
        await correct(a.adminCookie, id, { score: 70, reason: REASON }, { 'if-match': '"9"' }),
        409,
        'version_conflict',
      )
      assert.equal((await findRecord(db, a.id, 'grades', id))?.version, 1)
      const ok = await correct(
        a.adminCookie,
        id,
        { score: 70, reason: REASON },
        { 'if-match': '"1"' },
      )
      assert.equal(ok.statusCode, 200, ok.body)
      assertError(
        await correct(a.adminCookie, id, { score: 70, reason: REASON }, { 'if-match': '"1"' }),
        409,
        'version_conflict',
      )
      assertError(
        await correct(a.adminCookie, id, { score: 70, reason: REASON }),
        409,
        'grade_unchanged',
      )
      const stored = await findRecord(db, a.id, 'grades', id)
      assert.equal(stored?.version, 2)
      assert.equal(stored?.data.score, 70)
    })

    test('başka dersin öğretmeni 404 (DOM-YTK-002); ön büro, veli ve öğrenci 403; not değişmez', async () => {
      const a = await institution()
      const id = await created(await teacher(a.id))
      const body = { score: 50, reason: REASON }
      // Başka branşın notu öğretmenin kapsamında değildir: varlığı sızdırılmaz (DOM-YTK-002).
      assertError(
        await correct(await teacher(a.id, TURKISH_TEACHER?.teacherId), id, body),
        404,
        'not_found',
      )
      for (const [role, links] of [
        ['onburo', []],
        ['veli', [{ kind: 'child', recordId: 's1' }]],
        ['ogrenci', [{ kind: 'student', recordId: 's1' }]],
      ] as const)
        assertError(await correct(await member(a.id, role, [...links]), id, body), 403)
      assertError(await correct(null, id, body), 401)
      assert.equal((await findRecord(db, a.id, 'grades', id))?.version, 1)
    })

    test('olmayan not 404; başka kurumun notu 404 ve B değişmez; modül kapalı 403', async () => {
      const a = await institution()
      const b = await institution()
      const foreign = await created(await teacher(b.id))
      const body = { score: 60, reason: REASON }
      assertError(await correct(a.adminCookie, 'test-g-yok', body), 404, 'not_found')
      assertError(await correct(a.adminCookie, foreign, body), 404, 'not_found')
      const stored = await findRecord(db, b.id, 'grades', foreign)
      assert.equal(stored?.version, 1)
      assert.equal(stored?.data.score, 85)
      const closed = await institution({ enabledModules: { ...SEED.modules, academic: false } })
      assertError(await correct(closed.adminCookie, foreign, body), 403, 'module_disabled')
    })
  })
  describe('düzeltme geçmişinin görünürlüğü ve sınıf değiştiren öğrenci', () => {
    test('veli ve öğrenci not okumasında corrections yok; öğretmen ve yönetici görür', async () => {
      const a = await institution()
      const cookie = await teacher(a.id)
      const id = await created(cookie)
      assert.equal((await correct(cookie, id, { score: 91, reason: REASON })).statusCode, 200)
      const personal = [
        await member(a.id, 'veli', [{ kind: 'child', recordId: 's1' }]),
        await member(a.id, 'ogrenci', [{ kind: 'student', recordId: 's1' }]),
      ]
      for (const reader of personal) {
        const single = await read(reader, `/api/v1/collections/grades/${id}`)
        assert.equal(single.statusCode, 200, single.body)
        const record = single.json().data.record
        assert.equal(record.score, 91, 'güncel puan döner')
        assert.equal('corrections' in record, false)
        const list = await read(reader, '/api/v1/collections/grades?pageSize=100')
        assert.equal(list.statusCode, 200, list.body)
        for (const item of list.json().data) assert.equal('corrections' in item.record, false)
        assert.equal(list.body.includes(REASON), false)
        // Gerekçe metniyle arama da sonuç vermez (gizli alan aranmaz).
        const search = await read(
          reader,
          `/api/v1/collections/grades?q=${encodeURIComponent(REASON)}`,
        )
        assert.equal(search.json().meta.total, 0)
      }
      for (const reader of [cookie, a.adminCookie]) {
        const single = await read(reader, `/api/v1/collections/grades/${id}`)
        assert.equal(single.json().data.record.corrections?.[0]?.reason, REASON)
      }
    })

    /** s1 sonradan 7-B'ye (c9; matematik ve rehberlik t17) geçmiş kurum: biri c1'de verilmiş, biri sınıfsız eski not. */
    async function movedInstitution() {
      const created = await createInstitution(app)
      const moved = SEED.students.map((item) =>
        item.id === 's1' ? { ...item, classId: 'c9' } : item,
      )
      const sample = {
        ...SAMPLE,
        classes: SEED.classes.filter((item) => [...CLASS_IDS, 'c9'].includes(item.id)),
        students: moved.filter((item) => STUDENT_IDS.has(item.id)),
        assignments: SEED.assignments.filter((item) => [...CLASS_IDS, 'c9'].includes(item.classId)),
        grades: [
          { ...BASE_GRADE, id: 'test-g-moved', classId: 'c1' },
          { ...BASE_GRADE, id: 'test-g-legacy', date: '2026-10-02T09:00:00.000Z' },
        ],
      }
      await insertMissingRecords(db, created.id, rows(sample), FIXED_NOW)
      return { ...created, adminCookie: await signInAs(app, created.admin) }
    }

    test('sınıf değiştiren öğrencinin notunu eski öğretmen düzeltir; yeni sınıfın öğretmeni 403', async () => {
      const a = await movedInstitution()
      const body = { score: 64, reason: REASON }
      assertError(
        await correct(await teacher(a.id, 't17'), 'test-g-moved', body),
        403,
        'grade_assignment_forbidden',
      )
      assert.equal((await findRecord(db, a.id, 'grades', 'test-g-moved'))?.version, 1)
      const old = await correct(await teacher(a.id), 'test-g-moved', body)
      assert.equal(old.statusCode, 200, old.body)
      const ok = await correct(a.adminCookie, 'test-g-moved', { score: 66, reason: REASON })
      assert.equal(ok.statusCode, 200, ok.body)
      const stored = await findRecord(db, a.id, 'grades', 'test-g-moved')
      assert.equal(stored?.data.score, 66)
      assert.equal(stored?.data.classId, 'c1')
    })

    test('sınıfı saklanmamış eski notta yetki öğrencinin güncel sınıfına düşer', async () => {
      const a = await movedInstitution()
      const body = { score: 64, reason: REASON }
      assertError(await correct(await teacher(a.id), 'test-g-legacy', body), 404, 'not_found')
      const ok = await correct(await teacher(a.id, 't17'), 'test-g-legacy', body)
      assert.equal(ok.statusCode, 200, ok.body)
      assert.equal((await findRecord(db, a.id, 'grades', 'test-g-legacy'))?.data.score, 64)
    })
  })
})
