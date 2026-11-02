import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { coordinatorDuties } from '../src/db/schema/coordinator-duties.ts'
import { courses } from '../src/db/schema/courses.ts'
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
 * Dil okulu kur programı uçları (IST-076; DOM-DIL-005…007). Kural core `lib/courses.ts`'tedir;
 * burada kurum türü (okulda 404, rol reddinden önce), rol ve koordinatör kapsamı, başka kurum,
 * sürüm (`If-Match`), mükerrer işlem (`Idempotency-Key`), e-Özel onayı ve öğrenci/veli yanıtının
 * daralması denetlenir.
 */

type Json = ReturnType<typeof JSON.parse>
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

const B1 = {
  name: 'Genel İngilizce B1',
  level: 'B1',
  totalHours: 96,
  weeklyHours: 6,
  minLearners: 4,
  maxLearners: 12,
}

describe('kur programı uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '127.0.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function tenant(type: 'school' | 'language_school' = 'language_school') {
    clientIp = `10.9.${(tenantCount += 1)}.1`
    const institution = await createInstitution(app, { type })
    const users = {
      frontDesk: await createMember(app, institution.id, 'onburo'),
      teacher: await createMember(app, institution.id, 'ogretmen'),
      coordinator: await createMember(app, institution.id, 'ogretmen'),
      student: await createMember(app, institution.id, 'ogrenci'),
      parent: await createMember(app, institution.id, 'veli'),
    }
    // B1 akademik koordinatörü (DOM-YTK-027); görev ucu ayrı testte, burada satır doğrudan yazılır.
    await db.insert(coordinatorDuties).values({
      institutionId: institution.id,
      id: randomUUID(),
      membershipId: users.coordinator.membershipId,
      kind: 'academic_coordinator',
      scopeId: 'B1',
      assignedByUserId: institution.admin.id,
    })
    const cookies = {
      admin: await signInAs(app, institution.admin),
      frontDesk: await signInAs(app, users.frontDesk),
      teacher: await signInAs(app, users.teacher),
      coordinator: await signInAs(app, users.coordinator),
      student: await signInAs(app, users.student),
      parent: await signInAs(app, users.parent),
    }
    return { institution, cookies }
  }

  function call(
    method: Method,
    url: string,
    cookie?: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url: `/api/v1${url}`,
      remoteAddress: clientIp,
      headers: {
        origin: TEST_ORIGIN,
        ...(cookie ? { cookie } : {}),
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
  }
  const key = () => ({ 'idempotency-key': randomUUID() })
  const match = (value: number) => ({ 'if-match': `"${value}"` })
  async function ok(response: Awaited<ReturnType<typeof call>>, status = 200) {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function fails(response: Awaited<ReturnType<typeof call>>, status: number, code: string) {
    assert.equal(response.statusCode, status, response.body)
    assert.equal(response.json().code, code, response.body)
  }

  const create = (cookie: string, body: unknown, headers: Record<string, string> = key()) =>
    call('POST', '/courses', cookie, body, headers)
  const patch = (cookie: string, id: string, body: unknown, version: number) =>
    call('PATCH', `/courses/${id}`, cookie, body, match(version))
  const command = (cookie: string, id: string, verb: string, version: number, body: unknown = {}) =>
    call('POST', `/courses/${id}/${verb}`, cookie, body, match(version))
  const archive = (cookie: string, id: string, version: number) =>
    call('DELETE', `/courses/${id}`, cookie, undefined, match(version))

  const courseRows = (institutionId: string) =>
    db.select().from(courses).where(eq(courses.institutionId, institutionId))
  const audits = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))

  test('401: oturumsuz okuma ve yazma reddedilir', async () => {
    fails(await call('GET', '/courses'), 401, 'unauthenticated')
    fails(await call('GET', `/courses/${randomUUID()}`), 401, 'unauthenticated')
    fails(await create('', B1), 401, 'unauthenticated')
  })

  test('DOM-DIL-005: okulda kur uçları her rol için 404, rol reddinden önce', async () => {
    const { institution, cookies } = await tenant('school')
    for (const cookie of Object.values(cookies)) {
      fails(await call('GET', '/courses', cookie), 404, 'not_found')
      fails(await create(cookie, B1), 404, 'not_found')
      fails(await archive(cookie, randomUUID(), 1), 404, 'not_found')
    }
    fails(await command(cookies.parent, randomUUID(), 'record-e-ozel', 1), 404, 'not_found')
    assert.equal((await courseRows(institution.id)).length, 0)
  })

  test('DOM-DIL-005: beş rol okur; yazma yönetici ve öğretmende, rol reddi gövdeden önce', async () => {
    const { institution, cookies } = await tenant()
    for (const cookie of Object.values(cookies)) await ok(await call('GET', '/courses', cookie))
    for (const cookie of [cookies.frontDesk, cookies.student, cookies.parent]) {
      fails(await create(cookie, B1), 403, 'forbidden')
      fails(await create(cookie, { level: 'X' }), 403, 'forbidden')
      fails(await patch(cookie, randomUUID(), { name: 'x' }, 1), 403, 'forbidden')
    }
    assert.equal((await courseRows(institution.id)).length, 0)
  })

  test('DOM-DIL-005: öğretmen yalnız koordinatörü olduğu seviyenin kurunu yönetir', async () => {
    const { institution, cookies } = await tenant()
    fails(await create(cookies.teacher, B1), 403, 'course_coordinator_required')
    fails(
      await create(cookies.coordinator, { ...B1, level: 'B2' }),
      403,
      'course_coordinator_required',
    )
    const course = await ok(await create(cookies.coordinator, B1), 201)
    // Seviyeyi kapsam dışına taşımak da reddedilir (eski ve yeni seviye birlikte aranır).
    fails(
      await patch(cookies.coordinator, course.id, { level: 'B2' }, 1),
      403,
      'course_coordinator_required',
    )
    await ok(await patch(cookies.coordinator, course.id, { description: 'Akşam grubu' }, 1))
    // e-Özel kaydı yalnız yöneticide (DOM-DIL-006).
    fails(
      await command(cookies.coordinator, course.id, 'record-e-ozel', 2, {
        programCode: 'ENG-B1',
        approval: 'pending',
      }),
      403,
      'forbidden',
    )
    const [row] = await courseRows(institution.id)
    assert.equal(row?.level, 'B1')
    assert.equal(row?.version, 2)
  })

  test('DOM-DIL-005: yönetici kur açar; taslak, 201 + Location, denetimde yalnız alan adları', async () => {
    const { institution, cookies } = await tenant()
    const response = await create(cookies.admin, { ...B1, description: 'Sabah grubu' })
    const course = await ok(response, 201)
    assert.equal(response.headers.location, `/api/v1/courses/${course.id}`)
    assert.equal(course.status, 'draft')
    assert.equal(course.language, 'en')
    assert.equal(course.sessionMinutes, 45)
    assert.equal(course.durationWeeks, 16)
    assert.equal(course.certified, false)
    assert.equal(course.rowVersion, 1)
    assert.deepEqual(course.eOzel, {
      programCode: null,
      approval: 'not_submitted',
      recordedAt: null,
      recordedByUserId: null,
    })
    const [row] = await courseRows(institution.id)
    assert.equal(row?.id, course.id)
    assert.equal(row?.name, 'Genel İngilizce B1')
    const [audit] = await audits(institution.id, 'course.create')
    assert.equal(audit?.entityId, course.id)
    assert.deepEqual(audit?.changes, {
      fields: [
        'name',
        'level',
        'description',
        'totalHours',
        'weeklyHours',
        'minLearners',
        'maxLearners',
      ],
    })
    const read = await ok(await call('GET', `/courses/${course.id}`, cookies.frontDesk))
    assert.equal(read.minLearners, 4)
    assert.equal(read.rowVersion, 1)
  })

  test('mükerrer işlem: aynı Idempotency-Key ilk yanıtı tekrarlar; aynı ad 409', async () => {
    const { institution, cookies } = await tenant()
    const headers = key()
    const first = await create(cookies.admin, B1, headers)
    const again = await create(cookies.admin, B1, headers)
    assert.equal(again.statusCode, 201, again.body)
    assert.equal(again.headers['idempotent-replayed'], 'true')
    assert.deepEqual(again.json(), first.json())
    fails(
      await create(cookies.admin, { ...B1, name: 'Başka' }, headers),
      422,
      'idempotency_key_reused',
    )
    assert.equal((await courseRows(institution.id)).length, 1)
    // Anahtarsız aynı ad (büyük/küçük harf duyarsız) açılmaz.
    fails(
      await create(cookies.admin, { ...B1, name: 'GENEL İNGİLİZCE B1' }),
      409,
      'course_name_exists',
    )
    assert.equal((await courseRows(institution.id)).length, 1)
  })

  test('400: geçersiz gövde, gövdede institutionId, anahtar ve If-Match eksikliği kur değiştirmez', async () => {
    const { institution, cookies } = await tenant()
    const other = await createInstitution(app, { type: 'language_school' })
    fails(await create(cookies.admin, { ...B1, level: 'B3' }), 400, 'validation_failed')
    fails(await create(cookies.admin, { ...B1, maxLearners: 19 }), 400, 'validation_failed')
    fails(await create(cookies.admin, { ...B1, institutionId: other.id }), 400, 'validation_failed')
    fails(await create(cookies.admin, B1, {}), 400, 'idempotency_key_required')
    fails(await create(cookies.admin, B1, { ...key(), ...match(1) }), 400, 'if_match_not_supported')
    assert.equal((await courseRows(institution.id)).length, 0)
    assert.equal((await courseRows(other.id)).length, 0)

    const course = await ok(await create(cookies.admin, B1), 201)
    fails(
      await call('PATCH', `/courses/${course.id}`, cookies.admin, { name: 'Yeni' }),
      400,
      'if_match_required',
    )
    fails(await patch(cookies.admin, course.id, {}, 1), 400, 'validation_failed')
    fails(await patch(cookies.admin, course.id, { weeklyHours: 0 }, 1), 400, 'validation_failed')
    fails(await call('GET', '/courses?sort=name', cookies.admin), 400, 'validation_failed')
    fails(await call('GET', '/courses/abc', cookies.admin), 400, 'validation_failed')
    // Alanlar arası kural 422 (DOM-DIL-002, -005).
    fails(await patch(cookies.admin, course.id, { totalHours: 4 }, 1), 422, 'course_hours_invalid')
    const [row] = await courseRows(institution.id)
    assert.equal(row?.version, 1)
    assert.equal(row?.name, 'Genel İngilizce B1')
    assert.equal(row?.totalHours, 96)
  })

  test('başka kurumun kuru 404, listede görünmez ve değişmez', async () => {
    const a = await tenant()
    const b = await tenant()
    const foreign = await ok(await create(b.cookies.admin, B1), 201)
    const own = await ok(await create(a.cookies.admin, { ...B1, name: 'A kuru' }), 201)
    const list = await ok(await call('GET', '/courses', a.cookies.admin))
    assert.deepEqual(
      list.map((course: Json) => course.id),
      [own.id],
    )
    fails(await call('GET', `/courses/${foreign.id}`, a.cookies.admin), 404, 'not_found')
    fails(await patch(a.cookies.admin, foreign.id, { name: 'Ele geçir' }, 1), 404, 'not_found')
    fails(await command(a.cookies.admin, foreign.id, 'activate', 1), 404, 'not_found')
    fails(await archive(a.cookies.admin, foreign.id, 1), 404, 'not_found')
    fails(
      await command(a.cookies.admin, foreign.id, 'record-e-ozel', 1, {
        programCode: 'X-1',
        approval: 'approved',
      }),
      404,
      'not_found',
    )
    const [row] = await courseRows(b.institution.id)
    assert.equal(row?.name, 'Genel İngilizce B1')
    assert.equal(row?.status, 'draft')
    assert.equal(row?.version, 1)
    assert.equal(row?.eOzelApproval, 'not_submitted')
  })

  test('409: bayat If-Match reddedilir ve kur değişmez; olmayan kur sürümden önce 404', async () => {
    const { institution, cookies } = await tenant()
    const course = await ok(await create(cookies.admin, B1), 201)
    const updated = await ok(await patch(cookies.admin, course.id, { name: 'B1 Akşam' }, 1))
    assert.equal(updated.rowVersion, 2)
    fails(await patch(cookies.admin, course.id, { name: 'Eski' }, 1), 409, 'version_conflict')
    fails(await command(cookies.admin, course.id, 'activate', 1), 409, 'version_conflict')
    fails(await archive(cookies.admin, course.id, 1), 409, 'version_conflict')
    fails(await patch(cookies.admin, randomUUID(), { name: 'Yok' }, 9), 404, 'not_found')
    // Sürüm kural denetiminden önce gelir: bayat sürümle kural ihlali de 409 sürümdür.
    fails(await patch(cookies.admin, course.id, { totalHours: 4 }, 1), 409, 'version_conflict')
    const [row] = await courseRows(institution.id)
    assert.equal(row?.name, 'B1 Akşam')
    assert.equal(row?.version, 2)
  })

  test('DOM-DIL-005: öğrenci ve veli yalnız etkin kurları daraltılmış alanlarla görür', async () => {
    const { cookies } = await tenant()
    const draft = await ok(await create(cookies.admin, { ...B1, name: 'Taslak B1' }), 201)
    const next = await ok(
      await create(cookies.admin, { ...B1, name: 'Genel İngilizce B2', level: 'B2' }),
      201,
    )
    const active = await ok(await create(cookies.admin, { ...B1, nextCourseId: next.id }), 201)
    await ok(await command(cookies.admin, active.id, 'activate', 1))
    const staff = await ok(await call('GET', '/courses', cookies.teacher))
    assert.equal(staff.length, 3)
    for (const cookie of [cookies.student, cookies.parent]) {
      const list = await ok(await call('GET', '/courses', cookie))
      assert.deepEqual(
        list.map((course: Json) => course.id),
        [active.id],
      )
      const [shown] = list
      for (const field of ['minLearners', 'status', 'activatedAt', 'archivedAt', 'eOzel'])
        assert.equal(field in shown, false, field)
      for (const field of ['rowVersion', 'updatedAt']) assert.equal(field in shown, false, field)
      // Sonraki kur taslakta: öğrenciye kimliği dönmez.
      assert.equal(shown.nextCourseId, null)
      assert.equal(shown.maxLearners, 12)
      assert.equal(shown.durationWeeks, 16)
      fails(await call('GET', `/courses/${draft.id}`, cookie), 404, 'not_found')
      assert.deepEqual(await ok(await call('GET', '/courses?status=draft', cookie)), [])
    }
  })

  test('DOM-DIL-006: belgeli kur e-Özel onayı olmadan etkinleşmez; iz yönetici ve anla tutulur', async () => {
    const { institution, cookies } = await tenant()
    const course = await ok(await create(cookies.admin, { ...B1, certified: true }), 201)
    fails(
      await command(cookies.admin, course.id, 'activate', 1),
      422,
      'course_program_not_approved',
    )
    const pending = await ok(
      await command(cookies.admin, course.id, 'record-e-ozel', 1, {
        programCode: 'ENG-B1-2026',
        approval: 'pending',
      }),
    )
    assert.equal(pending.eOzel.approval, 'pending')
    fails(
      await command(cookies.admin, course.id, 'activate', 2),
      422,
      'course_program_not_approved',
    )
    const approved = await ok(
      await command(cookies.admin, course.id, 'record-e-ozel', 2, {
        programCode: 'ENG-B1-2026',
        approval: 'approved',
      }),
    )
    assert.deepEqual(approved.eOzel, {
      programCode: 'ENG-B1-2026',
      approval: 'approved',
      recordedAt: FIXED_NOW.toISOString(),
      recordedByUserId: institution.admin.id,
    })
    const active = await ok(await command(cookies.admin, course.id, 'activate', 3))
    assert.equal(active.status, 'active')
    assert.equal(active.activatedAt, FIXED_NOW.toISOString())
    // Etkin kurun program alanları kilitli (DOM-DIL-005); etkin belgeli kurun e-Özel kaydı da.
    fails(
      await patch(cookies.admin, course.id, { totalHours: 120 }, 4),
      422,
      'course_active_locked',
    )
    fails(
      await command(cookies.admin, course.id, 'record-e-ozel', 4, {
        programCode: 'ENG-B1-2027',
        approval: 'approved',
      }),
      422,
      'course_active_locked',
    )
    const [audit] = await audits(institution.id, 'course.e_ozel_record')
    assert.deepEqual(audit?.changes, {
      fields: ['eOzel.programCode', 'eOzel.approval', 'eOzel.recordedAt'],
    })
    const [row] = await courseRows(institution.id)
    assert.equal(row?.status, 'active')
    assert.equal(row?.totalHours, 96)
    assert.equal(row?.version, 4)
  })

  test('DOM-DIL-007: sonraki kuru arşivlenmez; arşiv son durumdur ve listede süzgeçle okunur', async () => {
    const { institution, cookies } = await tenant()
    const next = await ok(
      await create(cookies.admin, { ...B1, name: 'Genel İngilizce B2', level: 'B2' }),
      201,
    )
    const course = await ok(await create(cookies.admin, { ...B1, nextCourseId: next.id }), 201)
    fails(await archive(cookies.admin, next.id, 1), 422, 'course_has_dependents')
    fails(
      await patch(cookies.admin, next.id, { nextCourseId: course.id }, 1),
      422,
      'course_next_level',
    )
    // Bağlanılan kurun seviyesi önceki kurun altına inmez; satır değişmez.
    const before = await courseRows(institution.id)
    fails(await patch(cookies.admin, next.id, { level: 'A1' }, 1), 422, 'course_next_level')
    assert.deepEqual(await courseRows(institution.id), before)
    await ok(await patch(cookies.admin, course.id, { nextCourseId: null }, 1))
    const archived = await ok(await archive(cookies.admin, next.id, 1))
    assert.equal(archived.status, 'archived')
    assert.equal(archived.archivedAt, FIXED_NOW.toISOString())
    fails(await patch(cookies.admin, next.id, { name: 'Geri' }, 2), 409, 'course_archived')
    assert.deepEqual(
      (await ok(await call('GET', '/courses', cookies.admin))).map((item: Json) => item.id),
      [course.id],
    )
    assert.deepEqual(
      (await ok(await call('GET', '/courses?status=archived', cookies.admin))).map(
        (item: Json) => item.id,
      ),
      [next.id],
    )
    const [audit] = await audits(institution.id, 'course.archive')
    assert.deepEqual(audit?.changes, { fields: ['status', 'archivedAt'] })
  })
})
