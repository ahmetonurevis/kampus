import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { healthAccessReasons } from '../src/db/schema/finance-health-access.ts'
import { infirmaryMedicationAdministrations } from '../src/db/schema/finance-infirmary.ts'
import {
  infirmaryMedicationDoseCorrections,
  infirmaryMedicationSkips,
} from '../src/db/schema/finance-infirmary-schedule.ts'
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
 * Günlük ilaç çizelgesi, atlama, düzeltme ve velinin doz geçmişi (DOM-FIN-152; ON-161; IST-102;
 * K-511…K-513). Her test kendi kurumunu kurar. FIXED_NOW 2026-10-06T09:00Z (Europe/Istanbul 12:00).
 */

const BASE = '/api/v1/finance/infirmary'
const CONSENTS = `${BASE}/medication-consents`
const CHART = `${BASE}/medication-chart`
const MY_DOSES = `${BASE}/my-medication-doses`
const SETTINGS = `${BASE}/medication-settings`
const SECRETS = ['Parol', '5 ml', 'Kusma oldu', 'Yanlış öğrenciye yazıldı', 'Tok karnına verildi']

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-152: ilaç çizelgesi, atlama ve düzeltme uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.161.0.1'

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
  const patchSettings = (cookie: string | null, body: unknown, version: unknown) =>
    call('PATCH', SETTINGS, cookie, body, { 'if-match': `"${String(version)}"` })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  /** Kurum: Deniz (`s-1`) annesi `mother`; Ece (`s-2`) velisi `other`; ön büro `desk`. */
  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    clientIp = `10.161.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(
      db,
      created.id,
      [
        {
          collection: 'classes' as const,
          id: '9-A',
          data: { id: '9-A', grade: 9, level: 'lise', branchId: 'b-1' },
        },
        {
          collection: 'students' as const,
          id: 's-1',
          data: { id: 's-1', name: 'Deniz Yılmaz', classId: '9-A', isActive: true },
        },
        {
          collection: 'students' as const,
          id: 's-2',
          data: { id: 's-2', name: 'Ece Yılmaz', classId: '9-A', isActive: true },
        },
      ],
      FIXED_NOW,
    )
    const teacher = await createMember(app, created.id, 'ogretmen')
    const desk = await createMember(app, created.id, 'onburo')
    const mother = await createMember(app, created.id, 'veli', [{ kind: 'child', recordId: 's-1' }])
    const other = await createMember(app, created.id, 'veli', [{ kind: 'child', recordId: 's-2' }])
    return {
      id: created.id,
      adminMembershipId: created.adminMembershipId,
      admin: await signInAs(app, created.admin),
      teacher: await signInAs(app, teacher),
      desk: { ...desk, cookie: await signInAs(app, desk) },
      mother: await signInAs(app, mother),
      other: await signInAs(app, other),
    }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>

  const consentUrl = (id: unknown) => `${CONSENTS}/${String(id)}`
  const administrationUrl = (id: unknown) =>
    `${BASE}/medication-administrations/${String(id)}/corrections`
  const skipUrl = (id: unknown) => `${BASE}/medication-skips/${String(id)}/corrections`
  async function approvedConsent(t: Tenant, extra: Json = {}, guardian = t.mother) {
    const created = ok(
      await post(CONSENTS, guardian, {
        studentId: 's-1',
        medicationName: 'Parol şurup',
        dose: '5 ml',
        times: ['09:00', '11:00', '12:30'],
        startDate: '2026-10-06',
        endDate: '2026-10-08',
        note: null,
        ...extra,
      }),
      201,
    )
    return ok(
      await call(
        'POST',
        `${consentUrl(created.id)}/approve`,
        t.desk.cookie,
        {},
        {
          'if-match': `"${String(created.version)}"`,
        },
      ),
    )
  }
  const administer = (t: Tenant, consentId: unknown, extra: Json = {}, cookie = t.desk.cookie) =>
    post(`${consentUrl(consentId)}/administrations`, cookie, {
      scheduledTime: '09:00',
      dose: '5 ml',
      administeredAt: '2026-10-06T06:05:00Z',
      ...extra,
    })
  const skip = (t: Tenant, consentId: unknown, extra: Json = {}, cookie = t.desk.cookie) =>
    post(`${consentUrl(consentId)}/skips`, cookie, {
      scheduledTime: '11:00',
      reason: 'refused',
      ...extra,
    })
  const audits = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))
  const skipRows = (institutionId: string) =>
    db
      .select()
      .from(infirmaryMedicationSkips)
      .where(eq(infirmaryMedicationSkips.institutionId, institutionId))
  const correctionRows = (institutionId: string) =>
    db
      .select()
      .from(infirmaryMedicationDoseCorrections)
      .where(eq(infirmaryMedicationDoseCorrections.institutionId, institutionId))
  const administrationRows = (institutionId: string) =>
    db
      .select()
      .from(infirmaryMedicationAdministrations)
      .where(eq(infirmaryMedicationAdministrations.institutionId, institutionId))
  const reasoned = (url: string, cookie: string | null) =>
    call('GET', url, cookie, undefined, { 'x-access-reason': 'first_aid' })
  const chartOf = async (cookie: string, query = '') =>
    ok(await reasoned(`${CHART}${query}`, cookie)) as {
      date: string
      lateToleranceMinutes: number
      items: Json[]
    }

  test('kimliksiz istek 401', async () => {
    const id = randomUUID()
    for (const url of [CHART, MY_DOSES, SETTINGS]) assertError(await get(url, null), 401)
    assertError(await post(`${consentUrl(id)}/skips`, null, {}), 401)
    assertError(await post(administrationUrl(id), null, {}), 401)
    assertError(await post(skipUrl(id), null, {}), 401)
    assertError(await patchSettings(null, { lateToleranceMinutes: 45 }, 1), 401)
  })

  test('DOM-FIN-152: rol matrisi; düzeltme ve ayar yalnız yönetici; veli yalnız kendi geçmişi; modül kapalı 403', async () => {
    const t = await institution()
    const student = await signInAs(app, await createMember(app, t.id, 'ogrenci'))
    const consent = await approvedConsent(t)
    for (const cookie of [t.teacher, t.mother, student]) {
      assertError(await get(CHART, cookie), 403)
      assertError(await get(SETTINGS, cookie), 403)
      assertError(await skip(t, consent.id, {}, cookie), 403)
    }
    for (const cookie of [t.admin, t.desk.cookie, t.teacher, student])
      assertError(await get(MY_DOSES, cookie), 403)
    const given = ok(await administer(t, consent.id), 201)
    const [administration] = given.administrations as Json[]
    for (const cookie of [t.desk.cookie, t.teacher, t.mother])
      assertError(
        await post(administrationUrl(administration?.id), cookie, {
          kind: 'void',
          reason: 'Yanlış öğrenci',
        }),
        403,
      )
    assertError(await patchSettings(t.desk.cookie, { lateToleranceMinutes: 45 }, 1), 403)
    assert.equal((await correctionRows(t.id)).length, 0)
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(CHART, closed.admin), 403, 'module_disabled')
    assertError(await get(MY_DOSES, closed.mother), 403, 'module_disabled')
  })

  test('DOM-FIN-152: çizelge durumları, gecikme payı, geciken üstte, yoklama işareti ve okuma denetimi (K-511)', async () => {
    const t = await institution()
    const consent = await approvedConsent(t)
    ok(await administer(t, consent.id), 201)
    await insertMissingRecords(
      db,
      t.id,
      [
        {
          collection: 'attendance' as const,
          id: 'att-s-1',
          data: {
            id: 'att-s-1',
            studentId: 's-1',
            classId: '9-A',
            date: '2026-10-06',
            status: 'absent',
            reason: '',
          },
        },
      ],
      FIXED_NOW,
    )
    const chart = await chartOf(t.desk.cookie)
    assert.equal(chart.date, '2026-10-06')
    assert.equal(chart.lateToleranceMinutes, 30)
    assert.deepEqual(
      chart.items.map((item) => `${String(item.scheduledTime)} ${String(item.state)}`),
      ['11:00 overdue', '12:30 pending', '09:00 administered'],
    )
    const [late, , done] = chart.items
    assert.equal(late?.studentName, 'Deniz Yılmaz')
    assert.equal(late?.medicationName, 'Parol şurup')
    assert.equal(late?.dueAt, '2026-10-06T08:00:00.000Z')
    assert.equal(late?.absent, true)
    const [record] = done?.records as Json[]
    assert.equal(record?.kind, 'administration')
    assert.equal(record?.dose, '5 ml')
    assert.equal(record?.voided, false)
    assert.equal(record?.administeredByMembershipId, t.desk.membershipId)
    assert.ok((await audits(t.id, 'finance.infirmary.chart_read')).length >= 1)
    // Sağlık verisi okuma gerekçesi zorunlu (DOM-FIN-156); gerekçe erişim günlüğüne düşer.
    assertError(await get(CHART, t.desk.cookie), 400, 'health_access_reason_required')
    const reasons = await db
      .select()
      .from(healthAccessReasons)
      .where(eq(healthAccessReasons.institutionId, t.id))
    assert.ok(reasons.some((row) => row.reasonCode === 'first_aid' && row.studentId === 's-1'))

    // Gecikme payı 90 dk olunca 11:00 dozu henüz gecikmiş sayılmaz.
    const settings = ok(await get(SETTINGS, t.desk.cookie))
    assert.deepEqual(settings, { lateToleranceMinutes: 30, version: 1 })
    const saved = ok(await patchSettings(t.admin, { lateToleranceMinutes: 90 }, 1))
    assert.deepEqual(saved, { lateToleranceMinutes: 90, version: 2 })
    assertError(await patchSettings(t.admin, { lateToleranceMinutes: 60 }, 1), 409)
    assertError(
      await patchSettings(t.admin, { lateToleranceMinutes: 90 }, 2),
      422,
      'infirmary_settings_unchanged',
    )
    assertError(await patchSettings(t.admin, { lateToleranceMinutes: 2 }, 2), 400)
    assert.equal((await audits(t.id, 'finance.infirmary.settings_update')).length, 1)
    const relaxed = await chartOf(t.desk.cookie)
    assert.deepEqual(
      relaxed.items.map((item) => String(item.state)),
      ['pending', 'pending', 'administered'],
    )
    // Dün tamamen gecikmiş, yarın tamamen bekliyor; dönem dışı gün boş.
    assert.equal((await chartOf(t.desk.cookie, '?date=2026-10-05')).items.length, 0)
    const tomorrow = await chartOf(t.desk.cookie, '?date=2026-10-07')
    assert.ok(tomorrow.items.every((item) => item.state === 'pending' && item.absent === null))
    assertError(await reasoned(`${CHART}?date=yarin`, t.desk.cookie), 400)
    assertError(await reasoned(`${CHART}?institutionId=${t.id}`, t.desk.cookie), 400)
  })

  test('DOM-FIN-152: yoklama modülü kapalıysa işaret boş', async () => {
    const t = await institution({ enabledModules: { academic: false } })
    await approvedConsent(t)
    const chart = await chartOf(t.desk.cookie)
    assert.ok(chart.items.length > 0)
    assert.ok(chart.items.every((item) => item.absent === null))
  })

  test('DOM-FIN-152: atlama gerekçeyle yazılır, şifreli, denetimde; tek sonuç ve mükerrer istek (K-512)', async () => {
    const t = await institution()
    const pending = ok(
      await post(CONSENTS, t.mother, {
        studentId: 's-1',
        medicationName: 'Parol şurup',
        dose: '5 ml',
        times: ['11:00'],
        startDate: '2026-10-06',
        endDate: '2026-10-06',
      }),
      201,
    )
    assertError(await skip(t, pending.id), 422, 'infirmary_consent_not_approved')
    const consent = await approvedConsent(t)
    assertError(await skip(t, consent.id, { reason: 'other' }), 400)
    assertError(
      await skip(t, consent.id, { scheduledTime: '15:00' }),
      422,
      'infirmary_dose_time_not_approved',
    )
    assertError(
      await skip(t, consent.id, { doseDay: '2026-10-07' }),
      422,
      'infirmary_skip_in_future',
    )
    assertError(
      await skip(t, consent.id, { doseDay: '2026-10-05' }),
      422,
      'infirmary_skip_outside_period',
    )
    assertError(await skip(t, consent.id, { institutionId: t.id }), 400)
    assertError(await skip(t, randomUUID()), 404)
    assert.equal((await skipRows(t.id)).length, 0)

    const key = randomUUID()
    const body = { scheduledTime: '11:00', reason: 'other', note: 'Kusma oldu' }
    const created = ok(await post(`${consentUrl(consent.id)}/skips`, t.desk.cookie, body, key), 201)
    assert.equal(created.kind, 'skip')
    assert.equal(created.skipReason, 'other')
    assert.equal(created.note, 'Kusma oldu')
    assert.equal(created.doseDay, '2026-10-06')
    const replay = await post(`${consentUrl(consent.id)}/skips`, t.desk.cookie, body, key)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal((await skipRows(t.id)).length, 1)
    assertError(await skip(t, consent.id), 409, 'infirmary_dose_already_skipped')
    assertError(
      await administer(t, consent.id, {
        scheduledTime: '11:00',
        administeredAt: '2026-10-06T08:05:00Z',
      }),
      409,
      'infirmary_dose_already_skipped',
    )
    ok(await administer(t, consent.id), 201)
    assertError(
      await skip(t, consent.id, { scheduledTime: '09:00' }),
      409,
      'infirmary_dose_already_given',
    )
    const rows = await skipRows(t.id)
    assert.equal(rows.length, 1)
    for (const secret of SECRETS) assert.equal(JSON.stringify(rows).includes(secret), false, secret)
    const [audit] = await audits(t.id, 'finance.infirmary.skip_create')
    assert.deepEqual(audit?.changes, { fields: ['scheduledTime', 'doseDay', 'reason', 'note'] })
    assert.equal(JSON.stringify(audit).includes('Kusma'), false)
    await assert.rejects(
      db
        .update(infirmaryMedicationSkips)
        .set({ scheduledTime: '10:00' })
        .where(eq(infirmaryMedicationSkips.institutionId, t.id)),
    )
    const chart = await chartOf(t.desk.cookie)
    assert.equal(chart.items.find((item) => item.scheduledTime === '11:00')?.state, 'skipped')
  })

  test('DOM-FIN-152: yönetici iptal eder, doz saati yeniden yazılır; düzeltme eski hâli korur (K-513)', async () => {
    const t = await institution()
    const consent = await approvedConsent(t)
    const first = ok(await administer(t, consent.id), 201)
    const [original] = first.administrations as Json[]
    const correct = (id: unknown, body: Json, key = randomUUID()) =>
      post(administrationUrl(id), t.admin, body, key)

    assertError(await correct(original?.id, { kind: 'void', reason: 'kısa' }), 400)
    assertError(await correct(original?.id, { kind: 'amend', reason: 'Saat yanlış girildi' }), 400)
    assertError(
      await correct(original?.id, {
        kind: 'amend',
        reason: 'Saat yanlış girildi',
        administeredAt: '2026-10-05T06:05:00Z',
      }),
      422,
      'infirmary_correction_day_mismatch',
    )
    assertError(
      await correct(original?.id, {
        kind: 'amend',
        reason: 'Uygulayan yanlış',
        administeredByMembershipId: 'nope',
      }),
      422,
      'infirmary_administered_by_not_found',
    )
    assertError(await correct(randomUUID(), { kind: 'void', reason: 'Yanlış öğrenci' }), 404)
    assert.equal((await correctionRows(t.id)).length, 0)

    const amended = ok(
      await correct(original?.id, {
        kind: 'amend',
        reason: 'Saat yanlış girildi',
        administeredAt: '2026-10-06T06:20:00Z',
        administeredByMembershipId: t.adminMembershipId,
        note: 'Tok karnına verildi',
      }),
      201,
    )
    assert.equal(amended.administeredAt, '2026-10-06T06:20:00.000Z')
    assert.equal(amended.administeredByMembershipId, t.adminMembershipId)
    assert.equal(amended.note, 'Tok karnına verildi')
    assert.equal(amended.corrected, true)
    assert.equal((amended.corrections as Json[])[0]?.reason, 'Saat yanlış girildi')
    // Asıl kayıt değişmez; düzeltme ayrı satırdır.
    const [stored] = await administrationRows(t.id)
    assert.equal(stored?.administeredAt.toISOString(), '2026-10-06T06:05:00.000Z')

    const key = randomUUID()
    const voided = ok(
      await correct(original?.id, { kind: 'void', reason: 'Yanlış öğrenciye yazıldı' }, key),
      201,
    )
    assert.equal(voided.voided, true)
    const replay = await correct(
      original?.id,
      { kind: 'void', reason: 'Yanlış öğrenciye yazıldı' },
      key,
    )
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assertError(
      await correct(original?.id, { kind: 'void', reason: 'Yine yanlış öğrenci' }),
      409,
      'infirmary_dose_record_voided',
    )
    assertError(
      await correct(original?.id, { kind: 'amend', reason: 'Not düzeltme', note: 'x' }),
      409,
      'infirmary_dose_record_voided',
    )
    const reopened = await chartOf(t.desk.cookie)
    const slot = reopened.items.find((item) => item.scheduledTime === '09:00')
    assert.equal(slot?.state, 'overdue')
    assert.equal((slot?.records as Json[])[0]?.voided, true)

    // İptal sonrası yeniden uygulama zinciri sürdürür; atlama da yazılabilirdi.
    ok(await administer(t, consent.id, { administeredAt: '2026-10-06T07:00:00Z' }), 201)
    assertError(await administer(t, consent.id), 409, 'infirmary_dose_already_given')
    const rows = await administrationRows(t.id)
    assert.equal(rows.length, 2)
    assert.deepEqual(
      rows.map((row) => row.replacesAdministrationId).sort(),
      [original?.id, null].sort(),
    )
    const chart = await chartOf(t.desk.cookie)
    const again = chart.items.find((item) => item.scheduledTime === '09:00')
    assert.equal(again?.state, 'administered')
    assert.deepEqual(
      (again?.records as Json[]).map((row) => row.voided),
      [true, false],
    )

    // Atlama düzeltmesi ve iptali.
    const skipped = ok(await skip(t, consent.id), 201)
    const changed = ok(
      await post(skipUrl(skipped.id), t.admin, {
        kind: 'amend',
        reason: 'Gerekçe yanlış seçildi',
        skipReason: 'student_absent',
      }),
      201,
    )
    assert.equal(changed.skipReason, 'student_absent')
    assertError(
      await post(skipUrl(skipped.id), t.admin, {
        kind: 'amend',
        reason: 'Gerekçe yanlış seçildi',
        skipReason: 'other',
      }),
      422,
      'infirmary_skip_note_required',
    )
    assertError(
      await post(
        skipUrl(skipped.id),
        t.admin,
        { kind: 'void', reason: 'Öğrenci geldi' },
        randomUUID(),
      ),
      201,
    )
    ok(
      await administer(t, consent.id, {
        scheduledTime: '11:00',
        administeredAt: '2026-10-06T08:10:00Z',
      }),
      201,
    )
    const corrections = await correctionRows(t.id)
    assert.equal(corrections.length, 4)
    for (const secret of SECRETS)
      assert.equal(JSON.stringify(corrections).includes(secret), false, secret)
    await assert.rejects(
      db
        .update(infirmaryMedicationDoseCorrections)
        .set({ kind: 'amend' })
        .where(eq(infirmaryMedicationDoseCorrections.institutionId, t.id)),
    )
    const audit = await audits(t.id, 'finance.infirmary.correction_create')
    const fields = audit.map((row) => (row.changes as { fields: string[] }).fields.join(','))
    assert.equal(fields.length, 4)
    assert.ok(fields.includes('kind,reason,administeredAt,administeredByMembershipId,note'))
    assert.ok(fields.includes('kind,reason,voided'))
    assert.ok(fields.includes('kind,reason,skipReason'))
  })

  test('DOM-FIN-152: veli yalnız kendi çocuğunun uygulanan ve atlanan dozlarını gerekçesiyle görür; iptal yok', async () => {
    const t = await institution()
    const consent = await approvedConsent(t)
    const given = ok(await administer(t, consent.id), 201)
    const [record] = given.administrations as Json[]
    ok(await skip(t, consent.id, { reason: 'guardian_cancelled' }), 201)
    ok(
      await administer(t, consent.id, {
        scheduledTime: '12:30',
        administeredAt: '2026-10-06T08:58:00Z',
      }),
      201,
    )
    const doses = await get(MY_DOSES, t.mother)
    assert.equal(doses.statusCode, 200, doses.body)
    const list = doses.json() as { data: Json[]; meta: { total: number } }
    assert.equal(list.meta.total, 3)
    assert.deepEqual(
      list.data.map((row) => `${String(row.scheduledTime)} ${String(row.kind)}`),
      ['12:30 administration', '11:00 skip', '09:00 administration'],
    )
    assert.equal(list.data[1]?.skipReason, 'guardian_cancelled')
    assert.equal(list.data[2]?.medicationName, 'Parol şurup')
    assert.equal(list.data[2]?.dose, '5 ml')
    ok(
      await post(administrationUrl(record?.id), t.admin, {
        kind: 'void',
        reason: 'Yanlış öğrenci',
      }),
      201,
    )
    const after = (await get(`${MY_DOSES}?pageSize=1`, t.mother)).json() as {
      data: Json[]
      meta: { total: number }
    }
    assert.equal(after.meta.total, 2)
    assert.equal(after.data.length, 1)
    assert.ok((await audits(t.id, 'finance.infirmary.guardian_dose_read')).length >= 1)
    assert.equal((await get(MY_DOSES, t.other)).json().meta.total, 0)
    assert.equal((await get(`${MY_DOSES}?studentId=s-1`, t.other)).json().meta.total, 0)
    assertError(
      await get(`${MY_DOSES}?from=2026-10-06&to=2026-10-01`, t.mother),
      422,
      'infirmary_dose_range_invalid',
    )
    assertError(
      await get(`${MY_DOSES}?from=2026-01-01&to=2026-10-06`, t.mother),
      422,
      'infirmary_dose_range_too_long',
    )
  })

  test('DOM-FIN-152: başka kurumun talebi, uygulaması ve atlaması 404 ve B değişmez; listede yok', async () => {
    const a = await institution()
    const b = await institution()
    const bConsent = await approvedConsent(b)
    const bGiven = ok(await administer(b, bConsent.id), 201)
    const [bAdministration] = bGiven.administrations as Json[]
    const bSkip = ok(await skip(b, bConsent.id), 201)
    assertError(await skip(a, bConsent.id, {}, a.admin), 404)
    assertError(
      await post(administrationUrl(bAdministration?.id), a.admin, {
        kind: 'void',
        reason: 'Başka kurum',
      }),
      404,
    )
    assertError(
      await post(skipUrl(bSkip.id), a.admin, { kind: 'void', reason: 'Başka kurum' }),
      404,
    )
    assert.equal((await chartOf(a.admin)).items.length, 0)
    assert.equal((await get(MY_DOSES, a.mother)).json().meta.total, 0)
    assertError(
      await post(skipUrl(bSkip.id), a.admin, {
        kind: 'void',
        reason: 'Başka kurum',
        institutionId: b.id,
      }),
      400,
    )
    assert.deepEqual(ok(await get(SETTINGS, a.admin)), { lateToleranceMinutes: 30, version: 1 })
    assertError(
      await patchSettings(a.admin, { lateToleranceMinutes: 50, institutionId: b.id }, 1),
      400,
    )
    ok(await patchSettings(b.admin, { lateToleranceMinutes: 45 }, 1))
    assert.deepEqual(ok(await get(SETTINGS, a.admin)), { lateToleranceMinutes: 30, version: 1 })
    assert.equal((await skipRows(b.id)).length, 1)
    assert.equal((await correctionRows(b.id)).length, 0)
    assert.equal((await skipRows(a.id)).length, 0)
    assert.equal((await correctionRows(a.id)).length, 0)
  })
})
