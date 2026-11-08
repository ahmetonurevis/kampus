import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, isNull } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  purchaseRequestItems,
  purchaseRequests,
} from '../src/db/schema/finance-purchase-requests.ts'
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
 * Satın alma talebi uçları (DOM-FIN-071; ON-222). Her test kendi kurumunu kurar: birim merkezi,
 * gider ve gelir kalemi, açık ve taslak bütçe dönemi, açık dönemde 10.000 TL'lik plan satırı ve bir
 * tedarikçi. FIXED_NOW 2026-10-06.
 */

const REQUESTS = '/api/v1/finance/purchase-requests'
const BUDGET = '/api/v1/finance'

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-071: satın alma talebi uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.71.0.1'

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
    clientIp = `10.71.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    const admin = await signInAs(app, created.admin)
    if (overrides.enabledModules?.finance === false) return { id: created.id, admin }
    const post = async (url: string, body: Json) =>
      ok(await call('POST', `${BUDGET}${url}`, admin, body), 201)
    const center = await post('/cost-centers', { code: 'BT', name: 'Bilgi İşlem', type: 'unit' })
    const otherCenter = await post('/cost-centers', {
      code: 'FEN',
      name: 'Fen Zümresi',
      type: 'unit',
    })
    const expense = await post('/budget-items', { code: 'G-200', name: 'Malzeme', kind: 'expense' })
    const income = await post('/budget-items', { code: 'I-100', name: 'Öğrenim', kind: 'income' })
    const period = await post('/budget-periods', { name: '2026–2027', academicYear: 2026 })
    ok(
      await call(
        'POST',
        `${BUDGET}/budget-periods/${String(period.id)}/open`,
        admin,
        undefined,
        ifMatch(period.version),
      ),
    )
    const draftPeriod = await post('/budget-periods', {
      name: '2027–2028',
      startDate: '2027-09-01',
      endDate: '2028-08-31',
    })
    await post(`/budget-periods/${String(period.id)}/lines`, {
      costCenterId: center.id,
      itemId: expense.id,
      amountCents: 1_000_000,
    })
    const supplier = await post('/suppliers', {
      name: 'Örnek Bilişim A.Ş.',
      type: 'company',
      taxNumber: '1234567890',
      taxOffice: 'Kadıköy',
      categories: ['it'],
    })
    return {
      id: created.id,
      admin,
      center,
      otherCenter,
      expense,
      income,
      period,
      draftPeriod,
      supplier,
    }
  }
  type Tenant = Awaited<ReturnType<typeof institution>> & { center: Json; period: Json }
  const ready = async () => (await institution()) as Tenant & Record<string, Json>
  const member = async (institutionId: string, role: Role) =>
    signInAs(app, await createMember(app, institutionId, role))

  const body = (t: Record<string, Json>, overrides: Json = {}) => ({
    costCenterId: t.center?.id,
    periodId: t.period?.id,
    budgetItemId: t.expense?.id,
    justification: 'Bilgisayar laboratuvarı için yedek parça',
    supplierId: t.supplier?.id,
    items: [
      { name: 'Klavye', quantity: 10, unit: 'piece', estimatedUnitPriceCents: 25_000 },
      { name: 'Fare', quantity: 10, unit: 'piece', estimatedUnitPriceCents: 15_000 },
    ],
    ...overrides,
  })
  const create = async (cookie: string, payload: Json) =>
    ok(await call('POST', REQUESTS, cookie, payload), 201)
  const act = (cookie: string, request: Json, verb: string, payload?: Json) =>
    call(
      'POST',
      `${REQUESTS}/${String(request.id)}/${verb}`,
      cookie,
      payload,
      ifMatch(request.version),
    )
  const rowsOf = (institutionId: string) =>
    db.select().from(purchaseRequests).where(eq(purchaseRequests.institutionId, institutionId))
  const activeItems = (institutionId: string) =>
    db
      .select()
      .from(purchaseRequestItems)
      .where(
        and(
          eq(purchaseRequestItems.institutionId, institutionId),
          isNull(purchaseRequestItems.archivedAt),
        ),
      )

  test('kimliksiz istek 401', async () => {
    assertError(await get(REQUESTS, null), 401)
    assertError(await get(`${REQUESTS}/options`, null), 401)
    assertError(await call('POST', REQUESTS, null, {}), 401)
  })

  test('DOM-FIN-071: öğretmen, veli, öğrenci 403; ön büro talep açar ama onaylayamaz (K-128, K-129)', async () => {
    const t = await ready()
    for (const role of ['ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await member(t.id, role)
      assertError(await get(REQUESTS, cookie), 403)
      assertError(await call('POST', REQUESTS, cookie, body(t)), 403)
    }
    const front = await member(t.id, 'onburo')
    const created = await create(front, body(t))
    const submitted = ok(await act(front, created, 'submit'))
    assertError(await act(front, submitted, 'approve', {}), 403)
    assertError(await act(front, submitted, 'reject', { reason: 'Uygun değil' }), 403)
    assert.equal((await rowsOf(t.id))[0]?.status, 'submitted')
  })

  test('DOM-FIN-071: finance modülü kapalıyken talep uçları 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(REQUESTS, closed.admin), 403, 'module_disabled')
    assertError(await get(`${REQUESTS}/options`, closed.admin), 403, 'module_disabled')
  })

  test('DOM-FIN-071: taslak açılır; numara sıralı, tutar kalemlerden, bütçe kalanı bilgisi ve işlemler döner', async () => {
    const t = await ready()
    const response = await call('POST', REQUESTS, t.admin, body(t))
    const first = ok(response, 201)
    assert.equal(response.headers.location, `${REQUESTS}/${String(first.id)}`)
    assert.equal(first.number, 'ST-0001')
    assert.equal(first.status, 'draft')
    assert.equal(first.totalCents, 400_000)
    assert.equal(first.itemCount, 2)
    assert.deepEqual(
      (first.items as Json[]).map((item) => [item.position, item.totalCents]),
      [
        [0, 250_000],
        [1, 150_000],
      ],
    )
    assert.deepEqual(first.budget, {
      plannedCents: 1_000_000,
      approvedCents: 0,
      pendingCents: 0,
      committedCents: 0,
      remainingCents: 1_000_000,
      exceedsRemaining: false,
      overrunCents: 0,
    })
    assert.deepEqual(first.actions, { edit: true, submit: true, cancel: true, decide: false })
    assert.deepEqual(first.supplier, { id: t.supplier.id, name: 'Örnek Bilişim A.Ş.' })
    assert.equal(first.requestedByName, 'Test Yönetici')
    const second = await create(t.admin, body(t, { supplierId: null }))
    assert.equal(second.number, 'ST-0002')
    const list = (await get(REQUESTS, t.admin)).json() as { data: Json[]; meta: Json }
    assert.deepEqual(
      list.data.map((row) => row.number),
      ['ST-0002', 'ST-0001'],
    )
    assert.equal(list.meta.total, 2)
    const audits = await db
      .select({ changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'purchase_request.create')))
    assert.equal(audits.length, 2)
    assert.equal(JSON.stringify(audits).includes('yedek parça'), false)
  })

  test('DOM-FIN-071: geçersiz gövde 400, uygun olmayan bağlı kayıt 422; kayıt yazılmaz', async () => {
    const t = await ready()
    for (const payload of [
      body(t, { items: [] }),
      body(t, { justification: 'kısa' }),
      body(t, {
        items: [{ name: 'X1', quantity: 1.5, unit: 'piece', estimatedUnitPriceCents: 1 }],
      }),
      body(t, { costCenterId: 'merkez' }),
    ])
      assertError(await call('POST', REQUESTS, t.admin, payload), 400, 'validation_failed')
    const cases: [Json, string][] = [
      [{ budgetItemId: t.income.id }, 'purchase_request_budget_item_not_expense'],
      [{ budgetItemId: randomUUID() }, 'purchase_request_budget_item_not_found'],
      [{ periodId: randomUUID() }, 'purchase_request_period_not_found'],
      [{ supplierId: randomUUID() }, 'purchase_request_supplier_not_found'],
    ]
    for (const [overrides, code] of cases)
      assertError(await call('POST', REQUESTS, t.admin, body(t, overrides)), 422, code)
    ok(
      await call(
        'PATCH',
        `${BUDGET}/cost-centers/${String(t.otherCenter.id)}`,
        t.admin,
        { isActive: false },
        ifMatch(t.otherCenter.version),
      ),
    )
    assertError(
      await call('POST', REQUESTS, t.admin, body(t, { costCenterId: t.otherCenter.id })),
      422,
      'purchase_request_cost_center_inactive',
    )
    assert.equal((await rowsOf(t.id)).length, 0)
    assert.equal((await activeItems(t.id)).length, 0)
  })

  test('DOM-FIN-071: taslak düzeltilir, kalemler yenilenir; ön büro başkasının talebini değiştiremez (K-128)', async () => {
    const t = await ready()
    const front = await member(t.id, 'onburo')
    const own = await create(front, body(t))
    const url = `${REQUESTS}/${String(own.id)}`
    const updated = ok(
      await call(
        'PATCH',
        url,
        front,
        {
          justification: 'Yazıcı toneri de eklendi',
          items: [{ name: 'Toner', quantity: 2, unit: 'box', estimatedUnitPriceCents: 90_000 }],
        },
        ifMatch(own.version),
      ),
    )
    assert.equal(updated.totalCents, 180_000)
    assert.equal(updated.version, 2)
    assert.equal((await activeItems(t.id)).length, 1)
    const adminRequest = await create(t.admin, body(t))
    const before = await rowsOf(t.id)
    assertError(
      await call(
        'PATCH',
        `${REQUESTS}/${String(adminRequest.id)}`,
        front,
        { justification: 'Başkasının talebi değişmez' },
        ifMatch(adminRequest.version),
      ),
      403,
      'purchase_request_not_owner',
    )
    assertError(
      await act(front, adminRequest, 'cancel', { reason: 'Gerek kalmadı' }),
      403,
      'purchase_request_not_owner',
    )
    const viewed = ok(await get(`${REQUESTS}/${String(adminRequest.id)}`, front))
    assert.deepEqual(viewed.actions, { edit: false, submit: false, cancel: false, decide: false })
    assert.deepEqual(await rowsOf(t.id), before)
    assertError(
      await call('PATCH', url, front, { justification: 'Sürüm eski kaldı' }, ifMatch(1)),
      409,
      'version_conflict',
    )
    assertError(await call('PATCH', url, front, { justification: 'İf-Match yok' }), 400)
  })

  test('DOM-FIN-071: gönderim açık dönem ister; gönderilen talep düzeltilemez', async () => {
    const t = await ready()
    const inDraftPeriod = await create(t.admin, body(t, { periodId: t.draftPeriod.id }))
    assertError(
      await act(t.admin, inDraftPeriod, 'submit'),
      422,
      'purchase_request_period_not_open',
    )
    const request = await create(t.admin, body(t))
    const submitted = ok(await act(t.admin, request, 'submit'))
    assert.equal(submitted.status, 'submitted')
    assert.equal(typeof submitted.submittedAt, 'string')
    assert.deepEqual(submitted.actions, { edit: false, submit: false, cancel: true, decide: true })
    assertError(
      await call(
        'PATCH',
        `${REQUESTS}/${String(request.id)}`,
        t.admin,
        { justification: 'Gönderildikten sonra' },
        ifMatch(submitted.version),
      ),
      422,
      'purchase_request_not_draft',
    )
    assertError(await act(t.admin, submitted, 'submit'), 422, 'purchase_request_not_draft')
  })

  test('DOM-FIN-071: onay ve ret; onaylanan talep aynı satırın kalanından düşülür (K-145)', async () => {
    const t = await ready()
    const first = ok(await act(t.admin, await create(t.admin, body(t)), 'submit'))
    const approved = ok(await act(t.admin, first, 'approve', { note: 'Uygun' }))
    assert.equal(approved.status, 'approved')
    assert.equal(approved.decisionNote, 'Uygun')
    assert.equal(approved.decidedByName, 'Test Yönetici')

    const big = body(t, {
      items: [{ name: 'Sunucu', quantity: 1, unit: 'piece', estimatedUnitPriceCents: 700_000 }],
    })
    const second = ok(
      await act(t.admin, await create(t.admin, big), 'submit', { confirmOverBudget: true }),
    )
    assert.deepEqual(second.budget, {
      plannedCents: 1_000_000,
      approvedCents: 400_000,
      pendingCents: 0,
      committedCents: 400_000,
      remainingCents: 600_000,
      exceedsRemaining: true,
      overrunCents: 100_000,
    })
    const third = await create(t.admin, body(t))
    assert.equal((third.budget as Json).pendingCents, 700_000)
    assertError(await act(t.admin, second, 'reject', {}), 400)
    const rejected = ok(await act(t.admin, second, 'reject', { reason: 'Bütçe yetersiz' }))
    assert.equal(rejected.status, 'rejected')
    assert.equal(rejected.decisionNote, 'Bütçe yetersiz')
    assertError(await act(t.admin, rejected, 'approve', {}), 422, 'purchase_request_not_submitted')
    assertError(
      await act(t.admin, rejected, 'cancel', { reason: 'Artık gerekmez' }),
      422,
      'purchase_request_not_cancellable',
    )
    assertError(
      await act(t.admin, approved, 'cancel', { reason: 'Artık gerekmez' }),
      422,
      'purchase_request_not_cancellable',
    )
    const otherCenter = await create(t.admin, body(t, { costCenterId: t.otherCenter.id }))
    assert.equal((otherCenter.budget as Json).plannedCents, null)
    assert.equal((otherCenter.budget as Json).remainingCents, null)

    const list = (await get(`${REQUESTS}?status=approved`, t.admin)).json() as { data: Json[] }
    assert.deepEqual(
      list.data.map((row) => row.number),
      ['ST-0001'],
    )
    const search = (await get(`${REQUESTS}?q=ST-0002`, t.admin)).json() as { data: Json[] }
    assert.deepEqual(
      search.data.map((row) => row.status),
      ['rejected'],
    )
    const byCenter = (await get(
      `${REQUESTS}?costCenterId=${String(t.otherCenter.id)}`,
      t.admin,
    ).then((response) => response.json())) as { meta: { total: number } }
    assert.equal(byCenter.meta.total, 1)
  })

  /** Talebin denetim satırlarındaki alan adları (`changes.fields`). */
  const auditFields = async (institutionId: string, action: string, request: Json) =>
    (
      await db
        .select({ changes: auditLog.changes })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.institutionId, institutionId),
            eq(auditLog.action, action),
            eq(auditLog.entityId, String(request.id)),
          ),
        )
    ).map((row) => row.changes?.fields)
  const piece = (cents: number) => ({
    items: [{ name: 'Sunucu', quantity: 1, unit: 'piece', estimatedUnitPriceCents: cents }],
  })

  test('DOM-FIN-071, ON-245: kalanı aşan talep gönderimde 409 budget_exceeded_warning alır, kayıt değişmez; confirmOverBudget ile gider (K-146)', async () => {
    const t = await ready()
    const within = ok(await act(t.admin, await create(t.admin, body(t, piece(700_000))), 'submit'))
    assert.equal(within.status, 'submitted')
    const draft = await create(t.admin, body(t, piece(400_000)))
    assert.equal((draft.budget as Json).exceedsRemaining, true, 'taslak açılır, aşım bilgidir')
    assert.equal((draft.budget as Json).overrunCents, 100_000)
    const before = await rowsOf(t.id)

    const warned = await act(t.admin, draft, 'submit')
    assertError(warned, 409, 'budget_exceeded_warning')
    assert.match(warned.json().message as string, /1\.000,00 ₺ aşıyor .*kalan 3\.000,00 ₺/)
    assertError(await act(t.admin, draft, 'submit', { confirmOverBudget: false }), 409)
    assertError(await act(t.admin, draft, 'submit', { confirmOverBudget: 'evet' }), 400)
    assert.deepEqual(await rowsOf(t.id), before)
    assert.deepEqual(await auditFields(t.id, 'purchase_request.submit', within), [
      ['status', 'submittedAt', 'submittedByUserId'],
    ])
    assert.deepEqual(await auditFields(t.id, 'purchase_request.submit', draft), [])

    const confirmed = ok(await act(t.admin, draft, 'submit', { confirmOverBudget: true }))
    assert.equal(confirmed.status, 'submitted')
    assert.deepEqual(confirmed.budget, {
      plannedCents: 1_000_000,
      approvedCents: 0,
      pendingCents: 700_000,
      committedCents: 700_000,
      remainingCents: 300_000,
      exceedsRemaining: true,
      overrunCents: 100_000,
    })
    assert.deepEqual(await auditFields(t.id, 'purchase_request.submit', draft), [
      ['status', 'submittedAt', 'submittedByUserId', 'confirmOverBudget'],
    ])
  })

  test('DOM-FIN-071, ON-245: bütçe satırı olmayan talep 409 budget_line_missing_warning; ön büro açıkça onaylayarak gönderir (K-146)', async () => {
    const t = await ready()
    const front = await member(t.id, 'onburo')
    const request = await create(front, body(t, { costCenterId: t.otherCenter.id }))
    const warned = await act(front, request, 'submit', {})
    assertError(warned, 409, 'budget_line_missing_warning')
    assert.match(warned.json().message as string, /bütçesiz/)
    assert.equal((await rowsOf(t.id))[0]?.status, 'draft')
    const submitted = ok(await act(front, request, 'submit', { confirmOverBudget: true }))
    assert.equal(submitted.status, 'submitted')
    assert.equal((submitted.budget as Json).plannedCents, null)
  })

  test('DOM-FIN-071, ON-245: onayda bekleyen öteki talepler de taahhüttür; aşan onay 409 ve confirmOverBudget ister (K-145, K-146)', async () => {
    const t = await ready()
    const first = ok(await act(t.admin, await create(t.admin, body(t, piece(600_000))), 'submit'))
    const second = ok(
      await act(t.admin, await create(t.admin, body(t, piece(600_000))), 'submit', {
        confirmOverBudget: true,
      }),
    )
    const detail = ok(await get(`${REQUESTS}/${String(first.id)}`, t.admin))
    assert.equal((detail.budget as Json).remainingCents, 400_000)
    assert.equal((detail.budget as Json).overrunCents, 200_000)
    assertError(
      await act(t.admin, first, 'approve', { note: 'Uygun' }),
      409,
      'budget_exceeded_warning',
    )
    assert.equal((await rowsOf(t.id)).find((row) => row.id === first.id)?.status, 'submitted')
    const approved = ok(
      await act(t.admin, first, 'approve', { note: 'Uygun', confirmOverBudget: true }),
    )
    assert.equal(approved.status, 'approved')
    assert.equal(approved.decisionNote, 'Uygun')
    assert.deepEqual(await auditFields(t.id, 'purchase_request.approve', first), [
      ['status', 'decidedAt', 'decidedByUserId', 'decisionNote', 'confirmOverBudget'],
    ])
    const rejected = ok(await act(t.admin, second, 'reject', { reason: 'Bütçe yetersiz' }))
    assert.equal(rejected.status, 'rejected', 'ret bütçe uyarısı istemez')
    const third = ok(await act(t.admin, await create(t.admin, body(t, piece(400_000))), 'submit'))
    const approvedThird = ok(await act(t.admin, third, 'approve', {}))
    assert.equal(approvedThird.status, 'approved', 'reddedilen talep taahhüt değildir')
    assert.deepEqual(await auditFields(t.id, 'purchase_request.approve', third), [
      ['status', 'decidedAt', 'decidedByUserId', 'decisionNote'],
    ])
  })

  test('DOM-FIN-071, ON-245: kapalı bütçe döneminde talep gönderilemez (422 önce, uyarı sonra)', async () => {
    const t = await ready()
    const request = await create(t.admin, body(t, piece(2_000_000)))
    const period = ok(await get(`${BUDGET}/budget-periods/${String(t.period.id)}`, t.admin))
    ok(
      await call(
        'POST',
        `${BUDGET}/budget-periods/${String(t.period.id)}/close`,
        t.admin,
        undefined,
        ifMatch(period.version),
      ),
    )
    assertError(await act(t.admin, request, 'submit'), 422, 'purchase_request_period_closed')
    assertError(
      await act(t.admin, request, 'submit', { confirmOverBudget: true }),
      422,
      'purchase_request_period_closed',
    )
    assert.equal((await rowsOf(t.id))[0]?.status, 'draft')
  })

  test('DOM-FIN-071, ON-245: form bütçe durumu satırın planını ve taahhüdünü verir; taslak ve iptal sayılmaz; başka kurum sızmaz (K-148)', async () => {
    const t = await ready()
    const front = await member(t.id, 'onburo')
    const url = (overrides: Record<string, unknown> = {}) =>
      `${REQUESTS}/budget-status?${new URLSearchParams({
        periodId: String(t.period.id),
        costCenterId: String(t.center.id),
        budgetItemId: String(t.expense.id),
        ...overrides,
      } as Record<string, string>).toString()}`
    assertError(await get(url(), null), 401)
    const teacher = await member(t.id, 'ogretmen')
    assertError(await get(url(), teacher), 403)
    ok(await act(t.admin, await create(t.admin, body(t, piece(300_000))), 'submit'))
    const approved = ok(
      await act(t.admin, await create(t.admin, body(t, piece(200_000))), 'submit'),
    )
    ok(await act(t.admin, approved, 'approve', {}))
    await create(t.admin, body(t, piece(50_000)))
    const cancelled = ok(
      await act(t.admin, await create(t.admin, body(t, piece(90_000))), 'submit'),
    )
    ok(await act(t.admin, cancelled, 'cancel', { reason: 'Gerek kalmadı' }))
    assert.deepEqual(ok(await get(url(), front)), {
      plannedCents: 1_000_000,
      approvedCents: 200_000,
      pendingCents: 300_000,
      committedCents: 500_000,
      remainingCents: 500_000,
    })
    assert.deepEqual(ok(await get(url({ costCenterId: t.otherCenter.id }), front)), {
      plannedCents: null,
      approvedCents: 0,
      pendingCents: 0,
      committedCents: 0,
      remainingCents: null,
    })
    const b = await ready()
    ok(await act(b.admin, await create(b.admin, body(b, piece(100_000))), 'submit'))
    assert.deepEqual(
      ok(
        await get(
          url({ periodId: b.period.id, costCenterId: b.center.id, budgetItemId: b.expense.id }),
          t.admin,
        ),
      ),
      {
        plannedCents: null,
        approvedCents: 0,
        pendingCents: 0,
        committedCents: 0,
        remainingCents: null,
      },
    )
    assertError(await get(url({ periodId: 'donem' }), t.admin), 400)
    assertError(await get(`${url()}&institutionId=${b.id}`, t.admin), 400)
  })

  test('DOM-FIN-071: iptal gerekçe ister; iptal edilen talep onaylanamaz', async () => {
    const t = await ready()
    const request = await create(t.admin, body(t))
    assertError(await act(t.admin, request, 'cancel', {}), 400)
    const cancelled = ok(await act(t.admin, request, 'cancel', { reason: 'Gerek kalmadı' }))
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(cancelled.cancelReason, 'Gerek kalmadı')
    assertError(await act(t.admin, cancelled, 'approve', {}), 422, 'purchase_request_not_submitted')
    assertError(await act(t.admin, request, 'submit'), 409, 'version_conflict')
  })

  test('DOM-FIN-071: form seçenekleri yalnız etkin merkez, etkin gider kalemi, kapalı olmayan dönem ve etkin tedarikçi', async () => {
    const t = await ready()
    const front = await member(t.id, 'onburo')
    const options = ok(await get(`${REQUESTS}/options`, front))
    assert.deepEqual(
      (options.costCenters as Json[]).map((row) => row.code),
      ['BT', 'FEN'],
    )
    assert.deepEqual(
      (options.budgetItems as Json[]).map((row) => row.code),
      ['G-200'],
    )
    assert.deepEqual((options.periods as Json[]).map((row) => row.status).sort(), ['draft', 'open'])
    assert.deepEqual(
      (options.suppliers as Json[]).map((row) => row.name),
      ['Örnek Bilişim A.Ş.'],
    )
  })

  test('DOM-FIN-071: başka kurumun talebi 404 ve B değişmez; listede yok; B kurum kayıtlarıyla talep açılamaz', async () => {
    const a = await ready()
    const b = await ready()
    const bRequest = await create(b.admin, body(b))
    const bUrl = `${REQUESTS}/${String(bRequest.id)}`
    assertError(await get(bUrl, a.admin), 404)
    assertError(
      await call('PATCH', bUrl, a.admin, { justification: 'Sızma denemesi metni' }, ifMatch(1)),
      404,
    )
    const payloads: [string, Json | undefined][] = [
      ['submit', undefined],
      ['approve', {}],
      ['reject', { reason: 'Sızma' }],
      ['cancel', { reason: 'Sızma' }],
    ]
    for (const [verb, payload] of payloads)
      assertError(await act(a.admin, bRequest, verb, payload), 404)
    const list = (await get(REQUESTS, a.admin)).json() as { meta: { total: number } }
    assert.equal(list.meta.total, 0)
    const options = ok(await get(`${REQUESTS}/options`, a.admin))
    const ids = (key: string) => (options[key] as Json[]).map((row) => row.id)
    assert.equal(ids('costCenters').includes(b.center.id), false)
    assert.equal(ids('suppliers').includes(b.supplier.id), false)
    assert.equal(ids('periods').includes(b.period.id), false)
    assertError(
      await call('POST', REQUESTS, a.admin, body(a, { costCenterId: b.center.id })),
      422,
      'purchase_request_cost_center_not_found',
    )
    assertError(
      await call('POST', REQUESTS, a.admin, body(a, { supplierId: b.supplier.id })),
      422,
      'purchase_request_supplier_not_found',
    )
    assertError(await call('POST', REQUESTS, a.admin, { ...body(a), institutionId: b.id }), 400)
    const [bRow] = await rowsOf(b.id)
    assert.equal(bRow?.status, 'draft')
    assert.equal(bRow?.version, 1)
    assert.equal((await rowsOf(a.id)).length, 0)
  })

  test('DOM-FIN-071: Idempotency-Key ile yinelenen talep aynı numarayı döner, tek satır yazılır', async () => {
    const t = await ready()
    const key = { 'idempotency-key': randomUUID() }
    const first = await call('POST', REQUESTS, t.admin, body(t), key)
    const second = await call('POST', REQUESTS, t.admin, body(t), key)
    assert.equal(first.statusCode, 201)
    assert.equal(second.headers['idempotent-replayed'], 'true')
    assert.equal(second.json().data.number, first.json().data.number)
    assert.equal((await rowsOf(t.id)).length, 1)
  })
})
