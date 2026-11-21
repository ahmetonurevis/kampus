import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { visitorLogs } from '../src/db/schema/finance-visitors.ts'
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
 * Ziyaretçi kaydı uçları (DOM-FIN-141; ON-166; K-478…K-480). Her test kendi kurumunu kurar.
 * FIXED_NOW 2026-10-06T09:00Z (Europe/Istanbul günü 2026-10-06).
 */

const FINANCE = '/api/v1/finance'
const VISITORS = `${FINANCE}/visitors`
const SUMMARY = `${FINANCE}/visitor-summary`
const HOSTS = `${FINANCE}/visitor-hosts`
const RETENTION = `${FINANCE}/visitor-retention`
const ANONYMIZE = `${FINANCE}/visitor-anonymizations`
const SETTINGS = `${FINANCE}/visitor-settings`

const SEED = createSeed(FIXED_NOW)

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-141: ziyaretçi kaydı uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.166.0.1'

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
  const get = (url: string, cookie: string | null) => call('GET', url, cookie)
  const post = (url: string, cookie: string | null, body: unknown, key = randomUUID()) =>
    call('POST', url, cookie, body, { 'idempotency-key': key })
  const versioned = (
    method: 'POST' | 'PATCH',
    url: string,
    cookie: string,
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
    clientIp = `10.166.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  const member = async (institutionId: string, role: Parameters<typeof createMember>[2]) =>
    signInAs(app, await createMember(app, institutionId, role))
  async function withBadges(t: Tenant, badgeNumbers: string[]) {
    const current = ok(await get(SETTINGS, t.admin))
    return ok(await versioned('PATCH', SETTINGS, t.admin, { badgeNumbers }, current.version))
  }
  const visitorBody = (extra: Json = {}) => ({
    visitorName: 'Ayşe Ziyaretçi',
    identityVerified: true,
    identityDocumentType: 'national_id',
    purpose: 'supplier',
    privacyNoticeVersion: 'v1',
    ...extra,
  })
  const rowsOf = async (institutionId: string) =>
    db.select().from(visitorLogs).where(eq(visitorLogs.institutionId, institutionId))
  const detailUrl = (id: unknown) => `${VISITORS}/${String(id)}`
  /** Saklama dalları için ziyaret gününü geçmişe çeker (uçlar 24 saatten eski giriş yazmaz). */
  const backdate = (institutionId: string, id: unknown, visitOn: string, at: string) =>
    db
      .update(visitorLogs)
      .set({ visitOn, checkedInAt: new Date(at) })
      .where(and(eq(visitorLogs.institutionId, institutionId), eq(visitorLogs.id, String(id))))

  test('kimliksiz istek 401', async () => {
    assertError(await get(VISITORS, null), 401)
    assertError(await post(VISITORS, null, {}), 401)
    assertError(await get(SUMMARY, null), 401)
    assertError(await get(HOSTS, null), 401)
    assertError(await get(RETENTION, null), 401)
    assertError(await post(ANONYMIZE, null, {}), 401)
    assertError(await get(SETTINGS, null), 401)
  })

  test('DOM-FIN-141: öğretmen 403; ön büro giriş ve çıkış yapar, saklama ve ayar yazmaz; modül kapalı 403 (K-478, K-480)', async () => {
    const t = await institution()
    const teacher = await member(t.id, 'ogretmen')
    assertError(await get(VISITORS, teacher), 403)
    assertError(await post(VISITORS, teacher, visitorBody()), 403)
    const desk = await member(t.id, 'onburo')
    const created = ok(await post(VISITORS, desk, visitorBody()), 201)
    ok(await get(VISITORS, desk))
    ok(await get(SUMMARY, desk))
    ok(await get(HOSTS, desk))
    ok(await get(SETTINGS, desk))
    ok(await versioned('POST', `${detailUrl(created.id)}/check-out`, desk, {}, created.version))
    assertError(await versioned('PATCH', SETTINGS, desk, { retentionDays: 10 }, 1), 403)
    assertError(await get(RETENTION, desk), 403)
    assertError(
      await post(ANONYMIZE, desk, { visitorIds: [created.id], reason: 'data_subject_request' }),
      403,
    )
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(VISITORS, closed.admin), 403, 'module_disabled')
  })

  test('DOM-FIN-141: giriş, maskeli telefon, denetimli ayrıntı ve mükerrer giriş (K-478)', async () => {
    const t = await institution()
    assertError(await post(VISITORS, t.admin, visitorBody({ identityNumber: '12345678901' })), 400)
    assertError(await post(VISITORS, t.admin, visitorBody({ identityDocumentType: null })), 400)
    assertError(await post(VISITORS, t.admin, visitorBody({ privacyNoticeVersion: '' })), 400)
    assertError(await post(VISITORS, t.admin, visitorBody({ purpose: 'other' })), 400)
    assert.equal((await rowsOf(t.id)).length, 0)

    const key = randomUUID()
    const first = await post(VISITORS, t.admin, visitorBody({ phone: '0532 123 45 67' }), key)
    const created = ok(first, 201)
    assert.equal(created.visitOn, '2026-10-06')
    assert.equal(created.checkedInAt, FIXED_NOW.toISOString())
    assert.equal(created.inside, true)
    assert.equal(created.badgeStatus, 'none')
    assert.equal(created.retentionDueOn, '2026-11-05')
    const replay = await post(VISITORS, t.admin, visitorBody({ phone: '0532 123 45 67' }), key)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal(replay.json().data.id, created.id)
    assert.equal((await rowsOf(t.id)).length, 1)

    const list = (await get(VISITORS, t.admin)).json()
    assert.equal(list.meta.total, 1)
    assert.equal(list.data[0].maskedPhone, '0532 *** ** 67')
    assert.equal('phone' in list.data[0], false)
    assert.equal('purposeNote' in list.data[0], false)

    const detail = ok(await get(detailUrl(created.id), t.admin))
    assert.equal(detail.phone, '05321234567')
    assert.equal(detail.privacyNoticeVersion, 'v1')
    const reads = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'finance.visitor.read')))
    assert.equal(reads.length, 1)
    const checkIns = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'finance.visitor.check_in')))
    assert.equal(checkIns.length, 1)
    assert.equal(JSON.stringify(checkIns[0]?.changes).includes('Ayşe'), false)

    assertError(
      await post(VISITORS, t.admin, visitorBody({ checkedInAt: '2026-10-06T09:05:00.000Z' })),
      422,
      'visitor_check_in_future',
    )
    assertError(
      await post(VISITORS, t.admin, visitorBody({ checkedInAt: '2026-10-05T08:00:00.000Z' })),
      422,
      'visitor_check_in_too_old',
    )
    assert.equal((await rowsOf(t.id)).length, 1)
  })

  test('DOM-FIN-141: ziyaret edilen personel ve veli görüşmesinde öğrenci (K-478)', async () => {
    const t = await institution()
    const student = SEED.students.find((row) => row.id === 's1')
    assert.ok(student)
    await insertMissingRecords(
      db,
      t.id,
      [{ collection: 'students', id: student.id, data: { ...student } }],
      FIXED_NOW,
    )
    const teacher = await createMember(app, t.id, 'ogretmen')
    const parent = await createMember(app, t.id, 'veli')
    const hosts = (await get(`${HOSTS}?pageSize=100`, t.admin)).json()
    assert.ok(hosts.data.some((row: Json) => row.membershipId === teacher.membershipId))
    assert.ok(!hosts.data.some((row: Json) => row.membershipId === parent.membershipId))
    const visit = ok(
      await post(
        VISITORS,
        t.admin,
        visitorBody({
          purpose: 'parent_meeting',
          hostMembershipId: teacher.membershipId,
          studentId: 's1',
        }),
      ),
      201,
    )
    assert.equal(visit.hostMembershipId, teacher.membershipId)
    assert.equal(visit.studentName, 'Deniz Yılmaz')
    assertError(
      await post(VISITORS, t.admin, visitorBody({ hostMembershipId: parent.membershipId })),
      422,
      'visitor_host_not_staff',
    )
    assertError(
      await post(VISITORS, t.admin, visitorBody({ hostMembershipId: 'yok' })),
      422,
      'visitor_host_not_found',
    )
    assertError(
      await post(VISITORS, t.admin, visitorBody({ purpose: 'parent_meeting', studentId: 'yok' })),
      422,
      'visitor_student_not_found',
    )
    assertError(await post(VISITORS, t.admin, visitorBody({ studentId: 's1' })), 400)
    assert.equal((await rowsOf(t.id)).length, 1)
  })

  test('DOM-FIN-141: kart havuzu, çıkış, kart iadesi ve gün sonu listesi (K-479)', async () => {
    const t = await institution()
    const settings = await withBadges(t, ['a1', 'A2'])
    assert.deepEqual(settings.badgeNumbers, ['A1', 'A2'])
    assertError(
      await post(VISITORS, t.admin, visitorBody({ badgeNumber: 'B9' })),
      422,
      'visitor_badge_unknown',
    )
    const first = ok(await post(VISITORS, t.admin, visitorBody({ badgeNumber: 'A1' })), 201)
    assert.equal(first.badgeStatus, 'out')
    assertError(
      await post(VISITORS, t.admin, visitorBody({ badgeNumber: 'A1' })),
      409,
      'visitor_badge_in_use',
    )
    assert.equal((await rowsOf(t.id)).length, 1)
    let summary = ok(await get(SUMMARY, t.admin))
    assert.deepEqual(summary.badges, [
      { number: 'A1', visitorId: first.id },
      { number: 'A2', visitorId: null },
    ])

    // İade edilmemiş kart havuzdan çıkmaz; değişiklik yoksa 422.
    assertError(
      await versioned('PATCH', SETTINGS, t.admin, { badgeNumbers: ['A2'] }, settings.version),
      422,
      'visitor_settings_badge_in_use',
    )
    assertError(
      await versioned('PATCH', SETTINGS, t.admin, { retentionDays: 30 }, settings.version),
      422,
      'visitor_settings_unchanged',
    )
    assertError(
      await versioned('PATCH', SETTINGS, t.admin, { retentionDays: 0 }, settings.version),
      400,
    )

    const url = `${detailUrl(first.id)}/check-out`
    assertError(await versioned('POST', url, t.admin, {}, Number(first.version) + 1), 409)
    assertError(
      await versioned(
        'POST',
        url,
        t.admin,
        { checkedOutAt: '2026-10-06T08:00:00.000Z' },
        first.version,
      ),
      422,
      'visitor_check_out_before_check_in',
    )
    const left = ok(await versioned('POST', url, t.admin, { badgeReturned: false }, first.version))
    assert.equal(left.inside, false)
    assert.equal(left.badgeStatus, 'out')
    assertError(
      await versioned('POST', url, t.admin, {}, left.version),
      422,
      'visitor_already_checked_out',
    )
    assertError(
      await post(VISITORS, t.admin, visitorBody({ badgeNumber: 'A1' })),
      409,
      'visitor_badge_in_use',
    )
    const outstanding = (await get(`${VISITORS}?badge=outstanding`, t.admin)).json()
    assert.equal(outstanding.meta.total, 1)

    const released = ok(
      await versioned(
        'POST',
        `${detailUrl(first.id)}/badge-release`,
        t.admin,
        { outcome: 'returned' },
        left.version,
      ),
    )
    assert.equal(released.badgeStatus, 'returned')
    assertError(
      await versioned(
        'POST',
        `${detailUrl(first.id)}/badge-release`,
        t.admin,
        { outcome: 'lost' },
        released.version,
      ),
      422,
      'visitor_badge_already_released',
    )
    const second = ok(await post(VISITORS, t.admin, visitorBody({ badgeNumber: 'A1' })), 201)

    // Gün sonu: önceki günden içeride kalan `overdue` ve listede önce.
    const earlier = ok(
      await post(VISITORS, t.admin, visitorBody({ visitorName: 'Dün Gelen' })),
      201,
    )
    await backdate(t.id, earlier.id, '2026-10-05', '2026-10-05T12:00:00.000Z')
    const inside = (await get(`${VISITORS}?status=inside`, t.admin)).json()
    assert.equal(inside.meta.total, 2)
    assert.equal(inside.data[0].id, earlier.id)
    assert.equal(inside.data[0].overdue, true)
    assert.equal(inside.data[1].id, second.id)
    assert.equal(inside.data[1].overdue, false)
    summary = ok(await get(SUMMARY, t.admin))
    assert.equal(summary.inside, 2)
    assert.equal(summary.insideFromEarlier, 1)
    assert.equal(summary.badgesOut, 1)
    assert.equal(summary.visitsToday, 2)
    assert.equal((await get(`${VISITORS}?date=2026-10-05`, t.admin)).json().meta.total, 1)
    assert.equal((await get(`${VISITORS}?q=dun`, t.admin)).json().meta.total, 1)
    assertError(await get(`${VISITORS}?bilinmeyen=1`, t.admin), 400)
  })

  test('DOM-FIN-141: saklama süresi dolanlar ve anonimleştirme (K-480)', async () => {
    const t = await institution()
    const old = ok(
      await post(
        VISITORS,
        t.admin,
        visitorBody({ visitorName: 'Eski Ziyaretçi', phone: '05321234567' }),
      ),
      201,
    )
    const oldOut = ok(
      await versioned('POST', `${detailUrl(old.id)}/check-out`, t.admin, {}, old.version),
    )
    await backdate(t.id, old.id, '2026-09-05', '2026-09-05T09:00:00.000Z')
    const stillInside = ok(
      await post(VISITORS, t.admin, visitorBody({ visitorName: 'İçeride' })),
      201,
    )
    await backdate(t.id, stillInside.id, '2026-08-01', '2026-08-01T09:00:00.000Z')
    const recent = ok(
      await post(VISITORS, t.admin, visitorBody({ visitorName: 'Yeni Ziyaretçi' })),
      201,
    )
    const recentOut = ok(
      await versioned('POST', `${detailUrl(recent.id)}/check-out`, t.admin, {}, recent.version),
    )

    const due = (await get(RETENTION, t.admin)).json()
    assert.equal(due.meta.retentionDays, 30)
    assert.deepEqual(
      due.data.map((row: Json) => row.id),
      [old.id],
    )
    assert.equal(due.data[0].retentionDueOn, '2026-10-05')

    assertError(
      await post(ANONYMIZE, t.admin, {
        visitorIds: [old.id, recent.id],
        reason: 'retention_expired',
      }),
      422,
      'visitor_retention_not_due',
    )
    assertError(
      await post(ANONYMIZE, t.admin, {
        visitorIds: [stillInside.id],
        reason: 'data_subject_request',
      }),
      422,
      'visitor_still_inside',
    )
    const [unchanged] = (await rowsOf(t.id)).filter((row) => row.id === old.id)
    assert.equal(unchanged?.visitorName, 'Eski Ziyaretçi')
    assert.equal(unchanged?.version, oldOut.version)

    const done = ok(
      await post(ANONYMIZE, t.admin, { visitorIds: [old.id], reason: 'retention_expired' }),
    )
    assert.deepEqual(done, { anonymizedCount: 1, reason: 'retention_expired' })
    const anonymized = ok(await get(detailUrl(old.id), t.admin))
    assert.equal(anonymized.visitorName, 'Anonim ziyaretçi')
    assert.equal(anonymized.phone, null)
    assert.equal(anonymized.maskedPhone, null)
    assert.equal(anonymized.anonymized, true)
    assert.equal(anonymized.privacyNoticeVersion, 'v1')
    assertError(
      await post(ANONYMIZE, t.admin, { visitorIds: [old.id], reason: 'data_subject_request' }),
      422,
      'visitor_already_anonymized',
    )
    assert.equal((await get(RETENTION, t.admin)).json().meta.total, 0)
    ok(await post(ANONYMIZE, t.admin, { visitorIds: [recent.id], reason: 'data_subject_request' }))
    assertError(
      await versioned(
        'POST',
        `${detailUrl(recent.id)}/badge-release`,
        t.admin,
        { outcome: 'lost' },
        Number(recentOut.version) + 1,
      ),
      422,
      'visitor_anonymized',
    )
    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'finance.visitor.anonymize')),
      )
    assert.equal(audits.length, 2)

    const changed = ok(await versioned('PATCH', SETTINGS, t.admin, { retentionDays: 60 }, 1))
    assert.equal(changed.retentionDays, 60)
    assert.equal(changed.version, 2)
    assertError(await versioned('PATCH', SETTINGS, t.admin, { retentionDays: 10 }, 1), 409)
  })

  test('DOM-FIN-141: başka kurumun ziyaret kaydı 404 ve B değişmez; listede yok; institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    await withBadges(b, ['K1'])
    const bVisitor = ok(await post(VISITORS, b.admin, visitorBody({ badgeNumber: 'K1' })), 201)
    const bUrl = detailUrl(bVisitor.id)
    const bMember = await createMember(app, b.id, 'ogretmen')
    assertError(await get(bUrl, a.admin), 404)
    assertError(await versioned('POST', `${bUrl}/check-out`, a.admin, {}, bVisitor.version), 404)
    assertError(
      await versioned(
        'POST',
        `${bUrl}/badge-release`,
        a.admin,
        { outcome: 'lost' },
        bVisitor.version,
      ),
      404,
    )
    assert.equal((await get(VISITORS, a.admin)).json().meta.total, 0)
    assert.equal((await get(RETENTION, a.admin)).json().meta.total, 0)
    const aSummary = ok(await get(SUMMARY, a.admin))
    assert.equal(aSummary.inside, 0)
    assert.deepEqual(aSummary.badges, [])
    const aHosts = (await get(`${HOSTS}?pageSize=100`, a.admin)).json()
    assert.ok(!aHosts.data.some((row: Json) => row.membershipId === bMember.membershipId))
    assertError(await post(VISITORS, a.admin, visitorBody({ institutionId: b.id })), 400)
    assertError(
      await post(VISITORS, a.admin, visitorBody({ hostMembershipId: bMember.membershipId })),
      422,
      'visitor_host_not_found',
    )
    assertError(
      await post(ANONYMIZE, a.admin, { visitorIds: [bVisitor.id], reason: 'data_subject_request' }),
      422,
      'visitor_not_found',
    )
    assert.equal(ok(await get(SETTINGS, a.admin)).version, 1)
    assertError(
      await versioned('PATCH', SETTINGS, a.admin, { retentionDays: 10, institutionId: b.id }, 1),
      400,
    )
    const [bRow] = await rowsOf(b.id)
    assert.equal(bRow?.checkedOutAt, null)
    assert.equal(bRow?.badgeReleasedAt, null)
    assert.equal(bRow?.visitorName, 'Ayşe Ziyaretçi')
    assert.equal(bRow?.version, bVisitor.version)
  })
})
