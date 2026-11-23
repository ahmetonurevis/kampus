import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { earlyDismissals } from '../src/db/schema/finance-early-dismissals.ts'
import { records } from '../src/db/schema/records.ts'
import { ensureGuardianLinks } from '../src/db/student-guardians.ts'
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
 * Erken çıkış uçları (DOM-FIN-161; ON-168; K-538…K-540; H-116). Her test kendi kurumunu kurar.
 * FIXED_NOW 2026-10-06T09:00Z (Europe/Istanbul 12:00). 9-A'nın o günkü 7 dersi İstanbul 08:30'dan
 * 50 dakika arayla 40'ar dakikadır: 5. ders 11:50–12:30 (şimdi sürüyor), 7. ders 13:30–14:10.
 */

const FINANCE = '/api/v1/finance'
const BASE = `${FINANCE}/early-dismissals`
const SUMMARY = `${FINANCE}/early-dismissal-summary`
const OPTIONS = `${FINANCE}/early-dismissal-pickup-options`
const EFFECTS = `${FINANCE}/early-dismissal-attendance-effects`
const MY = `${FINANCE}/my-early-dismissals`
const TODAY = '2026-10-06'
const GRANDPA_LINK = '00000000-0000-4000-8000-000000000168'
const FATHER_LINK = '00000000-0000-4000-8000-000000000169'
const NOTE = 'Gizli-dis-hekimi-randevusu'
const OTHER_NAME = 'Gizli Komsu Hanim'

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-161: erken çıkış uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.168.0.1'

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
  const post = (url: string, cookie: string | null, body: unknown, key: string = randomUUID()) =>
    call('POST', url, cookie, body, { 'idempotency-key': key })
  const versioned = (url: string, cookie: string | null, body: unknown, version: unknown) =>
    call('POST', url, cookie, body, { 'if-match': `"${String(version)}"` })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  const lesson = (index: number) => {
    const id = `l-${String(index + 1)}`
    return {
      collection: 'schedule' as const,
      id,
      data: {
        id,
        classId: '9-A',
        teacherId: 't-1',
        subjectId: 'mat',
        date: new Date(Date.parse('2026-10-06T05:30:00.000Z') + index * 50 * 60_000).toISOString(),
        duration: 40,
        title: `Ders ${String(index + 1)}`,
      },
    }
  }

  /**
   * Kurum: Deniz (`s-1`, 9-A), Ece (`s-2`, 9-B), ayrılmış Can (`s-3`, 9-A). `mother` Deniz'in
   * velayetli velisi (hesaplı bağ); dede (`p-2`) velayetsiz ama teslim yetkili; `father` velayetsiz
   * ve iletişim kısıtlı; `homeroom` 9-A'nın, `other` 9-B'nin sınıf öğretmeni.
   */
  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.168.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(
      db,
      created.id,
      [
        {
          collection: 'teachers' as const,
          id: 't-1',
          data: { id: 't-1', name: 'Selin Kaya', subjectId: 'mat', branchId: 'b-1' },
        },
        {
          collection: 'teachers' as const,
          id: 't-2',
          data: { id: 't-2', name: 'Ayla Er', subjectId: 'tr', branchId: 'b-1' },
        },
        {
          collection: 'classes' as const,
          id: '9-A',
          data: {
            id: '9-A',
            name: '9-A',
            grade: 9,
            level: 'lise',
            branchId: 'b-1',
            teacherId: 't-1',
          },
        },
        {
          collection: 'classes' as const,
          id: '9-B',
          data: {
            id: '9-B',
            name: '9-B',
            grade: 9,
            level: 'lise',
            branchId: 'b-1',
            teacherId: 't-2',
          },
        },
        {
          collection: 'parents' as const,
          id: 'p-2',
          data: { id: 'p-2', name: 'Hasan Yılmaz', phone: '0532 111 22 13' },
        },
        {
          collection: 'students' as const,
          id: 's-1',
          data: { id: 's-1', name: 'Deniz Yılmaz', classId: '9-A', isActive: true },
        },
        {
          collection: 'students' as const,
          id: 's-2',
          data: { id: 's-2', name: 'Ece Yılmaz', classId: '9-B', isActive: true },
        },
        {
          collection: 'students' as const,
          id: 's-3',
          data: { id: 's-3', name: 'Can Ayrılan', classId: '9-A', isActive: false },
        },
        ...Array.from({ length: 7 }, (_, index) => lesson(index)),
      ],
      FIXED_NOW,
    )
    const mother = await createMember(app, created.id, 'veli', [{ kind: 'child', recordId: 's-1' }])
    const father = await createMember(app, created.id, 'veli')
    await ensureGuardianLinks(db, created.id, [
      {
        id: GRANDPA_LINK,
        studentId: 's-1',
        parentId: 'p-2',
        membershipId: null,
        relationship: 'other',
        custody: 'none',
        contactRestricted: false,
        isPayer: false,
        canPickUp: true,
      },
      {
        id: FATHER_LINK,
        studentId: 's-1',
        parentId: null,
        membershipId: father.membershipId,
        relationship: 'father',
        custody: 'none',
        contactRestricted: true,
        isPayer: false,
        canPickUp: false,
      },
    ])
    const homeroom = await createMember(app, created.id, 'ogretmen', [
      { kind: 'teacher', recordId: 't-1' },
    ])
    const otherTeacher = await createMember(app, created.id, 'ogretmen', [
      { kind: 'teacher', recordId: 't-2' },
    ])
    const desk = await createMember(app, created.id, 'onburo')
    const student = await createMember(app, created.id, 'ogrenci', [
      { kind: 'student', recordId: 's-1' },
    ])
    return {
      id: created.id,
      admin: await signInAs(app, created.admin),
      desk: await signInAs(app, desk),
      mother: await signInAs(app, mother),
      father: await signInAs(app, father),
      homeroom: await signInAs(app, homeroom),
      otherTeacher: await signInAs(app, otherTeacher),
      student: await signInAs(app, student),
    }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>

  const url = (id: unknown) => `${BASE}/${String(id)}`
  const rows = (institutionId: string) =>
    db.select().from(earlyDismissals).where(eq(earlyDismissals.institutionId, institutionId))
  const audits = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))
  const request = (extra: Json = {}) => ({
    studentId: 's-1',
    date: TODAY,
    time: '13:40',
    reason: 'appointment',
    reasonNote: NOTE,
    pickup: { kind: 'self' },
    ...extra,
  })
  const otherPickup = (idLast4 = '1234') => ({
    kind: 'other',
    name: OTHER_NAME,
    idLast4,
    relationship: 'family_friend',
  })
  /** Okulun acil kaydı: dede teslim alacak, onaylı doğar. */
  const emergency = (t: Tenant, extra: Json = {}) =>
    post(
      BASE,
      t.desk,
      request({ pickup: { kind: 'guardian', guardianLinkId: GRANDPA_LINK }, ...extra }),
    )
  const notices = async (cookie: string, kind: string) =>
    ((await get('/api/v1/notifications', cookie)).json().data as Json[]).filter(
      (item) => item.kind === kind,
    )

  test('kimliksiz istek 401', async () => {
    const id = randomUUID()
    for (const target of [BASE, SUMMARY, `${OPTIONS}?studentId=s-1`, EFFECTS, MY, url(id)])
      assertError(await get(target, null), 401)
    assertError(await post(BASE, null, request()), 401)
    for (const verb of ['approve', 'reject', 'cancel', 'release'])
      assertError(await versioned(`${url(id)}/${verb}`, null, {}, 1), 401)
  })

  test('DOM-FIN-161: rol süzgeci ve modül kapalı 403 (K-538, K-540)', async () => {
    const t = await institution()
    const created = ok(await emergency(t), 201)
    for (const cookie of [t.homeroom, t.mother, t.student]) {
      assertError(await get(BASE, cookie), 403)
      assertError(await get(SUMMARY, cookie), 403)
      assertError(await get(url(created.id), cookie), 403)
      assertError(await versioned(`${url(created.id)}/approve`, cookie, {}, created.version), 403)
      assertError(await versioned(`${url(created.id)}/release`, cookie, {}, created.version), 403)
    }
    for (const cookie of [t.homeroom, t.student]) {
      assertError(await post(BASE, cookie, request()), 403)
      assertError(await get(`${OPTIONS}?studentId=s-1`, cookie), 403)
      assertError(await versioned(`${url(created.id)}/cancel`, cookie, {}, created.version), 403)
    }
    for (const cookie of [t.admin, t.desk, t.homeroom, t.student])
      assertError(await get(MY, cookie), 403)
    for (const cookie of [t.mother, t.student]) assertError(await get(EFFECTS, cookie), 403)
    ok(await get(EFFECTS, t.homeroom))
    ok(await get(BASE, t.desk))
    ok(await get(SUMMARY, t.desk))
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(BASE, closed.admin), 403, 'module_disabled')
    assertError(await post(BASE, closed.mother, request()), 403, 'module_disabled')
    assertError(await get(MY, closed.mother), 403, 'module_disabled')
  })

  test('DOM-FIN-161: veli kendi çocuğu için talep açar, onay bekler; mükerrer ve aynı gün ikinci talep yok (K-538)', async () => {
    const t = await institution()
    const options = ok(await get(`${OPTIONS}?studentId=s-1`, t.mother)) as unknown as Json[]
    assert.deepEqual(
      options.map((item) => [item.name === 'Hasan Yılmaz' ? 'dede' : 'anne', item.isSelf]),
      [
        ['anne', true],
        ['dede', false],
      ],
    )
    assertError(await get(`${OPTIONS}?studentId=s-2`, t.mother), 404)
    assertError(await get(`${OPTIONS}?studentId=s-3`, t.admin), 404)

    assertError(await post(BASE, t.mother, request({ time: '9:5' })), 400)
    assertError(await post(BASE, t.mother, request({ reason: 'other', reasonNote: '' })), 400)
    assertError(await post(BASE, t.mother, request({ pickup: otherPickup('12345678901') })), 400)
    assertError(
      await post(BASE, t.mother, request({ date: '2026-10-05' })),
      422,
      'early_dismissal_date_past',
    )
    assertError(await post(BASE, t.mother, request({ studentId: 's-2' })), 404, 'not_found')
    assertError(
      await post(
        BASE,
        t.mother,
        request({ pickup: { kind: 'guardian', guardianLinkId: FATHER_LINK } }),
      ),
      422,
      'early_dismissal_pickup_not_authorized',
    )
    assert.equal((await rows(t.id)).length, 0)

    const key = randomUUID()
    const created = ok(await post(BASE, t.mother, request(), key), 201)
    assert.equal(created.status, 'pending')
    assert.equal(created.source, 'guardian')
    assert.equal(created.plannedAt, '2026-10-06T10:40:00.000Z')
    assert.equal(created.pickupKind, 'guardian')
    assert.equal(created.className, '9-A')
    const replay = await post(BASE, t.mother, request(), key)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal(replay.json().data.id, created.id)
    assertError(
      await post(BASE, t.mother, request({ time: '14:00' })),
      409,
      'early_dismissal_exists',
    )
    assert.equal((await rows(t.id)).length, 1)

    const mine = (await get(MY, t.mother)).json()
    assert.equal(mine.meta.total, 1)
    assert.equal(mine.data[0].reasonNote, NOTE)
    assert.equal('authorizedPickups' in mine.data[0], false)
    const list = (await get(`${BASE}?date=${TODAY}&status=pending`, t.desk)).json()
    assert.equal(list.meta.total, 1)
    assert.equal(list.data[0].studentName, 'Deniz Yılmaz')
    assert.equal('reasonNote' in list.data[0], false)
    assert.deepEqual(ok(await get(SUMMARY, t.desk)).counts, {
      pending: 1,
      approved: 0,
      rejected: 0,
      cancelled: 0,
      released: 0,
    })

    const detail = ok(await get(url(created.id), t.desk))
    assert.equal(detail.reasonNote, NOTE)
    assert.equal((detail.authorizedPickups as Json[]).length, 2)
    assert.equal(detail.effect, null)
    assert.equal((await audits(t.id, 'finance.early_dismissal.read')).length, 1)
    const [audit] = await audits(t.id, 'finance.early_dismissal.create')
    assert.ok(audit)
    assert.equal(JSON.stringify(audit).includes(NOTE), false)
  })

  test('DOM-FIN-161: velayeti olmayan ve iletişim kısıtlı veli talep edemez, listesi boş (K-538)', async () => {
    const t = await institution()
    assertError(await post(BASE, t.father, request()), 403, 'early_dismissal_custody_required')
    assertError(await get(`${OPTIONS}?studentId=s-1`, t.father), 404)
    assert.equal((await get(MY, t.father)).json().meta.total, 0)
    const created = ok(await emergency(t), 201)
    assertError(await versioned(`${url(created.id)}/cancel`, t.father, {}, created.version), 404)
    assert.equal((await rows(t.id)).length, 1)
    assert.equal((await rows(t.id))[0]?.status, 'approved')
  })

  test('DOM-FIN-161: okul onaylar ya da gerekçeyle reddeder; veliye karar bildirimi (K-538)', async () => {
    const t = await institution()
    const created = ok(await post(BASE, t.mother, request()), 201)
    assertError(
      await versioned(`${url(created.id)}/reject`, t.desk, { reason: 'kısa' }, created.version),
      400,
    )
    assertError(
      await versioned(`${url(created.id)}/approve`, t.desk, {}, Number(created.version) + 1),
      409,
    )
    assert.equal((await rows(t.id))[0]?.status, 'pending')
    const rejected = ok(
      await versioned(
        `${url(created.id)}/reject`,
        t.desk,
        { reason: 'Veliye ulaşılamadı.' },
        created.version,
      ),
    )
    assert.equal(rejected.status, 'rejected')
    assert.equal(rejected.rejectionReason, 'Veliye ulaşılamadı.')
    assertError(
      await versioned(`${url(created.id)}/approve`, t.desk, {}, rejected.version),
      422,
      'early_dismissal_closed',
    )
    const [mine] = (await get(MY, t.mother)).json().data as Json[]
    assert.equal(mine?.rejectionReason, 'Veliye ulaşılamadı.')
    const decided = await notices(t.mother, 'early_dismissal_decided')
    assert.deepEqual(
      decided.map((item) => [item.audience, item.title, item.subject]),
      [
        [
          'parent',
          'Deniz için erken çıkış talebiniz yanıtlandı.',
          { type: 'early_dismissals', id: created.id },
        ],
      ],
    )
    const [reject] = await audits(t.id, 'finance.early_dismissal.reject')
    assert.equal(JSON.stringify(reject).includes('ulaşılamadı'), false)

    const second = ok(await post(BASE, t.mother, request({ time: '14:00' })), 201)
    const approved = ok(await versioned(`${url(second.id)}/approve`, t.admin, {}, second.version))
    assert.equal(approved.status, 'approved')
    assertError(
      await versioned(
        `${url(second.id)}/reject`,
        t.admin,
        { reason: 'Geç kaldınız.' },
        approved.version,
      ),
      422,
      'early_dismissal_not_pending',
    )
    assert.equal(approved.decidedAt, FIXED_NOW.toISOString())
  })

  test('DOM-FIN-161: teslim yetkilisine kimlik görülerek teslim; yetkisiz kişi engellenir; veliye teslim bildirimi (K-539)', async () => {
    const t = await institution()
    const created = ok(await emergency(t), 201)
    assert.equal(created.status, 'approved')
    assert.equal(created.source, 'school')
    const release = (body: Json, version: unknown = created.version) =>
      versioned(`${url(created.id)}/release`, t.desk, body, version)
    assertError(
      await release({
        pickup: { kind: 'guardian', guardianLinkId: GRANDPA_LINK },
        identityVerified: false,
      }),
      400,
    )
    assertError(
      await release({
        pickup: { kind: 'guardian', guardianLinkId: FATHER_LINK },
        identityVerified: true,
      }),
      422,
      'early_dismissal_pickup_not_authorized',
    )
    assertError(
      await release({ pickup: { kind: 'other', idLast4: '1234' }, identityVerified: true }),
      422,
      'early_dismissal_pickup_not_authorized',
    )
    const before = await rows(t.id)
    assert.equal(before[0]?.status, 'approved')
    assert.equal(before[0]?.releasedAt, null)

    const released = ok(
      await release({
        pickup: { kind: 'guardian', guardianLinkId: GRANDPA_LINK },
        identityVerified: true,
        releasedAt: '2026-10-06T08:55:00.000Z',
      }),
    )
    assert.equal(released.status, 'released')
    assert.equal(released.releasedAt, '2026-10-06T08:55:00.000Z')
    assert.equal(released.releasedToName, 'Hasan Yılmaz')
    assert.equal(released.releasedToKind, 'guardian')
    const effect = released.effect as Json
    assert.equal(effect.basis, 'released')
    assert.equal(effect.fromPeriod, 5)
    assert.deepEqual(
      (effect.lessons as Json[]).map((item) => [item.period, item.partial]),
      [
        [5, true],
        [6, false],
        [7, false],
      ],
    )
    assertError(
      await release(
        { pickup: { kind: 'guardian', guardianLinkId: GRANDPA_LINK }, identityVerified: true },
        released.version,
      ),
      422,
      'early_dismissal_already_released',
    )
    const [stored] = await rows(t.id)
    assert.equal(stored?.releaseIdentityVerified, true)
    assert.equal(stored?.releasedToGuardianLinkId, GRANDPA_LINK)
    const releasedNotices = await notices(t.mother, 'early_dismissal_released')
    assert.deepEqual(
      releasedNotices.map((item) => [item.audience, item.title]),
      [['parent', 'Deniz erken çıkışla okuldan teslim alındı.']],
    )
    assert.equal((await notices(t.mother, 'early_dismissal_decided')).length, 0)
    assert.equal((await audits(t.id, 'finance.early_dismissal.release')).length, 1)
  })

  test('DOM-FIN-161: kayıtlı olmayan kişi okul onayıyla ve son dört hanesi eşleşirse teslim alır (K-538, K-539)', async () => {
    const t = await institution()
    const created = ok(await post(BASE, t.mother, request({ pickup: otherPickup() })), 201)
    assert.equal(created.maskedIdLast4, '•••• 1234')
    const body = (idLast4: string) => ({
      pickup: { kind: 'other', idLast4 },
      identityVerified: true,
    })
    assertError(
      await versioned(`${url(created.id)}/release`, t.desk, body('1234'), created.version),
      422,
      'early_dismissal_not_approved',
    )
    const approved = ok(await versioned(`${url(created.id)}/approve`, t.desk, {}, created.version))
    assertError(
      await versioned(`${url(created.id)}/release`, t.desk, body('9999'), approved.version),
      422,
      'early_dismissal_pickup_mismatch',
    )
    assert.equal((await rows(t.id))[0]?.status, 'approved')
    const released = ok(
      await versioned(`${url(created.id)}/release`, t.desk, body('1234'), approved.version),
    )
    assert.equal(released.releasedToName, OTHER_NAME)
    assert.equal(released.releasedToKind, 'other')
    const [stored] = await rows(t.id)
    assert.equal(stored?.pickupIdLast4, '1234')
    for (const action of ['create', 'approve', 'release'])
      for (const row of await audits(t.id, `finance.early_dismissal.${action}`))
        assert.equal(JSON.stringify(row).includes(OTHER_NAME), false, action)
  })

  test('DOM-FIN-161: veli ve okul iptal eder; teslim edilmişi iptal edilmez', async () => {
    const t = await institution()
    const own = ok(await post(BASE, t.mother, request()), 201)
    const cancelled = ok(
      await versioned(
        `${url(own.id)}/cancel`,
        t.mother,
        { reason: 'Randevu ertelendi.' },
        own.version,
      ),
    )
    assert.equal(cancelled.status, 'cancelled')
    assertError(
      await versioned(`${url(own.id)}/cancel`, t.mother, {}, cancelled.version),
      422,
      'early_dismissal_closed',
    )
    const school = ok(await emergency(t), 201)
    const released = ok(
      await versioned(
        `${url(school.id)}/release`,
        t.desk,
        { pickup: { kind: 'guardian', guardianLinkId: GRANDPA_LINK }, identityVerified: true },
        school.version,
      ),
    )
    assertError(
      await versioned(`${url(school.id)}/cancel`, t.admin, {}, released.version),
      422,
      'early_dismissal_already_released',
    )
    const next = ok(
      await post(BASE, t.desk, request({ studentId: 's-2', pickup: otherPickup() })),
      201,
    )
    ok(await versioned(`${url(next.id)}/cancel`, t.admin, {}, next.version))
    assertError(
      await versioned(`${url(next.id)}/cancel`, t.mother, {}, Number(next.version) + 1),
      404,
    )
  })

  test('DOM-FIN-161: yoklamaya yansıma etkilenen ders saatlerini verir; öğretmen yalnız kendi sınıfını görür (K-540)', async () => {
    const t = await institution()
    const planned = ok(await emergency(t), 201)
    const pending = ok(
      await post(BASE, t.desk, request({ studentId: 's-2', pickup: otherPickup() })),
      201,
    )
    ok(await versioned(`${url(pending.id)}/cancel`, t.desk, {}, pending.version))
    const effects = ok(await get(`${EFFECTS}?date=${TODAY}`, t.admin))
    const items = effects.items as Json[]
    assert.equal(items.length, 1)
    assert.equal(items[0]?.dismissalId, planned.id)
    assert.equal(items[0]?.basis, 'planned')
    assert.equal(items[0]?.departureAt, '2026-10-06T10:40:00.000Z')
    assert.equal(items[0]?.fromPeriod, 7)
    assert.equal((ok(await get(EFFECTS, t.homeroom)).items as Json[]).length, 1)
    assert.equal((ok(await get(EFFECTS, t.otherTeacher)).items as Json[]).length, 0)
    assert.equal((ok(await get(`${EFFECTS}?classId=9-B`, t.admin)).items as Json[]).length, 0)
    assert.equal((ok(await get(`${EFFECTS}?date=2026-10-07`, t.admin)).items as Json[]).length, 0)
    assertError(await get(`${EFFECTS}?date=bugun`, t.admin), 400)
    // Yoklama kaydı yazılmaz: yansıma yalnız okumadır.
    const attendance = await db
      .select({ id: records.id })
      .from(records)
      .where(and(eq(records.institutionId, t.id), eq(records.collection, 'attendance')))
    assert.equal(attendance.length, 0)
  })

  test('DOM-FIN-161: başka kurumun talebi 404 ve B değişmez; listede yok; institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bRow = ok(await emergency(b), 201)
    const bUrl = url(bRow.id)
    assertError(await get(bUrl, a.admin), 404)
    for (const verb of ['approve', 'cancel'])
      assertError(await versioned(`${bUrl}/${verb}`, a.admin, {}, bRow.version), 404)
    assertError(
      await versioned(`${bUrl}/reject`, a.admin, { reason: 'Başka kurum.' }, bRow.version),
      404,
    )
    assertError(
      await versioned(
        `${bUrl}/release`,
        a.desk,
        { pickup: { kind: 'guardian', guardianLinkId: GRANDPA_LINK }, identityVerified: true },
        bRow.version,
      ),
      404,
    )
    assertError(await versioned(`${bUrl}/cancel`, a.mother, {}, bRow.version), 404)
    const [stored] = await rows(b.id)
    assert.equal(stored?.status, 'approved')
    assert.equal(stored?.version, bRow.version)

    assert.equal((await get(BASE, a.admin)).json().meta.total, 0)
    assert.equal((await get(MY, a.mother)).json().meta.total, 0)
    assert.equal((ok(await get(EFFECTS, a.admin)).items as Json[]).length, 0)
    assert.equal((ok(await get(SUMMARY, a.admin)).counts as Json).approved, 0)
    assertError(await post(BASE, a.desk, { ...request(), institutionId: b.id }), 400)
    assertError(await get(`${OPTIONS}?studentId=s-9`, a.admin), 404)
    assert.equal((await rows(a.id)).length, 0)
    assert.equal((await rows(b.id)).length, 1)
  })

  test('guvenlik-kvkk: teslim alanın adı, son dört hane ve neden açıklaması logda gizlenir', async () => {
    const logs: string[] = []
    const logged = await buildTestApp(db, { logs })
    try {
      logged.log.info(
        {
          pickupName: OTHER_NAME,
          idLast4: '4321',
          reasonNote: NOTE,
          dismissal: { pickupIdLast4: '8765', releasedToName: 'Gizli Teslim Alan' },
        },
        'erken çıkış',
      )
      const text = logs.join('')
      assert.ok(text.includes('"msg":"erken çıkış"'))
      for (const value of [OTHER_NAME, '4321', NOTE, '8765', 'Gizli Teslim Alan'])
        assert.equal(text.includes(value), false, value)
    } finally {
      await logged.close()
    }
  })
})
