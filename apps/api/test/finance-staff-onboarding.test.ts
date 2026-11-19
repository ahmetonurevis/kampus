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
  staffJobOffers,
  staffOnboardingSettings,
  staffOnboardingSteps,
} from '../src/db/schema/finance-staff-onboarding.ts'
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
 * İş teklifi ve işe başlama listesi uçları (DOM-FIN-121; ON-179; K-412…K-414). Her test kendi
 * kurumunu kurar. FIXED_NOW 2026-10-06 (İstanbul günü de aynı).
 */

const FINANCE = '/api/v1/finance'
const URL = `${FINANCE}/job-offers`
const SETTINGS = `${FINANCE}/staff-onboarding-settings`
const STAFF = `${FINANCE}/staff-onboarding-staff`

type Json = Record<string, unknown>
type Step = {
  id: string
  kind: string
  documentType: string | null
  label: string
  required: boolean
  completedOn: string | null
  responsible: Json | null
  dueDate: string | null
  evidence: { state: string; detail: string; warning: string | null }
}
type Offer = Json & { id: string; version: number; steps: Step[]; onboarding: Json }
type Response = Awaited<ReturnType<App['inject']>>
type Method = 'GET' | 'POST' | 'PATCH'

describe('DOM-FIN-121: iş teklifi ve işe başlama listesi uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.179.0.1'

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
    clientIp = `10.179.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  /** Adlı üyelik (giriş yapmaz). */
  async function person(t: Tenant, role: Role, name: string) {
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

  const BODY = {
    candidateName: 'Ayşe Aday',
    candidateEmail: 'ayse.aday@ornek.test',
    candidatePhone: '0532 111 22 33',
    position: 'Ön büro görevlisi',
    staffRole: 'onburo',
    startDate: '2026-11-02',
    wageType: 'monthly_gross',
    offeredAmountCents: 3_500_000,
  }
  const create = (cookie: string, body: Json, headers: Record<string, string> = key()) =>
    call('POST', URL, cookie, body, headers)
  const draft = async (t: Tenant, extra: Json = {}) =>
    ok<Offer>(await create(t.admin, { ...BODY, ...extra }), 201)
  const urlOf = (offer: { id: string }) => `${URL}/${offer.id}`
  const act = (cookie: string, offer: Offer, verb: string, body: Json = {}) =>
    call('POST', `${urlOf(offer)}/${verb}`, cookie, body, ifMatch(offer.version))
  const stepUrl = (offer: Offer, step: Step, verb = '') =>
    `${urlOf(offer)}/steps/${step.id}${verb === '' ? '' : `/${verb}`}`
  const complete = (cookie: string, offer: Offer, step: Step, body: Json = {}) =>
    call(
      'POST',
      stepUrl(offer, step, 'complete'),
      cookie,
      { completedOn: '2026-10-06', ...body },
      ifMatch(offer.version),
    )
  /** Taslak → gönderildi → kabul. */
  async function accepted(t: Tenant, extra: Json = {}) {
    const offer = await draft(t, extra)
    const sent = ok<Offer>(await act(t.admin, offer, 'send', { sentOn: '2026-10-01' }))
    return ok<Offer>(await act(t.admin, sent, 'accept', { decidedOn: '2026-10-03' }))
  }
  const stepOf = (offer: Offer, kind: string, documentType: string | null = null) => {
    const found = offer.steps.find(
      (step) => step.kind === kind && (documentType === null || step.documentType === documentType),
    )
    assert.ok(found, `${kind} adımı yok`)
    return found
  }
  const offerRows = (institutionId: string) =>
    db.select().from(staffJobOffers).where(eq(staffJobOffers.institutionId, institutionId))
  const stepRows = (institutionId: string) =>
    db
      .select()
      .from(staffOnboardingSteps)
      .where(eq(staffOnboardingSteps.institutionId, institutionId))
  const auditOf = (institutionId: string, action: string) =>
    db
      .select({ changes: auditLog.changes, entityId: auditLog.entityId })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))
  const listOf = async (cookie: string, query = '') => {
    const response = await get(`${URL}${query}`, cookie)
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as { data: Json[]; meta: { total: number } }
  }

  test('kimliksiz istek 401', async () => {
    const item = `${URL}/${randomUUID()}`
    const step = `${item}/steps/${randomUUID()}`
    assertError(await get(URL, null), 401)
    assertError(await get(item, null), 401)
    assertError(await get(`${item}/letter`, null), 401)
    assertError(await get(SETTINGS, null), 401)
    assertError(await get(STAFF, null), 401)
    assertError(await call('PATCH', SETTINGS, null, { orientationSteps: [] }), 401)
    assertError(await create('', BODY), 401)
    assertError(await call('PATCH', item, null, { position: 'X' }, ifMatch(1)), 401)
    for (const verb of ['send', 'accept', 'reject', 'withdraw', 'link-account'])
      assertError(await call('POST', `${item}/${verb}`, null, {}, ifMatch(1)), 401)
    assertError(await call('PATCH', step, null, { dueDate: null }, ifMatch(1)), 401)
    assertError(await call('POST', `${step}/complete`, null, {}, ifMatch(1)), 401)
    assertError(await call('POST', `${step}/reopen`, null, undefined, ifMatch(1)), 401)
  })

  test('DOM-FIN-121: K-412 ön büro, öğretmen, veli ve öğrenci 403; teklif değişmez', async () => {
    const t = await institution()
    const offer = await accepted(t)
    const step = stepOf(offer, 'orientation')
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(URL, cookie), 403)
      assertError(await get(urlOf(offer), cookie), 403)
      assertError(await get(`${urlOf(offer)}/letter`, cookie), 403)
      assertError(await get(SETTINGS, cookie), 403)
      assertError(await get(STAFF, cookie), 403)
      assertError(await call('PATCH', SETTINGS, cookie, { orientationSteps: [] }), 403)
      assertError(await create(cookie, BODY), 403)
      assertError(await act(cookie, offer, 'withdraw', { decidedOn: '2026-10-06' }), 403)
      assertError(await complete(cookie, offer, step), 403)
    }
    const [row] = await offerRows(t.id)
    assert.equal(row?.status, 'accepted')
    assert.equal(row?.version, offer.version)
  })

  test('DOM-FIN-121: finance modülü kapalıyken uçlar 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(URL, closed.admin), 403, 'module_disabled')
    assertError(await get(SETTINGS, closed.admin), 403, 'module_disabled')
    assertError(await create(closed.admin, BODY), 403, 'module_disabled')
  })

  test('DOM-FIN-121: K-412 taslak, düzeltme, gönderim, mektup; Idempotency-Key; denetimde alan adı', async () => {
    const t = await institution()
    assertError(await create(t.admin, BODY, {}), 400)
    const headers = key()
    const offer = ok<Offer>(await create(t.admin, BODY, headers), 201)
    const replay = await create(t.admin, BODY, headers)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal((await offerRows(t.id)).length, 1)
    assert.equal(offer.status, 'draft')
    assert.equal(offer.name, 'Ayşe Aday')
    assert.equal(offer.candidatePhone, '05321112233')
    assert.equal(offer.offeredAmountCents, 3_500_000)
    assert.deepEqual(offer.steps, [])
    assert.equal((offer.onboarding as Json).state, 'none')

    const edited = ok<Offer>(
      await call(
        'PATCH',
        urlOf(offer),
        t.admin,
        { position: 'Ön büro sorumlusu', respondBy: '2026-10-20' },
        ifMatch(offer.version),
      ),
    )
    assert.equal(edited.position, 'Ön büro sorumlusu')
    assertError(
      await call('PATCH', urlOf(offer), t.admin, { position: 'Eski' }, ifMatch(offer.version)),
      409,
    )
    assertError(
      await call(
        'PATCH',
        urlOf(edited),
        t.admin,
        { position: 'Ön büro sorumlusu' },
        ifMatch(edited.version),
      ),
      422,
      'job_offer_unchanged',
    )
    assertError(
      await act(t.admin, edited, 'send', { sentOn: '2026-10-07' }),
      422,
      'job_offer_date_in_future',
    )
    const sent = ok<Offer>(await act(t.admin, edited, 'send', { sentOn: '2026-10-05' }))
    assert.equal(sent.status, 'sent')
    assertError(
      await call('PATCH', urlOf(sent), t.admin, { position: 'Yeni' }, ifMatch(sent.version)),
      422,
      'job_offer_not_draft',
    )

    const letter = ok(await get(`${urlOf(sent)}/letter`, t.admin))
    assert.equal(letter.candidateName, 'Ayşe Aday')
    assert.equal(letter.position, 'Ön büro sorumlusu')
    assert.equal(letter.offeredAmountCents, 3_500_000)
    assert.equal(letter.respondBy, '2026-10-20')
    assert.equal(letter.issuedByName, 'Test Yönetici')
    assert.match(String(letter.institutionName), /Test Kurumu/)
    assert.deepEqual(
      (await auditOf(t.id, 'finance.job_offer.letter_read')).map((row) => row.changes),
      [{ fields: ['candidateName', 'offeredAmountCents'] }],
    )
    const [created] = await auditOf(t.id, 'finance.job_offer.create')
    const fields = (created?.changes as { fields: string[] }).fields
    assert.ok(fields.includes('candidateName') && fields.includes('offeredAmountCents'))
    assert.equal(JSON.stringify(created?.changes).includes('Ayşe'), false)
  })

  test('DOM-FIN-121: K-412 kabul, ret, geri çekme kuralları ve liste süzgeci', async () => {
    const t = await institution()
    const offer = await draft(t, { respondBy: '2026-10-04' })
    assertError(
      await act(t.admin, offer, 'accept', { decidedOn: '2026-10-03' }),
      422,
      'job_offer_not_sent',
    )
    const sent = ok<Offer>(await act(t.admin, offer, 'send', { sentOn: '2026-10-02' }))
    assertError(
      await act(t.admin, sent, 'accept', { decidedOn: '2026-10-05' }),
      422,
      'job_offer_expired',
    )
    assertError(
      await act(t.admin, sent, 'accept', { decidedOn: '2026-10-01' }),
      422,
      'job_offer_decision_before_sent',
    )
    const rejected = ok<Offer>(
      await act(t.admin, sent, 'reject', { decidedOn: '2026-10-05', reason: 'Başka iş' }),
    )
    assert.equal(rejected.status, 'rejected')
    assert.equal(rejected.closeReason, 'Başka iş')
    assertError(
      await act(t.admin, rejected, 'withdraw', { decidedOn: '2026-10-06' }),
      422,
      'job_offer_closed',
    )
    const withdrawn = ok<Offer>(
      await act(t.admin, await draft(t, { candidateName: 'Bora Aday' }), 'withdraw', {
        decidedOn: '2026-10-06',
      }),
    )
    assert.equal(withdrawn.status, 'withdrawn')
    await accepted(t, { candidateName: 'Cem Aday', position: 'Muhasebe' })
    assert.equal((await listOf(t.admin)).meta.total, 3)
    assert.deepEqual(
      (await listOf(t.admin, '?status=accepted')).data.map((row) => row.name),
      ['Cem Aday'],
    )
    assert.deepEqual(
      (await listOf(t.admin, '?q=muhase')).data.map((row) => row.name),
      ['Cem Aday'],
    )
    const [row] = (await listOf(t.admin, '?status=accepted')).data
    assert.equal('candidateEmail' in (row ?? {}), false)
    assert.equal('offeredAmountCents' in (row ?? {}), false)
  })

  test('DOM-FIN-121: K-413 kabulde liste açılır: hesap, zorunlu belgeler, ücret, kıdem, zimmet, oryantasyon', async () => {
    const t = await institution()
    const offer = await accepted(t)
    assert.equal(offer.status, 'accepted')
    assert.deepEqual(
      offer.steps.map((step) => [step.kind, step.documentType, step.required]),
      [
        ['account', null, true],
        ['document', 'diploma', true],
        ['document', 'health_report', true],
        ['document', 'criminal_record', true],
        ['document', 'id_copy', true],
        ['pay_rate', null, true],
        ['seniority', null, true],
        ['asset_handover', null, false],
        ['orientation', null, true],
        ['orientation', null, true],
        ['orientation', null, true],
      ],
    )
    assert.ok(offer.steps.every((step) => step.dueDate === '2026-11-02'))
    assert.deepEqual(offer.onboarding, {
      state: 'open',
      total: 11,
      done: 0,
      requiredTotal: 10,
      requiredDone: 0,
      completedAt: null,
    })
    // Öğretmende çalışma onayı adımı açılır.
    const teacher = await accepted(t, { candidateName: 'Selin Aday', staffRole: 'ogretmen' })
    assert.equal(stepOf(teacher, 'work_permit').evidence.state, 'missing')
    // Hesap bağlanmadan kaynak isteyen adım işaretlenmez; elle adım işaretlenir.
    assertError(
      await complete(t.admin, offer, stepOf(offer, 'pay_rate')),
      422,
      'onboarding_step_evidence_missing',
    )
    assertError(
      await complete(t.admin, offer, stepOf(offer, 'account')),
      422,
      'onboarding_step_evidence_missing',
    )
    const orientation = stepOf(offer, 'orientation')
    assertError(
      await complete(t.admin, offer, orientation, { completedOn: '2026-10-07' }),
      422,
      'onboarding_date_in_future',
    )
    const marked = ok<Offer>(await complete(t.admin, offer, orientation, { note: 'Tamam' }))
    assert.equal((marked.onboarding as Json).done, 1)
    assertError(await complete(t.admin, marked, orientation), 422, 'onboarding_step_completed')
    const reopened = ok<Offer>(
      await call(
        'POST',
        stepUrl(marked, orientation, 'reopen'),
        t.admin,
        undefined,
        ifMatch(marked.version),
      ),
    )
    assert.equal((reopened.onboarding as Json).done, 0)
    const rows = await stepRows(t.id)
    const row = rows.find((item) => item.id === orientation.id)
    assert.equal(row?.completedOn, null)
    assert.equal(row?.note, null)
  })

  test('DOM-FIN-121: K-413 oryantasyon ayarı yeni listelere kopyalanır; açılmış liste değişmez', async () => {
    const t = await institution()
    const defaults = ok(await get(SETTINGS, t.admin))
    assert.equal(defaults.isDefault, true)
    assert.equal(defaults.version, null)
    const before = await accepted(t)
    const saved = ok(
      await call('PATCH', SETTINGS, t.admin, {
        orientationSteps: [{ label: 'Bina turu', required: false }],
      }),
    )
    assert.equal(saved.isDefault, false)
    assert.equal(saved.version, 1)
    assertError(await call('PATCH', SETTINGS, t.admin, { orientationSteps: [] }), 409)
    assertError(
      await call(
        'PATCH',
        SETTINGS,
        t.admin,
        {
          orientationSteps: [
            { label: 'Aynı', required: true },
            { label: 'aynı', required: true },
          ],
        },
        ifMatch(1),
      ),
      400,
    )
    const after = await accepted(t, { candidateName: 'Deniz Aday' })
    assert.deepEqual(
      after.steps.filter((step) => step.kind === 'orientation').map((step) => step.label),
      ['Bina turu'],
    )
    const refreshed = ok<Offer>(await get(urlOf(before), t.admin))
    assert.equal(refreshed.steps.filter((step) => step.kind === 'orientation').length, 3)
    const [settingsRow] = await db
      .select()
      .from(staffOnboardingSettings)
      .where(eq(staffOnboardingSettings.institutionId, t.id))
    assert.equal(settingsRow?.version, 1)
  })

  test('DOM-FIN-121: K-413 hesap bağlama (IST-007), kaynaklar ve K-414 tamamlanma', async () => {
    const t = await institution()
    // Kıdem başlangıcı bugünden sonra girilemez (DOM-FIN-109): işe başlama günü geçmiş.
    const offer = await accepted(t, { startDate: '2026-10-05' })
    const teacher = await person(t, 'ogretmen', 'Yanlış Rol')
    assertError(
      await act(t.admin, offer, 'link-account', { membershipId: teacher }),
      422,
      'onboarding_member_role_mismatch',
    )
    const desk = await person(t, 'onburo', 'Ayşe Aday')
    const linked = ok<Offer>(await act(t.admin, offer, 'link-account', { membershipId: desk }))
    assert.equal(linked.membershipId, desk)
    assert.equal(linked.candidateEmail, null)
    assert.equal(linked.candidatePhone, null)
    assert.equal(stepOf(linked, 'account').completedOn, '2026-10-06')
    assert.equal(stepOf(linked, 'account').evidence.state, 'met')
    assert.deepEqual(stepOf(linked, 'asset_handover').evidence.detail, 'Açık zimmet: 0 demirbaş.')
    // Başka açık listeye bağlı hesap ikinci listeye bağlanmaz.
    const second = await accepted(t, { candidateName: 'İkinci Aday' })
    assertError(
      await act(t.admin, second, 'link-account', { membershipId: desk }),
      422,
      'onboarding_member_linked',
    )

    // Kaynaklar: özlük belgeleri, ücret tanımı, kıdem başlangıcı.
    const post = async (url: string, body: Json) =>
      ok(await call('POST', `${FINANCE}/${url}`, t.admin, body, key()), 201)
    for (const [documentType, extra] of [
      ['diploma', {}],
      ['health_report', { healthReportKind: 'pre_employment' }],
      ['criminal_record', {}],
      ['id_copy', {}],
    ] as const)
      await post('staff-documents', {
        membershipId: desk,
        documentType,
        documentDate: '2026-09-20',
        ...extra,
      })
    await post('pay-rates', {
      membershipId: desk,
      component: 'wage',
      rateType: 'monthly_gross',
      amountCents: 3_600_000,
      startDate: '2026-10-05',
    })
    await post('leave-profiles', { membershipId: desk, seniorityStartDate: '2026-10-05' })

    let current = ok<Offer>(await get(urlOf(linked), t.admin))
    const pay = stepOf(current, 'pay_rate')
    assert.equal(pay.evidence.state, 'met')
    assert.match(pay.evidence.warning ?? '', /tekliften/)
    assert.equal(stepOf(current, 'seniority').evidence.warning, null)
    for (const step of current.steps.filter((item) => item.required && item.completedOn === null))
      current = ok<Offer>(await complete(t.admin, current, step))
    assert.equal((current.onboarding as Json).state, 'completed')
    assert.equal((current.onboarding as Json).completedAt, FIXED_NOW.toISOString())
    // Bağlı hesap, hesaba dayanan adım işaretliyken değişmez; tamamlanan liste geri çekilmez.
    const other = await person(t, 'onburo', 'Başka Personel')
    assertError(
      await act(t.admin, current, 'link-account', { membershipId: other }),
      422,
      'onboarding_member_locked',
    )
    assertError(
      await act(t.admin, current, 'withdraw', { decidedOn: '2026-10-06' }),
      422,
      'job_offer_onboarding_completed',
    )
    // Tamamlanan liste başka listeye bağlanmayı engellemez.
    ok(await act(t.admin, second, 'link-account', { membershipId: desk }))
    const audits = await auditOf(t.id, 'finance.onboarding_step.complete')
    assert.equal(
      audits.length,
      current.steps.filter((step) => step.kind !== 'account' && step.required).length,
    )
  })

  test('DOM-FIN-121: K-414 sorumlu ve son gün; pasif personel sorumlu olamaz; geri çekilen listede adım değişmez', async () => {
    const t = await institution()
    const offer = await accepted(t)
    const responsible = await person(t, 'yonetici', 'Sorumlu Müdür')
    const step = stepOf(offer, 'asset_handover')
    const updated = ok<Offer>(
      await call(
        'PATCH',
        stepUrl(offer, step),
        t.admin,
        { responsibleMembershipId: responsible, dueDate: '2026-10-30' },
        ifMatch(offer.version),
      ),
    )
    assert.deepEqual(stepOf(updated, 'asset_handover').responsible, {
      membershipId: responsible,
      name: 'Sorumlu Müdür',
    })
    assert.equal(stepOf(updated, 'asset_handover').dueDate, '2026-10-30')
    const passive = await person(t, 'ogretmen', 'Pasif Öğretmen')
    await db
      .update(memberships)
      .set({ deactivatedAt: FIXED_NOW })
      .where(eq(memberships.id, passive))
    assertError(
      await call(
        'PATCH',
        stepUrl(updated, step),
        t.admin,
        { responsibleMembershipId: passive },
        ifMatch(updated.version),
      ),
      422,
      'onboarding_responsible_inactive',
    )
    const staff = ok<Json[]>(await get(STAFF, t.admin))
    assert.deepEqual(
      staff.map((row) => row.name).filter((name) => name !== 'Test Yönetici'),
      ['Sorumlu Müdür'],
    )
    const withdrawn = ok<Offer>(
      await act(t.admin, updated, 'withdraw', { decidedOn: '2026-10-06' }),
    )
    assert.equal((withdrawn.onboarding as Json).state, 'closed')
    assertError(await complete(t.admin, withdrawn, step), 422, 'onboarding_not_open')
    assertError(
      await call(
        'PATCH',
        stepUrl(withdrawn, step),
        t.admin,
        { dueDate: null },
        ifMatch(withdrawn.version),
      ),
      422,
      'onboarding_not_open',
    )
    // Başka teklifin adımı 404.
    const otherOffer = await accepted(t, { candidateName: 'Başka Aday' })
    assertError(
      await call(
        'POST',
        `${urlOf(otherOffer)}/steps/${step.id}/complete`,
        t.admin,
        { completedOn: '2026-10-06' },
        ifMatch(otherOffer.version),
      ),
      404,
    )
  })

  test('DOM-FIN-121: başka kurumun teklifi ve personeli 404 ve B değişmez; listede yok; institutionId etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const bOffer = await accepted(b)
    const bStep = stepOf(bOffer, 'orientation')
    const bMember = await person(b, 'onburo', 'B Personeli')
    const bUrl = urlOf(bOffer)

    assertError(await get(bUrl, a.admin), 404)
    assertError(await get(`${bUrl}/letter`, a.admin), 404)
    assertError(
      await call('PATCH', bUrl, a.admin, { position: 'Başka' }, ifMatch(bOffer.version)),
      404,
    )
    for (const [verb, body] of [
      ['send', { sentOn: '2026-10-06' }],
      ['accept', { decidedOn: '2026-10-06' }],
      ['reject', { decidedOn: '2026-10-06' }],
      ['withdraw', { decidedOn: '2026-10-06' }],
      ['link-account', { membershipId: bMember }],
    ] as const)
      assertError(await act(a.admin, bOffer, verb, body), 404)
    assertError(
      await call(
        'PATCH',
        stepUrl(bOffer, bStep),
        a.admin,
        { dueDate: null },
        ifMatch(bOffer.version),
      ),
      404,
    )
    assertError(await complete(a.admin, bOffer, bStep), 404)
    assertError(
      await call(
        'POST',
        stepUrl(bOffer, bStep, 'reopen'),
        a.admin,
        undefined,
        ifMatch(bOffer.version),
      ),
      404,
    )
    assertError(
      await create(a.admin, {
        ...BODY,
        candidateName: null,
        candidateEmail: null,
        candidatePhone: null,
        membershipId: bMember,
      }),
      422,
      'job_offer_not_found',
    )
    assertError(await create(a.admin, { ...BODY, institutionId: b.id }), 400)
    const aOffer = await accepted(a)
    assertError(
      await act(a.admin, aOffer, 'link-account', { membershipId: bMember }),
      422,
      'onboarding_member_not_found',
    )
    assertError(
      await call(
        'PATCH',
        stepUrl(aOffer, stepOf(aOffer, 'orientation')),
        a.admin,
        { responsibleMembershipId: bMember },
        ifMatch(aOffer.version),
      ),
      422,
      'onboarding_responsible_not_found',
    )
    assert.deepEqual(
      (await listOf(a.admin)).data.map((row) => row.id),
      [aOffer.id],
    )
    assert.equal(
      ok<Json[]>(await get(STAFF, a.admin)).some((row) => row.name === 'B Personeli'),
      false,
    )
    // Ayar kuruma özeldir: B'nin ayarı A'da görünmez, A'nın yazması B'yi değiştirmez.
    ok(
      await call('PATCH', SETTINGS, b.admin, {
        orientationSteps: [{ label: 'B kurumu adımı', required: true }],
      }),
    )
    assert.equal(ok(await get(SETTINGS, a.admin)).isDefault, true)
    ok(await call('PATCH', SETTINGS, a.admin, { orientationSteps: [] }))
    assert.deepEqual(ok(await get(SETTINGS, b.admin)).orientationSteps, [
      { label: 'B kurumu adımı', required: true },
    ])
    const [row] = await offerRows(b.id)
    assert.equal(row?.status, 'accepted')
    assert.equal(row?.version, bOffer.version)
    assert.equal(row?.membershipId, null)
    assert.ok((await stepRows(b.id)).every((step) => step.completedOn === null))
  })
})
