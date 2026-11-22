import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { schoolCalendarEvents } from '../src/db/schema/finance-school-calendar.ts'
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
 * Okul etkinlik takvimi uçları (DOM-FIN-163; ON-090; IST-099; K-544…K-546). Her test kendi
 * kurumunu kurar. FIXED_NOW 2026-10-06T09:00Z: Europe/Istanbul günü 2026-10-06 salı. Seed: c1 7-A
 * (b1, öğretmen t1), c9 7-B (b2, öğretmen t17), c5 9-A; s1 Deniz (c1), s9 Asya (c9).
 */

const BASE = '/api/v1/finance/school-calendar'
const EVENTS = `${BASE}/events`
const MY = `${BASE}/my`
const ICAL = `${BASE}/ical`
const PLANS = '/api/v1/finance/trip-plans'
const TICKETED = '/api/v1/finance/ticketed-events'
const LEAVE = '/api/v1/finance/leave-calendar'
/** Ekim 2026 ay görünümü: 28 Eylül pazartesi – 8 Kasım pazar (42 gün). */
const MONTH = 'from=2026-09-28&to=2026-11-08'

const SEED = createSeed(FIXED_NOW)

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

const CEREMONY = {
  title: 'Cumhuriyet Bayramı töreni',
  kind: 'ceremony',
  allDay: false,
  startDate: '2026-10-29',
  endDate: '2026-10-29',
  startTime: '09:30',
  endTime: '11:00',
  location: 'Okul bahçesi',
  description: 'Veliler davetlidir.',
  audienceKind: 'institution',
  audienceIds: [],
}
const HOLIDAY = {
  title: 'Ara tatil',
  kind: 'holiday',
  allDay: true,
  startDate: '2026-11-09',
  endDate: '2026-11-13',
  audienceKind: 'institution',
}

describe('DOM-FIN-163: okul etkinlik takvimi uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.90.0.1'

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
    method: 'POST' | 'PATCH',
    url: string,
    cookie: string | null,
    body: unknown,
    version: unknown,
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
    clientIp = `10.90.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    const classes = SEED.classes.filter((row) => ['c1', 'c5', 'c9'].includes(row.id))
    const students = SEED.students.filter((row) => ['s1', 's9'].includes(row.id))
    const teachers = SEED.teachers.filter((row) => ['t1', 't5', 't17'].includes(row.id))
    await insertMissingRecords(
      db,
      created.id,
      [
        ...SEED.branches.map((row) => ({
          collection: 'branches' as const,
          id: row.id,
          data: { ...row },
        })),
        ...classes.map((row) => ({ collection: 'classes' as const, id: row.id, data: { ...row } })),
        ...students.map((row) => ({
          collection: 'students' as const,
          id: row.id,
          data: { ...row },
        })),
        ...teachers.map((row) => ({
          collection: 'teachers' as const,
          id: row.id,
          data: { ...row },
        })),
      ],
      FIXED_NOW,
    )
    return {
      id: created.id,
      admin: await signInAs(app, created.admin),
      desk: await signInAs(app, await createMember(app, created.id, 'onburo')),
    }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>

  const eventUrl = (id: unknown) => `${EVENTS}/${String(id)}`
  const create = async (t: Tenant, body: Json = CEREMONY) =>
    ok(await post(EVENTS, t.admin, body), 201)
  const publish = async (t: Tenant, event: Json) =>
    ok(await versioned('POST', `${eventUrl(event.id)}/publish`, t.admin, undefined, event.version))
  const published = async (t: Tenant, body: Json) => publish(t, await create(t, body))
  const rows = (institutionId: string) =>
    db
      .select()
      .from(schoolCalendarEvents)
      .where(eq(schoolCalendarEvents.institutionId, institutionId))
  const rowOf = async (institutionId: string, id: unknown) =>
    (await rows(institutionId)).find((row) => row.id === id)
  const titles = (list: unknown) => (list as Json[]).map((item) => item.title)

  test('kimliksiz istek 401', async () => {
    const id = randomUUID()
    assertError(await get(`${BASE}?${MONTH}`, null), 401)
    assertError(await get(`${EVENTS}?${MONTH}`, null), 401)
    assertError(await get(`${MY}?${MONTH}`, null), 401)
    assertError(await get(`${ICAL}?${MONTH}`, null), 401)
    assertError(await post(EVENTS, null, CEREMONY), 401)
    assertError(await get(eventUrl(id), null), 401)
    assertError(await versioned('PATCH', eventUrl(id), null, { title: 'Yeni' }, 1), 401)
    assertError(await versioned('POST', `${eventUrl(id)}/publish`, null, undefined, 1), 401)
    assertError(await versioned('POST', `${eventUrl(id)}/cancel`, null, { reason: 'x' }, 1), 401)
  })

  test('DOM-FIN-163: rol ve modül; öğretmen ve aile yönetim uçlarına 403, yönetim /my ucuna 403; calendar kapalı 403 (K-544)', async () => {
    const t = await institution()
    const teacher = await signInAs(app, await createMember(app, t.id, 'ogretmen'))
    const parent = await signInAs(app, await createMember(app, t.id, 'veli'))
    assertError(await get(`${BASE}?${MONTH}`, teacher), 403)
    assertError(await get(`${EVENTS}?${MONTH}`, parent), 403)
    assertError(await post(EVENTS, parent, CEREMONY), 403)
    assertError(await post(EVENTS, teacher, CEREMONY), 403)
    assertError(await get(`${MY}?${MONTH}`, t.admin), 403)
    assertError(await get(`${MY}?${MONTH}`, t.desk), 403)
    ok(await post(EVENTS, t.desk, CEREMONY), 201)
    const closed = await institution({ enabledModules: { calendar: false } })
    const closedParent = await signInAs(app, await createMember(app, closed.id, 'veli'))
    assertError(await get(`${BASE}?${MONTH}`, closed.admin), 403, 'module_disabled')
    assertError(await post(EVENTS, closed.admin, CEREMONY), 403, 'module_disabled')
    assertError(await get(`${MY}?${MONTH}`, closedParent), 403, 'module_disabled')
    assertError(await get(`${ICAL}?${MONTH}`, closed.admin), 403, 'module_disabled')
    // Modül denetimi gövde doğrulamasından önce: geçersiz gövde de 403.
    assertError(await post(EVENTS, closed.admin, {}), 403, 'module_disabled')
    assert.equal((await rows(closed.id)).length, 0)
  })

  test('DOM-FIN-163: etkinlik ekleme taslak açar; doğrulama 400 ve kayıt yok; mükerrer istek tek kayıt (K-544)', async () => {
    const t = await institution()
    assertError(await post(EVENTS, t.admin, { ...CEREMONY, kind: 'holiday' }), 400)
    assertError(await post(EVENTS, t.admin, { ...CEREMONY, endTime: '09:00' }), 400)
    assertError(await post(EVENTS, t.admin, { ...CEREMONY, endDate: '2026-10-28' }), 400)
    assertError(await post(EVENTS, t.admin, { ...CEREMONY, audienceKind: 'grade' }), 400)
    assertError(
      await post(EVENTS, t.admin, { ...CEREMONY, audienceKind: 'grade', audienceIds: ['13'] }),
      400,
    )
    assertError(await post(EVENTS, t.admin, { ...CEREMONY, institutionId: 'başka' }), 400)
    assertError(
      await post(EVENTS, t.admin, { ...CEREMONY, audienceKind: 'class', audienceIds: ['c-yok'] }),
      422,
      'school_event_audience_not_found',
    )
    assertError(
      await post(EVENTS, t.admin, {
        ...CEREMONY,
        audienceKind: 'group',
        audienceIds: [randomUUID()],
      }),
      422,
      'school_event_audience_not_found',
    )
    assert.equal((await rows(t.id)).length, 0)

    const key = randomUUID()
    const response = await post(
      EVENTS,
      t.admin,
      { ...CEREMONY, audienceKind: 'class', audienceIds: ['c9', 'c1'] },
      key,
    )
    const created = ok(response, 201)
    assert.equal(response.headers.location, eventUrl(created.id))
    assert.equal(created.status, 'draft')
    assert.deepEqual(created.audienceIds, ['c1', 'c9'])
    assert.deepEqual(created.audienceLabels, ['7-A', '7-B'])
    assert.equal(created.startsAt, '2026-10-29T06:30:00.000Z')
    assert.equal(created.endsAt, '2026-10-29T08:00:00.000Z')
    assert.equal(created.version, 1)
    const replay = await post(
      EVENTS,
      t.admin,
      { ...CEREMONY, audienceKind: 'class', audienceIds: ['c9', 'c1'] },
      key,
    )
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal(ok(replay, 201).id, created.id)
    assert.equal((await rows(t.id)).length, 1)
    const stored = await rowOf(t.id, created.id)
    assert.equal(stored?.createdByUserId !== undefined, true)
    assert.equal(stored?.publishedAt, null)

    const holiday = await create(t, { ...HOLIDAY, startTime: '09:00', audienceIds: ['c1'] })
    assert.equal(holiday.startTime, null)
    assert.deepEqual(holiday.audienceIds, [])
    assert.equal(holiday.endsAt, '2026-11-13T21:00:00.000Z')

    const [audit] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, t.id),
          eq(auditLog.action, 'finance.school_calendar.create'),
          eq(auditLog.entityId, String(created.id)),
        ),
      )
    assert.ok(audit)
    assert.ok(!JSON.stringify(audit).includes('Veliler davetlidir'))
  })

  test('DOM-FIN-163: düzenleme birleşir ve doğrular; 409 sürüm, 422 kural ve değişiklik yok, kayıt değişmez (K-544)', async () => {
    const t = await institution()
    const event = await create(t)
    const url = eventUrl(event.id)
    assertError(await call('PATCH', url, t.admin, { title: 'Yeni' }), 400, 'if_match_required')
    assertError(await versioned('PATCH', url, t.admin, {}, event.version), 400)
    assertError(await versioned('PATCH', url, t.admin, { title: 'Yeni' }, 9), 409)
    assertError(
      await versioned('PATCH', url, t.admin, { kind: 'holiday' }, event.version),
      422,
      'school_event_invalid',
    )
    assertError(
      await versioned('PATCH', url, t.admin, { endTime: '08:00' }, event.version),
      422,
      'school_event_invalid',
    )
    assertError(
      await versioned('PATCH', url, t.admin, { title: CEREMONY.title }, event.version),
      422,
      'school_event_unchanged',
    )
    assertError(
      await versioned(
        'PATCH',
        url,
        t.admin,
        { audienceKind: 'class', audienceIds: ['c-yok'] },
        event.version,
      ),
      422,
      'school_event_audience_not_found',
    )
    const before = await rowOf(t.id, event.id)
    assert.equal(before?.version, 1)
    assert.equal(before?.title, CEREMONY.title)

    const updated = ok(
      await versioned(
        'PATCH',
        url,
        t.desk,
        {
          title: 'Tören (salon)',
          location: 'Konferans salonu',
          audienceKind: 'grade',
          audienceIds: ['7'],
        },
        event.version,
      ),
    )
    assert.equal(updated.version, 2)
    assert.equal(updated.location, 'Konferans salonu')
    assert.deepEqual(updated.audienceLabels, ['7. sınıf'])
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, t.id),
          eq(auditLog.action, 'finance.school_calendar.update'),
        ),
      )
    assert.deepEqual(audit?.changes, {
      fields: ['title', 'location', 'audienceKind', 'audienceIds'],
    })
  })

  test('DOM-FIN-163: yayım ve gerekçeli iptal; silme yok, iptal değişmez (K-544)', async () => {
    const t = await institution()
    const draft = await create(t)
    const url = eventUrl(draft.id)
    const live = ok(await versioned('POST', `${url}/publish`, t.desk, undefined, draft.version))
    assert.equal(live.status, 'published')
    assert.ok(typeof live.publishedAt === 'string')
    assertError(
      await versioned('POST', `${url}/publish`, t.admin, undefined, live.version),
      422,
      'school_event_not_draft',
    )
    assertError(
      await versioned('POST', `${url}/cancel`, t.admin, { reason: 'kısa' }, live.version),
      400,
    )
    assertError(await versioned('POST', `${url}/cancel`, t.admin, {}, live.version), 400)
    const cancelled = ok(
      await versioned(
        'POST',
        `${url}/cancel`,
        t.admin,
        { reason: 'Hava muhalefeti nedeniyle ertelendi.' },
        live.version,
      ),
    )
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(cancelled.cancelReason, 'Hava muhalefeti nedeniyle ertelendi.')
    assert.equal(cancelled.publishedAt, live.publishedAt)
    assertError(
      await versioned(
        'POST',
        `${url}/cancel`,
        t.admin,
        { reason: 'İkinci kez iptal denemesi' },
        cancelled.version,
      ),
      422,
      'school_event_cancelled',
    )
    assertError(
      await versioned('PATCH', url, t.admin, { title: 'Yeniden' }, cancelled.version),
      422,
      'school_event_cancelled',
    )
    assertError(
      await versioned('POST', `${url}/publish`, t.admin, undefined, cancelled.version),
      422,
      'school_event_cancelled',
    )
    assertError(await call('DELETE', url, t.admin), 404)
    const past = await create(t, {
      ...CEREMONY,
      startDate: '2026-10-01',
      endDate: '2026-10-01',
    })
    assertError(
      await versioned(
        'POST',
        `${eventUrl(past.id)}/cancel`,
        t.admin,
        { reason: 'Geçmiş etkinliği iptal denemesi' },
        past.version,
      ),
      422,
      'school_event_ended',
    )
    assert.equal((await rowOf(t.id, past.id))?.status, 'draft')
    assert.equal((await rows(t.id)).length, 2)
  })

  test('DOM-FIN-163: başka kurumun etkinliği 404, B değişmez; listede ve takvimde B yok; institutionId ve B sınıfı etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    await insertMissingRecords(
      db,
      b.id,
      [{ collection: 'classes', id: 'c-b', data: { ...SEED.classes[0], id: 'c-b', name: 'B-1' } }],
      FIXED_NOW,
    )
    const foreign = await create(b, { ...CEREMONY, title: 'B kurumunun töreni' })
    const url = eventUrl(foreign.id)
    assertError(await get(url, a.admin), 404)
    assertError(
      await versioned('PATCH', url, a.admin, { title: 'Ele geçir' }, foreign.version),
      404,
    )
    assertError(await versioned('POST', `${url}/publish`, a.admin, undefined, foreign.version), 404)
    assertError(
      await versioned(
        'POST',
        `${url}/cancel`,
        a.admin,
        { reason: 'Başka kurumdan iptal' },
        foreign.version,
      ),
      404,
    )
    const stored = await rowOf(b.id, foreign.id)
    assert.equal(stored?.version, 1)
    assert.equal(stored?.status, 'draft')
    assert.equal(stored?.title, 'B kurumunun töreni')
    assert.deepEqual(titles(ok(await get(`${EVENTS}?${MONTH}`, a.admin))), [])
    assert.deepEqual(titles(ok(await get(`${BASE}?${MONTH}`, a.admin)).events), [])
    // B'nin sınıfı A'da yoktur; gövdedeki kurum kimliği şemada reddedilir.
    assertError(
      await post(EVENTS, a.admin, { ...CEREMONY, audienceKind: 'class', audienceIds: ['c-b'] }),
      422,
      'school_event_audience_not_found',
    )
    assertError(await post(EVENTS, a.admin, { ...CEREMONY, institutionId: b.id }), 400)
    assert.equal((await rows(a.id)).length, 0)
    // B'nin yayımlanmış etkinliği ve tatili A'nın velisine, dışa aktarımına ve izin takvimine düşmez.
    await published(b, { ...CEREMONY, title: 'B kurumunun yayını' })
    await published(b, { ...HOLIDAY, title: 'B kurumunun tatili' })
    const aParent = await signInAs(
      app,
      await createMember(app, a.id, 'veli', [{ kind: 'child', recordId: 's1' }]),
    )
    assert.deepEqual(titles(ok(await get(`${MY}?${MONTH}`, aParent)).events), [])
    assert.ok(!(await get(`${ICAL}?${MONTH}`, a.admin)).body.includes('B kurumunun'))
    assert.deepEqual(
      ok(await get(`${LEAVE}?startDate=2026-11-02&endDate=2026-11-29`, a.admin)).holidays,
      [],
    )
  })

  test('DOM-FIN-163: liste görünümü süzgeç ve sayfalama; ay görünümü aralık sınırı (K-544)', async () => {
    const t = await institution()
    const first = await published(t, CEREMONY)
    await create(t, {
      ...CEREMONY,
      title: 'Veli toplantısı 7-A',
      kind: 'parent_meeting',
      startDate: '2026-10-15',
      endDate: '2026-10-15',
      startTime: '18:00',
      endTime: '19:30',
      audienceKind: 'class',
      audienceIds: ['c1'],
    })
    await create(t, { ...HOLIDAY })
    await create(t, {
      ...CEREMONY,
      title: 'Aralık dışı',
      startDate: '2026-12-10',
      endDate: '2026-12-10',
    })
    const page = await get(`${EVENTS}?${MONTH}&pageSize=1`, t.admin)
    assert.equal(page.statusCode, 200, page.body)
    assert.deepEqual(page.json().meta, { page: 1, pageSize: 1, total: 2 })
    assert.deepEqual(titles(page.json().data), ['Veli toplantısı 7-A'])
    assert.deepEqual(titles(ok(await get(`${EVENTS}?${MONTH}&page=2&pageSize=1`, t.admin))), [
      CEREMONY.title,
    ])
    assert.deepEqual(titles(ok(await get(`${EVENTS}?${MONTH}&status=published`, t.admin))), [
      first.title,
    ])
    assert.deepEqual(titles(ok(await get(`${EVENTS}?${MONTH}&kind=parent_meeting`, t.admin))), [
      'Veli toplantısı 7-A',
    ])
    assert.deepEqual(titles(ok(await get(`${EVENTS}?${MONTH}&q=toplanti`, t.admin))), [
      'Veli toplantısı 7-A',
    ])
    assert.deepEqual(
      titles(
        ok(await get(`${EVENTS}?from=2026-09-01&to=2027-06-30&audienceKind=institution`, t.admin)),
      ),
      [CEREMONY.title, 'Ara tatil', 'Aralık dışı'],
    )
    assertError(await get(`${EVENTS}?from=2026-01-01&to=2027-06-30`, t.admin), 400)
    assertError(await get(`${EVENTS}?${MONTH}&bilinmeyen=1`, t.admin), 400)
    assertError(await get(`${BASE}?from=2026-09-01&to=2026-11-30`, t.admin), 400)
    assertError(await get(`${BASE}?from=2026-10-10&to=2026-10-01`, t.admin), 400)
    const month = ok(await get(`${BASE}?${MONTH}`, t.desk))
    assert.deepEqual(titles(month.events), ['Veli toplantısı 7-A', CEREMONY.title])
    assert.deepEqual(month.links, [])
  })

  /** Onaylı gezi planı (20 Ekim), s1 gezi günü grubunda; s1 adına biletli etkinlik bileti. */
  async function withLinks(t: Tenant) {
    const lead = await createMember(app, t.id, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }])
    const plan = ok(
      await post(PLANS, t.admin, {
        name: 'Anıtkabir gezisi',
        purpose: 'Cumhuriyet tarihi kazanımlarını yerinde gözlemlemek.',
        departureAt: '2026-10-20T05:00:00.000Z',
        returnAt: '2026-10-20T17:00:00.000Z',
        expectedStudentCount: 2,
        stops: [{ place: 'Anıtkabir' }],
        staff: [{ membershipId: lead.membershipId, role: 'lead' }],
        transport: {
          type: 'bus',
          company: 'Mavi Turizm',
          plate: '06 ABC 123',
          driverName: 'Ali Sürücü',
          driverPhone: '05321112233',
        },
        risks: [{ risk: 'Kalabalıkta kaybolma', measure: 'Grup sorumlusu ve yoklama' }],
        emergencyContacts: [{ name: 'Okul müdürü', phone: '05321234500', relation: 'Müdür' }],
      }),
      201,
    )
    const submitted = ok(
      await versioned('POST', `${PLANS}/${String(plan.id)}/submit`, t.admin, {}, plan.version),
    )
    ok(
      await versioned(
        'POST',
        `${PLANS}/${String(plan.id)}/approve`,
        t.admin,
        {},
        submitted.version,
      ),
    )
    const day = ok(
      await post(`${PLANS}/${String(plan.id)}/day/groups`, t.admin, {
        name: '1. otobüs',
        leaderMembershipId: lead.membershipId,
      }),
      201,
    )
    const group = (day.groups as Json[])[0]
    ok(
      await post(`${PLANS}/${String(plan.id)}/day/assignments`, t.admin, {
        groupId: group?.id,
        studentIds: ['s1'],
      }),
    )
    const show = ok(
      await post(TICKETED, t.admin, {
        name: 'Yıl sonu gösterisi',
        startsAt: '2026-10-30T16:00:00.000Z',
        venue: 'Konferans salonu',
        seatingMode: 'general',
        capacity: 20,
        ticketTypes: [{ name: 'Davetiye', kind: 'invitation', priceCents: 0 }],
      }),
      201,
    )
    ok(
      await post(`${TICKETED}/${String(show.id)}/tickets`, t.admin, {
        studentId: 's1',
        items: [
          {
            ticketTypeKey: (show.ticketTypes as Json[])[0]?.key,
            seat: null,
            holderName: 'Ayşe Yılmaz',
          },
        ],
      }),
      201,
    )
    return { planId: String(plan.id), showId: String(show.id), lead: await signInAs(app, lead) }
  }

  test('DOM-FIN-163: gezi planı ve biletli etkinlik takvimde bağlantıdır, kopya kayıt yazılmaz (K-546)', async () => {
    const t = await institution()
    const { planId, showId } = await withLinks(t)
    const month = ok(await get(`${BASE}?${MONTH}`, t.admin))
    assert.deepEqual(
      (month.links as Json[]).map((link) => [link.source, link.sourceId, link.reference]),
      [
        ['trip_plan', planId, 'GZ-1'],
        ['ticketed_event', showId, null],
      ],
    )
    assert.deepEqual(month.events, [])
    assert.equal((await rows(t.id)).length, 0)
    const trips = ok(await get(`${BASE}?${MONTH}&kind=trip`, t.admin))
    assert.deepEqual(
      (trips.links as Json[]).map((link) => link.source),
      ['trip_plan'],
    )
    assert.deepEqual(ok(await get(`${BASE}?${MONTH}&kind=ceremony`, t.admin)).links, [])
    assert.deepEqual(ok(await get(`${BASE}?from=2026-11-01&to=2026-11-30`, t.admin)).links, [])
  })

  test('DOM-FIN-163: veli çocuğunun sınıfı ve kademesini, öğrenci kendininkini, öğretmen sınıflarını görür; taslak görünmez (K-544, K-546)', async () => {
    const t = await institution()
    const { lead } = await withLinks(t)
    await published(t, CEREMONY)
    await published(t, {
      ...CEREMONY,
      title: '7. sınıflar gezisi',
      kind: 'trip',
      audienceKind: 'grade',
      audienceIds: ['7'],
    })
    await published(t, {
      ...CEREMONY,
      title: '9. sınıflar sınav haftası',
      kind: 'exam_week',
      allDay: true,
      audienceKind: 'grade',
      audienceIds: ['9'],
    })
    await published(t, {
      ...CEREMONY,
      title: '7-A veli toplantısı',
      kind: 'parent_meeting',
      audienceKind: 'class',
      audienceIds: ['c1'],
    })
    await published(t, {
      ...CEREMONY,
      title: '7-B veli toplantısı',
      kind: 'parent_meeting',
      audienceKind: 'class',
      audienceIds: ['c9'],
    })
    await create(t, { ...CEREMONY, title: 'Taslak duyuru' })
    const cancelled = await published(t, {
      ...CEREMONY,
      title: 'İptal edilen gösteri',
      kind: 'performance',
    })
    ok(
      await versioned(
        'POST',
        `${eventUrl(cancelled.id)}/cancel`,
        t.admin,
        { reason: 'Salon tadilatı nedeniyle iptal.' },
        cancelled.version,
      ),
    )
    const draftCancelled = await create(t, { ...CEREMONY, title: 'Yayımlanmadan iptal' })
    ok(
      await versioned(
        'POST',
        `${eventUrl(draftCancelled.id)}/cancel`,
        t.admin,
        { reason: 'Planlama değişti, gerek kalmadı.' },
        draftCancelled.version,
      ),
    )

    const parent = await signInAs(
      app,
      await createMember(app, t.id, 'veli', [{ kind: 'child', recordId: 's1' }]),
    )
    const mine = ok(await get(`${MY}?${MONTH}`, parent))
    assert.deepEqual(
      new Set(titles(mine.events)),
      new Set([
        CEREMONY.title,
        '7. sınıflar gezisi',
        '7-A veli toplantısı',
        'İptal edilen gösteri',
      ]),
    )
    const gone = (mine.events as Json[]).find((event) => event.title === 'İptal edilen gösteri')
    assert.equal(gone?.status, 'cancelled')
    assert.equal(gone?.cancelReason, 'Salon tadilatı nedeniyle iptal.')
    assert.equal('version' in (gone ?? {}), false)
    assert.equal('audienceIds' in (gone ?? {}), false)
    assert.deepEqual(
      (mine.links as Json[]).map((link) => link.source),
      ['trip_plan', 'ticketed_event'],
    )

    const student = await signInAs(
      app,
      await createMember(app, t.id, 'ogrenci', [{ kind: 'student', recordId: 's9' }]),
    )
    const own = ok(await get(`${MY}?${MONTH}`, student))
    assert.deepEqual(
      new Set(titles(own.events)),
      new Set([
        CEREMONY.title,
        '7. sınıflar gezisi',
        '7-B veli toplantısı',
        'İptal edilen gösteri',
      ]),
    )
    assert.deepEqual(own.links, [])

    const teacherView = ok(await get(`${MY}?${MONTH}`, lead))
    assert.ok(titles(teacherView.events).includes('7-A veli toplantısı'))
    assert.ok(!titles(teacherView.events).includes('7-B veli toplantısı'))
    assert.ok(!titles(teacherView.events).includes('Taslak duyuru'))
    assert.deepEqual(
      (teacherView.links as Json[]).map((link) => link.source),
      ['trip_plan'],
    )
    const unlinked = await signInAs(app, await createMember(app, t.id, 'veli'))
    const empty = ok(await get(`${MY}?${MONTH}`, unlinked))
    assert.deepEqual(
      new Set(titles(empty.events)),
      new Set([CEREMONY.title, 'İptal edilen gösteri']),
    )
    assert.deepEqual(empty.links, [])
    assertError(await get(`${MY}?from=2026-09-01&to=2026-12-31`, parent), 400)
  })

  test('DOM-FIN-163: iCal dışa aktarımı yayımlanmış etkinlikleri kapsamla verir; taslak yok (RFC 5545)', async () => {
    const t = await institution()
    await withLinks(t)
    await published(t, CEREMONY)
    await published(t, {
      ...HOLIDAY,
      startDate: '2026-10-28',
      endDate: '2026-10-28',
      title: 'Arife',
    })
    await published(t, {
      ...CEREMONY,
      title: '7-B veli toplantısı',
      audienceKind: 'class',
      audienceIds: ['c9'],
    })
    await create(t, { ...CEREMONY, title: 'Taslak duyuru' })
    const response = await get(`${ICAL}?${MONTH}`, t.admin)
    assert.equal(response.statusCode, 200, response.body)
    assert.match(String(response.headers['content-type']), /^text\/calendar/)
    assert.match(
      String(response.headers['content-disposition']),
      /okul-takvimi-2026-09-28-2026-11-08\.ics/,
    )
    assert.equal(response.headers['cache-control'], 'no-store')
    const ics = response.body
    assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'))
    assert.ok(ics.includes('SUMMARY:Cumhuriyet Bayramı töreni'))
    assert.ok(ics.includes('DTSTART;VALUE=DATE:20261028'))
    assert.ok(ics.includes('SUMMARY:7-B veli toplantısı'))
    assert.ok(ics.includes('SUMMARY:GZ-1 Anıtkabir gezisi'))
    assert.ok(!ics.includes('Taslak duyuru'))

    const parent = await signInAs(
      app,
      await createMember(app, t.id, 'veli', [{ kind: 'child', recordId: 's1' }]),
    )
    const family = (await get(`${ICAL}?${MONTH}`, parent)).body
    assert.ok(family.includes('SUMMARY:Cumhuriyet Bayramı töreni'))
    assert.ok(!family.includes('7-B veli toplantısı'))
    assert.ok(family.includes('SUMMARY:Yıl sonu gösterisi'))
    assertError(await get(`${ICAL}?from=2026-01-01&to=2027-06-30`, t.admin), 400)
  })

  test('DOM-FIN-163: izin takvimi tatili okul takviminden okur; yalnız yayımlanmış tüm kurum tatili (K-545)', async () => {
    const t = await institution()
    await published(t, HOLIDAY)
    await create(t, {
      ...HOLIDAY,
      title: 'Taslak tatil',
      startDate: '2026-11-16',
      endDate: '2026-11-16',
    })
    await published(t, {
      ...HOLIDAY,
      title: '7. sınıf tatili',
      audienceKind: 'grade',
      audienceIds: ['7'],
    })
    const leave = ok(await get(`${LEAVE}?startDate=2026-11-02&endDate=2026-11-29`, t.admin))
    assert.deepEqual(leave.holidays, [
      { title: 'Ara tatil', startDate: '2026-11-09', endDate: '2026-11-13' },
    ])
    const desk = ok(await get(`${LEAVE}?startDate=2026-11-02&endDate=2026-11-29`, t.desk))
    assert.equal((desk.holidays as Json[]).length, 1)
    assert.deepEqual(
      ok(await get(`${LEAVE}?startDate=2026-10-05&endDate=2026-10-25`, t.admin)).holidays,
      [],
    )
  })
})
