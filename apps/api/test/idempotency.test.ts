import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { createSeed } from '@kampus/school-core/data/seed.ts'
import { payInvoice } from '@kampus/school-core/lib/domain.ts'

import type { App } from '../src/app.ts'
import { ROLES } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { purgeExpiredIdempotencyKeys } from '../src/db/idempotency.ts'
import { findRecord, insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { idempotencyKeys } from '../src/db/schema/idempotency-keys.ts'
import { AppError } from '../src/errors.ts'
import { contextOf, type ServiceContext } from '../src/plugins/authenticate.ts'
import { idempotencyOf, sendCommand } from '../src/routes/command-support.ts'
import { commandBody } from '../src/services/command-result.ts'
import {
  commandErrors,
  commandHeadersSchema,
  commandResponseSchema,
} from '../src/routes/commands.schemas.ts'
import { requestFingerprint } from '../src/services/idempotency.ts'
import { runCommand, type OperationRequest } from '../src/services/operation-runner.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'

const seed = createSeed(FIXED_NOW)
const unpaid = seed.invoices.filter((invoice) => !invoice.paidAt)
const first = unpaid[0]
const second = unpaid[1]
assert.ok(first && second, 'örnek veride iki ödenmemiş taksit var')
const HOUR = 60 * 60 * 1000

function payRequest(invoiceId: string, method = 'Kredi kartı'): OperationRequest<unknown> {
  return {
    action: 'invoice.pay',
    entity: { type: 'invoices', id: invoiceId },
    collections: ['invoices'],
    run: (state, { now }) => payInvoice(state, invoiceId, method, now),
  }
}

const respond = (invoiceId: string) => (outcome: { changes: Parameters<typeof commandBody>[1] }) =>
  commandBody({ collection: 'invoices', id: invoiceId }, outcome.changes)

function rejectsWith(status: number, code: string) {
  return (error: unknown) => {
    assert.ok(error instanceof AppError, `AppError bekleniyordu: ${String(error)}`)
    assert.deepEqual([error.statusCode, error.code], [status, code])
    return true
  }
}

/** Teste özgü ödeme ucu: `Idempotency-Key` başlığının HTTP davranışı. */
function registerPaymentRoute(app: App) {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/api/v1/test-payments/:invoiceId',
    {
      preValidation: [app.requireRole(ROLES)],
      schema: {
        hide: true,
        params: z.object({ invoiceId: z.string() }),
        headers: commandHeadersSchema('required'),
        body: z.object({ method: z.string().min(2) }),
        response: { 200: commandResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      const idempotency = idempotencyOf(request, true)
      const { invoiceId } = request.params
      const response = await runCommand(
        contextOf(request),
        payRequest(invoiceId, request.body.method),
        respond(invoiceId),
        idempotency,
      )
      return sendCommand(reply, response)
    },
  )
}

describe('Idempotency-Key (api-tasarimi.md §7, DOM-FIN aynı ödeme iki kez işlenmez)', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { extend: registerPaymentRoute })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function institution(now = FIXED_NOW) {
    const created = await createInstitution(app)
    await insertMissingRecords(
      db,
      created.id,
      seed.invoices.map((data) => ({ collection: 'invoices' as const, id: data.id, data })),
      FIXED_NOW,
    )
    const ctx: ServiceContext = {
      db,
      institutionId: created.id,
      actor: {
        userId: created.admin.id,
        role: 'yonetici',
        membershipId: created.adminMembershipId,
      },
      now,
      log: app.log,
    }
    return { created, ctx }
  }

  function audits(institutionId: string) {
    return db.select().from(auditLog).where(eq(auditLog.institutionId, institutionId))
  }

  const key = (n: number) => `test-key-${String(n).padStart(4, '0')}`

  test('aynı anahtar + aynı istek ilk yanıtı tekrarlar; işlem bir kez yazılır', async () => {
    const { ctx } = await institution()
    const idem = { key: key(1), fingerprint: 'f1' }
    const firstResponse = await runCommand(ctx, payRequest(first.id), respond(first.id), idem)
    const replay = await runCommand(ctx, payRequest(first.id), respond(first.id), idem)
    assert.equal(firstResponse.replayed, false)
    assert.equal(replay.replayed, true)
    assert.deepEqual(replay.body, firstResponse.body)
    const row = await findRecord(db, ctx.institutionId, 'invoices', first.id)
    assert.equal(row?.version, 2)
    assert.equal((await audits(ctx.institutionId)).length, 1)
  })

  test('aynı anahtar + farklı istek 422 idempotency_key_reused; kayıt değişmez', async () => {
    const { ctx } = await institution()
    await runCommand(ctx, payRequest(first.id), respond(first.id), {
      key: key(2),
      fingerprint: 'a',
    })
    await assert.rejects(
      runCommand(ctx, payRequest(second.id), respond(second.id), { key: key(2), fingerprint: 'b' }),
      rejectsWith(422, 'idempotency_key_reused'),
    )
    const row = await findRecord(db, ctx.institutionId, 'invoices', second.id)
    assert.equal(row?.data.paidAt, null)
  })

  test('hata yanıtı saklanmaz; aynı anahtarla düzeltilmiş istek çalışır', async () => {
    const { ctx } = await institution()
    await assert.rejects(
      runCommand(ctx, payRequest('test-inv-yok'), respond('test-inv-yok'), {
        key: key(3),
        fingerprint: 'yanlis',
      }),
      rejectsWith(404, 'not_found'),
    )
    const fixed = await runCommand(ctx, payRequest(first.id), respond(first.id), {
      key: key(3),
      fingerprint: 'dogru',
    })
    assert.equal(fixed.replayed, false)
  })

  test('24 saat sonra anahtar yeniden kullanılabilir; ödenmiş taksit yine core kuralıyla 409', async () => {
    const { ctx } = await institution()
    const idem = { key: key(4), fingerprint: 'f' }
    await runCommand(ctx, payRequest(first.id), respond(first.id), idem)
    const later = { ...ctx, now: new Date(FIXED_NOW.getTime() + 24 * HOUR + 1) }
    await assert.rejects(
      runCommand(later, payRequest(first.id), respond(first.id), idem),
      rejectsWith(409, 'invoice_already_paid'),
    )
    const almost = { ...ctx, now: new Date(FIXED_NOW.getTime() + 23 * HOUR) }
    const replay = await runCommand(almost, payRequest(first.id), respond(first.id), idem)
    assert.equal(replay.replayed, true)
  })

  test('anahtar kullanıcı ve kurum kapsamındadır', async () => {
    const { ctx, created } = await institution()
    const other = await createMember(app, created.id, 'onburo')
    const idem = { key: key(5), fingerprint: 'f' }
    await runCommand(ctx, payRequest(first.id), respond(first.id), idem)
    const otherCtx: ServiceContext = {
      ...ctx,
      actor: { userId: other.id, role: 'onburo', membershipId: other.membershipId },
    }
    const response = await runCommand(otherCtx, payRequest(second.id), respond(second.id), idem)
    assert.equal(response.replayed, false)
    const rows = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.institutionId, created.id), eq(idempotencyKeys.key, key(5))))
    assert.equal(rows.length, 2)
  })

  test('süresi dolan anahtarlar temizlenir, süresi dolmayan kalır', async () => {
    const { ctx } = await institution()
    await runCommand(ctx, payRequest(first.id), respond(first.id), {
      key: key(6),
      fingerprint: 'f',
    })
    const purgedEarly = await purgeExpiredIdempotencyKeys(db, new Date(FIXED_NOW.getTime() + HOUR))
    const remaining = await db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.institutionId, ctx.institutionId))
    assert.equal(remaining.length, 1)
    assert.ok(purgedEarly >= 0)
    await purgeExpiredIdempotencyKeys(db, new Date(FIXED_NOW.getTime() + 25 * HOUR))
    const after = await db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.institutionId, ctx.institutionId))
    assert.equal(after.length, 0)
  })

  test('yeni anahtar yazılırken kurumun süresi dolan anahtarları silinir; başka kurum ve taze anahtar kalır', async () => {
    const { created, ctx } = await institution()
    const { ctx: otherCtx } = await institution()
    const colleague = await createMember(app, created.id, 'onburo')
    const colleagueCtx: ServiceContext = {
      ...ctx,
      actor: { userId: colleague.id, role: 'onburo', membershipId: colleague.membershipId },
    }
    await runCommand(ctx, payRequest(first.id), respond(first.id), {
      key: key(7),
      fingerprint: 'f',
    })
    await runCommand(otherCtx, payRequest(first.id), respond(first.id), {
      key: key(8),
      fingerprint: 'f',
    })
    const keysOf = async (institutionId: string) =>
      (
        await db
          .select({ key: idempotencyKeys.key })
          .from(idempotencyKeys)
          .where(eq(idempotencyKeys.institutionId, institutionId))
      )
        .map((row) => row.key)
        .sort()

    // 25 saat sonra kurumdaki başka bir kullanıcının yazması eski anahtarı temizler.
    const later: ServiceContext = {
      ...colleagueCtx,
      now: new Date(FIXED_NOW.getTime() + 25 * HOUR),
    }
    await runCommand(later, payRequest(second.id), respond(second.id), {
      key: key(9),
      fingerprint: 'f',
    })
    assert.deepEqual(await keysOf(created.id), [key(9)])
    assert.deepEqual(await keysOf(otherCtx.institutionId), [key(8)])
  })

  test('özet metot, yol ve gövdeye bağlıdır; anahtar sırasına bağlı değildir', () => {
    const a = requestFingerprint('post', '/x', { b: 1, a: [2, { d: 1, c: 2 }] })
    assert.equal(a, requestFingerprint('POST', '/x', { a: [2, { c: 2, d: 1 }], b: 1 }))
    assert.notEqual(a, requestFingerprint('POST', '/y', { b: 1, a: [2, { d: 1, c: 2 }] }))
    assert.notEqual(a, requestFingerprint('POST', '/x', { b: 1, a: [{ d: 1, c: 2 }, 2] }))
  })

  describe('HTTP', () => {
    async function signedIn() {
      const { created } = await institution()
      return { created, cookie: await signInAs(app, created.admin) }
    }

    function post(
      cookie: string,
      invoiceId: string,
      body: unknown,
      headers: Record<string, string> = {},
    ) {
      return app.inject({
        method: 'POST',
        url: `/api/v1/test-payments/${invoiceId}`,
        headers: { cookie, origin: TEST_ORIGIN, 'content-type': 'application/json', ...headers },
        payload: JSON.stringify(body),
      })
    }

    test('zorunlu uçta anahtar yoksa 400 idempotency_key_required; kayıt değişmez', async () => {
      const { created, cookie } = await signedIn()
      const response = await post(cookie, first.id, { method: 'Banka havalesi' })
      assert.equal(response.statusCode, 400)
      assert.equal(response.json().code, 'idempotency_key_required')
      const row = await findRecord(db, created.id, 'invoices', first.id)
      assert.equal(row?.version, 1)
    })

    test('biçimsiz anahtar 400 validation_failed', async () => {
      const { cookie } = await signedIn()
      const response = await post(
        cookie,
        first.id,
        { method: 'Banka havalesi' },
        { 'idempotency-key': 'kisa' },
      )
      assert.equal(response.statusCode, 400)
      assert.equal(response.json().code, 'validation_failed')
    })

    test('tekrar aynı yanıtı Idempotent-Replayed başlığıyla döner; farklı gövde 422', async () => {
      const { cookie } = await signedIn()
      const headers = { 'idempotency-key': key(7) }
      const firstResponse = await post(cookie, first.id, { method: 'Banka havalesi' }, headers)
      assert.equal(firstResponse.statusCode, 200)
      assert.equal(firstResponse.headers['idempotent-replayed'], undefined)
      const replay = await post(cookie, first.id, { method: 'Banka havalesi' }, headers)
      assert.equal(replay.statusCode, 200)
      assert.equal(replay.headers['idempotent-replayed'], 'true')
      assert.deepEqual(replay.json(), firstResponse.json())
      const reused = await post(cookie, first.id, { method: 'Kredi kartı' }, headers)
      assert.equal(reused.statusCode, 422)
      assert.equal(reused.json().code, 'idempotency_key_reused')
    })
  })
})
