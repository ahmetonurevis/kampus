import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { files } from '../src/db/schema/files.ts'
import { transportDocuments } from '../src/db/schema/finance-transport-documents.ts'
import { recordFileCheck } from '../src/services/files.ts'
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
import { multipart, PDF, png, tempStorage, uploadParts } from './support/files-sample.ts'

/**
 * Servis aracı ve personeli belgesi uçları (DOM-FIN-147; ON-147; K-496…K-498). Her test kendi
 * kurumunu kurar. FIXED_NOW 2026-10-06T09:00Z (Europe/Istanbul günü 2026-10-06).
 */

const BASE = '/api/v1/finance/transport'
const VEHICLES = `${BASE}/vehicles`
const ROUTES = `${BASE}/routes`
const DOCS = `${BASE}/documents`
const ALERTS = `${BASE}/document-alerts`
const SETTINGS = `${BASE}/document-settings`

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-147: servis belgesi uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let store: Awaited<ReturnType<typeof tempStorage>>
  let tenantCount = 0
  let clientIp = '10.147.0.1'

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
  const patch = (url: string, cookie: string, body: unknown, version: unknown) =>
    call('PATCH', url, cookie, body, { 'if-match': `"${String(version)}"` })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }
  const listOf = async (cookie: string, query = '') => {
    const response = await get(`${DOCS}${query}`, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Json[]; meta: { total: number } }
  }

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.147.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>

  async function upload(
    t: Tenant,
    cookie: string,
    file: { purpose: string; data: Buffer; name: string; type: string } = {
      purpose: 'document',
      data: PDF,
      name: 'muayene.pdf',
      type: 'application/pdf',
    },
  ) {
    const body = multipart(uploadParts(file.purpose, file.data, file.name, file.type))
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      remoteAddress: clientIp,
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        'content-type': body.contentType,
        'idempotency-key': randomUUID(),
      },
      payload: body.payload,
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

  const vehicleBody = (extra: Json = {}) => ({
    plate: '34 KMP 147',
    capacity: 10,
    driverName: 'Ali Sürücü',
    driverPhone: '0532 123 45 67',
    ...extra,
  })
  const vehicleOf = async (t: Tenant, extra: Json = {}) =>
    ok(await post(VEHICLES, t.admin, vehicleBody(extra)), 201)
  const vehicleDoc = (vehicleId: unknown, documentType: string, extra: Json = {}) => ({
    subject: 'vehicle',
    vehicleId,
    documentType,
    startDate: '2026-01-10',
    endDate: '2027-01-10',
    ...extra,
  })
  const driverDoc = (vehicleId: unknown, documentType: string, extra: Json = {}) => ({
    subject: 'driver',
    vehicleId,
    documentType,
    startDate: '2026-01-10',
    ...extra,
  })
  const created = async (cookie: string, body: unknown) =>
    ok(await post(DOCS, cookie, body), 201) as { document: Json; superseded: Json | null }
  const rowsOf = (institutionId: string) =>
    db.select().from(transportDocuments).where(eq(transportDocuments.institutionId, institutionId))
  const auditOf = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))
  /** Dört zorunlu araç belgesini girer; muayene bitişi verilir. */
  async function fullVehicle(t: Tenant, vehicleId: unknown, inspectionEnd = '2027-01-10') {
    await created(t.admin, vehicleDoc(vehicleId, 'inspection', { endDate: inspectionEnd }))
    for (const type of ['traffic_insurance', 'seat_insurance', 'school_bus_permit'])
      await created(t.admin, vehicleDoc(vehicleId, type))
  }

  test('kimliksiz istek 401', async () => {
    assertError(await get(DOCS, null), 401)
    assertError(await post(DOCS, null, {}), 401)
    assertError(await get(ALERTS, null), 401)
    assertError(await get(SETTINGS, null), 401)
    assertError(await get(`${DOCS}/${randomUUID()}/file-url`, null), 401)
  })

  test('DOM-FIN-147: öğretmen ve veli 403; ön büro ayar yazamaz; modül kapalı 403 (K-496, K-498)', async () => {
    const t = await institution()
    const teacher = await signInAs(app, await createMember(app, t.id, 'ogretmen'))
    const parent = await signInAs(app, await createMember(app, t.id, 'veli'))
    const desk = await signInAs(app, await createMember(app, t.id, 'onburo'))
    const vehicle = await vehicleOf(t)
    assertError(await get(DOCS, teacher), 403)
    assertError(await get(ALERTS, parent), 403)
    assertError(await post(DOCS, teacher, vehicleDoc(vehicle.id, 'inspection')), 403)
    assertError(await patch(SETTINGS, desk, { warningDays: 45 }, 1), 403)
    ok(await post(DOCS, desk, vehicleDoc(vehicle.id, 'inspection')), 201)
    assert.equal((await listOf(desk)).meta.total, 1)
    const closed = await institution({ enabledModules: { transport: false } })
    assertError(await get(DOCS, closed.admin), 403, 'module_disabled')
    assertError(await get(ALERTS, closed.admin), 403, 'module_disabled')
    const noFinance = await institution({ enabledModules: { finance: false } })
    assertError(await get(DOCS, noFinance.admin), 403, 'module_disabled')
  })

  test('DOM-FIN-147: araç belgesi kaydı, yerine geçme ve mükerrer istek (K-496)', async () => {
    const t = await institution()
    const vehicle = await vehicleOf(t)
    assertError(
      await call('POST', DOCS, t.admin, vehicleDoc(vehicle.id, 'inspection')),
      400,
      'idempotency_key_required',
    )
    const key = randomUUID()
    const body = vehicleDoc(vehicle.id, 'inspection', {
      documentNumber: 'MUA-1',
      startDate: '2025-10-01',
      endDate: '2026-10-01',
    })
    const first = await post(DOCS, t.admin, body, key)
    const replay = await post(DOCS, t.admin, body, key)
    assert.equal(first.statusCode, 201, first.body)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal(replay.json().data.document.id, first.json().data.document.id)
    const old = first.json().data.document as Json
    assert.equal(old.status, 'expired')
    assert.equal(old.daysLeft, -5)
    assert.equal(old.documentNumber, 'MUA-1')
    assert.equal(old.vehiclePlate, '34KMP147')
    assert.equal(old.counted, true)
    assert.equal(first.headers.location, `${DOCS}/${String(old.id)}`)

    const renewed = await created(
      t.admin,
      vehicleDoc(vehicle.id, 'inspection', { startDate: '2026-10-02', endDate: '2027-10-02' }),
    )
    assert.equal(renewed.superseded?.id, old.id)
    assert.equal(renewed.superseded?.status, 'superseded')
    assert.equal(renewed.document.replacesId, old.id)
    assert.equal(renewed.document.status, 'valid')
    assertError(
      await post(
        DOCS,
        t.admin,
        vehicleDoc(vehicle.id, 'inspection', { startDate: '2026-09-01', endDate: '2027-09-01' }),
      ),
      422,
      'transport_document_older_than_current',
    )
    // "Diğer" birden çok geçerli belge olabilir.
    await created(t.admin, vehicleDoc(vehicle.id, 'other', { endDate: null }))
    await created(t.admin, vehicleDoc(vehicle.id, 'other', { endDate: null }))
    assert.equal((await listOf(t.admin)).meta.total, 3)
    assert.equal((await listOf(t.admin, '?history=true')).meta.total, 4)
    assert.equal((await rowsOf(t.id)).length, 4)
    assert.equal((await auditOf(t.id, 'finance.transport.document_supersede')).length, 1)
    const [audit] = await auditOf(t.id, 'finance.transport.document_create')
    assert.equal(JSON.stringify(audit?.changes).includes('MUA-1'), false)
  })

  test('DOM-FIN-147: 400 ve 422 ret kayıt yazmaz; arşivli araç ve gelecek tarih (K-496, K-497)', async () => {
    const t = await institution()
    const vehicle = await vehicleOf(t)
    assertError(
      await post(DOCS, t.admin, vehicleDoc(vehicle.id, 'inspection', { endDate: null })),
      400,
    )
    assertError(await post(DOCS, t.admin, vehicleDoc(vehicle.id, 'driving_license')), 400)
    assertError(
      await post(DOCS, t.admin, driverDoc(vehicle.id, 'criminal_record', { documentNumber: '1' })),
      400,
    )
    assertError(
      await post(DOCS, t.admin, { ...vehicleDoc(vehicle.id, 'inspection'), institutionId: t.id }),
      400,
    )
    assertError(
      await post(DOCS, t.admin, vehicleDoc(vehicle.id, 'inspection', { startDate: '2026-10-07' })),
      422,
      'transport_document_start_in_future',
    )
    assertError(
      await post(DOCS, t.admin, vehicleDoc(randomUUID(), 'inspection')),
      422,
      'transport_document_vehicle_not_found',
    )
    const parent = await createMember(app, t.id, 'veli')
    assertError(
      await post(DOCS, t.admin, {
        subject: 'staff',
        membershipId: parent.membershipId,
        documentType: 'criminal_record',
        startDate: '2026-09-01',
      }),
      422,
      'transport_document_not_staff',
    )
    assert.equal((await rowsOf(t.id)).length, 0)
  })

  test('DOM-FIN-147: adli sicil ve psikoteknik yalnız yöneticide; dosya açılışı denetimde (K-497)', async () => {
    const t = await institution()
    const desk = await signInAs(app, await createMember(app, t.id, 'onburo'))
    const guide = await createMember(app, t.id, 'ogretmen')
    const vehicle = await vehicleOf(t, { guideMembershipId: guide.membershipId })
    assertError(
      await post(DOCS, desk, driverDoc(vehicle.id, 'criminal_record')),
      403,
      'transport_document_sensitive_forbidden',
    )
    const fileId = await upload(t, t.admin, {
      purpose: 'document',
      data: PDF,
      name: 'adli-sicil.pdf',
      type: 'application/pdf',
    })
    const criminal = await created(t.admin, {
      subject: 'staff',
      membershipId: guide.membershipId,
      documentType: 'criminal_record',
      startDate: '2026-09-01',
      fileId,
    })
    assert.deepEqual(criminal.document.file, { name: 'adli-sicil.pdf', byteSize: PDF.length })
    // Görseli geçişte yönetici `question_image` ile yükler; ön büro kendi PDF'ini bağlar.
    const photo = await upload(t, t.admin, {
      purpose: 'question_image',
      data: png(),
      name: 'muayene.png',
      type: 'image/png',
    })
    const inspection = await created(
      t.admin,
      vehicleDoc(vehicle.id, 'inspection', { fileId: photo }),
    )
    const deskFile = await upload(t, desk)
    const insurance = await created(
      desk,
      vehicleDoc(vehicle.id, 'traffic_insurance', { fileId: deskFile }),
    )

    const deskRows = (await listOf(desk)).data
    const hidden = deskRows.find((row) => row.id === criminal.document.id)
    assert.equal(hidden?.restricted, true)
    assert.equal(hidden?.file, null)
    assert.equal(hidden?.hasFile, null)
    assert.equal(hidden?.startDate, '2026-09-01')
    const adminRow = (await listOf(t.admin)).data.find((row) => row.id === criminal.document.id)
    assert.equal(adminRow?.hasFile, true)

    const fileUrl = (id: unknown) => `${DOCS}/${String(id)}/file-url`
    assertError(
      await get(fileUrl(criminal.document.id), desk),
      403,
      'transport_document_sensitive_forbidden',
    )
    assertError(await get(`/api/v1/files/${fileId}/url`, t.admin), 404)
    assert.equal(typeof ok(await get(fileUrl(criminal.document.id), t.admin)).url, 'string')
    ok(await get(fileUrl(inspection.document.id), desk))
    ok(await get(fileUrl(insurance.document.id), desk))
    const opens = await auditOf(t.id, 'finance.transport.document_file_open')
    assert.deepEqual(
      opens.map((row) => `${row.actorRole}:${row.entityId}`).sort(),
      [
        `onburo:${String(inspection.document.id)}`,
        `onburo:${String(insurance.document.id)}`,
        `yonetici:${String(criminal.document.id)}`,
      ].sort(),
    )
    assert.equal(JSON.stringify(opens).includes('adli-sicil'), false)
    const bare = await created(t.admin, vehicleDoc(vehicle.id, 'seat_insurance'))
    assertError(await get(fileUrl(bare.document.id), t.admin), 422, 'transport_document_no_file')
    assertError(
      await post(DOCS, t.admin, vehicleDoc(vehicle.id, 'school_bus_permit', { fileId })),
      409,
      'file_already_attached',
    )
    const [attached] = await db
      .select({ attachedType: files.attachedType, attachedId: files.attachedId })
      .from(files)
      .where(and(eq(files.institutionId, t.id), eq(files.id, fileId)))
    assert.deepEqual(attached, {
      attachedType: 'transport_document',
      attachedId: criminal.document.id,
    })
  })

  test('DOM-FIN-147: uyarılar, uygun değil işareti ve sürücü değişikliği; atama engellenmez (K-497, K-498)', async () => {
    const t = await institution()
    const vehicle = await vehicleOf(t)
    const spare = await vehicleOf(t, { plate: '34 KMP 148' })
    const route = ok(
      await post(ROUTES, t.admin, {
        name: 'Moda hattı',
        direction: 'morning',
        vehicleId: vehicle.id,
        stops: [{ name: 'Moda', time: '07:10' }],
      }),
      201,
    )
    // Muayene dün bitti; koltuk sigortası 20 gün sonra.
    await fullVehicle(t, vehicle.id, '2026-10-05')
    await created(
      t.admin,
      driverDoc(vehicle.id, 'driving_license', { licenseClass: 'D', endDate: '2026-10-26' }),
    )
    let alerts = ok(await get(ALERTS, t.admin))
    assert.equal(alerts.warningDays, 30)
    assert.equal(alerts.expiredCount, 1)
    assert.equal(alerts.expiringCount, 1)
    assert.equal(alerts.unfitVehicleCount, 1)
    assert.equal(alerts.missingVehicleCount, 2)
    const rows = alerts.vehicles as Json[]
    const unfit = rows.find((row) => row.vehicleId === vehicle.id)
    assert.equal(unfit?.fit, false)
    assert.deepEqual(unfit?.expiredTypes, ['inspection'])
    assert.deepEqual(unfit?.expiringTypes, ['driving_license'])
    assert.deepEqual(unfit?.missingDriverTypes, [
      'src_certificate',
      'psychotechnical',
      'criminal_record',
    ])
    assert.deepEqual(unfit?.routes, [{ id: route.id, name: 'Moda hattı', direction: 'morning' }])
    const empty = rows.find((row) => row.vehicleId === spare.id)
    assert.equal(empty?.fit, true)
    assert.equal((empty?.missingVehicleTypes as unknown[]).length, 4)
    assert.equal((await listOf(t.admin, '?due=expired')).meta.total, 1)
    assert.equal((await listOf(t.admin, '?due=attention')).meta.total, 2)

    // Uyarı ayarı 10 güne inince ehliyet (20 gün) pencereden çıkar.
    const settings = ok(await get(SETTINGS, t.admin))
    assert.deepEqual(settings, { warningDays: 30, version: 1 })
    assertError(
      await patch(SETTINGS, t.admin, { warningDays: 30 }, 1),
      422,
      'transport_document_settings_unchanged',
    )
    assertError(await patch(SETTINGS, t.admin, { warningDays: 10 }, 5), 409)
    assert.deepEqual(ok(await patch(SETTINGS, t.admin, { warningDays: 10 }, 1)), {
      warningDays: 10,
      version: 2,
    })
    alerts = ok(await get(ALERTS, t.admin))
    assert.equal(alerts.expiringCount, 0)
    assert.equal((await auditOf(t.id, 'finance.transport.document_settings')).length, 1)

    // Uygun olmayan araca atama engellenmez (K-498): güzergâh düzenlenebilir.
    ok(await patch(`${ROUTES}/${String(route.id)}`, t.admin, { name: 'Moda sabah' }, route.version))

    // Sürücü değişince önceki sürücünün ehliyeti sayılmaz.
    const list = (await get(VEHICLES, t.admin)).json().data as Json[]
    const stored = list.find((row) => row.id === vehicle.id)
    ok(
      await patch(
        `${VEHICLES}/${String(vehicle.id)}`,
        t.admin,
        { driverName: 'Veli Sürücü' },
        stored?.version,
      ),
    )
    const license = (await listOf(t.admin, `?subject=driver`)).data[0]
    assert.equal(license?.counted, false)
    assert.equal(license?.subjectName, 'Ali Sürücü')
    alerts = ok(await get(ALERTS, t.admin))
    const changed = (alerts.vehicles as Json[]).find((row) => row.vehicleId === vehicle.id)
    assert.equal((changed?.missingDriverTypes as unknown[]).length, 4)
    // Yeni sürücünün ehliyeti öncekinin yerine geçer.
    const next = await created(
      t.admin,
      driverDoc(vehicle.id, 'driving_license', { licenseClass: 'D', endDate: '2031-01-10' }),
    )
    assert.equal(next.superseded?.id, license?.id)
    assert.equal(next.document.subjectName, 'Veli Sürücü')
    assert.equal(next.document.counted, true)
  })

  test('DOM-FIN-147: başka kurumun aracı ve belgesi 404 ve B değişmez; listede yok; gövdedeki institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bVehicle = await vehicleOf(b)
    const bFile = await upload(b, b.admin)
    const bDoc = (await created(b.admin, vehicleDoc(bVehicle.id, 'inspection', { fileId: bFile })))
      .document
    ok(await patch(SETTINGS, b.admin, { warningDays: 60 }, 1))

    assertError(await get(`${DOCS}/${String(bDoc.id)}/file-url`, a.admin), 404)
    assert.equal(
      (await listOf(a.admin)).data.some((row) => row.id === bDoc.id),
      false,
    )
    assert.equal((await listOf(a.admin, `?vehicleId=${String(bVehicle.id)}`)).meta.total, 0)
    assert.equal((ok(await get(ALERTS, a.admin)).vehicles as unknown[]).length, 0)
    assert.equal(ok(await get(SETTINGS, a.admin)).warningDays, 30)
    assertError(
      await post(DOCS, a.admin, vehicleDoc(bVehicle.id, 'inspection')),
      422,
      'transport_document_vehicle_not_found',
    )
    assertError(
      await post(DOCS, a.admin, { ...vehicleDoc(bVehicle.id, 'inspection'), institutionId: b.id }),
      400,
    )
    const aVehicle = await vehicleOf(a)
    assertError(
      await post(DOCS, a.admin, vehicleDoc(aVehicle.id, 'inspection', { fileId: bFile })),
      422,
      'file_unavailable',
    )
    assertError(await patch(SETTINGS, a.admin, { warningDays: 20, institutionId: b.id }, 1), 400)
    assert.equal((await rowsOf(a.id)).length, 0)
    const [bRow] = await rowsOf(b.id)
    assert.equal(bRow?.supersededAt, null)
    assert.equal(bRow?.version, 1)
    assert.equal(ok(await get(SETTINGS, b.admin)).warningDays, 60)
    assert.equal((await auditOf(b.id, 'finance.transport.document_file_open')).length, 0)
  })
})
