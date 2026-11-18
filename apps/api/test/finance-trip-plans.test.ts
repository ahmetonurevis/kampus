import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { memberships } from '../src/db/schema/auth.ts'
import { files } from '../src/db/schema/files.ts'
import { tripPlanEvents, tripPlanStaff, tripPlans } from '../src/db/schema/finance-trip-plans.ts'
import { ensureMember } from '../src/services/identity.ts'
import { recordFileCheck } from '../src/services/files.ts'
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
import { multipart, PDF, tempStorage, uploadParts } from './support/files-sample.ts'

/**
 * Gezi planı ve onay dosyası uçları (DOM-FIN-111; ON-155). Her test kendi kurumunu kurar.
 * FIXED_NOW 2026-10-06: gezi 2026-10-20'de, geçmiş gezi 2026-10-01'dedir.
 */

const URL = '/api/v1/finance/trip-plans'
const OPTIONS = '/api/v1/finance/trip-plan-options'
const ACTIVITIES = '/api/v1/finance/paid-activities'
const TRIP_DAY = '2026-10-20'

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-111: gezi planı ve onay dosyası uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let store: Awaited<ReturnType<typeof tempStorage>>
  let tenantCount = 0
  let clientIp = '10.111.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    store = await tempStorage()
    app = await buildTestApp(db, { storage: store.storage, clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
    await store.remove()
  })

  const key = () => ({ 'idempotency-key': randomUUID() })
  const ifMatch = (version: unknown) => ({ 'if-match': `"${String(version)}"` })
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
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.111.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  /** Adlı personel üyeliği (giriş yapmaz). */
  async function staff(t: Tenant, role: Role, name: string) {
    const user = await createUser(app, { name })
    const membership = await ensureMember(app.auth, db, {
      institutionId: t.id,
      userId: user.id,
      role,
    })
    return membership.id
  }
  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))

  async function teachers(t: Tenant) {
    return {
      lead: await staff(t, 'ogretmen', 'Selin Kaya'),
      helper: await staff(t, 'ogretmen', 'Murat Demir'),
    }
  }
  const body = (team: { lead: string; helper: string }, extra: Json = {}): Json => ({
    name: 'Anıtkabir gezisi',
    purpose: 'Cumhuriyet tarihi kazanımlarını yerinde gözlemlemek.',
    departureAt: `${TRIP_DAY}T05:00:00.000Z`,
    returnAt: `${TRIP_DAY}T17:00:00.000Z`,
    expectedStudentCount: 40,
    stops: [{ place: 'Anıtkabir', note: 'Rehberli tur' }, { place: 'Ankara Kalesi' }],
    staff: [
      { membershipId: team.lead, role: 'lead' },
      { membershipId: team.helper, role: 'assistant' },
    ],
    transport: {
      type: 'bus',
      company: 'Mavi Turizm',
      plate: '06 ABC 123',
      driverName: 'Ali Sürücü',
      driverPhone: '05321112233',
    },
    risks: [{ risk: 'Kalabalıkta kaybolma', measure: 'Yaka kartı ve grup sorumlusu' }],
    emergencyContacts: [{ name: 'Okul müdürü', phone: '05321234567', relation: 'Müdür' }],
    ...extra,
  })
  const create = (cookie: string | null, payload: Json, headers: Record<string, string> = key()) =>
    call('POST', URL, cookie, payload, headers)
  async function plan(t: Tenant, extra: Json = {}, cookie = t.admin) {
    return ok(await create(cookie, body(await teachers(t), extra)), 201)
  }
  const urlOf = (item: Json) => `${URL}/${String(item.id)}`
  const step = (cookie: string, item: Json, verb: string, payload: Json = {}) =>
    call('POST', `${urlOf(item)}/${verb}`, cookie, payload, ifMatch(item.version))
  const patch = (cookie: string, item: Json, payload: Json) =>
    call('PATCH', urlOf(item), cookie, payload, ifMatch(item.version))
  const rowsOf = async (institutionId: string) => ({
    plans: await db.select().from(tripPlans).where(eq(tripPlans.institutionId, institutionId)),
    staff: await db
      .select()
      .from(tripPlanStaff)
      .where(eq(tripPlanStaff.institutionId, institutionId)),
    events: await db
      .select()
      .from(tripPlanEvents)
      .where(eq(tripPlanEvents.institutionId, institutionId)),
  })
  async function upload(t: Tenant, cookie = t.admin) {
    const form = multipart(uploadParts('document', PDF, 'Araç ruhsatı.pdf'))
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      remoteAddress: clientIp,
      headers: { origin: TEST_ORIGIN, cookie, 'content-type': form.contentType, ...key() },
      payload: form.payload,
    })
    assert.equal(response.statusCode, 201, response.body)
    const id: string = response.json().data.id
    await recordFileCheck(db, store.storage, {
      institutionId: t.id,
      fileId: id,
      outcome: 'ready',
      now: FIXED_NOW,
      log: app.log,
    })
    return id
  }
  async function activity(t: Tenant, extra: Json = {}) {
    return ok(
      await call('POST', ACTIVITIES, t.admin, {
        name: 'Test Ankara gezisi',
        kind: 'trip',
        activityDate: TRIP_DAY,
        feeCents: 150_000,
        joinDeadline: '2026-10-15',
        cancelDeadline: '2026-10-10',
        capacity: 40,
        lateRefundRule: 'percent',
        lateRefundPercent: 50,
        lateCostCents: null,
        ...extra,
      }),
      201,
    )
  }

  test('kimliksiz istek 401', async () => {
    const item = `${URL}/${randomUUID()}`
    assertError(await get(URL, null), 401)
    assertError(await get(OPTIONS, null), 401)
    assertError(await get(item, null), 401)
    assertError(await create(null, {}), 401)
    assertError(await call('PATCH', item, null, { name: 'Yeni ad' }, ifMatch(1)), 401)
    for (const verb of ['submit', 'approve', 'reject', 'authority-notice', 'complete', 'cancel'])
      assertError(await call('POST', `${item}/${verb}`, null, {}, ifMatch(1)), 401)
  })

  test('öğretmen, veli ve öğrenci 403; modül kapalıyken 403', async () => {
    const t = await institution()
    const team = await teachers(t)
    for (const role of ['ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(URL, cookie), 403)
      assertError(await get(OPTIONS, cookie), 403)
      assertError(await create(cookie, body(team)), 403)
    }
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(URL, closed.admin), 403, 'module_disabled')
    assertError(await create(closed.admin, body(team)), 403, 'module_disabled')
    assert.equal((await rowsOf(t.id)).plans.length, 0)
  })

  test('DOM-FIN-111: ön büro taslak açar; plan numaralı, görevli ve geçmişle yazılır, denetime alan adı düşer (K-366)', async () => {
    const t = await institution()
    const desk = await member(t.id, 'onburo')
    const created = await plan(t, {}, desk)
    assert.equal(created.number, 'GZ-0001')
    assert.equal(created.status, 'draft')
    assert.equal(created.staffCount, 2)
    assert.deepEqual(created.leadNames, ['Selin Kaya'])
    assert.equal(created.ratioWarning, true)
    assert.deepEqual(created.ratio, { studentsPerStaff: 20, recommendedStaff: 3, warning: true })
    assert.equal((created.transport as Json).plate, '06ABC123')
    assert.deepEqual(created.actions, {
      edit: true,
      submit: true,
      approve: false,
      reject: false,
      complete: false,
      cancel: true,
      notify: false,
    })
    const rows = await rowsOf(t.id)
    assert.equal(rows.plans.length, 1)
    assert.equal(rows.staff.length, 2)
    assert.deepEqual(
      rows.events.map((row) => row.event),
      ['created'],
    )
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'trip_plan.create')))
    assert.ok(audit)
    assert.equal(JSON.stringify(audit.changes).includes('Ali Sürücü'), false)
    // Liste kişisel veri taşımaz; numara ve adla aranır.
    const list = (await get(`${URL}?q=GZ-0001`, desk)).json() as { data: Json[] }
    assert.equal(list.data.length, 1)
    assert.equal('emergencyContacts' in (list.data[0] ?? {}), false)
    assert.equal((await get(`${URL}?state=done`, desk)).json().meta.total, 0)
    assert.equal(ok(await get(urlOf(created), desk)).createdByName !== null, true)
  })

  test('DOM-FIN-111: Idempotency-Key zorunlu; aynı anahtarla ikinci istek ikinci plan açmaz', async () => {
    const t = await institution()
    const payload = body(await teachers(t))
    assertError(await create(t.admin, payload, {}), 400)
    const headers = key()
    ok(await create(t.admin, payload, headers), 201)
    const again = await create(t.admin, payload, headers)
    assert.equal(again.statusCode, 201)
    assert.equal(again.headers['idempotent-replayed'], 'true')
    assert.equal((await rowsOf(t.id)).plans.length, 1)
  })

  test('DOM-FIN-111: geçersiz plan 400/422 ve kayıt değişmez (K-366)', async () => {
    const t = await institution()
    const team = await teachers(t)
    const desk = await staff(t, 'onburo', 'Ön Büro')
    const inactive = await staff(t, 'ogretmen', 'Eski Öğretmen')
    await db
      .update(memberships)
      .set({ deactivatedAt: FIXED_NOW })
      .where(eq(memberships.id, inactive))
    assertError(await create(t.admin, body(team, { institutionId: 'x' })), 400)
    assertError(await create(t.admin, body(team, { stops: [] })), 400)
    assertError(
      await create(t.admin, body(team, { departureAt: '2026-10-01T05:00:00.000Z' })),
      422,
      'trip_plan_departure_past',
    )
    assertError(
      await create(t.admin, body(team, { returnAt: '2026-10-19T05:00:00.000Z' })),
      422,
      'trip_plan_return_before_departure',
    )
    const with_ = (membershipId: string) => body(team, { staff: [{ membershipId, role: 'lead' }] })
    assertError(await create(t.admin, with_('yok')), 422, 'trip_plan_staff_not_found')
    assertError(await create(t.admin, with_(desk)), 422, 'trip_plan_staff_not_teacher')
    assertError(await create(t.admin, with_(inactive)), 422, 'trip_plan_staff_inactive')
    assertError(
      await create(t.admin, body(team, { paidActivityId: randomUUID() })),
      422,
      'trip_plan_activity_not_found',
    )
    const rows = await rowsOf(t.id)
    assert.equal(rows.plans.length, 0)
    assert.equal(rows.staff.length, 0)
  })

  test('DOM-FIN-111: onay akışı taslak → onay → bildirim → tamamlama; düzeltme yeniden onay ister (K-367, K-368)', async () => {
    const t = await institution()
    const desk = await member(t.id, 'onburo')
    let item = await plan(t, {}, desk)
    // Ön büro onaylayamaz; onaya göndermeden onay olmaz.
    assertError(await step(desk, item, 'approve'), 403)
    assertError(await step(t.admin, item, 'approve'), 422, 'trip_plan_status_invalid')
    item = ok(await step(desk, item, 'submit', { note: 'Onayınıza sunulur' }))
    assert.equal(item.status, 'submitted')
    assertError(
      await step(desk, item, 'cancel', { reason: 'Vazgeçtik' }),
      403,
      'trip_plan_cancel_forbidden',
    )
    assertError(await step(t.admin, item, 'reject', { reason: 'yok' }), 400)
    item = ok(await step(t.admin, item, 'reject', { reason: 'Risk maddeleri eksik' }))
    assert.equal(item.status, 'rejected')
    assert.equal(item.rejectionReason, 'Risk maddeleri eksik')
    // Reddedilen plan düzeltilince taslağa döner, ret silinir.
    item = ok(
      await patch(desk, item, {
        risks: [
          { risk: 'Kalabalıkta kaybolma', measure: 'Yaka kartı' },
          { risk: 'Trafik', measure: 'Emniyet kemeri denetimi' },
        ],
      }),
    )
    assert.equal(item.status, 'draft')
    assert.equal(item.rejectionReason, null)
    item = ok(await step(desk, item, 'submit'))
    item = ok(await step(t.admin, item, 'approve', { note: 'Uygundur' }))
    assert.equal(item.status, 'approved')
    assert.ok(item.approvedAt)
    assert.ok(item.approvedByName)
    assertError(
      await step(desk, item, 'authority-notice', { notifiedOn: '2026-10-07' }),
      422,
      'trip_plan_notice_date_future',
    )
    item = ok(
      await step(desk, item, 'authority-notice', { notifiedOn: '2026-10-06', reference: 'E-123' }),
    )
    assert.equal(item.authorityNotifiedOn, '2026-10-06')
    assert.equal(item.authorityReference, 'E-123')
    // Dönüşten önce tamamlanmaz.
    assertError(await step(t.admin, item, 'complete'), 422, 'trip_plan_not_returned')
    // Onaydan sonra düzeltme: onay ve bildirim düşer, yeniden onay gerekir.
    const reopened = ok(await patch(desk, item, { expectedStudentCount: 30 }))
    assert.equal(reopened.status, 'draft')
    assert.equal(reopened.approvedAt, null)
    assert.equal(reopened.authorityNotifiedOn, null)
    assert.equal(reopened.ratioWarning, false)
    assert.deepEqual(
      (reopened.events as Json[]).map((event) => event.event),
      [
        'created',
        'submitted',
        'rejected',
        'reopened',
        'submitted',
        'approved',
        'authority_notified',
        'reopened',
      ],
    )
    assertError(
      await patch(desk, reopened, { expectedStudentCount: 30 }),
      422,
      'trip_plan_unchanged',
    )
    // Eski sürümle yazma 409.
    assertError(await patch(desk, item, { name: 'Başka ad' }), 409)
    const audits = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.institutionId, t.id))
    for (const action of [
      'trip_plan.submit',
      'trip_plan.approve',
      'trip_plan.reject',
      'trip_plan.authority_notice',
    ])
      assert.ok(
        audits.some((row) => row.action === action),
        action,
      )
  })

  test('DOM-FIN-111: onaya gönderme eksik risk, acil iletişim ve araç bilgisini reddeder (K-366)', async () => {
    const t = await institution()
    const item = await plan(t, {
      risks: [],
      emergencyContacts: [],
      transport: { type: 'bus', company: null, plate: null, driverName: null },
    })
    assertError(await step(t.admin, item, 'submit'), 422, 'trip_plan_risks_required')
    const withRisk = ok(
      await patch(t.admin, item, { risks: [{ risk: 'Hava durumu', measure: 'Yağmurluk' }] }),
    )
    assertError(
      await step(t.admin, withRisk, 'submit'),
      422,
      'trip_plan_emergency_contact_required',
    )
    const withContact = ok(
      await patch(t.admin, withRisk, {
        emergencyContacts: [{ name: 'Müdür Yardımcısı', phone: '05320000000' }],
      }),
    )
    assertError(await step(t.admin, withContact, 'submit'), 422, 'trip_plan_transport_incomplete')
    const [row] = (await rowsOf(t.id)).plans
    assert.equal(row?.status, 'draft')
  })

  test('DOM-FIN-111: tamamlama dönüşten sonra, iptal gerekçeyle; biten plan değişmez (K-367)', async () => {
    const t = await institution()
    let item = await plan(t, {
      departureAt: '2026-10-06T13:00:00.000Z',
      returnAt: '2026-10-06T14:00:00.000Z',
    })
    item = ok(await step(t.admin, item, 'submit'))
    item = ok(await step(t.admin, item, 'approve'))
    assertError(await step(t.admin, item, 'complete'), 422, 'trip_plan_not_returned')
    const cancelled = ok(await step(t.admin, item, 'cancel', { reason: 'Hava muhalefeti' }))
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(cancelled.cancelReason, 'Hava muhalefeti')
    assertError(
      await patch(t.admin, cancelled, { name: 'Yeni gezi' }),
      422,
      'trip_plan_status_invalid',
    )
    assertError(
      await step(t.admin, cancelled, 'cancel', { reason: 'İkinci iptal' }),
      422,
      'trip_plan_status_invalid',
    )
  })

  test('DOM-FIN-111: ücretli etkinlik bağı tek plana, gün aralığında; iptal edilen planın etkinliği serbest kalır (DOM-FIN-098)', async () => {
    const t = await institution()
    const paid = await activity(t)
    const options = ok(await get(OPTIONS, t.admin))
    assert.equal((options.activities as Json[]).length, 1)
    const linked = await plan(t, { paidActivityId: paid.id })
    assert.deepEqual((linked.paidActivity as Json).id, paid.id)
    const linkedOptions = ok(await get(OPTIONS, t.admin))
    assert.equal((linkedOptions.activities as Json[])[0]?.linkedPlanId, linked.id)
    assert.ok((linkedOptions.staff as Json[]).some((row) => row.name === 'Selin Kaya'))
    const team = await teachers(t)
    assertError(
      await create(t.admin, body(team, { paidActivityId: paid.id })),
      409,
      'trip_plan_activity_linked',
    )
    assertError(
      await patch(t.admin, linked, {
        departureAt: '2026-10-21T05:00:00.000Z',
        returnAt: '2026-10-21T17:00:00.000Z',
      }),
      422,
      'trip_plan_activity_date_mismatch',
    )
    ok(await step(t.admin, linked, 'cancel', { reason: 'Plan yenilenecek' }))
    ok(await create(t.admin, body(team, { paidActivityId: paid.id })), 201)
  })

  test('DOM-FIN-111: ulaşım belgesi plana bağlanır, değişince eski bağ kalkar; öğretmen belgeyi açamaz', async () => {
    const t = await institution()
    const fileId = await upload(t)
    const team = await teachers(t)
    const created = ok(
      await create(
        t.admin,
        body(team, {
          transport: {
            type: 'minibus',
            company: 'Mavi',
            plate: '34AB123',
            driverName: 'Ali',
            documentFileId: fileId,
          },
        }),
      ),
      201,
    )
    const transport = created.transport as Json
    assert.deepEqual(transport.documentFile, {
      id: fileId,
      name: 'Araç ruhsatı.pdf',
      byteSize: PDF.length,
    })
    assert.equal((await get(`/api/v1/files/${fileId}/url`, t.admin)).statusCode, 200)
    const desk = await member(t.id, 'onburo')
    assert.equal((await get(`/api/v1/files/${fileId}/url`, desk)).statusCode, 200)
    const teacher = await member(t.id, 'ogretmen')
    assertError(await get(`/api/v1/files/${fileId}/url`, teacher), 404)
    const replacement = await upload(t)
    const updated = ok(
      await patch(t.admin, created, {
        transport: { ...transport, documentFile: undefined, documentFileId: replacement },
      }),
    )
    assert.equal((updated.transport as Json).documentFileId, replacement)
    const [old] = await db
      .select({ attachedId: files.attachedId })
      .from(files)
      .where(and(eq(files.institutionId, t.id), eq(files.id, fileId)))
    assert.equal(old?.attachedId, null)
  })

  test('DOM-FIN-111: başka kurumun planı 404, listede görünmez, yazma B kaydını değiştirmez', async () => {
    const a = await institution()
    const b = await institution()
    const bPlan = await plan(b)
    const bFile = await upload(b)
    const before = await rowsOf(b.id)
    assertError(await get(urlOf(bPlan), a.admin), 404)
    assertError(await patch(a.admin, bPlan, { name: 'Ele geçirildi' }), 404)
    for (const verb of ['submit', 'approve', 'reject', 'authority-notice', 'complete', 'cancel'])
      assertError(
        await step(a.admin, bPlan, verb, {
          ...(verb === 'reject' || verb === 'cancel' ? { reason: 'Başka kurum' } : {}),
          ...(verb === 'authority-notice' ? { notifiedOn: '2026-10-06' } : {}),
        }),
        404,
      )
    assert.equal((await get(URL, a.admin)).json().meta.total, 0)
    const aOptions = ok(await get(OPTIONS, a.admin))
    const bLeadId = before.staff[0]?.membershipId
    assert.equal(
      (aOptions.staff as Json[]).some((row) => row.membershipId === bLeadId),
      false,
    )
    // A'nın planına B'nin öğretmeni ve dosyası bağlanamaz.
    const aTeam = await teachers(a)
    const bLead = (before.staff[0]?.membershipId ?? '') as string
    assertError(
      await create(a.admin, body(aTeam, { staff: [{ membershipId: bLead, role: 'lead' }] })),
      422,
      'trip_plan_staff_not_found',
    )
    assertError(
      await create(
        a.admin,
        body(aTeam, {
          transport: { type: 'train', documentFileId: bFile },
        }),
      ),
      422,
      'file_unavailable',
    )
    assert.deepEqual(await rowsOf(b.id), before)
  })
})
