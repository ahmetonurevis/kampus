import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { CORE_SKILLS } from '@kampus/school-core/cefr/suggestion.ts'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import { INSTITUTION_TYPES } from '@kampus/school-core/modules/collection-modules.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { insertLessonHourAttendances } from '../src/db/progression.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { coordinatorDuties } from '../src/db/schema/coordinator-duties.ts'
import { feeTariffs } from '../src/db/schema/fee-tariffs.ts'
import { languageGroupMembers } from '../src/db/schema/language-groups.ts'
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
import { checkFinanceMirrorAfterEach } from './support/finance-mirror.ts'

/**
 * Kur yenileme ve üst kur teklif listesi ucu (IST-088, ON-082; DOM-DIL-070, DOM-DIL-071,
 * DOM-DIL-050, DOM-FIN-020). Kur, grup, ölçme ve karar OG-086'nın uçlarıyla kurulur; yoklama yazma
 * ucu olmadığından (OG-269) yoklama satırları depo işleviyle yazılır. Kursiyerler seed'in s1 (Deniz
 * Yılmaz), s3 (Zeynep Demir) ve s25'idir (Nehir Baş); saat ücreti 500 ₺.
 */

type Json = ReturnType<typeof JSON.parse>

const SEED = createSeed(FIXED_NOW)
const YEAR = FIXED_NOW.getUTCFullYear()
const OFFERS = '/api/v1/finance/course-offers'
const HOURLY = 50_000
const HOURS = 12
const CLASSES = ['c1', 'c3']
const SAMPLE: Partial<Record<CollectionName, readonly Record<string, unknown>[]>> = {
  branches: SEED.branches,
  classes: SEED.classes.filter((item) => CLASSES.includes(item.id)),
  students: SEED.students.filter((item) => CLASSES.includes(item.classId)),
  parents: SEED.parents,
}

describe('IST-088: kur yenileme ve üst kur teklif listesi', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '127.0.0.1'
  checkFinanceMirrorAfterEach(() => db)

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(
    method: 'GET' | 'POST',
    url: string,
    cookie: string | null,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url: url.startsWith('/api/') ? url : `/api/v1${url}`,
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
  const key = () => ({ 'idempotency-key': randomUUID() })
  async function ok(response: Awaited<ReturnType<typeof call>>, status = 200) {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Awaited<ReturnType<typeof call>>, status: number, code: string) {
    assert.equal(response.statusCode, status, response.body)
    assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.96.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, { type: 'language_school', ...overrides })
    await insertMissingRecords(
      db,
      created.id,
      Object.entries(SAMPLE).flatMap(([collection, items]) =>
        (items ?? []).map((data) => {
          const name = collection as CollectionName
          const id = recordKey(name, data)
          if (id === null) throw new Error(`anahtarsız örnek kayıt: ${collection}`)
          return { collection: name, id, data }
        }),
      ),
      FIXED_NOW,
    )
    return { id: created.id, adminUser: created.admin, admin: await signInAs(app, created.admin) }
  }
  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))

  async function publishTariff(institutionId: string) {
    const vat = { vatBasisPoints: 1000, vatEffectiveDate: '2026-01-01' }
    await db.insert(feeTariffs).values({
      institutionId,
      id: randomUUID(),
      academicYear: YEAR,
      versionNumber: 1,
      status: 'published',
      items: [
        {
          kind: 'tuition',
          level: null,
          amountCents: HOURLY,
          unit: 'lesson_hour',
          announcedAmountCents: null,
          ...vat,
        },
      ],
      discounts: [{ kind: 'early_payment', percentBasisPoints: 1_000, amountCents: null }],
      announcedDate: '2026-05-01',
      publishedByUserId: 'test',
      publishedAt: FIXED_NOW,
    })
  }

  async function course(admin: string, body: Record<string, unknown>) {
    const made = await ok(
      await call(
        'POST',
        '/courses',
        admin,
        { totalHours: HOURS, weeklyHours: 4, minLearners: 2, maxLearners: 12, ...body },
        key(),
      ),
      201,
    )
    await ok(await call('POST', `/courses/${made.id}/activate`, admin, {}, { 'if-match': '"1"' }))
    return made.id as string
  }

  /**
   * Dil okulu: B1.1 → B1.2 zinciri ve zincirsiz C2 kuru, her biri ayrı grupta. Öğretmen gruplara,
   * koordinatör B1 ve C2 seviyelerine atanır; B1.2'nin kur ücreti paketi ve tarife yayımdadır.
   */
  async function school() {
    const base = await institution()
    const teacher = await createMember(app, base.id, 'ogretmen')
    const coordinator = await createMember(app, base.id, 'ogretmen')
    const cookies = {
      admin: base.admin,
      teacher: await signInAs(app, teacher),
      coordinator: await signInAs(app, coordinator),
    }
    for (const scopeId of ['B1', 'C2'])
      await db.insert(coordinatorDuties).values({
        institutionId: base.id,
        id: randomUUID(),
        membershipId: coordinator.membershipId,
        kind: 'academic_coordinator',
        scopeId,
        assignedByUserId: base.adminUser.id,
      })
    const nextCourseId = await course(base.admin, { name: 'Genel İngilizce B1.2', level: 'B1' })
    const courseId = await course(base.admin, {
      name: 'Genel İngilizce B1.1',
      level: 'B1',
      nextCourseId,
    })
    const topCourseId = await course(base.admin, { name: 'Genel İngilizce C2', level: 'C2' })
    async function group(groupCourseId: string, name: string) {
      const made = await ok(
        await call(
          'POST',
          '/groups',
          base.admin,
          {
            courseId: groupCourseId,
            name,
            ageBand: 'adult',
            teacherMembershipId: teacher.membershipId,
            delivery: 'in_person',
            room: name,
            schedule: [
              { weekday: name === 'C2' ? 2 : 1, startTime: '18:00' },
              { weekday: name === 'C2' ? 2 : 1, startTime: '18:45' },
              { weekday: name === 'C2' ? 4 : 3, startTime: '18:00' },
              { weekday: name === 'C2' ? 4 : 3, startTime: '18:45' },
            ],
            startDate: '2026-10-12',
            capacity: 10,
          },
          key(),
        ),
        201,
      )
      return made.id as string
    }
    const groups = { b1: await group(courseId, 'B1 Akşam'), c2: await group(topCourseId, 'C2') }
    await publishTariff(base.id)
    const pkg = await ok(
      await call('POST', '/finance/packages', base.admin, {
        kind: 'course',
        name: 'B1.2 kur ücreti',
        courseId: nextCourseId,
      }),
      201,
    )
    return {
      ...base,
      cookies,
      teacherUserId: teacher.id,
      courseId,
      nextCourseId,
      topCourseId,
      groups,
      packageId: pkg.id as string,
    }
  }
  type School = Awaited<ReturnType<typeof school>>

  /** Kursiyeri gruba alır, 12 saatin yoklamasını ve üç ölçmeyi girer. */
  async function enrol(s: School, studentId: string, groupId: string) {
    const enrollmentId = randomUUID()
    await db.insert(languageGroupMembers).values({
      institutionId: s.id,
      id: enrollmentId,
      groupId,
      studentId,
      status: 'active',
      joinedAt: FIXED_NOW,
    })
    await insertLessonHourAttendances(
      db,
      s.id,
      { id: enrollmentId, groupId, studentId },
      Array.from({ length: HOURS }, (_, index) => ({
        lessonHourId: `ders-${String(index + 1)}`,
        status: 'present' as const,
      })),
      { userId: s.teacherUserId, at: FIXED_NOW },
    )
    const skills = CORE_SKILLS.map((skill) => ({ skill, score: 80, feedback: `${skill} notu` }))
    for (const point of ['baseline', 'midterm', 'final'])
      await ok(
        await call(
          'POST',
          '/course-assessments',
          s.cookies.teacher,
          { enrollmentId, point, score: 80, skills },
          key(),
        ),
        201,
      )
    return enrollmentId
  }
  async function propose(s: School, enrollmentId: string, outcome: string) {
    return ok(
      await call(
        'POST',
        '/progression-decisions',
        s.cookies.teacher,
        { enrollmentId, outcome, rationale: 'Öğretmen notu: konuşmada çekingen.' },
        key(),
      ),
      201,
    )
  }
  async function approve(s: School, decision: Json) {
    return ok(
      await call(
        'POST',
        `/progression-decisions/${decision.id as string}/approve`,
        s.cookies.coordinator,
        {},
        { ...key(), 'if-match': `"${String(decision.rowVersion)}"` },
      ),
    )
  }
  async function list(cookie: string, query = '') {
    const response = await get(`${OFFERS}${query}`, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Json[]; meta: { total: number } }
  }

  test('IST-088, DOM-DIL-070, DOM-DIL-050: onaylı geçti kararında ön büro üst kur teklifini tarife fiyatıyla görür ve satışla açar', async () => {
    const s = await school()
    const decision = await approve(s, await propose(s, await enrol(s, 's1', s.groups.b1), 'passed'))
    const desk = await member(s.id, 'onburo')
    const body = await list(desk)
    assert.equal(body.meta.total, 1)
    const [row] = body.data
    assert.deepEqual(row, {
      studentId: 's1',
      studentName: 'Deniz Yılmaz',
      status: 'ready',
      decisionId: decision.id,
      outcome: 'passed',
      approvedAt: FIXED_NOW.toISOString(),
      fromCourseId: s.courseId,
      fromCourseName: 'Genel İngilizce B1.1',
      fromLevel: 'B1',
      courseId: s.nextCourseId,
      courseName: 'Genel İngilizce B1.2',
      level: 'B1',
      options: [
        {
          packageId: s.packageId,
          packageName: 'B1.2 kur ücreti',
          kind: 'course',
          hours: HOURS,
          announcedCents: HOURS * HOURLY,
          priceCents: HOURS * HOURLY,
        },
      ],
      saleId: null,
      problem: null,
    })
    // Öğretmen notu ve kararın dayanağı teklif ekranına gelmez.
    assert.doesNotMatch(JSON.stringify(body), /çekingen|rationale|basis|evidence/)

    // Teklif paket satışıyla açılır; serbest indirim yoktur, yalnız tarifedeki tür seçilir.
    const quote = { packageId: s.packageId, studentId: 's1', installmentCount: 1 }
    assertError(
      await call('POST', '/finance/package-sales/quote', desk, { ...quote, discountCents: 1000 }),
      400,
      'validation_failed',
    )
    const priced = await ok(await call('POST', '/finance/package-sales/quote', desk, quote))
    assert.equal(priced.grossCents, HOURS * HOURLY)
    const sale = await ok(
      await call(
        'POST',
        '/finance/package-sales',
        desk,
        { ...quote, tariffId: priced.tariffId, firstDueDate: '2026-10-31' },
        key(),
      ),
      201,
    )
    const [sold] = (await list(s.admin, '?studentId=s1')).data
    assert.equal(sold?.saleId, sale.id)
  })

  test('DOM-DIL-071: tekrar kararında teklif aynı kur ve seviyede kalır; paketsiz kurda neden görünür', async () => {
    const s = await school()
    await approve(s, await propose(s, await enrol(s, 's3', s.groups.b1), 'repeat'))
    const [row] = (await list(s.admin)).data
    assert.equal(row.outcome, 'repeat')
    assert.equal(row.courseId, s.courseId)
    assert.equal(row.level, 'B1')
    assert.deepEqual(row.options, [])
    assert.equal(row.problem.code, 'course_offer_package_missing')
    assert.equal((await list(s.admin, '?outcome=passed')).meta.total, 0)
    assert.equal((await list(s.admin, '?outcome=repeat&q=zeyn')).meta.total, 1)
  })

  test('DOM-DIL-070: onaysız karar listeye girmez; C2 geçti kararında üst seviye yok', async () => {
    const s = await school()
    await propose(s, await enrol(s, 's1', s.groups.b1), 'passed')
    assert.equal((await list(s.admin)).meta.total, 0)
    await approve(s, await propose(s, await enrol(s, 's25', s.groups.c2), 'passed'))
    const body = await list(s.admin)
    assert.equal(body.meta.total, 1)
    const [row] = body.data
    assert.equal(row.studentId, 's25')
    assert.equal(row.status, 'no_next_level')
    assert.equal(row.level, null)
    assert.deepEqual(row.options, [])
    assert.equal(row.problem.code, 'course_next_level_missing')
  })

  test('DOM-YTK-001: başka kurumun kursiyeri listede yok, studentId ile 404', async () => {
    const a = await school()
    const b = await school()
    await approve(b, await propose(b, await enrol(b, 's1', b.groups.b1), 'passed'))
    assert.equal((await list(b.admin)).meta.total, 1)
    // A ve B'de aynı öğrenci kimliği var; A'da karar yoktur, B'nin kararı A'ya sızmaz.
    assert.equal((await list(a.admin)).meta.total, 0)
    assert.equal((await list(a.admin, '?studentId=s1')).meta.total, 0)
    assertError(await get(`${OFFERS}?studentId=s-baska-kurum`, a.admin), 404, 'not_found')
  })

  test('IST-088: oturumsuz 401, öğretmen, veli ve öğrenci 403, bilinmeyen parametre 400', async () => {
    const a = await institution()
    assertError(await get(OFFERS, null), 401, 'unauthenticated')
    for (const role of ['ogretmen', 'veli', 'ogrenci'] as const)
      assertError(await get(OFFERS, await member(a.id, role)), 403, 'forbidden')
    assertError(await get(`${OFFERS}?sort=name`, a.admin), 400, 'validation_failed')
    assert.equal((await list(a.admin)).meta.total, 0)
  })

  test('DOM-YTK-012: dil okulunda yenileme uçları kapalı; teklif listesi finance modülüyle açık', async () => {
    // `renewal` modülü yalnız okulda tanımlı: ON-295'in tek öğrenci yenilemesi dil okulunda 404'tür,
    // kur teklifi bu yüzden `finance` modülündeki pakete bağlıdır (IST-088).
    const a = await institution()
    const desk = await member(a.id, 'onburo')
    assertError(await get('/api/v1/finance/renewals', a.admin), 404, 'not_found')
    assertError(
      await call('POST', '/finance/renewals/quote', desk, { studentId: 's1' }),
      404,
      'not_found',
    )
    assert.equal((await list(desk)).meta.total, 0)
  })

  test('DOM-YTK-040, DOM-YTK-012: finance kapalıysa 403; okulda her rol 404', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(OFFERS, closed.admin), 403, 'module_disabled')
    for (const type of INSTITUTION_TYPES.filter((item) => item !== 'language_school')) {
      const other = await institution({ type })
      assertError(await get(OFFERS, other.admin), 404, 'not_found')
      assertError(await get(OFFERS, await member(other.id, 'ogretmen')), 404, 'not_found')
    }
  })
})
