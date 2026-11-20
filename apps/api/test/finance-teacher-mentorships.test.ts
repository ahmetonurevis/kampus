import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { staffJobOffers } from '../src/db/schema/finance-staff-onboarding.ts'
import {
  teacherMentorshipMeetings,
  teacherMentorships,
} from '../src/db/schema/finance-teacher-mentorships.ts'
import { ensureMember } from '../src/services/identity.ts'
import {
  buildTestApp,
  createInstitution,
  createTestDatabase,
  createUser,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
  type InstitutionOverrides,
} from './support/app.ts'

/**
 * Yeni öğretmen mentorluğu uçları (DOM-FIN-136; ON-219; K-463…K-465). Her test kendi kurumunu
 * kurar. FIXED_NOW 2026-10-06.
 */

const MENTORSHIPS = '/api/v1/finance/teacher-mentorships'
const SETTINGS = '/api/v1/finance/teacher-mentorship-settings'
const SUMMARY = '/api/v1/finance/teacher-mentorship-summary'
const MEETING = { meetingDate: '2026-10-02', durationMinutes: 40, topic: 'İlk hafta' }

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-136: yeni öğretmen mentorluğu uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.219.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(
    method: 'GET' | 'POST' | 'PATCH',
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
  const key = () => ({ 'idempotency-key': randomUUID() })
  const ifMatch = (version: unknown) => ({ 'if-match': `"${String(version)}"` })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.219.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  async function person(t: Tenant, role: Role, name: string) {
    const user = await createUser(app, { name })
    const membership = await ensureMember(app.auth, db, {
      institutionId: t.id,
      userId: user.id,
      role,
    })
    return { membershipId: membership.id, user }
  }
  async function pair(t: Tenant) {
    const mentor = await person(t, 'ogretmen', 'Selin Kaya')
    const mentee = await person(t, 'ogretmen', 'Deniz Er')
    return { mentor, mentee }
  }

  const open = (cookie: string | null, body: Json, headers: Record<string, string> = key()) =>
    call(
      'POST',
      MENTORSHIPS,
      cookie,
      { startDate: '2026-09-01', endDate: '2027-06-30', ...body },
      headers,
    )
  const meet = (cookie: string | null, row: Json, body: Json = MEETING) =>
    call('POST', `${MENTORSHIPS}/${String(row.id)}/meetings`, cookie, body, {
      ...key(),
      ...ifMatch(row.version),
    })
  const itemUrl = (row: Json, itemId: unknown, verb: string) =>
    `${MENTORSHIPS}/${String(row.id)}/checklist/${String(itemId)}/${verb}`
  const tick = (cookie: string | null, row: Json, itemId: unknown, verb = 'complete') =>
    call('POST', itemUrl(row, itemId, verb), cookie, {}, ifMatch(row.version))
  const finish = (cookie: string | null, row: Json, closedOn = '2026-10-05') =>
    call(
      'POST',
      `${MENTORSHIPS}/${String(row.id)}/complete`,
      cookie,
      { closedOn },
      ifMatch(row.version),
    )
  const endEarly = (cookie: string | null, row: Json, body: Json) =>
    call('POST', `${MENTORSHIPS}/${String(row.id)}/end`, cookie, body, ifMatch(row.version))
  const items = (row: Json) => row.checklistItems as Json[]
  const rowsOf = (institutionId: string) =>
    db.select().from(teacherMentorships).where(eq(teacherMentorships.institutionId, institutionId))

  test('kimliksiz istek 401', async () => {
    const row = { id: randomUUID(), version: 1 }
    assertError(await call('GET', MENTORSHIPS, null), 401)
    assertError(await call('GET', SETTINGS, null), 401)
    assertError(await call('GET', SUMMARY, null), 401)
    assertError(await open(null, {}), 401)
    assertError(await meet(null, row), 401)
    assertError(await finish(null, row), 401)
  })

  test('DOM-FIN-136 K-463 K-464 K-465: eşleşme, görüşme, kontrol listesi ve tamamlama kilidi', async () => {
    const t = await institution()
    const { mentor, mentee } = await pair(t)
    const settings = ok(await call('GET', SETTINGS, t.admin))
    assert.equal(settings.isDefault, true)
    assert.equal(settings.maxActivePerMentor, 3)
    const headers = key()
    let row = ok(
      await open(
        t.admin,
        { mentorMembershipId: mentor.membershipId, menteeMembershipId: mentee.membershipId },
        headers,
      ),
      201,
    )
    const replay = await open(
      t.admin,
      { mentorMembershipId: mentor.membershipId, menteeMembershipId: mentee.membershipId },
      headers,
    )
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal((await rowsOf(t.id)).length, 1)
    assert.equal(row.status, 'active')
    assert.equal(row.mentorName, 'Selin Kaya')
    assert.equal(items(row).length, 5)
    assert.deepEqual(row.checklist, {
      total: 5,
      done: 0,
      requiredTotal: 4,
      requiredDone: 0,
      percent: 0,
    })

    assertError(await finish(t.admin, row), 422, 'mentorship_no_meetings')
    assertError(
      await call('POST', `${MENTORSHIPS}/${String(row.id)}/meetings`, t.admin, MEETING, key()),
      400,
      'if_match_required',
    )
    assertError(
      await meet(t.admin, row, { ...MEETING, meetingDate: '2026-10-07' }),
      422,
      'mentorship_meeting_date_future',
    )
    assertError(
      await meet(t.admin, row, { ...MEETING, meetingDate: '2026-08-31' }),
      422,
      'mentorship_meeting_before_start',
    )
    row = ok(
      await meet(t.admin, row, {
        ...MEETING,
        note: 'Sınıf yönetimi kaygısı',
        nextStep: 'Ders izle',
      }),
      201,
    )
    assert.equal(row.meetingCount, 1)
    assert.equal(row.lastMeetingDate, '2026-10-02')
    assert.equal(row.daysSinceContact, 4)
    assert.equal(row.overdue, false)
    assertError(await finish(t.admin, row), 422, 'mentorship_checklist_incomplete')

    for (const item of items(row).filter((entry) => entry.required === true))
      row = ok(await tick(t.admin, row, item.id))
    const first = items(row)[0]
    assert.equal(first?.completedByName !== null, true)
    assert.equal(first?.completedAt, FIXED_NOW.toISOString())
    assertError(await tick(t.admin, row, first?.id), 422, 'mentorship_item_completed')
    row = ok(await tick(t.admin, row, first?.id, 'reopen'))
    assert.equal(items(row)[0]?.completedAt, null)
    assertError(await tick(t.admin, row, first?.id, 'reopen'), 422, 'mentorship_item_not_completed')
    row = ok(await tick(t.admin, row, first?.id))
    assert.equal((row.checklist as Json).percent, 80)
    assertError(await finish(t.admin, row, '2026-10-07'), 422, 'mentorship_close_date_future')
    assertError(await finish(t.admin, { ...row, version: 1 }), 409)

    row = ok(await finish(t.admin, row))
    assert.equal(row.status, 'completed')
    assert.equal(row.closedOn, '2026-10-05')
    assert.equal(row.overdue, false)
    assertError(await meet(t.admin, row), 409, 'mentorship_closed')
    assertError(await tick(t.admin, row, first?.id, 'reopen'), 409, 'mentorship_closed')
    assertError(await endEarly(t.admin, row, { closedOn: '2026-10-05', reason: 'Neden yok' }), 409)

    ok(await call('GET', `${MENTORSHIPS}/${String(row.id)}`, t.admin))
    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, t.id),
          eq(auditLog.action, 'finance.teacher_mentorship.read'),
        ),
      )
    assert.equal(audits.length, 1)
    const writes = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, t.id),
          eq(auditLog.action, 'finance.teacher_mentorship.meeting'),
        ),
      )
    assert.equal(writes.length, 1)
    assert.equal(JSON.stringify(writes[0]?.changes).includes('kaygısı'), false)
  })

  test('DOM-FIN-136 K-463: aynı kişi, süren eşleşme, mentor sınırı, rol ve günler reddedilir', async () => {
    const t = await institution()
    const { mentor, mentee } = await pair(t)
    const second = await person(t, 'ogretmen', 'Ece Tan')
    const desk = await person(t, 'onburo', 'Ön Büro')
    assertError(
      await open(t.admin, {
        mentorMembershipId: mentor.membershipId,
        menteeMembershipId: mentor.membershipId,
      }),
      422,
      'mentorship_self',
    )
    assertError(
      await open(t.admin, {
        mentorMembershipId: mentor.membershipId,
        menteeMembershipId: desk.membershipId,
      }),
      422,
      'mentorship_mentee_not_teacher',
    )
    assertError(
      await open(t.admin, {
        mentorMembershipId: desk.membershipId,
        menteeMembershipId: mentee.membershipId,
      }),
      422,
      'mentorship_mentor_invalid',
    )
    assertError(
      await open(t.admin, {
        mentorMembershipId: mentor.membershipId,
        menteeMembershipId: mentee.membershipId,
        endDate: '2026-09-01',
      }),
      422,
      'mentorship_dates_invalid',
    )
    assertError(
      await open(t.admin, {
        mentorMembershipId: mentor.membershipId,
        menteeMembershipId: mentee.membershipId,
        endDate: '2027-09-03',
      }),
      422,
      'mentorship_too_long',
    )
    const settings = ok(
      await call('PATCH', SETTINGS, t.admin, {
        maxActivePerMentor: 1,
        checklistItems: [{ label: 'Tanışma', required: true }],
      }),
    )
    assert.equal(settings.version, 1)
    assertError(
      await call('PATCH', SETTINGS, t.admin, { maxActivePerMentor: 2, checklistItems: [] }),
      409,
    )
    const row = ok(
      await open(t.admin, {
        mentorMembershipId: mentor.membershipId,
        menteeMembershipId: mentee.membershipId,
      }),
      201,
    )
    assert.deepEqual(
      items(row).map((item) => item.label),
      ['Tanışma'],
    )
    assertError(
      await open(t.admin, {
        mentorMembershipId: second.membershipId,
        menteeMembershipId: mentee.membershipId,
      }),
      409,
      'mentorship_mentee_has_active',
    )
    assertError(
      await open(t.admin, {
        mentorMembershipId: mentor.membershipId,
        menteeMembershipId: second.membershipId,
      }),
      422,
      'mentorship_mentor_limit',
    )
    assertError(await endEarly(t.admin, row, { closedOn: '2026-10-01' }), 400)
    const ended = ok(
      await endEarly(t.admin, row, { closedOn: '2026-10-01', reason: 'Kurumdan ayrıldı' }),
    )
    assert.equal(ended.status, 'ended_early')
    assert.equal(ended.endReason, 'Kurumdan ayrıldı')
    ok(
      await open(t.admin, {
        mentorMembershipId: mentor.membershipId,
        menteeMembershipId: second.membershipId,
      }),
      201,
    )
    assert.equal((await rowsOf(t.id)).length, 2)
    const frontDesk = await signInAs(app, desk.user)
    assertError(await call('GET', MENTORSHIPS, frontDesk), 403)
    assertError(await call('GET', SUMMARY, frontDesk), 403)
    const teacher = await signInAs(app, mentor.user)
    assertError(await call('GET', `${MENTORSHIPS}/${String(row.id)}`, teacher), 403)
    assertError(
      await open(teacher, {
        mentorMembershipId: mentor.membershipId,
        menteeMembershipId: mentee.membershipId,
      }),
      403,
    )
  })

  test('DOM-FIN-136 K-465: görüşmesi 30 günü aşan eşleşme gecikir; özet ve tamamlanma oranı', async () => {
    const t = await institution()
    const { mentor, mentee } = await pair(t)
    const other = await person(t, 'ogretmen', 'Ece Tan')
    let late = ok(
      await open(t.admin, {
        mentorMembershipId: mentor.membershipId,
        menteeMembershipId: mentee.membershipId,
        startDate: '2026-08-01',
      }),
      201,
    )
    const fresh = ok(
      await open(t.admin, {
        mentorMembershipId: mentor.membershipId,
        menteeMembershipId: other.membershipId,
        startDate: '2026-09-15',
      }),
      201,
    )
    assert.equal(late.overdue, true)
    assert.equal(late.daysSinceContact, 66)
    assert.equal(fresh.overdue, false)
    const overdueList = (await call('GET', `${MENTORSHIPS}?overdue=true`, t.admin)).json() as {
      data: Json[]
    }
    assert.deepEqual(
      overdueList.data.map((item) => item.id),
      [late.id],
    )
    late = ok(await meet(t.admin, late, { ...MEETING, meetingDate: '2026-09-05' }), 201)
    // 2026-09-05 → 2026-10-06: 31 gün, hâlâ gecikmiş.
    assert.equal(late.overdue, true)
    late = ok(await tick(t.admin, late, items(late)[0]?.id))
    let summary = ok(await call('GET', SUMMARY, t.admin))
    assert.deepEqual(summary, {
      active: 2,
      overdue: 1,
      completed: 0,
      endedEarly: 0,
      activeChecklistPercent: 10,
    })
    const meetingId = randomUUID()
    late = ok(await meet(t.admin, late, { ...MEETING, meetingDate: '2026-09-06' }), 201)
    assert.equal(late.overdue, false)
    const meetings = late.meetings as Json[]
    assert.equal(meetings.length, 2)
    assertError(
      await call(
        'POST',
        `${MENTORSHIPS}/${String(late.id)}/meetings/${meetingId}/archive`,
        t.admin,
        {},
        ifMatch(late.version),
      ),
      404,
    )
    late = ok(
      await call(
        'POST',
        `${MENTORSHIPS}/${String(late.id)}/meetings/${String(meetings[0]?.id)}/archive`,
        t.admin,
        {},
        ifMatch(late.version),
      ),
    )
    assert.equal(late.overdue, true)
    assert.equal(late.lastMeetingDate, '2026-09-05')
    summary = ok(await call('GET', SUMMARY, t.admin))
    assert.equal(summary.overdue, 1)
    const stored = await db
      .select()
      .from(teacherMentorshipMeetings)
      .where(eq(teacherMentorshipMeetings.institutionId, t.id))
    assert.equal(stored.filter((meeting) => meeting.archivedAt !== null).length, 1)
  })

  test('DOM-FIN-136 K-463: işe başlama listesine bağlanır; başka öğretmenin listesi reddedilir', async () => {
    const t = await institution()
    const { mentor, mentee } = await pair(t)
    const offerId = randomUUID()
    await db.insert(staffJobOffers).values({
      institutionId: t.id,
      id: offerId,
      membershipId: mentee.membershipId,
      position: 'İngilizce öğretmeni',
      staffRole: 'ogretmen',
      startDate: '2026-09-01',
      wageType: 'monthly_gross',
      offeredAmountCents: 5_000_000,
      status: 'accepted',
      sentOn: '2026-08-10',
      acceptedOn: '2026-08-12',
      createdByUserId: 'test',
    })
    assertError(
      await open(t.admin, {
        mentorMembershipId: mentee.membershipId,
        menteeMembershipId: mentor.membershipId,
        onboardingOfferId: offerId,
      }),
      422,
      'mentorship_onboarding_mismatch',
    )
    assertError(
      await open(t.admin, {
        mentorMembershipId: mentor.membershipId,
        menteeMembershipId: mentee.membershipId,
        onboardingOfferId: randomUUID(),
      }),
      422,
      'mentorship_onboarding_not_found',
    )
    const row = ok(
      await open(t.admin, {
        mentorMembershipId: mentor.membershipId,
        menteeMembershipId: mentee.membershipId,
        onboardingOfferId: offerId,
      }),
      201,
    )
    assert.equal(row.onboardingOfferId, offerId)
    assert.equal(row.onboardingPosition, 'İngilizce öğretmeni')
  })

  test('DOM-FIN-136: başka kurumun eşleşmesi, görüşmesi ve maddesi 404 ve değişmez; gövdedeki institutionId 400', async () => {
    const a = await institution()
    const b = await institution()
    const pairB = await pair(b)
    const rowB = ok(
      await open(b.admin, {
        mentorMembershipId: pairB.mentor.membershipId,
        menteeMembershipId: pairB.mentee.membershipId,
      }),
      201,
    )
    const withMeeting = ok(await meet(b.admin, rowB), 201)
    const meetingB = (withMeeting.meetings as Json[])[0]?.id
    const itemB = items(withMeeting)[0]?.id
    assertError(await call('GET', `${MENTORSHIPS}/${String(rowB.id)}`, a.admin), 404)
    assertError(await meet(a.admin, withMeeting), 404)
    assertError(await tick(a.admin, withMeeting, itemB), 404)
    assertError(await tick(a.admin, withMeeting, itemB, 'reopen'), 404)
    assertError(await finish(a.admin, withMeeting), 404)
    assertError(
      await endEarly(a.admin, withMeeting, { closedOn: '2026-10-01', reason: 'Başka kurum' }),
      404,
    )
    const archiveB = `${MENTORSHIPS}/${String(rowB.id)}/meetings/${String(meetingB)}/archive`
    assertError(await call('POST', archiveB, a.admin, {}, ifMatch(withMeeting.version)), 404)
    assertError(
      await open(a.admin, {
        mentorMembershipId: pairB.mentor.membershipId,
        menteeMembershipId: pairB.mentee.membershipId,
      }),
      422,
      'mentorship_mentor_not_found',
    )
    const pairA = await pair(a)
    assertError(
      await open(a.admin, {
        mentorMembershipId: pairA.mentor.membershipId,
        menteeMembershipId: pairA.mentee.membershipId,
        institutionId: b.id,
      }),
      400,
    )
    assertError(
      await call('PATCH', SETTINGS, a.admin, {
        maxActivePerMentor: 2,
        checklistItems: [],
        institutionId: b.id,
      }),
      400,
    )
    const ownA = ok(
      await open(a.admin, {
        mentorMembershipId: pairA.mentor.membershipId,
        menteeMembershipId: pairA.mentee.membershipId,
      }),
      201,
    )
    assertError(await tick(a.admin, ownA, itemB), 404)
    const list = (await call('GET', MENTORSHIPS, a.admin)).json() as { data: Json[] }
    assert.deepEqual(
      list.data.map((item) => item.id),
      [ownA.id],
    )
    const summary = ok(await call('GET', SUMMARY, a.admin))
    assert.equal(summary.active, 1)
    const settingsA = ok(await call('GET', SETTINGS, a.admin))
    assert.equal(settingsA.isDefault, true)
    const [stored] = await rowsOf(b.id)
    assert.equal(stored?.version, withMeeting.version)
    assert.equal(stored?.status, 'active')
  })

  test('DOM-FIN-136: finance modülü kapalıyken 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await call('GET', MENTORSHIPS, closed.admin), 403, 'module_disabled')
    assertError(await open(closed.admin, {}), 403, 'module_disabled')
  })
})
