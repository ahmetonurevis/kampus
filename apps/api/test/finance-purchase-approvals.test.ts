import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  purchaseApprovalTiers,
  purchaseRequestApprovalSteps,
} from '../src/db/schema/finance-purchase-approvals.ts'
import { purchaseRequests } from '../src/db/schema/finance-purchase-requests.ts'
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
 * Satın alma talebinin kademeli onayı (DOM-FIN-071; ON-223, K-260…K-263). Her test kendi kurumunu
 * kurar: birim merkezi, gider kalemi, açık bütçe dönemi ve 1.000.000 TL'lik plan satırı (bütçe
 * uyarısı kademe kurallarını gölgelemesin). Kademeler: 0 → herhangi bir yönetici, 5.000 TL → herhangi
 * bir yönetici, 20.000 TL → adlandırılmış kurucu temsilcisi. FIXED_NOW 2026-10-06.
 */

const SETTINGS = '/api/v1/finance/purchase-approval-settings'
const REQUESTS = '/api/v1/finance/purchase-requests'
const BUDGET = '/api/v1/finance'

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-071, ON-223: satın alma talebinin kademeli onayı', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.223.0.1'

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
    clientIp = `10.223.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    const admin = await signInAs(app, created.admin)
    const named = async (role: Role) => {
      const user = await createMember(app, created.id, role)
      return { id: user.id, cookie: await signInAs(app, user) }
    }
    const adminA = { id: created.admin.id, cookie: admin }
    if (overrides.enabledModules?.finance === false)
      return { id: created.id, adminA, named, center: {}, expense: {}, period: {} }
    const post = async (url: string, body: Json) =>
      ok(await call('POST', `${BUDGET}${url}`, admin, body), 201)
    const center = await post('/cost-centers', { code: 'BT', name: 'Bilgi İşlem', type: 'unit' })
    const expense = await post('/budget-items', { code: 'G-200', name: 'Malzeme', kind: 'expense' })
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
    await post(`/budget-periods/${String(period.id)}/lines`, {
      costCenterId: center.id,
      itemId: expense.id,
      amountCents: 100_000_000,
    })
    return { id: created.id, adminA, named, center, expense, period }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>

  /** Kurucu temsilcisi (adlandırılmış), ikinci yönetici ve ön büro ile kademeli kurum. */
  async function tiered() {
    const t = await institution()
    const adminB = await t.named('yonetici')
    const founder = await t.named('yonetici')
    const front = await t.named('onburo')
    const settings = ok(
      await call('PATCH', SETTINGS, t.adminA.cookie, { tiers: tiersOf(founder.id) }, ifMatch(1)),
    )
    return { ...t, adminB, founder, front, settings }
  }
  const tiersOf = (founderId: string) => [
    { minTotalCents: 0, approverRole: 'yonetici' },
    { minTotalCents: 500_000, approverRole: 'yonetici' },
    { minTotalCents: 2_000_000, approverUserId: founderId },
  ]

  /** Tek kalemli talep: `totalCents` tutarında (1 × birim fiyat). */
  const requestBody = (t: Tenant, totalCents: number) => ({
    costCenterId: t.center.id,
    periodId: t.period.id,
    budgetItemId: t.expense.id,
    justification: 'Bilgisayar laboratuvarı yenilemesi',
    items: [
      { name: 'Bilgisayar', quantity: 1, unit: 'piece', estimatedUnitPriceCents: totalCents },
    ],
  })
  const act = (cookie: string, request: Json, verb: string, payload?: Json) =>
    call(
      'POST',
      `${REQUESTS}/${String(request.id)}/${verb}`,
      cookie,
      payload,
      ifMatch(request.version),
    )
  async function submitted(t: Tenant, cookie: string, totalCents: number) {
    const draft = ok(await call('POST', REQUESTS, cookie, requestBody(t, totalCents)), 201)
    return ok(await act(cookie, draft, 'submit'))
  }
  const approval = (request: Json) =>
    request.approval as {
      mode: string
      currentPosition: number | null
      steps: {
        position: number
        minTotalCents: number
        approverRole: string | null
        approverUserId: string | null
        approverName: string | null
        decision: string | null
        decidedByName: string | null
        decidedAt: string | null
        note: string | null
      }[]
    }
  const actions = (request: Json) => request.actions as Record<string, boolean>
  const stepRows = (institutionId: string, requestId: string) =>
    db
      .select()
      .from(purchaseRequestApprovalSteps)
      .where(
        and(
          eq(purchaseRequestApprovalSteps.institutionId, institutionId),
          eq(purchaseRequestApprovalSteps.requestId, requestId),
        ),
      )
  const requestRow = async (institutionId: string, id: string) =>
    (
      await db
        .select()
        .from(purchaseRequests)
        .where(and(eq(purchaseRequests.institutionId, institutionId), eq(purchaseRequests.id, id)))
    )[0]
  const tierRows = (institutionId: string) =>
    db
      .select()
      .from(purchaseApprovalTiers)
      .where(eq(purchaseApprovalTiers.institutionId, institutionId))
  const awaiting = async (cookie: string) =>
    (
      (await get(`${REQUESTS}?awaitingMyApproval=true`, cookie)).json() as {
        data: { id: string }[]
      }
    ).data.map((row) => row.id)

  test('ON-223: kimliksiz ayar isteği 401; ön büro ve öğretmen 403; modül kapalıyken 403', async () => {
    assertError(await get(SETTINGS, null), 401)
    assertError(await call('PATCH', SETTINGS, null, { tiers: [] }, ifMatch(1)), 401)
    const t = await institution()
    for (const role of ['onburo', 'ogretmen', 'veli'] as const) {
      const member = await t.named(role)
      assertError(await get(SETTINGS, member.cookie), 403)
      assertError(await call('PATCH', SETTINGS, member.cookie, { tiers: [] }, ifMatch(1)), 403)
    }
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(SETTINGS, closed.adminA.cookie), 403, 'module_disabled')
    assertError(
      await call('PATCH', SETTINGS, closed.adminA.cookie, { tiers: [] }, ifMatch(1)),
      403,
      'module_disabled',
    )
  })

  test('ON-223, K-260: ayar varsayılanı boştur; kademeler bütün olarak yazılır, sürüm artar, denetime düşer', async () => {
    const t = await institution()
    const founder = await t.named('yonetici')
    const initial = ok(await get(SETTINGS, t.adminA.cookie))
    assert.deepEqual(initial.tiers, [])
    assert.equal(initial.version, 1)
    assert.deepEqual(
      (initial.approvers as { userId: string }[]).map((row) => row.userId).sort(),
      [t.adminA.id, founder.id].sort(),
    )
    assertError(
      await call('PATCH', SETTINGS, t.adminA.cookie, { tiers: [] }),
      400,
      'if_match_required',
    )

    const saved = ok(
      await call('PATCH', SETTINGS, t.adminA.cookie, { tiers: tiersOf(founder.id) }, ifMatch(1)),
    )
    assert.equal(saved.version, 2)
    const tiers = saved.tiers as Json[]
    assert.deepEqual(
      tiers.map((tier) => [
        tier.position,
        tier.minTotalCents,
        tier.approverRole,
        tier.approverUserId,
      ]),
      [
        [1, 0, 'yonetici', null],
        [2, 500_000, 'yonetici', null],
        [3, 2_000_000, null, founder.id],
      ],
    )
    assert.equal(tiers[2]?.approverEligible, true)
    assert.equal(typeof tiers[2]?.approverName, 'string')
    assertError(
      await call('PATCH', SETTINGS, t.adminA.cookie, { tiers: [] }, ifMatch(1)),
      409,
      'version_conflict',
    )
    const cleared = ok(await call('PATCH', SETTINGS, t.adminA.cookie, { tiers: [] }, ifMatch(2)))
    assert.deepEqual(cleared.tiers, [])
    assert.equal(cleared.version, 3)
    // Eski satırlar silinmez, arşivlenir.
    assert.equal((await tierRows(t.id)).length, 3)
    assert.ok((await tierRows(t.id)).every((row) => row.archivedAt !== null))
    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'purchase_approval.settings')),
      )
    assert.equal(audits.length, 2)
  })

  test('ON-223, K-260: geçersiz kademe 400, yönetici olmayan kişi 422; ayar değişmez', async () => {
    const t = await institution()
    const front = await t.named('onburo')
    const invalid: Json[] = [
      { tiers: [{ minTotalCents: 100, approverRole: 'yonetici' }] },
      {
        tiers: [
          { minTotalCents: 0, approverRole: 'yonetici' },
          { minTotalCents: 0, approverRole: 'yonetici' },
        ],
      },
      { tiers: [{ minTotalCents: 0 }] },
      { tiers: [{ minTotalCents: 0, approverRole: 'onburo' }] },
      { tiers: [{ minTotalCents: 0, approverRole: 'yonetici' }], institutionId: 'x' },
    ]
    for (const body of invalid)
      assertError(await call('PATCH', SETTINGS, t.adminA.cookie, body, ifMatch(1)), 400)
    assertError(
      await call(
        'PATCH',
        SETTINGS,
        t.adminA.cookie,
        { tiers: [{ minTotalCents: 0, approverUserId: front.id }] },
        ifMatch(1),
      ),
      422,
      'purchase_approval_approver_invalid',
    )
    assert.equal((await tierRows(t.id)).length, 0)
    assert.equal(ok(await get(SETTINGS, t.adminA.cookie)).version, 1)
  })

  test('ON-223, K-260: başka kurumun ayarı ve kişisi etkisiz; B değişmez', async () => {
    const a = await institution()
    const b = await institution()
    const bFounder = await b.named('yonetici')
    ok(await call('PATCH', SETTINGS, b.adminA.cookie, { tiers: tiersOf(bFounder.id) }, ifMatch(1)))
    // A, B'nin yöneticisini adlandıramaz (B kişisi A'da yok, aynı yanıt).
    assertError(
      await call(
        'PATCH',
        SETTINGS,
        a.adminA.cookie,
        { tiers: [{ minTotalCents: 0, approverUserId: bFounder.id }] },
        ifMatch(1),
      ),
      422,
      'purchase_approval_approver_invalid',
    )
    const aView = ok(await get(SETTINGS, a.adminA.cookie))
    assert.deepEqual(aView.tiers, [])
    assert.ok(!(aView.approvers as { userId: string }[]).some((row) => row.userId === bFounder.id))
    ok(await call('PATCH', SETTINGS, a.adminA.cookie, { tiers: [] }, ifMatch(1)))
    const bView = ok(await get(SETTINGS, b.adminA.cookie))
    assert.equal((bView.tiers as Json[]).length, 3)
    assert.equal(bView.version, 2)
  })

  test('ON-223, K-261, K-262: gönderimde kademeler dondurulur; sırayla onaylanır, son kademe talebi onaylar', async () => {
    const t = await tiered()
    const request = await submitted(t, t.front.cookie, 2_500_000)
    const chain = approval(request)
    assert.equal(chain.mode, 'tiered')
    assert.equal(chain.currentPosition, 1)
    assert.deepEqual(
      chain.steps.map((step) => [step.position, step.minTotalCents, step.approverUserId]),
      [
        [1, 0, null],
        [2, 500_000, null],
        [3, 2_000_000, t.founder.id],
      ],
    )
    assert.equal(typeof chain.steps[2]?.approverName, 'string')
    assert.equal(
      actions(ok(await get(`${REQUESTS}/${String(request.id)}`, t.adminA.cookie))).decide,
      true,
    )
    // Kurucu sonraki kademede adlandırıldığı için ilk kademeye karar veremez.
    assertError(
      await act(t.founder.cookie, request, 'approve', {}),
      403,
      'purchase_approval_reserved',
    )

    const first = ok(await act(t.adminA.cookie, request, 'approve', { note: 'Uygun' }))
    assert.equal(first.status, 'submitted')
    assert.equal(approval(first).currentPosition, 2)
    assert.equal(approval(first).steps[0]?.decision, 'approved')
    assert.equal(approval(first).steps[0]?.note, 'Uygun')
    assert.equal(approval(first).steps[0]?.decidedAt, FIXED_NOW.toISOString())
    assert.equal(actions(first).decide, false)
    assert.equal(first.decidedAt, null)

    // Aynı kişi ikinci kademeyi onaylayamaz; talep ve kademeler değişmez.
    const before = await stepRows(t.id, String(request.id))
    assertError(
      await act(t.adminA.cookie, first, 'approve', {}),
      403,
      'purchase_approval_same_approver',
    )
    assertError(
      await act(t.adminA.cookie, first, 'reject', { reason: 'Vazgeçildi' }),
      403,
      'purchase_approval_same_approver',
    )
    assert.deepEqual(await stepRows(t.id, String(request.id)), before)
    assert.equal((await requestRow(t.id, String(request.id)))?.version, first.version)

    const second = ok(await act(t.adminB.cookie, first, 'approve', {}))
    assert.equal(second.status, 'submitted')
    assert.equal(approval(second).currentPosition, 3)
    // Sıradaki kademe adlandırılmıştır; başka yönetici karar veremez.
    const other = await t.named('yonetici')
    assertError(
      await act(other.cookie, second, 'approve', {}),
      403,
      'purchase_approval_not_your_turn',
    )

    const last = ok(await act(t.founder.cookie, second, 'approve', {}))
    assert.equal(last.status, 'approved')
    assert.equal(approval(last).currentPosition, null)
    assert.ok(approval(last).steps.every((step) => step.decision === 'approved'))
    const row = await requestRow(t.id, String(request.id))
    assert.equal(row?.decidedByUserId, t.founder.id)
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.id), eq(auditLog.action, 'purchase_request.approve')))
    assert.equal(audits.length, 3)
    assert.ok(audits.every((entry) => JSON.stringify(entry.changes).includes('approvalStep')))
  })

  test('ON-223, K-262: talep eden kademeli onayda karar veremez; tutar yalnız gereken kademeleri ister', async () => {
    const t = await tiered()
    // 3.000 TL tek kademe; yöneticinin kendi talebi.
    const own = await submitted(t, t.adminA.cookie, 300_000)
    assert.equal(approval(own).steps.length, 1)
    assert.equal(actions(own).decide, false)
    assertError(await act(t.adminA.cookie, own, 'approve', {}), 403, 'purchase_approval_requester')
    assertError(
      await act(t.adminA.cookie, own, 'reject', { reason: 'Kendi talebim' }),
      403,
      'purchase_approval_requester',
    )
    assert.equal((await requestRow(t.id, String(own.id)))?.status, 'submitted')
    // Sınıra eşit tutar o kademeye girer (5.000 TL → iki kademe).
    const atLimit = await submitted(t, t.front.cookie, 500_000)
    assert.equal(approval(atLimit).steps.length, 2)
    const approved = ok(await act(t.adminB.cookie, own, 'approve', {}))
    assert.equal(approved.status, 'approved')
  })

  test('ON-223, K-262: herhangi bir kademedeki ret talebi reddeder; sonraki kademe karar almaz', async () => {
    const t = await tiered()
    const request = await submitted(t, t.front.cookie, 2_500_000)
    const first = ok(await act(t.adminA.cookie, request, 'approve', {}))
    assertError(await act(t.adminB.cookie, first, 'reject', { reason: 'x' }), 400)
    const rejected = ok(
      await act(t.adminB.cookie, first, 'reject', { reason: 'Bütçe önceliği değil' }),
    )
    assert.equal(rejected.status, 'rejected')
    assert.equal(rejected.decisionNote, 'Bütçe önceliği değil')
    assert.deepEqual(
      approval(rejected).steps.map((step) => step.decision),
      ['approved', 'rejected', null],
    )
    assert.equal(approval(rejected).currentPosition, null)
    assertError(
      await act(t.founder.cookie, rejected, 'approve', {}),
      422,
      'purchase_request_not_submitted',
    )
  })

  test('ON-223, K-261: eşik sonradan değişse de açık talep etkilenmez; ayarsız gönderim tek adımlıdır', async () => {
    const t = await tiered()
    const open = await submitted(t, t.front.cookie, 2_500_000)
    ok(await call('PATCH', SETTINGS, t.adminA.cookie, { tiers: [] }, ifMatch(t.settings.version)))
    const still = ok(await get(`${REQUESTS}/${String(open.id)}`, t.adminA.cookie))
    assert.equal(approval(still).mode, 'tiered')
    assert.equal(approval(still).steps.length, 3)
    // Ayar boşken gönderilen talep tek adımlıdır; yönetici kendi talebini de onaylar (K-129).
    const single = await submitted(t, t.adminA.cookie, 2_500_000)
    assert.equal(approval(single).mode, 'single')
    assert.deepEqual(approval(single).steps, [])
    assert.equal(ok(await act(t.adminA.cookie, single, 'approve', {})).status, 'approved')
    assert.equal((await stepRows(t.id, String(single.id))).length, 0)
  })

  test('ON-223, K-261: taslağa geri çekme kademeleri düşürür; tutar düzeltilip yeniden gönderilince yeniden hesaplanır', async () => {
    const t = await tiered()
    const request = await submitted(t, t.front.cookie, 2_500_000)
    const first = ok(await act(t.adminA.cookie, request, 'approve', {}))
    assert.equal(actions(first).withdraw, true)
    const other = await t.named('onburo')
    assertError(await act(other.cookie, first, 'withdraw'), 403, 'purchase_request_not_owner')
    assertError(await act(t.front.cookie, first, 'withdraw', { reason: 'x' }), 400)
    assert.equal((await requestRow(t.id, String(request.id)))?.status, 'submitted')

    const draft = ok(await act(t.front.cookie, first, 'withdraw'))
    assert.equal(draft.status, 'draft')
    assert.equal(draft.submittedAt, null)
    assert.equal(approval(draft).mode, 'single')
    const archived = await stepRows(t.id, String(request.id))
    assert.equal(archived.length, 3)
    assert.ok(archived.every((row) => row.archivedAt !== null))
    assertError(await act(t.front.cookie, draft, 'withdraw'), 422, 'purchase_request_not_submitted')

    const edited = ok(
      await call(
        'PATCH',
        `${REQUESTS}/${String(request.id)}`,
        t.front.cookie,
        { items: requestBody(t, 300_000).items },
        ifMatch(draft.version),
      ),
    )
    const again = ok(await act(t.front.cookie, edited, 'submit'))
    assert.equal(approval(again).steps.length, 1)
    assert.equal(approval(again).steps[0]?.decision, null)
    // Önceki turda onay veren yönetici yeni turda yeniden karar verebilir.
    assert.equal(ok(await act(t.adminA.cookie, again, 'approve', {})).status, 'approved')
  })

  test('ON-223, K-263: "Onayımı bekleyenler" sıranın kişide olduğu talepleri verir', async () => {
    const t = await tiered()
    const big = await submitted(t, t.front.cookie, 2_500_000)
    const own = await submitted(t, t.adminA.cookie, 300_000)
    const draft = ok(await call('POST', REQUESTS, t.front.cookie, requestBody(t, 300_000)), 201)
    assert.deepEqual((await awaiting(t.adminA.cookie)).sort(), [big.id].sort())
    assert.deepEqual((await awaiting(t.adminB.cookie)).sort(), [big.id, own.id].sort())
    assert.deepEqual(await awaiting(t.founder.cookie), [own.id])
    assert.deepEqual(await awaiting(t.front.cookie), [])
    assert.ok(!(await awaiting(t.adminB.cookie)).includes(String(draft.id)))

    ok(await act(t.adminA.cookie, big, 'approve', {}))
    assert.deepEqual(await awaiting(t.adminA.cookie), [])
    assert.ok((await awaiting(t.adminB.cookie)).includes(String(big.id)))
    // Ayarsız dönemde gönderilen tek adımlı talep her yöneticide, kendi talebi dahil (K-129).
    ok(await call('PATCH', SETTINGS, t.adminA.cookie, { tiers: [] }, ifMatch(t.settings.version)))
    const single = await submitted(t, t.adminA.cookie, 100_000)
    assert.ok((await awaiting(t.adminA.cookie)).includes(String(single.id)))
    assert.ok((await awaiting(t.founder.cookie)).includes(String(single.id)))
    assertError(await get(`${REQUESTS}?awaitingMyApproval=evet`, t.adminA.cookie), 400)
    const all = (await get(`${REQUESTS}?awaitingMyApproval=false`, t.adminA.cookie)).json() as {
      meta: { total: number }
    }
    assert.equal(all.meta.total, 4)
  })

  test('ON-223: başka kurumun talebi geri çekilemez (404) ve B değişmez; bekleyenler listesinde B yok', async () => {
    const a = await tiered()
    const b = await tiered()
    const bRequest = await submitted(b, b.front.cookie, 2_500_000)
    const bUrl = `${REQUESTS}/${String(bRequest.id)}`
    const beforeRow = await requestRow(b.id, String(bRequest.id))
    const beforeSteps = await stepRows(b.id, String(bRequest.id))
    assertError(await get(bUrl, a.adminA.cookie), 404)
    for (const verb of ['withdraw', 'approve', 'reject'] as const)
      assertError(
        await act(
          a.adminA.cookie,
          bRequest,
          verb,
          verb === 'reject' ? { reason: 'Uygun değil' } : {},
        ),
        404,
      )
    assert.deepEqual(await requestRow(b.id, String(bRequest.id)), beforeRow)
    assert.deepEqual(await stepRows(b.id, String(bRequest.id)), beforeSteps)
    assert.ok(!(await awaiting(a.adminA.cookie)).includes(String(bRequest.id)))
    assert.ok((await awaiting(b.adminA.cookie)).includes(String(bRequest.id)))
  })
})
