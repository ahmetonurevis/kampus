import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { memberships } from '../src/db/schema/auth.ts'
import {
  departmentMeetingAttendees,
  departmentMeetingDecisions,
  departmentMeetings,
} from '../src/db/schema/finance-department-meetings.ts'
import { ensureMember } from '../src/services/identity.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  createUser,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
  type InstitutionOverrides,
} from './support/app.ts'

/**
 * Zümre toplantısı tutanağı uçları (DOM-FIN-132; ON-217; K-451…K-453). Her test kendi kurumunu
 * kurar. Bugün (İstanbul) `FIXED_NOW` günü: 2026-10-06.
 */

const URL = '/api/v1/finance/department-meetings'
const DECISIONS_URL = '/api/v1/finance/department-meeting-decisions'
const SUBJECTS_URL = '/api/v1/finance/department-meeting-subjects'

type Json = Record<string, unknown>
type AgendaItem = { id: string; title: string; discussion: string | null }
type Attendee = { membershipId: string; status: string; name: string; active: boolean }
type Decision = Json & { id: string; version: number; status: string; number: string }
type Meeting = Json & {
  id: string
  version: number
  status: string
  agenda: AgendaItem[]
  attendees: Attendee[]
  decisions: Decision[]
}
type Response = Awaited<ReturnType<App['inject']>>
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

describe('DOM-FIN-132: zümre toplantısı tutanağı uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.217.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  const key = () => ({ 'idempotency-key': randomUUID() })
  const ifMatch = (version: unknown) => ({ 'if-match': `"${String(version)}"` })
  function call(
    method: Method,
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
  function ok<T = Json>(response: Response, status = 200): T {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as T
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.217.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    const t = { id: created.id, admin: await signInAs(app, created.admin) }
    return {
      ...t,
      chair: await person(t.id, 'ogretmen', 'Selin Kaya'),
      teacher: await person(t.id, 'ogretmen', 'Mert Aydın'),
    }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  async function person(institutionId: string, role: Role, name: string) {
    const user = await createUser(app, { name })
    const membership = await ensureMember(app.auth, db, { institutionId, userId: user.id, role })
    return membership.id
  }
  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))

  const bodyFor = (t: Tenant, extra: Json = {}) => ({
    subjectId: 'math',
    kind: 'term_start',
    meetingDate: '2026-09-10',
    location: 'Öğretmenler odası',
    chairMembershipId: t.chair,
    agenda: [
      { title: 'Açılış ve yoklama' },
      {
        title: 'Yıllık planların incelenmesi',
        discussion: 'Planlar kazanımlara göre gözden geçirildi.',
      },
    ],
    attendees: [
      { membershipId: t.chair, status: 'attended' },
      { membershipId: t.teacher, status: 'excused' },
    ],
    ...extra,
  })
  /** Kayıtlı tutanağın gövdesi: gündem kimlikleriyle. */
  const bodyOf = (t: Tenant, meeting: Meeting, extra: Json = {}) =>
    bodyFor(t, {
      agenda: meeting.agenda.map((item) => ({ ...item })),
      attendees: meeting.attendees.map(({ membershipId, status }) => ({ membershipId, status })),
      ...extra,
    })
  const create = (cookie: string, body: Json, headers: Record<string, string> = key()) =>
    call('POST', URL, cookie, body, headers)
  const draft = async (t: Tenant, extra: Json = {}) =>
    ok<Meeting>(await create(t.admin, bodyFor(t, extra)), 201)
  const urlOf = (meeting: { id: string }) => `${URL}/${meeting.id}`
  const patch = (cookie: string, meeting: Meeting, body: Json) =>
    call('PATCH', urlOf(meeting), cookie, body, ifMatch(meeting.version))
  const finalize = (cookie: string, meeting: Meeting, signedDate = '2026-09-12') =>
    call('POST', `${urlOf(meeting)}/finalize`, cookie, { signedDate }, ifMatch(meeting.version))
  const decide = (
    cookie: string,
    meeting: { id: string },
    body: Json,
    headers: Record<string, string> = key(),
  ) => call('POST', `${urlOf(meeting)}/decisions`, cookie, body, headers)
  const decisionUrl = (meeting: { id: string }, decision: { id: string }) =>
    `${urlOf(meeting)}/decisions/${decision.id}`
  const followUp = (cookie: string, meeting: { id: string }, decision: Decision, body: Json) =>
    call(
      'POST',
      `${decisionUrl(meeting, decision)}/follow-up`,
      cookie,
      body,
      ifMatch(decision.version),
    )
  const decisionBody = (t: Tenant, meeting: Meeting, extra: Json = {}) => ({
    agendaItemId: meeting.agenda[1]?.id,
    text: 'Ortak yazılı sınav takvimi hazırlanacak.',
    responsibleMembershipId: t.teacher,
    dueDate: '2026-09-30',
    ...extra,
  })

  const meetingRows = (institutionId: string) =>
    db.select().from(departmentMeetings).where(eq(departmentMeetings.institutionId, institutionId))
  const attendeeRows = (institutionId: string) =>
    db
      .select()
      .from(departmentMeetingAttendees)
      .where(eq(departmentMeetingAttendees.institutionId, institutionId))
  const decisionRows = (institutionId: string) =>
    db
      .select()
      .from(departmentMeetingDecisions)
      .where(eq(departmentMeetingDecisions.institutionId, institutionId))
  const auditOf = (institutionId: string, action: string) =>
    db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))
  const listOf = async (cookie: string, url = URL) => {
    const response = await get(url, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Json[]; meta: { total: number } }
  }

  test('kimliksiz istek 401', async () => {
    const item = `${URL}/${randomUUID()}`
    const decision = `${item}/decisions/${randomUUID()}`
    assertError(await get(URL, null), 401)
    assertError(await get(SUBJECTS_URL, null), 401)
    assertError(await get(DECISIONS_URL, null), 401)
    assertError(await get(item, null), 401)
    assertError(await call('POST', URL, null, {}, key()), 401)
    assertError(await call('PATCH', item, null, {}, ifMatch(1)), 401)
    assertError(await call('POST', `${item}/finalize`, null, {}, ifMatch(1)), 401)
    assertError(await call('POST', `${item}/decisions`, null, {}, key()), 401)
    assertError(await call('PATCH', decision, null, {}, ifMatch(1)), 401)
    assertError(await call('DELETE', decision, null, undefined, ifMatch(1)), 401)
    assertError(await call('POST', `${decision}/follow-up`, null, {}, ifMatch(1)), 401)
  })

  test('DOM-FIN-132: K-451 yalnız yönetici; ön büro, öğretmen, veli ve öğrenci 403, kayıt açılmaz', async () => {
    const t = await institution()
    const meeting = await draft(t)
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(URL, cookie), 403)
      assertError(await get(SUBJECTS_URL, cookie), 403)
      assertError(await get(DECISIONS_URL, cookie), 403)
      assertError(await get(urlOf(meeting), cookie), 403)
      assertError(await create(cookie, bodyFor(t)), 403)
      assertError(await patch(cookie, meeting, bodyOf(t, meeting)), 403)
      assertError(await decide(cookie, meeting, decisionBody(t, meeting)), 403)
    }
    assert.equal((await meetingRows(t.id)).length, 1)
    assert.equal((await decisionRows(t.id)).length, 0)
  })

  test('DOM-FIN-132: finance modülü kapalıyken uçlar 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(URL, closed.admin), 403, 'module_disabled')
    assertError(await create(closed.admin, bodyFor(closed)), 403, 'module_disabled')
    assertError(await get(DECISIONS_URL, closed.admin), 403, 'module_disabled')
  })

  test('DOM-FIN-132: K-452 taslak tutanak, zümre ve kişi denetimi, Idempotency-Key, denetimde alan adı', async () => {
    const t = await institution()
    const subjects = ok<{ id: string; name: string }[]>(await get(SUBJECTS_URL, t.admin))
    assert.ok(subjects.some((subject) => subject.id === 'math' && subject.name === 'Matematik'))

    assertError(await create(t.admin, bodyFor(t), {}), 400)
    assertError(await create(t.admin, bodyFor(t, { agenda: [] })), 400)
    assertError(await create(t.admin, bodyFor(t, { chairMembershipId: t.teacher })), 400)
    assertError(
      await create(t.admin, bodyFor(t, { subjectId: 'yok-boyle-ders' })),
      422,
      'department_meeting_subject_not_found',
    )
    const front = await person(t.id, 'onburo', 'Ön Büro')
    assertError(
      await create(
        t.admin,
        bodyFor(t, {
          attendees: [
            { membershipId: t.chair, status: 'attended' },
            { membershipId: front, status: 'attended' },
          ],
        }),
      ),
      422,
      'department_meeting_not_staff',
    )
    const left = await person(t.id, 'ogretmen', 'Ayrılan Öğretmen')
    await db.update(memberships).set({ deactivatedAt: FIXED_NOW }).where(eq(memberships.id, left))
    const withLeft = bodyFor(t, {
      attendees: [
        { membershipId: t.chair, status: 'attended' },
        { membershipId: left, status: 'absent' },
      ],
    })
    const inactive = await create(t.admin, withLeft)
    assertError(inactive, 422, 'department_meeting_staff_inactive')
    assert.deepEqual(inactive.json().issues?.[0]?.path ?? inactive.json().path, [
      'attendees',
      '1',
      'membershipId',
    ])
    assertError(
      await create(
        t.admin,
        bodyFor(t, {
          attendees: [
            { membershipId: t.chair, status: 'attended' },
            { membershipId: randomUUID(), status: 'absent' },
          ],
        }),
      ),
      422,
      'department_meeting_staff_not_found',
    )
    assert.equal((await meetingRows(t.id)).length, 0)
    assert.equal((await attendeeRows(t.id)).length, 0)

    const headers = key()
    const meeting = ok<Meeting>(await create(t.admin, bodyFor(t), headers), 201)
    const replay = await create(t.admin, bodyFor(t), headers)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal((await meetingRows(t.id)).length, 1)
    assert.equal(meeting.status, 'draft')
    assert.equal(meeting.subjectName, 'Matematik')
    assert.equal(meeting.chairName, 'Selin Kaya')
    assert.equal(meeting.agendaCount, 2)
    assert.equal(meeting.attendedCount, 1)
    assert.deepEqual(
      meeting.attendees.map((row) => [row.name, row.status]),
      [
        ['Mert Aydın', 'excused'],
        ['Selin Kaya', 'attended'],
      ],
    )
    assert.equal(meeting.agenda[0]?.discussion, null)
    const [audit] = await auditOf(t.id, 'finance.department_meeting.create')
    assert.ok(audit?.changes?.fields?.includes('agenda'))
    assert.ok(!JSON.stringify(audit?.changes).includes('Planlar'))

    // Düzeltme: madde sırası değişir, yeni madde kimlik alır, katılımcı çıkar ve eklenir.
    const third = await person(t.id, 'ogretmen', 'Zeynep Arslan')
    const [first, second] = meeting.agenda
    assert.ok(first && second)
    const updated = ok<Meeting>(
      await patch(
        t.admin,
        meeting,
        bodyOf(t, meeting, {
          kind: 'interim',
          agenda: [second, first, { title: 'Dilek ve temenniler' }],
          attendees: [
            { membershipId: t.chair, status: 'attended' },
            { membershipId: third, status: 'absent' },
          ],
        }),
      ),
    )
    assert.equal(updated.version, meeting.version + 1)
    assert.equal(updated.kind, 'interim')
    assert.deepEqual(
      updated.agenda.slice(0, 2).map((item) => item.id),
      [second.id, first.id],
    )
    assert.equal(updated.agenda.length, 3)
    assert.deepEqual(
      updated.attendees.map((row) => row.name),
      ['Selin Kaya', 'Zeynep Arslan'],
    )
    const rows = await attendeeRows(t.id)
    assert.equal(rows.length, 3)
    assert.equal(rows.filter((row) => row.archivedAt !== null).length, 1)
    assertError(await patch(t.admin, meeting, bodyOf(t, meeting)), 409)
    assertError(
      await patch(
        t.admin,
        updated,
        bodyOf(t, updated, { agenda: [{ id: randomUUID(), title: 'Yabancı madde' }] }),
      ),
      422,
      'department_meeting_agenda_unknown',
    )
    const [stored] = await meetingRows(t.id)
    assert.equal(stored?.version, updated.version)
  })

  test('DOM-FIN-132: K-452 kararlar gündem maddesine bağlı; termin ve sorumlu denetimi; kaldırma', async () => {
    const t = await institution()
    const meeting = await draft(t)
    assertError(await decide(t.admin, meeting, decisionBody(t, meeting), {}), 400)
    assertError(
      await decide(t.admin, meeting, decisionBody(t, meeting, { agendaItemId: randomUUID() })),
      422,
      'department_meeting_agenda_not_found',
    )
    assertError(
      await decide(t.admin, meeting, decisionBody(t, meeting, { dueDate: '2026-09-01' })),
      422,
      'department_meeting_due_before_meeting',
    )
    const front = await person(t.id, 'onburo', 'Ön Büro')
    assertError(
      await decide(t.admin, meeting, decisionBody(t, meeting, { responsibleMembershipId: front })),
      422,
      'department_meeting_not_staff',
    )
    assert.equal((await decisionRows(t.id)).length, 0)

    const headers = key()
    const decision = ok<Decision>(
      await decide(t.admin, meeting, decisionBody(t, meeting), headers),
      201,
    )
    const replay = await decide(t.admin, meeting, decisionBody(t, meeting), headers)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal(decision.status, 'open')
    assert.equal(decision.number, '2.1')
    assert.equal(decision.responsibleName, 'Mert Aydın')
    const early = ok<Decision>(
      await decide(
        t.admin,
        meeting,
        decisionBody(t, meeting, { agendaItemId: meeting.agenda[0]?.id, dueDate: null }),
      ),
      201,
    )
    assert.equal(early.number, '1.1')

    const detail = ok<Meeting>(await get(urlOf(meeting), t.admin))
    assert.deepEqual(
      detail.decisions.map((row) => row.number),
      ['1.1', '2.1'],
    )
    assert.equal(detail.decisionCount, 2)

    // Kararı olan madde silinmez; toplantı günü terminden sonraya alınamaz.
    assertError(
      await patch(t.admin, detail, bodyOf(t, detail, { agenda: [detail.agenda[0]] })),
      422,
      'department_meeting_agenda_in_use',
    )
    assertError(
      await patch(t.admin, detail, bodyOf(t, detail, { meetingDate: '2026-10-01' })),
      422,
      'department_meeting_due_before_meeting',
    )

    const edited = ok<Decision>(
      await call(
        'PATCH',
        decisionUrl(meeting, decision),
        t.admin,
        decisionBody(t, meeting, { text: 'Ortak sınav takvimi ekim başında duyurulacak.' }),
        ifMatch(decision.version),
      ),
    )
    assert.equal(edited.text, 'Ortak sınav takvimi ekim başında duyurulacak.')
    assertError(
      await call(
        'DELETE',
        decisionUrl(meeting, decision),
        t.admin,
        undefined,
        ifMatch(decision.version),
      ),
      409,
    )
    assert.deepEqual(
      ok(
        await call(
          'DELETE',
          decisionUrl(meeting, early),
          t.admin,
          undefined,
          ifMatch(early.version),
        ),
      ),
      { id: early.id },
    )
    const after = ok<Meeting>(await get(urlOf(meeting), t.admin))
    assert.deepEqual(
      after.decisions.map((row) => row.id),
      [decision.id],
    )
    assert.equal((await decisionRows(t.id)).length, 2)
    assert.equal((await auditOf(t.id, 'finance.department_meeting.decision_remove')).length, 1)
    // Kaldırılan kararın maddesi artık silinebilir.
    ok<Meeting>(await patch(t.admin, after, bodyOf(t, after, { agenda: [after.agenda[1]] })))
  })

  test('DOM-FIN-132: K-453 kesinleşen tutanak değişmez; karar takibi, termini geçmiş kararlar', async () => {
    const t = await institution()
    const meeting = await draft(t)
    const late = ok<Decision>(await decide(t.admin, meeting, decisionBody(t, meeting)), 201)
    const later = ok<Decision>(
      await decide(
        t.admin,
        meeting,
        decisionBody(t, meeting, { dueDate: '2026-10-20', responsibleMembershipId: t.chair }),
      ),
      201,
    )
    assertError(
      await followUp(t.admin, meeting, late, { status: 'completed' }),
      409,
      'department_meeting_not_finalized',
    )
    assert.equal((await listOf(t.admin, DECISIONS_URL)).meta.total, 0)

    assertError(
      await finalize(t.admin, meeting, '2026-09-09'),
      422,
      'department_meeting_signed_before_meeting',
    )
    assertError(
      await finalize(t.admin, meeting, '2026-10-07'),
      422,
      'department_meeting_signed_in_future',
    )
    assertError(await finalize(t.admin, meeting, 'dun'), 400)
    const final = ok<Meeting>(await finalize(t.admin, meeting))
    assert.equal(final.status, 'finalized')
    assert.equal(final.signedDate, '2026-09-12')
    assert.equal(final.finalizedAt, FIXED_NOW.toISOString())
    assertError(await finalize(t.admin, final), 409, 'department_meeting_finalized')

    assertError(await patch(t.admin, final, bodyOf(t, final)), 409, 'department_meeting_finalized')
    assertError(
      await decide(t.admin, final, decisionBody(t, final)),
      409,
      'department_meeting_finalized',
    )
    assertError(
      await call(
        'PATCH',
        decisionUrl(final, late),
        t.admin,
        decisionBody(t, final, { text: 'Değişti' }),
        ifMatch(late.version),
      ),
      409,
      'department_meeting_finalized',
    )
    assertError(
      await call('DELETE', decisionUrl(final, late), t.admin, undefined, ifMatch(late.version)),
      409,
      'department_meeting_finalized',
    )

    // Termini geçmiş açık kararlar (bugün 2026-10-06).
    const overdue = await listOf(t.admin, `${DECISIONS_URL}?overdue=true`)
    assert.deepEqual(
      overdue.data.map((row) => [row.id, row.overdueDays, row.agendaTitle]),
      [[late.id, 6, 'Yıllık planların incelenmesi']],
    )
    assert.equal((await listOf(t.admin, DECISIONS_URL)).meta.total, 2)
    assert.equal(
      (await listOf(t.admin, `${DECISIONS_URL}?responsibleMembershipId=${t.chair}`)).data[0]?.id,
      later.id,
    )

    assertError(await followUp(t.admin, final, late, { status: 'cancelled' }), 400)
    const done = ok<Decision>(
      await followUp(t.admin, final, late, {
        status: 'completed',
        followUpNote: 'Takvim duyuruldu.',
      }),
    )
    assert.equal(done.status, 'completed')
    assert.equal(done.overdue, false)
    assert.equal((await listOf(t.admin, `${DECISIONS_URL}?overdue=true`)).meta.total, 0)
    const reopened = ok<Decision>(await followUp(t.admin, final, done, { status: 'open' }))
    const cancelled = ok<Decision>(
      await followUp(t.admin, final, reopened, {
        status: 'cancelled',
        followUpNote: 'Gerek kalmadı.',
      }),
    )
    assertError(
      await followUp(t.admin, final, cancelled, { status: 'open' }),
      409,
      'department_decision_cancelled',
    )
    assertError(
      await followUp(t.admin, final, later, { status: 'completed' }).then(() =>
        followUp(t.admin, final, later, { status: 'completed' }),
      ),
      409,
    )
    const [audit] = await auditOf(t.id, 'finance.department_meeting.finalize')
    assert.deepEqual(audit?.changes?.fields, ['status', 'signedDate'])

    // Veritabanı güvencesi: kesinleşen tutanağın ve karar metninin doğrudan değişikliği reddedilir.
    await assert.rejects(
      db
        .update(departmentMeetings)
        .set({ location: 'Başka yer' })
        .where(eq(departmentMeetings.id, final.id)),
    )
    await assert.rejects(
      db
        .update(departmentMeetingDecisions)
        .set({ text: 'Başka karar' })
        .where(eq(departmentMeetingDecisions.id, late.id)),
    )
    await assert.rejects(
      db.insert(departmentMeetingAttendees).values({
        institutionId: t.id,
        id: randomUUID(),
        meetingId: final.id,
        membershipId: t.teacher,
        status: 'attended',
      }),
    )
    const [row] = await db
      .select({ text: departmentMeetingDecisions.text, status: departmentMeetingDecisions.status })
      .from(departmentMeetingDecisions)
      .where(eq(departmentMeetingDecisions.id, late.id))
    assert.deepEqual(row, { text: 'Ortak yazılı sınav takvimi hazırlanacak.', status: 'cancelled' })
  })

  test('DOM-FIN-132: başka kurumun tutanağı ve personeli 404/422, B değişmez; listede yok; institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bMeeting = await draft(b)
    const bDecision = ok<Decision>(await decide(b.admin, bMeeting, decisionBody(b, bMeeting)), 201)
    const bUrl = urlOf(bMeeting)

    assert.equal((await listOf(a.admin)).meta.total, 0)
    assertError(await get(bUrl, a.admin), 404)
    assertError(await patch(a.admin, bMeeting, bodyFor(a)), 404)
    assertError(await finalize(a.admin, bMeeting), 404)
    assertError(await decide(a.admin, bMeeting, decisionBody(a, bMeeting)), 404)
    assertError(
      await call(
        'PATCH',
        decisionUrl(bMeeting, bDecision),
        a.admin,
        decisionBody(a, bMeeting),
        ifMatch(bDecision.version),
      ),
      404,
    )
    assertError(
      await call(
        'DELETE',
        decisionUrl(bMeeting, bDecision),
        a.admin,
        undefined,
        ifMatch(bDecision.version),
      ),
      404,
    )
    assertError(await followUp(a.admin, bMeeting, bDecision, { status: 'completed' }), 404)

    const aMeeting = await draft(a)
    assertError(
      await call(
        'PATCH',
        decisionUrl(aMeeting, bDecision),
        a.admin,
        decisionBody(a, aMeeting),
        ifMatch(bDecision.version),
      ),
      404,
    )
    assertError(
      await create(
        a.admin,
        bodyFor(a, {
          chairMembershipId: b.chair,
          attendees: [{ membershipId: b.chair, status: 'attended' }],
        }),
      ),
      422,
      'department_meeting_staff_not_found',
    )
    assertError(
      await decide(
        a.admin,
        aMeeting,
        decisionBody(a, aMeeting, { responsibleMembershipId: b.teacher }),
      ),
      422,
      'department_meeting_staff_not_found',
    )
    assertError(await create(a.admin, { ...bodyFor(a), institutionId: b.id }), 400)
    ok(await finalize(b.admin, bMeeting), 200)
    assert.equal((await listOf(a.admin, `${DECISIONS_URL}?overdue=true`)).meta.total, 0)

    const [meetingRow] = await meetingRows(b.id)
    assert.equal(meetingRow?.location, 'Öğretmenler odası')
    const [decisionRow] = await decisionRows(b.id)
    assert.equal(decisionRow?.status, 'open')
    assert.equal(decisionRow?.archivedAt, null)
    assert.equal((await meetingRows(a.id)).length, 1)
  })
})
