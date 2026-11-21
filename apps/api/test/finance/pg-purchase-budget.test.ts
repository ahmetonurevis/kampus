import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { count, eq, sql } from 'drizzle-orm'

import type { App } from '../../src/app.ts'
import type { Database } from '../../src/db/client.ts'
import { lockInstitution } from '../../src/db/records.ts'
import { purchaseRequests } from '../../src/db/schema/finance-purchase-requests.ts'
import { AppError } from '../../src/errors.ts'
import type { ServiceContext } from '../../src/plugins/authenticate.ts'
import { transitionPurchaseRequestCommand } from '../../src/services/finance-purchase-requests.ts'
import type { CommandResponse } from '../../src/services/operation-runner.ts'
import {
  buildTestApp,
  createInstitution,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from '../support/app.ts'
import { createPgDatabase, PG_SKIP } from '../support/pg.ts'

/**
 * PostgreSQL 16: satın alma talebinin bütçe kalanı eşzamanlılıkta birlikte tüketilmez (DOM-FIN-071,
 * ON-245, K-145, K-146). İki gönderim kurum kilidinde bekletilir, kilit bırakılınca sırayla işlenir:
 * ikincisi birincinin taahhüdünü görür, kalanı aşarsa açık onay olmadan 409 alır ve yazılmaz.
 */

type Json = Record<string, unknown>

function gate() {
  let open = () => {}
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { open, opened }
}

describe('PostgreSQL 16: satın alma bütçe kalanı', { skip: PG_SKIP }, () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createPgDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function post(cookie: string, url: string, payload?: Json, version?: unknown) {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/finance${url}`,
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...(version === undefined ? {} : { 'if-match': `"${String(version)}"` }),
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
    assert.ok(response.statusCode < 300, response.body)
    return response.json().data as Json
  }

  /** Açık dönemde 10.000 TL planlı satır ve bu satıra yazılmış 6.000'er TL'lik iki taslak talep. */
  async function setup() {
    const created = await createInstitution(app)
    const admin = await signInAs(app, created.admin)
    const center = await post(admin, '/cost-centers', { code: 'BT', name: 'Bilgi', type: 'unit' })
    const item = await post(admin, '/budget-items', {
      code: 'G-1',
      name: 'Malzeme',
      kind: 'expense',
    })
    const period = await post(admin, '/budget-periods', { name: '2026–2027', academicYear: 2026 })
    await post(admin, `/budget-periods/${String(period.id)}/open`, undefined, period.version)
    await post(admin, `/budget-periods/${String(period.id)}/lines`, {
      costCenterId: center.id,
      itemId: item.id,
      amountCents: 1_000_000,
    })
    const drafts: Json[] = []
    for (const name of ['Sunucu', 'Depolama'])
      drafts.push(
        await post(admin, '/purchase-requests', {
          costCenterId: center.id,
          periodId: period.id,
          budgetItemId: item.id,
          justification: 'Sunucu odası yenilemesi için',
          items: [{ name, quantity: 1, unit: 'piece', estimatedUnitPriceCents: 600_000 }],
        }),
      )
    const ctx: ServiceContext = {
      db,
      institutionId: created.id,
      actor: {
        userId: created.admin.id,
        role: 'yonetici',
        membershipId: created.adminMembershipId,
      },
      now: FIXED_NOW,
      log: app.log,
    }
    return { ctx, drafts }
  }

  async function untilLockWait(minimum: number) {
    for (let attempt = 0; ; attempt += 1) {
      const [waiting] = await db
        .select({ n: count() })
        .from(sql`pg_locks`)
        .where(
          sql`locktype = 'advisory' and not granted and pid in (select pid from pg_stat_activity where datname = current_database())`,
        )
      if ((waiting?.n ?? 0) >= minimum) return
      assert.ok(attempt < 300, 'işlem kilidi beklemedi')
      await delay(10)
    }
  }

  /** Kurum kilidi tutulurken komutları başlatır; hepsi kilitte bekleyince bırakır. */
  async function race(
    ctx: ServiceContext,
    commands: readonly (() => Promise<CommandResponse>)[],
  ): Promise<PromiseSettledResult<CommandResponse>[]> {
    const held = gate()
    const release = gate()
    const holder = db.transaction(async (tx) => {
      await lockInstitution(tx, ctx.institutionId)
      held.open()
      await release.opened
    })
    await held.opened
    const outcomes = Promise.allSettled(commands.map((run) => run()))
    try {
      await untilLockWait(commands.length)
    } finally {
      release.open()
      await holder
    }
    return outcomes
  }

  test('DOM-FIN-071, ON-245: eşzamanlı iki gönderim kalanı birlikte tüketemez; ikincisi 409 budget_exceeded_warning alır ve yazılmaz (K-145)', async () => {
    const { ctx, drafts } = await setup()
    const settled = await race(
      ctx,
      drafts.map(
        (draft) => () =>
          transitionPurchaseRequestCommand(
            ctx,
            String(draft.id),
            'submit',
            {},
            Number(draft.version),
            null,
          ),
      ),
    )
    assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1)
    const reason: unknown = settled.find((item) => item.status === 'rejected')?.reason
    assert.ok(
      reason instanceof AppError &&
        reason.statusCode === 409 &&
        reason.code === 'budget_exceeded_warning',
      String(reason),
    )
    const rows = await db
      .select({ status: purchaseRequests.status, version: purchaseRequests.version })
      .from(purchaseRequests)
      .where(eq(purchaseRequests.institutionId, ctx.institutionId))
    assert.deepEqual(rows.map((row) => row.status).sort(), ['draft', 'submitted'])
    assert.deepEqual(rows.map((row) => row.version).sort(), [1, 2])
  })

  test('DOM-FIN-071, ON-245: açık onaylı eşzamanlı gönderimler ikisi de geçer (K-146)', async () => {
    const { ctx, drafts } = await setup()
    const settled = await race(
      ctx,
      drafts.map(
        (draft) => () =>
          transitionPurchaseRequestCommand(
            ctx,
            String(draft.id),
            'submit',
            { confirmOverBudget: true },
            Number(draft.version),
            null,
          ),
      ),
    )
    assert.deepEqual(
      settled.map((item) => item.status),
      ['fulfilled', 'fulfilled'],
    )
    const rows = await db
      .select({ status: purchaseRequests.status })
      .from(purchaseRequests)
      .where(eq(purchaseRequests.institutionId, ctx.institutionId))
    assert.deepEqual(
      rows.map((row) => row.status),
      ['submitted', 'submitted'],
    )
  })
})
