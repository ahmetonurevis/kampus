import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'
import type { WithdrawalBreakdown } from '@kampus/school-core/lib/withdrawals.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { refundInvoices } from '../src/db/schema/finance-refund-invoices.ts'
import { studentWithdrawals } from '../src/db/schema/withdrawals.ts'
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
 * İade faturası ve iptal isteği uçları (DOM-FIN-096; ON-266; IST-110; K-292…K-295). Her test kendi
 * kurumunu kurar: bir öğrenci ve ödenmiş 20.000 TL'lik ayrılış iadesi (ayrılış 2026-10-01, ödeme
 * 2026-10-05). Asıl fatura e-Arşiv, 2026-10-01, 11.000 TL, %10 KDV. FIXED_NOW 2026-10-06.
 */

const URL = '/api/v1/finance/refund-invoices'
const SEED = createSeed(FIXED_NOW)
const STUDENT = SEED.students.find((item) => item.classId === 'c1')
const ORIGINAL = {
  number: 'KMP2026000000012',
  date: '2026-10-01',
  type: 'e_archive',
  totalCents: 1_100_000,
  vatRateBasisPoints: 1000,
} as const

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

describe('DOM-FIN-096: iade faturası ve iptal isteği uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.96.0.1'

  before(async () => {
    assert.ok(STUDENT)
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
  const key = () => ({ 'idempotency-key': randomUUID() })
  const ifMatch = (version: unknown) => ({ 'if-match': `"${String(version)}"` })
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  /** Kurum, öğrenci ve iade; `paid: false` ödenmemiş iade açar. */
  async function institution(overrides: Partial<InstitutionOverrides> & { paid?: boolean } = {}) {
    const { paid = true, ...institutionOverrides } = overrides
    clientIp = `10.96.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, institutionOverrides)
    assert.ok(STUDENT)
    await insertMissingRecords(
      db,
      created.id,
      [{ collection: 'students', id: STUDENT.id, data: { ...STUDENT } }],
      FIXED_NOW,
    )
    const withdrawalId = randomUUID()
    await db.insert(studentWithdrawals).values({
      institutionId: created.id,
      id: withdrawalId,
      studentId: STUDENT.id,
      contractId: `test-contract-${withdrawalId}`,
      withdrawalDate: '2026-10-01',
      reason: 'relocation',
      breakdown: { refundCents: 2_000_000 } as unknown as WithdrawalBreakdown,
      refundCents: 2_000_000,
      debtCents: 0,
      refundDueDate: '2026-11-01',
      approvedByUserId: created.admin.id,
      refundPaidDate: paid ? '2026-10-05' : null,
    })
    return { id: created.id, admin: await signInAs(app, created.admin), withdrawalId }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>

  const create = (tenant: Tenant, body: Json = {}, headers: Record<string, string> = key()) =>
    call(
      'POST',
      URL,
      tenant.admin,
      {
        withdrawalId: tenant.withdrawalId,
        originalInvoice: ORIGINAL,
        amountCents: 1_100_000,
        ...body,
      },
      headers,
    )
  const step = (cookie: string, doc: Json, path: string, body?: Json) =>
    call('POST', `${URL}/${String(doc.id)}/${path}`, cookie, body, ifMatch(doc.version))
  const rows = (institutionId: string) =>
    db
      .select()
      .from(refundInvoices)
      .where(eq(refundInvoices.institutionId, institutionId))
      .orderBy(refundInvoices.createdAt)

  test('DOM-FIN-096, K-292: tam iade pencerede iptal isteği önerilir; tekrar aynı yanıtı verir, denetime düşer', async () => {
    const a = await institution()
    const headers = key()
    const first = await create(a, {}, headers)
    const doc = ok(first, 201)
    assert.equal(first.headers.location, `${URL}/${String(doc.id)}`)
    assert.equal(doc.kind, 'cancellation')
    assert.equal(doc.status, 'draft')
    assert.equal(doc.amountCents, 1_100_000)
    assert.equal(doc.netCents, 1_000_000)
    assert.equal(doc.vatCents, 100_000)
    assert.equal(doc.partial, false)
    assert.equal(doc.cancelWindowEndsOn, '2026-10-08')
    assert.equal(doc.studentName, STUDENT?.name)
    assert.deepEqual(doc.actions, { ready: true, complete: false, discard: true })
    const replay = await create(a, {}, headers)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.deepEqual(ok(replay, 201), doc)
    assert.equal((await rows(a.id)).length, 1)
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'refund_invoice.create')))
    assert.equal(audits.length, 1)
    assert.deepEqual(audits[0]?.changes, {
      fields: ['withdrawalId', 'kind', 'originalInvoice', 'amountCents'],
    })
  })

  test('DOM-FIN-096, K-293: kısmi iade faturası; ikinci belge 409, kurallar 422 ve kayıt değişmez', async () => {
    const a = await institution()
    assertError(
      await create(a, { amountCents: 1_100_001 }),
      422,
      'refund_invoice_amount_exceeds_invoice',
    )
    assertError(
      await create(a, {
        amountCents: 2_000_001,
        originalInvoice: { ...ORIGINAL, totalCents: 3_000_000 },
      }),
      422,
      'refund_invoice_amount_exceeds_refund',
    )
    assertError(
      await create(a, { kind: 'cancellation', amountCents: 550_000 }),
      422,
      'refund_invoice_cancel_partial',
    )
    assertError(
      await create(a, { originalInvoice: { ...ORIGINAL, number: 'KMP2025000000012' } }),
      400,
    )
    assertError(await create(a, { institutionId: 'baska-kurum' }), 400)
    assert.equal((await rows(a.id)).length, 0)
    const doc = ok(await create(a, { amountCents: 550_000, note: 'Kısmi iade' }), 201)
    assert.equal(doc.kind, 'return_invoice')
    assert.equal(doc.partial, true)
    assert.deepEqual([doc.netCents, doc.vatCents], [500_000, 50_000])
    assertError(await create(a), 409, 'refund_invoice_exists')
    assert.equal((await rows(a.id)).length, 1)
  })

  test('DOM-FIN-096: ödenmemiş iadeye belge açılmaz; Idempotency-Key zorunlu', async () => {
    const a = await institution({ paid: false })
    assertError(await create(a), 422, 'refund_invoice_refund_not_paid')
    assertError(await create(a, {}, {}), 400)
    assert.equal((await rows(a.id)).length, 0)
  })

  test('DOM-FIN-096, K-294: iade faturası hazır olur, numarasıyla gönderildi işlenir ve değişmez', async () => {
    const a = await institution()
    const draft = ok(await create(a, { kind: 'return_invoice' }), 201)
    assertError(
      await step(a.admin, draft, 'complete', { completedDate: '2026-10-06' }),
      422,
      'refund_invoice_not_ready',
    )
    const ready = ok(await step(a.admin, draft, 'ready'))
    assert.equal(ready.status, 'ready')
    assert.equal(ready.version, 2)
    assertError(await step(a.admin, draft, 'ready'), 409, 'version_conflict')
    assertError(
      await step(a.admin, ready, 'complete', { completedDate: '2026-10-06' }),
      422,
      'refund_invoice_number_required',
    )
    const sent = ok(
      await step(a.admin, ready, 'complete', {
        completedDate: '2026-10-06',
        documentNumber: 'kmp2026000000040',
      }),
    )
    assert.equal(sent.status, 'sent')
    assert.equal(sent.documentNumber, 'KMP2026000000040')
    assert.equal(sent.completedDate, '2026-10-06')
    assert.deepEqual(sent.actions, { ready: false, complete: false, discard: false })
    assertError(
      await step(a.admin, sent, 'discard', { reason: 'Vazgeçildi' }),
      422,
      'refund_invoice_completed',
    )
    const [row] = await rows(a.id)
    assert.equal(row?.status, 'sent')
    assert.equal(row?.completedByUserId !== null, true)
  })

  test('DOM-FIN-096, K-294: iade faturası numarası kurumda tekildir (409)', async () => {
    const a = await institution()
    const first = ok(await create(a, { kind: 'return_invoice' }), 201)
    const firstReady = ok(await step(a.admin, first, 'ready'))
    ok(
      await step(a.admin, firstReady, 'complete', {
        completedDate: '2026-10-06',
        documentNumber: 'KMP2026000000040',
      }),
    )
    // Aynı kurumda ikinci ayrılış iadesi.
    const otherId = randomUUID()
    const [withdrawal] = await db
      .select()
      .from(studentWithdrawals)
      .where(eq(studentWithdrawals.id, a.withdrawalId))
    assert.ok(withdrawal)
    await db.insert(studentWithdrawals).values({
      ...withdrawal,
      id: otherId,
      contractId: `test-contract-${otherId}`,
    })
    const second = ok(
      await create({ ...a, withdrawalId: otherId }, { kind: 'return_invoice' }),
      201,
    )
    const secondReady = ok(await step(a.admin, second, 'ready'))
    assertError(
      await step(a.admin, secondReady, 'complete', {
        completedDate: '2026-10-06',
        documentNumber: 'KMP2026000000040',
      }),
      409,
      'refund_invoice_number_exists',
    )
    const stored = await rows(a.id)
    assert.equal(stored.find((item) => item.id === second.id)?.status, 'ready')
  })

  test('DOM-FIN-096, K-292: iptal isteği numarasız iptal edildi olur; numara verilirse 422', async () => {
    const a = await institution()
    const draft = ok(await create(a), 201)
    const ready = ok(await step(a.admin, draft, 'ready'))
    assertError(
      await step(a.admin, ready, 'complete', {
        completedDate: '2026-10-06',
        documentNumber: 'KMP2026000000040',
      }),
      422,
      'refund_invoice_number_not_applicable',
    )
    const done = ok(await step(a.admin, ready, 'complete', { completedDate: '2026-10-06' }))
    assert.equal(done.status, 'cancelled')
    assert.equal(done.documentNumber, null)
  })

  test('DOM-FIN-096, K-294: vazgeçilen belge arşivlenir, listeden düşer ve yeni belge açılır', async () => {
    const a = await institution()
    const draft = ok(await create(a), 201)
    assertError(await step(a.admin, draft, 'discard', { reason: 'kısa' }), 400)
    const discarded = ok(
      await step(a.admin, draft, 'discard', { reason: 'Fatura numarası yanlış' }),
    )
    assert.equal(discarded.version, 2)
    assertError(await call('GET', `${URL}/${String(draft.id)}`, a.admin), 404)
    const list = await call('GET', URL, a.admin)
    assert.equal(list.json().meta.total, 0)
    const [archived] = await rows(a.id)
    assert.equal(archived?.discardReason, 'Fatura numarası yanlış')
    assert.notEqual(archived?.archivedAt, null)
    const next = ok(await create(a, { kind: 'return_invoice' }), 201)
    assert.notEqual(next.id, draft.id)
  })

  test('DOM-FIN-096: liste süzer ve sayfalar; bilinmeyen parametre 400', async () => {
    const a = await institution()
    const doc = ok(await create(a), 201)
    const all = await call(
      'GET',
      `${URL}?withdrawalId=${a.withdrawalId}&kind=cancellation`,
      a.admin,
    )
    assert.equal(all.statusCode, 200, all.body)
    assert.deepEqual(
      all.json().data.map((item: Json) => item.id),
      [doc.id],
    )
    assert.equal((await call('GET', `${URL}?status=sent`, a.admin)).json().meta.total, 0)
    assertError(await call('GET', `${URL}?foo=1`, a.admin), 400)
  })

  test('DOM-FIN-096, K-295: CSV taze oturumla iner, BOM ve formül kaçışı taşır, denetime düşer', async () => {
    const a = await institution()
    ok(await create(a, { note: '=SUM(A1)' }), 201)
    const response = await call('GET', `${URL}?status=draft`, a.admin, undefined, {
      accept: 'text/csv',
    })
    assert.equal(response.statusCode, 200, response.body)
    assert.match(String(response.headers['content-type']), /text\/csv/)
    assert.match(String(response.headers['content-disposition']), /iade-belgeleri-2026-10-06\.csv/)
    assert.ok(response.body.startsWith('﻿"Belge türü"'))
    assert.match(response.body, /"İptal isteği";"Taslak"/)
    assert.match(response.body, /"'=SUM\(A1\)"/)
    assert.doesNotMatch(response.body, /TR\d{2}/)
    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'finance.refund_invoice_export')),
      )
    assert.equal(audits[0]?.entityId, 'refund-invoices:draft:all')
  })

  test('DOM-FIN-096, K-295: oturumsuz 401, ön büro 403, modül kapalı 403', async () => {
    const a = await institution()
    const doc = ok(await create(a), 201)
    assertError(await call('GET', URL, null), 401)
    const frontDesk = await signInAs(app, await createMember(app, a.id, 'onburo'))
    assertError(await call('GET', URL, frontDesk), 403)
    assertError(await create({ ...a, admin: frontDesk }), 403)
    assertError(await step(frontDesk, doc, 'ready'), 403)
    const off = await institution({ enabledModules: { finance: false } })
    assertError(await call('GET', URL, off.admin), 403, 'module_disabled')
    assertError(await create(off), 403, 'module_disabled')
  })

  test('DOM-FIN-096: başka kurumun ayrılışı ve belgesi 404; B değişmez, A listesinde B yok', async () => {
    const a = await institution()
    const b = await institution()
    const bDoc = ok(await create(b), 201)
    assertError(await create({ ...a, withdrawalId: b.withdrawalId }), 404)
    assertError(await call('GET', `${URL}/${String(bDoc.id)}`, a.admin), 404)
    assertError(await step(a.admin, bDoc, 'ready'), 404)
    assertError(await step(a.admin, bDoc, 'complete', { completedDate: '2026-10-06' }), 404)
    assertError(await step(a.admin, bDoc, 'discard', { reason: 'Sızma denemesi' }), 404)
    const list = await call('GET', URL, a.admin)
    assert.equal(list.json().meta.total, 0)
    const [bRow] = await rows(b.id)
    assert.equal(bRow?.status, 'draft')
    assert.equal(bRow?.version, 1)
    assert.equal(bRow?.archivedAt, null)
    assert.equal((await rows(a.id)).length, 0)
  })
})
