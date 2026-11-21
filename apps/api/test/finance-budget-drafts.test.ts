import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { budgetLines } from '../src/db/schema/finance-budget.ts'
import {
  budgetCenterOwners,
  budgetDraftEvents,
  budgetDraftLines,
  budgetDrafts,
} from '../src/db/schema/finance-budget-drafts.ts'
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
 * Bütçe hazırlama ve onay uçları (DOM-FIN-093; ON-243). Her test kendi kurumunu kurar: kampüs ve
 * birim merkezi, gelir ve iki gider kalemi, kapanmış geçen yıl dönemi ve açık bu yıl dönemi.
 * FIXED_NOW 2026-10-06.
 */

const SEED = createSeed(FIXED_NOW)
const CAMPUS = SEED.branches[0]?.id ?? ''
const FINANCE = '/api/v1/finance'
const DRAFTS = `${FINANCE}/budget-drafts`
const OPTIONS = `${FINANCE}/budget-draft-options`
const PERIODS = `${FINANCE}/budget-periods`

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-093: bütçe hazırlama ve onay uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.93.0.1'

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
    clientIp = `10.93.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(
      db,
      created.id,
      SEED.branches.map((data) => ({ collection: 'branches' as const, id: data.id, data })),
      FIXED_NOW,
    )
    return {
      id: created.id,
      admin: await signInAs(app, created.admin),
      adminMembershipId: created.adminMembershipId,
    }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  /** Giriş yapmış personel ve üyelik kimliği. */
  async function staff(t: Tenant, role: Role) {
    const created = await createMember(app, t.id, role)
    return { cookie: await signInAs(app, created), membershipId: created.membershipId }
  }

  /** Merkezler, kalemler, geçen yılın kapalı dönemi (planlı) ve bu yılın açık dönemi. */
  async function ready() {
    const t = await institution()
    const create = async (url: string, body: Json) =>
      ok(await call('POST', `${FINANCE}/${url}`, t.admin, body), 201)
    const campus = await create('cost-centers', {
      code: 'KAD',
      name: 'Kadıköy',
      type: 'campus',
      campusId: CAMPUS,
    })
    const unit = await create('cost-centers', { code: 'BT', name: 'Bilgi işlem', type: 'unit' })
    const income = await create('budget-items', {
      code: 'G-100',
      name: 'Öğrenim geliri',
      kind: 'income',
      feeKind: 'tuition',
    })
    const personnel = await create('budget-items', {
      code: 'P-100',
      name: 'Personel',
      kind: 'expense',
    })
    const supplies = await create('budget-items', {
      code: 'K-100',
      name: 'Kırtasiye',
      kind: 'expense',
    })
    const last = await create('budget-periods', {
      name: '2025–2026',
      startDate: '2025-09-01',
      endDate: '2026-08-31',
    })
    await create(`budget-periods/${String(last.id)}/lines`, {
      costCenterId: unit.id,
      itemId: personnel.id,
      amountCents: 900_000,
    })
    const opened = ok(
      await call('POST', `${PERIODS}/${String(last.id)}/open`, t.admin, undefined, ifMatch(1)),
    )
    ok(
      await call(
        'POST',
        `${PERIODS}/${String(last.id)}/close`,
        t.admin,
        undefined,
        ifMatch(opened.version),
      ),
    )
    const period = await create('budget-periods', {
      name: '2026–2027',
      startDate: '2026-09-01',
      endDate: '2027-08-31',
    })
    return { ...t, campus, unit, income, personnel, supplies, last, period }
  }
  type Ready = Awaited<ReturnType<typeof ready>>
  const open = (t: Ready, cookie = t.admin, costCenterId = t.unit.id, headers = {}) =>
    call('POST', DRAFTS, cookie, { periodId: t.period.id, costCenterId }, headers)
  const step = (cookie: string, draft: Json, verb: string, body: Json = {}) =>
    call('POST', `${DRAFTS}/${String(draft.id)}/${verb}`, cookie, body, ifMatch(draft.version))
  const write = (cookie: string, draft: Json, lines: Json[]) =>
    call('PATCH', `${DRAFTS}/${String(draft.id)}`, cookie, { lines }, ifMatch(draft.version))
  const assign = (t: Tenant, costCenterId: unknown, membershipId: string | null) =>
    call('POST', `${FINANCE}/cost-centers/${String(costCenterId)}/budget-owner`, t.admin, {
      membershipId,
    })
  const draftsOf = (institutionId: string) =>
    db.select().from(budgetDrafts).where(eq(budgetDrafts.institutionId, institutionId))
  const linesOf = (institutionId: string) =>
    db
      .select()
      .from(budgetLines)
      .where(and(eq(budgetLines.institutionId, institutionId)))
  const activeLines = async (institutionId: string, periodId: unknown) =>
    (await linesOf(institutionId))
      .filter((row) => row.periodId === periodId && row.archivedAt === null)
      .map((row) => ({
        itemId: row.itemId,
        amountCents: row.amountCents,
        monthly: row.monthlyCents,
      }))
  const snapshot = async (institutionId: string) =>
    Promise.all([
      draftsOf(institutionId),
      db.select().from(budgetDraftLines).where(eq(budgetDraftLines.institutionId, institutionId)),
      db.select().from(budgetDraftEvents).where(eq(budgetDraftEvents.institutionId, institutionId)),
      db
        .select()
        .from(budgetCenterOwners)
        .where(eq(budgetCenterOwners.institutionId, institutionId)),
      linesOf(institutionId),
    ])

  test('kimliksiz istek 401', async () => {
    const url = `${DRAFTS}/${randomUUID()}`
    assertError(await get(DRAFTS, null), 401)
    assertError(await get(OPTIONS, null), 401)
    assertError(await get(url, null), 401)
    assertError(await get(`${url}/comparison`, null), 401)
    assertError(await call('POST', DRAFTS, null, {}), 401)
    assertError(await call('PATCH', url, null, { lines: [] }, ifMatch(1)), 401)
    for (const verb of ['submit', 'approve', 'request-revision', 'reject', 'reopen'])
      assertError(await call('POST', `${url}/${verb}`, null, {}, ifMatch(1)), 401)
    assertError(
      await call('POST', `${FINANCE}/cost-centers/${randomUUID()}/budget-owner`, null, {
        membershipId: null,
      }),
      401,
    )
  })

  test('DOM-FIN-093: veli ve öğrenci 403; sorumlu onaylayamaz, sorumlu atayamaz; kayıt değişmez (K-256)', async () => {
    const t = await ready()
    const owner = await staff(t, 'ogretmen')
    ok(await assign(t, t.unit.id, owner.membershipId))
    const draft = ok(await open(t, owner.cookie), 201)
    const lines = [{ itemId: t.personnel.id, amountCents: 900_000, justification: 'Kadro' }]
    const saved = ok(await write(owner.cookie, draft, lines))
    const submitted = ok(await step(owner.cookie, saved, 'submit'))
    const before = await snapshot(t.id)
    for (const role of ['veli', 'ogrenci'] as const) {
      const cookie = (await staff(t, role)).cookie
      assertError(await get(DRAFTS, cookie), 403)
      assertError(await get(OPTIONS, cookie), 403)
      assertError(await get(`${DRAFTS}/${String(draft.id)}`, cookie), 403)
      assertError(await open(t, cookie), 403)
    }
    for (const verb of ['approve', 'request-revision', 'reject'])
      assertError(await step(owner.cookie, submitted, verb, { reason: 'Uygun değil.' }), 403)
    assertError(await assign({ ...t, admin: owner.cookie }, t.unit.id, null), 403)
    assert.deepEqual(await snapshot(t.id), before)
  })

  test('DOM-FIN-093: finance modülü kapalıyken taslak uçları 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await get(DRAFTS, closed.admin), 403, 'module_disabled')
    assertError(await get(OPTIONS, closed.admin), 403, 'module_disabled')
    assertError(
      await call('POST', DRAFTS, closed.admin, {
        periodId: randomUUID(),
        costCenterId: randomUUID(),
      }),
      403,
      'module_disabled',
    )
    assert.equal((await draftsOf(closed.id)).length, 0)
  })

  test('DOM-FIN-093: sorumlu taslak hazırlar, gönderir; yönetici revizyon ister, sonra onaylar; bütçe satırları yazılır ve geçmiş sürümleri tutar (K-256, K-257, K-258)', async () => {
    const t = await ready()
    // Onaylı bütçede kırtasiye satırı var; taslak bu satırla dolar.
    ok(
      await call('POST', `${PERIODS}/${String(t.period.id)}/lines`, t.admin, {
        costCenterId: t.unit.id,
        itemId: t.supplies.id,
        amountCents: 50_000,
        monthlyCents: Array.from({ length: 12 }, (_, index) => (index < 2 ? 25_000 : 0)),
      }),
      201,
    )
    const owner = await staff(t, 'onburo')
    const owned = ok(await assign(t, t.unit.id, owner.membershipId))
    assert.equal((owned.owner as Json).membershipId, owner.membershipId)

    // Sorumlu yalnız kendi merkezini görür.
    const options = ok(await get(OPTIONS, owner.cookie))
    assert.deepEqual(
      (options.centers as Json[]).map((center) => [center.code, center.canPrepare]),
      [['BT', true]],
    )
    assert.deepEqual(
      (options.periods as Json[]).map((period) => period.name),
      ['2026–2027'],
    )
    assert.equal((options.items as Json[]).length, 3)
    assertError(await open(t, owner.cookie, t.campus.id), 403, 'budget_draft_not_owner')

    const response = await open(t, owner.cookie)
    const created = ok(response, 201)
    assert.equal(response.headers.location, `${DRAFTS}/${String(created.id)}`)
    assert.equal(created.status, 'draft')
    assert.equal(created.revision, 0)
    assert.deepEqual(
      (created.lines as Json[]).map((line) => [line.itemCode, line.amountCents]),
      [['K-100', 50_000]],
    )
    assert.equal((created.owner as Json).membershipId, owner.membershipId)
    assert.deepEqual(created.actions, {
      edit: true,
      submit: true,
      approve: false,
      requestRevision: false,
      reject: false,
      reopen: false,
    })
    assertError(await open(t, owner.cookie), 409, 'budget_draft_exists')

    // Gerekçesiz yeni kalem gönderilemez; taslak değişmez.
    const unjustified = ok(
      await write(owner.cookie, created, [
        { itemId: t.supplies.id, amountCents: 50_000 },
        { itemId: t.personnel.id, amountCents: 1_200_000 },
      ]),
    )
    const beforeSubmit = await snapshot(t.id)
    const missing = await step(owner.cookie, unjustified, 'submit')
    assertError(missing, 422, 'budget_draft_justification_required')
    assert.deepEqual(missing.json().issues?.[0]?.path, ['lines', '1', 'justification'])
    assert.deepEqual(await snapshot(t.id), beforeSubmit)

    const justified = ok(
      await write(owner.cookie, unjustified, [
        { itemId: t.supplies.id, amountCents: 50_000 },
        { itemId: t.personnel.id, amountCents: 1_200_000, justification: 'İki yeni teknisyen' },
      ]),
    )
    const first = ok(await step(owner.cookie, justified, 'submit', { note: 'İlk sürüm' }))
    assert.equal(first.status, 'submitted')
    assert.equal(first.revision, 1)
    assert.equal((first.actions as Json).edit, false)
    assertError(await write(owner.cookie, first, []), 422, 'budget_draft_status_invalid')

    // Yönetici gerekçeyle revizyon ister; gerekçesiz istek 400.
    assertError(await step(t.admin, first, 'request-revision', {}), 400)
    const revision = ok(
      await step(t.admin, first, 'request-revision', { reason: 'Personel tutarını düşürün.' }),
    )
    assert.equal(revision.status, 'revision_requested')
    assert.equal(revision.decisionNote, 'Personel tutarını düşürün.')

    const fixed = ok(
      await write(owner.cookie, revision, [
        { itemId: t.personnel.id, amountCents: 1_000_000, justification: 'Bir teknisyen' },
      ]),
    )
    const second = ok(await step(owner.cookie, fixed, 'submit'))
    assert.equal(second.revision, 2)
    assert.equal(second.decisionNote, null)

    // Listede yönetici ve sorumlu görür; durum süzgeci.
    const listed = ok(
      await get(`${DRAFTS}?status=submitted&periodId=${String(t.period.id)}`, t.admin),
    )
    assert.deepEqual(
      (listed as unknown as Json[]).map((row) => [row.id, row.expenseCents, row.lineCount]),
      [[created.id, 1_000_000, 1]],
    )

    const approved = ok(await step(t.admin, second, 'approve', { note: 'Uygun' }))
    assert.equal(approved.status, 'approved')
    assert.equal(approved.approvedRevision, 2)
    assert.equal(approved.decisionNote, 'Uygun')
    // Onaylı bütçe taslağa eşitlendi: personel eklendi, kırtasiye kaldırıldı.
    assert.deepEqual(await activeLines(t.id, t.period.id), [
      { itemId: t.personnel.id, amountCents: 1_000_000, monthly: null },
    ])

    const events = approved.events as Json[]
    assert.deepEqual(
      events.map((event) => [event.event, event.revision, event.fromStatus, event.toStatus]),
      [
        ['created', 0, null, 'draft'],
        ['submitted', 1, 'draft', 'submitted'],
        ['revision_requested', 1, 'submitted', 'revision_requested'],
        ['submitted', 2, 'revision_requested', 'submitted'],
        ['approved', 2, 'submitted', 'approved'],
      ],
    )
    // İlk sürüm onaylı bütçeye, ikinci sürüm birinci sürüme göre değişen kalemleri taşır.
    assert.deepEqual(
      (events[1]?.changes as Json[]).map((change) => [
        change.itemCode,
        change.beforeCents,
        change.afterCents,
      ]),
      [['P-100', null, 1_200_000]],
    )
    assert.equal(events[1]?.note, 'İlk sürüm')
    assert.deepEqual(
      (events[3]?.changes as Json[]).map((change) => [
        change.itemCode,
        change.beforeCents,
        change.afterCents,
      ]),
      [
        ['P-100', 1_200_000, 1_000_000],
        ['K-100', 50_000, null],
      ],
    )
    assert.equal(typeof events[3]?.actorName, 'string')

    // Onaylı bütçenin değişmesi yeni revizyonla olur; onaylı satırlar yeni onaya kadar kalır.
    const reopened = ok(await step(owner.cookie, approved, 'reopen'))
    assert.equal(reopened.status, 'draft')
    assert.equal(reopened.approvedRevision, 2)
    assert.equal((await activeLines(t.id, t.period.id)).length, 1)
    const third = ok(
      await step(
        owner.cookie,
        ok(
          await write(owner.cookie, reopened, [
            { itemId: t.personnel.id, amountCents: 1_000_000 },
            { itemId: t.supplies.id, amountCents: 0 },
          ]),
        ),
        'submit',
      ),
    )
    assert.equal(third.revision, 3)
    ok(await step(t.admin, third, 'approve'))
    assert.deepEqual(
      (await activeLines(t.id, t.period.id)).sort((a, b) => a.amountCents - b.amountCents),
      [
        { itemId: t.supplies.id, amountCents: 0, monthly: null },
        { itemId: t.personnel.id, amountCents: 1_000_000, monthly: null },
      ],
    )

    const audits = await db
      .select({ action: auditLog.action, changes: auditLog.changes })
      .from(auditLog)
      .where(eq(auditLog.institutionId, t.id))
    const actions = audits.map((row) => row.action)
    for (const action of [
      'budget_owner.set',
      'budget_draft.create',
      'budget_draft.update',
      'budget_draft.submit',
      'budget_draft.request_revision',
      'budget_draft.approve',
      'budget_draft.reopen',
      'budget_line.create',
      'budget_line.remove',
    ])
      assert.ok(actions.includes(action), action)
    // Denetimde alan adları var; tutar ve gerekçe yok.
    assert.equal(JSON.stringify(audits).includes('teknisyen'), false)
    assert.equal(JSON.stringify(audits).includes('1000000'), false)
  })

  test('DOM-FIN-093: ret taslağı kapatır, yeni taslak açılır; kapalı dönemde taslak açılmaz ve onaylanmaz', async () => {
    const t = await ready()
    const draft = ok(await open(t), 201)
    const saved = ok(
      await write(t.admin, draft, [
        { itemId: t.personnel.id, amountCents: 10, justification: 'Deneme' },
      ]),
    )
    const submitted = ok(await step(t.admin, saved, 'submit'))
    assertError(await step(t.admin, submitted, 'reject', { reason: 'kısa' }), 400)
    const rejected = ok(await step(t.admin, submitted, 'reject', { reason: 'Bütçe dışı talep.' }))
    assert.equal(rejected.status, 'rejected')
    assertError(await step(t.admin, rejected, 'reopen'), 422, 'budget_draft_status_invalid')
    assertError(await step(t.admin, rejected, 'submit'), 422, 'budget_draft_status_invalid')
    const again = ok(await open(t), 201)
    assert.notEqual(again.id, draft.id)
    assert.equal((await activeLines(t.id, t.period.id)).length, 0)

    // Satırsız taslak gönderilemez.
    assertError(await step(t.admin, again, 'submit'), 422, 'budget_draft_empty')

    // Dönem kapanınca taslak gönderilmez ve yenisi açılmaz.
    const filled = ok(await write(t.admin, again, [{ itemId: t.personnel.id, amountCents: 0 }]))
    const pending = ok(await step(t.admin, filled, 'submit'))
    const opened = ok(
      await call('POST', `${PERIODS}/${String(t.period.id)}/open`, t.admin, undefined, ifMatch(1)),
    )
    ok(
      await call(
        'POST',
        `${PERIODS}/${String(t.period.id)}/close`,
        t.admin,
        undefined,
        ifMatch(opened.version),
      ),
    )
    const before = await snapshot(t.id)
    assertError(await step(t.admin, pending, 'approve'), 422, 'budget_period_closed')
    assertError(await open(t, t.admin, t.campus.id), 422, 'budget_period_closed')
    assert.deepEqual(await snapshot(t.id), before)
  })

  test('DOM-FIN-093: sorumlu yoksa yalnız yönetici hazırlar; başkasının merkezi sorumluya 404; sorumlu personel olmalı (K-257)', async () => {
    const t = await ready()
    const desk = await staff(t, 'onburo')
    const teacher = await staff(t, 'ogretmen')
    // Sorumluluğu olmayan personel boş seçenek ve boş liste görür.
    const empty = ok(await get(OPTIONS, desk.cookie))
    assert.deepEqual(empty.centers, [])
    assertError(await open(t, desk.cookie), 403, 'budget_draft_not_owner')

    const draft = ok(await open(t), 201)
    const url = `${DRAFTS}/${String(draft.id)}`
    assertError(await get(url, desk.cookie), 404)
    assertError(await get(`${url}/comparison`, desk.cookie), 404)
    assertError(await write(desk.cookie, draft, []), 404)
    const list = await get(DRAFTS, desk.cookie)
    assert.equal(list.json().meta.total, 0)

    // Sorumlu atanınca görür; başka merkezin sorumlusu görmez; sorumlu kaldırılınca 404.
    ok(await assign(t, t.unit.id, desk.membershipId))
    ok(await assign(t, t.campus.id, teacher.membershipId))
    assert.equal(ok(await get(url, desk.cookie)).id, draft.id)
    assertError(await get(url, teacher.cookie), 404)
    const cleared = ok(await assign(t, t.unit.id, null))
    assert.equal(cleared.owner, null)
    assertError(await get(url, desk.cookie), 404)

    const parent = await createMember(app, t.id, 'veli')
    assertError(await assign(t, t.unit.id, parent.membershipId), 422, 'budget_owner_not_staff')
    assertError(await assign(t, t.unit.id, 'olmayan-uyelik'), 422, 'budget_owner_not_found')
    assertError(await assign(t, randomUUID(), null), 404)
    const owners = await db
      .select()
      .from(budgetCenterOwners)
      .where(eq(budgetCenterOwners.institutionId, t.id))
    assert.deepEqual(
      owners.map((row) => [row.costCenterId, row.membershipId]).sort(),
      [
        [t.campus.id, teacher.membershipId],
        [t.unit.id, null],
      ].sort(),
    )
  })

  test('DOM-FIN-093: karşılaştırma önceki dönemin planını ve gerçekleşenini, onaylı bütçeyi taslakla yan yana verir (K-259)', async () => {
    const t = await ready()
    const draft = ok(await open(t), 201)
    const saved = ok(
      await write(t.admin, draft, [
        { itemId: t.personnel.id, amountCents: 1_000_000, justification: 'Zam' },
      ]),
    )
    const comparison = ok(await get(`${DRAFTS}/${String(saved.id)}/comparison`, t.admin))
    assert.deepEqual(comparison.previousPeriod, {
      id: t.last.id,
      name: '2025–2026',
      startDate: '2025-09-01',
      endDate: '2026-08-31',
    })
    assert.equal(comparison.basis, 'accrual')
    assert.deepEqual(comparison.rows, [
      {
        itemId: t.personnel.id,
        itemCode: 'P-100',
        itemName: 'Personel',
        itemKind: 'expense',
        draftCents: 1_000_000,
        justification: 'Zam',
        approvedCents: null,
        previousPlanCents: 900_000,
        previousActualCents: 0,
        changeFromPreviousCents: 1_000_000,
      },
    ])
    assert.deepEqual((comparison.totals as Json).expense, {
      draftCents: 1_000_000,
      approvedCents: 0,
      previousPlanCents: 900_000,
      previousActualCents: 0,
    })
  })

  test('DOM-FIN-093: satır kuralları 400/422 ve kayıt değişmez; sürüm tutmazsa 409', async () => {
    const t = await ready()
    const draft = ok(await open(t), 201)
    const before = await snapshot(t.id)
    assertError(
      await write(t.admin, draft, [
        { itemId: t.personnel.id, amountCents: 1 },
        { itemId: t.personnel.id, amountCents: 2 },
      ]),
      400,
    )
    assertError(await write(t.admin, draft, [{ itemId: t.personnel.id, amountCents: -1 }]), 400)
    assertError(
      await write(t.admin, draft, [{ itemId: randomUUID(), amountCents: 1 }]),
      422,
      'budget_item_not_found',
    )
    ok(
      await call(
        'PATCH',
        `${FINANCE}/budget-items/${String(t.supplies.id)}`,
        t.admin,
        { isActive: false },
        ifMatch(t.supplies.version),
      ),
    )
    const afterItem = await snapshot(t.id)
    assertError(
      await write(t.admin, draft, [{ itemId: t.supplies.id, amountCents: 1 }]),
      422,
      'budget_item_inactive',
    )
    assertError(
      await call('PATCH', `${DRAFTS}/${String(draft.id)}`, t.admin, { lines: [] }, ifMatch(9)),
      409,
    )
    assertError(
      await call(
        'PATCH',
        `${DRAFTS}/${String(draft.id)}`,
        t.admin,
        { lines: [], institutionId: 'x' },
        ifMatch(draft.version),
      ),
      400,
    )
    assert.deepEqual((await snapshot(t.id)).slice(0, 4), before.slice(0, 4))
    assert.deepEqual(await snapshot(t.id), afterItem)
  })

  test('DOM-FIN-093: aynı Idempotency-Key ilk yanıtı tekrarlar, ikinci taslak açılmaz', async () => {
    const t = await ready()
    const headers = { 'idempotency-key': randomUUID() }
    const first = await open(t, t.admin, t.unit.id, headers)
    const second = await open(t, t.admin, t.unit.id, headers)
    assert.equal(first.statusCode, 201)
    assert.equal(second.statusCode, 201)
    assert.equal(second.headers['idempotent-replayed'], 'true')
    assert.equal(second.json().data.id, first.json().data.id)
    assert.equal((await draftsOf(t.id)).length, 1)
  })

  test('IST-002: başka kurumun taslağı, merkezi ve dönemi 404, listede yok, gövdedeki institutionId etkisiz, B değişmez', async () => {
    const a = await ready()
    const b = await ready()
    const bDraft = ok(await open(b), 201)
    const bSaved = ok(
      await write(b.admin, bDraft, [
        { itemId: b.personnel.id, amountCents: 5, justification: 'B kurumu' },
      ]),
    )
    const bSubmitted = ok(await step(b.admin, bSaved, 'submit'))
    const bBefore = await snapshot(b.id)
    const bUrl = `${DRAFTS}/${String(bDraft.id)}`

    assertError(await get(bUrl, a.admin), 404)
    assertError(await get(`${bUrl}/comparison`, a.admin), 404)
    assertError(await write(a.admin, bSubmitted, []), 404)
    for (const [verb, body] of [
      ['submit', {}],
      ['approve', {}],
      ['request-revision', { reason: 'Sızma denemesi' }],
      ['reject', { reason: 'Sızma denemesi' }],
      ['reopen', {}],
    ] as const)
      assertError(await step(a.admin, bSubmitted, verb, body), 404)
    assertError(await assign(a, b.unit.id, a.adminMembershipId), 404)
    // B'nin merkezi ya da dönemiyle taslak açılmaz; gövdedeki institutionId 400.
    assertError(
      await call('POST', DRAFTS, a.admin, { periodId: a.period.id, costCenterId: b.unit.id }),
      422,
      'cost_center_not_found',
    )
    assertError(
      await call('POST', DRAFTS, a.admin, { periodId: b.period.id, costCenterId: a.unit.id }),
      422,
      'budget_period_not_found',
    )
    assertError(
      await call('POST', DRAFTS, a.admin, {
        periodId: a.period.id,
        costCenterId: a.unit.id,
        institutionId: b.id,
      }),
      400,
    )
    // B üyeliği A'nın merkezine sorumlu atanamaz.
    const bMember = await createMember(app, b.id, 'ogretmen')
    assertError(await assign(a, a.unit.id, bMember.membershipId), 422, 'budget_owner_not_found')
    const aList = await get(DRAFTS, a.admin)
    assert.equal(aList.json().meta.total, 0)
    const aOptions = ok(await get(OPTIONS, a.admin))
    assert.equal(
      (aOptions.centers as Json[]).some((center) => center.id === b.unit.id),
      false,
    )
    assert.deepEqual(await snapshot(b.id), bBefore)
  })
})
