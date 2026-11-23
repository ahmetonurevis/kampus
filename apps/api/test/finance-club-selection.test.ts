import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, isNull } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  clubSelectionPeriods,
  clubSelectionPreferences,
  clubSelectionResults,
} from '../src/db/schema/finance-club-selection.ts'
import { schoolClubMembers } from '../src/db/schema/finance-clubs.ts'
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
 * Kulüp tercihi ve kontenjanlı dağıtım uçları (DOM-FIN-150; ON-169; IST-099; K-505…K-507). Her
 * test kendi kurumunu kurar. Saat testte değişir: FIXED_NOW 2026-10-06 (dönem açık), CLOSED
 * 2026-10-09 (dönem 2026-10-05…08 kapandı). Seed sınıfları: s1 7, s2 5, s3 6, s4 8, s5 9. sınıf.
 */

const CLUBS = '/api/v1/finance/clubs'
const BASE = '/api/v1/finance/club-selection'
const PERIODS = `${BASE}/periods`
const MY = `${BASE}/my`
const CLOSED = new Date('2026-10-09T09:00:00.000Z')
const STUDENTS = ['s1', 's2', 's3', 's4', 's5']

const SEED = createSeed(FIXED_NOW)

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-150: kulüp tercihi ve dağıtım uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let now = FIXED_NOW
  let tenantCount = 0
  let clientIp = '10.98.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => now })
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
  const post = (url: string, cookie: string | null, body?: unknown, key = randomUUID()) =>
    call('POST', url, cookie, body, { 'idempotency-key': key })
  const patch = (url: string, cookie: string, body: unknown, version: unknown) =>
    call('PATCH', url, cookie, body, { 'if-match': `"${String(version)}"` })
  const remove = (url: string, cookie: string, version: unknown) =>
    call('DELETE', url, cookie, undefined, { 'if-match': `"${String(version)}"` })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    now = FIXED_NOW
    clientIp = `10.98.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    const students = SEED.students.filter((row) => STUDENTS.includes(row.id))
    const classIds = new Set(students.map((student) => student.classId))
    await insertMissingRecords(
      db,
      created.id,
      [
        ...SEED.classes
          .filter((row) => classIds.has(row.id))
          .map((row) => ({ collection: 'classes' as const, id: row.id, data: { ...row } })),
        ...students.map((student) => ({
          collection: 'students' as const,
          id: student.id,
          data: { ...student },
        })),
        {
          collection: 'students' as const,
          id: 'test-s-left',
          data: { ...students[0], id: 'test-s-left', name: 'Ayrılan Öğrenci', isActive: false },
        },
      ],
      FIXED_NOW,
    )
    const teacher = await createMember(app, created.id, 'ogretmen')
    const admin = await signInAs(app, created.admin)
    const clubs: Json[] = []
    for (const [name, capacity] of [
      ['Robotik', 1],
      ['Satranç', 2],
      ['Drama', 5],
    ] as const)
      clubs.push(
        ok(
          await post(CLUBS, admin, {
            name,
            teacherMembershipId: teacher.membershipId,
            capacity,
            meetingDay: 3,
            startTime: '15:30',
            endTime: '16:30',
          }),
          201,
        ),
      )
    const [robotics, chess, drama] = clubs.map((club) => String(club.id))
    assert.ok(robotics && chess && drama)
    return {
      id: created.id,
      admin,
      teacher: await signInAs(app, teacher),
      robotics,
      chess,
      drama,
    }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>

  const periodBody = (t: Tenant, extra: Json = {}) => ({
    name: 'Güz kulüp tercihi',
    academicYear: 2026,
    term: 1,
    openDate: '2026-10-05',
    closeDate: '2026-10-08',
    clubIds: [t.robotics, t.chess, t.drama],
    maxChoices: 2,
    ...extra,
  })
  const periodUrl = (id: unknown) => `${PERIODS}/${String(id)}`
  const choose = (t: Tenant, period: Json, studentId: string, choices: string[], who = t.admin) =>
    post(`${periodUrl(period.id)}/preferences`, who, { studentId, choices })

  test('kimliksiz istek 401', async () => {
    assertError(await get(PERIODS, null), 401)
    assertError(await post(PERIODS, null, {}), 401)
    assertError(await get(MY, null), 401)
  })

  test('DOM-FIN-150: dönem yönetimi yönetici ve ön büroda; öğretmen ve veli 403; modül kapalı 403 (K-505)', async () => {
    const t = await institution()
    const desk = await signInAs(app, await createMember(app, t.id, 'onburo'))
    const parent = await signInAs(app, await createMember(app, t.id, 'veli'))
    assertError(await get(PERIODS, t.teacher), 403)
    assertError(await get(PERIODS, parent), 403)
    assertError(await post(PERIODS, t.teacher, periodBody(t)), 403)
    const period = ok(await post(PERIODS, desk, periodBody(t)), 201)
    assertError(await choose(t, period, 's1', [t.chess], t.teacher), 403)
    assertError(await get(MY, t.admin), 403)
    assert.equal((await get(PERIODS, desk)).json().meta.total, 1)
    clientIp = `10.98.${String((tenantCount += 1))}.1`
    const closed = await createInstitution(app, { enabledModules: { clubs: false } })
    const closedAdmin = await signInAs(app, closed.admin)
    assertError(await get(PERIODS, closedAdmin), 403, 'module_disabled')
    assertError(await get(MY, closedAdmin), 403)
  })

  test('DOM-FIN-150: dönem açma, doğrulama, düzenleme kuralları ve arşiv (K-505)', async () => {
    const t = await institution()
    assertError(await post(PERIODS, t.admin, periodBody(t, { maxChoices: 4 })), 400)
    assertError(
      await post(PERIODS, t.admin, periodBody(t, { clubIds: [t.chess, randomUUID()] })),
      422,
      'club_selection_club_not_found',
    )
    assertError(
      await post(
        PERIODS,
        t.admin,
        periodBody(t, { openDate: '2026-10-01', closeDate: '2026-10-05' }),
      ),
      422,
      'club_selection_closes_past',
    )
    assertError(
      await call('POST', PERIODS, t.admin, periodBody(t)),
      400,
      'idempotency_key_required',
    )
    const rows = () =>
      db.select().from(clubSelectionPeriods).where(eq(clubSelectionPeriods.institutionId, t.id))
    assert.equal((await rows()).length, 0)
    const key = randomUUID()
    const period = ok(await post(PERIODS, t.admin, periodBody(t), key), 201)
    assert.equal(period.phase, 'open')
    assert.equal(period.seatsPerStudent, 1)
    assert.equal(period.eligibleStudentCount, 5)
    assert.equal((period.clubs as Json[]).length, 3)
    const replay = await post(PERIODS, t.admin, periodBody(t), key)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal((await rows()).length, 1)

    const url = periodUrl(period.id)
    const changed = ok(
      await patch(
        url,
        t.admin,
        { gradeLevels: [5, 7], clubIds: [t.chess, t.drama] },
        period.version,
      ),
    )
    assert.deepEqual(changed.gradeLevels, [5, 7])
    assert.equal(changed.eligibleStudentCount, 2)
    assert.deepEqual(
      (changed.clubs as Json[]).map((club) => club.id),
      [t.chess, t.drama],
    )
    assertError(await patch(url, t.admin, { name: 'Yeni' }, period.version), 409)
    // Kulüp listesine geri dönen kulüp arşivden döner (kalıcı silme yok).
    const back = ok(
      await patch(url, t.admin, { clubIds: [t.robotics, t.chess, t.drama] }, changed.version),
    )
    assert.equal((back.clubs as Json[]).length, 3)
    ok(await choose(t, period, 's1', [t.chess]))
    const withPreference = ok(await get(url, t.admin))
    assertError(
      await patch(url, t.admin, { maxChoices: 3 }, withPreference.version),
      422,
      'club_selection_has_preferences',
    )
    const renamed = ok(
      await patch(
        url,
        t.admin,
        { name: 'Güz tercihleri', closeDate: '2026-10-09' },
        withPreference.version,
      ),
    )
    assert.equal(renamed.name, 'Güz tercihleri')
    assertError(
      await patch(url, t.admin, { name: 'Güz tercihleri' }, renamed.version),
      422,
      'club_selection_unchanged',
    )
    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.institutionId, t.id), eq(auditLog.entityType, 'club_selection_periods')),
      )
    assert.deepEqual([...new Set(audits.map((row) => row.action))].sort(), [
      'finance.club_selection.create',
      'finance.club_selection.update',
    ])
    ok(await remove(url, t.admin, renamed.version))
    assertError(await get(url, t.admin), 404)
    assert.equal((await get(PERIODS, t.admin)).json().meta.total, 0)
  })

  test('DOM-FIN-150: tercih öğrenci, veli (kendi çocuğu) ya da adına yönetici; dönem kapanınca değişmez (K-505)', async () => {
    const t = await institution()
    const period = ok(await post(PERIODS, t.admin, periodBody(t, { gradeLevels: [5, 6, 7] })), 201)
    const parent = await signInAs(
      app,
      await createMember(app, t.id, 'veli', [{ kind: 'child', recordId: 's1' }]),
    )
    const student = await signInAs(
      app,
      await createMember(app, t.id, 'ogrenci', [{ kind: 'student', recordId: 's3' }]),
    )
    const url = `${periodUrl(period.id)}/preferences`
    const key = randomUUID()
    const mine = ok(
      await post(url, parent, { studentId: 's1', choices: [t.robotics, t.chess] }, key),
    )
    assert.deepEqual(mine.choices, [t.robotics, t.chess])
    const replay = await post(url, parent, { studentId: 's1', choices: [t.robotics, t.chess] }, key)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assertError(await post(url, parent, { studentId: 's2', choices: [t.chess] }), 404)
    assertError(await post(url, student, { studentId: 's1', choices: [t.chess] }), 404)
    ok(await post(url, student, { studentId: 's3', choices: [t.drama] }))
    ok(await choose(t, period, 's2', [t.chess, t.robotics]))
    assertError(await choose(t, period, 's4', [t.chess]), 422, 'club_selection_grade_excluded')
    assertError(
      await choose(t, period, 'test-s-left', [t.chess]),
      422,
      'club_selection_student_inactive',
    )
    assertError(
      await choose(t, period, 'test-yok', [t.chess]),
      422,
      'club_selection_student_not_found',
    )
    assertError(
      await choose(t, period, 's2', [t.chess, t.robotics, t.drama]),
      422,
      'club_selection_too_many_choices',
    )
    assertError(
      await choose(t, period, 's2', [randomUUID()]),
      422,
      'club_selection_club_not_in_period',
    )
    assertError(await choose(t, period, 's2', [t.chess, t.chess]), 400)

    // Değişiklik eski tercihi arşivler; boş liste geri çeker.
    ok(await post(url, parent, { studentId: 's1', choices: [t.chess] }))
    const live = () =>
      db
        .select()
        .from(clubSelectionPreferences)
        .where(
          and(
            eq(clubSelectionPreferences.institutionId, t.id),
            isNull(clubSelectionPreferences.archivedAt),
          ),
        )
    assert.equal((await live()).length, 3)
    const withdrawn = ok(await choose(t, period, 's2', []))
    assert.equal(withdrawn.enteredAt, null)
    assertError(await choose(t, period, 's2', []), 422, 'club_selection_no_preference')
    assert.equal((await live()).length, 2)
    const detail = ok(await get(periodUrl(period.id), t.admin))
    const prefs = detail.preferences as Json[]
    assert.deepEqual(
      prefs.map((row) => [row.studentId, row.enteredByRole]),
      [
        ['s1', 'veli'],
        ['s3', 'ogrenci'],
      ],
    )
    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, t.id),
          eq(auditLog.entityType, 'club_selection_preferences'),
        ),
      )
    assert.ok(audits.length >= 4)
    assert.ok(!JSON.stringify(audits).includes('"s1"'))

    const familyView = ok(await get(MY, parent)) as unknown as Json[]
    assert.equal(familyView.length, 1)
    const own = (familyView[0]?.students as Json[])[0]
    assert.deepEqual([own?.studentId, own?.choices], ['s1', [t.chess]])
    assert.equal((familyView[0]?.clubs as Json[]).length, 3)

    now = CLOSED
    assertError(
      await post(url, parent, { studentId: 's1', choices: [t.drama] }),
      422,
      'club_selection_not_open',
    )
    assertError(await choose(t, period, 's1', [t.drama]), 422, 'club_selection_not_open')
  })

  test('DOM-FIN-150: kura bir kez çekilir, önizleme yeniden üretilir; onay üyelikleri tek işlemde yazar (K-506, K-507)', async () => {
    const t = await institution()
    const period = ok(await post(PERIODS, t.admin, periodBody(t, { maxChoices: 2 })), 201)
    const url = periodUrl(period.id)
    // s5 Satranç'a zaten üye; aynı kulübe yeniden atanmaz, kontenjandan düşer (2 → 1 boş yer).
    ok(await post(`${CLUBS}/${t.chess}/members`, t.admin, { studentId: 's5' }), 201)
    for (const studentId of ['s1', 's2', 's3', 's4'])
      ok(await choose(t, period, studentId, [t.robotics, t.chess]))
    ok(await choose(t, period, 's5', [t.chess]))
    assertError(await post(`${url}/draw`, t.admin), 422, 'club_selection_still_open')
    assertError(await get(`${url}/allocation`, t.admin), 422, 'club_selection_not_drawn')

    now = CLOSED
    assertError(
      await post(`${url}/confirm`, t.admin, { digest: '0'.repeat(14) }),
      422,
      'club_selection_not_drawn',
    )
    const drawKey = randomUUID()
    const drawn = ok(await post(`${url}/draw`, t.admin, undefined, drawKey))
    const replay = await post(`${url}/draw`, t.admin, undefined, drawKey)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assertError(await post(`${url}/draw`, t.admin), 409, 'club_selection_already_drawn')
    const preview = ok(await get(`${url}/allocation`, t.admin))
    assert.deepEqual(preview, drawn)
    assert.equal(typeof preview.seed, 'string')
    const assignments = preview.assignments as Json[]
    // Robotik 1 + Satranç 1 boş yer; dört öğrenciden ikisi yerleşir, s5 atanmaz.
    assert.equal(assignments.length, 2)
    assert.ok(assignments.every((row) => row.studentId !== 's5'))
    assert.deepEqual(assignments.map((row) => row.clubId).sort(), [t.chess, t.robotics].sort())
    const waitlist = preview.waitlist as Json[]
    assert.equal(new Set(waitlist.map((row) => row.studentId)).size, 2)
    const period2 = ok(await get(url, t.admin))
    assert.equal(period2.phase, 'drawn')
    assertError(
      await patch(url, t.admin, { name: 'Yeni ad' }, period2.version),
      422,
      'club_selection_locked',
    )

    // Önizlemeden sonra kontenjan değişti: özet tutmaz, hiçbir üyelik yazılmaz.
    const extra = ok(await post(`${CLUBS}/${t.drama}/members`, t.admin, { studentId: 's1' }), 201)
    const robotics = ok(await get(`${CLUBS}/${t.robotics}`, t.admin))
    ok(await patch(`${CLUBS}/${t.robotics}`, t.admin, { capacity: 2 }, robotics.version))
    const members = () =>
      db
        .select()
        .from(schoolClubMembers)
        .where(and(eq(schoolClubMembers.institutionId, t.id), isNull(schoolClubMembers.archivedAt)))
    const before = (await members()).length
    assertError(
      await post(`${url}/confirm`, t.admin, { digest: preview.digest }),
      409,
      'club_selection_preview_stale',
    )
    assert.equal((await members()).length, before)
    ok(await remove(`${CLUBS}/${t.drama}/members/${String(extra.id)}`, t.admin, extra.version))
    const beforeConfirm = (await members()).length

    const fresh = ok(await get(`${url}/allocation`, t.admin))
    assert.equal((fresh.assignments as Json[]).length, 3)
    const confirmKey = randomUUID()
    const confirmed = ok(
      await post(`${url}/confirm`, t.admin, { digest: fresh.digest }, confirmKey),
    )
    assert.equal(confirmed.phase, 'confirmed')
    const again = await post(`${url}/confirm`, t.admin, { digest: fresh.digest }, confirmKey)
    assert.equal(again.headers['idempotent-replayed'], 'true')
    assertError(
      await post(`${url}/confirm`, t.admin, { digest: fresh.digest }),
      409,
      'club_selection_already_confirmed',
    )
    assertError(await get(`${url}/allocation`, t.admin), 409, 'club_selection_already_confirmed')
    assertError(await post(`${url}/draw`, t.admin), 409, 'club_selection_already_confirmed')
    const rows = await members()
    assert.equal(rows.length, beforeConfirm + 3)
    const byClub = (clubId: string) => rows.filter((row) => row.clubId === clubId).length
    assert.equal(byClub(t.robotics), 2)
    assert.equal(byClub(t.chess), 2)
    assert.equal(rows.filter((row) => row.studentId === 's5').length, 1)
    const results = await db
      .select()
      .from(clubSelectionResults)
      .where(eq(clubSelectionResults.institutionId, t.id))
    assert.equal(results.filter((row) => row.outcome === 'assigned').length, 3)
    assert.ok(results.filter((row) => row.outcome === 'assigned').every((row) => row.memberId))

    const result = confirmed.result as { clubs: Json[]; assignedCount: number }
    assert.equal(result.assignedCount, 3)
    const chess = result.clubs.find((club) => club.clubId === t.chess) as Json
    const chessWaitlist = chess.waitlist as Json[]
    assert.equal(chessWaitlist.length, 1)
    assert.equal(chess.suggestedStudentId, null)
    // Satranç'tan biri ayrılınca yedekteki ilk öğrenci önerilir; otomatik eklenmez.
    const leaver = rows.find((row) => row.clubId === t.chess && row.studentId !== 's5')
    assert.ok(leaver)
    ok(await remove(`${CLUBS}/${t.chess}/members/${leaver.id}`, t.admin, leaver.version))
    const after = ok(await get(url, t.admin))
    const chessAfter = (after.result as { clubs: Json[] }).clubs.find(
      (club) => club.clubId === t.chess,
    ) as Json
    assert.equal(chessAfter.suggestedStudentId, chessWaitlist[0]?.studentId)
    assert.equal(typeof chessAfter.suggestedStudentName, 'string')
    assert.equal((await members()).length, beforeConfirm + 2)

    const parent = await signInAs(
      app,
      await createMember(app, t.id, 'veli', [{ kind: 'child', recordId: 's5' }]),
    )
    const view = ok(await get(MY, parent)) as unknown as Json[]
    assert.equal(view[0]?.phase, 'confirmed')
    const s5 = (view[0]?.students as Json[])[0]
    assert.deepEqual([s5?.assignedClubIds, s5?.waitlist], [[], []])

    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.institutionId, t.id), eq(auditLog.entityType, 'club_selection_periods')),
      )
    assert.ok(audits.some((row) => row.action === 'finance.club_selection.draw'))
    assert.ok(audits.some((row) => row.action === 'finance.club_selection.confirm'))
  })

  test('DOM-FIN-150: aynı tohum ve veriyle dağıtım iki kurumda da aynı sırayı izler; tercihsiz dönemde kura yok (K-506)', async () => {
    const t = await institution()
    const empty = ok(await post(PERIODS, t.admin, periodBody(t, { name: 'Boş dönem' })), 201)
    now = CLOSED
    assertError(
      await post(`${periodUrl(empty.id)}/draw`, t.admin),
      422,
      'club_selection_no_preferences',
    )
    const [row] = await db
      .select()
      .from(clubSelectionPeriods)
      .where(eq(clubSelectionPeriods.id, String(empty.id)))
    assert.equal(row?.seed, null)
  })

  test('DOM-FIN-150: başka kurumun tercih dönemi 404 ve B değişmez; listede yok; institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bPeriod = ok(await post(PERIODS, b.admin, periodBody(b)), 201)
    ok(await choose(b, bPeriod, 's1', [b.chess]))
    const bUrl = periodUrl(bPeriod.id)
    const bDetail = ok(await get(bUrl, b.admin))
    assertError(await get(bUrl, a.admin), 404)
    assertError(await patch(bUrl, a.admin, { name: 'Ele geçirildi' }, bDetail.version), 404)
    assertError(await remove(bUrl, a.admin, bDetail.version), 404)
    assertError(
      await post(`${bUrl}/preferences`, a.admin, { studentId: 's2', choices: [b.chess] }),
      404,
    )
    assertError(await get(`${bUrl}/allocation`, a.admin), 404)
    now = CLOSED
    assertError(await post(`${bUrl}/draw`, a.admin), 404)
    assertError(await post(`${bUrl}/confirm`, a.admin, { digest: '0'.repeat(14) }), 404)
    now = FIXED_NOW
    assert.equal((await get(PERIODS, a.admin)).json().meta.total, 0)
    // B'nin kulübü A'nın dönemine giremez; gövdedeki kurum kimliği reddedilir.
    assertError(
      await post(PERIODS, a.admin, periodBody(a, { clubIds: [b.chess], maxChoices: 1 })),
      422,
      'club_selection_club_not_found',
    )
    assertError(await post(PERIODS, a.admin, periodBody(a, { institutionId: b.id })), 400)
    // Aynı öğrenci kimliği (s1) B'de tercih yaptı; A'nın velisi B'nin dönemini görmez.
    const aParent = await signInAs(
      app,
      await createMember(app, a.id, 'veli', [{ kind: 'child', recordId: 's1' }]),
    )
    assert.deepEqual(ok(await get(MY, aParent)), [])
    const [bRow] = await db
      .select()
      .from(clubSelectionPeriods)
      .where(eq(clubSelectionPeriods.institutionId, b.id))
    assert.equal(bRow?.name, 'Güz kulüp tercihi')
    assert.equal(bRow?.seed, null)
    assert.equal(bRow?.archivedAt, null)
    const bPreferences = await db
      .select()
      .from(clubSelectionPreferences)
      .where(
        and(
          eq(clubSelectionPreferences.institutionId, b.id),
          isNull(clubSelectionPreferences.archivedAt),
        ),
      )
    assert.equal(bPreferences.length, 1)
  })
})
