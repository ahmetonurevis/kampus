import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  socialActivities,
  socialActivityHours,
} from '../src/db/schema/finance-social-activities.ts'
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
 * Lise sosyal etkinlik ve gönüllülük saati uçları (DOM-FIN-160; ON-170; DOM-AKD-021; K-535…K-537).
 * Her test kendi kurumunu kurar. FIXED_NOW 2026-10-06T09:00Z (öğretim yılı 2026–2027). Lise
 * öğrencileri s5 (9-A, c5) ve s29 (9-A), s6 (10-A, c6); s1 7-A'dadır (lise dışı). Sınıf öğretmeni
 * t5 c5…c8'in, t1 c1…c4'ün sınıf öğretmenidir.
 */

const BASE = '/api/v1/finance/social-activities'
const HOURS = `${BASE}/hours`
const MY = `${BASE}/my`
const SETTINGS = `${BASE}/settings`

const SEED = createSeed(FIXED_NOW)
const STUDENTS = ['s1', 's5', 's6', 's29']
const CLASSES = ['c1', 'c5', 'c6']

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>
type Hour = { id: string; version: number; status: string; minutes: number }

describe('DOM-FIN-160: sosyal etkinlik ve gönüllülük saati uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.170.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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
  const post = (url: string, cookie: string | null, body: unknown, key = randomUUID()) =>
    call('POST', url, cookie, body, { 'idempotency-key': key })
  const versioned = (
    method: 'POST' | 'PATCH' | 'DELETE',
    url: string,
    cookie: string,
    version: unknown,
    body?: unknown,
  ) => call(method, url, cookie, body, { 'if-match': `"${String(version)}"` })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.170.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(
      db,
      created.id,
      [
        ...SEED.teachers
          .filter((row) => ['t1', 't5'].includes(row.id))
          .map((row) => ({ collection: 'teachers' as const, id: row.id, data: { ...row } })),
        ...SEED.classes
          .filter((row) => CLASSES.includes(row.id))
          .map((row) => ({ collection: 'classes' as const, id: row.id, data: { ...row } })),
        ...SEED.students
          .filter((row) => STUDENTS.includes(row.id))
          .map((row) => ({ collection: 'students' as const, id: row.id, data: { ...row } })),
        {
          collection: 'students' as const,
          id: 'test-s-left',
          data: {
            ...SEED.students.find((row) => row.id === 's5'),
            id: 'test-s-left',
            name: 'Ayrılan Öğrenci',
            isActive: false,
          },
        },
      ],
      FIXED_NOW,
    )
    const teacher = await createMember(app, created.id, 'ogretmen', [
      { kind: 'teacher', recordId: 't5' },
    ])
    return {
      id: created.id,
      admin: await signInAs(app, created.admin),
      teacherId: teacher.membershipId,
      teacher: await signInAs(app, teacher),
    }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>

  const activityBody = (responsibleMembershipId: string, extra: Json = {}) => ({
    name: 'Huzurevi ziyareti',
    kind: 'volunteering',
    startDate: '2026-09-15',
    location: 'Kadıköy',
    responsibleMembershipId,
    organizationScope: 'external',
    organizationName: 'Kadıköy Huzurevi',
    ...extra,
  })
  const activityUrl = (id: unknown) => `${BASE}/${String(id)}`
  const entryUrl = (id: unknown, verb: string) => `${HOURS}/${String(id)}/${verb}`
  async function activity(t: Tenant, extra: Json = {}) {
    return ok(await post(BASE, t.teacher, activityBody(t.teacherId, extra)), 201)
  }
  async function enter(t: Tenant, activityId: unknown, body: Json, cookie = t.teacher) {
    return ok(
      await post(`${activityUrl(activityId)}/hours`, cookie, body),
      201,
    ) as unknown as Hour[]
  }
  async function student(t: Tenant, recordId: string) {
    return signInAs(app, await createMember(app, t.id, 'ogrenci', [{ kind: 'student', recordId }]))
  }
  const hourRows = (institutionId: string) =>
    db
      .select()
      .from(socialActivityHours)
      .where(eq(socialActivityHours.institutionId, institutionId))

  test('kimliksiz istek 401', async () => {
    assertError(await get(BASE, null), 401)
    assertError(await post(BASE, null, {}), 401)
    assertError(await get(MY, null), 401)
    assertError(await get(`${BASE}/classes`, null), 401)
  })

  test('DOM-FIN-160: dil okulunda her rol 404; modül kapalı 403; ön büro ve veli personel uçlarında 403 (K-535)', async () => {
    const language = await institution({ type: 'language_school' })
    assertError(await get(BASE, language.admin), 404)
    assertError(await get(BASE, language.teacher), 404)
    assertError(await post(BASE, language.admin, activityBody(language.teacherId)), 404)
    const languageStudent = await student(language, 's5')
    assertError(await get(MY, languageStudent), 404)
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(BASE, closed.admin), 403, 'module_disabled')
    const t = await institution()
    const desk = await signInAs(app, await createMember(app, t.id, 'onburo'))
    const parent = await signInAs(
      app,
      await createMember(app, t.id, 'veli', [{ kind: 'child', recordId: 's5' }]),
    )
    assertError(await get(BASE, desk), 403)
    assertError(await get(BASE, parent), 403)
    assertError(await get(`${BASE}/classes`, parent), 403)
    assertError(await get(MY, t.teacher), 403)
    assertError(await call('PATCH', SETTINGS, t.teacher, { totalTargetHours: 30 }), 403)
    const pupil = await student(t, 's5')
    assertError(await post(BASE, pupil, activityBody(t.teacherId)), 403)
    assertError(await get(`${MY}/activities`, parent), 403)
  })

  test('DOM-FIN-160: etkinlik açma, doğrulama, öğretmen kapsamı, düzenleme ve arşiv (K-535)', async () => {
    const t = await institution()
    const desk = await createMember(app, t.id, 'onburo')
    assertError(
      await post(BASE, t.admin, activityBody(t.teacherId, { organizationName: null })),
      400,
    )
    assertError(
      await post(BASE, t.admin, activityBody(desk.membershipId)),
      422,
      'social_activity_teacher_not_teacher',
    )
    assertError(
      await post(BASE, t.admin, activityBody('test-yok')),
      422,
      'social_activity_teacher_not_found',
    )
    assertError(
      await post(BASE, t.admin, activityBody(t.teacherId, { kind: 'club', clubId: randomUUID() })),
      422,
      'social_activity_club_not_found',
    )
    const other = await createMember(app, t.id, 'ogretmen')
    assertError(
      await post(BASE, t.teacher, activityBody(other.membershipId)),
      422,
      'social_activity_teacher_not_self',
    )
    assertError(
      await call('POST', BASE, t.admin, activityBody(t.teacherId)),
      400,
      'idempotency_key_required',
    )
    assert.equal(
      (await db.select().from(socialActivities).where(eq(socialActivities.institutionId, t.id)))
        .length,
      0,
    )
    const key = randomUUID()
    const created = ok(await post(BASE, t.teacher, activityBody(t.teacherId), key), 201)
    assert.equal(created.approvedMinutes, 0)
    assert.equal(typeof created.responsibleName, 'string')
    const replay = await post(BASE, t.teacher, activityBody(t.teacherId), key)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    const url = activityUrl(created.id)
    const otherTeacher = await signInAs(app, other)
    assertError(await get(url, otherTeacher), 404)
    assert.equal((await get(BASE, otherTeacher)).json().meta.total, 0)
    assert.equal((await get(BASE, t.teacher)).json().meta.total, 1)
    assert.equal((await get(`${BASE}?kind=club`, t.admin)).json().meta.total, 0)
    assert.equal((await get(`${BASE}?q=huzurev`, t.admin)).json().meta.total, 1)
    assertError(
      await versioned('PATCH', url, otherTeacher, created.version, { location: 'Moda' }),
      404,
    )
    assertError(
      await versioned('PATCH', url, t.teacher, created.version, {
        responsibleMembershipId: other.membershipId,
      }),
      422,
      'social_activity_teacher_not_self',
    )
    const updated = ok(
      await versioned('PATCH', url, t.teacher, created.version, {
        endDate: '2026-10-31',
        location: 'Moda',
      }),
    )
    assert.equal(updated.endDate, '2026-10-31')
    assertError(await versioned('PATCH', url, t.teacher, created.version, { location: 'X Y' }), 409)
    await enter(t, created.id, { activityDate: '2026-10-05', hours: 2, studentIds: ['s5'] })
    assertError(
      await versioned('PATCH', url, t.admin, updated.version, { endDate: '2026-10-01' }),
      422,
      'social_activity_entries_outside_range',
    )
    const pupil = await student(t, 's6')
    ok(
      await post(`${MY}/hours`, pupil, {
        activityId: created.id,
        activityDate: '2026-10-04',
        hours: 1,
      }),
      201,
    )
    assertError(
      await versioned('DELETE', url, t.admin, updated.version),
      422,
      'social_activity_has_pending',
    )
    const [pending] = (await get(`${HOURS}?status=pending`, t.admin)).json().data as Hour[]
    assert.ok(pending)
    ok(await versioned('POST', entryUrl(pending.id, 'approve'), t.teacher, pending.version))
    ok(await versioned('DELETE', url, t.admin, updated.version))
    assertError(await get(url, t.admin), 404)
    assertError(
      await post(`${url}/hours`, t.admin, {
        activityDate: '2026-10-05',
        hours: 1,
        studentIds: ['s6'],
      }),
      404,
    )
    // Arşivli etkinliğin onaylı saati öğrencinin toplamında kalır.
    const summary = ok(await get(`${BASE}/students/s5`, t.admin))
    assert.equal((summary.progress as Json).totalMinutes, 120)
    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, t.id),
          eq(auditLog.action, 'finance.social_activity.create'),
        ),
      )
    assert.equal(audits.length, 1)
    assert.ok(!JSON.stringify(audits).includes('Huzurevi'))
  })

  test('DOM-FIN-160: öğretmen girişi onaylı; lise dışı, ayrılmış, gelecek gün ve yinelenen kayıt reddedilir, hiçbiri yazılmaz (K-536)', async () => {
    const t = await institution()
    const created = await activity(t, { endDate: '2026-10-31' })
    const url = `${activityUrl(created.id)}/hours`
    const base = { activityDate: '2026-10-05', hours: 2.5, studentIds: ['s5', 's6'] }
    assertError(await post(url, t.teacher, { ...base, hours: 1.2 }), 400)
    assertError(
      await post(url, t.teacher, { ...base, studentIds: ['s5', 's1'] }),
      422,
      'social_activity_student_not_high_school',
    )
    assertError(
      await post(url, t.teacher, { ...base, studentIds: ['test-s-left'] }),
      422,
      'social_activity_student_inactive',
    )
    assertError(
      await post(url, t.teacher, { ...base, studentIds: ['test-yok'] }),
      422,
      'social_activity_student_not_found',
    )
    assertError(
      await post(url, t.teacher, { ...base, activityDate: '2026-10-07' }),
      422,
      'social_activity_date_future',
    )
    assertError(
      await post(url, t.teacher, { ...base, activityDate: '2026-09-14' }),
      422,
      'social_activity_date_outside',
    )
    assert.equal((await hourRows(t.id)).length, 0)
    const rows = await enter(t, created.id, base)
    assert.equal(rows.length, 2)
    assert.ok(rows.every((row) => row.status === 'approved' && row.minutes === 150))
    assertError(
      await post(url, t.teacher, { ...base, studentIds: ['s29', 's6'] }),
      409,
      'social_activity_entry_exists',
    )
    assert.equal((await hourRows(t.id)).length, 2)
    const otherTeacher = await signInAs(app, await createMember(app, t.id, 'ogretmen'))
    assertError(await post(url, otherTeacher, { ...base, studentIds: ['s29'] }), 404)
    assert.equal((await get(HOURS, otherTeacher)).json().meta.total, 0)
    assertError(await get(`${HOURS}?activityId=${String(created.id)}`, otherTeacher), 404)
    assert.equal((await get(`${HOURS}?studentId=s5`, t.teacher)).json().meta.total, 1)
    // Veritabanı son güvencedir: onaylı kaydın saati değişmez, kayıt silinmez.
    await assert.rejects(
      db.execute(sql`update social_activity_hours set minutes = 60 where institution_id = ${t.id}`),
      (error: Error) => String(error.cause).includes('immutable'),
    )
    await assert.rejects(
      db.execute(sql`delete from social_activity_hours where institution_id = ${t.id}`),
      (error: Error) => String(error.cause).includes('not deleted'),
    )
  })

  test('DOM-FIN-160: öğrenci beyanı onay bekler; öğretmen onaylar ya da gerekçeyle reddeder; karar değişmez (K-536)', async () => {
    const t = await institution()
    const created = await activity(t)
    const pupil = await student(t, 's5')
    const declarable = (await get(`${MY}/activities`, pupil)).json()
    assert.equal(declarable.meta.total, 1)
    const body = {
      activityId: created.id,
      activityDate: '2026-10-03',
      hours: 3,
      note: 'Kitap okuma',
    }
    assertError(await post(`${MY}/hours`, pupil, { ...body, activityId: randomUUID() }), 404)
    const pending = ok(await post(`${MY}/hours`, pupil, body), 201) as unknown as Hour
    assert.equal(pending.status, 'pending')
    assertError(await post(`${MY}/hours`, pupil, body), 409, 'social_activity_entry_exists')
    const lower = await student(t, 's1')
    assertError(
      await post(`${MY}/hours`, lower, body),
      422,
      'social_activity_student_not_high_school',
    )
    const queue = (await get(`${HOURS}?status=pending`, t.teacher)).json()
    assert.equal(queue.meta.total, 1)
    const otherTeacher = await signInAs(app, await createMember(app, t.id, 'ogretmen'))
    assertError(await versioned('POST', entryUrl(pending.id, 'approve'), otherTeacher, 1), 404)
    assertError(await versioned('POST', entryUrl(pending.id, 'approve'), t.teacher, 9), 409)
    assertError(
      await versioned('POST', entryUrl(pending.id, 'reject'), t.teacher, 1, { reason: 'kısa' }),
      400,
    )
    const rejected = ok(
      await versioned('POST', entryUrl(pending.id, 'reject'), t.teacher, 1, {
        reason: 'Katılım listesinde yok',
      }),
    )
    assert.equal(rejected.status, 'rejected')
    assert.equal(rejected.rejectionReason, 'Katılım listesinde yok')
    assertError(
      await versioned('POST', entryUrl(pending.id, 'approve'), t.teacher, rejected.version),
      409,
      'social_activity_entry_decided',
    )
    // Reddedilen beyan aynı günü yeniden açar.
    const again = ok(
      await post(`${MY}/hours`, pupil, { ...body, hours: 2 }),
      201,
    ) as unknown as Hour
    const approved = ok(
      await versioned('POST', entryUrl(again.id, 'approve'), t.admin, again.version),
    )
    assert.equal(approved.status, 'approved')
    const mine = ok(await get(MY, pupil)) as unknown as Json[]
    assert.equal(mine.length, 1)
    assert.equal((mine[0]?.progress as Json).totalMinutes, 120)
    assert.equal((mine[0]?.entries as Json[]).length, 2)
  })

  test('DOM-FIN-160: onaylı saat ters kayıtla düzeltilir; toplamdan ve belgeden düşer; aynı gün yeniden girilir (K-536, K-537)', async () => {
    const t = await institution()
    const created = await activity(t)
    const [entry] = await enter(t, created.id, {
      activityDate: '2026-10-05',
      hours: 4,
      studentIds: ['s5'],
    })
    assert.ok(entry)
    assertError(
      await versioned('POST', entryUrl(entry.id, 'reverse'), t.teacher, entry.version, {
        reason: 'x',
      }),
      400,
    )
    const reversal = ok(
      await versioned('POST', entryUrl(entry.id, 'reverse'), t.teacher, entry.version, {
        reason: 'Saat yanlış girildi',
      }),
      201,
    )
    assert.equal(reversal.kind, 'reversal')
    assert.equal(reversal.minutes, -240)
    assert.equal(reversal.reversesEntryId, entry.id)
    assertError(
      await versioned('POST', entryUrl(entry.id, 'reverse'), t.teacher, entry.version + 1, {
        reason: 'İkinci düzeltme',
      }),
      409,
      'social_activity_entry_reversed',
    )
    assertError(
      await versioned('POST', entryUrl(reversal.id, 'reverse'), t.teacher, 1, {
        reason: 'Ters kaydı düzelt',
      }),
      409,
      'social_activity_entry_not_reversible',
    )
    await enter(t, created.id, { activityDate: '2026-10-05', hours: 2, studentIds: ['s5'] })
    const summary = ok(await get(`${BASE}/students/s5`, t.teacher))
    assert.equal((summary.progress as Json).totalMinutes, 120)
    assert.equal((summary.entries as Json[]).length, 3)
    const certificate = ok(await get(`${BASE}/students/s5/certificate`, t.teacher))
    assert.equal(certificate.totalMinutes, 120)
    assert.equal((certificate.rows as Json[]).length, 1)
    assert.deepEqual(certificate.years, [{ academicYear: 2026, minutes: 120 }])
    assert.equal(certificate.status, 'behind')
    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, t.id),
          eq(auditLog.action, 'finance.social_activity.certificate'),
        ),
      )
    assert.equal(audits.length, 1)
    assert.equal(audits[0]?.entityId, 's5')
    assertError(await get(`${BASE}/students/s1/certificate`, t.admin), 404)
  })

  test('DOM-FIN-160: sınıf özeti hedefe göre durum ve eksik kalanlar; hedef ayarı sürümlü (K-537)', async () => {
    const t = await institution()
    const defaults = ok(await get(SETTINGS, t.teacher))
    assert.deepEqual(defaults, {
      totalTargetHours: 40,
      yearlyTargetHours: 10,
      isDefault: true,
      version: 0,
    })
    const created = await activity(t)
    await enter(t, created.id, { activityDate: '2026-10-01', hours: 10, studentIds: ['s5'] })
    await enter(t, created.id, { activityDate: '2026-10-02', hours: 2, studentIds: ['s29'] })
    const classes = ok(await get(`${BASE}/classes`, t.teacher)) as unknown as Json[]
    assert.deepEqual(
      classes.map((row) => row.classId),
      ['c5', 'c6'],
    )
    assert.deepEqual(classes[0], {
      classId: 'c5',
      className: '9-A',
      grade: 9,
      studentCount: 2,
      metCount: 0,
      onTrackCount: 1,
      behindCount: 1,
    })
    const behind = ok(await get(`${BASE}/classes/c5?status=behind`, t.teacher))
    assert.deepEqual(
      (behind.students as Json[]).map((row) => row.studentId),
      ['s29'],
    )
    assertError(await get(`${BASE}/classes/c1`, t.admin), 404)
    // Geçen öğretim yılında saat yok: yıllık hedef tamam değil.
    const lastYear = ok(await get(`${BASE}/classes/c5?academicYear=2025`, t.admin))
    assert.ok((lastYear.students as Json[]).every((row) => row.status === 'behind'))
    const homeroomless = await signInAs(
      app,
      await createMember(app, t.id, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }]),
    )
    assert.deepEqual(ok(await get(`${BASE}/classes`, homeroomless)), [])
    assertError(await get(`${BASE}/classes/c5`, homeroomless), 404)
    assertError(await get(`${BASE}/students/s5`, homeroomless), 404)
    assertError(await call('PATCH', SETTINGS, t.admin, { totalTargetHours: 0 }), 400)
    const saved = ok(
      await call('PATCH', SETTINGS, t.admin, { totalTargetHours: 12, yearlyTargetHours: null }),
    )
    assert.deepEqual(saved, {
      totalTargetHours: 12,
      yearlyTargetHours: null,
      isDefault: false,
      version: 1,
    })
    assertError(
      await call('PATCH', SETTINGS, t.admin, { totalTargetHours: 12 }),
      409,
      'version_conflict',
    )
    ok(await versioned('PATCH', SETTINGS, t.admin, 1, { totalTargetHours: 10 }))
    const after = ok(await get(`${BASE}/classes`, t.admin)) as unknown as Json[]
    assert.equal(after[0]?.metCount, 1)
    assert.equal(after[0]?.behindCount, 1)
    assert.equal(after[0]?.onTrackCount, 0)
  })

  test('DOM-FIN-160: veli yalnız bağlı lise çocuğunun saatini görür; öğrenci kendini görür', async () => {
    const t = await institution()
    const created = await activity(t)
    await enter(t, created.id, { activityDate: '2026-10-01', hours: 3, studentIds: ['s5', 's6'] })
    const parent = await signInAs(
      app,
      await createMember(app, t.id, 'veli', [
        { kind: 'child', recordId: 's5' },
        { kind: 'child', recordId: 's1' },
      ]),
    )
    const mine = ok(await get(MY, parent)) as unknown as Json[]
    assert.deepEqual(
      mine.map((row) => row.studentId),
      ['s5'],
    )
    assert.equal((mine[0]?.progress as Json).yearMinutes, 180)
    const lower = await student(t, 's1')
    assert.deepEqual(ok(await get(MY, lower)), [])
    assertError(await post(`${MY}/hours`, parent, {}), 403)
  })

  test('DOM-FIN-160: başka kurumun etkinliği ve kaydı 404 ve B değişmez; listede yok; institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bActivity = await activity(b)
    const [bEntry] = await enter(b, bActivity.id, {
      activityDate: '2026-10-05',
      hours: 2,
      studentIds: ['s5'],
    })
    assert.ok(bEntry)
    const bPupil = await student(b, 's6')
    const bPending = ok(
      await post(`${MY}/hours`, bPupil, {
        activityId: bActivity.id,
        activityDate: '2026-10-04',
        hours: 1,
      }),
      201,
    ) as unknown as Hour
    const bUrl = activityUrl(bActivity.id)
    assertError(await get(bUrl, a.admin), 404)
    assertError(
      await versioned('PATCH', bUrl, a.admin, bActivity.version, { location: 'Moda' }),
      404,
    )
    assertError(await versioned('DELETE', bUrl, a.admin, bActivity.version), 404)
    assertError(
      await post(`${bUrl}/hours`, a.admin, {
        activityDate: '2026-10-05',
        hours: 1,
        studentIds: ['s6'],
      }),
      404,
    )
    assertError(await versioned('POST', entryUrl(bPending.id, 'approve'), a.admin, 1), 404)
    assertError(
      await versioned('POST', entryUrl(bPending.id, 'reject'), a.admin, 1, {
        reason: 'Başka kurum',
      }),
      404,
    )
    assertError(
      await versioned('POST', entryUrl(bEntry.id, 'reverse'), a.admin, bEntry.version, {
        reason: 'Başka kurum',
      }),
      404,
    )
    const aPupil = await student(a, 's6')
    assertError(
      await post(`${MY}/hours`, aPupil, {
        activityId: bActivity.id,
        activityDate: '2026-10-04',
        hours: 1,
      }),
      404,
    )
    assertError(await get(`${HOURS}?activityId=${String(bActivity.id)}`, a.admin), 404)
    assert.equal((await get(BASE, a.admin)).json().meta.total, 0)
    assert.equal((await get(HOURS, a.admin)).json().meta.total, 0)
    assert.equal((await get(`${MY}/activities`, aPupil)).json().meta.total, 0)
    // Aynı öğrenci kimliği (s5) iki kurumda da var; A'nın özeti, belgesi ve sınıfı B'nin saatini saymaz.
    assert.equal((ok(await get(`${BASE}/students/s5`, a.admin)).progress as Json).totalMinutes, 0)
    assert.equal(ok(await get(`${BASE}/students/s5/certificate`, a.admin)).totalMinutes, 0)
    const aClasses = ok(await get(`${BASE}/classes`, a.admin)) as unknown as Json[]
    assert.ok(aClasses.every((row) => row.metCount === 0 && row.onTrackCount === 0))
    assert.equal(
      (ok(await get(`${BASE}/classes/c5`, a.admin)).students as Json[])[0]?.totalMinutes as number,
      0,
    )
    assert.deepEqual(
      (ok(await get(MY, aPupil)) as unknown as Json[]).map(
        (row) => (row.progress as Json).totalMinutes,
      ),
      [0],
    )
    assertError(await post(BASE, a.admin, activityBody(a.teacherId, { institutionId: b.id })), 400)
    assertError(
      await post(BASE, a.admin, activityBody(b.teacherId)),
      422,
      'social_activity_teacher_not_found',
    )
    assertError(
      await call('PATCH', SETTINGS, a.admin, { totalTargetHours: 20, institutionId: b.id }),
      400,
    )
    ok(await call('PATCH', SETTINGS, a.admin, { totalTargetHours: 20 }))
    assert.equal(ok(await get(SETTINGS, b.admin)).isDefault, true)
    const [bRow] = await db
      .select()
      .from(socialActivities)
      .where(eq(socialActivities.institutionId, b.id))
    assert.equal(bRow?.location, 'Kadıköy')
    assert.equal(bRow?.archivedAt, null)
    const bHours = await hourRows(b.id)
    assert.deepEqual(bHours.map((row) => row.status).sort(), ['approved', 'pending'])
  })
})
